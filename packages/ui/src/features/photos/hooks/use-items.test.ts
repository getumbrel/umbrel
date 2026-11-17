import {describe, expect, it, vi} from 'vitest'

import {isUniformList, summaryAfterMove, tailFilter, type Item} from './use-items'

vi.mock('@/features/photos/components/view-context', () => ({usePhotosView: () => ({})}))
vi.mock('@/modules/auth/http-auth', () => ({authorizedHttpUrl: async (url: string) => url}))
vi.mock('@/trpc/trpc', () => ({trpcReact: {}}))

const june = Date.UTC(2024, 5, 1)

describe('tailFilter', () => {
	it('bounds a list with no dates of its own at the moment, back to the beginning', () => {
		const {dates, ...rest} = tailFilter({favorite: true}, june)
		expect(rest).toEqual({favorite: true})
		expect(dates).toHaveLength(1)
		expect(dates![0]!.to).toBe(june)
		expect(dates![0]!.from).toBeLessThan(Date.UTC(1000, 0, 1))
		expect(Number.isFinite(dates![0]!.from)).toBe(true)
	})

	it('clips the stretches a list already has, and drops the ones wholly after the moment', () => {
		const filter = {
			dates: [
				{from: Date.UTC(2025, 0, 1), to: Date.UTC(2026, 0, 1)},
				{from: Date.UTC(2024, 0, 1), to: Date.UTC(2025, 0, 1)},
				{from: Date.UTC(2020, 0, 1), to: Date.UTC(2021, 0, 1)},
			],
		}
		expect(tailFilter(filter, june).dates).toEqual([
			{from: Date.UTC(2024, 0, 1), to: june},
			{from: Date.UTC(2020, 0, 1), to: Date.UTC(2021, 0, 1)},
		])
	})
})

describe('isUniformList', () => {
	const list = (limit: number, sizes: number[]) => ({
		queryKey: [['photos', 'items', 'list'], {input: {filter: {}, limit}, type: 'infinite'}],
		state: {data: {pages: sizes.map((size) => ({items: Array.from({length: size})})), pageParams: []}},
	})
	const uniform = (limit: number, sizes: number[]) => isUniformList(list(limit, sizes) as never)

	it('holds for pages the query itself could have fetched, short ones included', () => {
		expect(uniform(200, [200, 200, 37])).toBe(true)
		expect(uniform(200, [])).toBe(true)
	})

	it('fails once a larger page has been spliced in', () => {
		expect(uniform(200, [200, 1000])).toBe(false)
	})
})

describe('summaryAfterMove', () => {
	const summary = {
		counts: {items: 10, favorites: 3, photos: 8, videos: 2, deleted: 1},
		sizeBytes: 1000,
		bySubKind: {live: 0, panorama: 1, screenshot: 2, spherical: 0},
		bySource: {'umbrel:0': 10},
		months: [
			{year: 2024, month: 6, count: 6},
			{year: 2024, month: 3, count: 1},
			{year: 2023, month: 12, count: 3},
		],
	}
	const item = (id: string, takenAt: number, extra: Partial<Item> = {}): Item => ({
		id,
		kind: 'photo',
		takenAt,
		width: 4,
		height: 3,
		isFavorite: false,
		...extra,
	})
	const moved = [
		item('a', Date.UTC(2024, 5, 10), {isFavorite: true}),
		item('b', Date.UTC(2024, 2, 2), {subKind: 'screenshot'}),
		item('c', Date.UTC(2023, 11, 31, 23), {kind: 'video'}),
	]

	it('takes what goes to the Trash out of every count the items are known to be in', () => {
		const after = summaryAfterMove(summary, moved, 3, 'trash')
		expect(after.counts).toEqual({items: 7, favorites: 2, photos: 6, videos: 1, deleted: 4})
		expect(after.bySubKind).toEqual({live: 0, panorama: 1, screenshot: 1, spherical: 0})
		// March 2024 held one and now holds none: it is gone from the calendar
		expect(after.months).toEqual([
			{year: 2024, month: 6, count: 5},
			{year: 2023, month: 12, count: 2},
		])
		// What the lists cannot tell is left for the server's answer
		expect(after.sizeBytes).toBe(1000)
		expect(after.bySource).toEqual(summary.bySource)
	})

	it('puts back what is restored, a month the calendar no longer had in its place', () => {
		const emptied = summaryAfterMove(summary, moved, 3, 'trash')
		expect(summaryAfterMove(emptied, moved, 3, 'library')).toEqual(summary)
	})

	it('counts items the lists do not hold in the totals alone, and never below nothing', () => {
		const after = summaryAfterMove(summary, [], 12, 'trash')
		expect(after.counts).toEqual({items: 0, favorites: 3, photos: 8, videos: 2, deleted: 13})
		expect(after.months).toEqual(summary.months)
	})
})
