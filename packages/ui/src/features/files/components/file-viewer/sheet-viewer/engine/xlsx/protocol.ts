// The XLSX worker's message protocol, imported by both sides. The worker owns
// the workbook: the file's bytes, the sheets read so far and, once anything is
// edited, one Calculator over all of them. The UI asks for a window of cells
// at a time, as the grid draws them; sends what is typed and gets back every
// cell that changed; and saves by asking for the original bytes patched with
// every cell that differs from them, so no save depends on an earlier one.

import {Calculator, lowerBound, parseInput, type CellAddress} from '../formula/calculator'
import {partsFromSerial} from '../formula/dates'
import {FormulaSyntaxError} from '../formula/parser'
import {isError, numberToText, type Value} from '../formula/values'
import {createWorkerClient} from '../worker-client'
import {builtinFormat, formatNumber, isDateFormat, type FormattedValue} from './number-format'
import {MAX_COLS, MAX_ROWS, XlsxError, type Range} from './package'
import {calculatorBase, type Hyperlink, type Sheet} from './sheet'
import type {RichRun} from './strings'
import {MAX_STYLES, type CellStyle} from './styles'
import {openWorkbook, type SheetInfo, type Workbook} from './workbook'
import {saveWorkbook, type CellEdit, type CellFormat} from './writer'

// Rows and columns past the data that the grid shows empty, and the worker sizes
export const SPARE = {rows: 200, cols: 26}

// Number, text, boolean, error, or nothing (a cell with only a style)
export type CellKind = 'n' | 's' | 'b' | 'e' | ''

// A cell as the grid draws it
export type CellData = {
	row: number
	col: number
	text: string // through the cell's number format
	kind: CellKind
	style: number
	input: string // as the formula bar shows it: typing it back enters the same thing
	value?: number // a number's own value, for fitting General into a narrow column
	color?: string // from the number format
	fill?: {char: string; index: number}
	runs?: readonly RichRun[]
}

// What a cell holds, exactly: undoing an edit puts this back. style is the one a value typed into it gave it.
export type CellContent = {row: number; col: number; value: Value; formula?: string; style?: number}

// The sizes of rows or columns: the default, and [index, px] pairs for the rest (0 is hidden)
export type Lines = {defaultPx: number; sizes: number[]}

// styles grows as edits add formats
export type XlsxOpened = {
	sheets: readonly SheetInfo[]
	activeSheet: number
	styles: CellStyle[]
	hasMacros: boolean
}

export type XlsxSheet = {
	rowCount: number
	colCount: number
	rows: Lines
	cols: Lines
	colStyles: number[] // [col, style] pairs: what a column's cells that don't exist are drawn with
	merges: readonly Range[]
	arrays: Range[] // array formulas, whose cells only change with their top-left one
	headerAndTotalRows: readonly Range[] // of tables, which don't change here
	hyperlinks: readonly Hyperlink[]
	frozen: {rows: number; cols: number}
	showGridLines: boolean
	rightToLeft: boolean
	protected: boolean // its locked cells don't change
	hasCharts: boolean
	hasDrawings: boolean
	hasComments: boolean
	hasConditionalFormats: boolean
}

// `recalculated`: the workbook was calculated in full to answer, so cells fetched before may have changed
export type XlsxCells = {cells: CellData[]; rowStyles: number[]; recalculated: boolean}

// What an edit changed on the edited sheet: its cells inside the blocks the UI holds (the rest are read when they're
// shown), how far the sheet's content reaches now, the step that undoes and redoes it (none when nothing could
// change), the sheet's array formulas, and the styles it added after the last
export type XlsxEdited = {
	cells: CellData[]
	reach: {rows: number; cols: number}
	step?: number
	arrays: Range[]
	styles?: CellStyle[]
	// How many of the cells typed, pasted or cleared were locked, and left as they were
	skipped?: number
}

// The blocks of cells the UI holds of a sheet, and has asked for, each by heldKey: an edit's reply brings only the
// cells in them
export type HeldBlocks = {rows: number; cols: number; keys: number[]}
export const heldKey = (rowBlock: number, colBlock: number) => rowBlock * 65_536 + colBlock

export type EdgeDirection = 'up' | 'down' | 'left' | 'right'
type EdgeRequest = {sheet: number; row: number; col: number; direction: EdgeDirection; rows: number; cols: number}
export type EditCell = {row: number; col: number; input: string}

