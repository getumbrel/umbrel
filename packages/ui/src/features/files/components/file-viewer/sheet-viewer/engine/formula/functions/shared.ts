import {Areas, isMatrix, Ref, type Context, type Fn, type Matrix, type Result} from '../runtime'
import {Errors, isError, toNumber, type FormulaError, type Value} from '../values'

// A function of numbers: every argument is coerced and the first error wins.
// Omitted arguments are left out, so `f` can default them; an empty one (ROUND(1.5,)) is 0.
export const numbers = (min: number, max: number, f: (...args: number[]) => Value): Fn => ({
	min,
	max,
	kinds: 's',
	call: (args, cx) => {
		const n: number[] = new Array(args.length)
		for (let i = 0; i < args.length; i++) {
			const x = toNumber(args[i] as Value, cx)
			if (isError(x)) return x
			n[i] = x
		}
		return f(...n)
	},
})

// A function of single values
export const values = (min: number, max: number, f: (args: Value[], cx: Context) => Result): Fn => ({
	min,
	max,
	kinds: 's',
	call: (args, cx) => f(args as Value[], cx),
})

// What an empty argument (IF(A1,,1)) produces where a function returns it
export const orZero = (result: Result): Result => (result === null ? 0 : result)

export const scalarOf = (x: Value | Matrix): Value => (isMatrix(x) ? x[0][0] : x)

// The criteria and sum ranges of SUMIF and friends must be references
export function asRef(result: Result): Ref | FormulaError {
	if (result instanceof Ref) return result
	if (result instanceof Areas && result.refs.length === 1) return result.refs[0]
	return isError(result) ? result : Errors.value
}
