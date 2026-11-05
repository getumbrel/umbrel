import {useEffect} from 'react'
import {create} from 'zustand'

import {useHomeFit} from './home-fit'

// How far a page must scroll one way before the dock answers
const SCROLL_SLOP_PX = 8
// Near the top of a page the dock is always out
const TOP_ZONE_PX = 24

export const useDockTuck = create<{tucked: boolean; setTucked: (tucked: boolean) => void}>()((set) => ({
	tucked: false,
	setTucked: (tucked) => set({tucked}),
}))

/**
 * On a phone on its side the dock covers a quarter of the screen, so inside an
 * app it tucks away as you scroll down and comes back as you scroll up. Panes
 * inside the page count too; sideways scrolling doesn't.
 */
export function useTuckDockOnScroll(scrollElement: HTMLElement | null) {
	const {low} = useHomeFit()
	const setTucked = useDockTuck((state) => state.setTucked)

	useEffect(() => {
		if (!scrollElement || !low) return
		const lastTop = new WeakMap<EventTarget, number>([[scrollElement, scrollElement.scrollTop]])
		const onScroll = (event: Event) => {
			const scroller = event.target
			if (!(scroller instanceof HTMLElement)) return
			const top = scroller.scrollTop
			const last = lastTop.get(scroller) ?? 0
			if (top === last) return
			if (top < TOP_ZONE_PX) {
				setTucked(false)
				lastTop.set(scroller, top)
				return
			}
			if (Math.abs(top - last) < SCROLL_SLOP_PX) return
			setTucked(top > last)
			lastTop.set(scroller, top)
		}
		// Scroll events don't bubble, but they can be caught on the way down
		scrollElement.addEventListener('scroll', onScroll, {passive: true, capture: true})
		return () => {
			scrollElement.removeEventListener('scroll', onScroll, {capture: true})
			setTucked(false)
		}
	}, [scrollElement, low, setTucked])
}
