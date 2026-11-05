import {animate, motionValue, type MotionValue} from 'motion/react'
import {create} from 'zustand'

// The row above the dock that Home's Search pill shares with the floating
// islands. Islands rest on it everywhere; on Home, Search and the islands
// sit side by side, the pair kept centred, so an island never covers Search.
// On phones the row is a single edge-to-edge strip that scrolls sideways,
// with Search (as its orb) as the first item.
//
// From md up, Search stays where it lives (the desktop layer, under dialogs,
// fading with the desktop) and the islands stay in their global layer. They
// only agree on where to stand: both follow one spring, `searchShift`, and the
// islands are anchored to Search's right edge, so the two can't overlap
// mid-motion. A scrolling row can't be shared across layers, so on phones
// Search moves into the islands' row instead (`searchSlot`).

// Space between Search and the first island, and between islands
export const LANE_GAP = 8
// How far Search sits above the dock
export const SEARCH_DOCK_GAP = 8
// Search's pill height; islands are 40px, so the lane sits a pixel lower to
// share Search's centre line
export const SEARCH_HEIGHT = 38

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
	setSearchShown: (searchShown) => set({searchShown}),
	setSearchSlot: (searchSlot) => set({searchSlot}),
	setIslandCount: (islandCount) => set({islandCount}),
	changeExpandedCount: (delta) => set((state) => ({expandedCount: Math.max(0, state.expandedCount + delta)})),
}))

// Live widths, written by ResizeObservers. 0 while absent.
export const searchWidth = motionValue(0)
export const islandsWidth = motionValue(0)

// Critically damped: Search and the islands glide into place without
// overshooting each other
const laneSpring = {type: 'spring' as const, stiffness: 400, damping: 40}
// Quicker for the islands making room when Home comes back, so they're clear
// of Search before it fades in (desktop-misc.tsx holds it back a beat)
const makeRoomSpring = {type: 'spring' as const, stiffness: 700, damping: 53}
// Read when a move happens, so a changed preference applies at once (and
// test environments without matchMedia can import this)
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// A value that springs after `target`, keeping its velocity when retargeted
function follow(target: MotionValue<number>, spring = laneSpring) {
	const value = motionValue(target.get())
	target.on('change', (latest) => {
		if (prefersReducedMotion()) value.jump(latest)
		else animate(value, latest, spring)
	})
	return value
}

// Search's offset from the centre: half the islands (and the gap) to its
// left, so the pair is centred. Tracked even when Search is hidden, so it's
// already in place when Home comes back.
const shiftTarget = motionValue(0)
islandsWidth.on('change', (width) => shiftTarget.set(width > 0 ? -(LANE_GAP + width) / 2 : 0))
export const searchShift = follow(shiftTarget)

// Without Search the islands centre themselves: an extra offset that undoes
// the anchoring to Search's right edge
const searchShownValue = motionValue(0)
const soloTarget = motionValue(-LANE_GAP / 2)
const updateSolo = () => soloTarget.set(searchShownValue.get() ? 0 : -(searchWidth.get() + LANE_GAP) / 2)
searchWidth.on('change', updateSolo)
searchShownValue.on('change', updateSolo)
const soloShift = follow(soloTarget, makeRoomSpring)
useLaneStore.subscribe((state) => searchShownValue.set(state.searchShown ? 1 : 0))

// Left edge of the islands, relative to the centre of the screen
export const islandsLeft = motionValue(0)
const updateLeft = () => islandsLeft.set(searchShift.get() + searchWidth.get() / 2 + LANE_GAP + soloShift.get())
searchShift.on('change', updateLeft)
soloShift.on('change', updateLeft)
searchWidth.on('change', updateLeft)
updateLeft()

// Skip the glide: for the first layout, when nothing has visibly moved yet
export function settleLane() {
	searchShift.jump(shiftTarget.get())
	soloShift.jump(soloTarget.get())
	updateLeft()
}
