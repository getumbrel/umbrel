import {useEffect} from 'react'

// A scrollbar or a sliver of browser chrome can take a few pixels off the
// visual viewport. A keyboard, or the bar iOS shows for a hardware one, is taller
const MIN_KEYBOARD_HEIGHT = 40
// With less left than this (a phone on its side) there's nothing to lay a
// drawer out in
const MIN_ROOM = 200
// Under this much room a drawer lays out as it does on a short screen, where
// the `low` variant in index.css takes over
const LOW_HEIGHT = 500
// Kept clear around the field being typed in
const BREATHING_ROOM = 16

/**
 * Keeps a drawer, and the field being typed in, clear of the on-screen keyboard.
 *
 * On iOS, and in Chrome on Android, the keyboard covers the foot of the page
 * instead of resizing it, and a drawer is fixed to that foot. What still shows
 * is the visual viewport, which the browser may also have panned to bring the
 * field up. So the drawer is told where that starts and ends (`--visible-top`,
 * `--visible-bottom`) and lays itself out inside it: `data-keyboard` while
 * the keyboard is up, `data-low` while what's left is as short as a phone on
 * its side. Nothing is written that has to be put back afterwards.
 *
 * Where the keyboard resizes the window instead (the Android app) nothing is
 * covered, and the drawer already follows the window. And where the keyboard
 * leaves next to nothing (a phone on its side) the drawer stays as it is, and
 * the browser pans the field into what's left, as it does for a window.
 *
 * Either way the field ends up with less room than it had, so it's scrolled
 * back into view along with what describes it (its error), and kept there
 * while things around it change size (the keyboard arriving, a row opening
 * under it).
 *
 * This replaces vaul's `repositionInputs`, which sized the drawer from the
 * first of the keyboard's resize events only, left a fixed height behind once
 * the keyboard had gone, and scrolled the field to the top of its list or not
 * at all.
 */
export function useStayAboveKeyboard(drawer: HTMLElement | null) {
	useEffect(() => {
		const viewport = window.visualViewport
		if (!drawer || !viewport) return

		const reveal = () => {
			const field = typingField()
			if (!field || !drawer.contains(field)) return
			// The drawer is all in view, so what shows of a scroller is what's inside it
			const shown = drawer.getBoundingClientRect()
			for (let el = field.parentElement; el && drawer.contains(el); el = el.parentElement) {
				if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue
				const box = el.getBoundingClientRect()
				el.scrollTop += revealOffset(withDescription(field), {
					top: Math.max(box.top, shown.top),
					bottom: Math.min(box.bottom, shown.bottom),
				})
			}
		}

		// Whatever sits between the field and the drawer: any of it resizing can
		// move the field, or change how much of its scroller shows
		const resizes = new ResizeObserver(reveal)
		const watchField = () => {
			resizes.disconnect()
			const field = typingField()
			if (!field || !drawer.contains(field)) return
			for (let el = field.parentElement; el && drawer.contains(el); el = el.parentElement) resizes.observe(el)
		}

		const update = () => {
			const page = document.documentElement.clientHeight
			// Zoomed in, the visual viewport is smaller for a reason of its own
			const covered = viewport.scale < 1.01 && page - viewport.height > MIN_KEYBOARD_HEIGHT
			const keyboard = covered && viewport.height >= MIN_ROOM
			const top = keyboard ? Math.max(0, viewport.offsetTop) : 0
			const bottom = keyboard ? Math.max(0, page - top - viewport.height) : 0
			drawer.style.setProperty('--visible-top', `${top}px`)
			drawer.style.setProperty('--visible-bottom', `${bottom}px`)
			drawer.toggleAttribute('data-keyboard', keyboard)
			drawer.toggleAttribute('data-low', keyboard && viewport.height < LOW_HEIGHT)
			reveal()
		}

		update()
		watchField()
		viewport.addEventListener('resize', update)
		viewport.addEventListener('scroll', update)
		drawer.addEventListener('focusin', watchField)
		drawer.addEventListener('focusout', watchField)
		return () => {
			resizes.disconnect()
			viewport.removeEventListener('resize', update)
			viewport.removeEventListener('scroll', update)
			drawer.removeEventListener('focusin', watchField)
			drawer.removeEventListener('focusout', watchField)
		}
	}, [drawer])
}

/** The focused element, if it's one that brings up the on-screen keyboard */
function typingField() {
	const el = document.activeElement
	return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea')) ? el : null
}

type Span = {top: number; bottom: number}

/** A field's extent, down to the end of whatever it names as describing it */
function withDescription(field: HTMLElement): Span {
	const {top, bottom} = field.getBoundingClientRect()
	const ids = field.getAttribute('aria-describedby')?.split(/\s+/) ?? []
	const bottoms = ids.map((id) => document.getElementById(id)?.getBoundingClientRect().bottom ?? bottom)
	return {top, bottom: Math.max(bottom, ...bottoms)}
}

/**
 * How far a scroller has to scroll for `field` to show inside `room`, the part
 * of the scroller that's in view, with some breathing room where there is any.
 * It moves no further than it has to, and a field taller than the room keeps
 * its top in view.
 */
export function revealOffset(field: Span, room: Span) {
	const spare = room.bottom - room.top - (field.bottom - field.top)
	const margin = Math.max(0, Math.min(BREATHING_ROOM, spare / 2))
	const pastBottom = Math.max(0, field.bottom - (room.bottom - margin))
	const aboveTop = field.top - (room.top + margin)
	return Math.min(pastBottom, aboveTop)
}
