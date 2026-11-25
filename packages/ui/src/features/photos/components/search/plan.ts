import {composeRouteFilter, type RouteParameters} from '@/features/photos/components/listing/route-filter'
import {tokenKey, tokensFilter, type MapBounds, type SearchToken} from '@/features/photos/components/view-context'
import type {ItemFilter} from '@/features/photos/hooks/use-items'
import type {SearchChip} from '@/features/search/types'

// How a search is answered. There are two engines and this file is the one
// place that chooses between them:
//
//   timeline  photos.items.list with a filter — newest first, date headers,
//             the time rail, keyset pages. Tokens alone (a date, a kind, a
//             source, an album, a person) are exactly a filter, so a search
//             made only of them stays the timeline the user knows.
//   ranked    search.query — what the words *mean*, best match first. Any
//             free text goes here: a description has no place on a calendar.
//
// Both are asked about the same view. Photos decides what is in it — the
// route's own narrowing (Favorites, an album, a person's page) and the
// tokens, composed into one filter — and a ranked search hands Search that
// filter beside the words, so Search only orders what Photos would list
// there. A place is the one narrowing Photos has no filter for: it travels
// beside the filter, and a place token alone is a ranked search with nothing
// to look for. The timeline is kept where Search cannot answer: in Deleted,
// which it never looks in, on the map, whose list is the photos in the
// stretch on screen, and on any device where smart search is not available —
// there free text matches names, as it always has.

export type {SearchChip}

export type SearchPlan =
	| {mode: 'timeline'; filter: ItemFilter}
	| {
			mode: 'ranked'
			// What search.query is asked: the free text (none, for a place alone) …
			query: string
			// … the view to look in, as the timeline would be filtered …
			filter: Omit<ItemFilter, 'query'>
			// … and the places it is narrowed to
			placeIds: string[]
			// The timeline this search falls back to if Search cannot answer
			fallback: ItemFilter
	  }

export function planSearch({
	route,
	text,
	tokens,
	smart,
	map,
}: {
	route: RouteParameters
	// The search's free text, trimmed
	text: string
	tokens: readonly SearchToken[]
	// Whether search.query can be asked (search.status().available)
	smart: boolean
	// On the map: the stretch of it on screen, once the map has one
	map?: {bounds?: MapBounds}
}): SearchPlan {
	const view = composeRouteFilter(route, tokensFilter(tokens), map?.bounds)
	const byName = {...view, query: text || undefined}
	const placeIds = tokens.flatMap((token) => (token.type === 'place' ? [token.id] : []))
	if (!smart || map || view.deleted || (text === '' && placeIds.length === 0)) return {mode: 'timeline', filter: byName}
	return {mode: 'ranked', query: text, filter: view, placeIds, fallback: byName}
}

// ── What Search understood ────────────────────────────────────────────────

// A chip Search read out of the words, as the token it would be in the field
export function chipToken(chip: SearchChip): SearchToken | undefined {
	switch (chip.type) {
		case 'date':
			return {type: 'date', label: chip.label, from: chip.from, to: chip.to}
		case 'person':
			return {type: 'person', id: chip.personId, label: chip.label}
		case 'place':
			return {type: 'place', id: chip.placeId, label: chip.label}
		case 'subKind':
			return {type: 'subKind', subKind: chip.subKind, label: chip.label}
		case 'kind':
			return chip.kind === 'photo' || chip.kind === 'video' ? {type: 'kind', kind: chip.kind} : undefined
	}
}

// The chips to show as "understood": what Search read out of the typed
// words, each once, with the token it would be in the field
export type Understood = {chip: SearchChip; token: SearchToken}

export function understoodChips(chips: readonly SearchChip[]): Understood[] {
	const read = new Map<string, Understood>()
	for (const chip of chips) {
		const token = chipToken(chip)
		if (token && !read.has(tokenKey(token))) read.set(tokenKey(token), {chip, token})
	}
	return [...read.values()]
}
