import type {RouterOutput} from '@/trpc/trpc'

import type {SearchStatus} from './types'

type SearchIndexing = RouterOutput['search']['indexing']

// The work each search surface's answers rest on: what photos and videos
// show, the faces in them, and the text in photos and documents. Files finds
// nothing by a face. What is said in videos and recordings is the slowest to
// write down and the least looked for, so it holds no surface back: speech is
// counted nowhere, and neither is any count that takes it in (Photos' own, of
// the media it has prepared, does). The previews are left out too: they are
// counted for the whole device, in every size, Files' thumbnails among them.
export const SEARCH_WORK = {
	everywhere: ['embedding', 'faces', 'text'],
	photos: ['embedding', 'faces', 'text'],
	files: ['embedding', 'text'],
	people: ['faces'],
} as const satisfies Record<string, ReadonlyArray<Exclude<keyof SearchIndexing['progress'], 'speech'>>>
export type SearchSurface = keyof typeof SEARCH_WORK

// Under this much left to do the work is over in a moment (a few files just
// added) and is not spoken of at all: nothing flashes for it, and an arc
// nearly whole does not hang on for the last few (see useSearchWork)
const WORTH_SAYING = 25

export type SearchWork = {
	completed: number
	total: number
	// Whole, rounded down, and never 100 while something is left: the one
	// number every surface draws and says, so no two of them can disagree
	percent: number
	// Whether there is enough left to speak of
	substantial: boolean
}

// How far along a surface's work is, or null once none is left
export function searchWork(indexing: SearchIndexing | undefined, surface: SearchSurface): SearchWork | null {
	if (!indexing) return null
	const counts = SEARCH_WORK[surface].map((kind) => indexing.progress[kind])
	const total = counts.reduce((sum, count) => sum + count.total, 0)
	// A count can run ahead of its total between two readings of it
	const completed = counts.reduce((sum, count) => sum + Math.min(count.completed, count.total), 0)
	if (completed >= total) return null
	// From the whole numbers: a fraction times a hundred can land just under one
	const percent = Math.min(Math.floor((completed * 100) / total), 99)
	return {completed, total, percent, substantial: total - completed >= WORTH_SAYING}
}

// What a search surface should admit to while Search is not at full strength:
//   'starting'    the models are still loading, so only names are matched —
//                 whatever the library's progress, that is the thing to say
//   'error'       they could not be run, and names are matched meanwhile
//   'names-only'  this device cannot run them at all; said once, since there
//                 is nothing to wait for (see useSearchFootnote)
//   a percentage  Search is up but has not read all that this surface's
//                 answers rest on (`work`), and whether it is waiting for the
//                 device to have memory to spare before it reads the rest
// and null once there is nothing to say.
export type SearchLearning = 'starting' | 'error' | 'names-only' | {learned: number; waiting?: true} | null

export function searchLearning(status: SearchStatus | undefined, work: SearchWork | null): SearchLearning {
	if (!status) return null
	if (!status.available) {
		if (status.reason === 'starting') return 'starting'
		if (status.reason === 'error') return 'error'
		return status.reason === 'unsupported-device' ? 'names-only' : null
	}
	if (!work) return null
	const learned = work.percent
	return status.indexing.waitingForMemory ? {learned, waiting: true} : {learned}
}
