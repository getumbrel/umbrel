import {useSyncExternalStore} from 'react'

// Larger text and increased contrast. Like the text size on a phone these belong
// to the screen in front of you, not to the account, so they live in this
// browser and already apply on the login screen.

const TEXT_SIZE_KEY = 'umbrel-text-size'
const CONTRAST_KEY = 'umbrel-increase-contrast'

/**
 * Pixels added to every text size, smallest step first (see --text-boost in
 * index.css). Added rather than multiplied, as Dynamic Type does: small text
 * gains the most, where it matters, and titles barely move, so layouts hold.
 */
export const TEXT_SIZES = [0, 1, 2, 3, 4] as const

// Optional so test environments without matchMedia can import this
const systemContrast = window.matchMedia?.('(prefers-contrast: more)')

// Storage can be unavailable (blocked site data); the settings then last for the visit
function read(key: string) {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Not saved
	}
}

function readTextSize() {
	const index = Number(read(TEXT_SIZE_KEY))
	return Number.isInteger(index) && index >= 0 && index < TEXT_SIZES.length ? index : 0
}

// Follows the device's own "Increase contrast" until it's chosen here
function readIncreaseContrast() {
	const stored = read(CONTRAST_KEY)
	return stored === null ? (systemContrast?.matches ?? false) : stored === 'true'
}

let textSize = readTextSize()
let increaseContrast = readIncreaseContrast()
const listeners = new Set<() => void>()

function apply() {
	const root = document.documentElement
	root.style.setProperty('--text-boost', `${TEXT_SIZES[textSize]}px`)
	root.toggleAttribute('data-increase-contrast', increaseContrast)
}

function commit() {
	apply()
	for (const listener of listeners) listener()
}

apply()

// Another tab changed them, or the device's own setting did
function reload() {
	textSize = readTextSize()
	increaseContrast = readIncreaseContrast()
	commit()
}
window.addEventListener('storage', reload)
systemContrast?.addEventListener('change', reload)

function subscribe(onChange: () => void) {
	listeners.add(onChange)
	return () => listeners.delete(onChange)
}

/** The step in TEXT_SIZES, and its setter */
export function useTextSize(): [number, (index: number) => void] {
	const index = useSyncExternalStore(subscribe, () => textSize)
	return [
		index,
		(index) => {
			textSize = index
			write(TEXT_SIZE_KEY, String(index))
			commit()
		},
	]
}

/** The pixels every text size has gained, for layouts that are measured in script */
export function useLargerText() {
	return TEXT_SIZES[useSyncExternalStore(subscribe, () => textSize)]
}

export function useIncreaseContrast(): [boolean, (enabled: boolean) => void] {
	const enabled = useSyncExternalStore(subscribe, () => increaseContrast)
	return [
		enabled,
		(enabled) => {
			increaseContrast = enabled
			write(CONTRAST_KEY, String(enabled))
			commit()
		},
	]
}
