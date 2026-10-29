// Cell values and Excel's coercion rules: how text becomes a number, how a
// number prints as text, and how values of mixed types compare.

import {serialFromParts} from './dates'

export type ErrorCode = '#DIV/0!' | '#N/A' | '#NAME?' | '#NULL!' | '#NUM!' | '#REF!' | '#VALUE!' | '#SPILL!' | '#CALC!'
export type FormulaError = {readonly error: ErrorCode}
// null is an empty cell
export type Value = number | string | boolean | null | FormulaError

const error = (code: ErrorCode): FormulaError => Object.freeze({error: code})
export const Errors = {
	div0: error('#DIV/0!'),
	na: error('#N/A'),
	name: error('#NAME?'),
	null: error('#NULL!'),
	num: error('#NUM!'),
	ref: error('#REF!'),
	value: error('#VALUE!'),
	spill: error('#SPILL!'),
	calc: error('#CALC!'),
} as const

const ERROR_BY_CODE = new Map<string, FormulaError>(Object.values(Errors).map((e) => [e.error, e]))
// Codes are matched case-insensitively, as Excel does when they're typed
export const errorFromCode = (code: string): FormulaError | undefined => ERROR_BY_CODE.get(code.toUpperCase())

// Also tells errors apart from the references, arrays and grids that functions pass around
export const isError = (value: unknown): value is FormulaError =>
	typeof value === 'object' && value !== null && 'error' in value

// The longest text a cell holds; results past it are #VALUE!, which also keeps
// REPT and friends from building strings a hostile file asks for
export const MAX_TEXT = 32767
export const text = (value: string): string | FormulaError => (value.length > MAX_TEXT ? Errors.value : value)

// Excel prints numbers in formulas (`&`, LEN, TEXTJOIN...) with up to 15
// significant digits, switching to scientific notation like C's %.15G
export function numberToText(n: number): string {
	if (n === 0) return '0'
	const exponential = n.toExponential(14)
	const e = exponential.indexOf('e')
	const exponent = Number(exponential.slice(e + 1))
	if (exponent < -4 || exponent >= 15) {
		const sign = exponent < 0 ? '-' : '+'
		return `${stripZeros(exponential.slice(0, e))}E${sign}${String(Math.abs(exponent)).padStart(2, '0')}`
	}
	return stripZeros(n.toFixed(14 - exponent))
}

const stripZeros = (fixed: string) => (fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed)

// Excel keeps 15 significant digits of a typed number and zeroes the rest
// (1234567890123456789 is stored as 1234567890123450000)
export function decimalToNumber(digits: string, fraction: string, exponent: number): number {
	const all = digits + fraction
	let first = 0
	while (first < all.length && all.charCodeAt(first) === 48) first++
	const kept = all.length - first > 15 ? all.slice(0, first + 15).padEnd(all.length, '0') : all
	return Number(`${kept.slice(0, digits.length) || '0'}.${kept.slice(digits.length) || '0'}e${exponent}`)
}

export type InputKind = 'number' | 'percent' | 'currency' | 'date' | 'time' | 'datetime'

const NUMBER = /^([+-]?)(\$?)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?(%?)$/
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?: ?([AaPp])[Mm])?$/

// Text as Excel reads it into a number, both for typed input and for text used
// where a number is needed ("3" + 1): plain and grouped numbers, exponents,
// percentages, a leading $, ISO dates and times. Locale-dependent forms like
// 1/2/2026 stay text, since nothing in the file says which order they're in.
export function parseNumber(input: string, date1904: boolean): {value: number; kind: InputKind} | undefined {
	const s = trimSpaces(input)
	if (s === '') return undefined
	const number = NUMBER.exec(s)
	if (number) {
		const [, sign, currency, digits, fraction = '', exponent = '0', percent] = number
		if (digits === '' && fraction === '') return undefined
		let value = decimalToNumber(digits.replaceAll(',', ''), fraction, Number(exponent))
		if (percent) value /= 100
		if (!Number.isFinite(value)) return undefined
		// 0 - value, not -value, so "-0" is stored as 0
		return {value: sign === '-' ? 0 - value : value, kind: percent ? 'percent' : currency ? 'currency' : 'number'}
	}
	const date = ISO_DATE.exec(s)
	if (date) {
		const [, year, month, day, rest] = date
		const serial = dateSerial(Number(year), Number(month), Number(day), date1904)
		if (serial === undefined) return undefined
		if (rest === undefined) return {value: serial, kind: 'date'}
		const time = timeFraction(rest)
		return time === undefined ? undefined : {value: serial + time, kind: 'datetime'}
	}
	const time = timeFraction(s)
	return time === undefined ? undefined : {value: time, kind: 'time'}
}

