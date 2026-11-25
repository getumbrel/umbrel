// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {clickSelectedText, transcriptText} from '@/features/search/transcript'

import {DetectedText, Transcript} from './item-insights'

const copied = vi.fn()
vi.mock('react-use', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-use')>()),
	useCopyToClipboard: () => [{}, copied],
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const transcript = [
	{startMs: 0, endMs: 4000, text: 'Okay, we are rolling.'},
	{startMs: 8000, endMs: 12_000, text: ' We took the first gondola up at 8.15. '},
	{startMs: 29_984, endMs: 33_744, text: 'Jonas just went down the black diamond run.'},
]

let host: HTMLDivElement
let root: Root
let video: HTMLVideoElement
let play: ReturnType<typeof vi.fn>

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	vi.stubGlobal('requestAnimationFrame', () => 0)
	vi.stubGlobal('cancelAnimationFrame', () => {})
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	video = document.createElement('video')
	play = vi.fn(() => Promise.resolve())
	video.play = play as unknown as HTMLVideoElement['play']
	Element.prototype.scrollTo = () => {}
	copied.mockClear()
	act(() => root.render(<Transcript transcript={transcript} video={video} />))
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
	window.getSelection()?.removeAllRanges()
	vi.unstubAllGlobals()
})

const lines = () => [...host.querySelectorAll<HTMLElement>('[data-lyric]')]
const words = (index: number) => lines()[index]!.querySelector('[data-word]')!.firstChild!
const select = (from: Node, to: Node) => {
	const range = document.createRange()
	range.setStart(from, 1)
	range.setEnd(to, 2)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)
}
const key = (element: HTMLElement, name: string, init: KeyboardEventInit = {}) =>
	act(
		() =>
			void element.dispatchEvent(new KeyboardEvent('keydown', {key: name, bubbles: true, cancelable: true, ...init})),
	)

describe('transcriptText', () => {
	test('is the words alone, a line for each thing said', () => {
		expect(transcriptText(transcript)).toBe(
			'Okay, we are rolling.\nWe took the first gondola up at 8.15.\nJonas just went down the black diamond run.',
		)
	})

	test('leaves out lines with nothing said in them', () => {
		expect(transcriptText([{text: 'One.'}, {text: '  '}, {text: 'Two.'}])).toBe('One.\nTwo.')
	})
})

describe('clickSelectedText', () => {
	const inside = document.createElement('div')
	const text = inside.appendChild(document.createTextNode('words'))
	const outside = document.createTextNode('elsewhere')
	const selected = {isCollapsed: false, anchorNode: text, focusNode: text}
	const click = {detail: 1, clientX: 100, clientY: 100}
	const dragged = {x: 40, y: 96}

	test('is false with nothing selected, or a selection somewhere else', () => {
		expect(clickSelectedText(click, dragged, null, inside)).toBe(false)
		expect(clickSelectedText(click, dragged, {...selected, isCollapsed: true}, inside)).toBe(false)
		expect(
			clickSelectedText(click, dragged, {isCollapsed: false, anchorNode: outside, focusNode: outside}, inside),
		).toBe(false)
	})

	test('is true at the end of a drag that selected text inside', () => {
		expect(clickSelectedText(click, dragged, selected, inside)).toBe(true)
		expect(clickSelectedText(click, dragged, {...selected, anchorNode: outside}, inside)).toBe(true)
	})

	test('is true for the double-click that selects a word', () => {
		expect(clickSelectedText({...click, detail: 2}, {x: 100, y: 100}, selected, inside)).toBe(true)
	})

	test('is false for a plain click while words are still selected', () => {
		expect(clickSelectedText(click, {x: 101, y: 99}, selected, inside)).toBe(false)
		expect(clickSelectedText(click, undefined, selected, inside)).toBe(false)
	})
})

describe('Transcript', () => {
	test('a click on a line plays from it', () => {
		act(() => lines()[2]!.click())
		expect(video.currentTime).toBeCloseTo(29.984)
		expect(play).toHaveBeenCalledTimes(1)
	})

	test('the click that ends a drag across the words seeks nowhere', () => {
		const list = lines()[0]!.parentElement!
		const press = (x: number) =>
			act(() => void list.dispatchEvent(new MouseEvent('pointerdown', {clientX: x, clientY: 20, bubbles: true})))
		const click = (line: HTMLElement, x: number) =>
			act(() => void line.dispatchEvent(new MouseEvent('click', {clientX: x, clientY: 21, detail: 1, bubbles: true})))
		press(40)
		select(words(1), words(2))
		click(lines()[2]!, 140)
		expect(video.currentTime).toBe(0)
		expect(play).not.toHaveBeenCalled()
		// … and with the words still selected, a click that goes nowhere is a click
		press(60)
		click(lines()[1]!, 61)
		expect(video.currentTime).toBe(8)
	})

	test('a transcript this short is shown whole rather than followed', () => {
		expect(host.querySelector('.lyrics-fits')).not.toBeNull()
		const long = Array.from({length: 8}, (_, index) => ({
			startMs: index * 2000,
			endMs: index * 2000 + 1500,
			text: `Line ${index}.`,
		}))
		act(() => root.render(<Transcript transcript={long} video={video} />))
		expect(host.querySelector('.lyrics-fits')).toBeNull()
	})

	test('says it holds the match when a search found the video by what is said', () => {
		const card = () => host.firstElementChild as HTMLElement
		expect(card().hasAttribute('data-match-target')).toBe(false)
		act(() => root.render(<Transcript transcript={transcript} video={video} matched={['black diamond run']} />))
		expect(card().hasAttribute('data-match-target')).toBe(true)
		expect([...host.querySelectorAll('[data-matched]')].map((word) => word.textContent)).toEqual(['black diamond run'])
	})

	test('copies the whole transcript in one click', () => {
		act(() => host.querySelector<HTMLElement>('button[aria-label="photos-item.copy-transcript"]')!.click())
		expect(copied).toHaveBeenCalledWith(transcriptText(transcript))
	})
})

