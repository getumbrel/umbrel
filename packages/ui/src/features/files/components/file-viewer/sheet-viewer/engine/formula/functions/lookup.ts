import {compileWildcard, hasWildcards, wildcardMatch} from '../criteria'
import {Areas, checkSize, clip, gridOf, integer, isMatrix, Ref, type Fn, type Grid, type Result} from '../runtime'
import {
	approxEqual,
	compareValues,
	Errors,
	isError,
	textEqual,
	toBoolean,
	toNumber,
	type FormulaError,
	type Value,
} from '../values'

type Vector = {length: number; at(index: number): Value}

const column = (grid: Grid, col: number): Vector => ({length: grid.rows, at: (i) => grid.get(i, col)})
const row = (grid: Grid, r: number): Vector => ({length: grid.cols, at: (i) => grid.get(r, i)})
const vectorOf = (grid: Grid) => (grid.cols === 1 ? column(grid, 0) : grid.rows === 1 ? row(grid, 0) : undefined)

// An empty lookup cell looks for 0
const lookupValue = (value: Value) => value ?? 0

const comparable = (a: Value, b: Value) => typeof a === typeof b && a !== null && !isError(a) && !isError(b)
// For values `comparable` has vetted
const order = (a: Value, b: Value) =>
	compareValues(a as Exclude<Value, FormulaError>, b as Exclude<Value, FormulaError>)

// Text matches case-insensitively, and with wildcards where the function allows them
function exactMatcher(lookup: Value, wildcards: boolean): (value: Value) => boolean {
	if (typeof lookup === 'number') return (value) => typeof value === 'number' && approxEqual(value, lookup)
	if (typeof lookup === 'boolean') return (value) => value === lookup
	if (typeof lookup !== 'string') return () => false
	if (wildcards && hasWildcards(lookup)) {
		const pattern = compileWildcard(lookup)
		return (value) => typeof value === 'string' && wildcardMatch(value, pattern)
	}
	return (value) => typeof value === 'string' && textEqual(value, lookup)
}

function exact(vector: Vector, lookup: Value, wildcards: boolean): number {
	const matches = exactMatcher(lookup, wildcards)
	for (let i = 0; i < vector.length; i++) if (matches(vector.at(i))) return i
	return -1
}

// Excel's approximate match is a binary search for the last value not past
// the lookup (≤, or ≥ in a descending list), stepping over blanks and values
// of another type. On sorted data that's the largest value ≤ the lookup and the
// last of any duplicates; on unsorted data, like Excel, it may find anything.
function approximate(vector: Vector, lookup: Value, descending: boolean): number {
	let low = 0
	let high = vector.length - 1
	let found = -1
	while (low <= high) {
		const middle = (low + high) >> 1
		let k = middle
		while (k >= low && !comparable(vector.at(k), lookup)) k--
		if (k < low) {
			low = middle + 1
			continue
		}
		const c = order(vector.at(k), lookup)
		if (descending ? c >= 0 : c <= 0) {
			found = k
			low = middle + 1
		} else high = k - 1
	}
	return found
}

function nextComparable(vector: Vector, from: number, lookup: Value): number {
	for (let i = from; i < vector.length; i++) if (comparable(vector.at(i), lookup)) return i
	return -1
}

// XLOOKUP/XMATCH: match 0 exact, -1 exact or next smaller, 1 exact or next
// larger, 2 wildcards; search 1 first to last, -1 last to first, ±2 binary
function search(vector: Vector, lookup: Value, match: number, mode: number): number {
	if (mode === 2 || mode === -2) {
		const descending = mode === -2
		const i = approximate(vector, lookup, descending)
		if (i >= 0 && order(vector.at(i), lookup) === 0) return i
		if (match === 0 || match === 2) return -1
		// i holds the neighbour on one side of the lookup, the next comparable value is on the other
		const atSide = descending ? match === 1 : match === -1
		return atSide ? i : nextComparable(vector, i + 1, lookup)
	}
	const matches = exactMatcher(lookup, match === 2)
	let best = -1
	let bestValue: Value = null
	for (let n = 0; n < vector.length; n++) {
		const i = mode === 1 ? n : vector.length - 1 - n
		const value = vector.at(i)
		if (matches(value)) return i
		if ((match !== -1 && match !== 1) || !comparable(value, lookup)) continue
		const c = order(value, lookup)
		if (match === -1 ? c >= 0 : c <= 0) continue
		if (best < 0 || order(value, bestValue) * match < 0) {
			best = i
			bestValue = value
		}
	}
	return best
}

