import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'

import {languageMapping} from './translation-languages.mjs'
import {loadTranslations, planTranslations, updateTranslations, validateTranslations} from './translations.mjs'

const languages = Object.keys(languageMapping).filter((language) => language !== 'en')
const englishPath = 'public/locales/en.json'
const snapshotPath = 'translations/last-translated.en.json'

async function fixture(
	t,
	{english = {message: 'Hello {{name}}', stable: 'Stable'}, snapshot = english, locale = english} = {},
) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'umbrel-translations-'))
	t.after(() => fs.rm(directory, {recursive: true, force: true}))
	await fs.mkdir(path.join(directory, 'public/locales'), {recursive: true})
	await fs.mkdir(path.join(directory, 'translations'))
	const write = (file, data) => fs.writeFile(path.join(directory, file), `${JSON.stringify(data, null, 2)}\n`)
	await write(englishPath, english)
	await write(snapshotPath, snapshot)
	for (const language of languages) await write(`public/locales/${language}.json`, locale)
	const files = [englishPath, snapshotPath, ...languages.map((language) => `public/locales/${language}.json`)]
	const contents = () => Promise.all(files.map((file) => fs.readFile(path.join(directory, file), 'utf8')))
	return {directory, write, contents}
}

const translate = async ({source}) =>
	Object.fromEntries(Object.entries(source).map(([key, value]) => [key, `Translated: ${value}`]))

test('updates changed wording and new keys, preserves corrections, removes deleted keys, and never writes English', async (t) => {
	const english = {message: 'Welcome {{name}}', stable: 'Stable', added: '<bold>New</bold>'}
	const f = await fixture(t, {
		english,
		snapshot: {message: 'Hello {{name}}', stable: 'Stable', removed: 'Old'},
		locale: {message: 'Old {{name}}', stable: 'Human correction', removed: 'Obsolete'},
	})
	const before = await f.contents()
	const calls = []
	await updateTranslations({
		directory: f.directory,
		generate: async (request) => {
			assert.notEqual(request.language, 'en')
			assert.deepEqual(Object.keys(request.source), ['message', 'added'])
			calls.push(request.language)
			return translate(request)
		},
	})
	assert.equal(calls.length, languages.length)
	const state = await loadTranslations(f.directory)
	assert.deepEqual(state.snapshot, english)
	assert.equal((await f.contents())[0], before[0])
	for (const locale of Object.values(state.locales)) {
		assert.deepEqual(locale, {
			message: 'Translated: Welcome {{name}}',
			stable: 'Human correction',
			added: 'Translated: <bold>New</bold>',
		})
	}
	validateTranslations(state, {requireFresh: true})

	// This also models a squash merge: freshness depends only on committed data.
	const after = await f.contents()
	const result = await updateTranslations({
		directory: f.directory,
		generate: () => assert.fail('No API call on repeat run'),
	})
	assert.equal(result.fresh, true)
	assert.deepEqual(await f.contents(), after)
})

test('an empty bootstrap snapshot regenerates existing values instead of assuming they are current', async (t) => {
	const f = await fixture(t, {snapshot: {}})
	const calls = []
	await updateTranslations({
		directory: f.directory,
		generate: async (request) => {
			calls.push(request)
			return translate(request)
		},
	})
	assert.equal(calls.length, languages.length)
	assert.ok(calls.every(({source}) => Object.keys(source).length === 2))
	assert.equal(planTranslations(await loadTranslations(f.directory)).fresh, true)
})

test('repairs missing entries and mismatched placeholder names even when English is unchanged', async (t) => {
	const english = {message: 'Hello {{name}}', stable: 'Stable', tag: '<bold>{{name}}</bold>'}
	const f = await fixture(t, {
		english,
		locale: {message: 'Hallo {{wrongName}}', tag: '<highlight>{{name}}</highlight>'},
	})
	assert.throws(
		() => validateTranslations({english, snapshot: english, locales: {de: {message: 'Hallo {{wrongName}}'}}}),
		/mismatched/,
	)
	await updateTranslations({directory: f.directory, generate: translate})
	validateTranslations(await loadTranslations(f.directory), {requireFresh: true})
})

test('deletion-only batches clean every locale and advance the snapshot without calling OpenAI', async (t) => {
	const f = await fixture(t, {
		english: {stable: 'Stable'},
		snapshot: {stable: 'Stable', removed: 'Old'},
		locale: {stable: 'Human correction', removed: 'Old'},
	})
	await updateTranslations({directory: f.directory, generate: () => assert.fail('Deletion needs no API call')})
	const state = await loadTranslations(f.directory)
	assert.deepEqual(state.snapshot, {stable: 'Stable'})
	assert.ok(
		Object.values(state.locales).every(
			(locale) => JSON.stringify(locale) === JSON.stringify({stable: 'Human correction'}),
		),
	)
	validateTranslations(state, {requireFresh: true})
})

