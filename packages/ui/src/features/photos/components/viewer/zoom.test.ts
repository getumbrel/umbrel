import {describe, expect, it} from 'vitest'

import {
	bounds,
	canDecodeOriginal,
	clampView,
	FIT,
	maxZoom,
	renditionWidth,
	rubber,
	rubberScale,
	viewportClip,
	zoomAbout,
	zoomInAt,
	type Geometry,
} from './zoom'

// A 300×200 picture fitted in a 400×600 stage: 50px of stage to either side,
// 200 above and below
const geo: Geometry = {
	left: 50,
	top: 200,
	width: 300,
	height: 200,
	viewport: {left: -50, top: -200, right: 350, bottom: 400},
}

describe('bounds', () => {
	it('holds the picture at fit where it is', () => {
		expect(bounds(geo, 1)).toEqual({minX: 0, maxX: 0, minY: 0, maxY: 0})
	})

	it('lets content wider than the stage travel edge to edge, and centres what is still narrower', () => {
		// 2×: 600 wide in a 400 stage, 400 tall in a 600 stage
		expect(bounds(geo, 2)).toEqual({minX: -250, maxX: -50, minY: -100, maxY: -100})
	})
})

describe('zoomAbout', () => {
	it('keeps the content under the point where it is', () => {
		const point = {x: 90, y: 40}
		const view = zoomAbout(FIT, point, 2.5)
		// The content point that was at (90, 40) is still drawn there
		expect(view.x + 2.5 * 90).toBeCloseTo(90)
		expect(view.y + 2.5 * 40).toBeCloseTo(40)
		const again = zoomAbout(view, point, 4)
		expect(again.x + 4 * 90).toBeCloseTo(90)
	})
})

describe('zoomInAt', () => {
	it('brings the tapped point to the middle of the stage, as far as the edges allow', () => {
		const view = zoomInAt(geo, FIT, {x: 150, y: 100}, 2, true)
		// Centre tapped: centred horizontally (stage centre x 150), vertically clamped to centring
		expect(view).toEqual({s: 2, x: 150 - 2 * 150, y: -100})
		const corner = zoomInAt(geo, FIT, {x: 10, y: 10}, 2, true)
		// A corner tap can't pull the content's edge in past the stage's
		expect(corner.x).toBe(-50)
	})

	it('keeps the point under the pointer for a click', () => {
		const view = zoomInAt(geo, FIT, {x: 200, y: 100}, 2, false)
		expect(view.x + 2 * 200).toBeCloseTo(200)
	})
})

describe('clampView', () => {
	it('snaps a scale of 1 to exactly fit', () => {
		expect(clampView(geo, {s: 1.0004, x: 0.3, y: -0.2})).toBe(FIT)
	})
})

describe('rubber bands', () => {
	it('gives ever less past an edge, never more than the dimension', () => {
		expect(rubber(50, 0, 100, 400)).toBe(50)
		const a = rubber(150, 0, 100, 400)
		const b = rubber(300, 0, 100, 400)
		expect(a).toBeGreaterThan(100)
		expect(b - a).toBeLessThan(a - 100 + 150)
		expect(rubber(1e9, 0, 100, 400)).toBeLessThan(500)
	})

	it('stretches a scale past its limit by a fraction', () => {
		const s = rubberScale(8, 1, 4)
		expect(s).toBeGreaterThan(4)
		expect(s).toBeLessThan(5)
		expect(rubberScale(0.5, 1, 4)).toBeGreaterThan(0.5)
	})
})

describe('viewportClip', () => {
	it('opens the picture to the whole stage, with its corners', () => {
		expect(viewportClip(geo, FIT, 12)).toBe('inset(-200px -50px -200px -50px round 12px)')
	})

	it('maps the stage into a zoomed element’s own coordinates', () => {
		// At 2× and shifted, the stage's corner (-50, -200) is local ((-50 + 250) / 2, (-200 + 100) / 2), its far corner (350, 400) local (300, 250)
		expect(viewportClip(geo, {s: 2, x: -250, y: -100}, 12)).toBe('inset(-50px 0px -50px 100px round 6px)')
	})
})

describe('maxZoom', () => {
	it('is 4× unless the image has the pixels for more, and never past 6×', () => {
		expect(maxZoom(400, 1600, 2)).toBe(4)
		expect(maxZoom(400, 4000, 2)).toBe(5)
		expect(maxZoom(300, 9000, 3)).toBe(6)
	})
})

describe('renditionWidth', () => {
	it('is the 1280 short edge, or the image itself when smaller', () => {
		expect(renditionWidth(4032, 3024)).toBeCloseTo(1706.67)
		expect(renditionWidth(1600, 1200)).toBe(1600)
		expect(renditionWidth(3024, 4032)).toBe(1280)
	})
})

describe('canDecodeOriginal', () => {
	it('knows what a browser draws', () => {
		expect(canDecodeOriginal('IMG_0001.JPG')).toBe(true)
		expect(canDecodeOriginal('shot.webp')).toBe(true)
		expect(canDecodeOriginal('IMG_0002.HEIC')).toBe(false)
		expect(canDecodeOriginal('DSC_0003.NEF')).toBe(false)
		expect(canDecodeOriginal(undefined)).toBe(false)
	})
})
