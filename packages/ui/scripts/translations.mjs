import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {languageMapping} from './translation-languages.mjs'

const defaultDirectory = fileURLToPath(new URL('..', import.meta.url))
const snapshotPath = 'translations/last-translated.en.json'

function assertStrings(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object of nonempty strings`)
	}
	for (const [key, text] of Object.entries(value)) {
		if (!key || typeof text !== 'string' || !text.trim()) {
			throw new Error(`${label}: ${key} must be a nonempty string`)
		}
	}
}

// Compare the actual interpolation names, including repetitions, not just their count.
// Preserve Trans component tags as well; translators may reorder complete components.
function tokens(text) {
	return (text.match(/{{[^{}]+}}|<\/?[A-Za-z0-9][^>]*>/g) || [])
		.map((token) => (token.startsWith('{{') ? `{{${token.slice(2, -2).trim()}}}` : token.replace(/\s+(\/?>)$/, '$1')))
		.sort()
}

function hasMatchingTokens(source, translation) {
	if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translation))) return false
	const stack = []
	for (const [, closing, name, ending] of translation.matchAll(/<(\/?)([A-Za-z0-9]+)([^>]*)>/g)) {
		if (closing) {
			if (stack.pop() !== name) return false
		} else if (!ending.trimEnd().endsWith('/')) {
			stack.push(name)
		}
	}
	return stack.length === 0
}

// i18next picks a count string's form with the target language's CLDR plural rules, so a
// language needs every category those rules use, not just English's _one and _other:
// Polish adds _few and _many, Slovenian _two. A missing form falls back to English.
const pluralCategories = ['zero', 'one', 'two', 'few', 'many', 'other']
const pluralSuffix = new RegExp(`_(${pluralCategories.join('|')})$`)
// English's "one" is exactly 1. These tell apart a "one" that also covers 0 (French),
// 21 (Russian) or 101 (Slovenian), whose form must show the count.
const oneProbes = [0, 1, 2, 11, 21, 101]

function pluralBase(english, key) {
	const match = key.match(pluralSuffix)
	if (!match) return undefined
	const base = key.slice(0, -match[0].length)
	return Object.hasOwn(english, `${base}_other`) ? base : undefined
}

// The keys a locale needs, each with the English key its translation is written from.
// A plural form English doesn't have is written from the English plural (_other).
export function localeKeys(english, language) {
	const rules = new Intl.PluralRules(language)
	// In CLDR order (one, few, many, other), which older engines don't keep, so a
	// message's forms reach the model in the same order on every Node version
	const categories = rules
		.resolvedOptions()
		.pluralCategories.sort((a, b) => pluralCategories.indexOf(a) - pluralCategories.indexOf(b))
	const oneIsOnlyOne = oneProbes.every((n) => (rules.select(n) === 'one') === (n === 1))
	const keys = {}
	for (const key of Object.keys(english)) {
		const base = pluralBase(english, key)
		if (!base) {
			keys[key] = {source: key}
			continue
		}
		if (key !== `${base}_other`) continue
		for (const category of categories) {
			const own = `${base}_${category}`
			const writtenFromOwn = Object.hasOwn(english, own) && (category !== 'one' || oneIsOnlyOne)
			keys[own] = {source: writtenFromOwn ? own : key, group: base}
		}
		// i18next looks up an explicit _zero for a count of 0 in every language
		if (Object.hasOwn(english, `${base}_zero`)) keys[`${base}_zero`] = {source: `${base}_zero`, group: base}
	}
	return keys
}

export async function loadTranslations(directory = defaultDirectory) {
	const read = async (relativePath) => {
		const data = JSON.parse(await fs.readFile(path.join(directory, relativePath), 'utf8'))
		assertStrings(data, relativePath)
		return data
	}
	const english = await read('public/locales/en.json')
	if (Object.keys(english).length === 0) throw new Error('en.json must not be empty')
	// A missing/corrupt snapshot is an error. The checked-in empty snapshot explicitly
	// requests a full first batch instead of silently trusting existing translations.
	const snapshot = await read(snapshotPath)
	const locales = {}
	const files = (await fs.readdir(path.join(directory, 'public/locales'))).filter((file) => file.endsWith('.json'))
	for (const file of files.sort()) {
		if (file === 'en.json') continue
		const language = file.slice(0, -5)
		if (!Object.hasOwn(languageMapping, language)) throw new Error(`Unknown language: ${language}`)
		locales[language] = await read(`public/locales/${file}`)
	}
	for (const language of Object.keys(languageMapping)) {
		if (language !== 'en' && !Object.hasOwn(locales, language)) {
			throw new Error(`Missing locale file: ${language}.json`)
		}
	}
	return {english, snapshot, locales}
}

export function planTranslations({english, snapshot, locales}) {
	const changed = Object.keys(english).filter((key) => !Object.hasOwn(snapshot, key) || snapshot[key] !== english[key])
	const deleted = Object.keys(snapshot).filter((key) => !Object.hasOwn(english, key))
	const changedSet = new Set(changed)
	const changedGroups = new Set(changed.map((key) => pluralBase(english, key)).filter(Boolean))
	const languages = Object.fromEntries(
		Object.entries(locales).map(([language, translations]) => {
			const keys = localeKeys(english, language)
			const stale = (key) =>
				(keys[key].group ? changedGroups.has(keys[key].group) : changedSet.has(key)) ||
				!Object.hasOwn(translations, key) ||
				!hasMatchingTokens(english[keys[key].source], translations[key])
			// A plural form is translated together with its siblings, so the forms read alike
			const staleGroups = new Set(
				Object.keys(keys)
					.filter((key) => keys[key].group && stale(key))
					.map((key) => keys[key].group),
			)
			return [
				language,
				{
					pending: Object.keys(keys).filter((key) => staleGroups.has(keys[key].group) || stale(key)),
					obsolete: Object.keys(translations).filter((key) => !Object.hasOwn(keys, key)),
				},
			]
		}),
	)
	return {
		changed,
		deleted,
		languages,
		fresh:
			changed.length === 0 &&
			deleted.length === 0 &&
			Object.values(languages).every(({pending, obsolete}) => pending.length === 0 && obsolete.length === 0),
	}
}

export function validateTranslations(state, {requireFresh = false} = {}) {
	const plan = planTranslations(state)
	if (requireFresh) {
		if (!plan.fresh) {
			throw new Error('Translations are out of date. Run the Update translations workflow and merge its PR first.')
		}
		return
	}
	// Development allows missing keys and old wording. Once a source value has been
	// translated, hand-edited translations must continue to preserve its tokens.
	// Plural forms written from another English form are regenerated instead.
	for (const [language, translations] of Object.entries(state.locales)) {
		for (const [key, {source}] of Object.entries(localeKeys(state.english, language))) {
			if (
				source === key &&
				state.snapshot[key] === state.english[key] &&
				Object.hasOwn(translations, key) &&
				!hasMatchingTokens(state.english[key], translations[key])
			) {
				throw new Error(`${language}.json: ${key} has mismatched interpolation variables or component tags`)
			}
		}
	}
}

// What is wrong with one translation in a response, if anything
function problem(english, translation) {
	if (translation === undefined) return 'is missing'
	if (typeof translation !== 'string' || !translation.trim()) return 'must be a nonempty string'
	if (!hasMatchingTokens(english, translation)) return 'has mismatched interpolation variables or component tags'
}

// Splits pending keys into batches of about batchSize without splitting a plural group,
// so the model writes all of a message's forms at once
function batches(pending, keys, batchSize) {
	const result = []
	let batch = []
	for (const [index, key] of pending.entries()) {
		const group = keys[key].group
		const startsUnit = !group || keys[pending[index - 1]]?.group !== group
		if (startsUnit && batch.length >= batchSize) {
			result.push(batch)
			batch = []
		}
		batch.push(key)
	}
	if (batch.length) result.push(batch)
	return result
}

// Translations finished by a run that failed later, kept so the next run only asks for
// the rest. Each line holds what one response got right, as key: [English, translation].
// Lines from another model or prompt are left out, and so is a line cut short by a kill.
async function readCache({path: file, version}) {
	const cached = {}
	const text = await fs.readFile(file, 'utf8').catch((error) => {
		if (error.code !== 'ENOENT') throw error
		return ''
	})
	for (const line of text.split('\n')) {
		try {
			const entry = JSON.parse(line)
			if (entry.version === version) cached[entry.language] = {...cached[entry.language], ...entry.translations}
		} catch {
			continue
		}
	}
	return cached
}

function serialize(data, indent = 2) {
	return JSON.stringify(
		Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
		null,
		indent,
	)
}

export async function updateTranslations({
	directory = defaultDirectory,
	generate = generateWithOpenAI,
	concurrency = 32,
	batchSize = 100,
	attempts = 3,
	cache,
} = {}) {
	for (const [name, value] of Object.entries({concurrency, batchSize, attempts})) {
		if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
	}
	const state = await loadTranslations(directory)
	const plan = planTranslations(state)
	if (plan.fresh) return plan

	const cached = cache ? await readCache(cache) : {}
	const reused = {}
	const results = {}
	// Every language's requests share one queue, so a large batch takes as long as its
	// requests divided by the concurrency, however they are spread over the languages
	const requests = []
	for (const [language, existing] of Object.entries(state.locales)) {
		const keys = localeKeys(state.english, language)
		results[language] = Object.fromEntries(Object.entries(existing).filter(([key]) => Object.hasOwn(keys, key)))
		const {pending} = plan.languages[language]
		const finished = (key) => {
			const entry = Object.hasOwn(cached[language] ?? {}, key) ? cached[language][key] : undefined
			return Array.isArray(entry) && entry[0] === state.english[keys[key].source] && !problem(...entry)
		}
		// A plural form is only reused with all its siblings, so the forms read alike
		const unfinished = new Set(pending.filter((key) => !finished(key)))
		const groups = new Set([...unfinished].map((key) => keys[key].group).filter(Boolean))
		const todo = pending.filter((key) => unfinished.has(key) || groups.has(keys[key].group))
		const kept = pending.filter((key) => !todo.includes(key))
		for (const key of kept) results[language][key] = cached[language][key][1]
		if (kept.length) reused[language] = Object.fromEntries(kept.map((key) => [key, cached[language][key]]))
		for (const batch of batches(todo, keys, batchSize)) requests.push({language, keys, batch})
	}
	const save = async (language, translations) => {
		if (!cache) return
		await fs.appendFile(cache.path, `${JSON.stringify({version: cache.version, language, translations})}\n`)
	}
	if (cache) {
		// Start the file again with only what this run reuses, so it never outgrows a batch
		await fs.writeFile(cache.path, '')
		for (const [language, translations] of Object.entries(reused)) await save(language, translations)
		const count = Object.values(reused).reduce((sum, translations) => sum + Object.keys(translations).length, 0)
		if (count) console.log(`Reusing ${count} translations from a run that did not finish.`)
	}
	const controller = new AbortController()
	// The model occasionally drops or renames a placeholder. Keep the strings it got right
	// and ask again for the rest, before failing every language over one string.
	const translate = async ({language, keys, batch}) => {
		let remaining = batch
		for (let attempt = 1; ; attempt++) {
			controller.signal.throwIfAborted()
			const source = Object.fromEntries(remaining.map((key) => [key, state.english[keys[key].source]]))
			const response = await generate({
				english: state.english,
				source,
				language,
				existing: state.locales[language],
				signal: controller.signal,
			})
			const translations = response && typeof response === 'object' ? response : {}
			const problems = new Map()
			for (const key of remaining) {
				const reason = problem(source[key], Object.hasOwn(translations, key) ? translations[key] : undefined)
				if (reason) problems.set(key, reason)
			}
			// A plural form is asked for again with its siblings, so the forms read alike
			const groups = new Set([...problems.keys()].map((key) => keys[key].group).filter(Boolean))
			const retry = remaining.filter((key) => problems.has(key) || groups.has(keys[key].group))
			const accepted = remaining.filter((key) => !retry.includes(key))
			for (const key of accepted) results[language][key] = translations[key]
			if (accepted.length) {
				await save(language, Object.fromEntries(accepted.map((key) => [key, [source[key], translations[key]]])))
			}
			if (!retry.length) return
			const [[key, reason]] = problems
			const others = problems.size > 1 ? ` (and ${problems.size - 1} more)` : ''
			const message = `${language} response: ${key} ${reason}${others}`
			if (attempt >= attempts) throw new Error(message)
			console.warn(`${message}. Retrying (${attempt + 1}/${attempts}).`)
			remaining = retry
		}
	}
	let next = 0
	let failure
	const worker = async () => {
		try {
			while (!controller.signal.aborted && next < requests.length) await translate(requests[next++])
		} catch (error) {
			failure ??= error
			controller.abort(error)
		}
	}
	await Promise.all(Array.from({length: Math.min(concurrency, requests.length)}, worker))
	if (failure) throw failure
	validateTranslations({english: state.english, snapshot: state.english, locales: results}, {requireFresh: true})

	// No files are changed until every language has succeeded and been validated.
	// Write the snapshot last; a failed/interrupted write must never mark a partial
	// batch current. The workflow only publishes on success.
	for (const [language, translations] of Object.entries(results)) {
		const file = path.join(directory, `public/locales/${language}.json`)
		const text = serialize(translations)
		if ((await fs.readFile(file, 'utf8')) !== text) await fs.writeFile(file, text)
	}
	await fs.writeFile(path.join(directory, snapshotPath), `${serialize(state.english, '\t')}\n`)
	return plan
}

let client
async function generateWithOpenAI({english, source, language, existing, signal}) {
	const required = [
		'TRANSLATIONS_OPENAI_API_KEY',
		'TRANSLATIONS_OPENAI_MODEL',
		'TRANSLATIONS_SYSTEM_PROMPT',
		'TRANSLATIONS_USER_PROMPT',
	]
	for (const name of required) {
		if (!process.env[name]) throw new Error(`Missing ${name}`)
	}
	if (!client) {
		const {default: OpenAI} = await import('openai')
		// Requests run many at a time, so allow for waiting out a rate limit: before each
		// retry the client waits as long as the API asks, or else backs off for up to 8 seconds
		client = new OpenAI({apiKey: process.env.TRANSLATIONS_OPENAI_API_KEY, timeout: 120_000, maxRetries: 8})
	}
	const examples = [
		'account-description',
		'wallpaper-description',
		'2fa-description',
		'tor-description',
		'migration-assistant',
		'migration-assistant-description',
		'language',
		'language-description',
		'app-store.description',
		'migrate',
		'change-name',
		'change-password',
		'onboarding.account-created.youre-all-set-name',
	].filter((key) => english[key] && existing[key])
	const replacements = {
		replace_input_example: examples.map((key) => `'${key}': '${english[key]}'`).join(', '),
		replace_output_example: examples.map((key) => `'${key}': '${existing[key]}'`).join(', '),
		replace_target_language: languageMapping[language],
		replace_text_to_translate: JSON.stringify(source),
	}
	const render = (template) =>
		template.replace(
			/replace_input_example|replace_output_example|replace_target_language|replace_text_to_translate/g,
			(key) => replacements[key],
		)
	const plurals = Object.keys(source).some((key) => pluralBase(english, key))
		? `\nKeys ending in _zero, _one, _two, _few, _many or _other are the forms of one count message, picked by the CLDR plural rules for ${languageMapping[language]}. Write each in the grammatical form its category needs. Each form is given the English form that covers the same numbers, or else the English plural.`
		: ''
	const response = await client.responses.create(
		{
			model: process.env.TRANSLATIONS_OPENAI_MODEL,
			instructions: `${render(process.env.TRANSLATIONS_SYSTEM_PROMPT)}\nReturn a JSON object containing exactly the requested keys and nonempty string values. Preserve all {{interpolation}} variables and <component> tags exactly. Do not translate keys.${plurals}`,
			input: render(process.env.TRANSLATIONS_USER_PROMPT),
			reasoning: {effort: 'medium'},
			text: {format: {type: 'json_object'}},
		},
		{signal},
	)
	if (response.status !== 'completed') throw new Error(`Incomplete translation response for ${language}`)
	return JSON.parse(response.output_text)
}

export async function runCli(args) {
	if (args.length !== 1 || !['--generate', '--plan', '--validate', '--check'].includes(args[0])) {
		throw new Error('Usage: node update-translations.js --generate | --plan | --validate | --check')
	}
	const state = await loadTranslations()
	if (args[0] === '--validate') {
		validateTranslations(state)
		console.log('Locale validation passed (pending translations are allowed during development).')
		return
	}
	const plan = planTranslations(state)
	console.log(`English: ${plan.changed.length} new/changed keys, ${plan.deleted.length} removed keys.`)
	for (const [language, {pending, obsolete}] of Object.entries(plan.languages)) {
		if (pending.length || obsolete.length)
			console.log(`${language}: ${pending.length} to translate, ${obsolete.length} to remove`)
	}
	if (args[0] === '--check') validateTranslations(state, {requireFresh: true})
	if (args[0] === '--generate') {
		// A different model or prompt starts over rather than mixing two sets of translations
		const settings = ['TRANSLATIONS_OPENAI_MODEL', 'TRANSLATIONS_SYSTEM_PROMPT', 'TRANSLATIONS_USER_PROMPT']
		const version = createHash('sha256')
			.update(JSON.stringify(settings.map((name) => process.env[name])))
			.digest('hex')
		const file = process.env.TRANSLATIONS_CACHE
		await updateTranslations({cache: file ? {path: file, version} : undefined})
	}
	if (plan.fresh) console.log('Translations are up to date; nothing to generate.')
}