export type XlsxRequest =
	| {type: 'open'; bytes: ArrayBuffer; maxCells: number}
	| {type: 'sheet'; sheet: number}
	// The UI has left a sheet: until anything is edited (when the calculator reads every sheet) it's let go, and read
	// again when it's needed
	| {type: 'release'; sheet: number}
	| {type: 'cells'; sheet: number; range: Range}
	// The text of every cell in a range, as the grid shows it, row by row: what a copy takes
	| {type: 'texts'; sheet: number; range: Range}
	// Input is read the way Excel reads what's typed, and every cell with content in `clear` is emptied. A strict edit
	// rejects a formula that doesn't parse with FormulaSyntaxError, a lenient one (a paste) keeps it as text.
	| {type: 'edit'; sheet: number; cells: EditCell[]; strict: boolean; clear?: Range; held: HeldBlocks}
	// Undo and redo: a step's cells put back exactly as they were before it, or after it
	| {type: 'restore'; step: number; to: 'before' | 'after'; held: HeldBlocks}
	// Steps the UI can't reach any more (an edit after an undo cuts off the redo)
	| {type: 'forget'; steps: number[]}
	// The cells of rows [start, end) whose text contains `query`, ignoring case, as [row, col] pairs
	| {type: 'find'; sheet: number; query: string; start: number; end: number}
	// Where Ctrl+arrow lands, within the first `rows` and `cols`
	| ({type: 'edge'} & EdgeRequest)
	| {type: 'save'}

export type XlsxCall = {id: number; request: XlsxRequest}
export type XlsxErrorData = {name: string; message: string; code?: XlsxError['code']; position?: number}
export type XlsxReply = {id: number; result: unknown} | {id: number; error: XlsxErrorData}

// restyled: the formats typed values gave cells, by row * MAX_COLS + col, in place of the file's
type Loaded = {sheet: Sheet; touched: Map<number, Set<number>>; restyled: Map<number, number>}

