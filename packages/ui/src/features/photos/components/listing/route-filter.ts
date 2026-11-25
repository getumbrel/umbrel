import type {MapBounds, SearchFilter} from '@/features/photos/components/view-context'
import {isFilterSection, SECTION_FILTERS} from '@/features/photos/constants'
import type {ItemFilter} from '@/features/photos/hooks/use-items'

export type RouteParameters = {
	section?: string
	sourceId?: string
	albumId?: string
	personId?: string
}

export function composeRouteFilter(
	{section, sourceId, albumId, personId}: RouteParameters,
	searchFilter: SearchFilter,
	mapBounds?: MapBounds,
): ItemFilter {
	const fixed: ItemFilter = {
		...(isFilterSection(section) ? SECTION_FILTERS[section] : {}),
		...(sourceId ? {sourceIds: [sourceId]} : {}),
		...(albumId ? {albumIds: [albumId]} : {}),
		...(personId ? {personIds: [personId]} : {}),
		// The map's list is the photos in the stretch of map on screen
		...(mapBounds ? {bounds: mapBounds} : {}),
	}
	// Search may add orthogonal constraints, but the route remains authoritative
	// for any dimension it fixes. This also prevents stale or undefined search
	// fields from broadening a section, source, album or person while navigation settles.
	return {...searchFilter, ...fixed}
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
		!filter.personIds?.length &&
		!filter.dates?.length &&
		!filter.bounds
	)
}
