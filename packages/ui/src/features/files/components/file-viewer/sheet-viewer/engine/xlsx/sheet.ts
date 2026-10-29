// One worksheet, read in a single streaming pass over its XML into columnar
// storage sized for millions of cells: per cell a column (2 bytes), a kind
// (1), a style (2, or 4 past 65,536 styles) and a float64 holding the number,
// boolean or string-table index (8), with rows as offsets into those arrays.
// That's 13 bytes a cell plus 4 a row, where an object per cell would take
// several times as much; formulas, rich text and everything rarer sit in maps
// beside them. Text is formatted only for the cells on screen.

import {safeHref} from '../../../shared/links'
import type {Relationship} from '../../../shared/opc'
import {parseXml, tokenizeXml} from '../../../shared/xml'
import type {CellBase} from '../formula/calculator'
import {serialFromParts} from '../formula/dates'
import {shiftFormula} from '../formula/shift'
import {Errors, type FormulaError, type Value} from '../formula/values'
import {displayFormula} from './formula-text'
import {formatNumber, type FormattedValue} from './number-format'
import {MAX_COLS, MAX_ROWS, parseRange, parseRef, XlsxError, type Range} from './package'
import {detach, richRuns, StringTable, unescapeText, type RichRun, type SharedStrings} from './strings'
import {flag, index, type Palette, type ResolvedStyles, type Theme} from './styles'

export type Cell = {
	value: Value
	formula?: string // as Excel shows it, without the '='
	style: number // index into the workbook's styles
	runs?: readonly RichRun[] // rich text, whose texts join up to the value
}

// url is only ever http, https or mailto, and location a place in this workbook ("Sheet2!A1" or a defined name); a
// link to anything else isn't kept
export type Hyperlink = {range: Range; url?: string; location?: string; tooltip?: string}

export type SheetContext = {
	name: string
	sharedStrings: SharedStrings | undefined
	styles: ResolvedStyles
	theme: Theme
	palette: Palette
	date1904: boolean
	rels: ReadonlyMap<string, Relationship>
	maxCells: number
}

export type SheetFeatures = {
	hasDrawings: boolean
	hasCharts: boolean
	hasPivots: boolean
	hasComments: boolean
	headerAndTotalRows: Range[]
}

const EMPTY = 0 // a cell with only a style, or a formula without a cached value
const NUMBER = 1
const SHARED = 2 // values[] holds a shared string index
const TEXT = 3 // values[] holds an index into the sheet's own strings
const BOOLEAN = 4
const ERROR = 5 // the error code is in the sheet's own strings

// Column widths are stored in characters of the default font's widest digit plus 5 px of padding (ECMA-376 Part 1
// §18.3.1.13), and converting needs that digit's width. A worker can't measure fonts, so this assumes Calibri 11,
// whose digits are 7 px at 96 dpi: px = trunc(((256 × width + trunc(128 / 7)) / 256) × 7). A width of 8.43
// characters as Excel shows it is stored as 9.140625 and comes out at Excel's default 64 px.
const DIGIT_PX = 7
const widthToPx = (width: number) => Math.trunc(((256 * width + Math.trunc(128 / DIGIT_PX)) / 256) * DIGIT_PX)
// Excel's ceilings: 255 characters wide, 409 points tall
const MAX_WIDTH_PX = widthToPx(255)
const MAX_HEIGHT_PX = Math.round((409 * 4) / 3)
// Overlapping <col> ranges are invalid, but shouldn't cost a hostile file more than this much work
const MAX_COLUMN_WORK = 1 << 20
// A row the file leaves unsized is fitted to what it holds (fitRows), reckoned as Excel does: a line of 11-point text
// takes a 15-point (20 px) row, and a character about the default font's digit, scaled to the cell's font size
const LINE_PX_PER_POINT = 20 / 11
const CHAR_PX_PER_POINT = DIGIT_PX / 11
// What paint keeps clear on either side of a cell's text, and one step of indent
const PADDING_PX = 3
const INDENT_PX = 9

const ERRORS = new Map<string, FormulaError>(Object.values(Errors).map((error) => [error.error, error]))
const DIGIT = /\d/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(?:Z|[+-]\d{2}:?\d{2})?$/

// Sizes, visibility and styles of rows or of columns, stored densely once any line has one
class Lines {
	px = new Float32Array(0) // NaN for the default size
	flags = new Uint8Array(0) // 1 hidden, 2 listed and shown
	styles = new Uint32Array(0) // style + 1, or 0 for none
	defaultPx: number
	hiddenByDefault = false
	readonly #limit: number

	constructor(limit: number, defaultPx: number) {
		this.#limit = limit
		this.defaultPx = defaultPx
	}

	set(i: number, px: number, flags: number, style: number | undefined) {
		if (i >= this.px.length) this.#reserve(i)
		this.px[i] = px
		this.flags[i] = flags
		if (style !== undefined) this.styles[i] = style + 1
	}

	hidden(i: number): boolean {
		const flags = this.flags[i] ?? 0
		return flags === 1 || (this.hiddenByDefault && flags !== 2)
	}

