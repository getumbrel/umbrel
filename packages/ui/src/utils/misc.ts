import {indexBy} from 'remeda'

import {UserApp} from '@/trpc/trpc'

export function fixmeAlert() {
	alert('fixme')
}

export const fixmeHandler = () => fixmeAlert()

export function firstNameFromFullName(name: string) {
	return name.split(' ')[0]
}

export function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isNormalNumber(value: number | null | undefined): value is number {
	if (value === undefined || value === null) return false
	return value !== Infinity && value !== -Infinity && !isNaN(value)
}

// https://stackoverflow.com/a/39419171
export function assertUnreachable(x: never): never {
	throw new Error("Didn't expect to get here, got " + x)
}

/**
 * Does what lodash's keyBy does, but returns with better types
 */
export function keyBy<T, U extends keyof T>(array: ReadonlyArray<T>, key: U): Record<T[U] & string, T> {
	return indexBy(array, (el) => el[key])
}

// Not using `url-join` or others because they remove desired slashes after joining. `new URL('?bla=1', 'http://localhost:3001/a/').href` preserves trailing slash to return 'http://localhost:3001/a/?bla=1'
// The `transmission` app depends on this behavior because the app's full path is `http://localhost:9091/transmission/web/` but when joining a query string, we want it to be `http://localhost:9091/transmission/web/?bla=1`
export function urlJoin(base: string, path: string) {
	return new URL(path, base).href
}

/** `urlJoin` doesn't work when used like so: `urlJoin('foo', 'bar')`, and sometimes we just want basic behavior */
export function pathJoin(base: string, path: string) {
	// Remove trailing slash from base and leading slash from path
	return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

export function appToUrl(app: UserApp) {
	return isOnionPage()
		? `${location.protocol}//${app.hiddenService}`
		: `${location.protocol}//${location.hostname}:${app.port}`
}

export function appToUrlWithAppPath(app: UserApp) {
	return urlJoin(appToUrl(app), app.path ?? '')
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

// ---

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

// NOTE: in Chrome, this can be `true` when emulating a touch device
export const IS_ANDROID = /Android/i.test(navigator.userAgent)

export const IS_DEV = localStorage.getItem('debug') === 'true'

export function cmdOrCtrl() {
	return isMac() ? '⌘' : 'Ctrl+'
}
