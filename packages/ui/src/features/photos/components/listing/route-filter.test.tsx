// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useItems} from '@/features/photos/hooks/use-items'

import {useRouteFilter} from './route-filter'

const fixtures = vi.hoisted(() => ({
	searchFilter: {} as Record<string, unknown>,
	mapArea: null as {bounds: Record<string, number>} | null,
	listInput: undefined as unknown,
}))

vi.mock('@/features/photos/components/view-context', () => ({
	usePhotosView: () => ({
		pageSize: 200,
		search: {filter: fixtures.searchFilter},
		mapArea: fixtures.mapArea,
	}),
}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		photos: {
			items: {
				list: {
					useInfiniteQuery: (input: unknown) => {
						fixtures.listInput = input
						return {data: undefined, hasNextPage: false, isFetchingNextPage: false, isLoading: false}
					},
				},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
	useItems(useRouteFilter())
	return null
}

describe('Photos route filters', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		fixtures.searchFilter = {}
		fixtures.mapArea = null
		fixtures.listInput = undefined
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.clearAllMocks()
	})

	function render(path: string, searchFilter: Record<string, unknown> = {}) {
		fixtures.searchFilter = searchFilter
		act(() =>
			root.render(
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path='/photos' element={<Probe />} />
						<Route path='/photos/:section' element={<Probe />} />
						<Route path='/photos/source/:sourceId' element={<Probe />} />
						<Route path='/photos/albums/:albumId' element={<Probe />} />
					</Routes>
				</MemoryRouter>,
			),
		)
		return fixtures.listInput
	}

	test.each([
		['/photos', {}],
		['/photos/photos', {kind: 'photo'}],
		['/photos/videos', {kind: 'video'}],
		['/photos/live-photos', {subKind: 'live'}],
		['/photos/panoramas', {subKind: 'panorama'}],
		['/photos/screenshots', {subKind: 'screenshot'}],
		['/photos/360', {subKind: 'spherical'}],
		['/photos/favorites', {favorite: true}],
		['/photos/deleted', {deleted: true}],
		['/photos/source/source-a', {sourceIds: ['source-a']}],
		['/photos/albums/album-a', {albumIds: ['album-a']}],
	])('sends the fixed filter for %s', (path, filter) => {
		expect(render(path)).toStrictEqual({filter, limit: 200})
	})

	test.each([
		['/photos/videos', {query: 'sunset', kind: undefined}, {query: 'sunset', kind: 'video'}],
		[
			'/photos/live-photos',
			{query: 'beach', subKind: undefined, dates: [{from: 10, to: 20}]},
			{query: 'beach', subKind: 'live', dates: [{from: 10, to: 20}]},
		],
		[
			'/photos/source/source-a',
			{query: 'camera', sourceIds: undefined, kind: 'photo'},
			{query: 'camera', sourceIds: ['source-a'], kind: 'photo'},
		],
		[
			'/photos/albums/album-a',
			{query: 'family', albumIds: undefined, favorite: undefined},
			{query: 'family', albumIds: ['album-a'], favorite: undefined},
		],
		['/photos/favorites', {query: 'cat'}, {query: 'cat', favorite: true}],
		['/photos/deleted', {query: 'old'}, {query: 'old', deleted: true}],
	])('search narrows rather than clears %s', (path, searchFilter, filter) => {
		expect(render(path, searchFilter)).toStrictEqual({filter, limit: 200})
	})

	test.each([
		['/photos/videos', {kind: 'photo'}, {kind: 'video'}],
		['/photos/panoramas', {subKind: 'screenshot'}, {subKind: 'panorama'}],
		['/photos/source/source-a', {sourceIds: ['source-b']}, {sourceIds: ['source-a']}],
		['/photos/albums/album-a', {albumIds: ['album-b']}, {albumIds: ['album-a']}],
	])('a conflicting stale search token cannot broaden %s', (path, searchFilter, filter) => {
		expect(render(path, searchFilter)).toStrictEqual({filter, limit: 200})
	})

	const bounds = {west: -9.3, south: 38.6, east: -9, north: 38.8}

	test("narrows the map's list to the stretch of map on screen", () => {
		fixtures.mapArea = {bounds}
		expect(render('/photos/map', {query: 'tram'})).toStrictEqual({filter: {query: 'tram', bounds}, limit: 200})
	})

	test("leaves the map's area behind on the page come to from it", () => {
		fixtures.mapArea = {bounds}
		expect(render('/photos/favorites')).toStrictEqual({filter: {favorite: true}, limit: 200})
	})
})
