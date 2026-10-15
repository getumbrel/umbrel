import {afterEach, describe, expect, test, vi} from 'vitest'

import {mapLanguage, mapStyle} from './map-style'

describe("the basemap's language", () => {
	test.each([
		['zh', 'zh-Hans'],
		['zh-TW', 'zh-Hant'],
		['nb', 'no'],
		['en', 'en'],
		['ja', 'ja'],
		['pt-BR', 'pt'],
		['en-US', 'en'],
	])('is %s → %s', (language, expected) => {
		expect(mapLanguage(language)).toBe(expected)
	})
})

describe('the names on the map', () => {
	afterEach(() => vi.unstubAllGlobals())

	test.each(['zh-Hans', 'zh-Hant', 'no'])('are the name:%s field before the English one', (lang) => {
		vi.stubGlobal('location', {origin: 'http://umbrel.local'})
		const style = mapStyle({basemap: {available: true, maxZoom: 15}, atlas: undefined, lang, authorize: (url) => url})
		const fields = style.layers.flatMap((layer) =>
			layer.type === 'symbol' && layer.layout?.['text-field'] ? [JSON.stringify(layer.layout['text-field'])] : [],
		)
		expect(fields.length).toBeGreaterThan(0)
		for (const field of fields)
			expect(field).toBe(JSON.stringify(['coalesce', ['get', `name:${lang}`], ['get', 'name:en'], ['get', 'name']]))
	})
})

describe('the type on the map', () => {
	afterEach(() => vi.unstubAllGlobals())

	const fonts = () => {
		vi.stubGlobal('location', {origin: 'http://umbrel.local'})
		const style = mapStyle({
			basemap: {available: true, maxZoom: 15},
			atlas: undefined,
			lang: 'en',
			authorize: (url) => url,
		})
		return style.layers.flatMap((layer) =>
			layer.type === 'symbol' && layer.layout?.['text-field'] ? [layer.layout['text-font']] : [],
		)
	}

	const CJK = ['PingFang SC', 'Hiragino Sans', 'Noto Sans CJK SC']

	test("is Inter in the basemap's weights, and never one of its fonts", () => {
		const all = JSON.stringify(fonts())
		expect(all).not.toMatch(/Noto Sans (Regular|Medium|Italic)/)
		for (const weight of ['Regular', 'Medium', 'Italic']) expect(all).toContain(`"Inter var ${weight}","Inter var"`)
		expect(fonts()).toContainEqual(['Inter var Medium', 'Inter var', ...CJK])
	})

	test("is Inter inside an expression's literals too", () => {
		const choice = fonts().find((font) => JSON.stringify(font).startsWith('["case"'))
		expect(choice).toEqual([
			'case',
			expect.anything(),
			['literal', ['Inter var Medium', 'Inter var', ...CJK]],
			['literal', ['Inter var Regular', 'Inter var', ...CJK]],
		])
	})
})

describe('the basemap', () => {
	afterEach(() => vi.unstubAllGlobals())

	test('is one source of tiles from the device, as deep as it goes', () => {
		vi.stubGlobal('location', {origin: 'http://umbrel.local'})
		const style = mapStyle({
			basemap: {available: true, maxZoom: 15, build: 'planet-20261011'},
			atlas: undefined,
			lang: 'en',
			authorize: (url) => `${url}&token=t`,
		})
		expect(style.sources).toEqual({
			basemap: {
				type: 'vector',
				tiles: ['http://umbrel.local/api/photos/map/tiles/{z}/{x}/{y}?build=planet-20261011&token=t'],
				maxzoom: 15,
			},
		})
		// Labels are drawn by the browser: there are no glyph files to ask for
		expect(style.glyphs).toBeUndefined()
		for (const layer of style.layers) if (layer.type !== 'background') expect(layer.source).toBe('basemap')
		expect(new Set(style.layers.map((layer) => layer.id)).size).toBe(style.layers.length)
	})

	test('is the atlas where there is none', () => {
		vi.stubGlobal('location', {origin: 'http://umbrel.local'})
		const style = mapStyle({
			basemap: {available: false, maxZoom: 0},
			atlas: {version: 1, source: 'Natural Earth', c: [], p: []},
			lang: 'en',
			authorize: (url) => url,
		})
		expect(Object.keys(style.sources)).toEqual(['atlas'])
		expect(style.glyphs).toBeUndefined()
	})
})
