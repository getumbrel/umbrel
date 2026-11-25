// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test} from 'vitest'

import {SearchNote} from './search-note'
import type {SearchFootnoteLine} from './use-search-footnote'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

const render = (line: SearchFootnoteLine) => act(() => root.render(<SearchNote line={line} />))
const note = () => host.firstElementChild!
// The fewer words (hidden from a screen reader) and the sentence, as they stand in the note
const fewer = () => note().querySelector('[aria-hidden] .flex .flex')!
const sentence = () => note().lastElementChild!
const texts = (parent: Element) => [...parent.children].map((child) => [child.textContent, child.className])

const analyzing: SearchFootnoteLine = {
	text: 'Still analyzing your library - 24%. More results may appear.',
	short: 'Still analyzing your library - 24%',
	percent: 24,
	number: '24%',
}

test('gives way in the line before anything else in it, and keeps to one line', () => {
	render(analyzing)
	expect(note().className).toContain('shrink-[99999]')
	expect(note().className).toContain('h-[1lh]')
	expect(note().className).toContain('overflow-hidden')
	expect(note().getAttribute('title')).toBe(analyzing.text)
})

test('has the sentence whole, never cut, and the only one a screen reader reads', () => {
	render(analyzing)
	expect(sentence().textContent).toBe(`/${analyzing.text}`)
	expect(sentence().className).toContain('shrink-0')
	expect(sentence().className).toContain('whitespace-nowrap')
	expect(sentence().closest('[aria-hidden]')).toBeNull()
	// (Its slash is not read either)
	expect(sentence().querySelector('[aria-hidden]')!.textContent).toBe('/')
})

test('cuts the fewer words and never the number after them', () => {
	render(analyzing)
	expect(texts(fewer())).toEqual([
		['Still analyzing your library -', 'min-w-0 truncate'],
		['24%', 'shrink-0'],
	])
	// With room kept for the number and the start of the words, or they are not shown
	expect(fewer().parentElement!.className).toContain('basis-22')
	expect(fewer().parentElement!.className).toContain('shrink-0')
	// They ask for no width of their own, so they have none where the sentence fits
	expect(fewer().closest('[aria-hidden]')!.className).toContain('w-0')
})

test('finds the number wherever the language puts it', () => {
	render({
		text: '24 % analysiert. Weitere Ergebnisse folgen.',
		short: '24 % deiner Mediathek analysiert',
		number: '24 %',
	})
	expect(texts(fewer())).toEqual([
		['24 %', 'shrink-0'],
		['deiner Mediathek analysiert', 'min-w-0 truncate'],
	])
})

test('says a line without a number in its own words, cut at their end', () => {
	render({text: 'Search is getting ready'})
	expect(texts(fewer())).toEqual([['Search is getting ready', 'min-w-0 truncate']])
	expect(sentence().textContent).toBe('/Search is getting ready')
})
