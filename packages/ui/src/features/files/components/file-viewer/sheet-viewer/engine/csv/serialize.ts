// Writes an edited CSV back by splicing the original bytes. Untouched rows are
// copied verbatim; an edited row rewrites only the fields that changed (the
// others keep their exact bytes, quoting included, and the row keeps its line
// break); new text is quoted only where the format needs it. Column edits shift
// every row, so they rewrite all rows, still copying each untouched field.
// Saving in another encoding transcodes everything.

import type {CsvDialect, CsvEncoding, CsvIndex} from './csv'
import {positionOf, structuralWidth, type CsvEdits} from './edits'
import {
	decodeChunks,
	field,
	fieldText,
	preamble,
	scanField,
	syntaxOf,
	unitsOf,
	WINDOWS_1252_HIGH,
	type Field,
} from './scan'

// 'unrepresentable': windows-1252 has no byte for `char` (offer saving as UTF-8).
// 'unquotable': a file that doesn't use quotes can't hold a delimiter or line
// break inside a cell.
export type CsvEncodeErrorCode = 'unrepresentable' | 'unquotable'

export class CsvEncodeError extends Error {
	readonly code: CsvEncodeErrorCode
	readonly char?: string
	readonly row?: number
	readonly column?: number

	constructor(code: CsvEncodeErrorCode, message: string, details: {char?: string; row?: number; column?: number} = {}) {
		super(message)
		this.name = 'CsvEncodeError'
		this.code = code
		this.char = details.char
		this.row = details.row
		this.column = details.column
	}
}

type Cell = {row: number; column: number}

const encoder = new TextEncoder()
const WINDOWS_1252 = new Map(Array.from(WINDOWS_1252_HIGH, (char, i) => [char.charCodeAt(0), 0x80 + i]))
const BOMS: Record<CsvEncoding, number[]> = {
	'utf-8': [0xef, 0xbb, 0xbf],
	'utf-16le': [0xff, 0xfe],
	'utf-16be': [0xfe, 0xff],
	'windows-1252': [],
}
const QUOTE = 0x22
const CR = 0x0d
const POOLED = 4096

class Writer {
	private buffer: Uint8Array<ArrayBuffer>
	length = 0

	constructor(
		private readonly source: Uint8Array,
		private readonly from: CsvEncoding,
		private readonly to: CsvEncoding,
	) {
		this.buffer = new Uint8Array(source.length + 4096)
	}

	private reserve(count: number) {
		if (this.length + count <= this.buffer.length) return
		// The output is about the input's size, so growing by a quarter rarely needs a second step
		const next = new Uint8Array(Math.max(Math.ceil(this.buffer.length * 1.25), this.length + count))
		next.set(this.buffer.subarray(0, this.length))
		this.buffer = next
	}

	// Source bytes [start, end), transcoded when the target encoding differs
	copy(start: number, end: number) {
		if (start >= end) return
		if (this.from !== this.to) return decodeChunks(this.source, this.from, start, end, (text) => this.text(text))
		this.reserve(end - start)
		this.buffer.set(this.source.subarray(start, end), this.length)
		this.length += end - start
	}

	bom() {
		this.reserve(3)
		for (const byte of BOMS[this.to]) this.buffer[this.length++] = byte
	}

	endsWith(code: number): boolean {
		const {buffer, length} = this
		if (this.to === 'utf-16le') return length >= 2 && buffer[length - 2] === code && buffer[length - 1] === 0
		if (this.to === 'utf-16be') return length >= 2 && buffer[length - 2] === 0 && buffer[length - 1] === code
		return length >= 1 && buffer[length - 1] === code
	}

	// A delimiter, quote or line-break character
	ascii(code: number) {
		this.reserve(2)
		if (this.to === 'utf-16le') {
			this.buffer[this.length++] = code
			this.buffer[this.length++] = 0
		} else if (this.to === 'utf-16be') {
			this.buffer[this.length++] = 0
			this.buffer[this.length++] = code
		} else {
			this.buffer[this.length++] = code
		}
	}

	text(text: string, cell?: Cell) {
		if (this.to === 'utf-8') {
			// Encodes into the free space and grows only when the text didn't fit
			let rest = text
			for (;;) {
				const {read, written} = encoder.encodeInto(rest, this.buffer.subarray(this.length))
				this.length += written
				if (read === rest.length) return
				rest = rest.slice(read)
				this.reserve(rest.length * 3)
			}
		}
		if (this.to === 'windows-1252') {
			this.reserve(text.length)
			for (let i = 0; i < text.length; i++) {
				const unit = text.charCodeAt(i)
				const byte = unit < 0x80 || (unit >= 0xa0 && unit <= 0xff) ? unit : WINDOWS_1252.get(unit)
				if (byte === undefined) {
					const char = String.fromCodePoint(text.codePointAt(i)!)
					throw new CsvEncodeError('unrepresentable', `windows-1252 has no byte for ${JSON.stringify(char)}`, {
						char,
						...cell,
					})
				}
				this.buffer[this.length++] = byte
			}
			return
		}
		this.reserve(text.length * 2)
		const high = this.to === 'utf-16be' ? 0 : 1
		for (let i = 0; i < text.length; i++, this.length += 2) {
			const unit = text.charCodeAt(i)
			this.buffer[this.length + high] = unit >> 8
			this.buffer[this.length + 1 - high] = unit & 0xff
		}
	}

