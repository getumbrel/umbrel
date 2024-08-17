import i18next from 'i18next'
import {map} from 'remeda'
import {arrayIncludes} from 'ts-extras'

export function useLanguage() {
	const setCode = (code: SupportedLanguageCode) => {
		localStorage.setItem('i18nextLng', code)
		window.location.reload()
	}

  	// Retrieve the language code from localStorage if available
  	const storedCode = localStorage.getItem('i18nextLng') as SupportedLanguageCode | null
	
	// Default to English if the code is not supported
  	const code = storedCode || i18next.language
	
	if (!arrayIncludes(supportedLanguageCodes, code)) {
		return ['en', setCode] as const
	}

	// Return `as const` so it's typed as a tuple
	return [code, setCode] as const
}

// TODO: consider moving to `@/utils`
export const languages = [
	{name: 'English', code: 'en'},
	{name: 'Deutsch', code: 'de'},
	{name: 'Español', code: 'es'},
	{name: 'Français', code: 'fr'},
	{name: 'Italiano', code: 'it'},
	{name: 'Magyar', code: 'hu'},
	{name: 'Nederlands', code: 'nl'},
	{name: 'Português', code: 'pt'},
	{name: 'Українська', code: 'uk'},
	{name: 'Türkçe', code: 'tr'},
	{name: '日本語', code: 'ja'},
] as const

const supportedLanguageCodes = map(languages, (entry) => entry.code)

export type SupportedLanguageCode = (typeof supportedLanguageCodes)[number]