test('development validation allows pending wording, missing entries and obsolete keys; release validation fails', async (t) => {
	const f = await fixture(t, {
		english: {message: 'Hello {{newName}}', newKey: 'New'},
		snapshot: {message: 'Hello {{name}}'},
		locale: {message: 'Hallo {{name}}', obsolete: 'Old'},
	})
	const state = await loadTranslations(f.directory)
	validateTranslations(state)
	assert.throws(() => validateTranslations(state, {requireFresh: true}), /out of date/)
})

test('English changed after a successful batch makes the release check fail', async (t) => {
	const f = await fixture(t)
	validateTranslations(await loadTranslations(f.directory), {requireFresh: true})
	await f.write(englishPath, {message: 'New wording {{name}}', stable: 'Stable'})
	const state = await loadTranslations(f.directory)
	assert.throws(() => validateTranslations(state, {requireFresh: true}), /out of date/)
})

for (const [name, generate] of Object.entries({
	'API failure': async () => {
		throw new Error('API failure')
	},
	'partial response': async () => ({stable: 'Translated'}),
	'extra response key': async ({source}) => ({...source, unexpected: 'Unexpected'}),
	'empty response value': async ({source}) => ({...source, stable: ''}),
	'nonstring response value': async ({source}) => ({...source, stable: 42}),
	'array response': async () => [],
	'wrong variable with the same count': async ({source}) => ({...source, message: 'Hi {{someoneElse}}'}),
	'extra variable': async ({source}) => ({...source, message: 'Hi {{name}} {{name}}'}),
})) {
	test(`${name} leaves all locale files and the snapshot untouched, even after another locale succeeds`, async (t) => {
		const f = await fixture(t, {snapshot: {}})
		const before = await f.contents()
		let calls = 0
		await assert.rejects(
			updateTranslations({
				directory: f.directory,
				concurrency: 1,
				generate: (request) => (++calls === 1 ? translate(request) : generate(request)),
			}),
		)
		assert.equal(calls, 2)
		assert.deepEqual(await f.contents(), before)
	})
}

test('uses bounded concurrency and batches a large source without losing keys', async (t) => {
	const english = Object.fromEntries(Array.from({length: 5}, (_, index) => [`key${index}`, `Text ${index}`]))
	const f = await fixture(t, {english, snapshot: {}})
	let active = 0
	let peak = 0
	let calls = 0
	await updateTranslations({
		directory: f.directory,
		concurrency: 3,
		batchSize: 2,
		generate: async (request) => {
			calls++
			active++
			peak = Math.max(peak, active)
			assert.ok(Object.keys(request.source).length <= 2)
			await new Promise((resolve) => setTimeout(resolve, 1))
			active--
			return translate(request)
		},
	})
	assert.equal(peak, 3)
	assert.equal(calls, languages.length * 3)
	validateTranslations(await loadTranslations(f.directory), {requireFresh: true})
})

test('a missing or corrupt snapshot fails closed instead of filling only missing translations', async (t) => {
	const f = await fixture(t)
	await fs.rm(path.join(f.directory, snapshotPath))
	await assert.rejects(loadTranslations(f.directory), /ENOENT/)
	await f.write(snapshotPath, [])
	await assert.rejects(loadTranslations(f.directory), /JSON object/)
})

test('invalid locales and missing or unknown language files cannot pass validation', async (t) => {
	const f = await fixture(t)
	await f.write('public/locales/de.json', {message: {nested: 'unsupported'}})
	await assert.rejects(loadTranslations(f.directory), /nonempty string/)
	await fs.rm(path.join(f.directory, 'public/locales/de.json'))
	await assert.rejects(loadTranslations(f.directory), /Missing locale file: de/)
	await f.write('public/locales/de.json', {message: 'Valid'})
	await f.write('public/locales/unknown.json', {message: 'Valid'})
	await assert.rejects(loadTranslations(f.directory), /Unknown language/)
})

for (const translation of [
	'</bold>{{name}}<bold>',
	'<bold>{{name}}</bold><extra x="1"/>',
	'<bold>{{name}}{{name}}</bold>',
]) {
	test(`rejects malformed component output: ${translation}`, async (t) => {
		const f = await fixture(t, {english: {message: '<bold>{{name}}</bold>'}, snapshot: {}})
		const before = await f.contents()
		await assert.rejects(
			updateTranslations({directory: f.directory, generate: async () => ({message: translation})}),
			/mismatched/,
		)
		assert.deepEqual(await f.contents(), before)
	})
}
