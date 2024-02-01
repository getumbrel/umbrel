import {indexBy} from 'remeda'
import urlJoin from 'url-join'

import {AppState, UserApp} from '@/trpc/trpc'

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

export function appToUrl(app: UserApp) {
	const baseUrl = app.torOnly
		? `${location.protocol}//${app.hiddenService}:${app.port}`
		: `${location.protocol}//${location.hostname}:${app.port}`

	return urlJoin(baseUrl, app.path ?? '')
}

export function isOnionPage() {
	return window.location.origin.indexOf('.onion') !== -1
}

export function preloadImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image()
		const handleLoad = () => {
			img.removeEventListener('load', handleLoad)
			resolve()
		}
		img.addEventListener('load', handleLoad)
		img.src = url
	})
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

export const progressStates = [
	'installing',
	'uninstalling',
	'updating',
	'offline',
] as const satisfies readonly AppState[]
