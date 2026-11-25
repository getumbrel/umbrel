import {describe, expect, test} from 'vitest'

import {avatarCrop, renditionSize, type AvatarCrop} from '@/features/photos/components/people/avatar-crop'

// The square of the picture (in its own pixels) a crop shows
function shown(crop: AvatarCrop, width: number) {
	const side = (width / crop.width) * 100
	return {x: (-crop.left / 100) * side, y: (-crop.top / 100) * side, side}
}

describe('renditionSize', () => {
	test('is the item’s shape with the short edge brought down to the rendition’s', () => {
		expect(renditionSize(4032, 3024, 512)).toEqual({width: (4032 / 3024) * 512, height: 512})
		expect(renditionSize(3024, 4032, 512)).toEqual({width: 512, height: (4032 / 3024) * 512})
	})

	test('a picture smaller than the rendition is never enlarged', () => {
		expect(renditionSize(400, 300, 512)).toEqual({width: 400, height: 300})
	})

	test('frames the same crop the loaded thumbnail would, before it loads', () => {
		const face = {x: 0.49, y: 0.48, width: 0.02, height: 0.04}
		const known = renditionSize(4000, 2000, 512)
		// What the 512 rendition of a 4000×2000 picture measures once loaded
		expect(avatarCrop(face, known.width, known.height, 180)).toEqual(avatarCrop(face, 1024, 512, 180))
	})
})

describe('avatarCrop', () => {
	test('centres the circle on the face, padded', () => {
		// 100px face in the middle of a 1000×500 picture
		const crop = avatarCrop({x: 0.45, y: 0.4, width: 0.1, height: 0.2}, 1000, 500, 96)
		const square = shown(crop, 1000)
		expect(square.side).toBeCloseTo(210)
		expect(square.x + square.side / 2).toBeCloseTo(500)
		expect(square.y + square.side / 2).toBeCloseTo(250)
		// The picture keeps its shape inside the circle
		expect(crop.width / crop.height).toBeCloseTo(2)
	})

	test.each([
		['landscape', 1000, 500],
		['portrait', 500, 1000],
		['square', 512, 512],
		['panorama', 4000, 512],
	])('never shows past the edges of a %s picture', (_name, width, height) => {
		for (const face of [
			{x: 0, y: 0, width: 0.1, height: 0.1},
			{x: 0.9, y: 0.9, width: 0.1, height: 0.1},
			{x: 0.3, y: 0, width: 0.4, height: 1},
			{x: 0, y: 0, width: 1, height: 1},
		]) {
			const square = shown(avatarCrop(face, width, height, 200), width)
			expect(square.x).toBeGreaterThanOrEqual(-1e-9)
			expect(square.y).toBeGreaterThanOrEqual(-1e-9)
			expect(square.x + square.side).toBeLessThanOrEqual(width + 1e-9)
			expect(square.y + square.side).toBeLessThanOrEqual(height + 1e-9)
			expect(square.side).toBeLessThanOrEqual(Math.min(width, height) + 1e-9)
		}
	})

	test('slides back inside when the face is at an edge', () => {
		const square = shown(avatarCrop({x: 0, y: 0.4, width: 0.1, height: 0.2}, 1000, 500, 96), 1000)
		expect(square.x).toBe(0)
		expect(square.y + square.side / 2).toBeCloseTo(250)
	})

	test('a small face is shown smaller rather than upscaled into mush', () => {
		// A 20px face: padded it is 42px, but a 180px avatar needs 120px of picture
		const crop = avatarCrop({x: 0.49, y: 0.48, width: 0.02, height: 0.04}, 1000, 500, 180)
		expect(shown(crop, 1000).side).toBeCloseTo(120)
		// … while a small avatar can afford the tight crop
		expect(shown(avatarCrop({x: 0.49, y: 0.48, width: 0.02, height: 0.04}, 1000, 500, 36), 1000).side).toBeCloseTo(42)
	})

	test('a face bigger than the picture allows gets the whole short edge', () => {
		const square = shown(avatarCrop({x: 0.2, y: 0.1, width: 0.6, height: 0.8}, 400, 600, 96), 400)
		expect(square.side).toBe(400)
		expect(square.x).toBe(0)
	})

	test('a face that was never located gets the centre square', () => {
		const square = shown(avatarCrop({x: 0, y: 0, width: 0, height: 0}, 1000, 500, 96), 1000)
		expect(square).toEqual({x: 250, y: 0, side: 500})
	})
})