	finish(): Uint8Array<ArrayBuffer> {
		return this.buffer.slice(0, this.length)
	}
}

// `index` and `edits` must come from these bytes. `target` converts the file:
// windows-1252 throws CsvEncodeError for text it can't hold, UTF-8 holds anything.
export function serializeCsv(
	bytes: Uint8Array,
	dialect: CsvDialect,
	index: CsvIndex,
	edits: CsvEdits,
	target: Pick<CsvDialect, 'encoding' | 'bom'> = dialect,
): Uint8Array<ArrayBuffer> {
	const u = unitsOf(bytes, dialect.encoding)
	const size = u.BYTES_PER_ELEMENT
	const s = syntaxOf(dialect.encoding, dialect.delimiter, dialect.quote)
	const starts = index.rowStarts
	const out = new Writer(bytes, dialect.encoding, target.encoding)
	const f = field()
	const delimiter = dialect.delimiter.charCodeAt(0)
	const needsQuotes = new RegExp(`[${dialect.delimiter}"\\r\\n]|^[ \\t]|[ \\t]$`)
	const structural = new RegExp(`[${dialect.delimiter}\\r\\n]`)

	let rowTotal = 0
	for (const run of edits.rows) {
		if (run.key >= 0 && run.key + run.count > index.rowCount) throw new RangeError('The edits are for a different file')
		rowTotal += run.count
	}
	const sameColumns = edits.columns.length === 1 && edits.columns[0].key === 0
	const width = structuralWidth(edits.columns, index.columnCount)

	// The line break ending a row, in units. The last row may have none, or end
	// inside a quote that never closes (where a line break is text).
	const breakOf = (row: number): number => {
		const rowStart = starts[row] / size
		const rowEnd = starts[row + 1] / size
		if (row < index.rowCount - 1)
			return u[rowEnd - 1] === s.lf && rowEnd - 2 >= rowStart && u[rowEnd - 2] === s.cr ? 2 : 1
		for (let i = rowStart; ; i = f.next) {
			scanField(u, i, rowEnd, s, f)
			if (f.last) return f.terminator
		}
	}
	// Whichever row ends up last keeps the file's final line break, or its absence
	const finalBreak = index.rowCount === 0 || breakOf(index.rowCount - 1) > 0
	// A last row inside an open quote gets the quote closed before anything follows it
	const openRow = !finalBreak && f.quoted && !f.closed ? index.rowCount - 1 : -1

	// Walks the column runs alongside the position, which only grows within a
	// row, so a row of millions of fields costs no memory to map
	let run = 0
	let runStart = 0
	const columnKey = (position: number) => {
		if (position < runStart) run = runStart = 0
		while (position >= runStart + edits.columns[run].count) runStart += edits.columns[run++].count
		const {key} = edits.columns[run]
		return key < 0 ? key - (position - runStart) : key + (position - runStart)
	}
	const cellPositions = new Map<number, number>()
	const lastCellPosition = (cells: ReadonlyMap<number, string> | undefined) => {
		let last = -1
		for (const key of cells?.keys() ?? []) {
			let position = cellPositions.get(key)
			if (position === undefined) cellPositions.set(key, (position = positionOf(edits.columns, key)))
			last = Math.max(last, position)
		}
		return last
	}

	const writeValue = (value: string, quoted: boolean, cell: Cell) => {
		if (s.quote < 0) {
			if (structural.test(value)) {
				throw new CsvEncodeError('unquotable', 'This file has no quoting for a delimiter or line break in a cell', cell)
			}
			return out.text(value, cell)
		}
		if (!quoted && !needsQuotes.test(value)) return out.text(value, cell)
		out.ascii(QUOTE)
		out.text(value.replaceAll('"', '""'), cell)
		out.ascii(QUOTE)
	}

	const lineBreak = () => {
		for (const char of dialect.lineEnding) out.ascii(char.charCodeAt(0))
	}
	// Edits can put an empty row starting with LF after a row ending in a lone
	// CR, which would read back as one CRLF and lose a row: make it CR CRLF
	const keepApart = (startsWithLf: boolean) => {
		if (startsWithLf && out.endsWith(CR)) out.ascii(CR)
	}
	const endRow = (breakStart: number, breakEnd: number, empty: boolean, last: boolean) => {
		// Leaving the break off an empty last row would drop the row
		if (last && !finalBreak && !empty) return
		if (breakEnd > breakStart) out.copy(breakStart, breakEnd)
		else lineBreak()
	}
	// Ends a row written field by field, whose fields may have come out empty
	const endFields = (empty: boolean, breakStart: number, breakEnd: number, last: boolean) => {
		if (empty) keepApart(breakEnd > breakStart ? u[breakStart / size] === s.lf : dialect.lineEnding === '\n')
		endRow(breakStart, breakEnd, empty, last)
	}

	const copyRows = (from: number, to: number, last: boolean) => {
		const breakStart = starts[to] - breakOf(to - 1) * size
		keepApart(u[starts[from] / size] === s.lf)
		out.copy(starts[from], breakStart)
		endRow(breakStart, starts[to], breakStart === starts[to - 1], last)
	}

	// The first fields of the row being rewritten, reused from row to row; a
	// hostile row's fields past them are scanned again rather than held
	const pool: Field[] = []
	const editRow = (row: number, position: number) => {
		const rowStart = starts[row] / size
		const rowEnd = starts[row + 1] / size
		const cells = edits.cells.get(row)
		let fields = 0
		let current = f
		for (let i = rowStart; ; i = current.next) {
			current = fields < POOLED ? (pool[fields] ??= field()) : f
			scanField(u, i, rowEnd, s, current)
			fields++
			if (current.last) break
		}
		const breakStart = current.end
		let scanned = POOLED - 1
		let cursor = fields > POOLED ? pool[POOLED - 1].next : rowEnd
		const fieldAt = (key: number): Field => {
			if (key < POOLED) return pool[key]
			for (; scanned < key; scanned++, cursor = f.next) scanField(u, cursor, rowEnd, s, f)
			return f
		}
		// Write every field the row had, cells set past its end, and, for a row
		// as wide as the file, columns inserted after its last field
		let extent = Math.max(fields >= index.columnCount ? width - 1 : -1, lastCellPosition(cells))
		let runPosition = 0
		for (const run of edits.columns) {
			if (run.key >= 0 && run.key < fields) {
				extent = Math.max(extent, runPosition + Math.min(run.count, fields - run.key) - 1)
			}
			runPosition += run.count
		}
		const before = out.length
		// Consecutive untouched fields go out as one verbatim copy, delimiters included
		let copyStart = -1
		let copyEnd = 0
		let copiedKey = -2
		const flush = () => {
			if (copyStart >= 0) out.copy(copyStart * size, copyEnd * size)
			copyStart = -1
		}
		for (let p = 0; p <= extent; p++) {
			const key = columnKey(p)
			let value = cells?.get(key)
			let quoted = false
			if (key >= 0 && key < fields) {
				const original = fieldAt(key)
				const open = original.quoted && !original.closed
				if (!open && (value === undefined || value === fieldText(bytes, dialect.encoding, original, size))) {
					if (copyStart >= 0 && key === copiedKey + 1) {
						copyEnd = original.end
					} else {
						flush()
						if (p > 0) out.ascii(delimiter)
						copyStart = original.start
						copyEnd = original.end
					}
					copiedKey = key
					continue
				}
				quoted = original.quoted
				value ??= fieldText(bytes, dialect.encoding, original, size)
			}
			flush()
			if (p > 0) out.ascii(delimiter)
			if (value || quoted) writeValue(value ?? '', quoted, {row: position, column: p})
		}
		flush()
		endFields(out.length === before, breakStart * size, rowEnd * size, position === rowTotal - 1)
	}

	const newRow = (key: number, position: number) => {
		const cells = edits.cells.get(key)
		const extent = Math.max(width - 1, lastCellPosition(cells))
		const before = out.length
		for (let p = 0; p <= extent; p++) {
			if (p > 0) out.ascii(delimiter)
			const value = cells?.get(columnKey(p))
			if (value) writeValue(value, false, {row: position, column: p})
		}
		endFields(out.length === before, 0, 0, position === rowTotal - 1)
	}

	const {bomEnd, start} = preamble(u, dialect, s)
	const hadBom = bomEnd > 0
	if (target.encoding === dialect.encoding && target.bom === hadBom) {
		out.copy(0, start * size)
	} else {
		if (target.bom) out.bom()
		out.copy(bomEnd * size, start * size)
	}
	// A sep line at the very end of the file needs a break before any row
	if (start > bomEnd && u[start - 1] !== s.lf && u[start - 1] !== s.cr && rowTotal > 0) lineBreak()

	const rewrite = (row: number, position: number) =>
		!sameColumns || edits.cells.has(row) || (row === openRow && position < rowTotal - 1)
	let position = 0
	for (const run of edits.rows) {
		if (run.key < 0) {
			for (let i = 0; i < run.count; i++) newRow(run.key - i, position++)
			continue
		}
		for (let row = run.key, end = run.key + run.count; row < end; ) {
			if (rewrite(row, position)) {
				editRow(row++, position++)
				continue
			}
			let to = row + 1
			while (to < end && !rewrite(to, position + to - row)) to++
			position += to - row
			copyRows(row, to, position === rowTotal)
			row = to
		}
	}
	keepApart(u[starts[index.rowCount] / size] === s.lf)
	out.copy(starts[index.rowCount], bytes.length)
	return out.finish()
}
