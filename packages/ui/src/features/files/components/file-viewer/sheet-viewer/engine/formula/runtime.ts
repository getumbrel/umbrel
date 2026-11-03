// What an expression evaluates to before it lands in a cell: a value, a
// reference (SUM treats cells differently from typed values, and INDEX or
// CHOOSE hand references on), or an array. Plus the helpers functions share.

import {MAX_COLS, MAX_ROWS} from './parser'
import {approxEqual, Errors, isError, toNumber, type Coercion, type FormulaError, type Value} from './values'

// One rectangular area of a sheet, 0-based and inclusive
export class Ref {
	readonly sheet: number
	readonly top: number
	readonly left: number
	readonly bottom: number
	readonly right: number

	constructor(sheet: number, top: number, left: number, bottom: number, right: number) {
		this.sheet = sheet
		this.top = top
		this.left = left
		this.bottom = bottom
		this.right = right
	}

	get rows() {
		return this.bottom - this.top + 1
	}

	get cols() {
		return this.right - this.left + 1
	}
}

// A union like (A1:A3,C1:C3); only aggregates and INDEX accept one
export class Areas {
	readonly refs: Ref[]

	constructor(refs: Ref[]) {
		this.refs = refs
	}
}

// Rows of values, rectangular, at least 1x1
export type Matrix = Value[][]
export type Result = Value | Ref | Areas | Matrix

// The calculator, as functions see it while a cell is being evaluated
export interface Context extends Coercion {
	// The cell being calculated
	readonly sheet: number
	readonly row: number
	readonly col: number
	// The workbook's used range; whole-column and whole-row references stop there
	readonly usedRows: number
	readonly usedCols: number
	now(): Date
	value(sheet: number, row: number, col: number): Value
	// Visits the non-empty cells of a reference row by row and stops at the first error returned
	scan(ref: Ref, visit: (value: Value) => FormulaError | void): FormulaError | undefined
}

export type Fn = {
	min: number
	max: number
	// Per argument: 's' wants one value, and an array or block of cells there
	// runs the function once per element; 'r' takes references and arrays as they are
	kinds: string
	// How many trailing kinds repeat for further arguments, 2 for COUNTIFS' range/criteria pairs
	repeat?: number
	call?: (args: Result[], cx: Context) => Result
	// Gets its arguments unevaluated, for IF and friends that only evaluate the branch they take
	lazy?: (count: number, arg: (index: number) => Result, cx: Context) => Result
	volatile?: boolean
}

export function kindAt({kinds, repeat = 1}: Fn, index: number): string {
	if (index < kinds.length) return kinds[index]
	return kinds[kinds.length - repeat + ((index - kinds.length) % repeat)]
}

// Arrays bigger than this abandon the calculation (the cell is reported stale)
// rather than exhausting memory, e.g. A:A*B1:XFD1 in a file built to hurt us
const MAX_ARRAY_CELLS = 2 ** 22
export class CalcLimitError extends Error {}

export const isMatrix = (result: Result): result is Matrix => Array.isArray(result)

// A reference that runs to the sheet's edge (A:A, A2:A1048576) is cut at the
// used range, so whole-column formulas cost what the data costs
export function clip(ref: Ref, cx: Context): Ref {
	const bottom = ref.bottom === MAX_ROWS - 1 ? Math.max(ref.top, Math.min(ref.bottom, cx.usedRows - 1)) : ref.bottom
	const right = ref.right === MAX_COLS - 1 ? Math.max(ref.left, Math.min(ref.right, cx.usedCols - 1)) : ref.right
	return bottom === ref.bottom && right === ref.right ? ref : new Ref(ref.sheet, ref.top, ref.left, bottom, right)
}

export function checkSize(rows: number, cols: number) {
	if (rows * cols > MAX_ARRAY_CELLS) throw new CalcLimitError('Array too large')
}

export function toMatrix(ref: Ref, cx: Context): Matrix {
	const {sheet, top, left, rows, cols} = clip(ref, cx)
	checkSize(rows, cols)
	const matrix: Matrix = new Array(rows)
	for (let r = 0; r < rows; r++) {
		const row: Value[] = new Array(cols)
		for (let c = 0; c < cols; c++) row[c] = cx.value(sheet, top + r, left + c)
		matrix[r] = row
	}
	return matrix
}

// The single value of a result, or #VALUE! when it holds several
export function single(result: Result, cx: Context): Value {
	if (result instanceof Ref) {
		return result.top === result.bottom && result.left === result.right
			? cx.value(result.sheet, result.top, result.left)
			: Errors.value
	}
	if (result instanceof Areas) return result.refs.length === 1 ? single(result.refs[0], cx) : Errors.value
	if (isMatrix(result)) return result.length === 1 && result[0].length === 1 ? result[0][0] : Errors.value
	return result
}

// A result as an operand: one cell is its value, a block of cells an array
export function operand(result: Result, cx: Context): Value | Matrix {
	if (result instanceof Ref) {
		return result.top === result.bottom && result.left === result.right
			? cx.value(result.sheet, result.top, result.left)
			: toMatrix(result, cx)
	}
	if (result instanceof Areas) return single(result, cx)
	return result
}

export const isArray = (x: Value | Matrix): x is Matrix => isMatrix(x) && (x.length > 1 || x[0].length > 1)

