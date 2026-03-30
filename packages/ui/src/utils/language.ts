import {map} from 'remeda'

export const languages = [
	// English (default)
	{name: 'English', code: 'en', glyph: 'A', englishName: 'English'},
	// Latin script — alphabetical by native name
	{name: 'Čeština', code: 'cs', glyph: 'Č', englishName: 'Czech'},
	{name: 'Dansk', code: 'da', glyph: 'Æ', englishName: 'Danish'},
	{name: 'Deutsch', code: 'de', glyph: 'ß', englishName: 'German'},
	{name: 'Eesti', code: 'et', glyph: 'Õ', englishName: 'Estonian'},
	{name: 'Español', code: 'es', glyph: 'Ñ', englishName: 'Spanish'},
	{name: 'Français', code: 'fr', glyph: 'É', englishName: 'French'},
	{name: 'Hrvatski', code: 'hr', glyph: 'Š', englishName: 'Croatian'},
	{name: 'Íslenska', code: 'is', glyph: 'Þ', englishName: 'Icelandic'},
	{name: 'Italiano', code: 'it', glyph: 'À', englishName: 'Italian'},
	{name: 'Magyar', code: 'hu', glyph: 'Ő', englishName: 'Hungarian'},
	{name: 'Nederlands', code: 'nl', glyph: 'Ĳ', englishName: 'Dutch'},
	{name: 'Norsk bokmål', code: 'nb', glyph: 'Ø', englishName: 'Norwegian'},
	{name: 'Polski', code: 'pl', glyph: 'Ł', englishName: 'Polish'},
	{name: 'Português', code: 'pt', glyph: 'Ã', englishName: 'Portuguese'},
	{name: 'Português (Brasil)', code: 'pt-BR', glyph: 'Ç', englishName: 'Brazilian Portuguese'},
	{name: 'Română', code: 'ro', glyph: 'Ș', englishName: 'Romanian'},
	{name: 'Slovenčina', code: 'sk', glyph: 'Ľ', englishName: 'Slovak'},
	{name: 'Slovenščina', code: 'sl', glyph: 'Ž', englishName: 'Slovenian'},
	{name: 'Svenska', code: 'sv', glyph: 'Å', englishName: 'Swedish'},
	{name: 'Türkçe', code: 'tr', glyph: 'Ğ', englishName: 'Turkish'},
	// Cyrillic script
	{name: 'Български', code: 'bg', glyph: 'Б', englishName: 'Bulgarian'},
	{name: 'Русский', code: 'ru', glyph: 'Я', englishName: 'Russian'},
	{name: 'Українська', code: 'uk', glyph: 'Ї', englishName: 'Ukrainian'},
	// Greek script
	{name: 'Ελληνικά', code: 'el', glyph: 'Ω', englishName: 'Greek'},
	// CJK & Korean
	{name: '中文', code: 'zh', glyph: '文', englishName: 'Chinese'},
	{name: '繁體中文', code: 'zh-TW', glyph: '繁', englishName: 'Traditional Chinese'},
	{name: '日本語', code: 'ja', glyph: 'あ', englishName: 'Japanese'},
	{name: '한국어', code: 'ko', glyph: '한', englishName: 'Korean'},
] as const

export const supportedLanguageCodes = map(languages, (entry) => entry.code)

export type SupportedLanguageCode = (typeof supportedLanguageCodes)[number]
