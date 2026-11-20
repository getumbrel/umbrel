import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import nodePath from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, test} from 'vitest'

import {defaultWallpaperId, resolveWallpaperAppearance, wallpapers, wallpapersKeyed} from './wallpapers.ts'

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

	test('has a hash matching the wallpaper files', () => {
		const wallpapersDirectory = nodePath.resolve(
			nodePath.dirname(fileURLToPath(import.meta.url)),
			'../../../../ui/public/assets/wallpapers',
		)
		const expected = wallpapers.map(({id}) => {
			const hash = createHash('sha256')
			for (const file of [
				`${id}.jpg`,
				...['large', 'medium', 'small', 'thumbnails'].map((tier) => `generated-avif/${tier}/${id}.avif`),
			]) {
				hash.update(readFileSync(nodePath.join(wallpapersDirectory, file)))
			}
			return {id, hash: hash.digest('hex').slice(0, 12)}
		})
		expect(wallpapers.map(({id, hash}) => ({id, hash}))).toEqual(expected)
	})

	test('has hashes native clients can use in cache filenames', () => {
		for (const {id, hash} of wallpapers) expect(hash, `wallpaper ${id}`).toMatch(/^[0-9a-f]{12}$/)
	})

	test('returns the selected wallpaper appearance', () => {
		expect(resolveWallpaperAppearance('24')).toEqual({
			id: '24',
			brandColorHsl: '209 85% 42%',
			hash: wallpapersKeyed['24'].hash,
		})
	})

	test('uses the default appearance for an unknown stored id', () => {
		expect(resolveWallpaperAppearance('unknown')).toEqual(resolveWallpaperAppearance(defaultWallpaperId))
	})
})
