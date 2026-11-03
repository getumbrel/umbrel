// What the grid draws from, whichever file is behind it, and what the viewer
// asks of that file. The CSV and XLSX documents (csv-document, xlsx-document)
// each keep their cells in a worker and a cache of blocks here, so drawing
// reads cells synchronously and scrolling only waits for blocks it hasn't seen.

import type {Axis} from '@/features/files/components/file-viewer/sheet-viewer/axis'
import {parseRange, type Range} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/package'
import type {CellKind} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/protocol'
import type {Hyperlink} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/sheet'
import type {RichRun} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/strings'
import type {ResolvedStyles} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/styles'

export type {Range}

export type Cell = {row: number; col: number}

// The range runs from the anchor, which is the active cell, to the focus
export type Selection = {anchor: Cell; focus: Cell}

export type GridCell = {
	text: string
	input: string // what the formula bar shows and editing starts from
	kind: CellKind
	style?: number
	value?: number
	color?: string
	fill?: {char: string; index: number}
	runs?: readonly RichRun[]
}

// A sheet as the grid sees it at one moment: its shape and how it looks. A
// change of shape (an inserted row, another sheet) is a new source; cells
// arriving from the worker are announced through subscribe.
export type GridSource = {
	// Paper is an Excel sheet with its own styling; dark is a CSV, which has none
	look: 'paper' | 'dark'
	rows: Axis
	cols: Axis
	frozen: {rows: number; cols: number}
	merges: readonly Range[]
	gridLines: boolean
	rightToLeft: boolean
	styles?: ResolvedStyles
	// A CSV's first row when it reads as a header: drawn bold, and kept in view
	headerRow: boolean
	cell(row: number, col: number): GridCell | undefined
	// The style of a cell without one of its own: its row's, else its column's
	lineStyle(row: number, col: number): number
	// Asks for the cells of a range ahead of drawing them
	load(range: Range): void
	subscribe(listener: () => void): () => void
}

export type Edge = 'up' | 'down' | 'left' | 'right'

export type FindProgress = {matches: Cell[]; done: boolean}

// Why a cell can't be edited on its own: it's part of an array formula, not its top-left cell, a table's header or
// totals, or locked on a protected sheet
export type Lock = 'array' | 'table' | 'protected'

// What the viewer can do with the file behind a grid
export type SheetDocument = {
	source: GridSource
	locked(row: number, col: number): Lock | undefined
	hyperlinks: readonly Hyperlink[]
	// Typed input. Rejects with FormulaSyntaxError when `strict` and a formula doesn't parse. Both resolve to how many
	// of the cells were locked, and left as they were.
	commit(cells: Array<Cell & {input: string}>, strict: boolean): Promise<number>
	clear(range: Range): Promise<number>
	// Undo and redo resolve to the range they changed, to select it
	undo(): Promise<Range | undefined>
	redo(): Promise<Range | undefined>
	canUndo: boolean
	canRedo: boolean
	// Where Ctrl+arrow lands
	edge(cell: Cell, direction: Edge): Promise<Cell>
	// The texts of a range, from what's loaded, or undefined while any of it isn't
	texts(range: Range): string[][] | undefined
	fetchTexts(range: Range): Promise<string[][]>
	// Matches in reading order, reported as they're found until `signal` aborts
	find(query: string, signal: AbortSignal, onProgress: (progress: FindProgress) => void): void
	dirty: boolean
	serialize(): Promise<Blob>
	// The file now holds what the last serialize produced
	saved(): void
	// The data's extent: the title says "1,204 rows", End goes to its last column
	rowCount: number
	colCount: number
}

// What a document's viewer renders by: a version that moves with every change, and the listeners told when it does
export class DocumentStore {
	#version = 0
	readonly #listeners = new Set<() => void>()

	get version() {
		return this.#version
	}

	subscribe = (listener: () => void) => {
		this.#listeners.add(listener)
		return () => void this.#listeners.delete(listener)
	}

	protected notify() {
		this.#version++
		this.#listeners.forEach((listener) => listener())
	}
}

// Cells come from a worker in blocks of 128 rows by 256 columns, fetched as
// the grid reaches them and kept while there's room: `budget` counts what
// they hold, so a wide sheet keeps fewer blocks than a narrow one
export const BLOCK = {rows: 128, cols: 256}

