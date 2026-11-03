// CSV for the sheet viewer: dialect sniffing, a one-pass row index over the raw
// bytes, and decoding of only the rows on screen, so a file of any size costs
// its own bytes plus 8 bytes a row. Pure functions without DOM, run from a
// module worker (csv.worker.ts). Parsing is lenient the way Excel's is: any
// byte sequence opens, and nothing in a cell is ever interpreted (`=SUM(…)` is
// just text).

import {
	bomLength,
	field,
	fieldText,
	parseSepLine,
	preamble,
	scanField,
	syntaxOf,
	unitsOf,
	type Syntax,
	type Units,
} from './scan'

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export type CsvDialect = {
	encoding: CsvEncoding
	bom: boolean
	delimiter: ',' | ';' | '\t' | '|'
	quote: '"' | null // null: quotes are plain text
	lineEnding: '\r\n' | '\n' | '\r' // for rows the editor adds; CR, LF and CRLF all end a row when reading
	sepLine: boolean // starts with Excel's `sep=X` line, which is kept but isn't a row
}

export type CsvIndex = {
	// rowCount + 1 byte offsets: row i spans [rowStarts[i], rowStarts[i + 1]),
	// line break included. rowStarts[0] skips the BOM and sep line; whatever
	// follows rowStarts[rowCount] (rows past MAX_ROWS) is saved untouched.
	rowStarts: Float64Array
	rowCount: number
	columnCount: number // the most fields in any row, at most MAX_COLUMNS
	truncated: boolean // rows past MAX_ROWS or fields past MAX_COLUMNS aren't shown
}

// Excel's sheet width. Wider rows still save with every field.
export const MAX_COLUMNS = 16_384
// Caps the index (8 bytes a row) for a file of nothing but line breaks
const MAX_ROWS = 2 ** 24

const SNIFF_BYTES = 64 * 1024
const SNIFF_ROWS = 50
const DELIMITERS: CsvDialect['delimiter'][] = [',', ';', '\t', '|']
const LINE_ENDINGS: CsvDialect['lineEnding'][] = ['\r\n', '\n', '\r']

// Pass the whole file when you have it. The dialect comes from the first 64 KB,
// and a shorter file is known to be complete, which sharpens the guess; a file
// that is ASCII for longer gets its encoding from where the ASCII ends.
export function sniffCsv(head: Uint8Array, nameHint = ''): CsvDialect {
	const sample = head.subarray(0, SNIFF_BYTES)
	const complete = head.length < SNIFF_BYTES
	const {encoding, bom} = sniffEncoding(sample, head)
	const u = unitsOf(sample, encoding)
	const s = syntaxOf(encoding, ',', '"')
	const bomEnd = bom ? bomLength(u, encoding, s) : 0
	const sep = parseSepLine(u, bomEnd, s)
	const start = sep ? sep.end : bomEnd
	const preferred: CsvDialect['delimiter'] = /\.(tsv|tab)$/i.test(nameHint) ? '\t' : ','
	const candidates = sep ? [sep.delimiter] : [preferred, ...DELIMITERS.filter((delimiter) => delimiter !== preferred)]
	// The delimiter that splits rows into the most consistent field counts wins; ties keep candidate order
	let best: Sample | undefined
	for (const delimiter of candidates) {
		const sampled = sampleDelimiter(u, start, encoding, delimiter, complete)
		if (!best || sampled.score > best.score) best = sampled
	}
	const {delimiter, quote, endings} = best!
	if (sep?.lineEnding) endings[sep.lineEnding]++
	const lineEnding = LINE_ENDINGS.reduce((winner, candidate) =>
		endings[candidate] > endings[winner] ? candidate : winner,
	)
	return {encoding, bom, delimiter, quote, lineEnding, sepLine: sep !== null}
}

