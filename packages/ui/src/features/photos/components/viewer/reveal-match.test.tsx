// @vitest-environment jsdom

import {act, useRef, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {revealTop, useRevealMatch} from './reveal-match'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('revealTop', () => {
	const view = {scrollTop: 0, top: 100, height: 600, scrollHeight: 2000}

	test('leaves a target that is comfortably in view where it is', () => {
		expect(revealTop(view, {top: 300, height: 40})).toBe(0)
	})

	test('brings a target below the fold to a third of the way down', () => {
		// 900px into the view: its middle (920) goes to 200 down
		expect(revealTop(view, {top: 1000, height: 40})).toBe(720)
	})

	test('brings back one scrolled past, and never past either end', () => {
		expect(revealTop({...view, scrollTop: 800}, {top: 60, height: 20})).toBe(570)
		expect(revealTop({...view, scrollTop: 300}, {top: -200, height: 20})).toBe(0)
		expect(revealTop(view, {top: 2400, height: 40})).toBe(1400)
	})
})

describe('useRevealMatch', () => {
	let host: HTMLDivElement
	let root: Root
	let frames: FrameRequestCallback[]
	const flush = () =>
		act(() => {
			const pending = frames
			frames = []
			for (const frame of pending) frame(0)
		})

	beforeEach(() => {
		frames = []
		vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
		vi.stubGlobal('cancelAnimationFrame', () => {})
		host = document.createElement('div')
		document.body.append(host)
		root = createRoot(host)
	})
	afterEach(() => {
		act(() => root.unmount())
		host.remove()
		vi.unstubAllGlobals()
	})

	// A 600px view of 2000px of content, the match (when there is one) 900px down
	function Panel({item, wanted, children}: {item: string; wanted: boolean; children?: ReactNode}) {
		const ref = useRef<HTMLDivElement>(null)
		useRevealMatch(ref, item, wanted)
		return (
			<div
				ref={(element) => {
					ref.current = element
					if (!element) return
					Object.defineProperty(element, 'scrollHeight', {value: 2000, configurable: true})
					element.getBoundingClientRect = () => ({top: 0, height: 600}) as DOMRect
				}}
			>
				{children}
			</div>
		)
	}
	const match = (
		<p
			data-match-target=''
			ref={(element) => {
				// Where it is depends on how far the view is scrolled
				if (element)
					element.getBoundingClientRect = () => ({top: 900 - element.parentElement!.scrollTop, height: 20}) as DOMRect
			}}
		/>
	)
	const scroller = () => host.firstElementChild as HTMLElement

	test('scrolls to a match that only arrives after the panel opened', () => {
		act(() => root.render(<Panel item='a' wanted />))
		flush()
		expect(scroller().scrollTop).toBe(0)
		// Search answers: the card with the match appears
		act(() =>
			root.render(
				<Panel item='a' wanted>
					{match}
				</Panel>,
			),
		)
		flush()
		expect(scroller().scrollTop).toBe(710)
	})

	test('scrolls once, and leaves the reader’s own scrolling alone after', () => {
		act(() =>
			root.render(
				<Panel item='a' wanted>
					{match}
				</Panel>,
			),
		)
		flush()
		scroller().scrollTop = 40
		act(() =>
			root.render(
				<Panel item='a' wanted>
					{match}
				</Panel>,
			),
		)
		flush()
		expect(scroller().scrollTop).toBe(40)
	})

	test('starts the next item at the top, and scrolls again for its match', () => {
		act(() => root.render(<Panel item='a' wanted />))
		scroller().scrollTop = 500
		act(() => root.render(<Panel item='b' wanted={false} />))
		expect(scroller().scrollTop).toBe(0)
		act(() =>
			root.render(
				<Panel item='c' wanted>
					{match}
				</Panel>,
			),
		)
		flush()
		expect(scroller().scrollTop).toBe(710)
	})
})
