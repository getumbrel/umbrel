import {describe, expect, test} from 'vitest'

import {defaultWallpaperId, resolveWallpaperAppearance, wallpapers} from './wallpapers.ts'

describe('wallpaper catalog', () => {
	test('has one entry per id', () => {
		expect(new Set(wallpapers.map(({id}) => id)).size).toBe(wallpapers.length)
	})

	test('has brand colors native clients can parse', () => {
		for (const {id, brandColorHsl} of wallpapers) {
			const components = brandColorHsl.match(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/)
			expect(components, `wallpaper ${id}`).not.toBeNull()
			const [, hue, saturation, lightness] = components!
			expect(Number(hue), `wallpaper ${id} hue`).toBeLessThanOrEqual(360)
			expect(Number(saturation), `wallpaper ${id} saturation`).toBeLessThanOrEqual(100)
			expect(Number(lightness), `wallpaper ${id} lightness`).toBeLessThanOrEqual(100)
		}
	})

	test('returns the selected wallpaper appearance', () => {
		expect(resolveWallpaperAppearance('24')).toEqual({id: '24', brandColorHsl: '209 85% 42%'})
	})

	test('uses the default appearance for an unknown stored id', () => {
		expect(resolveWallpaperAppearance('unknown')).toEqual(resolveWallpaperAppearance(defaultWallpaperId))
	})
})
