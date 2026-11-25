import type {File} from '../files/files.ts'
import type {Place} from '../files/places.ts'
import type {PhotoFilter, PhotoItem} from '../photos/types.ts'

import type {ContentHit} from './hits.ts'

// What kind of thing a result is. `file` is anything Search does not look
// inside: it can only match by name.
export const SEARCH_RESULT_KINDS = ['photo', 'video', 'document', 'audio', 'file'] as const
export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number]

// Why a result matched, in the order a person would trust it:
//   name    the file's own name
//   text    words found inside it (a document's text, or text read off a picture)
//   speech  words spoken in it
//   visual  what it looks like
export const SEARCH_MATCHES = ['name', 'text', 'speech', 'visual'] as const
export type SearchMatch = (typeof SEARCH_MATCHES)[number]

export const SEARCH_SCOPES = ['everything', 'files', 'photos'] as const
export type SearchScope = (typeof SEARCH_SCOPES)[number]

// A part of the query understood as a filter and taken out of the text that
// is looked for (see query.ts): someone the one searching has named, when
// something was taken, where, or what kind of thing it is.
//
// `asTyped` is what to look for should that not be what was meant: what was
// typed, with the words the chip was read from in quotes, which are never
// read as anything but words, and without what the other chips were read
// from.
export type SearchFilter =
	| {type: 'date'; label: string; from: number; to: number}
	| {type: 'kind'; label: string; kind: SearchResultKind}
	| {type: 'subKind'; label: string; subKind: 'screenshot' | 'panorama' | 'live' | 'spherical'}
	| {type: 'person'; label: string; personId: string}
	| {type: 'place'; label: string; placeId: string}
export type SearchChip = SearchFilter & {asTyped: string}

export type SearchUnderstanding = {
	chips: SearchChip[]
	// What is left to look for once the chips are taken out
	text: string
}

// A span of a video or recording that matched, so a result can open there
export type SearchMoment = {
	startMs: number
	endMs?: number
	// How long the whole video or recording is, when that is known, so the
	// moment can be shown as a place in it
	durationMs?: number
	// For a video, the URL of a still of it at the moment, authorized like a
	// Files thumbnail
	thumbnail?: string
}

export type SearchSnippet = {
	text: string
	// Half-open [start, end) character ranges of `text` to emphasise
	highlights: Array<[number, number]>
}

export type SearchResult = {
	// Stable for the life of the file's path; safe as a React key
	id: string
	kind: SearchResultKind
	match: SearchMatch
	// 0..1, comparable within one response only
	score: number
	// The file as Files itself reports it, already authorized for the caller,
	// so any Files surface can list and act on a result as it stands
	file: File
	// Present when the file is in the caller's Photos library, so Photos
	// surfaces can render and open it without another round trip
	photo?: PhotoItem
	snippet?: SearchSnippet
	moment?: SearchMoment
	// 1-based page of a document the snippet came from
	page?: number
}

export type SearchResponse = {
	understood: SearchUnderstanding
	// A page of what was found, surest first
	results: SearchResult[]
	// How many were found in all, and where the next page starts: nothing
	// once this was the last
	total: number
	nextCursor?: number
}

export type SearchUnavailableReason =
	// This hardware cannot run the models (Raspberry Pi)
	| 'unsupported-device'
	// The models are still being loaded
	| 'starting'
	| 'error'

export type SearchStatus = {
	// False means only name search works; `reason` says why
	available: boolean
	reason?: SearchUnavailableReason
	// How much of what there is to read the models have read so far, and
	// whether none of them is reading now, with things still to read, for
	// want of memory on the device (see the files module's enrichment)
	// ... or that they are not reading at all, by its owner's choice
	indexing: {completed: number; total: number; waitingForMemory?: boolean; off?: boolean}
}

// How far along each kind of work on a library is: the previews Photos and
// Files show, and what each kind of model has read
export const INDEXING_KINDS = ['previews', 'embedding', 'text', 'faces', 'speech'] as const
export type IndexingKind = (typeof INDEXING_KINDS)[number]
export type SearchIndexing = {
	// Whether the models read the library at all
	enabled: boolean
	progress: Record<IndexingKind, {completed: number; total: number}>
}

export type SearchIndexingProgress = {accountId: string; status: SearchStatus}

// What Search knows about one file beyond what the file index stores
export type SearchInsights = {
	// Text read off a picture or out of a document
	text?: string
	// For text read off a picture, where each of its lines is in the picture:
	// one entry per line of `text`, the line's four corners from its top left
	// clockwise as [x, y, …] fractions of the picture
	textQuads?: number[][]
	// Where a photo or video was taken, by name (see ../files/places.ts)
	place?: {name: string; region?: string; country: string}
	// What is said in a video or recording
	transcript?: Array<{startMs: number; endMs: number; text: string}>
}

// What the file index is asked on Search's behalf, in one of its reader threads
export type SearchRead =
	| {type: 'status'}
	| {type: 'progress'}
	| {type: 'insights'; path: string}
	| {type: 'insights'; photoId: string}
	// The place that what was typed names, of the ones the account has
	// something taken in ...
	| {type: 'place'; text: string}
	// ... which are these
	| {type: 'places'}
	// The people the account has named
	| {type: 'people'}
	| {
			type: 'query'
			text: string
			// What was typed as the model reads it, where the model could be asked
			embedding?: Float32Array
			// ... and as it is spelt in Latin letters, where it was typed in Devanagari
			sounded?: string
			scope: SearchScope
			limit: number
			// With scope 'photos', the Photos view being searched
			filter?: PhotoFilter
			// The places it is narrowed to: only what was taken in one of them
			placeIds?: string[]
	  }

// A file a search found, before Files is asked for it: where it is, and why it
// matched when that was not its name
// `strength` is how sure it is that this is what was meant, from 0 to 1, by
// everything there is to go by; `hit` what was found in it, where that is a
// better reason than what it is called
export type SearchFound = {path: string; hit?: ContentHit; photo?: PhotoItem; strength?: number}
export type SearchReadResult = {
	// With since when memory has kept the models from what they have to read
	status: SearchStatus['indexing'] & {waitingForMemorySince?: number; noRoomForModels?: boolean}
	// A reader thread knows where something was taken (`where`). The index
	// names it (`place`), since it is what has the table of places loaded.
	insights: SearchInsights & {where?: Place}
	place:
		| {id: string; label: string; text: string; words: {from: number; to: number; led: boolean; rest?: string}}
		| undefined
	places: Place[]
	people: Array<{id: string; name: string}>
	query: SearchFound[]
	progress: SearchIndexing['progress']
}
