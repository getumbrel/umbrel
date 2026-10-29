import {Areas, arithmetic, eachNumber, isMatrix, Ref, toMatrix, type Fn, type Matrix} from '../runtime'
import {approxEqual, Errors, isError, significant15} from '../values'
import {numbers} from './shared'

// Moves the decimal point on the digits themselves, so 2.675 becomes 267.5
// exactly rather than 267.49999999999997
function shiftDecimal(n: number, places: number) {
	const [mantissa, exponent = '0'] = String(n).split('e')
	return Number(`${mantissa}e${Number(exponent) + places}`)
}

// Excel rounds the 15-digit decimal it displays, halves away from zero
function round(x: number, digits: number, mode: 'nearest' | 'up' | 'down'): number {
	const places = Math.trunc(digits)
	const magnitude = significant15(Math.abs(x))
	const scaled = shiftDecimal(magnitude, places)
	// From 2^52 every double is a whole number, so there is nothing left to round
	if (!(scaled < 2 ** 52)) return x < 0 ? -magnitude : magnitude
	const whole = mode === 'nearest' ? Math.round(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled)
	const result = shiftDecimal(whole, -places)
	return x < 0 && result !== 0 ? -result : result
}

// Whole multiples of the quotient, judged on the displayed digits so that
// CEILING(1.5, 0.1) stays 1.5 though 1.5/0.1 is 14.999999999999998
const multiple = (n: number, significance: number, toWhole: (q: number) => number) =>
	significant15(toWhole(significant15(n / significance)) * significance)

export const math: Record<string, Fn> = {
	ABS: numbers(1, 1, Math.abs),
	SIGN: numbers(1, 1, (x) => Math.sign(x) + 0),
	INT: numbers(1, 1, (x) => Math.floor(significant15(x))),
	TRUNC: numbers(1, 2, (x, digits = 0) => round(x, digits, 'down')),
	ROUND: numbers(2, 2, (x, digits) => round(x, digits, 'nearest')),
	ROUNDUP: numbers(2, 2, (x, digits) => round(x, digits, 'up')),
	ROUNDDOWN: numbers(2, 2, (x, digits) => round(x, digits, 'down')),
	SQRT: numbers(1, 1, (x) => (x < 0 ? Errors.num : Math.sqrt(x))),
	POWER: numbers(2, 2, (x, y) => arithmetic('^', x, y)),
	PI: numbers(0, 0, () => Math.PI),
	MOD: numbers(2, 2, (n, d) => {
		if (d === 0) return Errors.div0
		const product = d * Math.floor(significant15(n / d))
		// Rounding noise is no remainder: MOD(3.3, 1.1) is 0
		return approxEqual(n, product) ? 0 : n - product
	}),
	CEILING: numbers(2, 2, (n, significance) => {
		if (n === 0 || significance === 0) return 0
		if (n > 0 && significance < 0) return Errors.num
		return multiple(n, significance, Math.ceil)
	}),
	FLOOR: numbers(2, 2, (n, significance) => {
		if (n === 0) return 0
		if (significance === 0) return Errors.div0
		if (n > 0 && significance < 0) return Errors.num
		return multiple(n, significance, Math.floor)
	}),
	// Negative numbers round toward zero unless mode asks for away from it
	'CEILING.MATH': numbers(1, 3, (n, significance = 1, mode = 0) => {
		if (n === 0 || significance === 0) return 0
		return multiple(n, Math.abs(significance), n > 0 || mode === 0 ? Math.ceil : Math.floor)
	}),
	'FLOOR.MATH': numbers(1, 3, (n, significance = 1, mode = 0) => {
		if (n === 0 || significance === 0) return 0
		return multiple(n, Math.abs(significance), n > 0 || mode === 0 ? Math.floor : Math.ceil)
	}),
	SUM: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			let sum = 0
			return eachNumber(args, cx, (n) => (sum += n)) ?? sum
		},
	},
	PRODUCT: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			let product = 1
			let count = 0
			const failed = eachNumber(args, cx, (n) => {
				product *= n
				count++
			})
			return failed ?? (count === 0 ? 0 : product)
		},
	},
	// Entries that aren't numbers count as 0, TRUE included
	SUMPRODUCT: {
		min: 1,
		max: 255,
		kinds: 'r',
		call: (args, cx) => {
			const arrays: Matrix[] = []
			for (const arg of args) {
				if (arg instanceof Areas) return Errors.value
				arrays.push(arg instanceof Ref ? toMatrix(arg, cx) : isMatrix(arg) ? arg : [[arg]])
			}
			const rows = arrays[0].length
			const cols = arrays[0][0].length
			if (arrays.some((array) => array.length !== rows || array[0].length !== cols)) return Errors.value
			let sum = 0
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					let product = 1
					for (const array of arrays) {
						const value = array[r][c]
						if (isError(value)) return value
						product *= typeof value === 'number' ? value : 0
					}
					sum += product
				}
			}
			return sum
		},
	},
}
