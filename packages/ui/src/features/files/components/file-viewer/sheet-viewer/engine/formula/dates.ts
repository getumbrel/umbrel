// Date serial numbers. In the 1900 system serial 1 is 1900-01-01 and, copying
// a Lotus 1-2-3 bug, serial 60 is the 29th of February 1900, a day that never
// existed, so every serial from 61 (1900-03-01) on is one more than the true
// day count. In the 1904 system (old Mac workbooks) serial 0 is 1904-01-01.

// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm)
function daysFromCivil(year: number, month: number, day: number): number {
	const y = month <= 2 ? year - 1 : year
	const era = Math.floor(y / 400)
	const yearOfEra = y - era * 400
	const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
	const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
	return era * 146097 + dayOfEra - 719468
}

function civilFromDays(days: number): [year: number, month: number, day: number] {
	const z = days + 719468
	const era = Math.floor(z / 146097)
	const dayOfEra = z - era * 146097
	const yearOfEra = Math.floor(
		(dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
	)
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
	const mp = Math.floor((5 * dayOfYear + 2) / 153)
	const month = mp < 10 ? mp + 3 : mp - 9
	return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, dayOfYear - Math.floor((153 * mp + 2) / 5) + 1]
}

const EPOCH_1900 = daysFromCivil(1899, 12, 30)
const EPOCH_1904 = daysFromCivil(1904, 1, 1)

// 9999-12-31, the last day Excel accepts
export const maxSerial = (date1904: boolean) => daysFromCivil(9999, 12, 31) - (date1904 ? EPOCH_1904 : EPOCH_1900)

// Month and day roll over like Excel's DATE: month 14 is February of the next
// year, day 0 the last day of the previous month. The result may be out of range.
export function serialFromParts(year: number, month: number, day: number, date1904: boolean): number {
	year += Math.floor((month - 1) / 12)
	month = ((((month - 1) % 12) + 12) % 12) + 1
	if (date1904) return daysFromCivil(year, month, 1) - EPOCH_1904 + day - 1
	const first = daysFromCivil(year, month, 1) - EPOCH_1900
	// Before March 1900 the phantom leap day hasn't happened yet
	return (first < 61 ? first - 1 : first) + day - 1
}

// The calendar date of a serial (its whole days), or undefined when Excel would say #NUM!
export function partsFromSerial(
	serial: number,
	date1904: boolean,
): [year: number, month: number, day: number] | undefined {
	const days = Math.floor(serial)
	if (!(days >= 0 && days <= maxSerial(date1904))) return undefined
	if (date1904) return civilFromDays(EPOCH_1904 + days)
	if (days === 0) return [1900, 1, 0]
	if (days === 60) return [1900, 2, 29]
	return civilFromDays(EPOCH_1900 + (days < 60 ? days + 1 : days))
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export function daysInMonth(year: number, month: number, date1904: boolean): number {
	if (month !== 2) return MONTH_DAYS[month - 1]
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
	return leap || (year === 1900 && !date1904) ? 29 : 28
}

// 0 = Sunday. Serials before March 1900 follow Excel's calendar, which makes
// 1900-01-01 a Sunday although it was a Monday.
export const weekday = (serial: number, date1904: boolean) => (Math.floor(serial) + (date1904 ? 1462 : 0) + 6) % 7

// Seconds into the day, rounded to the nearest second like HOUR/MINUTE/SECOND
export function secondOfDay(serial: number): number {
	const seconds = Math.round((serial - Math.floor(serial)) * 86400)
	return seconds === 86400 ? 0 : seconds
}

export function serialFromDate(date: Date, date1904: boolean): number {
	const day = serialFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate(), date1904)
	const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000
	return day + seconds / 86400
}
