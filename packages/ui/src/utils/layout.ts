import {useSyncExternalStore} from 'react'

export const screens = {
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	'2xl': 1400,
}

type Breakpoint = keyof typeof screens

/** Under this height a window is as short as a phone on its side: the `low` variant in index.css */
const LOW_BELOW_H = 500

// One reading of the window for every layout that asks: which of Tailwind's
// `screens` it is as wide as, and whether it is `low`. A layout is half its
// classes and half what is rendered for a phone, a tablet or a desktop, and
// the two must not be of different minds, so the reading is CSS's own: the
// media queries `sm:` to `2xl:` and `low` are made of, in px as they are there
// (tailwind.config.ts gives Tailwind these same `screens` as px; a rem would
// follow the browser's own font size). window.innerWidth is not what CSS goes
// by on an iPad: it is the width of what is on screen, a third of the window's
// with the page pinched to three times its size, and no resize is sent for that.
//
// It is one number, a bit for each line, so that whoever asks, and whenever,
// is answered from one moment. Several readings told of a change one after
// another had React rendering between them: a desktop's window narrowed to a
// tablet's was a phone for that one render, and a window became a drawer and
// a window again, losing what was typed in it. And a component asking only
// one of them was never told of a change that the others had crossed first.
const ascending = (Object.entries(screens) as [Breakpoint, number][]).sort((a, b) => a[1] - b[1])
const narrowest = ascending[0][0]

/** At least as wide as each of `screens` */
export const WIDE = Object.fromEntries(ascending.map(([name], i) => [name, 1 << i])) as Record<Breakpoint, number>
/** As short as a phone on its side */
export const LOW = 1 << ascending.length
/** The same, as it was before the on-screen keyboard came up */
export const HELD_LOW = LOW << 1
const WIDTHS = LOW - 1

// The queries are kept for as long as the app runs: one nobody holds may be
// collected, its listener with it. A window that can't be asked (a test's has
// no matchMedia, or a stand-in that answers nothing) is read by its size instead.
const asked =
	typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? [...ascending.map(([, minWidth]) => `(min-width: ${minWidth}px)`), `(height < ${LOW_BELOW_H}px)`].map((query) =>
				window.matchMedia(query),
			)
		: []
const queries =
	asked.length > 0 &&
	asked.every((query) => typeof query?.matches === 'boolean' && typeof query.addEventListener === 'function')
		? asked
		: undefined

type Size = {width: number; height: number}

// How long a keyboard that is no longer being typed on may take to go away
const KEYBOARD_GONE_MS = 1000

/** Whether focus is somewhere that brings up the on-screen keyboard */
function isTyping() {
	const el = document.activeElement
	return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea'))
}

// HELD_LOW is LOW, except that it keeps its answer when the window gets
// shorter, but no narrower, while something is focused for typing: that's the
// keyboard coming up (in the Android app it shrinks the window; in Safari it
// doesn't). It stays held until the window is back to its height, as the
// keyboard animates away after a tap elsewhere, or turns. `size` is the
// window's before the keyboard, only read to tell the keyboard by: what CSS
// lays the page out in, which a pinch doesn't change. (Less a scrollbar's
// width, which is no matter here: it is only compared with itself.)
let size: Size = {width: 0, height: 0}
let keyboardUp = false
let heldLow = false
let goneTimer: ReturnType<typeof setTimeout> | undefined

let layout = 0
const listeners = new Set<() => void>()

// The only place the window is read, and never while rendering
function read() {
	let next = 0
	let now: Size
	if (queries) {
		queries.forEach((query, i) => {
			if (query.matches) next |= 1 << i
		})
		now = {width: document.documentElement.clientWidth, height: document.documentElement.clientHeight}
	} else {
		now = {width: window.innerWidth, height: window.innerHeight}
		ascending.forEach(([, minWidth], i) => {
			if (now.width >= minWidth) next |= 1 << i
		})
		if (now.height < LOW_BELOW_H) next |= LOW
	}
	const low = (next & LOW) !== 0
	// A browser may say a line is crossed before the size has moved, or (Safari,
	// in a resize) the other way round: no narrower means neither says so
	const sameWidth = now.width === size.width && (next & WIDTHS) === (layout & WIDTHS)
	const shorter = now.height < size.height || (low && !heldLow && now.height === size.height)
	const wasUp = keyboardUp
	keyboardUp = sameWidth && shorter && (keyboardUp || isTyping())
	if (!keyboardUp) {
		size = now
		// A hold let go of in Safari's resize has the new size and the old
		// queries: low only if both say so. (A height is rounded here, and 499.5
		// is 500: the query is believed at the line itself.)
		heldLow = low && (!wasUp || now.height <= LOW_BELOW_H)
	}
	return heldLow ? next | HELD_LOW : next
}

function update() {
	const next = read()
	// A keyboard put away may leave the window shorter than it found it (a
	// toolbar back in view), and nothing would say it is gone: with nobody
	// typing and the window still for a while, it is
	clearTimeout(goneTimer)
	if (keyboardUp && !isTyping()) {
		goneTimer = setTimeout(() => {
			// (A test's window may be gone by now)
			if (typeof document === 'undefined') return
			keyboardUp = false
			update()
		}, KEYBOARD_GONE_MS)
	}
	if (next === layout) return
	layout = next
	for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
	layout = read()
	// The queries say when a line is crossed. The rest is for the keyboard's
	// sake, which may cross none, and for anything missed: every way the window
	// is known to change, or to have changed while the page was put away.
	const heard: [EventTarget, string][] = [
		...(queries ?? []).map((query): [EventTarget, string] => [query, 'change']),
		...['resize', 'orientationchange', 'pageshow', 'focusout'].map((event): [EventTarget, string] => [window, event]),
		[document, 'visibilitychange'],
		...(window.visualViewport ? [[window.visualViewport, 'resize'] as [EventTarget, string]] : []),
	]
	for (const [target, event] of heard) target.addEventListener(event, update)
	// (An edit to this file in development leaves this reading behind for a new one)
	import.meta.hot?.dispose(() => {
		for (const [target, event] of heard) target.removeEventListener(event, update)
		clearTimeout(goneTimer)
	})
}

function subscribe(onChange: () => void) {
	listeners.add(onChange)
	return () => {
		listeners.delete(onChange)
	}
}

/**
 * A hook answering one thing about the window from the reading above. Its
 * users render again when that answer changes, and only then.
 */
export function layoutHook<T extends string | boolean>(pick: (layout: number) => T) {
	const get = () => pick(layout)
	// With no window to read, the narrowest there is
	const getOnServer = () => pick(0)
	return function useLayout() {
		return useSyncExternalStore(subscribe, get, getOnServer)
	}
}

/** The widest of `screens` the window is at least as wide as, and `sm` for anything narrower than that too */
export const useBreakpoint = layoutHook((layout) =>
	ascending.reduce<Breakpoint>((name, [next]) => (layout & WIDE[next] ? next : name), narrowest),
)
