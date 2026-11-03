import {daysInMonth, maxSerial, partsFromSerial, secondOfDay, serialFromDate, serialFromParts, weekday} from '../dates'
import {eachValue, type Context, type Fn} from '../runtime'
import {Errors, isError, toNumber, type FormulaError, type Value} from '../values'
import {numbers, values} from './shared'

// A whole-day serial in range, or #NUM!
function day(value: Value, cx: Context): number | FormulaError {
	const n = toNumber(value, cx)
	if (isError(n)) return n
	const serial = Math.floor(n)
	return serial < 0 || serial > maxSerial(cx.date1904) ? Errors.num : serial
}

const checked = (serial: number, cx: Context) => (serial < 0 || serial > maxSerial(cx.date1904) ? Errors.num : serial)

const part = (index: 0 | 1 | 2): Fn =>
	values(1, 1, ([value], cx) => {
		const serial = day(value, cx)
		return isError(serial) ? serial : partsFromSerial(serial, cx.date1904)![index]
	})

const timePart = (unit: 'hour' | 'minute' | 'second'): Fn =>
	values(1, 1, ([value], cx) => {
		const n = toNumber(value, cx)
		if (isError(n)) return n
		if (n < 0 || n >= maxSerial(cx.date1904) + 1) return Errors.num
		const seconds = secondOfDay(n)
		return unit === 'hour'
			? Math.floor(seconds / 3600)
			: unit === 'minute'
				? Math.floor(seconds / 60) % 60
				: seconds % 60
	})

// Months later, the day kept or pulled back to the month's end (Jan 31 + 1 month is Feb 28)
function addMonths(serial: number, months: number, cx: Context, endOfMonth: boolean): number | FormulaError {
	const [year, month, dayOfMonth] = partsFromSerial(serial, cx.date1904)!
	const total = month - 1 + Math.trunc(months)
	const y = year + Math.floor(total / 12)
	const m = total - Math.floor(total / 12) * 12 + 1
	const d = endOfMonth ? daysInMonth(y, m, cx.date1904) : Math.min(dayOfMonth, daysInMonth(y, m, cx.date1904))
	return checked(serialFromParts(y, m, d, cx.date1904), cx)
}

// The weekday a WEEKDAY/WEEKNUM return type counts from (0 = Sunday)
function weekStart(type: number, forWeeknum: boolean): number | undefined {
	if (type === 1 || type === 17) return 0
	if (type === 2 || type === 11) return 1
	if (type >= 12 && type <= 16) return type - 10
	if (type === 3 && !forWeeknum) return 1
	return undefined
}

function isoWeek(serial: number, cx: Context): number {
	const monday = (weekday(serial, cx.date1904) + 6) % 7
	const thursday = serial - monday + 3
	const [year] = partsFromSerial(Math.max(0, thursday), cx.date1904)!
	return Math.floor((thursday - serialFromParts(year, 1, 1, cx.date1904)) / 7) + 1
}

function weekdays(from: number, to: number, cx: Context): number {
	const days = to - from + 1
	let count = Math.floor(days / 7) * 5
	for (let d = from + days - (days % 7); d <= to; d++) {
		const w = weekday(d, cx.date1904)
		if (w !== 0 && w !== 6) count++
	}
	return count
}