function trimSpaces(s: string) {
	let start = 0
	let end = s.length
	while (start < end && s.charCodeAt(start) === 32) start++
	while (end > start && s.charCodeAt(end - 1) === 32) end--
	return s.slice(start, end)
}

function dateSerial(year: number, month: number, day: number, date1904: boolean): number | undefined {
	if (year < (date1904 ? 1904 : 1900) || month < 1 || month > 12 || day < 1) return undefined
	const serial = serialFromParts(year, month, day, date1904)
	// Rejects 2026-02-30 instead of rolling it into March
	return serialFromParts(year, month + 1, 1, date1904) > serial ? serial : undefined
}

function timeFraction(s: string): number | undefined {
	const time = TIME.exec(s)
	if (!time) return undefined
	const [, h, m, sec = '0', ms = '', meridiem] = time
	let hours = Number(h)
	const minutes = Number(m)
	const seconds = Number(sec) + (ms ? Number(`0.${ms}`) : 0)
	if (minutes > 59 || seconds >= 60) return undefined
	if (meridiem) {
		if (hours < 1 || hours > 12) return undefined
		hours = (hours % 12) + (meridiem === 'p' || meridiem === 'P' ? 12 : 0)
	} else if (hours > 23) return undefined
	return (hours * 3600 + minutes * 60 + seconds) / 86400
}

export type Coercion = {readonly date1904: boolean}

export function toNumber(value: Value, cx: Coercion): number | FormulaError {
	switch (typeof value) {
		case 'number':
			return value
		case 'boolean':
			return value ? 1 : 0
		case 'string':
			return parseNumber(value, cx.date1904)?.value ?? Errors.value
		default:
			return value ?? 0
	}
}

export function toText(value: Value): string | FormulaError {
	switch (typeof value) {
		case 'string':
			return value
		case 'number':
			return numberToText(value)
		case 'boolean':
			return value ? 'TRUE' : 'FALSE'
		default:
			return value ?? ''
	}
}

export function toBoolean(value: Value): boolean | FormulaError {
	switch (typeof value) {
		case 'boolean':
			return value
		case 'number':
			return value !== 0
		case 'string': {
			const upper = value.toUpperCase()
			return upper === 'TRUE' ? true : upper === 'FALSE' ? false : Errors.value
		}
		default:
			return value ?? false
	}
}

// Excel's = treats numbers within about 15 significant digits as equal
// (0.1 + 0.2 = 0.3 is TRUE). This is LibreOffice's rtl::math::approxEqual.
const EPSILON = 2 ** -48
export function approxEqual(a: number, b: number): boolean {
	if (a === b) return true
	if (a === 0 || b === 0 || (Number.isSafeInteger(a) && Number.isSafeInteger(b))) return false
	const d = Math.abs(a - b)
	return d <= Math.abs(a) * EPSILON && d <= Math.abs(b) * EPSILON
}

// Text compares case-insensitively but accent-sensitively; the collator orders
// punctuation before digits before letters, close to Excel's sort order
const collator = new Intl.Collator('en', {sensitivity: 'accent'})
export const textEqual = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase()
export function compareText(a: string, b: string): number {
	if (a === b) return 0
	const la = a.toLowerCase()
	const lb = b.toLowerCase()
	if (la === lb) return 0
	return collator.compare(la, lb) || (la < lb ? -1 : 1)
}

const typeRank = (value: number | string | boolean) =>
	typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2

// Orders two non-error values like Excel's comparison operators: numbers before
// text before booleans, and an empty cell as 0, "" or FALSE to match the other side
export function compareValues(a: Exclude<Value, FormulaError>, b: Exclude<Value, FormulaError>): number {
	if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
	if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
	const ta = typeRank(a)
	const tb = typeRank(b)
	if (ta !== tb) return ta - tb
	if (ta === 0) return approxEqual(a as number, b as number) ? 0 : (a as number) < (b as number) ? -1 : 1
	if (ta === 1) return compareText(a as string, b as string)
	return Number(a) - Number(b)
}

// The value rounded to the 15 significant digits Excel displays; rounding
// functions work on this, which is why ROUND(2.15, 1) is 2.2 although the
// double is 2.1499999999999999
export const significant15 = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(15)) : n)
