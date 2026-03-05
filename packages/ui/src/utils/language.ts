import {map} from 'remeda'

export const languages = [
	{name: 'English', code: 'en'},
	{name: 'Deutsch', code: 'de'},
	{name: 'Español', code: 'es'},
	{name: 'Français', code: 'fr'},
	{name: 'Italiano', code: 'it'},
	{name: '한국어', code: 'ko'},
	{name: 'Magyar', code: 'hu'},
	{name: 'Nederlands', code: 'nl'},
	{name: 'Português', code: 'pt'},
	{name: 'Українська', code: 'uk'},
	{name: 'Türkçe', code: 'tr'},
	{name: '日本語', code: 'ja'},
] as const

export const supportedLanguageCodes = map(languages, (entry) => entry.code)

export type SupportedLanguageCode = (typeof supportedLanguageCodes)[number]
