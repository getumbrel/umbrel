import {keepPreviousData, useQuery} from '@tanstack/react-query'

import {decodeMapPoints} from '@/features/photos/components/map/points'
import type {ItemFilter} from '@/features/photos/hooks/use-items'
import {authorizedHttpUrl} from '@/modules/auth/http-auth'

// Shaped like a tRPC key, so Photos' change events find it among the photos queries
export const MAP_POINTS_KEY = [['photos', 'map', 'points']] as const

export function useMapPoints(filter: ItemFilter) {
	return useQuery({
		queryKey: [...MAP_POINTS_KEY, {filter}],
		queryFn: async ({signal}) => {
			const url = await authorizedHttpUrl(`/api/photos/map/points?filter=${encodeURIComponent(JSON.stringify(filter))}`)
			const response = await fetch(url, {signal})
			if (!response.ok) throw new Error(`Unable to load map points (${response.status})`)
			return decodeMapPoints(await response.arrayBuffer())
		},
		// A search being refined keeps the last answer up until the next
		placeholderData: keepPreviousData,
		staleTime: Infinity,
	})
}
