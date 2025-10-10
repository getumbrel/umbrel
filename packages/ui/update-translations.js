import {execSync} from 'child_process'
import fs from 'fs'
import path from 'path'
import process from 'process'
import fg from 'fast-glob'
import OpenAI from 'openai'

const exampleTranslationKeys = [
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
]

const localesDirectory = path.join(process.cwd(), 'public', 'locales')
const englishReferenceFilePath = path.join(localesDirectory, 'en.json')

const languageMapping = {
	en: 'English',
	de: 'German',
	es: 'Spanish',
	fr: 'French',
	it: 'Italian',
	ja: 'Japanese',
	nl: 'Dutch',
	pt: 'Portuguese',
	tr: 'Turkish',
	uk: 'Ukrainian',
	hu: 'Hungarian',
	ko: 'Korean',
}

// Get en.json content from the base branch
function getBaseEnglishContent(baseBranch) {
	try {
		// We're running from packages/ui directory, but git show needs path from repo root
		const baseEnJsonPath = 'packages/ui/public/locales/en.json'

		const result = execSync(`git show ${baseBranch}:${baseEnJsonPath}`, {encoding: 'utf8'})
		return JSON.parse(result)
	} catch (error) {
		console.log(`Could not get base en.json from branch ${baseBranch}: ${error.message}`)
		return null
	}
}

// Get modified keys between current and base en.json
function getModifiedKeys(currentContent, baseContent) {
	const modifiedKeys = {}

	// Find added or modified keys
	for (const [key, value] of Object.entries(currentContent)) {
		if (!baseContent || !(key in baseContent) || baseContent[key] !== value) {
			modifiedKeys[key] = value
		}
	}

	return modifiedKeys
}

// Get the last commit that modified a specific key in a file within the PR
// Returns commit hash or null
function getLastCommitForKey(filePath, key, baseBranch) {
	try {
		// Escape special regex characters in the key
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

		// filePath is already relative to current directory (packages/ui)
		// Git needs it relative to current directory, not repo root
		const gitFilePath = filePath

		// Get all commits in the PR that modified this key
		// Use three dots (...) to include commits from the PR branch, not just direct ancestry
		// This is important because GitHub Actions creates merge commits
		const gitCommand = `git log --pretty=format:'%H' -G'"${escapedKey}"' ${baseBranch}...HEAD -- ${gitFilePath}`
		const result = execSync(gitCommand, {encoding: 'utf8'}).trim()

		if (!result) {
			return null
		}

		// Return the most recent commit (first in the list)
		const commits = result.split('\n')
		return commits[0]
	} catch (error) {
		return null
	}
}

// Check if a key needs regeneration
// Returns true if the key should be regenerated
function shouldRegenerateKey(key, localeFile, baseBranch) {
	const enFilePath = 'public/locales/en.json'
	const localeFilePath = path.join('public/locales', localeFile)

	// Find when the key was last modified in en.json in this PR
	const enCommit = getLastCommitForKey(enFilePath, key, baseBranch)

	if (!enCommit) {
		// Key wasn't modified in en.json in this PR, but it's in modifiedKeys
		// This means it exists in current but not in base (new key)
		// Check if it was already translated in this PR
		const localeCommit = getLastCommitForKey(localeFilePath, key, baseBranch)
		return !localeCommit // Regenerate if not translated
	}

	// Find when the key was last modified in the locale file in this PR
	const localeCommit = getLastCommitForKey(localeFilePath, key, baseBranch)

	if (!localeCommit) {
		// Key was modified in en.json but not in locale file - needs regeneration
		return true
	}

	// Both were modified - check which commit came first
	// If locale commit came after en commit, skip regeneration
	try {
		// Check if en commit is an ancestor of locale commit
		// If yes, locale came after en
		execSync(`git merge-base --is-ancestor ${enCommit} ${localeCommit}`, {encoding: 'utf8'})
		// Locale came after en - skip regeneration
		return false
	} catch (error) {
		// En is not ancestor of locale, so en came after - needs regeneration
		return true
	}
}

