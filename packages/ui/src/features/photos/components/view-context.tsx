import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {useLocation, useSearchParams} from 'react-router-dom'

import {clampTileSize, DEFAULT_TILE_SIZE} from '@/features/photos/components/listing/timeline-rows'
import type {PhotoSubKind} from '@/features/photos/constants'

export type Zoom = 'years' | 'months' | 'days'

// What the timeline grid on screen offers the rest of Photos. Null when there
// is no grid — a collections page, say. Published by the grid itself, because
// two of the four answers are the grid's alone: how far out its renderer can
// draw, and where a tile actually is.
export type GridHandle = {
	// Content width, so the zoom control can offer exactly the column counts
	// this width allows
	width: number
	// … down to the smallest tile the grid can draw: the DOM's minimum, or
	// smaller where the canvas is there to draw them (see gpu/capability.ts).
	// The zoom range can never outrun the renderer, because the renderer sets
	// it.
	floor: number
	// The date grouping actually on screen. Below the seam it is always years
	// — a day header is taller than two rows of tiles down there, and there
	// are tens of thousands of them — whatever the user last chose, which is
	// kept and comes back the moment they come back up.
	grouping: Zoom
	// Drive the zoom, in columns. `live` means a gesture owns it: fractional
	// counts are allowed, nothing renders per frame and nothing is persisted
	// until it lets go.
	setColumns: (columns: number, live: boolean) => void
	// … and read it back while a gesture or its settle owns it: the fractional
	// count it is at, null at rest. A pinch runs in the grid's frame loop, off
	// React's render path, so the loop notifies and the zoom control follows
	// by subscription (useSyncExternalStore) rather than through a render.
	liveColumns: () => number | null
	onLiveColumns: (listener: () => void) => () => void
	// The user picked a grouping. Below the seam the grid shows years whatever
	// is picked, so Days or Months there means "show me those": a zoom back up
	// to where headers make sense.
	regroup: (zoom: Zoom) => void
	// Where a tile is on screen right now, taken from the layout rather than
	// the DOM — so a picture can fly from a tile that is a canvas cell, or one
	// that is not mounted at all
	tileRect: (id: string) => {left: number; top: number; width: number; height: number; radius: number} | null
	// Bring an item's tile on screen, jumping the scroll if it is off it — so
	// the lightbox, closed on an item stepped far from where it opened, leaves
	// the timeline at that item with a tile for the picture to fly back to
	revealTile: (id: string) => void
	// The lightbox has this item's picture in the air — flying out of the grid,
	// up on the stage, flying home — so its tile is empty until it lands
	// (undefined). Takes effect at once, in either renderer, without a render.
	liftTile: (id: string | undefined) => void
}

// How many items a list asks for at a time. A screenful at a 14px tile is
// thousands of them and at a 400px tile it is a dozen, so the page follows
// the zoom the app opens at — once per session, because the limit is part of
// a query's identity: every list under the provider (the grid, the lightbox,
// the selection bar) must ask with the same one to share a cache, and
// changing it mid-session would throw away every page already loaded.
export function pageSizeFor(tile: number) {
	return tile >= 96 ? 200 : tile >= 40 ? 500 : 1000
}

// One narrowing the search field has turned into structure: a stretch of the
// calendar, a source, an album, the photo/video split, or a subKind (Live
// Photos, Panoramas, Screenshots, 360°). Free text stays text and matches
// file names and camera make/model. Within a dimension tokens broaden (either
// source), across dimensions they narrow (that source AND that month) — see
// the Photos Filter contract in umbreld.
export type SearchToken =
	| {type: 'date'; label: string; from: number; to: number}
	| {type: 'source'; id: string; label: string}
	| {type: 'album'; id: string; label: string}
	| {type: 'kind'; kind: 'photo' | 'video'}
	| {type: 'subKind'; subKind: PhotoSubKind; label: string}

// What a search means to a list query: the filter fields it contributes
export type SearchFilter = {
	query?: string
	kind?: 'photo' | 'video'
	subKind?: PhotoSubKind
	sourceIds?: string[]
	albumIds?: string[]
	dates?: {from: number; to: number}[]
}

export type PhotosSearch = {
	// What's in the field right now (applied to the grid after a beat)
	text: string
	setText: (text: string) => void
	tokens: SearchToken[]
	// Adds unless already there; a kind token replaces the other kind (a
	// photo/video split has two sides, and picking one means not the other)
	addToken: (token: SearchToken) => void
	removeToken: (index: number) => void
	clear: () => void
	// The field is on stage: wide, focused, suggestions beneath
	open: boolean
	setOpen: (open: boolean) => void
	// Whether anything is narrowing the grid, and the filter fields doing it
	// (text debounced — typing shouldn't cost a list query per keystroke)
	active: boolean
	filter: SearchFilter
}

type PhotosView = {
	zoom: Zoom
	setZoom: (zoom: Zoom) => void
	// The page size every items list asks with; see pageSizeFor
	pageSize: number
	search: PhotosSearch
	// Preferred tile width in px. The grid rounds it to whole columns for its
	// width, so it's device independent; see TILE_SIZE
	tileSize: number
	setTileSize: (size: number) => void
	grid: GridHandle | null
	setGrid: (grid: GridHandle | null) => void
	// Title of the timeline section at the top of the grid (null when there is
	// no grid), shown by the actions bar in the row the grid scrolls under
	section: string | null
	setSection: (section: string | null) => void
}

const PhotosViewContext = createContext<PhotosView | undefined>(undefined)