describe('DetectedText', () => {
	const text = 'TESCO\nSourdough Loaf\n£3.20'
	const quad = [0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2]
	// The second line has no place kept
	const quads = [quad, [], quad]
	const pointed = vi.fn()
	const show = (props: Partial<React.ComponentProps<typeof DetectedText>> = {}) =>
		act(() => root.render(<DetectedText text={text} matched={['sourdough']} {...props} />))
	const body = () => host.querySelector('p[class*="whitespace-pre-wrap"]')!
	const line = (index: number) => host.querySelector<HTMLElement>(`[data-line="${index}"]`)!
	// As a mouse moves: the events carry what kind of pointer sent them
	const pointer = (type: string, init: MouseEventInit & {pointerType?: string} = {}) => {
		const event = new MouseEvent(type, {bubbles: true, ...init})
		Object.defineProperty(event, 'pointerType', {value: init.pointerType ?? 'mouse'})
		return event
	}
	const over = (element: Element) => act(() => void element.dispatchEvent(pointer('pointerover')))
	const toggle = () => host.querySelector<HTMLElement>('button[aria-label="photos-item.show-text-on-photo"]')

	beforeEach(() => pointed.mockClear())

	test('reads as the text it was given, with the match marked, whatever is live', () => {
		show()
		expect(body().textContent).toBe(text)
		expect(host.querySelector('mark')!.textContent).toBe('Sourdough')
		show({quads, onFocus: pointed})
		expect(body().textContent).toBe(text)
	})

	test('is the plain card where no places were kept', () => {
		show({onFocus: pointed})
		expect(toggle()).toBeNull()
		expect(body().hasAttribute('tabindex')).toBe(false)
		over(line(0))
		expect(pointed).not.toHaveBeenCalledWith({line: 0})
	})

	test('points at the line under the pointer, if it has a place', () => {
		show({quads, onFocus: pointed})
		over(line(2))
		expect(pointed).toHaveBeenLastCalledWith({line: 2})
		over(line(1))
		expect(pointed).toHaveBeenLastCalledWith(null)
	})

	test('a tap points at a line, and another tap lets it go, where there is no pointer to rest', () => {
		show({quads, onFocus: pointed})
		const tap = () => act(() => void line(2).dispatchEvent(pointer('click', {pointerType: 'touch'})))
		// A touch's pointerover comes with every tap: it is not a rest
		act(() => void line(2).dispatchEvent(pointer('pointerover', {pointerType: 'touch'})))
		expect(pointed).not.toHaveBeenCalledWith({line: 2})
		tap()
		expect(pointed).toHaveBeenLastCalledWith({line: 2})
		tap()
		expect(pointed).toHaveBeenLastCalledWith(null)
	})

	test('its glyph switches every line on, and a pointed line still wins', () => {
		show({quads, onFocus: pointed})
		act(() => toggle()!.click())
		expect(toggle()!.getAttribute('aria-pressed')).toBe('true')
		expect(pointed).toHaveBeenLastCalledWith('all')
		over(line(0))
		expect(pointed).toHaveBeenLastCalledWith({line: 0})
		act(() => toggle()!.click())
		act(() => void body().dispatchEvent(pointer('pointerout', {relatedTarget: document.body})))
		expect(pointed).toHaveBeenLastCalledWith(null)
	})

	test('the arrow keys walk the lines that have a place', () => {
		show({quads, onFocus: pointed})
		key(body() as HTMLElement, 'ArrowDown')
		expect(pointed).toHaveBeenLastCalledWith({line: 0})
		key(body() as HTMLElement, 'ArrowDown')
		expect(pointed).toHaveBeenLastCalledWith({line: 2})
		key(body() as HTMLElement, 'ArrowDown')
		expect(pointed).toHaveBeenLastCalledWith({line: 2})
		key(body() as HTMLElement, 'ArrowUp')
		expect(pointed).toHaveBeenLastCalledWith({line: 0})
	})

	test('lets go of the picture when it leaves', () => {
		show({quads, onFocus: pointed})
		over(line(0))
		act(() => root.render(null))
		expect(pointed).toHaveBeenLastCalledWith(null)
	})
})