// Get keys that need regeneration for a specific locale
function getKeysNeedingRegeneration(modifiedEnKeys, localeFile, baseBranch) {
	const keysNeedingRegeneration = {}

	for (const [key, value] of Object.entries(modifiedEnKeys)) {
		if (shouldRegenerateKey(key, localeFile, baseBranch)) {
			keysNeedingRegeneration[key] = value
		}
	}

	return keysNeedingRegeneration
}

// Generates translations
async function generateTranslation(englishReferenceContent, textToTranslate, targetLanguage, existingLanguageContent) {
	const openai = new OpenAI({apiKey: process.env.TRANSLATIONS_OPENAI_API_KEY})
	const model = process.env.TRANSLATIONS_OPENAI_MODEL
	const systemPromptTemplate = process.env.TRANSLATIONS_SYSTEM_PROMPT
	const userPromptTemplate = process.env.TRANSLATIONS_USER_PROMPT

	const inputExample = exampleTranslationKeys.map((key) => `'${key}': '${englishReferenceContent[key]}'`).join(', ')
	const outputExample = exampleTranslationKeys.map((key) => `'${key}': '${existingLanguageContent[key]}'`).join(', ')
	const systemPrompt = systemPromptTemplate
		.replace('replace_input_example', inputExample)
		.replace('replace_output_example', outputExample)
		.replace('replace_target_language', languageMapping[targetLanguage])
	const userPrompt = userPromptTemplate
		.replace('replace_target_language', languageMapping[targetLanguage])
		.replace('replace_target_language', languageMapping[targetLanguage])
		.replace('replace_text_to_translate', JSON.stringify(textToTranslate))

	const completion = await openai.chat.completions.create({
		messages: [
			{role: 'system', content: systemPrompt},
			{role: 'user', content: userPrompt},
		],
		model,
		response_format: {type: 'json_object'},
	})

	return completion.choices[0].message.content
}

async function removeUnusedTranslations(englishReferenceContent) {
	const tsxFiles = await fg([
		'src/**/*.tsx',
		'src/**/*.ts',
		'stories/src/**/*.tsx',
		'stories/src/**/*.ts',
		'app-auth/src/**/*.tsx',
		'app-auth/src/**/*.ts',
	])
	const unusedKeys = []

	for (const key in englishReferenceContent) {
		let isKeyUsed = false
		for (const file of tsxFiles) {
			const content = fs.readFileSync(file, 'utf8')
			// Checks for t('key'), i18nKey='key', t("key"), i18nKey="key"
			let keyToTest = key

			// https://www.i18next.com/translation-function/plurals
			if (key.endsWith('_one')) {
				keyToTest = key.slice(0, -4)
			} else if (key.endsWith('_other')) {
				keyToTest = key.slice(0, -6)
			}
			const keyPatterns = [
				`t('${keyToTest}'`,
				`i18nKey='${keyToTest}'`,
				`t("${keyToTest}"`,
				`i18nKey="${keyToTest}"`,
				`TKey: '${keyToTest}'`,
			]
			if (keyPatterns.some((pattern) => content.includes(pattern))) {
				isKeyUsed = true
				break
			}
		}
		if (!isKeyUsed) {
			unusedKeys.push(key)
		}
	}
	// Delete unused keys from englishReferenceContent
	for (const key of unusedKeys) {
		console.log(`Removing unused translation key: '${key}'`)
		delete englishReferenceContent[key]
	}
	// Save the updated englishReferenceContent to file
	fs.writeFileSync(englishReferenceFilePath, JSON.stringify(englishReferenceContent, null, 2), 'utf8')
}