// The worker side. Requests are answered one at a time, in order: an edit
// lands before a save sent after it.
export function createXlsxHandler(): (call: XlsxCall) => Promise<{reply: XlsxReply; transfer: Transferable[]}> {
	let original: Uint8Array | undefined
	let book: Workbook | undefined
	let sheets: Array<Promise<Loaded> | undefined> = []
	let calculator: Promise<Calculator> | undefined
	let calc: Calculator | undefined
	// What the workbook may unpack to, its sheets read and the calculator's formula cells together (the UI's budget
	// for this device), and what they hold so far
	let maxCells = 0
	let held = 0
	// The file's styles, then those edits added: copies of a file style with the number format a typed value asks
	// for, each made once (`added` finds them by base style and number format)
	let styles: CellStyle[] = []
	let formats: CellFormat[] = []
	const added = new Map<string, number>()
	// What each step's cells held before and after it, kept here rather than sent: a big paste's are as big as it
	const steps = new Map<number, {sheet: number; before: CellContent[]; after: CellContent[]}>()
	let nextStep = 0
	let queue = Promise.resolve()

	const opened = () => {
		if (!book || !original) throw new Error('No workbook is open')
		return book
	}
	// A sheet is read within what's left of the budget; one that doesn't fit isn't kept, so it's tried again once
	// another has been let go
	const load = (index: number) => {
		const workbook = opened()
		if (!workbook.sheets[index]) throw new TypeError(`The workbook has no sheet ${index}`)
		return (sheets[index] ??= workbook.loadSheet(index, maxCells - held).then(
			(sheet) => {
				held += sheet.size
				return {sheet, touched: new Map(), restyled: new Map()}
			},
			(error: unknown) => {
				sheets[index] = undefined
				throw error
			},
		))
	}
	const styleOf = (style: number) => styles[style] ?? styles[0]
	const styleAt = ({sheet, restyled}: Loaded, row: number, col: number) =>
		restyled.get(row * MAX_COLS + col) ?? sheet.styleAt(row, col)
	// A value typed into a General cell takes the built-in format its form asks for, as in Excel
	const typedStyle = (loaded: Loaded, row: number, col: number, input: string) => {
		const style = styleAt(loaded, row, col)
		const numFmtId = styleOf(style).format === 'General' ? typedFormat(input, opened().date1904) : undefined
		if (numFmtId === undefined || !opened().canAddFormats) return style
		const key = `${style}:${numFmtId}`
		let index = added.get(key)
		if (index === undefined && styles.length < MAX_STYLES) {
			index = styles.push({...styleOf(style), format: builtinFormat(numFmtId)!}) - 1
			formats.push({base: style, numFmtId})
			added.set(key, index)
		}
		return index ?? style
	}

	// One Calculator over every sheet, made when it's first needed. It holds the formula cells, and reads every
	// other value through the sheets, so a workbook of values costs it nothing. A workbook saved without its
	// formulas' values (as some libraries write them) is calculated in full, so its cells show something.
	const calculate = () =>
		(calculator ??= (async () => {
			const workbook = opened()
			// One at a time, each within what the ones before left
			const all: Loaded[] = []
			for (let i = 0; i < workbook.sheets.length; i++) all.push(await load(i))
			let uncalculated = false
			let copied = 0
			function* formulas() {
				for (const [i, {sheet}] of all.entries()) {
					for (const {row, col, value, formula} of sheet.formulaCells()) {
						if (value === null) uncalculated = true
						if (++copied + held > maxCells) throw new XlsxError('limits', 'The workbook is too large to calculate')
						yield {address: {sheet: i, row, col}, value, formula}
					}
				}
			}
			// The workbook's names, and each sheet's own by its index in the list of sheets, as the calculator has them
			const names = new Map<string, string>()
			const localNames = new Map<number, Map<string, string>>()
			for (const {name, formula, sheet} of workbook.definedNames) {
				if (name.startsWith('_xlnm.')) continue
				if (sheet === undefined) names.set(name, formula)
				else localNames.set(sheet, (localNames.get(sheet) ?? new Map<string, string>()).set(name, formula))
			}
			calc = new Calculator(
				workbook.sheets.map((sheet) => sheet.name),
				formulas(),
				{date1904: workbook.date1904, names, localNames, base: calculatorBase(all.map(({sheet}) => sheet))},
			)
			held += copied
			if (uncalculated) for (const {address} of calc.recalculate()) touch(all[address.sheet], address)
			return calc
		})())

	// Whether a cell now differs from the file: what's drawn and saved for it
	// comes from the calculator then, and a cell put back as it was is the
	// file's again
	const touch = ({sheet, touched, restyled}: Loaded, address: CellAddress) => {
		const {row, col} = address
		const file = sheet.cell(row, col)
		const same =
			sameValue(calc!.value(address), file?.value ?? null) &&
			calc!.formula(address) === (file?.formula ?? undefined) &&
			!restyled.has(row * MAX_COLS + col)
		const cols = touched.get(row)
		if (!same) {
			if (cols) cols.add(col)
			else touched.set(row, new Set([col]))
		} else if (cols?.delete(col) && cols.size === 0) touched.delete(row)
	}

	const contentOf = (sheet: number, row: number, col: number): CellContent => {
		const address = {sheet, row, col}
		const formula = calc!.formula(address)
		return {row, col, value: calc!.value(address), ...(formula !== undefined && {formula})}
	}

	// The cell as it's drawn, or undefined when there's nothing to draw
	const cellData = (loaded: Loaded, index: number, row: number, col: number): CellData | undefined => {
		const {sheet, touched} = loaded
		if (touched.get(row)?.has(col)) {
			const content = contentOf(index, row, col)
			const style = styleAt(loaded, row, col)
			return describe(sheet, row, col, content, style, display(content.value, styleOf(style), opened().date1904))
		}
		const cell = sheet.cell(row, col)
		if (!cell || (cell.value === null && cell.formula === undefined && cell.style === 0)) return undefined
		const data = describe(sheet, row, col, cell, cell.style, sheet.display(row, col))
		return cell.runs ? {...data, runs: cell.runs} : data
	}
	const describe = (
		sheet: Sheet,
		row: number,
		col: number,
		{value, formula}: Pick<CellContent, 'value' | 'formula'>,
		style: number,
		formatted: FormattedValue,
	): CellData => {
		// A protected sheet keeps a hidden cell's formula to itself, as Excel does
		const shown = sheet.protected && styleOf(style).hidden ? undefined : formula
		const data: CellData = {
			row,
			col,
			text: formatted.text,
			kind: kindOf(value),
			style,
			input: inputOf(value, shown, styleOf(style), opened().date1904),
		}
		if (typeof value === 'number') data.value = value
		if (formatted.color) data.color = formatted.color
		if (formatted.fill) data.fill = formatted.fill
		return data
	}

	// The columns of a row's cells in [left, right], the file's and the edited ones, ascending
	const columnsOf = ({sheet, touched}: Loaded, row: number, left: number, right: number): number[] => {
		const file = sheet.rowColumns(row)
		const cols: number[] = []
		for (let i = lowerBound(file, left); i < file.length && file[i] <= right; i++) cols.push(file[i])
		const edited = touched.get(row)
		if (!edited) return cols
		for (const col of edited) if (col >= left && col <= right && !cols.includes(col)) cols.push(col)
		return cols.sort((a, b) => a - b)
	}

	// Whether a cell holds anything (a cell with only a style doesn't)
	const filled = ({sheet, touched}: Loaded, index: number, row: number, col: number) => {
		if (touched.get(row)?.has(col)) {
			const {value, formula} = contentOf(index, row, col)
			return value !== null || formula !== undefined
		}
		const file = sheet.rowColumns(row)
		if (file[lowerBound(file, col)] !== col) return false
		const cell = sheet.cell(row, col)!
		return cell.value !== null || cell.formula !== undefined
	}

	// Arrays whose top-left cell still holds the file's formula (recalculated or not), so the rest holds its results
	const arraysOf = ({sheet}: Loaded, index: number) =>
		sheet.arrays.filter(
			({top, left}) => !calc || calc.formula({sheet: index, row: top, col: left}) === sheet.cell(top, left)?.formula,
		)

	// Cells the workbook keeps as they are: a table's header and totals rows, which its table part names as well, and
	// locked cells on a protected sheet. Renaming a column means renaming it in every formula that refers to it too,
	// as Excel does.
	const locked = (loaded: Loaded, row: number, col: number) =>
		loaded.sheet.headerAndTotalRows.some((range) => contains(range, row, col)) ||
		(loaded.sheet.protected && styleOf(styleAt(loaded, row, col)).locked)

	// Edits a sheet: what's typed or pasted, cells cleared, or a step's cells put back. Typing over an array formula's
	// top-left cell clears the rest of its range, as Excel does, unless what's typed is its own formula; what's typed
	// passes over locked cells, and content put back is what was taken, cell for cell.
	const edit = async (
		index: number,
		cells: Array<EditCell | CellContent>,
		strict: boolean,
		held: HeldBlocks,
		clear?: Range,
	): Promise<{result: XlsxEdited; before: CellContent[]; after: CellContent[]}> => {
		await calculate()
		const all = await Promise.all(opened().sheets.map((_, i) => load(i)))
		const loaded = all[index]
		if (!loaded) throw new TypeError(`The workbook has no sheet ${index}`)
		const arrays = arraysOf(loaded, index)
		const targets = new Map<number, EditCell | CellContent>()
		// Locked cells passed over, unless they're the rest of an array typed over, which is cleared after all
		const passed = new Set<number>()
		const cleared: EditCell[] = []
		if (clear) {
			const {top, left, bottom, right} = clear
			let last = loaded.sheet.rowCount - 1
			for (const row of loaded.touched.keys()) last = Math.max(last, row)
			for (let row = top; row <= Math.min(bottom, last); row++) {
				for (const col of columnsOf(loaded, row, left, right)) {
					if (filled(loaded, index, row, col)) cleared.push({row, col, input: ''})
				}
			}
		}
		for (const cell of [...cells, ...cleared]) {
			const key = cell.row * MAX_COLS + cell.col
			if (!('input' in cell)) {
				targets.set(key, cell)
				continue
			}
			const array = arrays.find((range) => contains(range, cell.row, cell.col))
			if ((array && (array.top !== cell.row || array.left !== cell.col)) || locked(loaded, cell.row, cell.col)) {
				passed.add(key)
				continue
			}
			targets.set(key, cell)
			// Only the top-left cell gets here: its own formula typed back leaves the array as it is
			if (!array || cell.input === `=${loaded.sheet.cell(array.top, array.left)?.formula}`) continue
			for (let row = array.top; row <= array.bottom; row++) {
				for (let col = array.left; col <= array.right; col++) {
					if (!targets.has(row * MAX_COLS + col)) targets.set(row * MAX_COLS + col, {row, col, input: ''})
				}
			}
		}
		const content = (row: number, col: number): CellContent => {
			const style = loaded.restyled.get(row * MAX_COLS + col)
			return {...contentOf(index, row, col), ...(style !== undefined && {style})}
		}
		const before = [...targets.values()].map(({row, col}) => content(row, col))
		const known = styles.length
		const changed = new Map<string, CellAddress>()
		const note = (addresses: Iterable<{address: CellAddress}>) => {
			for (const {address} of addresses) changed.set(`${address.sheet}:${address.row}:${address.col}`, address)
		}
		const restores: Array<{address: CellAddress; value: Value; formula?: string}> = []
		for (const cell of targets.values()) {
			const address = {sheet: index, row: cell.row, col: cell.col}
			note([{address}])
			const key = cell.row * MAX_COLS + cell.col
			if (!('input' in cell)) {
				restores.push({address, value: cell.value, formula: cell.formula})
				if (cell.style === undefined) loaded.restyled.delete(key)
				else loaded.restyled.set(key, cell.style)
				continue
			}
			// A cell formatted as text keeps what's typed as text
			const asText =
				cell.input && !cell.input.startsWith('=') && styleOf(styleAt(loaded, cell.row, cell.col)).format === '@'
			try {
				note(calc!.set(address, asText ? `'${cell.input}` : cell.input))
			} catch (error) {
				if (strict || !(error instanceof FormulaSyntaxError)) throw error
				note(calc!.set(address, `'${cell.input}`))
				continue
			}
			if (asText || cell.input.startsWith('=')) continue
			const style = typedStyle(loaded, cell.row, cell.col, cell.input)
			if (style !== styleAt(loaded, cell.row, cell.col)) loaded.restyled.set(key, style)
		}
		if (restores.length) note(calc!.restore(restores))
		for (const address of changed.values()) touch(all[address.sheet], address)
		// The edited sheet's cells that changed, as far as they reach, and of them those in the blocks the UI holds,
		// drawn (a cell emptied of everything is drawn as nothing); other sheets' are read afresh when shown
		const blocks = new Set(held.keys)
		const reach = {rows: 0, cols: 0}
		const drawn: CellData[] = []
		for (const {sheet, row, col} of changed.values()) {
			if (sheet !== index) continue
			if (filled(loaded, index, row, col)) {
				reach.rows = Math.max(reach.rows, row + 1)
				reach.cols = Math.max(reach.cols, col + 1)
			}
			if (!blocks.has(heldKey(Math.floor(row / held.rows), Math.floor(col / held.cols)))) continue
			drawn.push(cellData(loaded, index, row, col) ?? {row, col, text: '', kind: '', style: 0, input: ''})
		}
		const after = [...targets.values()].map(({row, col}) => content(row, col))
		const result: XlsxEdited = {cells: drawn, reach, arrays: arraysOf(loaded, index)}
		if (styles.length > known) result.styles = styles.slice(known)
		let skipped = 0
		for (const key of passed) if (!targets.has(key)) skipped++
		if (skipped) result.skipped = skipped
		return {result, before, after}
	}

	const handle = async (request: XlsxRequest): Promise<{result: unknown; transfer: Transferable[]}> => {
		switch (request.type) {
			case 'open': {
				original = new Uint8Array(request.bytes)
				book = await openWorkbook(original, {maxCells: request.maxCells})
				sheets = []
				calculator = calc = undefined
				maxCells = request.maxCells
				held = 0
				styles = [...book.styles]
				formats = []
				added.clear()
				const {sheets: list, activeSheet, hasMacros} = book
				return {result: {sheets: list, activeSheet, styles, hasMacros} satisfies XlsxOpened, transfer: []}
			}
			case 'sheet': {
				const loaded = await load(request.sheet)
				const {sheet} = loaded
				const rowCount = Math.min(MAX_ROWS, Math.max(sheet.rowCount, sheet.frozen.rows) + SPARE.rows)
				const colCount = Math.min(MAX_COLS, Math.max(sheet.colCount, sheet.frozen.cols) + SPARE.cols)
				const colStyles: number[] = []
				for (let col = 0; col < colCount; col++) {
					const style = sheet.colStyle(col)
					if (style !== undefined) colStyles.push(col, style)
				}
				const result: XlsxSheet = {
					rowCount: sheet.rowCount,
					colCount: sheet.colCount,
					rows: lines(rowCount, sheet.defaultRowHeightPx, (row) => sheet.rowHeightPx(row)),
					cols: lines(colCount, sheet.defaultColWidthPx, (col) => sheet.colWidthPx(col)),
					colStyles,
					merges: sheet.merges,
					arrays: arraysOf(loaded, request.sheet),
					headerAndTotalRows: sheet.headerAndTotalRows,
					hyperlinks: sheet.hyperlinks,
					frozen: sheet.frozen,
					showGridLines: sheet.showGridLines,
					rightToLeft: sheet.rightToLeft,
					protected: sheet.protected,
					hasCharts: sheet.hasCharts,
					hasDrawings: sheet.hasDrawings,
					hasComments: sheet.hasComments,
					hasConditionalFormats: sheet.hasConditionalFormats,
				}
				return {result, transfer: []}
			}
			case 'release': {
				const pending = sheets[request.sheet]
				if (calculator || !pending) return {result: undefined, transfer: []}
				sheets[request.sheet] = undefined
				const loaded = await pending.catch(() => undefined)
				if (loaded) held -= loaded.sheet.size
				return {result: undefined, transfer: []}
			}
			case 'cells': {
				const loaded = await load(request.sheet)
				const {sheet} = loaded
				const {top, left, bottom, right} = request.range
				const cells: CellData[] = []
				const rowStyles: number[] = []
				let recalculated = false
				for (let row = top; row <= bottom; row++) {
					const style = sheet.rowStyle(row)
					if (style !== undefined) rowStyles.push(row, style)
					for (const col of columnsOf(loaded, row, left, right)) {
						// A formula the file has no value for: the workbook is calculated first
						const file = calculator ? undefined : sheet.cell(row, col)
						if (file?.formula !== undefined && file.value === null) {
							await calculate()
							recalculated = true
						}
						const data = cellData(loaded, request.sheet, row, col)
						if (data) cells.push(data)
					}
				}
				return {result: {cells, rowStyles, recalculated} satisfies XlsxCells, transfer: []}
			}
			case 'texts': {
				const loaded = await load(request.sheet)
				const {top, left, bottom, right} = request.range
				const rows: string[][] = []
				for (let row = top; row <= bottom; row++) {
					const texts = new Array<string>(right - left + 1).fill('')
					for (const col of columnsOf(loaded, row, left, right)) {
						const file = calculator ? undefined : loaded.sheet.cell(row, col)
						if (file?.formula !== undefined && file.value === null) await calculate()
						texts[col - left] = cellData(loaded, request.sheet, row, col)?.text ?? ''
					}
					rows.push(texts)
				}
				return {result: rows, transfer: []}
			}
			case 'edit': {
				const {result, before, after} = await edit(
					request.sheet,
					request.cells,
					request.strict,
					request.held,
					request.clear,
				)
				if (before.length) {
					result.step = nextStep++
					steps.set(result.step, {sheet: request.sheet, before, after})
				}
				return {result, transfer: []}
			}
			case 'restore': {
				const step = steps.get(request.step)
				if (!step) throw new TypeError(`No step ${request.step}`)
				return {result: (await edit(step.sheet, step[request.to], true, request.held)).result, transfer: []}
			}
			case 'forget': {
				for (const step of request.steps) steps.delete(step)
				return {result: undefined, transfer: []}
			}
			case 'find': {
				const loaded = await load(request.sheet)
				const {sheet, touched} = loaded
				const query = request.query.toLowerCase()
				const matches: number[] = []
				let last = sheet.rowCount
				for (const row of touched.keys()) last = Math.max(last, row + 1)
				for (let row = Math.max(0, request.start); row < Math.min(request.end, last); row++) {
					if (sheet.isRowHidden(row)) continue
					for (const col of columnsOf(loaded, row, 0, MAX_COLS - 1)) {
						if (sheet.isColHidden(col)) continue
						if (cellData(loaded, request.sheet, row, col)?.text.toLowerCase().includes(query)) matches.push(row, col)
					}
				}
				return {result: matches, transfer: []}
			}
			case 'edge': {
				const loaded = await load(request.sheet)
				return {
					result: edge(request, (row, col) => filled(loaded, request.sheet, row, col), loaded.sheet),
					transfer: [],
				}
			}
			case 'save': {
				opened()
				const edits: CellEdit[] = []
				for (const [index, pending] of sheets.entries()) {
					const loaded = await pending
					for (const [row, cols] of loaded?.touched ?? []) {
						for (const col of cols) {
							const style = loaded!.restyled.get(row * MAX_COLS + col)
							edits.push({sheet: index, ...contentOf(index, row, col), ...(style !== undefined && {style})})
						}
					}
				}
				// The formats added up to the last a cell uses: one no cell uses any more needn't be in the file
				let used = 0
				for (const {style} of edits) if (style !== undefined) used = Math.max(used, style - opened().styles.length + 1)
				const saved = await saveWorkbook(original!, edits, formats.slice(0, used))
				return {result: saved.buffer, transfer: [saved.buffer]}
			}
		}
	}

	return (call) => {
		const answer = queue.then(async () => {
			try {
				const {result, transfer} = await handle(call.request)
				return {reply: {id: call.id, result}, transfer}
			} catch (error) {
				const failure = error instanceof Error ? error : new Error(String(error))
				const data: XlsxErrorData = {name: failure.name, message: failure.message}
				if (failure instanceof XlsxError) data.code = failure.code
				if (failure instanceof FormulaSyntaxError) data.position = failure.position
				return {reply: {id: call.id, error: data}, transfer: []}
			}
		})
		queue = answer.then(() => {})
		return answer
	}
}

