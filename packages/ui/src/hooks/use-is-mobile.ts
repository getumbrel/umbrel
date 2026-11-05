import {useSyncExternalStore} from 'react'

import {homeFit, useHomeFit} from '@/modules/desktop/home-fit'
import {useBreakpoint} from '@/utils/tw'

// Made for the '/settings' page, but probably useful elsewhere.
export function useIsMobile() {
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'

	return isMobile
}

export function useIsSmallMobile() {
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm'

	return isMobile
}

// Phone-sized, upright or sideways. Below this a centred window has no room, so
// screens open as drawers. Tablets and foldables are mobile, but not phones.
//
// It ignores the on-screen keyboard. In the Android app the keyboard shrinks the
// window, so typing in a window on a foldable's inner display or a tablet on its
// side made it short enough to count as a phone: the window turned into a drawer
// under the user's fingers, and the field they were typing in lost its focus.
export function useIsPhone() {
	const isMobile = useIsMobile()
	const {phoneScale} = homeFit(useSyncExternalStore(subscribeSettledSize, getSettledSize))

	return isMobile && phoneScale
}

// The same, following the window as it is, keyboard and all. For layouts that
// have to agree with the `low` and `phone-side` variants in index.css.
export function useIsPhoneNow() {
	const isMobile = useIsMobile()
	const {phoneScale} = useHomeFit()

	return isMobile && phoneScale
}

/** Whether focus is somewhere that brings up the on-screen keyboard */
function isTyping() {
	const el = document.activeElement
	return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea'))
}

type Size = {width: number; height: number}

const windowSize = (): Size => ({width: window.innerWidth, height: window.innerHeight})

// The window's size, except that it keeps its height when the window gets
// shorter, but no narrower, while something is focused for typing: that's the
// keyboard coming up. It stays held until the window is back to its height, as
// the keyboard animates away after a tap elsewhere, or turns.
// It listens from the start, so it knows the height from before the keyboard.
let settledSize: Size = typeof window === 'undefined' ? {width: 0, height: 0} : windowSize()
let keyboardUp = false
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
	window.addEventListener('resize', () => {
		const next = windowSize()
		const {width, height} = settledSize
		keyboardUp = next.width === width && next.height < height && (keyboardUp || isTyping())
		if (keyboardUp || (next.width === width && next.height === height)) return
		settledSize = next
		for (const listener of listeners) listener()
	})
}

const getSettledSize = () => settledSize

function subscribeSettledSize(onChange: () => void) {
	listeners.add(onChange)
	return () => {
		listeners.delete(onChange)
	}
}
