// Code-unit scanning shared by the CSV reader and writer. A file is scanned in
// its own code units (bytes for UTF-8 and windows-1252, 16-bit units for
// UTF-16) because every character CSV syntax uses is ASCII, and ASCII never
// appears inside a UTF-8 sequence or as half of a UTF-16 unit. Only the cells
// on screen are ever decoded.

import type {CsvDialect, CsvEncoding} from './csv'

export type Units = Uint8Array | Uint16Array

// Syntax characters as they compare against `Units`. A 16-bit view reads units
// in platform byte order, so the other order sees ASCII in the high byte.
export type Syntax = {delimiter: number; quote: number; cr: number; lf: number; swapped: boolean}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export function unitsOf(bytes: Uint8Array, encoding: CsvEncoding): Units {
	if (encoding !== 'utf-16le' && encoding !== 'utf-16be') return bytes
	// A 16-bit view needs an even offset; fetched buffers always start at 0
	const aligned = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice()
	return new Uint16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 2))
}

export function syntaxOf(encoding: CsvEncoding, delimiter: string, quote: string | null): Syntax {
	const swapped = encoding === (LITTLE_ENDIAN ? 'utf-16be' : 'utf-16le')
	const code = (char: string) => (swapped ? char.charCodeAt(0) << 8 : char.charCodeAt(0))
	return {delimiter: code(delimiter), quote: quote === null ? -1 : code(quote), cr: code('\r'), lf: code('\n'), swapped}
}

// The ASCII character at `i`, or -1
function asciiAt(u: Units, i: number, s: Syntax): number {
	const unit = u[i]
	if (s.swapped) return (unit & 0xff) === 0 ? unit >> 8 : -1
	return unit < 0x80 ? unit : -1
}

export function bomLength(u: Units, encoding: CsvEncoding, s: Syntax): number {
	if (encoding === 'utf-8') return u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf ? 3 : 0
	if (encoding === 'windows-1252') return 0
	return u.length > 0 && u[0] === (s.swapped ? 0xfffe : 0xfeff) ? 1 : 0
}

export type SepLine = {delimiter: CsvDialect['delimiter']; end: number; lineEnding: CsvDialect['lineEnding'] | null}

// Excel's delimiter hint: a first line of exactly `sep=X`
export function parseSepLine(u: Units, i: number, s: Syntax): SepLine | null {
	if (i + 5 > u.length) return null
	const lower = (offset: number) => asciiAt(u, i + offset, s) | 0x20
	if (lower(0) !== 0x73 || lower(1) !== 0x65 || lower(2) !== 0x70 || asciiAt(u, i + 3, s) !== 0x3d) return null
	const delimiter = String.fromCharCode(asciiAt(u, i + 4, s))
	if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t' && delimiter !== '|') return null
	let end = i + 5
	let lineEnding: SepLine['lineEnding'] = null
	if (end < u.length) {
		if (u[end] === s.lf) {
			lineEnding = '\n'
			end++
		} else if (u[end] !== s.cr) {
			return null
		} else if (end + 1 < u.length && u[end + 1] === s.lf) {
			lineEnding = '\r\n'
			end += 2
		} else {
			lineEnding = '\r'
			end++
		}
	}
	return {delimiter, end, lineEnding}
}

// Where the rows start: past the BOM and the sep line, when the bytes really have them
export function preamble(u: Units, dialect: CsvDialect, s: Syntax): {bomEnd: number; start: number} {
	const bomEnd = dialect.bom ? bomLength(u, dialect.encoding, s) : 0
	const sep = dialect.sepLine ? parseSepLine(u, bomEnd, s) : null
	return {bomEnd, start: sep ? sep.end : bomEnd}
}

// One field, in units. A quoted field keeps its raw form: content runs from
// start + 1 to the closing quote (with quotes doubled), and anything between
// that quote and the delimiter is literal text, the way Excel reads `"a"b`.
export type Field = {
	start: number
	end: number
	quoted: boolean
	closed: boolean
	contentEnd: number
	next: number // where the following field, or row, starts
	last: boolean // the row ends after this field
	terminator: number // units of the line break that ended the row, 0 at the end of input
}

export const field = (): Field => ({
	start: 0,
	end: 0,
	quoted: false,
	closed: false,
	contentEnd: 0,
	next: 0,
	last: false,
	terminator: 0,
})

