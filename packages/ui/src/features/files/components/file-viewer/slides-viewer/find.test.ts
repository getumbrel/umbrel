// @vitest-environment jsdom
// Find reads a drawn slide line by line, so a slide drawn by the engine is what these run against
import {describe, expect, test} from 'vitest'

import {countIn, linesIn, pattern, rangesIn} from '@/features/files/components/file-viewer/shell/find'
import {openPresentation} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {buildDeck, shape, slide, xfrm} from '@/features/files/components/file-viewer/slides-viewer/engine/test-pptx'

const run = (text: string, rPr = '') => `<a:r>${rPr}<a:t>${text}</a:t></a:r>`

async function drawn(...paragraphs: string[]) {
	const bytes = await buildDeck({
		slides: [slide(shape(xfrm(0, 0, 3000000, 1000000), paragraphs.map((p) => `<a:p>${p}</a:p>`).join('')))],
	})
	const deck = await openPresentation(bytes)
	return deck.renderSlide(0)
}

describe('reading a slide', () => {
	test('a paragraph is one line across its runs; paragraphs and line breaks part lines', async () => {
		const element = await drawn(
			run('Hello ') + run('wor', '<a:rPr b="1"/>') + run('ld'),
			run('Second') + '<a:br/>' + run('line'),
		)
		expect(linesIn(element).map((line) => line.text)).toEqual(['Hello world', 'Second', 'line'])
	})

	test('a match across runs becomes one range over exactly its text', async () => {
		const element = await drawn(run('Hello ') + run('wor', '<a:rPr b="1"/>') + run('ld'))
		const [range] = rangesIn(linesIn(element), pattern('o wo')!)
		expect(range.toString()).toBe('o wo')
		expect(range.startContainer.textContent).toBe('Hello ')
		expect(range.endContainer.textContent).toBe('wor')
	})

	test('ranges are found in the order they are counted, and never across paragraphs', async () => {
		const element = await drawn(run('one two'), run('three two'), run('owt'))
		const regex = pattern('TWO')!
		const ranges = rangesIn(linesIn(element), regex)
		expect(ranges.map((range) => range.toString())).toEqual(['two', 'two'])
		expect(ranges[1].startContainer.textContent).toBe('three two')
		expect(linesIn(element).reduce((sum, line) => sum + countIn(line.text, regex), 0)).toBe(2)
		// Only paragraphs run together would make "twothree"
		expect(rangesIn(linesIn(element), pattern('twothree')!)).toHaveLength(0)
	})
})
