// @vitest-environment jsdom

import {afterEach, describe, expect, test} from 'vitest'

import {filterColor, sampleWindowSurfaceEdgeColor} from './window-surface-color'

describe('filterColor', () => {
	test('leaves a colour alone at 100% saturation and brightness', () => {
		const [r, g, b] = filterColor([200, 120, 40], {saturation: 1, brightness: 1})
		expect(r).toBeCloseTo(200)
		expect(g).toBeCloseTo(120)
		expect(b).toBeCloseTo(40)
	})

	test('saturate(0) leaves only the luminance', () => {
		const grey = 0.213 * 200 + 0.715 * 120 + 0.072 * 40
		for (const channel of filterColor([200, 120, 40], {saturation: 0, brightness: 1})) expect(channel).toBeCloseTo(grey)
	})

	test('a grey stays grey however far it is saturated, and scales with brightness', () => {
		for (const channel of filterColor([100, 100, 100], {saturation: 1.5, brightness: 0.7}))
			expect(channel).toBeCloseTo(70)
	})

	test('clamps what saturating pushes out of range before brightness applies', () => {
		const [r, , b] = filterColor([255, 128, 0], {saturation: 3, brightness: 0.5})
		expect(r).toBeCloseTo(127.5)
		expect(b).toBe(0)
	})
})

describe('sampleWindowSurfaceEdgeColor', () => {
	afterEach(() => document.body.replaceChildren())

	const mount = () => {
		const image = document.createElement('img')
		image.style.setProperty('--window-background-tint-rgb', '10 20 30')
		image.style.setProperty('--window-background-tint-opacity', '0.5')
		document.body.append(image)
		return image
	}

	test('a surface showing no wallpaper is its tint over black', () => {
		// jsdom lays nothing out, as when the surface hides its wallpaper
		expect(sampleWindowSurfaceEdgeColor(mount())).toBe('rgb(5 10 15)')
	})

	test('has no answer until the image has loaded', () => {
		const image = mount()
		Object.defineProperties(image, {clientWidth: {value: 390}, clientHeight: {value: 700}})
		expect(sampleWindowSurfaceEdgeColor(image)).toBeUndefined()
	})
})
