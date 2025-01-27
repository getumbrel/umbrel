import {format, formatRelative, isToday, isYesterday, parseISO} from 'date-fns'

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
export function formatFilesystemDate(date: string | Date | undefined, languageCode: SupportedLanguageCode): string {
	if (!date) return ''

	try {
		const dateObj = typeof date === 'string' ? parseISO(date) : date
		const locale = languageCodeToDateLocale[languageCode]

		if (isToday(dateObj) || isYesterday(dateObj)) {
			return capitalize(formatRelative(dateObj, new Date(), {locale}))
		}
		return format(dateObj, 'PPp', {locale}) // Shows "Mar 14, 2024 11:24 AM"
	} catch {
		return ''
	}
}