	size(i: number): number {
		if (this.hidden(i)) return 0
		const px = this.px[i]
		return px === undefined || Number.isNaN(px) ? this.defaultPx : px
	}

	style(i: number): number | undefined {
		const style = this.styles[i]
		return style ? style - 1 : undefined
	}

	#reserve(i: number) {
		const size = Math.min(this.#limit, Math.max(i + 1, this.px.length * 2, 256))
		const px = new Float32Array(size).fill(NaN)
		px.set(this.px)
		const flags = new Uint8Array(size)
		flags.set(this.flags)
		const styles = new Uint32Array(size)
		styles.set(this.styles)
		this.px = px
		this.flags = flags
		this.styles = styles
	}
}

// Cells in document order, grown as they come
class CellBuffer {
	count = 0
	sorted = true
	rows: Uint32Array
	cols: Uint16Array
	kinds: Uint8Array
	values: Float64Array
	styles: Uint16Array | Uint32Array
	readonly #max: number
	#lastRow = -1
	#lastCol = -1

	constructor(presize: number, max: number, wideStyles: boolean) {
		this.#max = max
		const capacity = Math.min(presize, max)
		this.rows = new Uint32Array(capacity)
		this.cols = new Uint16Array(capacity)
		this.kinds = new Uint8Array(capacity)
		this.values = new Float64Array(capacity)
		this.styles = wideStyles ? new Uint32Array(capacity) : new Uint16Array(capacity)
	}