// Check for missing or redundant translations in locale files and generates them if needed
async function generateAndWriteTranslations(
	englishReferenceContent,
	localeFile,
	modifiedEnKeys = null,
	baseBranch = null,
) {
	const localeFilePath = path.join(localesDirectory, localeFile)
	let localeFileContent = JSON.parse(fs.readFileSync(localeFilePath, 'utf8'))
	const targetLanguage = localeFile.split('.')[0]

	// Remove keys in which no longer exist in en.json
	localeFileContent = Object.fromEntries(
		Object.entries(localeFileContent).filter(([key]) => key in englishReferenceContent),
	)

	// Check for variable mismatches between English and translated content for each key-value pair
	for (const [key, value] of Object.entries(englishReferenceContent)) {
		const variableRegex = /{{\w+}}/g
		const englishVariables = value.match(variableRegex)
		const translatedValue = localeFileContent[key]
		if (translatedValue) {
			const translatedVariables = translatedValue.match(variableRegex)
			if (englishVariables && (!translatedVariables || englishVariables.length !== translatedVariables.length)) {
				console.log(`'${key}' in file '${localeFile}' is missing variable(s), deleting it to regenerate...`)
				delete localeFileContent[key]
			}
		}
	}

	// Only regenerate keys that were modified in en.json and not yet updated
	if (modifiedEnKeys !== null) {
		const keysToRegenerate = getKeysNeedingRegeneration(modifiedEnKeys, localeFile, baseBranch)

		// Only delete existing translations for keys that need regeneration
		for (const key of Object.keys(keysToRegenerate)) {
			if (key in localeFileContent) {
				delete localeFileContent[key]
			}
		}
	}

	// Get missing translations
	const missingTranslations = Object.keys(englishReferenceContent).reduce((missing, key) => {
		if (!Object.prototype.hasOwnProperty.call(localeFileContent, key)) {
			// console.log(`Missing translation for key '${key}' in file '${localeFile}'`)
			missing[key] = englishReferenceContent[key]
		}
		return missing
	}, {})

	// Generate translations for missing keys
	if (Object.keys(missingTranslations).length > 0) {
		const generatedTranslation = await generateTranslation(
			englishReferenceContent,
			missingTranslations,
			targetLanguage,
			localeFileContent,
		)
		const generatedTranslationJson = JSON.parse(generatedTranslation)
		localeFileContent = {...localeFileContent, ...generatedTranslationJson}
	}

	// Sort keys
	const sortedLocaleContent = Object.keys(localeFileContent)
		.sort()
		.reduce((result, key) => {
			result[key] = localeFileContent[key]
			return result
		}, {})

	fs.writeFileSync(localeFilePath, JSON.stringify(sortedLocaleContent, null, 2), 'utf8')
}

async function checkAndGenerateTranslations(englishReferenceContent, modifiedEnKeys = null, baseBranch = null) {
	const localeFiles = fs.readdirSync(localesDirectory)
	const translationPromises = localeFiles.map((localeFile) =>
		generateAndWriteTranslations(englishReferenceContent, localeFile, modifiedEnKeys, baseBranch),
	)
	await Promise.all(translationPromises)
}

async function start() {
	let englishReferenceContent = JSON.parse(fs.readFileSync(englishReferenceFilePath, 'utf8'))
	await removeUnusedTranslations(englishReferenceContent)
	// Reload content as ununsed keys might have been removed
	englishReferenceContent = JSON.parse(fs.readFileSync(englishReferenceFilePath, 'utf8'))

	// Check if we're in CI with a base branch for regeneration
	const baseBranch = process.env.GITHUB_BASE_REF
	const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'

	if (isCI && baseBranch) {
		console.log(`Running in CI mode with base branch: ${baseBranch}`)

		// Get base en.json and find modified keys
		const baseEnglishContent = getBaseEnglishContent(baseBranch)

		if (baseEnglishContent) {
			const modifiedKeys = getModifiedKeys(englishReferenceContent, baseEnglishContent)
			const modifiedKeysCount = Object.keys(modifiedKeys).length

			if (modifiedKeysCount > 0) {
				console.log(`Found ${modifiedKeysCount} modified/added keys in en.json`)
				// Only regenerate keys that were modified and not yet translated
				await checkAndGenerateTranslations(englishReferenceContent, modifiedKeys, baseBranch)
			} else {
				console.log('No keys modified in en.json compared to base branch')
			}
		} else {
			console.log('Could not get base en.json, falling back to standard regeneration')
			await checkAndGenerateTranslations(englishReferenceContent)
		}
	} else {
		console.log('Running in local/manual mode - regenerating all missing translations')
		await checkAndGenerateTranslations(englishReferenceContent)
	}
}

start()