function modes(matchArg: Value | undefined, searchArg: Value | undefined): [number, number] | undefined {
	const match = matchArg == null ? 0 : toNumber(matchArg, {date1904: false})
	const mode = searchArg == null ? 1 : toNumber(searchArg, {date1904: false})
	if (isError(match) || isError(mode)) return undefined
	const m = Math.trunc(match)
	const s = Math.trunc(mode)
	return [-1, 0, 1, 2].includes(m) && [-2, -1, 1, 2].includes(s) ? [m, s] : undefined
}

const dimensions = (result: Result): [rows: number, cols: number] =>
	result instanceof Ref ? [result.rows, result.cols] : isMatrix(result) ? [result.length, result[0].length] : [1, 1]

// VLOOKUP(lookup, table, column, [sorted]) and HLOOKUP
const tableLookup = (vertical: boolean): Fn => ({
	min: 3,
	max: 4,
	kinds: 'srss',
	call: ([lookup, table, index, sorted], cx) => {
		if (isError(lookup as Value)) return lookup
		const grid = gridOf(table, cx)
		if (isError(grid)) return grid
		const n = integer(index as Value, cx)
		if (isError(n)) return n
		if (n < 1) return Errors.value
		if (n > (vertical ? grid.cols : grid.rows)) return Errors.ref
		const approximateMatch = sorted === undefined ? true : toBoolean(sorted as Value)
		if (isError(approximateMatch)) return approximateMatch
		const keys = vertical ? column(grid, 0) : row(grid, 0)
		const value = lookupValue(lookup as Value)
		const i = approximateMatch ? approximate(keys, value, false) : exact(keys, value, true)
		if (i < 0) return Errors.na
		return vertical ? grid.get(i, n - 1) : grid.get(n - 1, i)
	},
})

// Row and column numbers of a reference: one number, or an array for a block
const position = (vertical: boolean): Fn => ({
	min: 0,
	max: 1,
	kinds: 'r',
	call: ([arg], cx) => {
		if (arg === undefined || arg === null) return (vertical ? cx.row : cx.col) + 1
		if (isError(arg)) return arg
		if (!(arg instanceof Ref)) return Errors.value
		const ref = clip(arg, cx)
		const start = (vertical ? ref.top : ref.left) + 1
		const count = vertical ? ref.rows : ref.cols
		if (count === 1) return start
		checkSize(count, 1)
		const numbers = Array.from({length: count}, (_, i) => start + i)
		return vertical ? numbers.map((n) => [n]) : [numbers]
	},
})

const size = (vertical: boolean): Fn => ({
	min: 1,
	max: 1,
	kinds: 'r',
	call: ([arg]) => {
		if (isError(arg)) return arg
		if (arg instanceof Areas) return Errors.ref
		return dimensions(arg)[vertical ? 0 : 1]
	},
})