const contains = (range: Range, row: number, col: number) =>
	row >= range.top && row <= range.bottom && col >= range.left && col <= range.right

const sameValue = (a: Value, b: Value) => a === b || (isError(a) && isError(b) && a.error === b.error)

const kindOf = (value: Value): CellKind =>
	value === null
		? ''
		: typeof value === 'number'
			? 'n'
			: typeof value === 'string'
				? 's'
				: typeof value === 'boolean'
					? 'b'
					: 'e'

function lines(count: number, defaultPx: number, size: (i: number) => number): Lines {
	const sizes: number[] = []
	for (let i = 0; i < count; i++) {
		const px = size(i)
		if (px !== defaultPx) sizes.push(i, px)
	}
	return {defaultPx, sizes}
}

// The built-in format Excel gives a value typed in a form it knows: a date, a time (with seconds or not, on a 12- or
// 24-hour clock), a date and time, a percentage or an amount (with decimals or without)
function typedFormat(input: string, date1904: boolean): number | undefined {
	const decimals = /\.\d/.test(input)
	switch (parseInput(input, date1904).kind) {
		case 'date':
			return 14
		case 'datetime':
			return 22
		case 'time': {
			const seconds = input.split(':').length > 2
			if (/[ap]m$/i.test(input.trim())) return seconds ? 19 : 18
			return seconds ? 21 : 20
		}
		case 'percent':
			return decimals ? 10 : 9
		case 'currency':
			return decimals ? 7 : 5
		default:
			return undefined
	}
}