	push(row: number, col: number, kind: number, value: number, style: number): number {
		if (this.count === this.rows.length) this.#grow()
		const i = this.count++
		this.rows[i] = row
		this.cols[i] = col
		this.kinds[i] = kind
		this.values[i] = value
		this.styles[i] = style
		if (row < this.#lastRow || (row === this.#lastRow && col <= this.#lastCol)) this.sorted = false
		this.#lastRow = row
		this.#lastCol = col
		return i
	}

	#grow() {
		if (this.count >= this.#max) throw new XlsxError('limits', `The sheet has more than ${this.#max} cells`)
		const size = Math.min(this.#max, Math.ceil(this.count * 1.5) + 1024)
		const grow = <T extends Uint8Array | Uint16Array | Uint32Array | Float64Array>(from: T, to: T) => {
			to.set(from)
			return to
		}
		this.rows = grow(this.rows, new Uint32Array(size))
		this.cols = grow(this.cols, new Uint16Array(size))
		this.kinds = grow(this.kinds, new Uint8Array(size))
		this.values = grow(this.values, new Float64Array(size))
		this.styles = grow(this.styles, this.styles instanceof Uint32Array ? new Uint32Array(size) : new Uint16Array(size))
	}
}

type Master = {row: number; col: number; text: string}

type SheetData = SheetFeatures & {
	name: string
	rowStarts: Uint32Array
	cols: Uint16Array
	kinds: Uint8Array
	values: Float64Array
	cellStyles: Uint16Array | Uint32Array
	strings: StringTable
	sharedStrings: SharedStrings | undefined
	formulas: Map<number, string>
	members: Map<number, number>
	masters: Map<number, Master>
	runs: Map<number, RichRun[]> // of inline strings
	arrays: Range[]
	merges: Range[]
	hyperlinks: Hyperlink[]
	rowLines: Lines
	columnLines: Lines
	frozen: {rows: number; cols: number}
	showGridLines: boolean
	zoomScale: number
	rightToLeft: boolean
	protected: boolean
	hasConditionalFormats: boolean
	styles: ResolvedStyles
	date1904: boolean
	colCount: number
	size: number
}

export class Sheet {
	readonly name: string
	// The used range: one past the last row and column holding a cell (or covered by a merge)
	readonly rowCount: number
	readonly colCount: number
	readonly merges: readonly Range[]
	readonly hyperlinks: readonly Hyperlink[]
	// Array formulas (legacy and dynamic): the anchor cell holds the formula, the rest of the range its results
	readonly arrays: readonly Range[]
	// The header and totals rows of the sheet's tables, whose table parts name what's in them as well
	readonly headerAndTotalRows: readonly Range[]
	readonly frozen: {readonly rows: number; readonly cols: number}
	readonly showGridLines: boolean
	readonly zoomScale: number // percent
	readonly rightToLeft: boolean
	// Its locked cells can't be changed (see CellStyle.locked)
	readonly protected: boolean
	// Parts we keep on save but don't show
	readonly hasDrawings: boolean
	readonly hasCharts: boolean
	readonly hasPivots: boolean
	readonly hasComments: boolean
	readonly hasConditionalFormats: boolean
	// The size of the rows and columns the file doesn't size (rows can be hidden by default)
	readonly defaultRowHeightPx: number
	readonly defaultColWidthPx: number
	// What it holds, as maxCells counts it: its cells, merged ranges, hyperlinks and rich text runs
	readonly size: number
	readonly #data: SheetData
	// For a calculator reading through it, worked out when it first asks
	#populated: Uint32Array | undefined
	#extent: {rows: number; cols: number} | undefined

	constructor(data: SheetData) {
		this.#data = data
		this.name = data.name
		this.rowCount = data.rowStarts.length - 1
		this.colCount = data.colCount
		this.merges = data.merges
		this.hyperlinks = data.hyperlinks
		this.arrays = data.arrays
		this.headerAndTotalRows = data.headerAndTotalRows
		this.frozen = data.frozen
		this.showGridLines = data.showGridLines
		this.zoomScale = data.zoomScale
		this.rightToLeft = data.rightToLeft
		this.protected = data.protected
		this.hasDrawings = data.hasDrawings
		this.hasCharts = data.hasCharts
		this.hasPivots = data.hasPivots
		this.hasComments = data.hasComments
		this.hasConditionalFormats = data.hasConditionalFormats
		this.defaultRowHeightPx = data.rowLines.hiddenByDefault ? 0 : data.rowLines.defaultPx
		this.defaultColWidthPx = data.columnLines.defaultPx
		this.size = data.size
	}

	// A calculator reads the sheet's values through these: the value of a cell, or of the cell at a place in the
	// sheet's order, where a row's cells are those from rowStart(row) to rowStart(row + 1)
	value(row: number, col: number): Value {
		const i = this.#find(row, col)
		return i < 0 ? null : this.#value(i)
	}

	rowStart(row: number): number {
		return this.#data.rowStarts[Math.min(Math.max(row, 0), this.rowCount)]
	}

	columnAt(place: number): number {
		return this.#data.cols[place]
	}

	valueAt(place: number): Value {
		return this.#value(place)
	}

	// The rows holding cells, ascending
	populatedRows(): Uint32Array {
		if (this.#populated) return this.#populated
		const {rowStarts} = this.#data
		let count = 0
		for (let row = 0; row < this.rowCount; row++) if (rowStarts[row + 1] > rowStarts[row]) count++
		const rows = new Uint32Array(count)
		for (let row = 0, k = 0; row < this.rowCount; row++) if (rowStarts[row + 1] > rowStarts[row]) rows[k++] = row
		return (this.#populated = rows)
	}

	// One past the last row and column holding a value: the used range a calculator reads, where whole-column and
	// whole-row references stop (formulas reach it as they're given to the calculator)
	valueExtent(): {rows: number; cols: number} {
		if (this.#extent) return this.#extent
		const {rowStarts, cols, kinds} = this.#data
		let rows = 0
		let width = 0
		for (let row = 0; row < this.rowCount; row++) {
			for (let i = rowStarts[row]; i < rowStarts[row + 1]; i++) {
				if (kinds[i] === EMPTY) continue
				rows = row + 1
				if (cols[i] >= width) width = cols[i] + 1
			}
		}
		return (this.#extent = {rows, cols: width})
	}

	// The cells holding formulas, in order, with the values the file has for them: what a calculator holds
	*formulaCells(): Generator<{row: number; col: number; value: Value; formula: string}> {
		const {formulas, members, rowStarts, cols} = this.#data
		const places = [...formulas.keys(), ...members.keys()].sort((a, b) => a - b)
		let row = 0
		for (const i of places) {
			while (rowStarts[row + 1] <= i) row++
			const formula = this.#formula(i, row, cols[i])
			if (formula !== undefined) yield {row, col: cols[i], value: this.#value(i), formula}
		}
	}

	cell(row: number, col: number): Cell | undefined {
		const i = this.#find(row, col)
		if (i < 0) return undefined
		const {kinds, values, cellStyles, sharedStrings} = this.#data
		const formula = this.#formula(i, row, col)
		const runs = kinds[i] === SHARED ? sharedStrings?.runs.get(values[i]) : this.#data.runs.get(i)
		return {value: this.#value(i), style: cellStyles[i], ...(formula !== undefined && {formula}), ...(runs && {runs})}
	}

	// What the cell shows: its value through its number format, with the format's colour and fill
	display(row: number, col: number): FormattedValue {
		const i = this.#find(row, col)
		if (i < 0) return {text: ''}
		const {kinds, values, cellStyles, styles, date1904} = this.#data
		const {format} = styles[cellStyles[i]]
		switch (kinds[i]) {
			case NUMBER:
				return formatNumber(values[i], format, {date1904})
			case SHARED:
			case TEXT:
				return formatNumber(this.#value(i) as string, format)
			case BOOLEAN:
				return {text: values[i] ? 'TRUE' : 'FALSE'}
			case ERROR:
				return {text: this.#data.strings.get(values[i])}
			default:
				return {text: ''}
		}
	}

	text(row: number, col: number): string {
		return this.display(row, col).text
	}

	// The style a cell is drawn with, whether or not it exists: its own, else its row's, else its column's
	styleAt(row: number, col: number): number {
		const i = this.#find(row, col)
		if (i >= 0) return this.#data.cellStyles[i]
		return this.#data.rowLines.style(row) ?? this.#data.columnLines.style(col) ?? 0
	}

	// A whole row's or column's own style, which its cells that don't exist are drawn with
	rowStyle(row: number): number | undefined {
		return this.#data.rowLines.style(row)
	}

	colStyle(col: number): number | undefined {
		return this.#data.columnLines.style(col)
	}

	// The columns of a row's cells, ascending, for finding neighbours (text overflow, Ctrl+arrows). A view of the
	// sheet's own storage: read it, don't write to it.
	rowColumns(row: number): Uint16Array {
		const {rowStarts, cols} = this.#data
		return row >= 0 && row < this.rowCount ? cols.subarray(rowStarts[row], rowStarts[row + 1]) : cols.subarray(0, 0)
	}

	colWidthPx(col: number): number {
		return this.#data.columnLines.size(col)
	}

	rowHeightPx(row: number): number {
		return this.#data.rowLines.size(row)
	}

	isColHidden(col: number): boolean {
		return this.#data.columnLines.hidden(col)
	}

	isRowHidden(row: number): boolean {
		return this.#data.rowLines.hidden(row)
	}

	#find(row: number, col: number): number {
		if (!(row >= 0 && row < this.rowCount)) return -1
		const {rowStarts, cols} = this.#data
		let low = rowStarts[row]
		let high = rowStarts[row + 1] - 1
		while (low <= high) {
			const middle = (low + high) >>> 1
			const c = cols[middle]
			if (c === col) return middle
			if (c < col) low = middle + 1
			else high = middle - 1
		}
		return -1
	}

	#value(i: number): Value {
		const {kinds, values, strings, sharedStrings} = this.#data
		switch (kinds[i]) {
			case NUMBER:
				return values[i]
			case SHARED:
				return sharedStrings!.table.get(values[i])
			case TEXT:
				return strings.get(values[i])
			case BOOLEAN:
				return values[i] === 1
			case ERROR:
				// Codes we don't model (#GETTING_DATA, #BLOCKED!...) still display as written
				return ERRORS.get(strings.get(values[i])) ?? Errors.value
			default:
				return null
		}
	}

	#formula(i: number, row: number, col: number): string | undefined {
		const {formulas, members, masters} = this.#data
		const text = formulas.get(i)
		if (text !== undefined) return displayFormula(text)
		const si = members.get(i)
		const master = si === undefined ? undefined : masters.get(si)
		if (!master) return undefined
		// A shared formula's member is its master's formula as if copied here
		try {
			return displayFormula(shiftFormula(master.text, {rows: row - master.row, cols: col - master.col}))
		} catch {
			return undefined
		}
	}
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1)
const ELEMENTS = ['c', 'v', 'f', 'is', 'r', 't', 'rPh', 'row', 'sheetData']
const relId = (attributes: Record<string, string>) => {
	for (const key in attributes) if (key === 'id' || key.endsWith(':id')) return attributes[key]
	return undefined
}

export function emptySheet(context: SheetContext, features: SheetFeatures): Sheet {
	return parseSheet('<worksheet/>', context, features)
}

export function parseSheet(xml: string, context: SheetContext, features: SheetFeatures): Sheet {
	const {sharedStrings, styles, theme, palette, date1904, rels, maxCells} = context
	const sharedCount = sharedStrings?.table.count ?? 0
	const strings = new StringTable()
	const formulas = new Map<number, string>()
	const members = new Map<number, number>()
	const masters = new Map<number, Master>()
	const runs = new Map<number, RichRun[]>()
	const arrays: Range[] = []
	const merges: Range[] = []
	const hyperlinks: Hyperlink[] = []
	const rowLines = new Lines(MAX_ROWS, 20)
	// Excel rounds the default column width up to whole multiples of 8 px: 8 characters make 61 px, shown as 64
	const columnLines = new Lines(MAX_COLS, 64)
	let frozen = {rows: 0, cols: 0}
	let showGridLines = true
	let zoomScale = 100
	let rightToLeft = false
	let sheetProtected = false
	let hasConditionalFormats = false
	let views = 0
	let inView = false
	let columnWork = 0
	// Merges, hyperlinks and rich text runs count against the cell budget too: each is an object
	let extras = 0
	let capacity = 1024

	let cells: CellBuffer | undefined
	let inData = false
	let row = -1
	let col = -1
	// The cell being read
	let inCell = false
	let skip = false
	let cellRow = 0
	let cellCol = 0
	let style = 0
	let type = 'n'
	let value: string | undefined
	let formula: string | undefined
	let formulaType: string | undefined
	let formulaRef: string | undefined
	let formulaSi: string | undefined
	let inline: string | undefined
	// An inline string's <is> element, when it has rich text runs to read
	let inlineStart = -1
	let inlineEnd = -1
	let rich = false
	let capture = 0 // 1 <v>, 2 <f>, 3 an inline string's <t>
	let phonetic = 0

	const commit = () => {
		if (skip) return
		let kind = EMPTY
		let number = 0
		if (type === 's') {
			const i = value ? Number(value) : -1
			if (Number.isInteger(i) && i >= 0 && i < sharedCount) {
				kind = SHARED
				number = i
			}
		} else if (type === 'inlineStr' || type === 'str') {
			// A formula's text result may be "", which isn't the same as no value; an inline string without
			// content is "" too
			const text = type === 'inlineStr' ? (inline ?? value ?? '') : value
			if (text !== undefined) {
				kind = TEXT
				number = strings.add(unescapeText(text))
			}
		} else if (type === 'b') {
			if (value) {
				kind = BOOLEAN
				number = value.trim() === '1' || value.trim().toLowerCase() === 'true' ? 1 : 0
			}
		} else if (type === 'e') {
			if (value) {
				kind = ERROR
				number = strings.add(value.trim())
			}
		} else if (type === 'd') {
			if (value) {
				const serial = isoSerial(value.trim(), date1904)
				kind = serial === undefined ? TEXT : NUMBER
				number = serial ?? strings.add(value)
			}
		} else if (value) {
			let n = Number(value)
			// Writers that print 16 digits can round the largest double up past what a double holds
			if (Math.abs(n) === Infinity && DIGIT.test(value)) n = Math.sign(n) * Number.MAX_VALUE
			if (Number.isFinite(n) && (n !== 0 || DIGIT.test(value))) {
				kind = NUMBER
				number = n
			}
		}
		cells ??= new CellBuffer(capacity, maxCells, styles.length > 0xffff)
		const i = cells.push(cellRow, cellCol, kind, number, style)
		if (rich && kind === TEXT && inlineEnd > inlineStart) {
			const parsed = richRuns(parseXml(xml.slice(inlineStart, inlineEnd)), theme, palette)
			for (let k = 0; k < parsed.length; k++) countExtra()
			runs.set(i, parsed)
		}
		if (formula === undefined) return
		// Kept for the sheet's lifetime, so it mustn't pin the XML it was sliced from
		formula = detach(formula)
		if (formulaType === 'shared') {
			const si = index(formulaSi)
			if (si === undefined) return
			if (formula) {
				masters.set(si, {row: cellRow, col: cellCol, text: formula})
				formulas.set(i, formula)
			} else members.set(i, si)
		} else if (formulaType === 'array') {
			if (!formula) return
			formulas.set(i, formula)
			arrays.push(parseRange(formulaRef ?? '') ?? {top: cellRow, left: cellCol, bottom: cellRow, right: cellCol})
		} else if (formulaType !== 'dataTable' && formula) {
			// A what-if data table's cells are computed by Excel without a formula of their own
			formulas.set(i, formula)
		}
	}

	const countExtra = () => {
		if (++extras + (cells?.count ?? 0) > maxCells) throw new XlsxError('limits', 'The sheet is too large')
	}

	// The part's prefix for the SpreadsheetML namespace (usually none) is fixed by its root, so the loop compares whole
	// names instead of stripping a prefix from each of millions of events
	let rooted = false
	let [C, V, F, IS, R, T, PHONETIC, ROW, SHEET_DATA] = ELEMENTS

	tokenizeXml(xml, (event) => {
		if (event.type === 'text') {
			if (capture === 1) value += event.text
			else if (capture === 2) formula += event.text
			else if (capture === 3 && !phonetic) inline += event.text
			return
		}
		const {name} = event
		if (event.type === 'close') {
			if (inCell) {
				if (name === C) {
					commit()
					inCell = false
				} else if (name === PHONETIC) phonetic--
				else if (name === IS) inlineEnd = event.end
				capture = 0
			} else if (name === SHEET_DATA) inData = false
			else if (!inData && localName(name) === 'sheetView') inView = false
			return
		}
		const {attributes, selfClosing} = event
		if (!rooted) {
			rooted = true
			const prefix = name.slice(0, name.indexOf(':') + 1)
			;[C, V, F, IS, R, T, PHONETIC, ROW, SHEET_DATA] = ELEMENTS.map((local) => prefix + local)
		}
		if (inCell) {
			if (name === V) {
				value = ''
				capture = selfClosing ? 0 : 1
			} else if (name === F) {
				formula = ''
				formulaType = attributes.t
				formulaRef = attributes.ref
				formulaSi = attributes.si
				capture = selfClosing ? 0 : 2
			} else if (name === IS) {
				inline = ''
				inlineStart = event.start
			} else if (name === R && inline !== undefined) rich = true
			else if (name === T && inline !== undefined && !selfClosing) capture = 3
			else if (name === PHONETIC && !selfClosing) phonetic++
			return
		}
		if (inData) {
			if (name === C) {
				const ref = attributes.r
				// Without r a cell follows the previous one in its row
				const position =
					ref !== undefined
						? parseRef(ref)
						: row < MAX_ROWS && col + 1 < MAX_COLS
							? Math.max(row, 0) * MAX_COLS + col + 1
							: -1
				skip = position < 0
				if (!skip) {
					cellCol = position % MAX_COLS
					cellRow = (position - cellCol) / MAX_COLS
					col = cellCol
				}
				const s = attributes.s
				style = s === undefined ? 0 : (index(s) ?? 0)
				if (style >= styles.length) style = 0
				type = attributes.t ?? 'n'
				value = formula = formulaType = formulaRef = formulaSi = inline = undefined
				capture = phonetic = 0
				rich = false
				if (selfClosing) commit()
				else inCell = true
			} else if (name === ROW) {
				const r = index(attributes.r)
				row = r !== undefined && r >= 1 && r <= MAX_ROWS ? r - 1 : row + 1
				col = -1
				const {ht, hidden, customFormat} = attributes
				if (
					(ht !== undefined || hidden !== undefined || customFormat !== undefined || rowLines.hiddenByDefault) &&
					row < MAX_ROWS
				) {
					const height = Number(ht)
					rowLines.set(
						row,
						ht !== undefined && height >= 0 ? Math.min(Math.round((height * 4) / 3), MAX_HEIGHT_PX) : NaN,
						flag(hidden) ? 1 : 2,
						flag(customFormat) ? clampStyle(index(attributes.s), styles) : undefined,
					)
				}
			}
			return
		}
		switch (localName(name)) {
			case 'sheetData':
				inData = !selfClosing
				break
			case 'dimension': {
				// Presize for a dense used range, so a big sheet's arrays aren't grown and copied as it loads. The
				// range is only a hint, so it's capped at what the XML could hold at 16 characters a cell (fewer
				// than any cell with a value takes), and an implausibly large one is ignored.
				const range = parseRange(attributes.ref ?? '')
				const area = range ? (range.bottom - range.top + 1) * (range.right - range.left + 1) : 0
				if (area <= 1 << 22) capacity = Math.max(1024, Math.min(area, Math.floor(xml.length / 16)))
				break
			}
			case 'sheetFormatPr': {
				const width = Number(attributes.defaultColWidth)
				const base = Number(attributes.baseColWidth ?? 8)
				columnLines.defaultPx = Math.min(
					width > 0 ? widthToPx(width) : Math.ceil(((base > 0 ? base : 8) * DIGIT_PX + 5) / 8) * 8,
					MAX_WIDTH_PX,
				)
				const height = Number(attributes.defaultRowHeight)
				if (height > 0) rowLines.defaultPx = Math.min(Math.round((height * 4) / 3), MAX_HEIGHT_PX)
				rowLines.hiddenByDefault = flag(attributes.zeroHeight)
				break
			}
			case 'col': {
				const min = index(attributes.min)
				const max = index(attributes.max)
				if (!min || !max) break
				const to = Math.min(max, MAX_COLS) - 1
				columnWork += to - min + 2
				if (to < min - 1 || columnWork > MAX_COLUMN_WORK) break
				const width = Number(attributes.width)
				const px = attributes.width !== undefined && width >= 0 ? Math.min(widthToPx(width), MAX_WIDTH_PX) : NaN
				const columnStyle = clampStyle(index(attributes.style), styles)
				for (let c = min - 1; c <= to; c++) columnLines.set(c, px, flag(attributes.hidden) ? 1 : 0, columnStyle)
				break
			}
			case 'sheetView':
				// Only the first view (workbookViewId 0) is the one Excel opens with
				if (views++) break
				inView = !selfClosing
				showGridLines = attributes.showGridLines === undefined || flag(attributes.showGridLines)
				zoomScale = Math.min(Math.max(index(attributes.zoomScale) || 100, 10), 400)
				rightToLeft = flag(attributes.rightToLeft)
				break
			case 'pane':
				if (inView && (attributes.state === 'frozen' || attributes.state === 'frozenSplit')) {
					const split = (text: string | undefined) => Math.max(0, Math.floor(Number(text) || 0))
					frozen = {
						rows: Math.min(split(attributes.ySplit), MAX_ROWS),
						cols: Math.min(split(attributes.xSplit), MAX_COLS),
					}
				}
				break
			case 'sheetProtection':
				sheetProtected = flag(attributes.sheet)
				break
			// Excel 2007's, and Excel 2010's in the extension list
			case 'conditionalFormatting':
				hasConditionalFormats = true
				break
			case 'mergeCell': {
				const range = parseRange(attributes.ref ?? '')
				if (range && (range.top !== range.bottom || range.left !== range.right)) {
					countExtra()
					merges.push(range)
				}
				break
			}
			case 'hyperlink': {
				const range = parseRange(attributes.ref ?? '')
				if (!range) break
				countExtra()
				const id = relId(attributes)
				const rel = id === undefined ? undefined : rels.get(id)
				let location: string | undefined = attributes.location
				let url: string | undefined
				if (rel?.target.startsWith('#')) location ??= rel.target.slice(1)
				else if (rel?.external) {
					url = safeHref(location ? `${rel.target.trim()}#${location}` : rel.target)
					location = undefined
				} else if (rel) location = undefined
				if (!url && !location) break
				const {tooltip} = attributes
				hyperlinks.push({
					range,
					...(url && {url: detach(url)}),
					...(location && {location: detach(location)}),
					...(tooltip && {tooltip: detach(tooltip)}),
				})
				break
			}
		}
	})

	return build()

	function build(): Sheet {
		const buffer = cells ?? new CellBuffer(0, 0, false)
		let {count, rows, cols, kinds, values, styles: cellStyles} = buffer
		let formulaMap = formulas
		let memberMap = members
		let runMap = runs
		if (!buffer.sorted) {
			// Out-of-order cells (rare, and only from other writers) are sorted, and a repeated cell keeps its last value
			const order = new Uint32Array(count)
			for (let i = 0; i < count; i++) order[i] = i
			order.sort((a, b) => rows[a] - rows[b] || cols[a] - cols[b] || a - b)
			const kept: number[] = []
			for (let k = 0; k < count; k++) {
				const i = order[k]
				const next = order[k + 1]
				if (k + 1 < count && rows[next] === rows[i] && cols[next] === cols[i]) continue
				kept.push(i)
			}
			const remap = new Int32Array(count).fill(-1)
			kept.forEach((i, k) => (remap[i] = k))
			const pick = <T extends Uint8Array | Uint16Array | Uint32Array | Float64Array>(from: T, to: T) => {
				kept.forEach((i, k) => (to[k] = from[i]))
				return to
			}
			count = kept.length
			rows = pick(rows, new Uint32Array(count))
			cols = pick(cols, new Uint16Array(count))
			kinds = pick(kinds, new Uint8Array(count))
			values = pick(values, new Float64Array(count))
			cellStyles = pick(cellStyles, cellStyles instanceof Uint32Array ? new Uint32Array(count) : new Uint16Array(count))
			const move = <V>(map: Map<number, V>) => {
				const moved = new Map<number, V>()
				for (const [i, v] of map) if (remap[i] >= 0) moved.set(remap[i], v)
				return moved
			}
			formulaMap = move(formulas)
			memberMap = move(members)
			runMap = move(runs)
		} else if (count < rows.length) {
			// Hand back what growth over-allocated
			cols = cols.slice(0, count)
			kinds = kinds.slice(0, count)
			values = values.slice(0, count)
			cellStyles = cellStyles.slice(0, count)
		}
		let rowCount = count ? rows[count - 1] + 1 : 0
		let colCount = 0
		for (let i = 0; i < count; i++) if (cols[i] >= colCount) colCount = cols[i] + 1
		for (const range of merges) {
			rowCount = Math.max(rowCount, range.bottom + 1)
			colCount = Math.max(colCount, range.right + 1)
		}
		const rowStarts = new Uint32Array(rowCount + 1)
		for (let i = 0; i < count; i++) rowStarts[rows[i] + 1]++
		for (let r = 0; r < rowCount; r++) rowStarts[r + 1] += rowStarts[r]
		strings.seal()
		fitRows(rowStarts, cols, kinds, values, cellStyles, strings, sharedStrings, styles, merges, rowLines, columnLines)
		return new Sheet({
			...features,
			name: context.name,
			rowStarts,
			cols,
			kinds,
			values,
			cellStyles,
			strings,
			sharedStrings,
			formulas: formulaMap,
			members: memberMap,
			masters,
			runs: runMap,
			arrays,
			merges,
			hyperlinks,
			rowLines,
			columnLines,
			frozen,
			showGridLines,
			zoomScale,
			rightToLeft,
			protected: sheetProtected,
			hasConditionalFormats,
			styles,
			date1904,
			colCount,
			size: count + extras,
		})
	}
}

// Rows the file leaves unsized, as libraries that write workbooks often do, sized by what they hold, as Excel sizes
// them when it opens such a file: each cell's lines at its font's line height, the lines of text that wraps reckoned
// against its column's width. Only a row that needs more than one line of the workbook's own font, or than the sheet's
// default height, changes; merged cells don't count, as in Excel. A worker can't measure text, so the widths are
// reckoned (CHAR_PX_PER_POINT) rather than measured.
function fitRows(
	rowStarts: Uint32Array,
	cols: Uint16Array,
	kinds: Uint8Array,
	values: Float64Array,
	cellStyles: Uint16Array | Uint32Array,
	strings: StringTable,
	sharedStrings: SharedStrings | undefined,
	styles: ResolvedStyles,
	merges: readonly Range[],
	rowLines: Lines,
	columnLines: Lines,
) {
	const lineOf = new Float32Array(styles.length)
	const wraps = new Uint8Array(styles.length)
	let tallest = 0
	for (let s = 0; s < styles.length; s++) {
		const {font, alignment} = styles[s]
		lineOf[s] = font.size * LINE_PX_PER_POINT
		if (lineOf[s] > tallest) tallest = lineOf[s]
		const wrapped = alignment.wrap || alignment.horizontal === 'justify' || alignment.horizontal === 'distributed'
		if (wrapped && alignment.rotation === 0) wraps[s] = 1
	}
	// A line of the workbook's own font (its first style's) is what any row is drawn to hold
	const single = Math.max(rowLines.defaultPx, lineOf[0] || 0)
	// Most workbooks have nothing that takes more than that
	if (tallest <= single && !wraps.includes(1)) return
	const merged = new Set(merges.map((merge) => merge.top * MAX_COLS + merge.left))
	for (let row = 0; row + 1 < rowStarts.length; row++) {
		const stored = rowLines.px[row]
		if ((stored !== undefined && !Number.isNaN(stored)) || rowLines.hidden(row)) continue
		let needed = 0
		for (let i = rowStarts[row]; i < rowStarts[row + 1]; i++) {
			const style = cellStyles[i]
			const col = cols[i]
			if (merged.size && merged.has(row * MAX_COLS + col)) continue
			let lines = 1
			if (wraps[style] && (kinds[i] === SHARED || kinds[i] === TEXT)) {
				const {font, alignment} = styles[style]
				const width = columnLines.size(col) - 2 * PADDING_PX - alignment.indent * INDENT_PX
				// A hidden column's cells aren't shown
				if (width <= 0) continue
				const text = kinds[i] === SHARED ? sharedStrings!.table.get(values[i]) : strings.get(values[i])
				lines = wrappedLines(text, width, font.size * CHAR_PX_PER_POINT, Math.ceil(MAX_HEIGHT_PX / lineOf[style]))
			}
			needed = Math.max(needed, lines * lineOf[style])
		}
		if (needed > single)
			rowLines.set(row, Math.min(Math.round(needed), MAX_HEIGHT_PX), rowLines.flags[row] ?? 0, undefined)
	}
}

// How many lines text wraps to in a width, as paint wraps it: at spaces where it can (a word keeps the spaces after
// it), else mid-word. Each character is `charPx` wide, or twice that for a wide one; lines past `most` aren't counted.
// One pass over the text's code units, since a sheet can hold hundreds of thousands of texts that wrap.
function wrappedLines(text: string, width: number, charPx: number, most: number): number {
	let lines = 1
	let line = 0
	// The word being read: where it starts, and its width so far
	let start = 0
	let px = 0
	// The word goes on the line if it fits, else on the next; a word longer than a line is broken where it must be,
	// as many characters to a line as fit
	const place = (end: number) => {
		if (line > 0 && line + px > width) {
			lines++
			line = 0
		}
		if (line + px <= width) line += px
		else
			for (let i = start; i < end; i++) {
				const unit = unitPx(text.charCodeAt(i), charPx)
				if (line > 0 && line + unit > width) {
					lines++
					line = 0
				}
				line += unit
			}
	}
	for (let i = 0; i < text.length && lines < most; i++) {
		const code = text.charCodeAt(i)
		if (code === 10 || code === 13) {
			place(i)
			if (code === 13 && text.charCodeAt(i + 1) === 10) i++
			lines++
			line = px = 0
			start = i + 1
			continue
		}
		px += unitPx(code, charPx)
		if (space(code)) {
			place(i + 1)
			px = 0
			start = i + 1
		}
	}
	if (lines < most) place(text.length)
	return Math.min(lines, most)
}

// A UTF-16 code unit's share of a character's width: East Asian wide and fullwidth characters, and those past the
// Basic Multilingual Plane (emoji, more CJK), take about twice a Latin letter's, counted on their first unit
const unitPx = (code: number, charPx: number) =>
	code >= 0xdc00 && code <= 0xdfff
		? 0
		: (code >= 0x1100 && code <= 0x115f) ||
			  (code >= 0x2e80 && code <= 0xa4cf) ||
			  (code >= 0xac00 && code <= 0xd7a3) ||
			  (code >= 0xd800 && code <= 0xdbff) ||
			  (code >= 0xf900 && code <= 0xfaff) ||
			  (code >= 0xfe30 && code <= 0xfe4f) ||
			  (code >= 0xff00 && code <= 0xff60) ||
			  (code >= 0xffe0 && code <= 0xffe6)
			? 2 * charPx
			: charPx

// What \s matches, other than line breaks: where paint lets a line wrap
const space = (code: number) =>
	code === 32 ||
	code === 9 ||
	code === 11 ||
	code === 12 ||
	code === 0xa0 ||
	code === 0x1680 ||
	(code >= 0x2000 && code <= 0x200a) ||
	code === 0x2028 ||
	code === 0x2029 ||
	code === 0x202f ||
	code === 0x205f ||
	code === 0x3000 ||
	code === 0xfeff

// A workbook's sheets as what a calculator reads through: every value it doesn't hold
export function calculatorBase(sheets: readonly Sheet[]): CellBase {
	const extents = sheets.map((sheet) => sheet.valueExtent())
	return {
		rows: Math.max(0, ...extents.map((extent) => extent.rows)),
		cols: Math.max(0, ...extents.map((extent) => extent.cols)),
		value: (sheet, row, col) => sheets[sheet].value(row, col),
		rowStart: (sheet, row) => sheets[sheet].rowStart(row),
		columnAt: (sheet, place) => sheets[sheet].columnAt(place),
		valueAt: (sheet, place) => sheets[sheet].valueAt(place),
		populated: (sheet) => sheets[sheet].populatedRows(),
	}
}

function clampStyle(style: number | undefined, styles: ResolvedStyles): number | undefined {
	return style !== undefined && style < styles.length ? style : undefined
}

// t="d" cells hold an ISO 8601 date and time instead of a serial number
function isoSerial(value: string, date1904: boolean): number | undefined {
	const match = ISO_DATE.exec(value)
	if (!match) return undefined
	const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
	const days = serialFromParts(Number(year), Number(month), Number(day), date1904)
	const serial = days + (Number(hour) * 3600 + Number(minute) * 60 + Number(second)) / 86400
	return serial >= 0 ? serial : undefined
}
