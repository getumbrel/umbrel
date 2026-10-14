import {useMemo} from 'react'
import {useLocation, useParams} from 'react-router-dom'

import {usePhotosView, type MapBounds, type SearchFilter} from '@/features/photos/components/view-context'
import {isFilterSection, SECTION_FILTERS, sectionPath} from '@/features/photos/constants'
import type {ItemFilter} from '@/features/photos/hooks/use-items'

type RouteParameters = {
	section?: string
	sourceId?: string
	albumId?: string
}

export function composeRouteFilter(
	{section, sourceId, albumId}: RouteParameters,
	searchFilter: SearchFilter,
	mapBounds?: MapBounds,
): ItemFilter {
	const fixed: ItemFilter = {
		...(isFilterSection(section) ? SECTION_FILTERS[section] : {}),
		...(sourceId ? {sourceIds: [sourceId]} : {}),
		...(albumId ? {albumIds: [albumId]} : {}),
		// The map's list is the photos in the stretch of map on screen
		...(mapBounds ? {bounds: mapBounds} : {}),
	}
	// Search may add orthogonal constraints, but the route remains authoritative
	// for any dimension it fixes. This also prevents stale or undefined search
	// fields from broadening a section, source, or album while navigation settles.
	return {...searchFilter, ...fixed}
}

export function useRouteFilter(): ItemFilter {
	const parameters = useParams()
	const {search, mapArea} = usePhotosView()
	// Only on the map: the page come to from it renders once before the map
	// has taken its area away
	const mapBounds = useLocation().pathname === sectionPath('map') ? mapArea?.bounds : undefined
	return useMemo(
		() => composeRouteFilter(parameters, search.filter, mapBounds),
		[parameters.section, parameters.sourceId, parameters.albumId, search.filter, mapBounds],
	)
}

// Whether a filter narrows nothing at all — the whole-library listing, the
// one the library calendar describes. By value, never by key count: a search
// contributes every one of its fields as undefined, so even the bare library
// route's filter carries keys.
export function isWholeLibrary(filter: ItemFilter) {
	return (
		!filter.query &&
		filter.kind === undefined &&
		filter.subKind === undefined &&
		filter.favorite === undefined &&
		!filter.deleted &&
		!filter.sourceIds?.length &&
		!filter.albumIds?.length &&
		!filter.dates?.length &&
		!filter.bounds
	)
}