// A value through a cell's number format, as Sheet.display shows the file's own
function display(value: Value, style: CellStyle, date1904: boolean): FormattedValue {
	if (value === null) return {text: ''}
	if (typeof value === 'boolean') return {text: value ? 'TRUE' : 'FALSE'}
	if (isError(value)) return {text: value.error}
	return formatNumber(value, style.format, {date1904})
}

// What the formula bar shows: the formula, or the value written so that
// typing it back enters the same value — dates and times as ISO dates (the
// form typed input reads), percentages with their %
export function inputOf(value: Value, formula: string | undefined, style: CellStyle, date1904: boolean): string {
	if (formula !== undefined) return `=${formula}`
	if (value === null) return ''
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (isError(value)) return value.error
	if (typeof value === 'string') return style.quotePrefix ? `'${value}` : value
	// The format's own codes, without its literals, escapes and [colors]
	const code = style.format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, (part) => (/^\[[hms]+\]$/i.test(part) ? part : ''))
	const elapsed = /\[[hms]+\]/i.test(code)
	if (isDateFormat(style.format) && !elapsed && value >= 0) {
		const seconds = Math.round(value * 86400)
		const days = Math.floor(seconds / 86400)
		const time = seconds - days * 86400
		const clock = `${Math.floor(time / 3600)}:${pad(Math.floor(time / 60) % 60)}:${pad(time % 60)}`
		if (days === 0) return time ? clock : '0'
		const date = partsFromSerial(days, date1904)
		if (!date) return numberToText(value)
		const iso = `${date[0]}-${pad(date[1])}-${pad(date[2])}`
		return time ? `${iso} ${clock}` : iso
	}
	if (code.includes('%')) return `${numberToText(value * 100)}%`
	return numberToText(value)
}

