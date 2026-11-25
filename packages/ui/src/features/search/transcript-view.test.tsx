// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {TranscriptView} from './transcript-view'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const transcript = [
	{startMs: 1000, endMs: 4000, text: 'Der Zug nach München fährt von Gleis 2.'},
	{startMs: 4000, endMs: 6000, text: 'Die Fahrkarte ist in der App.'},
	// Nothing is said for eight seconds
	{startMs: 14_000, endMs: 18_000, text: 'Später am Abend.'},
]

let host: HTMLDivElement
let root: Root
let audio: HTMLAudioElement
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
	audio = document.createElement('audio')
	play = vi.fn(() => Promise.resolve())
	audio.play = play as unknown as HTMLAudioElement['play']
	act(() =>
		root.render(
			<TranscriptView transcript={transcript} media={audio} matched={['zug nach münchen']} variant='island' />,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
	vi.unstubAllGlobals()
})

const rows = () => [...host.querySelectorAll<HTMLElement>('.lyric-row')]
const lines = () => [...host.querySelectorAll<HTMLElement>('[data-lyric]')]
const scroller = () => lines()[0]!.parentElement!
const at = (seconds: number) => {
	audio.currentTime = seconds
	act(() => void audio.dispatchEvent(new Event('timeupdate')))
}

test('lays the transcript out with its silence, and reads as what was said', () => {
	expect(rows().map((row) => (row.classList.contains('lyric-gap') ? 'gap' : 'line'))).toEqual([
		'line',
		'line',
		'gap',
		'line',
	])
	expect(lines()[0]!.textContent).toBe(transcript[0]!.text)
})

test('lights the row playback is in, and dims the rest by how far they are', () => {
	at(4.5)
	expect(rows().map((row) => row.dataset.distance)).toEqual(['1', '0', '1', '2'])
	expect(lines()[1]!.getAttribute('aria-current')).toBe('true')
})

test('shows a long silence as one rather than leaving the last line lit', () => {
	at(9)
	expect(rows()[2]!.dataset.distance).toBe('0')
	expect(host.querySelector('[aria-current]')).toBeNull()
})

test('brightens the words of the spoken line as it is said, and only that line’s', () => {
	at(2.5)
	const said = lines()[0]!.querySelectorAll('[data-word][data-said]').length
	expect(said).toBeGreaterThan(0)
	expect(said).toBeLessThan(lines()[0]!.querySelectorAll('[data-word]').length)
	expect(lines()[1]!.querySelectorAll('[data-said]')).toHaveLength(0)
})

test('marks the words a search found the recording by, as one phrase', () => {
	expect([...lines()[0]!.querySelectorAll('[data-matched]')].map((word) => word.textContent)).toEqual([
		'Zug nach München',
	])
})

test('a click on a line plays from it', () => {
	act(() => lines()[2]!.click())
	expect(audio.currentTime).toBe(14)
	expect(play).toHaveBeenCalledTimes(1)
})

test('scrolling hands the view to the reader until they ask to go back', () => {
	act(() => void scroller().dispatchEvent(new Event('wheel', {bubbles: true})))
	expect(scroller().hasAttribute('data-browsing')).toBe(true)
	act(() => host.querySelector<HTMLElement>('button')!.click())
	expect(scroller().hasAttribute('data-browsing')).toBe(false)
})

test('is one tab stop, and the arrows step over the silence', () => {
	expect(lines().map((line) => line.tabIndex)).toEqual([0, -1, -1])
	lines()[1]!.focus()
	act(
		() =>
			void lines()[1]!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true})),
	)
	expect(document.activeElement).toBe(lines()[2])
	act(
		() => void lines()[2]!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})),
	)
	expect(audio.currentTime).toBe(14)
})
