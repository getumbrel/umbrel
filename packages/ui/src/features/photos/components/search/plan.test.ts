import {describe, expect, test} from 'vitest'

import {chipToken, planSearch, understoodChips, type SearchChip} from '@/features/photos/components/search/plan'
import type {SearchToken} from '@/features/photos/components/view-context'

const DAD: SearchToken = {type: 'person', id: 'p-dad', label: 'Dad'}
const AUG: SearchToken = {type: 'date', label: 'August 2024', from: Date.UTC(2024, 7), to: Date.UTC(2024, 8)}
const VIDEOS: SearchToken = {type: 'kind', kind: 'video'}
const SCREENSHOTS: SearchToken = {type: 'subKind', subKind: 'screenshot', label: 'Screenshots'}
const PHONE: SearchToken = {type: 'source', id: 's-phone', label: "Nate's iPhone"}
const ICELAND: SearchToken = {type: 'album', id: 'a-iceland', label: 'Iceland'}
const THAILAND: SearchToken = {type: 'place', id: 'pl-th', label: 'Thailand'}
const LAOS: SearchToken = {type: 'place', id: 'pl-la', label: 'Laos'}

const plan = (text: string, tokens: SearchToken[] = [], route = {}, smart = true) =>
	planSearch({route, text, tokens, smart})

describe('planSearch', () => {
	test('no search is the route’s timeline', () => {
		expect(plan('')).toEqual({mode: 'timeline', filter: {}})
		expect(plan('', [], {section: 'favorites'})).toMatchObject({mode: 'timeline', filter: {favorite: true}})
	})

	test('tokens alone are a filter: the timeline, with its headers and rail', () => {
		expect(plan('', [DAD, AUG, VIDEOS, PHONE, ICELAND])).toEqual({
			mode: 'timeline',
			filter: {
				kind: 'video',
				personIds: ['p-dad'],
				sourceIds: ['s-phone'],
				albumIds: ['a-iceland'],
				dates: [{from: AUG.from, to: AUG.to}],
			},
		})
	})

	test('free text is ranked by Search, and is all of the query', () => {
		expect(plan('dog on a beach')).toEqual({
			mode: 'ranked',
			query: 'dog on a beach',
			filter: {},
			placeIds: [],
			fallback: {query: 'dog on a beach'},
		})
	})

	test('a ranked search hands its tokens over as the filter the timeline would use, never as words', () => {
		expect(plan('beach', [DAD, AUG, VIDEOS, PHONE, ICELAND])).toEqual({
			mode: 'ranked',
			query: 'beach',
			filter: {
				kind: 'video',
				personIds: ['p-dad'],
				sourceIds: ['s-phone'],
				albumIds: ['a-iceland'],
				dates: [{from: AUG.from, to: AUG.to}],
			},
			placeIds: [],
			fallback: expect.objectContaining({query: 'beach', kind: 'video', albumIds: ['a-iceland']}),
		})
		expect(plan('wifi password', [SCREENSHOTS])).toMatchObject({
			query: 'wifi password',
			filter: {subKind: 'screenshot'},
		})
	})

	test('a place has no filter: it travels beside it, and alone it is still a ranked search', () => {
		expect(plan('', [THAILAND])).toEqual({mode: 'ranked', query: '', filter: {}, placeIds: ['pl-th'], fallback: {}})
		expect(plan('temple', [DAD, THAILAND, LAOS])).toMatchObject({
			mode: 'ranked',
			query: 'temple',
			filter: {personIds: ['p-dad']},
			placeIds: ['pl-th', 'pl-la'],
		})
		// … and without smart search it narrows nothing rather than everything
		expect(plan('', [DAD, THAILAND], {}, false)).toMatchObject({mode: 'timeline', filter: {personIds: ['p-dad']}})
	})

	test.each([
		['a source’s page', {sourceId: 's-phone'}, {sourceIds: ['s-phone']}],
		['an album’s page', {albumId: 'a-iceland'}, {albumIds: ['a-iceland']}],
		['a person’s page', {personId: 'p-unnamed'}, {personIds: ['p-unnamed']}],
		['Favorites', {section: 'favorites'}, {favorite: true}],
		['Videos', {section: 'videos'}, {kind: 'video'}],
	])('text on %s is ranked inside it', (_name, route, filter) => {
		expect(plan('beach', [], route)).toEqual({
			mode: 'ranked',
			query: 'beach',
			filter,
			placeIds: [],
			fallback: {...filter, query: 'beach'},
		})
	})

	test('Deleted keeps the timeline: Search never looks in Trash', () => {
		expect(plan('beach', [THAILAND], {section: 'deleted'})).toEqual({
			mode: 'timeline',
			filter: {deleted: true, query: 'beach'},
		})
	})

	test('without smart search everything is as it was: text matches names', () => {
		expect(plan('beach', [DAD], {}, false)).toEqual({
			mode: 'timeline',
			filter: expect.objectContaining({query: 'beach', personIds: ['p-dad']}),
		})
	})

	test('the route outranks a token on the dimension it fixes', () => {
		expect(plan('', [VIDEOS], {section: 'photos'})).toMatchObject({mode: 'timeline', filter: {kind: 'photo'}})
		expect(plan('beach', [ICELAND], {albumId: 'a-norway'})).toMatchObject({
			mode: 'ranked',
			filter: {albumIds: ['a-norway']},
		})
	})
})

describe('understood chips', () => {
	const chips: SearchChip[] = [
		{type: 'person', label: 'Dad', personId: 'p-dad', asTyped: '"dad"'},
		{type: 'place', label: 'Thailand', placeId: 'pl-th', asTyped: 'in "thailand"'},
		{type: 'date', label: '2026', from: Date.UTC(2026, 0), to: Date.UTC(2027, 0), asTyped: '"2026"'},
		{type: 'kind', label: 'Videos', kind: 'video', asTyped: '"videos"'},
		{type: 'subKind', label: 'Screenshots', subKind: 'screenshot', asTyped: '"screenshots"'},
	]
	const documents: SearchChip = {type: 'kind', label: 'Documents', kind: 'document', asTyped: '"documents"'}

	test('each becomes the token it would be in the field', () => {
		expect(chips.map(chipToken)).toEqual([
			DAD,
			THAILAND,
			{type: 'date', label: '2026', from: Date.UTC(2026, 0), to: Date.UTC(2027, 0)},
			VIDEOS,
			SCREENSHOTS,
		])
		// Photos only holds photos and videos
		expect(chipToken(documents)).toBeUndefined()
	})

	test('a chip repeated by Search shows once', () => {
		expect(understoodChips(chips).map(({chip}) => chip.type)).toEqual(['person', 'place', 'date', 'kind', 'subKind'])
		expect(understoodChips([chips[0]!, chips[0]!])).toEqual([{chip: chips[0], token: DAD}])
		// One that is no token in Photos is not shown at all
		expect(understoodChips([documents])).toEqual([])
	})
})
