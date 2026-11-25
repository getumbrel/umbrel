import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'

import {trpcReact} from '@/trpc/trpc'

import {searchLearning, searchWork, type SearchSurface, type SearchWork} from './status'
import type {SearchStatus} from './types'

// `percent` is how far along the work the surface's answers rest on is, where
// that work is under way: the arc beside what is typed draws it (see
// SearchArc), and the words say the same number. `short` is those words for
// where a whole sentence has no room, beside a count on a phone or a tablet,
// and `number` the percentage as those words have it, for whoever has to find
// it in them (see SearchNote).
export type SearchFootnoteLine = {text: string; short?: string; percent?: number; number?: string}

// The one line a search surface shows while Search is not at full strength,
// or undefined when there is nothing to say. Nothing is asked without a
// `status`: a surface with no search to speak of passes none.
export function useSearchFootnote(
	surface: Exclude<SearchSurface, 'people'>,
	status: SearchStatus | undefined,
): SearchFootnoteLine | undefined {
	const {t, i18n} = useTranslation()
	const learning = searchLearning(status, useSearchWork(surface, status))
	const told = useToldNamesOnly(learning === 'names-only')

	if (!learning) return undefined
	if (learning === 'starting') return {text: t('search.starting')}
	if (learning === 'error') return {text: t('search.error')}
	if (learning === 'names-only') return told ? undefined : {text: t('search.names-only')}
	// Nothing is counted off while it waits, so that line gives no number to watch
	if (learning.waiting) return {text: t('search.analyzing-waiting-for-memory'), percent: learning.learned}
	const number = new Intl.NumberFormat(i18n.language, {style: 'percent'}).format(learning.learned / 100)
	return surface === 'files'
		? {
				text: t('search.analyzing.files', {percent: number}),
				short: t('search.analyzing-short.files', {percent: number}),
				percent: learning.learned,
				number,
			}
		: {
				text: t('search.analyzing.library', {percent: number}),
				short: t('search.analyzing-short.library', {percent: number}),
				percent: learning.learned,
				number,
			}
}

// The line's percentage alone, for a field that draws the arc while the words
// stand elsewhere: the same counts decide both, so one is never shown without
// the other, and drawing an arc uses up nothing that is said only once
export function useSearchArc(
	surface: Exclude<SearchSurface, 'people'>,
	status: SearchStatus | undefined,
): number | undefined {
	const learning = searchLearning(status, useSearchWork(surface, status))
	return learning !== null && typeof learning === 'object' ? learning.learned : undefined
}

// How often work under way is counted again
const COUNT_EVERY_MS = 5000

// How far along the work a surface's answers rest on is, while it is worth
// saying: null when none is left, when Search is not reading at all (`status`
// has that to say, or the device has the reading switched off: nothing is
// under way then, and what was read before is still found), and for a little
// work that will be over in a moment (see `substantial`). Decided by the counts alone, which every caller
// shares, so two parts of one surface cannot tell it differently. The
// counts have no stream to follow (search.status's own count takes speech in,
// and is only sent when a library changes), so they are asked again while
// work is under way, and never while there is none, while it waits for
// memory (nothing is counted off meanwhile) or while nobody is looking.
// `status` says when to start again: more to read, or the wait over.
export function useSearchWork(surface: SearchSurface, status: SearchStatus | undefined): SearchWork | null {
	const reading = status?.available === true && !status.indexing.off
	const {total, waitingForMemory = false} = status?.indexing ?? {}
	const indexing = trpcReact.search.indexing.useQuery(undefined, {
		enabled: reading,
		retry: false,
		// What was counted the last time this was looked at is asked again
		staleTime: 0,
		refetchInterval: (query) => (!waitingForMemory && searchWork(query.state.data, surface) ? COUNT_EVERY_MS : false),
	})
	// Joining a count already on its way (the first look's own), not starting another
	const {refetch} = indexing
	useEffect(() => {
		if (reading) void refetch({cancelRefetch: false})
	}, [reading, total, waitingForMemory, refetch])
	// Counts on hand from before this look are never shown: a search typed
	// again waits for its own, and one that could not be counted shows none.
	// What was counted last is remembered for as long as nobody is looking
	// (and from the start), and only a count newer than that is drawn.
	const [before, setBefore] = useState(indexing.dataUpdatedAt)
	if (!reading && before !== indexing.dataUpdatedAt) setBefore(indexing.dataUpdatedAt)
	const counted = reading && !indexing.isError && indexing.dataUpdatedAt > before ? indexing.data : undefined
	const work = searchWork(counted, surface)

	return work?.substantial ? work : null
}

const TOLD_NAMES_ONLY_STORAGE_KEY = 'search:told-names-only'
function wasToldNamesOnly() {
	try {
		return localStorage.getItem(TOLD_NAMES_ONLY_STORAGE_KEY) !== null
	} catch {
		return false
	}
}
function rememberToldNamesOnly() {
	try {
		localStorage.setItem(TOLD_NAMES_ONLY_STORAGE_KEY, '1')
	} catch {
		// Private mode: it is said again next time, which is harmless
	}
}

// A device that only ever matches names says so for the first search that is
// shown, on whichever surface, and stays quiet from then on: it is not a
// state that passes. One answer for every surface, kept across visits.
let toldNamesOnly = wasToldNamesOnly()
const toldListeners = new Set<() => void>()
const subscribeToTold = (listener: () => void) => {
	toldListeners.add(listener)
	return () => void toldListeners.delete(listener)
}

// Whether it has been said already. `saying` is a caller with the line to
// show: it is told for good once that caller's search is over, so the line
// stays for as long as the search it was first shown with.
function useToldNamesOnly(saying: boolean) {
	const told = useSyncExternalStore(subscribeToTold, () => toldNamesOnly)
	const said = useRef(false)
	useEffect(() => {
		if (saying && !toldNamesOnly) {
			said.current = true
			// A reload from here on has nothing to say
			rememberToldNamesOnly()
		} else if (!saying && said.current) {
			said.current = false
			toldNamesOnly = true
			for (const listener of toldListeners) listener()
		}
	}, [saying])
	return told
}