function sniffEncoding(sample: Uint8Array, head: Uint8Array): {encoding: CsvEncoding; bom: boolean} {
	if (sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return {encoding: 'utf-8', bom: true}
	if (sample[0] === 0xff && sample[1] === 0xfe) return {encoding: 'utf-16le', bom: true}
	if (sample[0] === 0xfe && sample[1] === 0xff) return {encoding: 'utf-16be', bom: true}
	// Without a BOM, UTF-16 gives itself away with NULs: the high byte of every ASCII character
	let evenNuls = 0
	let oddNuls = 0
	for (let i = 0; i + 1 < sample.length; i += 2) {
		if (sample[i] === 0) evenNuls++
		if (sample[i + 1] === 0) oddNuls++
	}
	const units = sample.length >> 1
	if (oddNuls > evenNuls * 4 && oddNuls * 16 >= units) return {encoding: 'utf-16le', bom: false}
	if (evenNuls > oddNuls * 4 && evenNuls * 16 >= units) return {encoding: 'utf-16be', bom: false}
	// ASCII reads the same either way, so judge by the text from the first byte that isn't
	const first = firstNonAscii(head)
	return {encoding: isUtf8(head.subarray(first, first + SNIFF_BYTES)) ? 'utf-8' : 'windows-1252', bom: false}
}

function firstNonAscii(bytes: Uint8Array): number {
	let i = 0
	if (bytes.byteOffset % 4 === 0) {
		// Four bytes at a time while none has its high bit set
		const words = new Uint32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4))
		let word = 0
		while (word < words.length && (words[word] & 0x80808080) === 0) word++
		i = word * 4
	}
	while (i < bytes.length && bytes[i] < 0x80) i++
	return i
}

function isUtf8(bytes: Uint8Array): boolean {
	try {
		// Streaming, so a character cut off by the end of the sample isn't an error
		new TextDecoder('utf-8', {fatal: true}).decode(bytes, {stream: true})
		return true
	} catch {
		return false
	}
}

type Sample = {
	delimiter: CsvDialect['delimiter']
	quote: CsvDialect['quote']
	score: number
	endings: Record<CsvDialect['lineEnding'], number>
}

function sampleDelimiter(
	u: Units,
	start: number,
	encoding: CsvEncoding,
	delimiter: CsvDialect['delimiter'],
	complete: boolean,
): Sample {
	const quoted = sampleRows(u, start, syntaxOf(encoding, delimiter, '"'), complete)
	// Quotes that never close a field cleanly are plain text (a database's TSV
	// export, say). Reading them as CSV quotes would swallow the following rows.
	const plain = quoted.malformed > 0 && quoted.wellFormed === 0
	const rows = plain ? sampleRows(u, start, syntaxOf(encoding, delimiter, null), complete) : quoted
	return {delimiter, quote: plain ? null : '"', score: consistency(rows.counts), endings: rows.endings}
}

function sampleRows(u: Units, start: number, s: Syntax, complete: boolean) {
	const counts: number[] = []
	const endings = {'\r\n': 0, '\n': 0, '\r': 0}
	let wellFormed = 0
	let malformed = 0
	const f = field()
	for (let i = start; i < u.length && counts.length < SNIFF_ROWS; ) {
		const rowStart = i
		let fields = 0
		let good = 0
		let bad = 0
		do {
			scanField(u, i, u.length, s, f)
			fields++
			if (f.quoted && f.closed && f.contentEnd + 1 === f.end) good++
			else if (f.quoted && (f.closed || complete)) bad++
			i = f.next
		} while (!f.last)
		// A row cut short by the end of the sample proves nothing
		if (!f.terminator && !complete) break
		if (f.terminator) endings[f.terminator === 2 ? '\r\n' : u[f.end] === s.lf ? '\n' : '\r']++
		wellFormed += good
		malformed += bad
		// Blank lines split the same way whatever the delimiter
		if (fields > 1 || f.end > rowStart) counts.push(fields)
	}
	return {counts, endings, wellFormed, malformed}
}

// The share of rows with the most common field count; 0 when that count is 1
function consistency(counts: number[]): number {
	const frequency = new Map<number, number>()
	let mode = 0
	let modeFrequency = 0
	for (const count of counts) {
		const n = (frequency.get(count) ?? 0) + 1
		frequency.set(count, n)
		if (n > modeFrequency || (n === modeFrequency && count > mode)) {
			mode = count
			modeFrequency = n
		}
	}
	return mode < 2 ? 0 : modeFrequency / counts.length
}

const DELIMITER = 1
const QUOTE = 2
const CR = 3
const LF = 4

