import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

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
		// A bad response is retried before failing; an API error is not
		assert.equal(calls, name === 'API failure' ? 2 : 4)
		assert.deepEqual(await f.contents(), before)
	})
}

test('a response with a broken placeholder is retried instead of failing the run', async (t) => {
	const f = await fixture(t, {snapshot: {}})
	const failed = new Set()
	await updateTranslations({
		directory: f.directory,
		generate: async (request) => {
			if (failed.has(request.language)) return translate(request)
			failed.add(request.language)
			return {...request.source, message: 'Hi {{someoneElse}}'}
		},
	})
	validateTranslations(await loadTranslations(f.directory), {requireFresh: true})
})

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

test('plural strings get every form each language uses, written together, and lose forms it never uses', async (t) => {
	const english = {files_one: '{{count}} file', files_other: '{{count}} files', stable: 'Stable'}
	const f = await fixture(t, {
		english,
		locale: {files_one: 'Correction {{count}}', files_other: 'Corrections {{count}}', stable: 'Correction'},
	})
	const requests = {}
	await updateTranslations({
		directory: f.directory,
		generate: async (request) => {
			requests[request.language] = request.source
			return translate(request)
		},
	})
	// Polish adds two forms and writes them with its existing ones from the English plural
	assert.deepEqual(requests.pl, {
		files_few: '{{count}} files',
		files_many: '{{count}} files',
		files_one: '{{count}} file',
		files_other: '{{count}} files',
	})
	// Russian "one" also means 21, so its form is written from the English plural too
	assert.equal(requests.ru.files_one, '{{count}} files')
	// German has English's forms, and Japanese only needs the one it has
	assert.equal(requests.de, undefined)
	assert.equal(requests.ja, undefined)
	const state = await loadTranslations(f.directory)
	assert.deepEqual(state.locales.de, {
		files_one: 'Correction {{count}}',
		files_other: 'Corrections {{count}}',
		stable: 'Correction',
	})
	assert.deepEqual(state.locales.ja, {files_other: 'Corrections {{count}}', stable: 'Correction'})
	assert.deepEqual(Object.keys(state.locales.pl).sort(), [
		'files_few',
		'files_many',
		'files_one',
		'files_other',
		'stable',
	])
	validateTranslations(state, {requireFresh: true})
})

test('a language missing a plural form fails the release check but passes development validation', async (t) => {
	const english = {files_one: '{{count}} file', files_other: '{{count}} files'}
	const f = await fixture(t, {english})
	const state = await loadTranslations(f.directory)
	validateTranslations(state)
	assert.throws(() => validateTranslations(state, {requireFresh: true}), /out of date/)
	assert.deepEqual(planTranslations(state).languages.sl.pending.sort(), [
		'files_few',
		'files_one',
		'files_other',
		'files_two',
	])
})

test('changed English wording retranslates every form of that plural string', async (t) => {
	const english = {files_one: '{{count}} document', files_other: '{{count}} files'}
	const locale = {
		files_one: 'A {{count}}',
		files_few: 'B {{count}}',
		files_many: 'C {{count}}',
		files_other: 'D {{count}}',
	}
	const f = await fixture(t, {english, snapshot: {...english, files_one: '{{count}} file'}, locale})
	const plan = planTranslations(await loadTranslations(f.directory))
	assert.deepEqual(plan.languages.pl.pending.sort(), ['files_few', 'files_many', 'files_one', 'files_other'])
	assert.deepEqual(plan.languages.ja.pending, ['files_other'])
})

test('batches never split the forms of a plural string', async (t) => {
	const english = {a: 'A', files_one: '{{count}} file', files_other: '{{count}} files', z: 'Z'}
	const f = await fixture(t, {english, snapshot: {}})
	const sizes = []
	await updateTranslations({
		directory: f.directory,
		batchSize: 2,
		generate: async (request) => {
			if (request.language === 'pl') sizes.push(Object.keys(request.source))
			return translate(request)
		},
	})
	assert.deepEqual(sizes, [['a', 'files_one', 'files_few', 'files_many', 'files_other'], ['z']])
})

// A t() key that isn't in en.json is never translated, so every language shows its
// key or inline fallback. Literal keys are checked; built keys can't be.
test('every literal translation key in the UI source exists in en.json', async () => {
	const root = fileURLToPath(new URL('..', import.meta.url))
	const english = JSON.parse(await fs.readFile(path.join(root, 'public/locales/en.json'), 'utf8'))
	const known = (key) => Object.hasOwn(english, key) || Object.hasOwn(english, `${key}_other`)
	const missing = []
	for (const file of await fs.readdir(path.join(root, 'src'), {recursive: true})) {
		if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue
		const lines = (await fs.readFile(path.join(root, 'src', file), 'utf8')).split('\n')
		for (const [index, line] of lines.entries()) {
			if (/^\s*(\/\/|\*)/.test(line)) continue
			for (const [, key] of line.matchAll(/(?<![\w$])(?:t\(\s*|i18nKey=\{?)['"]([^'"$]+)['"]/g)) {
				if (!known(key)) missing.push(`src/${file}:${index + 1} ${key}`)
			}
		}
	}
	assert.deepEqual(missing, [])
})

// Where a language's "one" isn't only 1 (Russian 21, French 0), its form is written from the
// English plural, and Japanese has no "one" form at all. So an English singular can't use a
// variable or tag its plural lacks: naming the file when there's exactly one needs its own
// key, picked when the count is 1.
test('English singular forms use no variables or tags their plural lacks', async () => {
	const root = fileURLToPath(new URL('..', import.meta.url))
	const english = JSON.parse(await fs.readFile(path.join(root, 'public/locales/en.json'), 'utf8'))
	const parts = (text) =>
		new Set((text.match(/{{[^{}]+}}|<\/?[A-Za-z0-9]+/g) || []).map((part) => part.replace(/\s/g, '')))
	const extra = []
	for (const [key, text] of Object.entries(english)) {
		const plural = key.endsWith('_one') && english[`${key.slice(0, -4)}_other`]
		if (!plural) continue
		const allowed = parts(plural)
		for (const part of parts(text)) if (!allowed.has(part)) extra.push(`${key} ${part}`)
	}
	assert.deepEqual(extra, [])
})
