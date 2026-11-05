// Criteria for the *IF(S) functions (">=10", "<>x", "a*") and Excel's
// wildcards, which SEARCH, MATCH, VLOOKUP and XLOOKUP share.

import {
	approxEqual,
	compareText,
	errorFromCode,
	isError,
	parseNumber,
	textEqual,
	type Coercion,
	type Value,
} from './values'

// * matches any run of characters, ? one character, ~ escapes the next * ? or ~.
// Kept as the literal segments between stars, with -1 standing for ?, so
// matching is linear-ish: there is no backtracking for a hostile pattern to exploit.
export type Wildcard = {segments: number[][]}

export const hasWildcards = (pattern: string) => /[*?~]/.test(pattern)

export function compileWildcard(pattern: string): Wildcard {
	const lower = pattern.toLowerCase()
	const segments: number[][] = [[]]
	for (let i = 0; i < lower.length; i++) {
		const c = lower.charCodeAt(i)
		const next = lower.charCodeAt(i + 1)
		if (c === 126 && (next === 42 || next === 63 || next === 126)) {
			segments.at(-1)!.push(next)
			i++
		} else if (c === 42) segments.push([])
		else segments.at(-1)!.push(c === 63 ? -1 : c)
	}
	return {segments}
}

function matchesAt(text: string, at: number, segment: number[]) {
	for (let k = 0; k < segment.length; k++) {
		if (segment[k] !== -1 && text.charCodeAt(at + k) !== segment[k]) return false
	}
	return true
}

function find(text: string, segment: number[], from: number, end: number) {
	for (let i = from; i + segment.length <= end; i++) if (matchesAt(text, i, segment)) return i
	return -1
}

// Whether the whole text matches. Every segment between stars can take its
// leftmost fit, since a later fit never leaves more room for the rest.
export function wildcardMatch(text: string, {segments}: Wildcard): boolean {
	const lower = text.toLowerCase()
	const first = segments[0]
	if (segments.length === 1) return lower.length === first.length && matchesAt(lower, 0, first)
	const last = segments[segments.length - 1]
	const end = lower.length - last.length
	if (end < first.length || !matchesAt(lower, 0, first) || !matchesAt(lower, end, last)) return false
	let position = first.length
	for (let k = 1; k < segments.length - 1; k++) {
		const at = find(lower, segments[k], position, end)
		if (at < 0) return false
		position = at + segments[k].length
	}
	return true
}

// Where the earliest match starts at or after `from`, or -1
export function wildcardSearch(text: string, {segments}: Wildcard, from: number): number {
	const lower = text.toLowerCase()
	const [first, ...rest] = segments
	const start = find(lower, first, from, lower.length)
	if (start < 0) return -1
	// If the remaining segments don't fit after the earliest start, they fit after no later one
	let position = start + first.length
	for (const segment of rest) {
		const at = find(lower, segment, position, lower.length)
		if (at < 0) return -1
		position = at + segment.length
	}
	return start
}

export type Criterion = (value: Value) => boolean

// A number criterion also matches text that reads as that number (COUNTIF's
// well-known habit), but only for = and <>
const numberIn = (value: Value, cx: Coercion) =>
	typeof value === 'number' ? value : typeof value === 'string' ? parseNumber(value, cx.date1904)?.value : undefined

const OPERATORS = ['<=', '>=', '<>', '<', '>', '=']

export function criterion(arg: Value, cx: Coercion): Criterion {
	// An empty criteria cell counts as 0, as the COUNTIFS documentation says
	if (arg === null) arg = 0
	if (typeof arg === 'number') {
		const n = arg
		return (value) => {
			const v = numberIn(value, cx)
			return v !== undefined && approxEqual(v, n)
		}
	}
	if (typeof arg === 'boolean') return (value) => value === arg
	if (isError(arg)) return (value) => isError(value) && value.error === arg.error

	const operator = OPERATORS.find((op) => arg.startsWith(op)) ?? ''
	const operand = arg.slice(operator.length)
	if (operand === '') {
		// "" matches blanks and empty text, "=" only true blanks, "<>" anything not blank
		if (operator === '') return (value) => value === null || value === ''
		if (operator === '=') return (value) => value === null
		if (operator === '<>') return (value) => value !== null
	}

	const number = parseNumber(operand, cx.date1904)?.value
	if (number !== undefined) {
		const equal = (value: Value) => {
			const v = numberIn(value, cx)
			return v !== undefined && approxEqual(v, number)
		}
		return compare(operator, equal, (value) =>
			typeof value === 'number' ? (approxEqual(value, number) ? 0 : Math.sign(value - number)) : undefined,
		)
	}
	const upper = operand.toUpperCase()
	if (upper === 'TRUE' || upper === 'FALSE') {
		const b = upper === 'TRUE'
		return compare(
			operator,
			(value) => value === b,
			(value) => (typeof value === 'boolean' ? Number(value) - Number(b) : undefined),
		)
	}
	const error = errorFromCode(operand)
	if (error) {
		const equal = (value: Value) => isError(value) && value.error === error.error
		return operator === '<>' ? (value) => !equal(value) : operator === '' || operator === '=' ? equal : () => false
	}
	let equal: Criterion
	if (hasWildcards(operand)) {
		const pattern = compileWildcard(operand)
		equal = (value) => typeof value === 'string' && wildcardMatch(value, pattern)
	} else equal = (value) => typeof value === 'string' && textEqual(value, operand)
	return compare(operator, equal, (value) => (typeof value === 'string' ? compareText(value, operand) : undefined))
}

// = and <> use `equal`; the orderings only compare values of the operand's type
function compare(operator: string, equal: Criterion, order: (value: Value) => number | undefined): Criterion {
	switch (operator) {
		case '':
		case '=':
			return equal
		case '<>':
			return (value) => !equal(value)
	}
	return (value) => {
		const c = order(value)
		if (c === undefined) return false
		if (operator === '<') return c < 0
		if (operator === '<=') return c <= 0
		if (operator === '>') return c > 0
		return c >= 0
	}
}
