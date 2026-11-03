// @vitest-environment jsdom

import {act, createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {fetchOfflineMapData, locationName, OFFLINE_MAP_DATA_URL, type OfflineMapData} from './atlas'

const atlas: OfflineMapData = {
	version: 1,
	source: 'test',
	c: [
		[
			'Thailand',
			'TH',
			[95, 5, 106, 21],
			[
				[
					[95, 5],
					[106, 5],
					[106, 21],
					[95, 21],
					[95, 5],
				],
			],
		],
	],
	p: [
		[100.5018, 13.7563, 'Bangkok', 'Bangkok', 'TH', 10_900_000, 1],
		[100.2, 13.2, 'Nearby', 'Central', 'TH', 50_000, 7],
	],
}

describe('offline map resources', () => {
	test('loads its only data resource from the Umbrel origin', async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify(atlas), {status: 200}))
		const loaded = await fetchOfflineMapData(fetcher as typeof fetch)

		expect(OFFLINE_MAP_DATA_URL).toMatch(/^\//)
		expect(OFFLINE_MAP_DATA_URL).not.toMatch(/^https?:/)
		expect(fetcher).toHaveBeenCalledWith(OFFLINE_MAP_DATA_URL, {credentials: 'same-origin'})
		expect(loaded.version).toBe(1)
	})
})

describe('the atlas, as a component has it', () => {
	;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
	afterEach(() => vi.unstubAllGlobals())

	// What useAtlas gives, mounted afresh, once the fetch it starts has settled
	async function mounted() {
		const {useAtlas} = await import('./atlas')
		const seen: Array<OfflineMapData | null | undefined> = []
		const root = createRoot(document.createElement('div'))
		const Probe = () => (seen.push(useAtlas()), null)
		await act(async () => root.render(createElement(Probe)))
		act(() => root.unmount())
		return seen
	}

	test('is null once it fails, not loading forever, and is asked for again next time', async () => {
		// The cache is the module's: each test has a new one
		vi.resetModules()
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response('', {status: 500}))
			.mockResolvedValueOnce(new Response(JSON.stringify(atlas), {status: 200}))
		vi.stubGlobal('fetch', fetcher)

		const failed = await mounted()
		expect(failed[0]).toBeUndefined()
		expect(failed.at(-1)).toBeNull()

		const retried = await mounted()
		expect(fetcher).toHaveBeenCalledTimes(2)
		expect(retried.at(-1)).toEqual(atlas)
	})
})

describe('offline place context', () => {
	test('names a nearby place and country without a geocoder request', () => {
		expect(locationName(atlas, 13.7563, 100.5018, 'en')).toBe('Bangkok, Thailand')
	})

	test('places nothing in a country on the far side of the world', () => {
		// Thailand's antipodes are in the Pacific off Peru
		expect(locationName(atlas, 13, -80, 'en')).toBe('')
	})

	test('finds a country that crosses the antimeridian on either side of it', () => {
		const fiji: OfflineMapData = {
			...atlas,
			c: [
				[
					'Fiji',
					'FJ',
					[177, -19, -179, -16],
					[
						[
							[177, -19],
							[-179, -19],
							[-179, -16],
							[177, -16],
							[177, -19],
						],
					],
				],
			],
			p: [],
		}
		expect(locationName(fiji, -17.5, 178, 'en')).toBe('Fiji')
		expect(locationName(fiji, -17.5, -179.5, 'en')).toBe('Fiji')
		expect(locationName(fiji, -17.5, -178, 'en')).toBe('')
	})
})