export const dateFunctions: Record<string, Fn> = {
	// Years 0-1899 count from 1900; month and day roll over (DATE(2008,14,2) is 2009-02-02)
	DATE: values(3, 3, (args, cx) => {
		const parts: number[] = []
		for (const arg of args) {
			const n = toNumber(arg, cx)
			if (isError(n)) return n
			parts.push(Math.trunc(n))
		}
		const [year, month, dayOfMonth] = parts
		if (year < 0 || year >= 10000) return Errors.num
		return checked(serialFromParts(year < 1900 ? year + 1900 : year, month, dayOfMonth, cx.date1904), cx)
	}),
	TIME: numbers(3, 3, (h, m, s) => {
		const [hours, minutes, seconds] = [Math.trunc(h), Math.trunc(m), Math.trunc(s)]
		if (hours > 32767 || minutes > 32767 || seconds > 32767) return Errors.num
		const total = hours * 3600 + minutes * 60 + seconds
		return total < 0 ? Errors.num : (total % 86400) / 86400
	}),
	YEAR: part(0),
	MONTH: part(1),
	DAY: part(2),
	HOUR: timePart('hour'),
	MINUTE: timePart('minute'),
	SECOND: timePart('second'),
	TODAY: {
		min: 0,
		max: 0,
		kinds: 's',
		volatile: true,
		call: (_args, cx) => Math.floor(serialFromDate(cx.now(), cx.date1904)),
	},
	NOW: {min: 0, max: 0, kinds: 's', volatile: true, call: (_args, cx) => serialFromDate(cx.now(), cx.date1904)},
	EDATE: values(2, 2, ([start, months], cx) => {
		const serial = day(start, cx)
		if (isError(serial)) return serial
		const n = toNumber(months, cx)
		return isError(n) ? n : addMonths(serial, n, cx, false)
	}),
	EOMONTH: values(2, 2, ([start, months], cx) => {
		const serial = day(start, cx)
		if (isError(serial)) return serial
		const n = toNumber(months, cx)
		return isError(n) ? n : addMonths(serial, n, cx, true)
	}),
	WEEKDAY: values(1, 2, ([value, type = 1], cx) => {
		const serial = day(value, cx)
		if (isError(serial)) return serial
		const kind = toNumber(type, cx)
		if (isError(kind)) return kind
		const start = weekStart(Math.trunc(kind), false)
		if (start === undefined) return Errors.num
		const offset = (weekday(serial, cx.date1904) - start + 7) % 7
		return Math.trunc(kind) === 3 ? offset : offset + 1
	}),
	// Week 1 holds January 1st; type 21 is the ISO week
	WEEKNUM: values(1, 2, ([value, type = 1], cx) => {
		const serial = day(value, cx)
		if (isError(serial)) return serial
		const kind = toNumber(type, cx)
		if (isError(kind)) return kind
		if (Math.trunc(kind) === 21) return isoWeek(serial, cx)
		const start = weekStart(Math.trunc(kind), true)
		if (start === undefined) return Errors.num
		const [year] = partsFromSerial(serial, cx.date1904)!
		const january1 = Math.max(0, serialFromParts(year, 1, 1, cx.date1904))
		const offset = (weekday(january1, cx.date1904) - start + 7) % 7
		return Math.floor((serial - january1 + offset) / 7) + 1
	}),
	DAYS: values(2, 2, ([end, start], cx) => {
		const to = day(end, cx)
		if (isError(to)) return to
		const from = day(start, cx)
		return isError(from) ? from : to - from
	}),
	// The undocumented DATEDIF, including its odd "MD" results that Excel warns about
	DATEDIF: values(3, 3, ([start, end, unit], cx) => {
		const from = day(start, cx)
		if (isError(from)) return from
		const to = day(end, cx)
		if (isError(to)) return to
		if (from > to) return Errors.num
		if (typeof unit !== 'string') return Errors.num
		const [sy, sm, sd] = partsFromSerial(from, cx.date1904)!
		const [ey, em, ed] = partsFromSerial(to, cx.date1904)!
		const months = (ey - sy) * 12 + em - sm - (ed < sd ? 1 : 0)
		switch (unit.toUpperCase()) {
			case 'D':
				return to - from
			case 'M':
				return months
			case 'Y':
				return Math.floor(months / 12)
			case 'YM':
				return months % 12
			case 'MD': {
				if (ed >= sd) return ed - sd
				const previous = em === 1 ? [ey - 1, 12] : [ey, em - 1]
				return ed + daysInMonth(previous[0], previous[1], cx.date1904) - sd
			}
			case 'YD': {
				let anniversary = serialFromParts(sy, em, ed, cx.date1904)
				if (anniversary < from) anniversary = serialFromParts(sy + 1, em, ed, cx.date1904)
				return anniversary - from
			}
		}
		return Errors.num
	}),
	// Monday to Friday from start to end inclusive, less holidays on weekdays; negative when end comes first
	NETWORKDAYS: {
		min: 2,
		max: 3,
		kinds: 'ssr',
		call: ([startArg, endArg, holidayArg], cx) => {
			const start = day(startArg as Value, cx)
			if (isError(start)) return start
			const end = day(endArg as Value, cx)
			if (isError(end)) return end
			const [from, to] = start <= end ? [start, end] : [end, start]
			const holidays = new Set<number>()
			if (holidayArg !== undefined && holidayArg !== null) {
				const failed = eachValue(holidayArg, cx, (value) => {
					if (typeof value === 'boolean') return Errors.value
					const serial = day(value, cx)
					if (isError(serial)) return serial
					holidays.add(serial)
				})
				if (failed) return failed
			}
			let count = weekdays(from, to, cx)
			for (const holiday of holidays) {
				const w = weekday(holiday, cx.date1904)
				if (holiday >= from && holiday <= to && w !== 0 && w !== 6) count--
			}
			return start <= end ? count : -count
		},
	},
}
