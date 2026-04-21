import {formatDistanceStrict, Locale} from 'date-fns'
import {
	bg,
	cs,
	da,
	de,
	el,
	enUS,
	es,
	et,
	fr,
	hr,
	hu,
	is,
	it,
	ja,
	ko,
	nb,
	nl,
	pl,
	pt,
	ptBR,
	ro,
	ru,
	sk,
	sl,
	sv,
	tr,
	uk,
	zhCN,
	zhTW,
} from 'date-fns/locale'

import {UNKNOWN} from '@/constants'
import {SupportedLanguageCode} from '@/utils/language'

export const MS_PER_SECOND: number = 1000
export const MS_PER_MINUTE: number = MS_PER_SECOND * 60
export const MS_PER_HOUR: number = MS_PER_MINUTE * 60

export const languageCodeToDateLocale: Record<SupportedLanguageCode, Locale> = {
	en: enUS,
	de: de,
	es: es,
	fr: fr,
	it: it,
	hu: hu,
	nl: nl,
	pt: pt,
	uk: uk,
	tr: tr,
	ja: ja,
	ko: ko,
	zh: zhCN,
	ru: ru,
	sv: sv,
	pl: pl,
	cs: cs,
	da: da,
	nb: nb,
	ro: ro,
	el: el,
	bg: bg,
	hr: hr,
	sk: sk,
	sl: sl,
	et: et,
	is: is,
	'pt-BR': ptBR,
	'zh-TW': zhTW,
}

export function duration(seconds: number | undefined, languageCode: SupportedLanguageCode) {
	if (seconds === undefined) return UNKNOWN()

	// if duration is more than 7 days, then force
	// to show duration in days instead of months
	if (seconds > 7 * 24 * 60 * 60) {
		return formatDistanceStrict(0, seconds * 1000, {unit: 'day', locale: languageCodeToDateLocale[languageCode]})
	}
	return formatDistanceStrict(0, seconds * 1000, {locale: languageCodeToDateLocale[languageCode]})
}
