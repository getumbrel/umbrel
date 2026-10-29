import {criterion, type Criterion} from '../criteria'
import {MAX_COLS, MAX_ROWS} from '../parser'
import {checkSize, collectNumbers, eachValue, Ref, type Context, type Fn, type Result} from '../runtime'
import {approxEqual, Errors, isError, parseNumber, toNumber, type FormulaError, type Value} from '../values'
import {asRef} from './shared'

const aggregate = (f: (numbers: number[]) => Value): Fn => ({
	min: 1,
	max: 255,
	kinds: 'r',
	call: (args, cx) => {
		const numbers = collectNumbers(args, cx)
		return isError(numbers) ? numbers : f(numbers)
	},
})

function variance(numbers: number[], sample: boolean): number | FormulaError {
	const n = numbers.length
	if (n < (sample ? 2 : 1)) return Errors.div0
	let sum = 0
	for (const x of numbers) sum += x
	const mean = sum / n
	let squares = 0
	for (const x of numbers) squares += (x - mean) ** 2
	return squares / (sample ? n - 1 : n)
}

const sqrt = (x: number | FormulaError) => (isError(x) ? x : Math.sqrt(x))

// The k-th largest or smallest; Excel rounds a fractional k up
const nth = (largest: boolean): Fn => ({
	min: 2,
	max: 2,
	kinds: 'rs',
	call: ([array, k], cx) => {
		const numbers = collectNumbers([array], cx)
		if (isError(numbers)) return numbers
		const position = toNumber(k as Value, cx)
		if (isError(position)) return position
		const index = Math.ceil(position)
		if (index < 1 || index > numbers.length) return Errors.num
		return numbers.sort((a, b) => (largest ? b - a : a - b))[index - 1]
	},
})

const rank: Fn = {
	min: 2,
	max: 3,
	kinds: 'srs',
	call: ([number, ref, order], cx) => {
		const n = toNumber(number as Value, cx)
		if (isError(n)) return n
		const numbers = collectNumbers([ref], cx)
		if (isError(numbers)) return numbers
		const ascending = order === undefined ? 0 : toNumber(order as Value, cx)
		if (isError(ascending)) return ascending
		let ahead = 0
		let found = false
		for (const x of numbers) {
			if (approxEqual(x, n)) found = true
			else if (ascending ? x < n : x > n) ahead++
		}
		return found ? ahead + 1 : Errors.na
	},
}

type Pair = {ref: Ref; test: Criterion}

// Counts the positions where every range meets its criterion, calling `visit`
// for each one inside the used range. Past the used range every cell is blank
// (`target`'s too), so those positions all match or all don't, and are
// counted without a visit.
function matches(pairs: Pair[], cx: Context, visit?: (row: number, col: number) => FormulaError | void, target?: Ref) {
	const {rows, cols} = pairs[0].ref
	if (pairs.some(({ref}) => ref.rows !== rows || ref.cols !== cols)) return Errors.value
	const refs = pairs.map(({ref}) => ref)
	if (target) refs.push(target)
	const usedRows = Math.min(rows, Math.max(0, ...refs.map((ref) => cx.usedRows - ref.top)))
	const usedCols = Math.min(cols, Math.max(0, ...refs.map((ref) => cx.usedCols - ref.left)))
	checkSize(usedRows, usedCols)
	let count = 0
	for (let r = 0; r < usedRows; r++) {
		for (let c = 0; c < usedCols; c++) {
			if (!pairs.every(({ref, test}) => test(cx.value(ref.sheet, ref.top + r, ref.left + c)))) continue
			count++
			const failed = visit?.(r, c)
			if (failed) return failed
		}
	}
	if (pairs.every(({test}) => test(null))) count += rows * cols - usedRows * usedCols
	return count
}

// range/criteria arguments from `from` on, as pairs
function pairsOf(args: Result[], from: number, cx: Context): Pair[] | FormulaError {
	const pairs: Pair[] = []
	for (let i = from; i < args.length; i += 2) {
		const ref = asRef(args[i])
		if (isError(ref)) return ref
		pairs.push({ref, test: criterion((args[i + 1] ?? null) as Value, cx)})
	}
	return pairs
}

// SUMIF's sum range takes the criteria range's shape, from its own top-left cell
const resize = (ref: Ref, like: Ref) =>
	new Ref(
		ref.sheet,
		ref.top,
		ref.left,
		Math.min(MAX_ROWS - 1, ref.top + like.rows - 1),
		Math.min(MAX_COLS - 1, ref.left + like.cols - 1),
	)

type Fold = {add(n: number): void; result(): Value}
const folds = {
	sum: (): Fold => {
		let sum = 0
		return {add: (n) => (sum += n), result: () => sum}
	},
	average: (): Fold => {
		let sum = 0
		let count = 0
		return {
			add: (n) => {
				sum += n
				count++
			},
			result: () => (count === 0 ? Errors.div0 : sum / count),
		}
	},
	min: (): Fold => {
		let min = Infinity
		return {add: (n) => (min = Math.min(min, n)), result: () => (min === Infinity ? 0 : min)}
	},
	max: (): Fold => {
		let max = -Infinity
		return {add: (n) => (max = Math.max(max, n)), result: () => (max === -Infinity ? 0 : max)}
	},
}

