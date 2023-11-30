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
 * Does what lodash's keyBy does, but returns with better types
 */
export function keyBy<T, U extends keyof T>(array: ReadonlyArray<T>, key: U): Record<T[U] & string, T> {
	return indexBy(array, (el) => el[key])
}

export function portToUrl(port: number) {
	return `${location.protocol}//${location.hostname}:${port}`
}

export function preloadImage(url: string) {
	const img = new Image()
	img.src = url
}

export function transitionViewIfSupported(cb: () => void) {
	if (document.startViewTransition) {
		document.startViewTransition(cb)
	} else {
		cb()
	}
}

export function isWindows() {
	return /Win/i.test(navigator.userAgent)
}

export function isLinux() {
	return /Linux/i.test(navigator.userAgent)
}

export function isMac() {
	return /Mac/i.test(navigator.userAgent)
}

export function platform() {
	if (isWindows()) return 'windows'
	if (isLinux()) return 'linux'
	if (isMac()) return 'mac'
	return 'other'
}

export function cmdOrCtrl() {
	return isMac() ? '⌘' : 'Ctrl+'
}