const pad = (n: number) => String(n).padStart(2, '0')

// Excel's Ctrl+arrow: from a cell with data next to more data, to the last of
// that run; otherwise to the next cell with data, or the edge. Hidden rows and
// columns are passed over.
function edge(
	{row, col, direction, rows, cols}: EdgeRequest,
	filled: (row: number, col: number) => boolean,
	sheet: Sheet,
): {row: number; col: number} {
	const [dRow, dCol] = {up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1]}[direction]
	const step = ([r, c]: [number, number]): [number, number] | undefined => {
		for (;;) {
			r += dRow
			c += dCol
			if (r < 0 || c < 0 || r >= rows || c >= cols) return undefined
			if (!(dRow && sheet.isRowHidden(r)) && !(dCol && sheet.isColHidden(c))) return [r, c]
		}
	}
	let at: [number, number] = [row, col]
	let next = step(at)
	const run = next && filled(row, col) && filled(...next)
	while (next) {
		if (run && !filled(...next)) break
		at = next
		if (!run && filled(...at)) break
		next = step(at)
	}
	return {row: at[0], col: at[1]}
}

export type XlsxClient = {
	// Transfers `bytes`: the caller's buffer is detached afterwards
	open(bytes: ArrayBuffer, maxCells: number): Promise<XlsxOpened>
	sheet(sheet: number): Promise<XlsxSheet>
	release(sheet: number): Promise<void>
	cells(sheet: number, range: Range): Promise<XlsxCells>
	texts(sheet: number, range: Range): Promise<string[][]>
	edit(sheet: number, cells: EditCell[], strict: boolean, held: HeldBlocks, clear?: Range): Promise<XlsxEdited>
	restore(step: number, to: 'before' | 'after', held: HeldBlocks): Promise<XlsxEdited>
	forget(steps: number[]): Promise<void>
	find(sheet: number, query: string, start: number, end: number): Promise<number[]>
	edge(request: EdgeRequest): Promise<{row: number; col: number}>
	save(): Promise<ArrayBuffer>
	// Terminates the worker; calls still waiting reject
	dispose(): void
}