// View state shared between the actions bar (which sets it) and the listing
// (which reads it): the timeline zoom, the tile size and the search query.
// Tile size is a device preference and lives in localStorage.
const TILE_SIZE_STORAGE_KEY = 'photos:tile-size'
function readTileSize() {
	try {
		const stored = localStorage.getItem(TILE_SIZE_STORAGE_KEY)
		return stored === null ? DEFAULT_TILE_SIZE : clampTileSize(Number(stored))
	} catch {
		return DEFAULT_TILE_SIZE
	}
}
// Typing narrows the grid as it goes, but only once the keys pause for a
// beat: every applied text is a fresh list query, and one per keystroke
// would churn requests for lists nobody sees
const TEXT_APPLY_MS = 250

function useSearchState(): PhotosSearch {
	// A search handed over in the URL (Cmd+K's "Open in Photos") starts the
	// view already narrowed to it
	const [searchParams, setSearchParams] = useSearchParams()
	const handedText = searchParams.get('q') ?? ''
	const [text, setText] = useState(handedText)
	const [tokens, setTokens] = useState<SearchToken[]>([])
	const [open, setOpen] = useState(false)
	const [appliedText, setAppliedText] = useState(handedText.trim())
	useEffect(() => {
		const trimmed = text.trim()
		if (trimmed === appliedText) return
		// Emptying applies at once — backspacing out of a search should show
		// everything back immediately, and a token consuming the text must not
		// leave the stale words narrowing the grid for a beat
		if (trimmed === '') return setAppliedText('')
		const handle = setTimeout(() => setAppliedText(trimmed), TEXT_APPLY_MS)
		return () => clearTimeout(handle)
	}, [text, appliedText])

	// Every view starts whole: navigating away drops the search
	const {pathname} = useLocation()
	const lastPathname = useRef(pathname)
	useEffect(() => {
		if (lastPathname.current === pathname) return
		lastPathname.current = pathname
		setText('')
		setAppliedText('')
		setTokens([])
		setOpen(false)
	}, [pathname])

	// … and one handed over while already here replaces it. Either way the
	// text leaves the address bar once taken, so Back and a reload don't
	// re-apply it.
	useEffect(() => {
		const handed = searchParams.get('q')
		if (handed === null) return
		// A fresh search: whatever was narrowing the view before (a date, a
		// source, videos only) would hide results the palette just showed
		setText(handed)
		setAppliedText(handed.trim())
		setTokens([])
		setOpen(false)
		const next = new URLSearchParams(searchParams)
		next.delete('q')
		setSearchParams(next, {replace: true})
	}, [searchParams, setSearchParams])

	const addToken = useCallback((token: SearchToken) => {
		setTokens((current) => {
			// The photo/video split has two sides, and the filter takes a single
			// subKind: picking one means not the others
			const rest =
				token.type === 'kind' || token.type === 'subKind'
					? current.filter((existing) => existing.type !== token.type)
					: current
			const already = rest.some(
				(existing) =>
					(existing.type === 'date' &&
						token.type === 'date' &&
						existing.from === token.from &&
						existing.to === token.to) ||
					(existing.type === 'source' && token.type === 'source' && existing.id === token.id) ||
					(existing.type === 'album' && token.type === 'album' && existing.id === token.id),
			)
			return already ? rest : [...rest, token]
		})
	}, [])
	const removeToken = useCallback((index: number) => setTokens((current) => current.filter((_, i) => i !== index)), [])
	const clear = useCallback(() => {
		setText('')
		setAppliedText('')
		setTokens([])
	}, [])

	const filter = useMemo<SearchFilter>(() => {
		const dates = tokens.flatMap((token) => (token.type === 'date' ? [{from: token.from, to: token.to}] : []))
		const sourceIds = tokens.flatMap((token) => (token.type === 'source' ? [token.id] : []))
		const albumIds = tokens.flatMap((token) => (token.type === 'album' ? [token.id] : []))
		return {
			query: appliedText || undefined,
			kind: tokens.find((token) => token.type === 'kind')?.kind,
			subKind: tokens.find((token) => token.type === 'subKind')?.subKind,
			sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
			albumIds: albumIds.length > 0 ? albumIds : undefined,
			dates: dates.length > 0 ? dates : undefined,
		}
	}, [tokens, appliedText])

	return useMemo(
		() => ({
			text,
			setText,
			tokens,
			addToken,
			removeToken,
			clear,
			open,
			setOpen,
			active: tokens.length > 0 || appliedText !== '',
			filter,
		}),
		[text, tokens, addToken, removeToken, clear, open, appliedText, filter],
	)
}

export function PhotosViewProvider({children}: {children: React.ReactNode}) {
	const [zoom, setZoom] = useState<Zoom>('months')
	const search = useSearchState()
	const [tileSize, setTileSizeState] = useState(readTileSize)
	const [pageSize] = useState(() => pageSizeFor(tileSize))
	const [grid, setGrid] = useState<GridHandle | null>(null)
	const [section, setSection] = useState<string | null>(null)
	const setTileSize = useCallback((size: number) => setTileSizeState(clampTileSize(size)), [])
	useEffect(() => {
		try {
			localStorage.setItem(TILE_SIZE_STORAGE_KEY, String(Math.round(tileSize)))
		} catch {
			// Private mode etc.: the preference just doesn't persist
		}
	}, [tileSize])
	const value = useMemo(
		() => ({zoom, setZoom, pageSize, search, tileSize, setTileSize, grid, setGrid, section, setSection}),
		[zoom, pageSize, search, tileSize, setTileSize, grid, section],
	)
	return <PhotosViewContext value={value}>{children}</PhotosViewContext>
}

export function usePhotosView() {
	const ctx = useContext(PhotosViewContext)
	if (!ctx) throw new Error('usePhotosView must be used within <PhotosViewProvider />')
	return ctx
}
