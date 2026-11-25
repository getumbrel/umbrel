import {describe, expect, test} from 'vitest'

import {captionCues, captionsVtt} from '@/features/search/captions'

describe('captionCues', () => {
	test('keeps a sentence that fits in two lines as one cue', () => {
		expect(captionCues([{startMs: 1000, endMs: 3000, text: '  Happy birthday to you!  '}])).toEqual([
			{startMs: 1000, endMs: 3000, text: 'Happy birthday to you!'},
		])
	})

	test('cuts a long sentence at a pause, sharing its time by letters', () => {
		const text =
			'We drove up the coast for three hours, stopping at every beach we passed, and when the sun finally went down we were still nowhere near the town.'
		const cues = captionCues([{startMs: 0, endMs: 10_000, text}])
		expect(cues.map((cue) => cue.text)).toEqual([
			'We drove up the coast for three hours,\nstopping at every beach we passed,',
			'and when the sun finally went down\nwe were still nowhere near the town.',
		])
		for (const cue of cues) for (const line of cue.text.split('\n')) expect(line.length).toBeLessThanOrEqual(42)
		// Back to back, covering the sentence exactly
		expect(cues[0]!.startMs).toBe(0)
		expect(cues[0]!.endMs).toBe(cues[1]!.startMs)
		expect(cues[1]!.endMs).toBe(10_000)
		// The first piece is about half the letters, so about half the time
		expect(cues[0]!.endMs).toBeGreaterThan(4500)
		expect(cues[0]!.endMs).toBeLessThan(5500)
	})

	test('fills a cue when there is no pause near enough', () => {
		const words = Array.from({length: 40}, (_, index) => `word${index}`)
		const cues = captionCues([{startMs: 0, endMs: 8000, text: words.join(' ')}])
		expect(cues.length).toBeGreaterThan(1)
		expect(cues.map((cue) => cue.text.replace('\n', ' ')).join(' ')).toBe(words.join(' '))
		for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(84)
	})

	test('keeps a short line whole and balances a long one over two', () => {
		expect(captionCues([{startMs: 0, endMs: 1000, text: 'Look at the waves.'}])[0]!.text).toBe('Look at the waves.')
		expect(
			captionCues([{startMs: 0, endMs: 1000, text: 'Can you believe how big the waves are getting today?'}])[0]!.text,
		).toBe('Can you believe how big\nthe waves are getting today?')
	})

	test('cuts a script written without spaces between its characters, at its pauses', () => {
		const text = '今天我们来做红烧肉，先把五花肉切成小块，冷水下锅焯水，然后加入冰糖炒出糖色，最后放酱油和料酒慢慢炖。'
		const cues = captionCues([{startMs: 0, endMs: 11_000, text}])
		expect(cues.length).toBeGreaterThan(1)
		expect(cues.map((cue) => cue.text.replace('\n', '')).join('')).toBe(text)
		for (const cue of cues) {
			for (const line of cue.text.split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(21)
			// A closing mark never starts a line
			for (const line of cue.text.split('\n')) expect(line).not.toMatch(/^[，。]/)
		}
		// The first cue ends at a pause
		expect(cues[0]!.text).toMatch(/，$/)
	})

	test('a cut with no pause near never ends on a little word', () => {
		const text = Array.from({length: 13}, () => 'shell').join(' ') + ' and prattled when the tide came in again'
		for (const cue of captionCues([{startMs: 0, endMs: 9000, text}]).slice(0, -1)) {
			expect(cue.text).not.toMatch(/\b(and|when|the)$/)
		}
	})

	test('shares a sentence a word too long for one cue evenly over two', () => {
		const text = Array.from({length: 13}, () => 'shells').join(' ')
		const cues = captionCues([{startMs: 0, endMs: 6000, text}])
		expect(cues.map((cue) => cue.text.replace('\n', ' ')).join(' ')).toBe(text)
		expect(cues.map((cue) => cue.endMs - cue.startMs).every((ms) => ms > 2500)).toBe(true)
	})

	test('leaves out empty lines and lets one huge word stand alone', () => {
		const long = 'x'.repeat(100)
		expect(
			captionCues([
				{startMs: 0, endMs: 1000, text: '   '},
				{startMs: 1000, endMs: 2000, text: `${long} ok`},
			]).map((cue) => cue.text),
		).toEqual([long, 'ok'])
	})
})

test('captionsVtt writes WebVTT and escapes what was said', () => {
	expect(
		captionsVtt([
			{startMs: 0, endMs: 1500, text: 'Tom & Jerry'},
			{startMs: 3_723_004, endMs: 3_725_000, text: '<b>not markup</b>'},
		]),
	).toBe(
		'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nTom &amp; Jerry\n\n01:02:03.004 --> 01:02:05.000\n&lt;b&gt;not markup&lt;/b&gt;',
	)
})
