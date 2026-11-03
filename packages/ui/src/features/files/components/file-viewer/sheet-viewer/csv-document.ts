// A CSV in the sheet viewer: its bytes and row index live in the CSV worker,
// its edits here, as the engine's immutable overlay — so undo is going back to
// an earlier overlay, and a save sends the current one. Saving always splices
// the file as it was opened, so the overlay is never rebased on a saved file,
// and undo reaches back past a save.

import {Axis} from '@/features/files/components/file-viewer/sheet-viewer/axis'
import {detectNumeric} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/csv'
import {
	createEdits,
	deleteColumns,
	deleteRows,
	editedSize,
	insertColumns,
	insertRows,
	positionOf,
	setCells,
	type CsvEdits,
	type CsvRun,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/edits'
import type {
	CsvClient,
	CsvOpened,
	CsvTarget,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/protocol'
import {WINDOWS_1252_HIGH} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/scan'
import {measure} from '@/features/files/components/file-viewer/sheet-viewer/fonts'
import {
	BLOCK,
	Blocks,
	bounds,
	DocumentStore,
	type Cell,
	type Edge,
	type FindProgress,
	type GridCell,
	type GridSource,
	type Range,
	type SheetDocument,
} from '@/features/files/components/file-viewer/sheet-viewer/model'
import {DARK_BOLD, DARK_FONT} from '@/features/files/components/file-viewer/sheet-viewer/paint'

const ROW_HEIGHT = 28
const COLUMN = {min: 56, max: 320, default: 120}
// Rows read to size the columns and to tell a header row
const SAMPLE = 200
// Rows searched per request, so a find shows its first matches early
const FIND_ROWS = 50_000
// Matches found before a find stops looking
const MAX_MATCHES = 50_000

type Step = {edits: CsvEdits; range: Range}

// Why text typed into a cell can't be written to the file as it is
type CsvProblem = {kind: 'encoding'; char: string} | {kind: 'unquotable'}

export class CsvDocument extends DocumentStore implements SheetDocument {
	readonly hyperlinks = []
	readonly opened: CsvOpened
	readonly #client: CsvClient
	#editable = false
	readonly #type: string
	readonly #blocks: Blocks<string[][]>
	// Blocks fetched for a copy, outside the cache
	readonly #extra = new Map<string, string[][]>()
	// Column widths measured from the first rows, by column in the file
	readonly #widths: Map<number, number>
	readonly #header: boolean
	#edits: CsvEdits
	// The edited grid's size, worked out once per overlay: it walks every edited cell, and every render asks
	#size: {rowCount: number; columnCount: number}
	#saved: CsvEdits
	#serialized: CsvEdits | undefined
	#past: Step[] = []
	#future: Step[] = []
	// Saving as UTF-8, once a character that the file's encoding can't hold has been typed
	#target: CsvTarget | undefined
	#source: GridSource
	// Edits made, undone and redone, which change what a search finds
	#changes = 0

	static async open(client: CsvClient, bytes: ArrayBuffer, name: string, type: string) {
		const opened = await client.open(bytes, name)
		const sample = await client.rows(0, SAMPLE, {start: 0, end: BLOCK.cols})
		const document = new CsvDocument(client, opened, sample, type)
		// The first rows are there before the grid is first drawn
		await document.#blocks.request(0, 0)
		return document
	}

	private constructor(client: CsvClient, opened: CsvOpened, sample: string[][], type: string) {
		super()
		this.#client = client
		this.opened = opened
		this.#type = type
		this.#header = looksLikeHeader(sample)
		this.#widths = new Map()
		for (let col = 0; col < Math.min(opened.columnCount, BLOCK.cols); col++) {
			let width = 0
			sample.forEach((cells, row) => {
				const text = cells[col]?.slice(0, 200)
				if (text) width = Math.max(width, measure(this.#header && row === 0 ? DARK_BOLD : DARK_FONT, text))
			})
			this.#widths.set(col, Math.min(COLUMN.max, Math.max(COLUMN.min, Math.ceil(width + 20))))
		}
		this.#blocks = new Blocks(
			(rowBlock, colBlock) =>
				client.rows(rowBlock * BLOCK.rows, (rowBlock + 1) * BLOCK.rows, {
					start: colBlock * BLOCK.cols,
					end: (colBlock + 1) * BLOCK.cols,
				}),
			(rows) => rows.reduce((sum, cells) => sum + cells.length + 1, 0),
			400_000,
		)
		this.#edits = this.#saved = createEdits(opened)
		this.#size = editedSize(this.#edits, opened)
		this.#source = this.#makeSource()
	}

	get editable() {
		return this.#editable
	}
	// A file only partly read can't be saved whole
	setEditable(editable: boolean) {
		const next = editable && !this.opened.truncated
		if (this.#editable === next) return
		this.#editable = next
		this.#source = this.#makeSource()
		this.notify()
	}
	get source() {
		return this.#source
	}
	get dirty() {
		return this.#edits !== this.#saved
	}
	get canUndo() {
		return this.#past.length > 0
	}
	get canRedo() {
		return this.#future.length > 0
	}
	get rowCount() {
		return this.#size.rowCount
	}
	get colCount() {
		return this.#size.columnCount
	}
	get changes() {
		return this.#changes
	}

	dispose() {
		this.#client.dispose()
	}

	locked() {
		return undefined
	}

	// Text the file can't hold as it is: a character outside its encoding (it
	// can be saved as UTF-8 instead), or a delimiter or line break in a file
	// that doesn't quote
	problem(texts: string[]): CsvProblem | undefined {
		const {dialect} = this.opened
		for (const text of texts) {
			if (dialect.quote === null && (text.includes(dialect.delimiter) || /[\r\n]/.test(text)))
				return {kind: 'unquotable'}
			if (dialect.encoding === 'windows-1252' && !this.#target) {
				const char = [...text].find((c) => {
					const code = c.charCodeAt(0)
					return c.length > 1 || !(code < 0x80 || (code >= 0xa0 && code <= 0xff) || WINDOWS_1252_HIGH.includes(c))
				})
				if (char) return {kind: 'encoding', char}
			}
		}
		return undefined
	}

	convertToUtf8() {
		this.#target = {encoding: 'utf-8', bom: true}
	}

	// A CSV has no locked cells to pass over
	async commit(cells: Array<Cell & {input: string}>) {
		if (!cells.length) return 0
		let edits = this.#edits
		const {rowCount} = this.#size
		// Typing in the empty row under the last adds it
		const range = bounds(cells)
		if (range.bottom >= rowCount) edits = insertRows(edits, rowCount, range.bottom - rowCount + 1)
		edits = setCells(
			edits,
			cells.map(({row, col, input}) => ({row, column: col, value: input})),
		)
		this.#apply(edits, range)
		return 0
	}

	async clear(range: Range) {
		const {rowCount, columnCount} = this.#size
		const bottom = Math.min(range.bottom, rowCount - 1)
		const right = Math.min(range.right, columnCount - 1)
		if (bottom < range.top || right < range.left) return 0
		let edits = this.#edits
		// A whole column or row is replaced by an empty one rather than cleared cell by cell
		if (range.top === 0 && bottom === rowCount - 1) {
			const count = right - range.left + 1
			const colKey = keyFinder(edits.columns)
			// The empty columns keep the widths of those they replace
			for (let i = 0; i < count; i++) {
				const width = this.#widths.get(colKey(range.left + i))
				if (width !== undefined) this.#widths.set(edits.nextKey - i, width)
			}
			edits = insertColumns(deleteColumns(edits, range.left, count), range.left, count)
		} else if (range.left === 0 && right === columnCount - 1) {
			edits = insertRows(deleteRows(edits, range.top, bottom - range.top + 1), range.top, bottom - range.top + 1)
		} else {
			const changes = []
			for (let row = range.top; row <= bottom; row++) {
				for (let column = range.left; column <= right; column++) changes.push({row, column, value: ''})
			}
			edits = setCells(edits, changes)
		}
		this.#apply(edits, range)
		return 0
	}

	insertRows(at: number, count: number) {
		// Below the empty row under the table is the table's end
		const row = Math.min(at, this.rowCount)
		this.#apply(insertRows(this.#edits, row, count), {
			top: row,
			bottom: row + count - 1,
			left: 0,
			right: this.colCount - 1,
		})
	}
	deleteRows(at: number, count: number) {
		const n = Math.min(count, this.rowCount - at)
		if (n > 0) this.#apply(deleteRows(this.#edits, at, n), {top: at, bottom: at, left: 0, right: this.colCount - 1})
	}
	insertColumns(at: number, count: number) {
		this.#apply(insertColumns(this.#edits, at, count), {
			top: 0,
			bottom: this.rowCount - 1,
			left: at,
			right: at + count - 1,
		})
	}
	deleteColumns(at: number, count: number) {
		const n = Math.min(count, this.colCount - at)
		if (n > 0) this.#apply(deleteColumns(this.#edits, at, n), {top: 0, bottom: this.rowCount - 1, left: at, right: at})
	}

	async undo() {
		const step = this.#past.pop()
		if (!step) return undefined
		this.#future.push({edits: this.#edits, range: step.range})
		this.#set(step.edits)
		return step.range
	}

	async redo() {
		const step = this.#future.pop()
		if (!step) return undefined
		this.#past.push({edits: this.#edits, range: step.range})
		this.#set(step.edits)
		return step.range
	}

	// A CSV's data is one table, so its edges are the table's
	async edge(cell: Cell, direction: Edge): Promise<Cell> {
		const {rowCount, columnCount} = this.#size
		if (direction === 'up') return {row: 0, col: cell.col}
		if (direction === 'down') return {row: Math.max(0, rowCount - 1), col: cell.col}
		if (direction === 'left') return {row: cell.row, col: 0}
		return {row: cell.row, col: Math.max(0, columnCount - 1)}
	}

	texts(range: Range): string[][] | undefined {
		const rowKey = keyFinder(this.#edits.rows)
		const colKey = keyFinder(this.#edits.columns)
		const colKeys: number[] = []
		for (let col = range.left; col <= range.right; col++) colKeys.push(colKey(col))
		const rows: string[][] = []
		for (let row = range.top; row <= range.bottom; row++) {
			const key = rowKey(row)
			const cells: string[] = []
			for (const col of colKeys) {
				const text = this.#text(key, col)
				if (text === undefined) return undefined
				cells.push(text)
			}
			rows.push(cells)
		}
		return rows
	}

	async fetchTexts(range: Range): Promise<string[][]> {
		const rowKey = keyFinder(this.#edits.rows)
		const colKey = keyFinder(this.#edits.columns)
		const needed = new Set<string>()
		const colBlocks = new Set<number>()
		for (let col = range.left; col <= range.right; col++) {
			const key = colKey(col)
			if (key >= 0 && key < this.opened.columnCount) colBlocks.add(Math.floor(key / BLOCK.cols))
		}
		for (let row = range.top; row <= range.bottom; row++) {
			const key = rowKey(row)
			if (key >= 0) for (const colBlock of colBlocks) needed.add(`${Math.floor(key / BLOCK.rows)}:${colBlock}`)
		}
		// Asked for all at once: the worker answers in turn, without waiting on each reply
		await Promise.all(
			[...needed].map(async (block) => {
				const [rowBlock, colBlock] = block.split(':').map(Number)
				this.#extra.set(block, await this.#blocks.fetch(rowBlock, colBlock))
			}),
		)
		try {
			return this.texts(range) ?? []
		} finally {
			this.#extra.clear()
		}
	}

	find(query: string, signal: AbortSignal, onProgress: (progress: FindProgress) => void) {
		const edits = this.#edits
		const needle = query.toLowerCase()
		const matches: Cell[] = []
		// What's been typed is searched here; the worker searches the file
		for (const [rowKey, cells] of edits.cells) {
			const row = positionOf(edits.rows, rowKey)
			if (row < 0) continue
			for (const [colKey, text] of cells) {
				const col = positionOf(edits.columns, colKey)
				if (col >= 0 && text.toLowerCase().includes(needle)) matches.push({row, col})
			}
		}
		const sorted = () => [...matches].sort((a, b) => a.row - b.row || a.col - b.col)
		void (async () => {
			for (let start = 0; start < this.opened.rowCount && matches.length < MAX_MATCHES; start += FIND_ROWS) {
				const found = await this.#client.find(query, start, start + FIND_ROWS)
				if (signal.aborted) return
				for (let i = 0; i < found.length && matches.length < MAX_MATCHES; i += 2) {
					const [rowKey, colKey] = [found[i], found[i + 1]]
					if (edits.cells.get(rowKey)?.has(colKey)) continue
					const row = positionOf(edits.rows, rowKey)
					const col = positionOf(edits.columns, colKey)
					if (row >= 0 && col >= 0) matches.push({row, col})
				}
				onProgress({matches: sorted(), done: false})
			}
			if (!signal.aborted) onProgress({matches: sorted(), done: true})
		})().catch(() => !signal.aborted && onProgress({matches: sorted(), done: true}))
		onProgress({matches: sorted(), done: this.opened.rowCount === 0})
	}

	async serialize(): Promise<Blob> {
		const edits = this.#edits
		const saved = await this.#client.save(edits, this.#target)
		this.#serialized = edits
		return new Blob([saved], {type: this.#type})
	}

	saved() {
		if (this.#serialized) this.#saved = this.#serialized
		this.notify()
	}

	#apply(edits: CsvEdits, range: Range) {
		if (edits === this.#edits) return
		this.#past.push({edits: this.#edits, range})
		this.#future = []
		this.#set(edits)
	}

	#set(edits: CsvEdits) {
		this.#changes++
		this.#edits = edits
		this.#size = editedSize(edits, this.opened)
		this.#source = this.#makeSource()
		this.notify()
	}

	// A cell's text as the file and the edits have it, by its row's and column's keys, or undefined while its
	// block is on its way
	#text(rowKey: number, colKey: number) {
		const typed = this.#edits.cells.get(rowKey)?.get(colKey)
		if (typed !== undefined) return typed
		// Inserted lines, the empty row under the table, and columns past the file's
		if (!(rowKey >= 0 && colKey >= 0 && colKey < this.opened.columnCount && rowKey < this.opened.rowCount)) return ''
		const rowBlock = Math.floor(rowKey / BLOCK.rows)
		const colBlock = Math.floor(colKey / BLOCK.cols)
		const rows = this.#blocks.get(rowBlock, colBlock) ?? this.#extra.get(`${rowBlock}:${colBlock}`)
		if (!rows) return undefined
		return rows[rowKey % BLOCK.rows]?.[colKey % BLOCK.cols] ?? ''
	}

	#makeSource(): GridSource {
		const edits = this.#edits
		const {rowCount, columnCount} = this.#size
		const spare = this.#editable ? 1 : 0
		const rowKey = keyFinder(edits.rows)
		const colKey = keyFinder(edits.columns)
		const sizes: number[] = []
		for (let col = 0; col < columnCount + spare; col++) {
			const width = this.#widths.get(colKey(col))
			if (width !== undefined && width !== COLUMN.default) sizes.push(col, width)
		}
		const header = this.#header && rowKey(0) === 0
		const blocks = this.#blocks
		return {
			look: 'dark',
			rows: new Axis(rowCount + spare, ROW_HEIGHT),
			cols: new Axis(columnCount + spare, COLUMN.default, sizes),
			frozen: {rows: header ? 1 : 0, cols: 0},
			merges: [],
			gridLines: true,
			rightToLeft: false,
			headerRow: header,
			cell: (row, col): GridCell | undefined => {
				if (row >= rowCount || col >= columnCount) return undefined
				const text = this.#text(rowKey(row), colKey(col))
				if (!text) return undefined
				return {text, input: text, kind: detectNumeric(text) ? 'n' : 's'}
			},
			lineStyle: () => 0,
			load: (range) => {
				const rowBlocks = new Set<number>()
				const colBlocks = new Set<number>()
				// The rows in view and a block's worth either side
				for (
					let row = Math.max(0, range.top - BLOCK.rows);
					row <= Math.min(rowCount - 1, range.bottom + BLOCK.rows);
					row++
				) {
					const key = rowKey(row)
					if (key >= 0) rowBlocks.add(Math.floor(key / BLOCK.rows))
					// Rows the edits leave in file order: one key per block is enough
					if (edits.rows.length === 1) row += BLOCK.rows - 1 - (row % BLOCK.rows)
				}
				for (let col = range.left; col <= Math.min(columnCount - 1, range.right); col++) {
					const key = colKey(col)
					if (key >= 0 && key < this.opened.columnCount) colBlocks.add(Math.floor(key / BLOCK.cols))
				}
				for (const rowBlock of rowBlocks) {
					for (const colBlock of colBlocks) void blocks.request(rowBlock, colBlock)?.catch(() => {})
				}
			},
			subscribe: (listener) => blocks.subscribe(listener),
		}
	}
}

// A run list's key at each position, by binary search over where its runs start
function keyFinder(runs: readonly CsvRun[]): (position: number) => number {
	const starts: number[] = []
	let position = 0
	for (const run of runs) {
		starts.push(position)
		position += run.count
	}
	return (at) => {
		let low = 0
		let high = runs.length - 1
		while (low < high) {
			const middle = (low + high + 1) >> 1
			if (starts[middle] <= at) low = middle
			else high = middle - 1
		}
		const run = runs[low]
		if (!run || at - starts[low] >= run.count) return Number.NaN
		const offset = at - starts[low]
		return run.key < 0 ? run.key - offset : run.key + offset
	}
}

// A first row of text over columns of numbers is a header: drawn bold and
// kept in view, never written as anything but the row it is
function looksLikeHeader(rows: string[][]): boolean {
	const [first, ...rest] = rows
	if (!first?.some(Boolean) || first.some((text) => text && detectNumeric(text)) || !rest.length) return false
	return first.some((title, col) => {
		if (!title) return false
		const values = rest.map((cells) => cells[col]).filter(Boolean)
		const numbers = values.filter((text) => detectNumeric(text)).length
		return numbers > 0 && numbers >= values.length * 0.6
	})
}
