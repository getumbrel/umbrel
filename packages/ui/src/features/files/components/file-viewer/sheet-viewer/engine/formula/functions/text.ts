// Text functions count UTF-16 code units, as Excel does (LEN of an emoji is 2)

import {formatNumber} from '../../xlsx/number-format'
import {compileWildcard, wildcardSearch} from '../criteria'
import {Areas, checkSize, gridOf, integer, isMatrix, Ref, type Context, type Fn, type Result} from '../runtime'
import {Errors, isError, MAX_TEXT, parseNumber, text, toBoolean, toText, type FormulaError, type Value} from '../values'
import {values} from './shared'

// Coerces every argument to text, the first error winning
const texts = (min: number, max: number, f: (args: string[]) => Value): Fn =>
	values(min, max, (args) => {
		const strings: string[] = []
		for (const arg of args) {
			const s = toText(arg)
			if (isError(s)) return s
			strings.push(s)
		}
		return f(strings)
	})

// Every cell of a reference or array, empty ones as null, row by row
function eachCell(arg: Result, cx: Context, visit: (value: Value) => FormulaError | void): FormulaError | undefined {
	if (!(arg instanceof Ref) && !(arg instanceof Areas) && !isMatrix(arg)) return visit(arg) || undefined
	const grid = gridOf(arg, cx)
	if (isError(grid)) return grid
	checkSize(grid.rows, grid.cols)
	for (let r = 0; r < grid.rows; r++) {
		for (let c = 0; c < grid.cols; c++) {
			const failed = visit(grid.get(r, c))
			if (failed) return failed
		}
	}
	return undefined
}

function find(caseSensitive: boolean): Fn {
	return values(2, 3, ([needle, haystack, start = 1], cx) => {
		const pattern = toText(needle)
		if (isError(pattern)) return pattern
		const within = toText(haystack)
		if (isError(within)) return within
		const from = integer(start, cx)
		if (isError(from)) return from
		if (from < 1 || from > within.length) return Errors.value
		const at = caseSensitive
			? within.indexOf(pattern, from - 1)
			: wildcardSearch(within, compileWildcard(pattern), from - 1)
		return at < 0 ? Errors.value : at + 1
	})
}

export const textFunctions: Record<string, Fn> = {
	LEN: texts(1, 1, ([s]) => s.length),
	UPPER: texts(1, 1, ([s]) => s.toUpperCase()),
	LOWER: texts(1, 1, ([s]) => s.toLowerCase()),
	// The first letter of every run of letters capitalised, the rest lowered
	PROPER: texts(1, 1, ([s]) =>
		s
			.toLowerCase()
			.replace(/(^|[^\p{L}])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()),
	),
	// Only the space character: runs collapse to one, ends are trimmed
	TRIM: texts(1, 1, ([s]) => s.replace(/ +/g, ' ').replace(/^ | $/g, '')),
	// The control characters 0-31
	CLEAN: texts(1, 1, ([s]) => {
		let out = ''
		for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 32) out += s[i]
		return out
	}),
	EXACT: texts(2, 2, ([a, b]) => a === b),
	LEFT: values(1, 2, ([value, count = 1], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const n = integer(count, cx)
		if (isError(n)) return n
		return n < 0 ? Errors.value : s.slice(0, n)
	}),
	RIGHT: values(1, 2, ([value, count = 1], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const n = integer(count, cx)
		if (isError(n)) return n
		return n < 0 ? Errors.value : n === 0 ? '' : s.slice(-n)
	}),
	MID: values(3, 3, ([value, start, count], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const from = integer(start, cx)
		if (isError(from)) return from
		const n = integer(count, cx)
		if (isError(n)) return n
		return from < 1 || n < 0 ? Errors.value : s.slice(from - 1, from - 1 + n)
	}),
	REPT: values(2, 2, ([value, times], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const n = integer(times, cx)
		if (isError(n)) return n
		if (n < 0 || s.length * n > MAX_TEXT) return Errors.value
		return s === '' ? '' : s.repeat(n)
	}),
	SUBSTITUTE: values(3, 4, ([value, old, replacement, instance], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const from = toText(old)
		if (isError(from)) return from
		const to = toText(replacement)
		if (isError(to)) return to
		if (instance === undefined) return from === '' ? s : text(s.replaceAll(from, to))
		const nth = integer(instance, cx)
		if (isError(nth)) return nth
		if (nth < 1) return Errors.value
		if (from === '') return s
		let at = -from.length
		for (let k = 0; k < nth; k++) {
			at = s.indexOf(from, at + from.length)
			if (at < 0) return s
		}
		return text(s.slice(0, at) + to + s.slice(at + from.length))
	}),
	REPLACE: values(4, 4, ([value, start, count, replacement], cx) => {
		const s = toText(value)
		if (isError(s)) return s
		const from = integer(start, cx)
		if (isError(from)) return from
		const n = integer(count, cx)
		if (isError(n)) return n
		const to = toText(replacement)
		if (isError(to)) return to
		if (from < 1 || n < 0) return Errors.value
		return text(s.slice(0, from - 1) + to + s.slice(from - 1 + n))
	}),
	FIND: find(true),
	// Case-insensitive, with wildcards
	SEARCH: find(false),
	CONCATENATE: texts(1, 255, (strings) => text(strings.join(''))),
	// Ranges joined row by row
	CONCAT: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			let out = ''
			for (const arg of args) {
				const failed = eachCell(arg, cx, (value) => {
					const s = toText(value)
					if (isError(s)) return s
					out += s
					if (out.length > MAX_TEXT) return Errors.value
				})
				if (failed) return failed
			}
			return out
		},
	},
	// The delimiter can itself be a range, used in turn
	TEXTJOIN: {
		min: 3,
		max: 255,
		kinds: 'rsr',
		call: ([delimiter, ignoreEmpty, ...args], cx) => {
			const delimiters: string[] = []
			const failed = eachCell(delimiter, cx, (value) => {
				const s = toText(value)
				if (isError(s)) return s
				delimiters.push(s)
			})
			if (failed) return failed
			const skip = toBoolean(ignoreEmpty as Value)
			if (isError(skip)) return skip
			let out = ''
			let count = 0
			for (const arg of args) {
				const failed = eachCell(arg, cx, (value) => {
					const s = toText(value)
					if (isError(s)) return s
					if (skip && s === '') return
					if (count > 0) out += delimiters.length ? delimiters[(count - 1) % delimiters.length] : ''
					out += s
					count++
					if (out.length > MAX_TEXT) return Errors.value
				})
				if (failed) return failed
			}
			return out
		},
	},
	VALUE: values(1, 1, ([value], cx) => {
		if (typeof value === 'number' || isError(value)) return value
		if (value === null) return 0
		if (typeof value === 'boolean') return Errors.value
		return parseNumber(value, cx.date1904)?.value ?? Errors.value
	}),
	// The grid's own number formatter, so TEXT agrees with what cells display. Numbers and
	// text that reads as one are formatted; other text only meets the format's text section.
	TEXT: values(2, 2, ([value, format], cx) => {
		if (isError(value)) return value
		const code = toText(format)
		if (isError(code)) return code
		if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
		const input = typeof value === 'string' ? (parseNumber(value, cx.date1904)?.value ?? value) : (value ?? 0)
		const {text: formatted, fill} = formatNumber(input, code, {date1904: cx.date1904})
		// A date it can't show (negative, or past 9999) comes back as a fill of #
		if (formatted === '#' && fill?.char === '#' && fill.index === 0) return Errors.value
		return text(formatted)
	}),
}
