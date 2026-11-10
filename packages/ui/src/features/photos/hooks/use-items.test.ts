import {describe, expect, it, vi} from 'vitest'

import {tailFilter} from './use-items'

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
