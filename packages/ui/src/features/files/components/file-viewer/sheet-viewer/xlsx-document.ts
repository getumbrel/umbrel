// An Excel workbook in the sheet viewer. The worker holds the workbook and
// its Calculator; here are the blocks of cells the grid draws, the sheet in
// view, and the undo history: each step names what the worker kept of the
// edited cells, their exact content before and after, which it puts back,
// recalculating what reads them.

import {Axis} from '@/features/files/components/file-viewer/sheet-viewer/axis'
import {MAX_COLS, MAX_ROWS} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/package'
import {
	heldKey,
	SPARE,
	type HeldBlocks,
	type XlsxClient,
	type XlsxEdited,
	type XlsxOpened,
	type XlsxSheet,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/protocol'
import {
	BLOCK,
	Blocks,
	bounds,
	DocumentStore,
	inRange,
	loadAround,
	type Cell,
	type Edge,
	type FindProgress,
	type GridCell,
	type GridSource,
	type Lock,
	type Range,
	type SheetDocument,
} from '@/features/files/components/file-viewer/sheet-viewer/model'

// Rows searched per request, so a find shows its first matches early
const FIND_ROWS = 20_000
const MAX_MATCHES = 50_000

type XlsxBlock = {cells: Map<number, GridCell>; rowStyles: Map<number, number>}
type SheetState = {
	meta: XlsxSheet
	blocks: Blocks<XlsxBlock>
	colStyles: Map<number, number>
	arrays: Range[]
	// The used range, grown by what's typed past it
	used: {rows: number; cols: number}
	source?: GridSource
}
// `id` names what the worker kept of it
type Step = {sheet: number; id: number; range: Range}

const at = (row: number, col: number) => (row % BLOCK.rows) * BLOCK.cols + (col % BLOCK.cols)

export class XlsxDocument extends DocumentStore implements SheetDocument {
	readonly opened: XlsxOpened
	readonly #client: XlsxClient
	#editable = false
	readonly #type: string
	readonly #sheets = new Map<number, SheetState>()
	#active: number
	#steps: Step[] = []
	#done = 0
	// The last step the file holds, and the last one serialized, by identity (undefined is the file as opened):
	// after an undo past a save, a new edit makes another history that a count would mistake for the saved one
	#saved: Step | undefined
	#serialized: Step | undefined
	// What's been typed, shown until the worker has it formatted
	readonly #pending = new Map<string, GridCell>()
	// Edits and clears the worker hasn't answered yet: they're unsaved from the moment they're asked for, as a
	// workbook's first edit can take the worker seconds
	#inflight = 0
	// Edits, undos and saves, one after another
	#queue: Promise<unknown> = Promise.resolve()
	// Edits landed, which change what a search finds (a typed value shows before its edit lands)
	#changes = 0

	static async open(client: XlsxClient, bytes: ArrayBuffer, maxCells: number, type: string) {
		const opened = await client.open(bytes, maxCells)
		const document = new XlsxDocument(client, opened, type)
		await document.select(opened.activeSheet)
		// The first cells are there before the grid is first drawn
		await document.#state().blocks.request(0, 0)
		return document
	}

	private constructor(client: XlsxClient, opened: XlsxOpened, type: string) {
		super()
		this.#client = client
		this.opened = opened
		this.#type = type
		this.#active = opened.activeSheet
	}

	get editable() {
		return this.#editable && this.opened.sheets[this.#active]?.kind === 'worksheet'
	}
	setEditable(editable: boolean) {
		if (this.#editable === editable) return
		this.#editable = editable
		this.notify()
	}
	get activeSheet() {
		return this.#active
	}
	get sheet(): XlsxSheet {
		return this.#state().meta
	}
	get source(): GridSource {
		const state = this.#state()
		return (state.source ??= this.#makeSource(this.#active, state))
	}
	get hyperlinks() {
		return this.#state().meta.hyperlinks
	}
	get dirty() {
		return this.#inflight > 0 || this.#steps[this.#done - 1] !== this.#saved
	}
	get canUndo() {
		return this.#done > 0
	}
	get canRedo() {
		return this.#done < this.#steps.length
	}
	get rowCount() {
		return this.#state().used.rows
	}
	get colCount() {
		return this.#state().used.cols
	}
	get changes() {
		return this.#changes
	}

	dispose() {
		this.#client.dispose()
	}

	// Shows another sheet, reading it first if it hasn't been yet. The sheet left gives back its cells' memory
	// first (a phone has little to spare), here and, until anything's edited, in the worker; shown again, they're
	// read again.
	async select(index: number): Promise<void> {
		if (index !== this.#active) {
			this.#sheets.get(this.#active)?.blocks.clear()
			void this.#client.release(this.#active).catch(() => {})
		}
		if (!this.#sheets.has(index)) {
			const meta = await this.#client.sheet(index)
			if (this.#sheets.has(index)) return this.select(index)
			const colStyles = new Map<number, number>()
			for (let i = 0; i < meta.colStyles.length; i += 2) colStyles.set(meta.colStyles[i], meta.colStyles[i + 1])
			const blocks = new Blocks<XlsxBlock>(
				async (rowBlock, colBlock) => {
					const top = rowBlock * BLOCK.rows
					const left = colBlock * BLOCK.cols
					const result = await this.#client.cells(index, {
						top,
						left,
						bottom: top + BLOCK.rows - 1,
						right: left + BLOCK.cols - 1,
					})
					// The workbook was calculated in full to answer: every block, this one too, is fetched again
					if (result.recalculated) this.#sheets.forEach((state) => state.blocks.clear())
					const block: XlsxBlock = {cells: new Map(), rowStyles: new Map()}
					for (const {row, col, ...cell} of result.cells) block.cells.set(at(row, col), cell)
					for (let i = 0; i < result.rowStyles.length; i += 2)
						block.rowStyles.set(result.rowStyles[i], result.rowStyles[i + 1])
					return block
				},
				(block) => block.cells.size + 1,
				300_000,
			)
			this.#sheets.set(index, {
				meta,
				blocks,
				colStyles,
				arrays: meta.arrays,
				used: {rows: meta.rowCount, cols: meta.colCount},
			})
		}
		this.#active = index
		this.notify()
	}

	locked(row: number, col: number): Lock | undefined {
		const state = this.#state()
		const {arrays, meta} = state
		if (arrays.some((range) => inRange(range, row, col) && (range.top !== row || range.left !== col))) return 'array'
		if (meta.headerAndTotalRows.some((range) => inRange(range, row, col))) return 'table'
		if (meta.protected && this.opened.styles[this.#styleAt(state, row, col)].locked) return 'protected'
		return undefined
	}

	commit(cells: Array<Cell & {input: string}>, strict: boolean) {
		const index = this.#active
		const state = this.#state()
		// A plain value shows at once, unless it's over a locked cell, which the worker passes over; a formula waits
		// for its result
		for (const {row, col, input} of cells) {
			if (input.startsWith('=') || this.locked(row, col)) continue
			this.#pending.set(`${index}:${row}:${col}`, {
				text: input,
				input,
				kind: /^[\d.,$%+-]+$/.test(input) ? 'n' : 's',
				style: this.#styleAt(state, row, col),
			})
		}
		this.#inflight++
		this.notify()
		return this.#run(async () => {
			try {
				const edited = await this.#client.edit(index, cells, strict, this.#held(index))
				this.#record(index, edited, bounds(cells))
				return edited.skipped ?? 0
			} finally {
				this.#inflight--
				for (const {row, col} of cells) this.#pending.delete(`${index}:${row}:${col}`)
				this.notify()
			}
		})
	}

	clear(range: Range) {
		const index = this.#active
		this.#inflight++
		this.notify()
		return this.#run(async () => {
			try {
				const edited = await this.#client.edit(index, [], true, this.#held(index), range)
				this.#record(index, edited, range)
				return edited.skipped ?? 0
			} finally {
				this.#inflight--
				this.notify()
			}
		})
	}

	undo() {
		return this.#run(async () => {
			const step = this.#steps[this.#done - 1]
			if (!step) return undefined
			if (step.sheet !== this.#active) await this.select(step.sheet)
			this.#apply(step.sheet, await this.#client.restore(step.id, 'before', this.#held(step.sheet)))
			this.#done--
			this.notify()
			return step.range
		})
	}

	redo() {
		return this.#run(async () => {
			const step = this.#steps[this.#done]
			if (!step) return undefined
			if (step.sheet !== this.#active) await this.select(step.sheet)
			this.#apply(step.sheet, await this.#client.restore(step.id, 'after', this.#held(step.sheet)))
			this.#done++
			this.notify()
			return step.range
		})
	}

	edge(cell: Cell, direction: Edge): Promise<Cell> {
		const {rows, cols} = this.source
		return this.#client.edge({sheet: this.#active, ...cell, direction, rows: rows.count, cols: cols.count})
	}

	texts(range: Range): string[][] | undefined {
		const state = this.#state()
		const rows: string[][] = []
		for (let row = range.top; row <= range.bottom; row++) {
			const cells: string[] = []
			for (let col = range.left; col <= range.right; col++) {
				const block = state.blocks.get(Math.floor(row / BLOCK.rows), Math.floor(col / BLOCK.cols))
				if (!block) return undefined
				cells.push(
					this.#pending.get(`${this.#active}:${row}:${col}`)?.text ?? block.cells.get(at(row, col))?.text ?? '',
				)
			}
			rows.push(cells)
		}
		return rows
	}

	// Read in the worker, past what's loaded: only the text travels, not the cells as drawn, and it waits for edits
	// on their way
	fetchTexts(range: Range): Promise<string[][]> {
		const index = this.#active
		return this.#run(() => this.#client.texts(index, range))
	}

	find(query: string, signal: AbortSignal, onProgress: (progress: FindProgress) => void) {
		const index = this.#active
		const end = this.#state().used.rows
		const matches: Cell[] = []
		void (async () => {
			for (let start = 0; start < end && matches.length < MAX_MATCHES; start += FIND_ROWS) {
				const found = await this.#client.find(index, query, start, start + FIND_ROWS)
				if (signal.aborted) return
				for (let i = 0; i < found.length && matches.length < MAX_MATCHES; i += 2)
					matches.push({row: found[i], col: found[i + 1]})
				onProgress({matches: [...matches], done: false})
			}
			if (!signal.aborted) onProgress({matches, done: true})
		})().catch(() => !signal.aborted && onProgress({matches, done: true}))
	}

	serialize() {
		return this.#run(async () => {
			const last = this.#steps[this.#done - 1]
			const bytes = await this.#client.save()
			this.#serialized = last
			return new Blob([bytes], {type: this.#type})
		})
	}

	saved() {
		this.#saved = this.#serialized
		this.notify()
	}

	#state(): SheetState {
		return this.#sheets.get(this.#active)!
	}

	#run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.#queue.then(task)
		// The queue keeps the order, not what each task gave (a copy's text, a save's bytes)
		this.#queue = result.then(
			() => {},
			() => {},
		)
		return result
	}

	#record(index: number, edited: XlsxEdited, range: Range) {
		this.#apply(index, edited)
		// An edit that changed nothing isn't a step to undo
		if (edited.step === undefined) return
		// The steps undone are out of reach now: the worker lets them go
		const cut = this.#steps.splice(this.#done)
		if (cut.length) void this.#client.forget(cut.map((step) => step.id)).catch(() => {})
		this.#steps.push({sheet: index, id: edited.step, range})
		this.#done++
	}

	// The blocks of a sheet held here, and on their way, so an edit's reply brings only what they show
	#held(index: number): HeldBlocks {
		const blocks = this.#sheets.get(index)?.blocks.held() ?? []
		return {rows: BLOCK.rows, cols: BLOCK.cols, keys: blocks.map(([rowBlock, colBlock]) => heldKey(rowBlock, colBlock))}
	}

	// Lays an edit's changed cells into the blocks they belong to, after the formats it added, and grows the sheet to
	// take in its content
	#apply(index: number, edited: XlsxEdited) {
		this.#changes++
		if (edited.styles) this.opened.styles.push(...edited.styles)
		const state = this.#sheets.get(index)
		if (!state) return
		state.arrays = edited.arrays
		const rows = Math.max(state.used.rows, edited.reach.rows)
		const cols = Math.max(state.used.cols, edited.reach.cols)
		if (rows !== state.used.rows || cols !== state.used.cols) {
			state.used = {rows, cols}
			state.source = undefined
		}
		const byBlock = new Map<string, XlsxEdited['cells']>()
		for (const cell of edited.cells) {
			const key = `${Math.floor(cell.row / BLOCK.rows)}:${Math.floor(cell.col / BLOCK.cols)}`
			const list = byBlock.get(key)
			if (list) list.push(cell)
			else byBlock.set(key, [cell])
		}
		state.blocks.update((block, rowBlock, colBlock) => {
			for (const {row, col, text, input, kind, style, value, color, fill} of byBlock.get(`${rowBlock}:${colBlock}`) ??
				[]) {
				if (!text && !kind && !style) block.cells.delete(at(row, col))
				else block.cells.set(at(row, col), {text, input, kind, style, value, color, fill})
			}
		})
	}

	#cell(state: SheetState, row: number, col: number): GridCell | undefined {
		return state.blocks.get(Math.floor(row / BLOCK.rows), Math.floor(col / BLOCK.cols))?.cells.get(at(row, col))
	}

	// A cell's style: its own, or its row's or column's when it has none
	#styleAt(state: SheetState, row: number, col: number): number {
		return this.#cell(state, row, col)?.style ?? this.#lineStyle(state, row, col)
	}

	#lineStyle(state: SheetState, row: number, col: number): number {
		const rowStyle = state.blocks.get(Math.floor(row / BLOCK.rows), Math.floor(col / BLOCK.cols))?.rowStyles.get(row)
		return rowStyle ?? state.colStyles.get(col) ?? 0
	}

	#makeSource(index: number, state: SheetState): GridSource {
		const {meta, blocks} = state
		const rowCount = Math.min(MAX_ROWS, Math.max(state.used.rows, meta.frozen.rows) + SPARE.rows)
		const colCount = Math.min(MAX_COLS, Math.max(state.used.cols, meta.frozen.cols) + SPARE.cols)
		return {
			look: 'paper',
			rows: new Axis(rowCount, meta.rows.defaultPx, meta.rows.sizes),
			cols: new Axis(colCount, meta.cols.defaultPx, meta.cols.sizes),
			frozen: meta.frozen,
			merges: meta.merges,
			gridLines: meta.showGridLines,
			rightToLeft: meta.rightToLeft,
			styles: this.opened.styles,
			headerRow: false,
			cell: (row, col) => this.#pending.get(`${index}:${row}:${col}`) ?? this.#cell(state, row, col),
			lineStyle: (row, col) => this.#lineStyle(state, row, col),
			load: (range) => loadAround(blocks, range, rowCount, colCount),
			subscribe: (listener) => {
				const unsubscribeBlocks = blocks.subscribe(listener)
				const unsubscribe = this.subscribe(listener)
				return () => {
					unsubscribeBlocks()
					unsubscribe()
				}
			},
		}
	}
}