export class Blocks<T> {
	readonly #fetch: (rowBlock: number, colBlock: number) => Promise<T>
	readonly #weight: (block: T) => number
	readonly #budget: number
	// In order of use, the most recent last
	readonly #blocks = new Map<string, T>()
	readonly #pending = new Set<string>()
	readonly #listeners = new Set<() => void>()
	#held = 0
	// Blocks asked for before a clear() are dropped when they arrive
	#generation = 0

	constructor(fetch: (rowBlock: number, colBlock: number) => Promise<T>, weight: (block: T) => number, budget: number) {
		this.#fetch = fetch
		this.#weight = weight
		this.#budget = budget
	}

	get(rowBlock: number, colBlock: number): T | undefined {
		return this.#blocks.get(`${rowBlock}:${colBlock}`)
	}

	request(rowBlock: number, colBlock: number): Promise<T> | undefined {
		const key = `${rowBlock}:${colBlock}`
		const held = this.#blocks.get(key)
		if (held) {
			this.#blocks.delete(key)
			this.#blocks.set(key, held)
			return undefined
		}
		if (this.#pending.has(key)) return undefined
		this.#pending.add(key)
		const generation = this.#generation
		return this.#fetch(rowBlock, colBlock).then(
			(block) => {
				if (generation !== this.#generation) return block
				this.#pending.delete(key)
				this.#blocks.set(key, block)
				this.#held += this.#weight(block)
				for (const [oldest, old] of this.#blocks) {
					if (this.#held <= this.#budget || oldest === key) break
					this.#blocks.delete(oldest)
					this.#held -= this.#weight(old)
				}
				this.#listeners.forEach((listener) => listener())
				return block
			},
			(error: unknown) => {
				if (generation === this.#generation) this.#pending.delete(key)
				throw error
			},
		)
	}

	// A block for a one-off read (a large copy), without crowding out the ones in view
	fetch(rowBlock: number, colBlock: number): Promise<T> {
		const held = this.get(rowBlock, colBlock)
		return held ? Promise.resolve(held) : this.#fetch(rowBlock, colBlock)
	}

	// The blocks held and on their way, as [rowBlock, colBlock]
	held(): Array<[number, number]> {
		return [...this.#blocks.keys(), ...this.#pending].map((key) => {
			const [rowBlock, colBlock] = key.split(':').map(Number)
			return [rowBlock, colBlock]
		})
	}

	// Patches the blocks held, as edits come back
	update(patch: (block: T, rowBlock: number, colBlock: number) => void) {
		for (const [key, block] of this.#blocks) {
			const [rowBlock, colBlock] = key.split(':').map(Number)
			patch(block, rowBlock, colBlock)
		}
		this.#listeners.forEach((listener) => listener())
	}

	clear() {
		this.#generation++
		this.#blocks.clear()
		this.#pending.clear()
		this.#held = 0
		this.#listeners.forEach((listener) => listener())
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}
}

// Asks for the blocks covering a range, with a block more above and below so
// scrolling finds the next rows already there
export function loadAround<T>(blocks: Blocks<T>, range: Range, rowLimit: number, colLimit: number) {
	const top = Math.max(0, Math.floor(range.top / BLOCK.rows) - 1)
	const bottom = Math.min(Math.floor(Math.max(0, rowLimit - 1) / BLOCK.rows), Math.floor(range.bottom / BLOCK.rows) + 1)
	const left = Math.floor(range.left / BLOCK.cols)
	const right = Math.min(Math.floor(Math.max(0, colLimit - 1) / BLOCK.cols), Math.floor(range.right / BLOCK.cols))
	// What's in view first
	const inView = (rowBlock: number) =>
		rowBlock >= Math.floor(range.top / BLOCK.rows) && rowBlock <= Math.floor(range.bottom / BLOCK.rows)
	for (const near of [true, false]) {
		for (let rowBlock = top; rowBlock <= bottom; rowBlock++) {
			if (inView(rowBlock) !== near) continue
			for (let colBlock = left; colBlock <= right; colBlock++) void blocks.request(rowBlock, colBlock)?.catch(() => {})
		}
	}
}

export const rangeOf = ({anchor, focus}: Selection): Range => ({
	top: Math.min(anchor.row, focus.row),
	left: Math.min(anchor.col, focus.col),
	bottom: Math.max(anchor.row, focus.row),
	right: Math.max(anchor.col, focus.col),
})

export const inRange = (range: Range, row: number, col: number) =>
	row >= range.top && row <= range.bottom && col >= range.left && col <= range.right

// The merge a cell is part of
export const mergeAt = (merges: readonly Range[], row: number, col: number) =>
	merges.find((merge) => inRange(merge, row, col))

// What a cell is drawn and selected as: the merge it's part of, or itself
export const areaAt = (merges: readonly Range[], row: number, col: number): Range =>
	mergeAt(merges, row, col) ?? {top: row, left: col, bottom: row, right: col}

export const sameRange = (a: Range, b: Range) =>
	a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right

// Whether a range runs the whole width of its rows or the whole height of its columns (from the first line that
// isn't hidden), as a header press selects: such a selection is never grown into merges
export const wholeLines = (range: Range, {rows, cols}: Pick<GridSource, 'rows' | 'cols'>) =>
	(range.left <= visibleLine(cols, 0, 1) && range.right === cols.count - 1) ||
	(range.top <= visibleLine(rows, 0, 1) && range.bottom === rows.count - 1)

// What a selection covers: whole rows or columns as they are, anything else grown until no merge sticks out of
// it, as Excel selects
export function selectionRange(selection: Selection, source: Pick<GridSource, 'rows' | 'cols' | 'merges'>): Range {
	const range = rangeOf(selection)
	return wholeLines(range, source) ? range : withMerges(range, source.merges)
}

// Whether two ranges share a cell
export const overlaps = (a: Range, b: Range) =>
	a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left

// A range grown until no merge sticks out of it, as Excel selects
export function withMerges(range: Range, merges: readonly Range[]): Range {
	let grown = range
	for (let changed = true; changed; ) {
		changed = false
		for (const merge of merges) {
			const inside =
				merge.top >= grown.top && merge.bottom <= grown.bottom && merge.left >= grown.left && merge.right <= grown.right
			if (!overlaps(merge, grown) || inside) continue
			grown = {
				top: Math.min(grown.top, merge.top),
				left: Math.min(grown.left, merge.left),
				bottom: Math.max(grown.bottom, merge.bottom),
				right: Math.max(grown.right, merge.right),
			}
			changed = true
		}
	}
	return grown
}

// Where a link within a workbook points: a cell or a range, after the name of
// its sheet when it's on another ('Q1!Data'!B3 quotes a name, doubling its own
// quotes). Nothing for what isn't a reference, like a defined name.
export function placeOf(location: string): {sheet?: string; range: Range} | undefined {
	const bang = location.lastIndexOf('!')
	const range = parseRange(location.slice(bang + 1))
	if (!range) return undefined
	if (bang < 0) return {range}
	return {
		sheet: location
			.slice(0, bang)
			.replace(/^'(.*)'$/, '$1')
			.replaceAll("''", "'"),
		range,
	}
}

// The smallest range holding every cell
export function bounds(cells: Iterable<Cell>): Range {
	const range = {top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity}
	for (const {row, col} of cells) {
		range.top = Math.min(range.top, row)
		range.bottom = Math.max(range.bottom, row)
		range.left = Math.min(range.left, col)
		range.right = Math.max(range.right, col)
	}
	return range
}

// The line nearest to i that isn't hidden, looking `direction` first: where
// Home, End and paging land when the line they aim at is hidden
export function visibleLine(axis: Axis, i: number, direction: 1 | -1): number {
	for (const d of [direction, -direction]) {
		for (let j = i; j >= 0 && j < axis.count; j += d) if (axis.size(j) > 0) return j
	}
	return i
}

// One cell along from another, past hidden rows and columns and out of the
// merge it's in; at the sheet's edge it stays put
export function step(
	source: Pick<GridSource, 'rows' | 'cols' | 'merges'>,
	from: Cell,
	dRow: number,
	dCol: number,
): Cell {
	const {rows, cols, merges} = source
	const merge = mergeAt(merges, from.row, from.col)
	let row = dRow > 0 && merge ? merge.bottom : dRow < 0 && merge ? merge.top : from.row
	let col = dCol > 0 && merge ? merge.right : dCol < 0 && merge ? merge.left : from.col
	do {
		row += dRow
		col += dCol
	} while (row >= 0 && row < rows.count && col >= 0 && col < cols.count && (!rows.size(row) || !cols.size(col)))
	return row < 0 || row >= rows.count || col < 0 || col >= cols.count ? from : {row, col}
}
