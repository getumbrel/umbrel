import {describe, expect, test} from 'vitest'

import {activeLine, lyricRows, transcriptKey, wordsSaid} from './transcript'

const transcript = [
	{startMs: 896, endMs: 6656, text: 'Erinnerung: Morgen fährt der Zug.'},
	{startMs: 6656, endMs: 8256, text: 'Die Fahrkarte ist in der App.'},
	{startMs: 9664, endMs: 21_824, text: 'Seit neunzehnhundert achtundachtzig …'},
	{startMs: 30_000, endMs: 34_000, text: 'Später.'},
]

test('activeLine is the last line that has started', () => {
	expect(activeLine(transcript, 0)).toBe(-1)
	expect(activeLine(transcript, 896)).toBe(0)
	expect(activeLine(transcript, 9000)).toBe(1)
	expect(activeLine(transcript, 99_000)).toBe(3)
})

describe('lyricRows', () => {
	test('puts a gap where nothing is said for long enough, and nowhere else', () => {
		expect(
			lyricRows(transcript).map((row) => (row.type === 'gap' ? `gap ${row.startMs}-${row.endMs}` : row.line)),
		).toEqual([0, 1, 2, 'gap 21824-30000', 3])
	})

	test('opens with a gap when the recording does not open with speech', () => {
		const late = [{startMs: 5000, endMs: 7000, text: 'Hello.'}]
		expect(lyricRows(late)).toEqual([
			{type: 'gap', startMs: 0, endMs: 5000},
			{type: 'line', line: 0, startMs: 5000, endMs: 7000},
		])
	})

	test('measures a silence from the last thing still being said', () => {
		// The second line ends before the first does: no gap opens under the first
		const overlapping = [
			{startMs: 0, endMs: 10_000, text: 'A long one.'},
			{startMs: 2000, endMs: 3000, text: 'Over it.'},
			{startMs: 11_000, endMs: 12_000, text: 'After.'},
		]
		expect(lyricRows(overlapping).every((row) => row.type === 'line')).toBe(true)
	})

	test('is nothing for no transcript', () => {
		expect(lyricRows([])).toEqual([])
	})
})

test('activeLine follows playback through lines and gaps', () => {
	const rows = lyricRows(transcript)
	expect(activeLine(rows, 0)).toBe(-1)
	expect(activeLine(rows, 7000)).toBe(1)
	expect(activeLine(rows, 21_000)).toBe(2)
	// The long line is over and nothing is said: the gap, not the stale line
	expect(activeLine(rows, 25_000)).toBe(3)
	expect(rows[activeLine(rows, 25_000)]!.type).toBe('gap')
	expect(activeLine(rows, 31_000)).toBe(4)
})

describe('wordsSaid', () => {
	const row = {startMs: 1000, endMs: 5000}
	const words = ['one', 'two', 'three', 'four']

	test('is none before the line and all of them after', () => {
		expect(wordsSaid(words, row, 500)).toBe(0)
		expect(wordsSaid(words, row, 1000)).toBe(0)
		expect(wordsSaid(words, row, 5000)).toBe(4)
		expect(wordsSaid(words, row, 9000)).toBe(4)
	})

	test('counts a word once playback is into it', () => {
		expect(wordsSaid(words, row, 1100)).toBe(1)
		expect(wordsSaid(words, row, 3000)).toBe(3)
		expect(wordsSaid(words, row, 4900)).toBe(4)
	})

	test('never runs backwards as time goes on', () => {
		let last = 0
		for (let ms = 0; ms <= 6000; ms += 50) {
			const said = wordsSaid(words, row, ms)
			expect(said).toBeGreaterThanOrEqual(last)
			last = said
		}
	})

	test('gives a long word longer than a short one', () => {
		// Halfway through, "a" is long past and the long word is being said
		expect(wordsSaid(['a', 'extraordinarily'], {startMs: 0, endMs: 1000}, 500)).toBe(2)
		expect(wordsSaid(['extraordinarily', 'a'], {startMs: 0, endMs: 1000}, 500)).toBe(1)
	})

	test('treats a line with no length as said', () => {
		expect(wordsSaid(words, {startMs: 1000, endMs: 1000}, 1000)).toBe(4)
	})
})

describe('transcriptKey', () => {
	const key = (name: string, held: Partial<{metaKey: boolean; ctrlKey: boolean; altKey: boolean}> = {}) => ({
		key: name,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		...held,
	})

	test('walks the lines with the arrows, Home and End, and stops at the ends', () => {
		expect(transcriptKey(key('ArrowDown'), 1, 4)).toEqual({focus: 2})
		expect(transcriptKey(key('ArrowUp'), 0, 4)).toEqual({focus: 0})
		expect(transcriptKey(key('ArrowDown'), 3, 4)).toEqual({focus: 3})
		expect(transcriptKey(key('Home'), 2, 4)).toEqual({focus: 0})
		expect(transcriptKey(key('End'), 0, 4)).toEqual({focus: 3})
	})

	test('plays on Enter and Space, and leaves shortcuts and other keys alone', () => {
		expect(transcriptKey(key('Enter'), 1, 4)).toBe('play')
		expect(transcriptKey(key(' '), 1, 4)).toBe('play')
		expect(transcriptKey(key('c', {metaKey: true}), 1, 4)).toBeUndefined()
		expect(transcriptKey(key('Enter', {ctrlKey: true}), 1, 4)).toBeUndefined()
		expect(transcriptKey(key('a'), 1, 4)).toBeUndefined()
	})
})
