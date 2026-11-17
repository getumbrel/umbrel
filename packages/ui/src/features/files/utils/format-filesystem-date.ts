import {format, formatRelative, isToday, isYesterday} from 'date-fns'

import {languageCodeToDateLocale} from '@/utils/date-time'
import {SupportedLanguageCode} from '@/utils/language'

// Capitalizes the first letter of a string
function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1)
}

// Formats a date string or Date object into a user-friendly format
// Returns:
// - "Today at 1:15 AM" for today's dates
// - "Yesterday at 10:14 AM" for yesterday's dates
// - "Mar 14, 2024 11:24 AM" for older dates
export function formatFilesystemDate(date: number | undefined, languageCode: SupportedLanguageCode): string {
	if (!date) return ''

	try {
		const dateObj = new Date(date)
		const locale = languageCodeToDateLocale[languageCode]

		if (isToday(dateObj) || isYesterday(dateObj)) {
			return capitalize(formatRelative(dateObj, new Date(), {locale}))
		}
		return format(dateObj, 'PPp', {locale}) // Shows "Mar 14, 2024 11:24 AM"
	} catch {
		return ''
	}
}

// Formats date without time (always absolute), e.g. "Mar 14, 2024"
// e.g., we use this for Rewind feature stickers to show just the date
export function formatFilesystemDateOnly(date: number | undefined, languageCode: SupportedLanguageCode): string {
	if (!date) return ''
	try {
		const dateObj = new Date(date)
		const locale = languageCodeToDateLocale[languageCode]
		return format(dateObj, 'PP', {locale})
	} catch {
		return ''
	}
}

// A date as short as it can be said, for where a row has no room for more:
// - "Today at 1:15 AM" and "Yesterday at 10:14 AM", as above
// - "Mar 14" for the rest of this year
// - "Mar 14, 2024" for any other
export function formatFilesystemDateShort(date: number | undefined, languageCode: SupportedLanguageCode): string {
	if (!date) return ''

	try {
		const dateObj = new Date(date)
		if (isToday(dateObj) || isYesterday(dateObj)) {
			return capitalize(formatRelative(dateObj, new Date(), {locale: languageCodeToDateLocale[languageCode]}))
		}
		const sameYear = dateObj.getFullYear() === new Date().getFullYear()
		return new Intl.DateTimeFormat(languageCode, {
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : {year: 'numeric'}),
		}).format(dateObj)
	} catch {
		return formatFilesystemDateOnly(date, languageCode)
	}
}
