import {useEffect, useImperativeHandle, useRef, useState, type Ref} from 'react'

import {t} from '@/utils/i18n'

import type {Controller} from './controller'
import {XK} from './keysyms'

// The system keyboard only comes up for a focused text field, and only while
// handling a touch. So one lives off-screen, and every edit in it is diffed
// into keystrokes: that way autocorrect, swipe typing, dictation and Android's
// composing keyboards all work, none of which send usable key events.
const SENTINEL = '_'.repeat(64)

const HARDWARE_KEYS: Record<string, number> = {
	Backspace: XK.BackSpace,
	Tab: XK.Tab,
	Enter: XK.Return,
	Escape: XK.Escape,
	Delete: XK.Delete,
	Home: XK.Home,
	End: XK.End,
	PageUp: XK.PageUp,
	PageDown: XK.PageDown,
	ArrowLeft: XK.Left,
	ArrowUp: XK.Up,
	ArrowRight: XK.Right,
	ArrowDown: XK.Down,
}

export type KeyboardSinkHandle = {focus: () => void; blur: () => void}

export function KeyboardSink({controller, ref}: {controller: Controller; ref: Ref<KeyboardSinkHandle>}) {
	const input = useRef<HTMLTextAreaElement>(null)
	const previous = useRef(SENTINEL)

	useImperativeHandle(ref, () => ({
		focus: () => input.current?.focus({preventScroll: true}),
		blur: () => input.current?.blur(),
	}))

	useEffect(() => {
		const element = input.current
		if (!element) return
		const reset = () => {
			element.value = SENTINEL
			element.setSelectionRange(SENTINEL.length, SENTINEL.length)
			previous.current = SENTINEL
		}
		reset()

		const onInput = () => {
			const before = previous.current
			const after = element.value
			let common = 0
			while (common < before.length && common < after.length && before[common] === after[common]) common++
			for (let index = 0; index < before.length - common; index++) controller.tapKey(XK.BackSpace)
			if (after.length > common) controller.typeText(after.slice(common))
			previous.current = after
			// Backspace needs text to delete, or a phone keyboard sends nothing at all
			if (after.length < 8 || after.length > 256) reset()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || event.keyCode === 229) return
			// Hardware keyboards report physical keys; software keyboards leave this
			// empty and go through the diff above
			const named = HARDWARE_KEYS[event.key]
			const isHardware = event.code !== '' && event.code !== 'Unidentified'
			if (!isHardware) {
				if (named && event.key !== 'Enter' && event.key !== 'Backspace') {
					event.preventDefault()
					controller.tapKey(named)
				}
				return
			}
			if (event.metaKey) return
			event.preventDefault()
			// Everything typed is the machine's, not the page around it
			event.stopPropagation()
			if (named) controller.tapKey(named)
			else if (event.key.length === 1) {
				if (event.ctrlKey) controller.chord(XK.Control, event.key.toLowerCase().charCodeAt(0))
				else if (event.altKey) controller.chord(XK.Alt, event.key.toLowerCase().charCodeAt(0))
				else controller.typeText(event.key)
			}
		}
		// A keyboard on a desk types straight away, with nothing raised first
		const onDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLTextAreaElement) return
			onKeyDown(event)
		}
		element.addEventListener('input', onInput)
		element.addEventListener('keydown', onKeyDown)
		document.addEventListener('keydown', onDocumentKeyDown, true)
		return () => {
			element.removeEventListener('input', onInput)
			element.removeEventListener('keydown', onKeyDown)
			document.removeEventListener('keydown', onDocumentKeyDown, true)
		}
	}, [controller])

	return (
		<textarea
			ref={input}
			aria-label={t('machines.touch-keyboard')}
			autoCapitalize='off'
			autoComplete='off'
			autoCorrect='off'
			spellCheck={false}
			enterKeyHint='enter'
			// 16px or iOS zooms the page to it. At the top of the layout viewport so
			// iOS has no reason to scroll anything into view for it.
			className='fixed top-0 left-0 z-[-1] size-px resize-none border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent opacity-0 outline-none'
		/>
	)
}

export type Glass = {
	width: number
	height: number
	keyboard: number
	safe: {top: number; right: number; bottom: number; left: number}
}

function readSafeArea(probe: HTMLElement) {
	const style = getComputedStyle(probe)
	return {
		top: parseFloat(style.paddingTop) || 0,
		right: parseFloat(style.paddingRight) || 0,
		bottom: parseFloat(style.paddingBottom) || 0,
		left: parseFloat(style.paddingLeft) || 0,
	}
}

// The usable glass and the keyboard over it. visualViewport is the only honest
// source on iOS, where the keyboard overlays the page without resizing it.
export function useGlass() {
	const [glass, setGlass] = useState<Glass>(() => ({
		width: window.innerWidth,
		height: window.innerHeight,
		keyboard: 0,
		safe: {top: 0, right: 0, bottom: 0, left: 0},
	}))

	useEffect(() => {
		const probe = document.createElement('div')
		probe.style.cssText =
			'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
		document.body.append(probe)
		const viewport = window.visualViewport
		const update = () => {
			const layoutHeight = document.documentElement.clientHeight
			const visible = viewport ? viewport.height + viewport.offsetTop : layoutHeight
			// Pinned chrome can leave a few points of difference; a keyboard is tall
			const keyboard = Math.max(0, layoutHeight - visible)
			const width = window.innerWidth
			const safe = readSafeArea(probe)
			setGlass((current) => {
				const next = {width, height: layoutHeight, keyboard: keyboard > 40 ? keyboard : 0, safe}
				return JSON.stringify(current) === JSON.stringify(next) ? current : next
			})
			// iOS may still nudge the page up for a focused field
			if (window.scrollY) window.scrollTo(0, 0)
		}
		update()
		viewport?.addEventListener('resize', update)
		viewport?.addEventListener('scroll', update)
		window.addEventListener('resize', update)
		window.addEventListener('orientationchange', update)
		return () => {
			probe.remove()
			viewport?.removeEventListener('resize', update)
			viewport?.removeEventListener('scroll', update)
			window.removeEventListener('resize', update)
			window.removeEventListener('orientationchange', update)
		}
	}, [])

	return glass
}

// The Clipboard API needs HTTPS, and umbrelOS is usually plain HTTP. What's left
// is the copy command, which Safari only honours on a real selection, inside a
// tap. A span can be selected without touching focus, so the keyboard stays put.
export function copyToDevice(text: string) {
	const span = document.createElement('span')
	span.textContent = text
	span.style.cssText = 'position:fixed;top:0;left:0;white-space:pre;opacity:0;user-select:text;-webkit-user-select:text'
	document.body.append(span)
	const selection = window.getSelection()
	const range = document.createRange()
	range.selectNodeContents(span)
	selection?.removeAllRanges()
	selection?.addRange(range)
	let copied = false
	try {
		copied = document.execCommand('copy')
	} catch {
		// Falls through to the API below
	}
	selection?.removeAllRanges()
	span.remove()
	if (!copied) void navigator.clipboard?.writeText(text).catch(() => {})
	return copied
}