// One pass over the units, applying scanField's rules inline: this loop is the
// cost of opening a file, and a table lookup per unit is its hot path. Tests
// stop it sooner than MAX_ROWS, which takes a 16 MB file to reach.
export function indexCsv(bytes: Uint8Array, dialect: CsvDialect, maxRows = MAX_ROWS): CsvIndex {
	const u = unitsOf(bytes, dialect.encoding)
	const size = u.BYTES_PER_ELEMENT
	const s = syntaxOf(dialect.encoding, dialect.delimiter, dialect.quote)
	const {start} = preamble(u, dialect, s)
	const end = u.length
	const kinds = new Uint8Array(size === 1 ? 0x100 : 0x10000)
	kinds[s.delimiter] = DELIMITER
	kinds[s.cr] = CR
	kinds[s.lf] = LF
	if (s.quote >= 0) kinds[s.quote] = QUOTE

	let rowStarts = new Float64Array(Math.min(maxRows, 1023) + 1)
	rowStarts[0] = start * size
	let rowCount = 0
	let fields = 1
	let maxFields = 0
	let fieldStart = start
	let rowStart = start
	let truncated = false
	let i = start
	while (i < end) {
		const kind = kinds[u[i]]
		if (kind === DELIMITER) {
			fields++
			fieldStart = i + 1
		} else if (kind === QUOTE) {
			if (i === fieldStart) {
				// Skip to the closing quote: doubled quotes and line breaks are content
				for (i++; ; i += 2) {
					while (i < end && u[i] !== s.quote) i++
					if (i + 1 >= end || u[i + 1] !== s.quote) break
				}
				if (i >= end) break
			}
		} else if (kind !== 0) {
			if (kind === CR && i + 1 < end && u[i + 1] === s.lf) i++
			if (fields > maxFields) maxFields = fields
			if (++rowCount === rowStarts.length) rowStarts = grow(rowStarts, maxRows + 1)
			rowStarts[rowCount] = (i + 1) * size
			fields = 1
			fieldStart = rowStart = i + 1
			if (rowCount === maxRows) {
				truncated = i + 1 < end
				break
			}
		}
		i++
	}
	// The last row needs no line break, and a trailing one doesn't start another row
	if (!truncated && rowStart < end && rowCount < maxRows) {
		if (fields > maxFields) maxFields = fields
		if (++rowCount === rowStarts.length) rowStarts = grow(rowStarts, maxRows + 1)
		rowStarts[rowCount] = end * size
	}
	return {
		rowStarts: rowStarts.slice(0, rowCount + 1),
		rowCount,
		columnCount: Math.min(maxFields, MAX_COLUMNS),
		truncated: truncated || maxFields > MAX_COLUMNS,
	}
}

function grow(array: Float64Array<ArrayBuffer>, limit: number): Float64Array<ArrayBuffer> {
	const next = new Float64Array(Math.min(array.length * 2, limit))
	next.set(array)
	return next
}

// Rows [start, end) as text, ragged as in the file (a missing field is just
// absent). Only the fields in `columns` (default: the first columnCount) are
// decoded, and a row is scanned no further than that window.
export function readRows(
	bytes: Uint8Array,
	dialect: CsvDialect,
	index: CsvIndex,
	start: number,
	end: number,
	columns: {start: number; end: number} = {start: 0, end: index.columnCount},
): string[][] {
	const u = unitsOf(bytes, dialect.encoding)
	const size = u.BYTES_PER_ELEMENT
	const s = syntaxOf(dialect.encoding, dialect.delimiter, dialect.quote)
	const f = field()
	const rows: string[][] = []
	for (let row = Math.max(0, start); row < Math.min(end, index.rowCount); row++) {
		const rowEnd = index.rowStarts[row + 1] / size
		const cells: string[] = []
		let i = index.rowStarts[row] / size
		for (let column = 0; column < columns.end; column++) {
			scanField(u, i, rowEnd, s, f)
			if (column >= columns.start) cells.push(fieldText(bytes, dialect.encoding, f, size))
			if (f.last) break
			i = f.next
		}
		rows.push(cells)
	}
	return rows
}

// Numbers as people write them: signs, grouping (1,234.5 / 1.234,5 / 1 234),
// decimals, exponents, a currency symbol or percent, accounting parentheses
const CURRENCY = '[$€£¥₹₩₽₺₪₫฿¢]'
const NUMBER = String.raw`(?:(?:\d{1,3}(?:[,.'\u00a0\u202f ]\d{3})+|\d+)(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?`
const NUMERIC = new RegExp(
	String.raw`^\s*(?:[+-]?(?:${CURRENCY}\s?)?${NUMBER}(?:\s?(?:${CURRENCY}|%))?|\((?:${CURRENCY}\s?)?${NUMBER}\))\s*$`,
)

// Whether text reads as a number, for right-aligning it. Display only: the
// text itself is never converted or changed.
export function detectNumeric(text: string): boolean {
	return text.length <= 64 && NUMERIC.test(text)
}
