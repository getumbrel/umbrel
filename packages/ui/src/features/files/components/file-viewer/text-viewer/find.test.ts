// @vitest-environment jsdom
import {SearchCursor} from '@codemirror/search'
import {Text} from '@codemirror/state'
import {act, createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {describe, expect, test} from 'vitest'

import {pattern, rangesIn} from '@/features/files/components/file-viewer/shell/find'
import {findMatches, previewLines} from '@/features/files/components/file-viewer/text-viewer/find'
import {MarkdownPreview} from '@/features/files/components/file-viewer/text-viewer/markdown-preview'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds the timed test to the suite; without one, it skips
const FIXTURES = process.env.FILES_FIXTURES ?? ''

const doc = (text: string) => Text.of(text.split('\n'))
const starts = (text: Text, query: string) => findMatches(text, query).map(({from}) => from)

// A log like those the editor opens (up to 50 MB): timestamped lines of words, 'elit' among them
function log(bytes: number) {
	const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt'.split(' ')
	const lines: string[] = []
	for (let i = 0, size = 0; size < bytes; i++) {
		const line = `2026-10-13T08:${String(i % 60).padStart(2, '0')}Z INFO worker[${i % 17}] ${words
			.map((_, w) => words[(i * 7 + w * 3) % words.length])
			.join(' ')}`
		lines.push(line)
		size += line.length + 1
	}
	return Text.of(lines)
}

describe('finding in the editor’s text', () => {
	test('ignores case, takes the query literally and never runs from one line into the next', () => {
		const text = doc('Needle in a haystack\nneedle, NEEDLE.\nnee.dle (needle)?\nÉté, été')
		expect(starts(text, 'needle')).toEqual([0, 21, 29, 46])
		expect(findMatches(text, 'needle')[0]).toEqual({from: 0, to: 6})
		expect(starts(text, 'e.d')).toEqual([39])
		expect(starts(text, '(needle)?')).toEqual([45])
		expect(starts(text, 'été')).toEqual([55, 60])
		expect(starts(text, 'haystack needle')).toEqual([])
	})

	test('finds what the character-by-character search found', () => {
		const text = log(200_000)
		for (const query of ['elit', 'ELIT', 'worker[3]', ':0', 'sed do']) {
			const cursor = new SearchCursor(text, query, 0, text.length, (part) => part.toLowerCase())
			const expected: Array<{from: number; to: number}> = []
			while (!cursor.next().done) expected.push({from: cursor.value.from, to: cursor.value.to})
			expect(findMatches(text, query), query).toEqual(expected)
		}
	})

	// Timed, so it runs with the corpus rather than in every npm test: under heavy parallel load even the ratio of two
	// searches measured side by side drifts. The test above checks the same results in every run.
	test.skipIf(!FIXTURES)('a big log is searched many times faster than by comparing character by character', () => {
		const text = log(4 * 2 ** 20)
		const time = (search: () => number) => {
			const started = performance.now()
			expect(search()).toBeGreaterThan(30_000)
			return performance.now() - started
		}
		const regex = time(() => findMatches(text, 'elit').length)
		const cursor = time(() => {
			const cursor = new SearchCursor(text, 'elit', 0, text.length, (part) => part.toLowerCase())
			let count = 0
			while (!cursor.next().done) count++
			return count
		})
		// About twenty times, on a 20 MB log 75 ms against 1.7 s; measured side by side so a busy machine slows both
		expect(regex * 5).toBeLessThan(cursor)
	})
})

describe('finding in the rendered Markdown', () => {
	// The preview as it's drawn
	async function preview(markdown: string) {
		const container = document.createElement('div')
		const root = createRoot(container)
		await act(async () => root.render(createElement(MarkdownPreview, {content: markdown})))
		return container.firstElementChild as HTMLElement
	}

	test('reads what is shown, a line per block, never the markup', async () => {
		const lines = previewLines(
			await preview(
				'# Trip **notes**\n\nPack the *passport*\nand [chargers](https://example.com).\n\n' +
					'- Rain jacket\n- Shoes\n  - Spare laces\n\n| Day | City |\n| --- | --- |\n| 1 | Lisbon |\n\n' +
					'```\nconst passport = true\n```',
			),
		)
		expect(lines.map((line) => line.text.trim()).filter(Boolean)).toEqual([
			'Trip notes',
			'Pack the passport',
			'and chargers.',
			'Rain jacket',
			'Shoes',
			'Spare laces',
			'Day',
			'City',
			'1',
			'Lisbon',
			'const passport = true',
		])
	})

	test('a match runs across formatting within a block, never from one block into the next', async () => {
		const lines = previewLines(await preview('A **bold** move\n\n- one\n- two'))
		expect(rangesIn(lines, pattern('bold move')!).map(String)).toEqual(['bold move'])
		expect(rangesIn(lines, pattern('one two')!)).toEqual([])
		expect(rangesIn(lines, pattern('passport')!)).toEqual([])
	})
})
