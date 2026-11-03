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

function validateGenerated(source, result, language) {
	assertStrings(result, `${language} response`)
	const expected = Object.keys(source).sort()
	if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expected)) {
		throw new Error(`${language} response must contain exactly the requested keys`)
	}
	for (const key of expected) {
		if (!hasMatchingTokens(source[key], result[key])) {
			throw new Error(`${language} response: ${key} has mismatched interpolation variables or component tags`)
		}
	}
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
	concurrency = 4,
	batchSize = 100,
	attempts = 3,
} = {}) {
	for (const [name, value] of Object.entries({concurrency, batchSize, attempts})) {
		if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
	}
	const state = await loadTranslations(directory)
	const plan = planTranslations(state)
	if (plan.fresh) return plan

	const results = {}
	const languages = Object.keys(state.locales)
	const controller = new AbortController()
	let next = 0
	let failure
	const worker = async () => {
		try {
			while (!controller.signal.aborted && next < languages.length) {
				const language = languages[next++]
				const existing = state.locales[language]
				const keys = localeKeys(state.english, language)
				const result = Object.fromEntries(Object.entries(existing).filter(([key]) => Object.hasOwn(keys, key)))
				for (const batch of batches(plan.languages[language].pending, keys, batchSize)) {
					controller.signal.throwIfAborted()
					const source = Object.fromEntries(batch.map((key) => [key, state.english[keys[key].source]]))
					// The model occasionally drops or renames a placeholder, so ask again
					// before failing every language over one bad string
					for (let attempt = 1; ; attempt++) {
						const generated = await generate({
							english: state.english,
							source,
							language,
							existing,
							signal: controller.signal,
						})
						try {
							validateGenerated(source, generated, language)
							Object.assign(result, generated)
							break
						} catch (error) {
							if (attempt >= attempts) throw error
							console.warn(`${error.message}. Retrying (${attempt + 1}/${attempts}).`)
						}
					}
				}
				results[language] = result
			}
		} catch (error) {
			failure ??= error
			controller.abort(error)
		}
	}
	await Promise.all(Array.from({length: Math.min(concurrency, languages.length)}, worker))
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
		client = new OpenAI({apiKey: process.env.TRANSLATIONS_OPENAI_API_KEY, timeout: 120_000, maxRetries: 2})
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
	if (args[0] === '--generate') await updateTranslations()
	if (plan.fresh) console.log('Translations are up to date; nothing to generate.')
}