// A quote opens a quoted field only as its first character; CR, LF and CRLF
// all end a row. indexCsv inlines the same rules for speed.
export function scanField(u: Units, i: number, end: number, s: Syntax, f: Field): void {
	f.start = i
	f.quoted = i < end && u[i] === s.quote
	f.closed = false
	if (f.quoted) {
		for (i++; ; i += 2) {
			while (i < end && u[i] !== s.quote) i++
			if (i + 1 >= end || u[i + 1] !== s.quote) break
		}
		f.contentEnd = i
		if (i < end) {
			f.closed = true
			i++
		}
	}
	while (i < end) {
		const unit = u[i]
		if (unit === s.delimiter || unit === s.lf || unit === s.cr) break
		i++
	}
	f.end = i
	if (!f.quoted) f.contentEnd = i
	f.terminator = 0
	f.last = i === end || u[i] !== s.delimiter
	if (!f.last) f.next = i + 1
	else if (i === end) f.next = end
	else {
		f.terminator = u[i] === s.cr && i + 1 < end && u[i + 1] === s.lf ? 2 : 1
		f.next = i + f.terminator
	}
}

// windows-1252 is decoded here rather than by TextDecoder: Node 22 decodes the
// label as ISO-8859-1, which disagrees with browsers on 0x80–0x9F. The five
// bytes the code page leaves undefined map to the C1 controls, as in WHATWG.
export const WINDOWS_1252_HIGH = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ'

const HIGH_UNITS = Uint16Array.from(WINDOWS_1252_HIGH, (char) => char.charCodeAt(0))
const chunk = new Uint16Array(8192)

function decodeWindows1252(bytes: Uint8Array, start: number, end: number): string {
	let text = ''
	for (let i = start; i < end; i += chunk.length) {
		const length = Math.min(chunk.length, end - i)
		for (let k = 0; k < length; k++) {
			const byte = bytes[i + k]
			chunk[k] = byte >= 0x80 && byte < 0xa0 ? HIGH_UNITS[byte - 0x80] : byte
		}
		text += String.fromCharCode.apply(null, chunk.subarray(0, length) as unknown as number[])
	}
	return text
}

const decoders = new Map<CsvEncoding, TextDecoder>()

// Decodes bytes [start, end). A BOM inside the range is text, never stripped,
// so unit offsets keep lining up.
function decode(bytes: Uint8Array, encoding: CsvEncoding, start: number, end: number): string {
	if (start >= end) return ''
	if (encoding === 'windows-1252') return decodeWindows1252(bytes, start, end)
	let decoder = decoders.get(encoding)
	if (!decoder) {
		decoder = new TextDecoder(encoding, {ignoreBOM: true})
		decoders.set(encoding, decoder)
	}
	return decoder.decode(bytes.subarray(start, end))
}

const DECODE_CHUNK = 1 << 20

// Like decode, in pieces, so transcoding a whole file never holds it as one string
export function decodeChunks(
	bytes: Uint8Array,
	encoding: CsvEncoding,
	start: number,
	end: number,
	onText: (text: string) => void,
): void {
	if (end - start <= DECODE_CHUNK || encoding === 'windows-1252') {
		for (let i = start; i < end; i += DECODE_CHUNK) onText(decode(bytes, encoding, i, Math.min(end, i + DECODE_CHUNK)))
		return
	}
	// Streaming carries a sequence split across pieces over to the next one
	const decoder = new TextDecoder(encoding, {ignoreBOM: true})
	for (let i = start; i < end; i += DECODE_CHUNK) {
		const pieceEnd = Math.min(end, i + DECODE_CHUNK)
		onText(decoder.decode(bytes.subarray(i, pieceEnd), {stream: pieceEnd < end}))
	}
}

// A field's text: quotes stripped and doubled quotes undone inside the quoted part
export function fieldText(bytes: Uint8Array, encoding: CsvEncoding, f: Field, size: number): string {
	if (!f.quoted) return decode(bytes, encoding, f.start * size, f.end * size)
	const text = decode(bytes, encoding, (f.start + 1) * size, f.contentEnd * size).replaceAll('""', '"')
	return f.closed && f.contentEnd + 1 < f.end
		? text + decode(bytes, encoding, (f.contentEnd + 1) * size, f.end * size)
		: text
}
