import {broadcast, eachValue, integer, isArray, liftLazy, operand, type Context, type Fn, type Result} from '../runtime'
import {compareValues, Errors, isError, toBoolean, type FormulaError, type Value} from '../values'
import {orZero, scalarOf, values} from './shared'

// IF and friends evaluate only the branch they take. When the deciding value
// is an array, every argument is evaluated and the choice made per element.
// `decide` gets the first argument already reduced to one value
const lazy = (
	min: number,
	max: number,
	scalar: (values: Value[], cx: Context) => Value,
	decide: (count: number, arg: (index: number) => Result, cx: Context) => Result,
): Fn => ({
	min,
	max,
	kinds: 's',
	lazy: (count, arg, cx) => {
		const head = operand(arg(0), cx)
		if (isArray(head))
			return liftLazy(
				count,
				(i) => (i === 0 ? head : arg(i)),
				cx,
				(values) => scalar(values, cx),
			)
		return decide(count, (i) => (i === 0 ? scalarOf(head) : arg(i)), cx)
	},
})

const pick = (count: number, index: number, value: Value | undefined): Value =>
	index < count ? (value ?? 0) : Errors.na

function ifs(values: Value[]): Value {
	for (let i = 0; i < values.length; i += 2) {
		const test = toBoolean(values[i])
		if (isError(test)) return test
		if (test) return pick(values.length, i + 1, values[i + 1])
	}
	return Errors.na
}

function switchOf(values: Value[]): Value {
	const [subject] = values
	if (isError(subject)) return subject
	const pairs = (values.length - 1) >> 1
	for (let k = 0; k < pairs; k++) {
		const candidate = values[1 + 2 * k]
		if (isError(candidate)) return candidate
		if (compareValues(subject, candidate) === 0) return values[2 + 2 * k] ?? 0
	}
	return values.length % 2 === 0 ? (values.at(-1) ?? 0) : Errors.na
}

// AND, OR and XOR look at logical values and numbers; text in cells is skipped,
// typed text must read TRUE or FALSE, and with nothing to look at they're #VALUE!
const logical = (decide: (count: number, trues: number) => boolean): Fn => ({
	min: 1,
	max: 255,
	kinds: 'r',
	call: (args, cx) => {
		let count = 0
		let trues = 0
		for (const arg of args) {
			const failed = eachValue(arg, cx, (value, direct): FormulaError | void => {
				if (isError(value)) return value
				if (typeof value === 'string' || value === null) {
					if (!direct || value === null) return
					const b = toBoolean(value)
					if (isError(b)) return b
					value = b
				}
				count++
				if (value) trues++
			})
			if (failed) return failed
		}
		return count === 0 ? Errors.value : decide(count, trues)
	},
})

const is = (test: (value: Value) => boolean): Fn => values(1, 1, ([value]) => test(value))

function iferror(isCaught: (error: FormulaError) => boolean): Fn {
	return {
		min: 2,
		max: 2,
		kinds: 's',
		lazy: (_count, arg, cx: Context) => {
			const x = operand(arg(0), cx)
			if (isArray(x)) {
				const fallback = operand(arg(1), cx)
				return broadcast([x, fallback], ([value, alt]) => (isError(value) && isCaught(value) ? (alt ?? 0) : value))
			}
			const value = scalarOf(x)
			return isError(value) && isCaught(value) ? orZero(arg(1)) : value
		},
	}
}

export const logicalFunctions: Record<string, Fn> = {
	IF: lazy(
		2,
		3,
		([test, yes, no]) => {
			const b = toBoolean(test)
			if (isError(b)) return b
			return b ? (yes === undefined ? true : (yes ?? 0)) : no === undefined ? false : (no ?? 0)
		},
		(count, arg) => {
			const b = toBoolean(arg(0) as Value)
			if (isError(b)) return b
			if (b) return count > 1 ? orZero(arg(1)) : true
			return count > 2 ? orZero(arg(2)) : false
		},
	),
	IFS: lazy(2, 254, ifs, (count, arg, cx) => {
		for (let i = 0; i < count; i += 2) {
			const x = i === 0 ? (arg(0) as Value) : operand(arg(i), cx)
			if (isArray(x)) return liftLazy(count, arg, cx, ifs)
			const test = toBoolean(scalarOf(x))
			if (isError(test)) return test
			if (test) return i + 1 < count ? orZero(arg(i + 1)) : Errors.na
		}
		return Errors.na
	}),
	SWITCH: lazy(3, 254, switchOf, (count, arg, cx) => {
		const subject = arg(0) as Value
		if (isError(subject)) return subject
		const pairs = (count - 1) >> 1
		for (let k = 0; k < pairs; k++) {
			const candidate = scalarOf(operand(arg(1 + 2 * k), cx))
			if (isError(candidate)) return candidate
			if (compareValues(subject, candidate) === 0) return orZero(arg(2 + 2 * k))
		}
		return count % 2 === 0 ? orZero(arg(count - 1)) : Errors.na
	}),
	CHOOSE: lazy(
		2,
		255,
		([index, ...choices], cx) => {
			const i = integer(index, cx)
			if (isError(i)) return i
			return i < 1 || i > choices.length ? Errors.value : (choices[i - 1] ?? 0)
		},
		(count, arg, cx) => {
			const i = integer(arg(0) as Value, cx)
			if (isError(i)) return i
			return i < 1 || i >= count ? Errors.value : orZero(arg(i))
		},
	),
	IFERROR: iferror(() => true),
	IFNA: iferror((error) => error.error === '#N/A'),
	AND: logical((count, trues) => trues === count),
	OR: logical((_count, trues) => trues > 0),
	XOR: logical((_count, trues) => trues % 2 === 1),
	NOT: values(1, 1, ([value]) => {
		const b = toBoolean(value)
		return isError(b) ? b : !b
	}),
	TRUE: values(0, 0, () => true),
	FALSE: values(0, 0, () => false),
	ISBLANK: is((value) => value === null),
	ISNUMBER: is((value) => typeof value === 'number'),
	ISTEXT: is((value) => typeof value === 'string'),
	ISLOGICAL: is((value) => typeof value === 'boolean'),
	ISERROR: is(isError),
	ISERR: is((value) => isError(value) && value.error !== '#N/A'),
	ISNA: is((value) => isError(value) && value.error === '#N/A'),
	N: values(1, 1, ([value]) => {
		if (typeof value === 'number' || isError(value)) return value
		return typeof value === 'boolean' ? Number(value) : 0
	}),
	T: values(1, 1, ([value]) => (typeof value === 'string' || isError(value) ? value : '')),
	NA: values(0, 0, () => Errors.na),
}
