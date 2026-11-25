import {describe, expect, test} from 'vitest'

import type {SearchFilter} from '@/features/photos/components/view-context'
import type {ItemFilter} from '@/features/photos/hooks/use-items'

import {composeRouteFilter, type RouteParameters} from './route-filter'

describe('Photos route filters', () => {
	test.each<[RouteParameters, ItemFilter]>([
		[{}, {}],
		[{section: 'photos'}, {kind: 'photo'}],
		[{section: 'videos'}, {kind: 'video'}],
		[{section: 'live-photos'}, {subKind: 'live'}],
		[{section: 'panoramas'}, {subKind: 'panorama'}],
		[{section: 'screenshots'}, {subKind: 'screenshot'}],
		[{section: '360'}, {subKind: 'spherical'}],
		[{section: 'favorites'}, {favorite: true}],
		[{section: 'deleted'}, {deleted: true}],
		[{sourceId: 'source-a'}, {sourceIds: ['source-a']}],
		[{albumId: 'album-a'}, {albumIds: ['album-a']}],
		[{personId: 'person-a'}, {personIds: ['person-a']}],
	])('the fixed filter for %j', (route, filter) => {
		expect(composeRouteFilter(route, {})).toStrictEqual(filter)
	})

	test.each<[RouteParameters, SearchFilter, ItemFilter]>([
		[{section: 'videos'}, {kind: undefined}, {kind: 'video'}],
		[
			{section: 'live-photos'},
			{subKind: undefined, dates: [{from: 10, to: 20}]},
			{subKind: 'live', dates: [{from: 10, to: 20}]},
		],
		[{sourceId: 'source-a'}, {sourceIds: undefined, kind: 'photo'}, {sourceIds: ['source-a'], kind: 'photo'}],
		[
			{albumId: 'album-a'},
			{albumIds: undefined, personIds: ['person-a']},
			{albumIds: ['album-a'], personIds: ['person-a']},
		],
		[
			{personId: 'person-a'},
			{personIds: undefined, albumIds: ['album-a']},
			{personIds: ['person-a'], albumIds: ['album-a']},
		],
		[{section: 'favorites'}, {kind: 'video'}, {kind: 'video', favorite: true}],
		[{section: 'deleted'}, {dates: [{from: 10, to: 20}]}, {dates: [{from: 10, to: 20}], deleted: true}],
	])('search narrows rather than clears %j', (route, searchFilter, filter) => {
		expect(composeRouteFilter(route, searchFilter)).toStrictEqual(filter)
	})

	test.each<[RouteParameters, SearchFilter, ItemFilter]>([
		[{section: 'videos'}, {kind: 'photo'}, {kind: 'video'}],
		[{section: 'panoramas'}, {subKind: 'screenshot'}, {subKind: 'panorama'}],
		[{sourceId: 'source-a'}, {sourceIds: ['source-b']}, {sourceIds: ['source-a']}],
		[{albumId: 'album-a'}, {albumIds: ['album-b']}, {albumIds: ['album-a']}],
		[{personId: 'person-a'}, {personIds: ['person-b']}, {personIds: ['person-a']}],
	])('a conflicting search token cannot broaden %j', (route, searchFilter, filter) => {
		expect(composeRouteFilter(route, searchFilter)).toStrictEqual(filter)
	})
})
