import {describe, expect, it} from 'vitest'

import {cornerInset, dragToScroll, intersect, MIN_THUMB, thumbMetrics} from './geometry'

describe('thumbMetrics', () => {
	it('draws nothing when the content fits', () => {
		expect(thumbMetrics({track: 400, client: 400, scroll: 400, position: 0})).toBeNull()
		// Less than a pixel over is the rounding of a zoomed page, not something to scroll
		expect(thumbMetrics({track: 400, client: 400, scroll: 400.5, position: 0})).toBeNull()
	})

	it('draws nothing without a track', () => {
		expect(thumbMetrics({track: 0, client: 400, scroll: 800, position: 0})).toBeNull()
	})

	it('is as much of the track as the view is of the content', () => {
		expect(thumbMetrics({track: 400, client: 400, scroll: 1600, position: 0})).toEqual({
			length: 100,
			travel: 300,
			offset: 0,
		})
	})

	it('moves along the track as the content scrolls, to the end and no further', () => {
		const at = (position: number) => thumbMetrics({track: 400, client: 400, scroll: 1600, position})!.offset
		expect(at(600)).toBe(150)
		expect(at(1200)).toBe(300)
		// Rubber-banding past either end
		expect(at(1300)).toBe(300)
		expect(at(-50)).toBe(0)
	})

	it('stays long enough to grab however long the content', () => {
		const thumb = thumbMetrics({track: 400, client: 400, scroll: 400_000, position: 399_600})!
		expect(thumb.length).toBe(MIN_THUMB)
		expect(thumb.offset).toBe(400 - MIN_THUMB)
	})

	it('fills a track shorter than the shortest thumb', () => {
		expect(thumbMetrics({track: 20, client: 20, scroll: 2000, position: 0})).toEqual({length: 20, travel: 0, offset: 0})
	})

	it('keeps to its track when the scroller is drawn at another size', () => {
		// A 400px scroller drawn at half size: a 200px track for the same content
		expect(thumbMetrics({track: 200, client: 400, scroll: 1600, position: 1200})).toEqual({
			length: 50,
			travel: 150,
			offset: 150,
		})
	})
})

describe('dragToScroll', () => {
	it('scrolls the whole content over the thumb’s travel', () => {
		expect(dragToScroll({delta: 300, travel: 300, client: 400, scroll: 1600})).toBe(1200)
		expect(dragToScroll({delta: -75, travel: 300, client: 400, scroll: 1600})).toBe(-300)
	})

	it('scrolls nothing when the thumb has nowhere to go', () => {
		expect(dragToScroll({delta: 40, travel: 0, client: 20, scroll: 2000})).toBe(0)
	})

	it('puts the thumb where it was dragged to', () => {
		const sizes = {track: 400, client: 400, scroll: 1600}
		const from = thumbMetrics({...sizes, position: 200})!
		const position = 200 + dragToScroll({delta: 90, travel: from.travel, client: sizes.client, scroll: sizes.scroll})
		expect(thumbMetrics({...sizes, position})!.offset).toBeCloseTo(from.offset + 90)
	})
})

describe('intersect', () => {
	it('is what two boxes share', () => {
		expect(intersect({left: 0, top: 0, right: 100, bottom: 100}, {left: 40, top: -20, right: 300, bottom: 60})).toEqual(
			{
				left: 40,
				top: 0,
				right: 100,
				bottom: 60,
			},
		)
	})

	it('is nothing when they are apart or only touch', () => {
		expect(
			intersect({left: 0, top: 0, right: 100, bottom: 100}, {left: 200, top: 0, right: 300, bottom: 100}),
		).toBeNull()
		expect(
			intersect({left: 0, top: 0, right: 100, bottom: 100}, {left: 100, top: 0, right: 200, bottom: 100}),
		).toBeNull()
	})

	it('leaves a box alone on the side nothing clips', () => {
		expect(
			intersect({left: 10, top: 10, right: 90, bottom: 90}, {left: -Infinity, top: 30, right: Infinity, bottom: 50}),
		).toEqual({left: 10, top: 30, right: 90, bottom: 50})
	})
})

describe('cornerInset', () => {
	it('keeps the thumb inside a rounded corner, up to a point', () => {
		expect(cornerInset(0)).toBe(0)
		expect(cornerInset(12)).toBe(6)
		expect(cornerInset(80)).toBe(16)
		expect(cornerInset(-4)).toBe(0)
	})
})
