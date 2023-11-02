import {indexBy} from 'remeda'

export function fixmeAlert() {
	alert('fixme')
}

export const fixmeHandler = () => fixmeAlert()

export function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isNormalNumber(value: number | null | undefined): value is number {
	if (value === undefined || value === null) return false
	return value !== Infinity && value !== -Infinity && !isNaN(value)
}

/**
 * Does what lodash's keyBy does, but returns with proper types
 */
export function keyBy<T>(array: ReadonlyArray<T>, key: keyof T) {
	if (array.length === 0) return {}
	return indexBy(array, (el) => el[key])
}
