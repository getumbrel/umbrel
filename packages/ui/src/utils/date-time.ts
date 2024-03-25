import {formatDistance, Locale} from 'date-fns'
import {de, enUS, es, fr, it, ja, nl, pt, uk} from 'date-fns/locale'

import {UNKNOWN} from '@/constants'
import {SupportedLanguageCode} from '@/hooks/use-language'

export const MS_PER_SECOND: number = 1000
export const MS_PER_MINUTE: number = MS_PER_SECOND * 60
export const MS_PER_HOUR: number = MS_PER_MINUTE * 60

const langCodeToDateLocale: Record<SupportedLanguageCode, Locale> = {
	en: enUS,
	de: de,
	es: es,
	fr: fr,
	it: it,
	nl: nl,
	pt: pt,
	uk: uk,
	ja: ja,
}

export function duration(seconds: number | undefined, languageCode: SupportedLanguageCode) {
	if (seconds === undefined) return UNKNOWN()
	return formatDistance(0, seconds * 1000, {includeSeconds: true, locale: langCodeToDateLocale[languageCode]})
}
