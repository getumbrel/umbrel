import {formatDistance, Locale} from 'date-fns'
import {de, enUS, es, fr, it, ja, nl, pt} from 'date-fns/locale'

import {UNKNOWN} from '@/constants'
import {SupportedLanguageCode} from '@/hooks/use-language'

const langCodeToDateLocale: Record<SupportedLanguageCode, Locale> = {
	en: enUS,
	de: de,
	es: es,
	fr: fr,
	it: it,
	nl: nl,
	pt: pt,
	ja: ja,
}

export function duration(seconds: number | undefined, languageCode: SupportedLanguageCode) {
	if (seconds === undefined) return UNKNOWN()
	return formatDistance(0, seconds * 1000, {includeSeconds: true, locale: langCodeToDateLocale[languageCode]})
}