// Folds the numbers of `target` at matching positions; errors there propagate
function foldMatches(target: Ref, pairs: Pair[], cx: Context, fold: Fold): Value {
	const failed = matches(
		pairs,
		cx,
		(r, c) => {
			const value = cx.value(target.sheet, target.top + r, target.left + c)
			if (typeof value === 'number') fold.add(value)
			else if (isError(value)) return value
		},
		target,
	)
	return isError(failed) ? failed : fold.result()
}

// SUMIF(range, criteria, [sum_range]) and AVERAGEIF
const conditional = (make: () => Fold): Fn => ({
	min: 2,
	max: 3,
	kinds: 'rsr',
	call: (args, cx) => {
		const pairs = pairsOf(args.slice(0, 2), 0, cx)
		if (isError(pairs)) return pairs
		const range = pairs[0].ref
		const target = args[2] === undefined || args[2] === null ? range : asRef(args[2])
		if (isError(target)) return target
		return foldMatches(target === range ? range : resize(target, range), pairs, cx, make())
	},
})

// SUMIFS(sum_range, range1, criteria1, ...) and friends
const conditionals = (make: () => Fold): Fn => ({
	min: 3,
	max: 255,
	kinds: 'rrs',
	repeat: 2,
	call: (args, cx) => {
		const target = asRef(args[0])
		if (isError(target)) return target
		const pairs = pairsOf(args, 1, cx)
		if (isError(pairs)) return pairs
		if (pairs.some(({ref}) => ref.rows !== target.rows || ref.cols !== target.cols)) return Errors.value
		return foldMatches(target, pairs, cx, make())
	},
})

export const statistics: Record<string, Fn> = {
	AVERAGE: aggregate((numbers) => {
		if (numbers.length === 0) return Errors.div0
		let sum = 0
		for (const n of numbers) sum += n
		return sum / numbers.length
	}),
	MIN: aggregate((numbers) => (numbers.length === 0 ? 0 : numbers.reduce((a, b) => Math.min(a, b)))),
	MAX: aggregate((numbers) => (numbers.length === 0 ? 0 : numbers.reduce((a, b) => Math.max(a, b)))),
	MEDIAN: aggregate((numbers) => {
		if (numbers.length === 0) return Errors.num
		const sorted = numbers.sort((a, b) => a - b)
		const middle = sorted.length >> 1
		return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
	}),
	'STDEV.S': aggregate((numbers) => sqrt(variance(numbers, true))),
	'STDEV.P': aggregate((numbers) => sqrt(variance(numbers, false))),
	'VAR.S': aggregate((numbers) => variance(numbers, true)),
	'VAR.P': aggregate((numbers) => variance(numbers, false)),
	// Numbers, and typed values that read as numbers; nothing else, errors included
	COUNT: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			let count = 0
			for (const arg of args) {
				eachValue(arg, cx, (value, direct) => {
					if (typeof value === 'number') count++
					else if (direct && typeof value === 'boolean') count++
					else if (direct && typeof value === 'string' && parseNumber(value, cx.date1904)) count++
				})
			}
			return count
		},
	},
	COUNTA: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			let count = 0
			for (const arg of args) eachValue(arg, cx, () => void count++)
			return count
		},
	},
	// Empty cells and empty text; computed from the area, so A:A costs only its data
	COUNTBLANK: {
		min: 1,
		max: 1,
		kinds: 'r',
		call: ([range], cx) => {
			const ref = asRef(range)
			if (isError(ref)) return ref
			let filled = 0
			cx.scan(ref, (value) => void (value !== '' && filled++))
			return ref.rows * ref.cols - filled
		},
	},
	LARGE: nth(true),
	SMALL: nth(false),
	'RANK.EQ': rank,
	COUNTIF: {
		min: 2,
		max: 2,
		kinds: 'rs',
		call: (args, cx) => {
			const pairs = pairsOf(args, 0, cx)
			return isError(pairs) ? pairs : matches(pairs, cx)
		},
	},
	COUNTIFS: {
		min: 2,
		max: 254,
		kinds: 'rs',
		repeat: 2,
		call: (args, cx) => {
			const pairs = pairsOf(args, 0, cx)
			return isError(pairs) ? pairs : matches(pairs, cx)
		},
	},
	SUMIF: conditional(folds.sum),
	AVERAGEIF: conditional(folds.average),
	SUMIFS: conditionals(folds.sum),
	AVERAGEIFS: conditionals(folds.average),
	MINIFS: conditionals(folds.min),
	MAXIFS: conditionals(folds.max),
}

// The pre-2010 names
statistics.STDEV = statistics['STDEV.S']
statistics.VAR = statistics['VAR.S']
statistics.RANK = rank
