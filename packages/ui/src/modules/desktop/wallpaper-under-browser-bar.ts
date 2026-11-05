import {useEffect} from 'react'

import {IS_IPHONE_BROWSER} from '@/utils/misc'

// Shorter than this is the bar iOS shows for a hardware keyboard, not a keyboard
const MIN_KEYBOARD_HEIGHT = 160

/**
 * Safari on an iPhone floats its bar over the bottom of the screen, but draws only
 * the page itself under it. The wallpaper is a fixed layer, so it stopped at the
 * bar and Safari filled the band below with the theme colour. While Home is
 * uncovered nothing on it scrolls, so the wallpaper can be page content instead,
 * as tall as the screen (see useWallpaperHeight), and carry on under the bar.
 *
 * That makes the page taller than the window, and code can scroll a page even
 * when people can't (a `scrollIntoView`, a focused field), which would lift Home
 * off the dock. Any such scroll goes straight back, except while a keyboard is up:
 * iOS pans the page then to keep the field in sight, as it always has.
 */
export function useWallpaperUnderBrowserBar(enabled: boolean) {
	useEffect(() => {
		if (!enabled || !IS_IPHONE_BROWSER) return
		const root = document.documentElement
		const viewport = window.visualViewport
		root.setAttribute('data-wallpaper-under-bar', '')
		const settle = () => {
			const keyboardUp = !!viewport && root.clientHeight - viewport.height > MIN_KEYBOARD_HEIGHT
			if ((window.scrollX || window.scrollY) && !keyboardUp) window.scrollTo(0, 0)
		}
		settle()
		window.addEventListener('scroll', settle)
		viewport?.addEventListener('resize', settle)
		const stopClearingBar = keepBrowserBarClear()
		return () => {
			stopClearingBar()
			root.removeAttribute('data-wallpaper-under-bar')
			window.removeEventListener('scroll', settle)
			viewport?.removeEventListener('resize', settle)
		}
	}, [enabled])
}

/**
 * Safari still fills that band when it finds a fixed layer about as wide as the
 * window at the middle of its bottom edge, and keeps it for as long as that layer
 * lives, even once it has moved away. The dock's row reaches down there, and Safari
 * also carries a band over from the page before a reload or a new tab.
 *
 * Safari passes over an empty layer, unless it takes pointer events, and then looks
 * no further. So an empty strip along the edge, below the dock, keeps it from finding
 * anything there. A faint strip over it for a couple of frames first takes the place
 * of a band carried over, and then it's gone.
 */
function keepBrowserBarClear() {
	const strip = (height: number, background: string) => {
		const el = document.createElement('div')
		el.setAttribute('aria-hidden', 'true')
		el.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${height}px;z-index:2147483647;background:${background}`
		return el
	}
	// Shorter than the dock's gap to the edge, so it only covers wallpaper
	const shield = strip(8, 'transparent')
	// Taller than the 10px Safari ignores, and just visible enough for it to count
	const probe = strip(12, 'rgb(0 0 0 / 0.01)')
	probe.style.pointerEvents = 'none'
	document.body.append(shield)
	let frame = requestAnimationFrame(() => {
		document.body.append(probe)
		frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => probe.remove())
		})
	})
	return () => {
		cancelAnimationFrame(frame)
		probe.remove()
		shield.remove()
	}
}
