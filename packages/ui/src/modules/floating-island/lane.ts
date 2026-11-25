import {animate, motionValue, type AnimationPlaybackControls} from 'motion/react'
import {create} from 'zustand'

// The row above the dock that Home's Search pill shares with the floating
// islands. Islands rest on it everywhere; on Home, Search and the islands
// sit side by side, the pair kept centred, so an island never covers Search.
//
// How it moves. The islands are a centred row in normal layout (row.tsx), so
// when a card opens or an island arrives, everything around it gives way in
// the same frame, with nothing to chase. Search lives in another layer (the
// desktop's, under dialogs, fading with the desktop), so it can't be laid out
// with them. It is placed from the row's own width instead, read after each
// layout and written before that frame paints: Search sits half the row's
// width left of centre, the row half of Search's width right of it. Only one
// thing here has a motion of its own: `room`, the islands making room as
// Search comes and goes.
//
// On phones the row scrolls sideways and Search moves into it as its first
// item (`searchSlot`), because a scrolling row can't span two layers.

// Space between Search and the first island, and between islands
export const LANE_GAP = 8
// How far Search sits above the dock
export const SEARCH_DOCK_GAP = 8
// Search's pill height; islands are 40px, so the lane sits a pixel lower to
// share Search's centre line
export const SEARCH_HEIGHT = 38
// A resting island's height
export const ISLAND_HEIGHT = 40
// Roughly the full Search pill's width, and exactly its orb's, for deciding
// when the row is too crowded for each
const SEARCH_FULL_WIDTH = 140
const SEARCH_ORB_WIDTH = 38
// The least space the row keeps from the screen's edges
export const LANE_EDGE = 8

type LaneState = {
	// Home's Search is on screen (the desktop is showing, not under an app,
	// the widget editor, or an immersive dialog)
	searchShown: boolean
	// On phones the lane is one scrolling row, and Search renders into this
	// slot at its start so the two scroll together
	searchSlot: HTMLElement | null
	// Islands currently in the lane
	islandCount: number
	// Islands showing their expanded card
	expandedCount: number
	// The islands leave no room beside them for Search's full pill
	crowded: boolean
	// ...nor for its orb
	full: boolean
	setSearchShown: (shown: boolean) => void
	setSearchSlot: (slot: HTMLElement | null) => void
	setIslandCount: (count: number) => void
	changeExpandedCount: (delta: number) => void
}

export const useLaneStore = create<LaneState>()((set) => ({
	searchShown: false,
	searchSlot: null,
	islandCount: 0,
	expandedCount: 0,
	crowded: false,
	full: false,
	setSearchShown: (searchShown) => set({searchShown}),
	setSearchSlot: (searchSlot) => set({searchSlot}),
	setIslandCount: (islandCount) => set({islandCount}),
	changeExpandedCount: (delta) => set((state) => ({expandedCount: Math.max(0, state.expandedCount + delta)})),
}))

// Quick and critically damped, so the islands are clear of Search before it
// fades in when Home comes back (desktop-misc.tsx holds it back a beat)
const roomSpring = {type: 'spring' as const, stiffness: 700, damping: 53}
// Read when a move happens, so a changed preference applies at once (and
// test environments without matchMedia can import this)
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

type Row = {
	// The strip the row scrolls in when it outgrows the screen
	scroller: HTMLElement
	// What the strip scrolls: Search's slot and the islands
	track: HTMLElement
	// The islands alone
	islands: HTMLElement
}

let row: Row | null = null
// Search, while it stands outside the row (larger screens)
let search: {mover: HTMLElement; pill: HTMLElement} | null = null
let islandsWidth = 0
let searchWidth = 0
// Nothing has been painted in the row yet, so there is nothing to glide
let unpainted = false

// 0: the islands centre themselves. 1: they stand aside for Search.
const room = motionValue(0)
let roomTarget = 0
let roomAnimation: AnimationPlaybackControls | undefined

function place() {
	if (row) {
		const shift = (room.get() * (searchWidth + LANE_GAP)) / 2
		row.track.style.translate = shift === 0 ? '' : `${shift}px`
	}
	if (search) search.mover.style.translate = islandsWidth === 0 ? '' : `${-islandsWidth / 2}px`
}
room.on('change', place)

function makeRoom() {
	const target = search && useLaneStore.getState().searchShown ? 1 : 0
	if (target === roomTarget) return
	roomTarget = target
	roomAnimation?.stop()
	// With no islands up, or none seen yet, nothing would visibly move
	if (islandsWidth === 0 || unpainted || prefersReducedMotion()) {
		room.jump(target)
		place()
	} else roomAnimation = animate(room, target, roomSpring)
}
useLaneStore.subscribe((state, previous) => {
	if (state.searchShown !== previous.searchShown) makeRoom()
})

// Whether Search still fits beside the islands. From the islands' width alone,
// so Search shrinking or stepping out can't change the answer.
function updateFit() {
	const available = row ? row.scroller.clientWidth - LANE_EDGE * 2 : Infinity
	const crowded = islandsWidth > 0 && islandsWidth + SEARCH_FULL_WIDTH > available
	const full = islandsWidth > 0 && islandsWidth + SEARCH_ORB_WIDTH > available
	const state = useLaneStore.getState()
	if (state.crowded !== crowded || state.full !== full) useLaneStore.setState({crowded, full})
}

// A row that has outgrown the screen keeps an open card in the middle of it
// (as near as the row's ends allow) as the card grows, as the screen resizes,
// and as other islands come and go around it. Only on size changes, so the
// row still scrolls freely by hand while a card is open.
function keepOpenCardInView() {
	if (!row) return
	const {scroller} = row
	if (scroller.scrollWidth <= scroller.clientWidth) return
	const card = scroller.querySelector('[data-island-open]')
	if (!card) return
	const view = scroller.getBoundingClientRect()
	const rect = card.getBoundingClientRect()
	scroller.scrollLeft += rect.left + rect.width / 2 - (view.left + view.width / 2)
}

// The islands' row reports for duty (row.tsx). Returns its dismissal.
export function attachRow(elements: Row) {
	row = elements
	unpainted = true
	const painted = requestAnimationFrame(() => requestAnimationFrame(() => (unpainted = false)))
	const measure = () => {
		// Layout width: an arriving island counts as its room opens
		islandsWidth = elements.islands.offsetWidth
		place()
		updateFit()
		keepOpenCardInView()
	}
	measure()
	// Resize observers run after layout and before paint, so Search is placed
	// in the very frame the row changes
	const observer = new ResizeObserver(measure)
	observer.observe(elements.islands)
	observer.observe(elements.scroller)
	return () => {
		observer.disconnect()
		cancelAnimationFrame(painted)
		elements.track.style.translate = ''
		row = null
		islandsWidth = 0
		place()
		updateFit()
	}
}

// Search reports for duty while it stands outside the row (desktop-misc.tsx):
// `mover` is what gets placed, `pill` what the islands stand beside
export function attachSearch(mover: HTMLElement, pill: HTMLElement) {
	search = {mover, pill}
	const measure = () => {
		searchWidth = pill.offsetWidth
		place()
	}
	measure()
	makeRoom()
	const observer = new ResizeObserver(measure)
	observer.observe(pill)
	return () => {
		observer.disconnect()
		mover.style.translate = ''
		search = null
		searchWidth = 0
		makeRoom()
		place()
	}
}