export const lookupFunctions: Record<string, Fn> = {
	VLOOKUP: tableLookup(true),
	HLOOKUP: tableLookup(false),
	// MATCH(lookup, vector, [type]): 1 sorted ascending, 0 exact (wildcards allowed), -1 sorted descending
	MATCH: {
		min: 2,
		max: 3,
		kinds: 'srs',
		call: ([lookup, array, type], cx) => {
			if (isError(lookup as Value)) return lookup
			const grid = gridOf(array, cx)
			if (isError(grid)) return grid
			const vector = vectorOf(grid)
			if (!vector) return Errors.na
			const mode = type === undefined ? 1 : toNumber(type as Value, cx)
			if (isError(mode)) return mode
			const value = lookupValue(lookup as Value)
			const i = mode === 0 ? exact(vector, value, true) : approximate(vector, value, mode < 0)
			return i < 0 ? Errors.na : i + 1
		},
	},
	XMATCH: {
		min: 2,
		max: 4,
		kinds: 'srss',
		call: ([lookup, array, matchMode, searchMode], cx) => {
			if (isError(lookup as Value)) return lookup
			const grid = gridOf(array, cx)
			if (isError(grid)) return grid
			const vector = vectorOf(grid)
			const chosen = modes(matchMode as Value | undefined, searchMode as Value | undefined)
			if (!vector || !chosen) return Errors.value
			const i = search(vector, lookupValue(lookup as Value), ...chosen)
			return i < 0 ? Errors.na : i + 1
		},
	},
	// Returns the matching row (or column) of the return array, as a reference when it is one
	XLOOKUP: {
		min: 3,
		max: 6,
		kinds: 'srrrss',
		call: ([lookup, lookupArray, returnArray, ifNotFound, matchMode, searchMode], cx) => {
			if (isError(lookup as Value)) return lookup
			if (isError(lookupArray)) return lookupArray
			if (isError(returnArray)) return returnArray
			if (lookupArray instanceof Areas || returnArray instanceof Areas) return Errors.value
			const grid = gridOf(lookupArray, cx)
			if (isError(grid)) return grid
			const vector = vectorOf(grid)
			const chosen = modes(matchMode as Value | undefined, searchMode as Value | undefined)
			if (!vector || !chosen) return Errors.value
			const [keyRows, keyCols] = dimensions(lookupArray)
			const [rows, cols] = dimensions(returnArray)
			const vertical = keyCols === 1
			if (vertical ? rows !== keyRows : cols !== keyCols) return Errors.value
			const i = search(vector, lookupValue(lookup as Value), ...chosen)
			if (i < 0) return ifNotFound === undefined || ifNotFound === null ? Errors.na : ifNotFound
			if (returnArray instanceof Ref) {
				const {sheet, top, left, bottom, right} = returnArray
				return vertical
					? new Ref(sheet, top + i, left, top + i, right)
					: new Ref(sheet, top, left + i, bottom, left + i)
			}
			if (isMatrix(returnArray)) return vertical ? [returnArray[i]] : returnArray.map((values) => [values[i]])
			return returnArray
		},
	},
	// INDEX(array, row, [column], [area]); 0 for row or column takes all of them
	INDEX: {
		min: 2,
		max: 4,
		kinds: 'rsss',
		call: ([array, rowArg, colArg, areaArg], cx) => {
			if (isError(array)) return array
			const area = areaArg === undefined ? 1 : integer(areaArg as Value, cx)
			if (isError(area)) return area
			let target = array
			if (target instanceof Areas) {
				if (area < 1 || area > target.refs.length) return Errors.ref
				target = target.refs[area - 1]
			} else if (area !== 1) return Errors.ref
			const [rows, cols] = dimensions(target)
			let r = integer(rowArg as Value, cx)
			if (isError(r)) return r
			let c = colArg === undefined ? undefined : integer(colArg as Value, cx)
			if (isError(c)) return c
			// With one index, a single row or column is indexed along its length
			if (c === undefined) {
				if (rows === 1) [r, c] = [1, r]
				else c = cols === 1 ? 1 : 0
			}
			if (r < 0 || c < 0) return Errors.value
			if (r > rows || c > cols) return Errors.ref
			const [r0, r1] = r === 0 ? [0, rows - 1] : [r - 1, r - 1]
			const [c0, c1] = c === 0 ? [0, cols - 1] : [c - 1, c - 1]
			if (target instanceof Ref) {
				const {sheet, top, left} = target
				return new Ref(sheet, top + r0, left + c0, top + r1, left + c1)
			}
			if (!isMatrix(target)) return target
			return target.slice(r0, r1 + 1).map((values) => values.slice(c0, c1 + 1))
		},
	},
	ROW: position(true),
	COLUMN: position(false),
	ROWS: size(true),
	COLUMNS: size(false),
}