// Element (r, c) of an array stretched to a larger shape: a single row or
// column repeats, anything else past its edge is #N/A
function element(matrix: Matrix, r: number, c: number): Value {
	const row = matrix.length === 1 ? 0 : r
	const col = matrix[0].length === 1 ? 0 : c
	return row < matrix.length && col < matrix[0].length ? matrix[row][col] : Errors.na
}

export function broadcast(operands: (Value | Matrix)[], each: (values: Value[]) => Value): Matrix {
	let rows = 1
	let cols = 1
	for (const x of operands) {
		if (!isMatrix(x)) continue
		rows = Math.max(rows, x.length)
		cols = Math.max(cols, x[0].length)
	}
	checkSize(rows, cols)
	const out: Matrix = new Array(rows)
	const values: Value[] = new Array(operands.length)
	for (let r = 0; r < rows; r++) {
		const row: Value[] = new Array(cols)
		for (let c = 0; c < cols; c++) {
			for (let i = 0; i < operands.length; i++) {
				const x = operands[i]
				values[i] = isMatrix(x) ? element(x, r, c) : x
			}
			row[c] = each(values)
		}
		out[r] = row
	}
	return out
}

// For lazy functions whose deciding argument turned out to be an array: every
// argument is evaluated and the scalar version runs per element
export function liftLazy(
	count: number,
	arg: (index: number) => Result,
	cx: Context,
	each: (values: Value[]) => Value,
): Matrix {
	const operands: (Value | Matrix)[] = []
	for (let i = 0; i < count; i++) operands.push(operand(arg(i), cx))
	return broadcast(operands, each)
}

export type Operator = '+' | '-' | '*' | '/' | '^'
export function arithmetic(operator: Operator, x: number, y: number, snap = false): number | FormulaError {
	let result: number
	switch (operator) {
		case '+':
			result = snap && x !== -y && approxEqual(x, -y) ? 0 : x + y
			break
		case '-':
			result = snap && x !== y && approxEqual(x, y) ? 0 : x - y
			break
		case '*':
			result = x * y
			break
		case '/':
			if (y === 0) return Errors.div0
			result = x / y
			break
		case '^':
			// 0^0 is #NUM! and 0^-1 #DIV/0!; a negative base with a fractional power is NaN, so #NUM!
			if (x === 0 && y <= 0) return y === 0 ? Errors.num : Errors.div0
			result = x ** y
	}
	return Number.isFinite(result) ? result : Errors.num
}

// Positional access for lookups and criteria ranges
export type Grid = {readonly rows: number; readonly cols: number; get(row: number, col: number): Value}

export function gridOf(result: Result, cx: Context): Grid | FormulaError {
	if (isError(result)) return result
	if (result instanceof Areas) {
		if (result.refs.length !== 1) return Errors.value
		result = result.refs[0]
	}
	if (result instanceof Ref) {
		const {sheet, top, left, rows, cols} = clip(result, cx)
		return {rows, cols, get: (r, c) => cx.value(sheet, top + r, left + c)}
	}
	if (isMatrix(result)) {
		const matrix = result
		return {rows: matrix.length, cols: matrix[0].length, get: (r, c) => matrix[r][c]}
	}
	const value = result
	return {rows: 1, cols: 1, get: () => value}
}

// Calls `visit` with each value an aggregate like SUM sees in an argument:
// the non-empty cells of references and arrays, or the argument itself, marked
// `direct`, since Excel coerces typed values ("2", TRUE) it skips in cells
export function eachValue(
	arg: Result,
	cx: Context,
	visit: (value: Value, direct: boolean) => FormulaError | void,
): FormulaError | undefined {
	if (arg instanceof Ref) return cx.scan(arg, (value) => visit(value, false))
	if (arg instanceof Areas) {
		for (const ref of arg.refs) {
			const failed = cx.scan(ref, (value) => visit(value, false))
			if (failed) return failed
		}
		return undefined
	}
	if (isMatrix(arg)) {
		for (const row of arg) {
			for (const value of row) {
				if (value === null) continue
				const failed = visit(value, false)
				if (failed) return failed
			}
		}
		return undefined
	}
	return visit(arg, true) || undefined
}

// Feeds `step` the numbers an aggregate counts: typed values are coerced (text
// that isn't a number is #VALUE!), cells and array elements count only when
// they hold numbers, and an error anywhere is returned
export function eachNumber(args: Result[], cx: Context, step: (n: number) => void): FormulaError | undefined {
	for (const arg of args) {
		const failed = eachValue(arg, cx, (value, direct) => {
			if (typeof value === 'number') step(value)
			else if (isError(value)) return value
			else if (direct) {
				const n = toNumber(value, cx)
				if (isError(n)) return n
				step(n)
			}
		})
		if (failed) return failed
	}
	return undefined
}

export function collectNumbers(args: Result[], cx: Context): number[] | FormulaError {
	const numbers: number[] = []
	return eachNumber(args, cx, (n) => numbers.push(n)) ?? numbers
}

// Truncated whole numbers for counts and positions
export function integer(value: Value, cx: Coercion): number | FormulaError {
	const n = toNumber(value, cx)
	return isError(n) ? n : Math.trunc(n)
}
