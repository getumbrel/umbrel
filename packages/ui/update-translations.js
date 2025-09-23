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
async function generateAndWriteTranslations(englishReferenceContent, localeFile) {
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

async function checkAndGenerateTranslations(englishReferenceContent) {
	const localeFiles = fs.readdirSync(localesDirectory)
	const translationPromises = localeFiles.map((localeFile) =>
		generateAndWriteTranslations(englishReferenceContent, localeFile),
	)
	await Promise.all(translationPromises)
}

async function start() {
	let englishReferenceContent = JSON.parse(fs.readFileSync(englishReferenceFilePath, 'utf8'))
	await removeUnusedTranslations(englishReferenceContent)
	// Reload content as ununsed keys might have been removed
	englishReferenceContent = JSON.parse(fs.readFileSync(englishReferenceFilePath, 'utf8'))
	checkAndGenerateTranslations(englishReferenceContent)
}

start()
