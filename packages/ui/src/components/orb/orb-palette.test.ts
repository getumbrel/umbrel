import {describe, expect, it} from 'vitest'

import {hslToRgb, orbPaletteCssBackground, orbPaletteFromHsl, parseBrandHsl} from './orb-palette'

describe('parseBrandHsl', () => {
	it('reads the wallpaper definition format', () => {
		expect(parseBrandHsl('24 90% 50%')).toEqual({h: 24, s: 90, l: 50})
	})

	it('falls back to a blue for missing or malformed values', () => {
		expect(parseBrandHsl(undefined)).toEqual(parseBrandHsl('garbage'))
		expect(parseBrandHsl(undefined).h).toBe(216)
	})
})

describe('hslToRgb', () => {
	it('matches known colours', () => {
		expect(hslToRgb({h: 0, s: 100, l: 50}).map((v) => Math.round(v * 255))).toEqual([255, 0, 0])
		expect(hslToRgb({h: 120, s: 100, l: 25}).map((v) => Math.round(v * 255))).toEqual([0, 128, 0])
		expect(hslToRgb({h: 0, s: 0, l: 50}).map((v) => Math.round(v * 255))).toEqual([128, 128, 128])
	})
})

describe('orbPaletteFromHsl', () => {
	it('keeps every stop in range and orders them light to deep', () => {
		for (const hsl of ['24 90% 50%', '259 100% 59%', '160 100% 27%', '0 0% 50%']) {
			const palette = orbPaletteFromHsl(hsl)
			const luminance = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
			for (const stop of Object.values(palette)) for (const channel of stop) expect(channel).toBeGreaterThanOrEqual(0)
			expect(luminance(palette.milk)).toBeGreaterThan(luminance(palette.primary))
			expect(luminance(palette.primary)).toBeGreaterThan(luminance(palette.deep))
		}
	})

	it('stays grey for a grey wallpaper', () => {
		const {primary} = orbPaletteFromHsl('0 0% 50%')
		expect(primary[0]).toBeCloseTo(primary[1])
		expect(primary[1]).toBeCloseTo(primary[2])
	})

	it('renders a CSS gradient stack', () => {
		expect(orbPaletteCssBackground(orbPaletteFromHsl('24 90% 50%'))).toMatch(/^radial-gradient\(.*\), radial-gradient/)
	})
})