// The UI side, over a worker running xlsx.worker.ts. Failures come back as
// XlsxError (with its code) and FormulaSyntaxError (with its position).
export function createXlsxClient(worker: Worker): XlsxClient {
	const {call, dispose} = createWorkerClient<XlsxRequest, XlsxErrorData>(worker, toError)
	return {
		open: (bytes, maxCells) => call({type: 'open', bytes, maxCells}, [bytes]),
		sheet: (sheet) => call({type: 'sheet', sheet}),
		release: (sheet) => call({type: 'release', sheet}),
		cells: (sheet, range) => call({type: 'cells', sheet, range}),
		texts: (sheet, range) => call({type: 'texts', sheet, range}),
		edit: (sheet, cells, strict, held, clear) => call({type: 'edit', sheet, cells, strict, held, clear}),
		restore: (step, to, held) => call({type: 'restore', step, to, held}),
		forget: (steps) => call({type: 'forget', steps}),
		find: (sheet, query, start, end) => call({type: 'find', sheet, query, start, end}),
		edge: (request) => call({type: 'edge', ...request}),
		save: () => call({type: 'save'}),
		dispose,
	}
}

function toError({name, message, code, position}: XlsxErrorData): Error {
	if (name === 'XlsxError' && code) return new XlsxError(code, message)
	if (name === 'FormulaSyntaxError' && position !== undefined) return new FormulaSyntaxError(message, position)
	const error = new Error(message)
	error.name = name
	return error
}
