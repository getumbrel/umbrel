import {useSyncExternalStore} from 'react'

/** Pairs with `.vscode/settings.json` to provide intellisense for tailwind classes:
 * ```json
 * "tailwindCSS.experimental.classRegex": [
 *     "tw`([^`]*)`"
 * ]
 * ```
 */
export const tw = (strings: TemplateStringsArray) => strings.join('')

export const screens = {
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	'2xl': 1400,
}

type Breakpoint = keyof typeof screens

// The widest of `screens` the window is at least as wide as, and `sm` for
// anything narrower than that too.
const ascending = (Object.entries(screens) as [Breakpoint, number][]).sort((a, b) => a[1] - b[1])
const narrowest = ascending[0][0]
const breakpointFor = (width: number) =>
	ascending.reduce<Breakpoint>((name, [next, minWidth]) => (width >= minWidth ? next : name), narrowest)

// One reading of the window's width for everything that asks, taken when the
// window is resized, and one resize listener for the app. This used to be
// react-use's createBreakpoint, which read window.innerWidth every time any
// component using it rendered (making the browser lay the page out there and
// then, if anything had changed) and, from an effect with no dependencies,
// set state and re-attached a resize listener of its own after every one of
// those renders. A long listing scrolling was spending over a third of its
// time in it, as every row asks whether it is on a phone.
let current: Breakpoint | undefined
const listeners = new Set<() => void>()
const read = () => (current = breakpointFor(window.innerWidth))

if (typeof window !== 'undefined') {
	window.addEventListener('resize', () => {
		const previous = current
		if (read() === previous) return
		for (const listener of listeners) listener()
	})
}

function subscribe(onChange: () => void) {
	listeners.add(onChange)
	return () => {
		listeners.delete(onChange)
	}
}

// With nothing listening yet there has been no resize to hear of, so the first to ask reads the width itself
const getBreakpoint = () => (listeners.size === 0 || current === undefined ? read() : current)

export const useBreakpoint = (): Breakpoint => useSyncExternalStore(subscribe, getBreakpoint, () => narrowest)
