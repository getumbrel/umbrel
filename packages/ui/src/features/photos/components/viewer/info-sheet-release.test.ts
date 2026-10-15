import {describe, expect, it} from 'vitest'

import {releaseTarget} from './info-sheet-release'

// Closed, half and full heights of a tall sheet; a short one has a single stop
const TALL = [0, 426, 700]
const SHORT = [0, 380]

describe('releaseTarget', () => {
	it('opens a short, slow lift once it has carried the sheet past the commit share', () => {
		// 30% of the way to 380 is 114px
		expect(releaseTarget(SHORT, 150, 0, 0)).toBe(380)
		expect(releaseTarget(SHORT, 90, 0, 0)).toBe(0)
	})

	it('closes an open sheet dragged down far enough, slowly', () => {
		expect(releaseTarget(SHORT, 380 - 130, 380, 0)).toBe(0)
		expect(releaseTarget(SHORT, 380 - 80, 380, 0)).toBe(380)
	})

	it('sends a flick on to the next stop its way, however short the drag', () => {
		expect(releaseTarget(SHORT, 360, 380, -0.8)).toBe(0)
		expect(releaseTarget(SHORT, 30, 0, 0.8)).toBe(380)
		expect(releaseTarget(TALL, 450, 426, 0.6)).toBe(700)
		expect(releaseTarget(TALL, 400, 426, -0.6)).toBe(0)
	})

	it('stops a lift short of the half height at the half height, not beyond', () => {
		// Past the commit share toward 426, nowhere near past it
		expect(releaseTarget(TALL, 160, 0, 0)).toBe(426)
		expect(releaseTarget(TALL, 560, 700, 0)).toBe(426)
	})

	it('passes a stop that a long drag has carried the sheet well beyond', () => {
		// From closed, past the half height and most of the way to full
		expect(releaseTarget(TALL, 640, 0, 0)).toBe(700)
		// … but short of halfway on from the half height, it rests there
		expect(releaseTarget(TALL, 520, 0, 0)).toBe(426)
	})

	it('holds a flick up past the tallest stop at it', () => {
		expect(releaseTarget(TALL, 760, 700, 0.9)).toBe(700)
	})
})
