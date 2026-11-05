// @vitest-environment jsdom
import {describe, expect, test} from 'vitest'

import {
	firstFrom,
	linesIn,
	ordinal,
	pattern,
	rangeIn,
	rangesIn,
	reveal,
	stepFrom,
} from '@/features/files/components/file-viewer/shell/find'

// A drawn paragraph: a div of inline pieces, as the engines draw them
function drawn(html: string) {
	const root = document.createElement('div')
	root.innerHTML = html
	return root
}

describe('reading drawn text', () => {
	test('a block is one line across its pieces; blocks and line breaks part lines; hidden text is skipped', () => {
		const root = drawn(
			'<div><span>Hello </span><b>wor</b><span>ld</span></div>' +
				'<div><span>Second</span><br><span>line</span></div>' +
				'<div style="display: none"><span>hidden</span></div>',
		)
		expect(linesIn(root).map((line) => line.text)).toEqual(['Hello world', 'Second', 'line'])
	})

	test('a match across pieces is one range over exactly its text, and never runs across lines', () => {
		const lines = linesIn(drawn('<div><span>Hello </span><b>wor</b><span>ld</span></div><div>owt</div>'))
		const [range] = rangesIn(lines, pattern('o wo')!)
		expect(range.toString()).toBe('o wo')
		expect([range.startContainer.textContent, range.endContainer.textContent]).toEqual(['Hello ', 'wor'])
		// Only lines run together would make "worldowt"
		expect(rangesIn(lines, pattern('ldow')!)).toHaveLength(0)
	})

	test('other markup names its own blocks', () => {
		const lines = linesIn(drawn('<p>One <b>two</b></p><ul><li>three</li><li>four<br>five</li></ul>'), 'p, li')
		expect(lines.map((line) => line.text)).toEqual(['One two', 'three', 'four', 'five'])
	})

	test('offsets are counted over the nodes as they are now, so typing never puts a range out of bounds', () => {
		const [line] = linesIn(drawn('<div><span>Hello </span><b>wor</b><span>ld</span></div>'))
		line.nodes[0].deleteData(0, 1)
		expect(rangeIn(line, 6, 9).toString()).toBe('orl')
		expect(rangeIn(line, 10, 11).collapsed).toBe(true)
	})
})

describe('the query', () => {
	test('is literal, case-insensitive, and a space matches any white space', () => {
		const regex = pattern('a.b (c) d')!
		expect('A.B (C)\td'.match(regex)?.[0]).toBe('A.B (C)\td')
		expect('axb (c) d'.match(regex)).toBeNull()
		expect(pattern('   ')).toBeUndefined()
		expect(pattern('')).toBeUndefined()
	})
})

describe('bringing a match into view', () => {
	// jsdom lays nothing out: each box is given, and a range sits where it's told
	const box = (target: Element | Range, rect: Partial<DOMRect>) =>
		(target.getBoundingClientRect = () => rect as DOMRect)
	function view(html: string) {
		const scroller = drawn(html)
		box(scroller, {top: 0, bottom: 500, left: 0, right: 400})
		const range = document.createRange()
		range.selectNodeContents(scroller.querySelector('b')!)
		return {scroller, range, at: (rect: Partial<DOMRect>) => box(range, rect)}
	}

	test('a match out of view, or within `clear` of an edge, comes to the middle; one in view stays put', () => {
		const {scroller, range, at} = view('<p><b>match</b></p>')
		at({top: 300, bottom: 320, left: 10, right: 60})
		reveal(scroller, range, 64)
		expect(scroller.scrollTop).toBe(0)
		at({top: 470, bottom: 490, left: 10, right: 60})
		reveal(scroller, range, 64)
		expect(scroller.scrollTop).toBe(230)
	})

	test('a match in a sideways scroller inside the view (a long code block) is brought into view in it too', () => {
		const {scroller, range} = view('<pre style="overflow-x: auto"><b>match</b></pre>')
		const pre = scroller.querySelector('pre')!
		Object.defineProperties(pre, {scrollWidth: {value: 2000}, clientWidth: {value: 400}})
		box(pre, {top: 100, bottom: 300, left: 0, right: 400})
		// The match moves as the code block scrolls under it
		range.getBoundingClientRect = () =>
			({top: 200, bottom: 220, left: 1200 - pre.scrollLeft, right: 1260 - pre.scrollLeft}) as DOMRect
		reveal(scroller, range)
		expect([pre.scrollLeft, scroller.scrollLeft, scroller.scrollTop]).toEqual([1030, 0, 0])
	})
})

describe('stepping through matches', () => {
	// Run 0 has two matches, run 2 one, run 3 three
	const counts = [2, 0, 1, 3]

	test('the first match is the next one from a run on, wrapping round', () => {
		expect(firstFrom(counts, 0)).toEqual({at: 0, nth: 0})
		expect(firstFrom(counts, 1)).toEqual({at: 2, nth: 0})
		expect(firstFrom([1, 0, 0], 2)).toEqual({at: 0, nth: 0})
		expect(firstFrom([0, 0], 0)).toBeUndefined()
	})

	test('next and previous go through every match and wrap at either end', () => {
		const forward = [{at: 0, nth: 0}]
		for (let i = 0; i < 6; i++) forward.push(stepFrom(counts, forward.at(-1)!, 1))
		expect(forward.map(({at, nth}) => `${at}.${nth}`)).toEqual(['0.0', '0.1', '2.0', '3.0', '3.1', '3.2', '0.0'])
		expect(stepFrom(counts, {at: 0, nth: 0}, -1)).toEqual({at: 3, nth: 2})
		expect(stepFrom(counts, {at: 2, nth: 0}, -1)).toEqual({at: 0, nth: 1})
	})

	test('a match is numbered among all the matches', () => {
		expect(ordinal(counts, {at: 0, nth: 0})).toBe(1)
		expect(ordinal(counts, {at: 2, nth: 0})).toBe(3)
		expect(ordinal(counts, {at: 3, nth: 2})).toBe(6)
	})
})
