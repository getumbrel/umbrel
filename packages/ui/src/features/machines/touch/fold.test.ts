// @vitest-environment jsdom

import {afterEach, expect, it, vi} from 'vitest'

import {readFold} from './fold'

const probe = (width: number, height: number) =>
	({getBoundingClientRect: () => ({width, height})}) as unknown as HTMLElement

function stubMedia(matching: string[], unsupported: string[] = []) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: matching.includes(query),
		media: unsupported.includes(query) ? 'not all' : query,
	}))
}

afterEach(() => {
	vi.unstubAllGlobals()
})

it('finds a laptop when the segments are stacked', () => {
	stubMedia(['(device-posture: folded)', '(vertical-viewport-segments: 2)'])
	expect(readFold(probe(669, 420))).toEqual({pose: 'laptop', at: 420})
})

it('finds a book when the segments sit side by side', () => {
	stubMedia(['(device-posture: folded)', '(horizontal-viewport-segments: 2)'])
	expect(readFold(probe(475, 620))).toEqual({pose: 'book', at: 475})
})

it('ignores segments on a display lying flat', () => {
	stubMedia(['(vertical-viewport-segments: 2)'])
	expect(readFold(probe(669, 420))).toEqual({pose: 'flat', at: 0})
})

it('is flat when the display is bent but one window sits on a single segment', () => {
	stubMedia(['(device-posture: folded)'])
	expect(readFold(probe(0, 0))).toEqual({pose: 'flat', at: 0})
})

it('trusts segments alone in a browser without posture', () => {
	stubMedia(['(vertical-viewport-segments: 2)'], ['(device-posture: folded)'])
	expect(readFold(probe(669, 420))).toEqual({pose: 'laptop', at: 420})
})
