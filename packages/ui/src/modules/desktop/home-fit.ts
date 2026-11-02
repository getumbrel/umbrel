import {useSyncExternalStore} from 'react'
import {useWindowSize} from 'react-use'

/** Where the `panes` variant in index.css starts: room for two panes side by side */
export const PANES_MIN_W = 640
/** Under this width, Home uses its phone scale */
const PHONE_SCALE_BELOW_W = 640
/** Under this height Home uses its phone scale at any width */
const LOW_BELOW_H = 500
/** Under this height the logo sits beside the greeting instead of above it */
const INLINE_HEADER_BELOW_H = 600
/** Landscape under this height: the header goes inline and widgets lose their names */
const TIGHT_BELOW_H = 700
/** Where the desktop layout starts (`lg`) */
const DESKTOP_MIN_W = 1024

export type HomeFit = {
	/** Phone-size apps and widgets */
	phoneScale: boolean
	/** Short screens can have more columns, since they have fewer rows */
	low: boolean
	/** The logo beside the greeting, one line tall, instead of above it */
	inlineHeader: boolean
	/** No names under widgets, and shorter widgets at the regular scale */
	tightWidgets: boolean
}

/**
 * How Home fits a window. It answers to height as well as width: the logo,
 * greeting and Search take up the same height at any width, so on short screens
 * they tighten up to leave room for apps.
 *
 * A laptop's browser is as short as a tablet on its side, but it isn't one: at
 * desktop widths only a touchscreen tightens up, and a laptop keeps the regular
 * Home, with the logo above the greeting and names under widgets.
 */
export function homeFit({width, height, touch = false}: {width: number; height: number; touch?: boolean}): HomeFit {
	const low = height < LOW_BELOW_H
	const tight = width > height && height < TIGHT_BELOW_H && (width < DESKTOP_MIN_W || touch)
	return {
		phoneScale: width < PHONE_SCALE_BELOW_W || low,
		low,
		inlineHeader: height < INLINE_HEADER_BELOW_H || tight,
		tightWidgets: tight,
	}
}

export function useHomeFit() {
	return homeFit({...useWindowSize(), touch: useIsTouch()})
}

const TOUCH_QUERY = '(pointer: coarse)'

function subscribeTouch(onChange: () => void) {
	const query = window.matchMedia?.(TOUCH_QUERY)
	query?.addEventListener('change', onChange)
	return () => query?.removeEventListener('change', onChange)
}

const getTouch = () => window.matchMedia?.(TOUCH_QUERY).matches ?? false

/** Whether the main pointer is a finger: a tablet, not a laptop */
export function useIsTouch() {
	return useSyncExternalStore(subscribeTouch, getTouch, () => false)
}

/**
 * The most columns of cells that fit a width, then the cell and gap that fill
 * it. Cells and gaps give up some of their size before a column is lost.
 */
export function fitColumns({
	width,
	maxColumns,
	cell,
	gap,
}: {
	width: number
	maxColumns: number
	cell: {min: number; max: number}
	gap: {min: number; max: number}
}) {
	const columns = Math.min(maxColumns, Math.floor((width + gap.min) / (cell.min + gap.min)))
	if (columns < 2) return {columns: Math.max(columns, 0), cellW: cell.max, gapX: gap.max}
	const cellW = Math.min(cell.max, Math.floor((width - gap.min * (columns - 1)) / columns))
	const gapX = Math.min(gap.max, (width - columns * cellW) / (columns - 1))
	return {columns, cellW, gapX}
}

/**
 * The most rows of a height that fit, and the gap that spreads them over the
 * height. With `gapAbove`, something sits above the rows, one more gap's away.
 */
export function fitRows({
	height,
	rowH,
	gap,
	gapAbove = false,
}: {
	height: number
	rowH: number
	gap: {min: number; max: number}
	gapAbove?: boolean
}) {
	const usable = gapAbove ? height - gap.min : height
	const rows = Math.max(0, Math.floor((usable + gap.min) / (rowH + gap.min)))
	const gaps = gapAbove ? rows : rows - 1
	if (rows === 0 || gaps === 0) return {rows, gapY: gap.min}
	const gapY = Math.max(gap.min, Math.min(gap.max, (height - rows * rowH) / gaps))
	return {rows, gapY}
}
