// ZIP for document packages (OOXML, iWork) and the archives Files lists, on the
// platform's DecompressionStream/CompressionStream. Opening parses only the
// central directory; entries inflate on demand. Every byte of the archive is
// untrusted: offsets are bounds-checked, declared sizes are enforced while
// inflating, and limits cap what a hostile file can make us allocate.

export type ZipErrorCode = 'corrupt' | 'encrypted' | 'unsupported' | 'limits' | 'missing'

export class ZipError extends Error {
	readonly code: ZipErrorCode

	constructor(code: ZipErrorCode, message: string) {
		super(message)
		this.name = 'ZipError'
		this.code = code
	}
}

export type ZipLimits = {maxEntries: number; maxEntrySize: number; maxTotalSize: number; maxDirectorySize: number}
export type ZipEntry = {
	name: string
	size: number
	compressedSize: number
	method: number
	crc32: number
	// When it last changed, in ms since the epoch, or 0 when the archive doesn't say
	modified: number
}
// Reads [start, end) of an archive kept elsewhere: an HTTP Range request, say
export type ZipReader = (start: number, end: number) => Promise<Uint8Array>

// One entry can't usefully pass 512 MiB: that's about the longest string V8
// can build, so a bigger part could never be read as text anyway. A central
// directory takes about 100 B an entry, so 64 MiB holds far more than any
// real archive's.
const DEFAULT_LIMITS: ZipLimits = {
	maxEntries: 50_000,
	maxEntrySize: 2 ** 29,
	maxTotalSize: 2 ** 32,
	maxDirectorySize: 2 ** 26,
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_DIRECTORY = 0x06054b50
const ZIP64_END_OF_DIRECTORY = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const DATA_DESCRIPTOR = 0x08074b50
const ZIP64_EXTRA = 0x0001
const TIMESTAMP_EXTRA = 0x5455
const FLAG_ENCRYPTED = 0x1
const FLAG_DESCRIPTOR = 0x8
const FLAG_UTF8 = 0x800
const MAX16 = 0xffff
const MAX32 = 0xffffffff

type EntryRecord = {
	entry: Readonly<ZipEntry>
	flags: number
	localOffset: number
	// The central directory record, [start, end) of the source
	start: number
	end: number
	// Where the 64-bit local header offset sits inside the zip64 extra, or -1 when it's the 32-bit field
	offsetSlot: number
}

type ArchiveState = {
	// The archive from `base` on: all of it, or for one read piecewise, its end
	bytes: Uint8Array
	base: number
	view: DataView
	records: EntryRecord[]
	byName: Map<string, EntryRecord>
	limits: ZipLimits
	comment: Uint8Array
	// Reads the entries that aren't in `bytes`
	read?: ZipReader
}

// patchZip needs the parsed records without making them part of the public shape
const states = new WeakMap<ZipArchive, ArchiveState>()
const stateOf = (archive: ZipArchive) => states.get(archive)!

const corrupt = (message: string) => new ZipError('corrupt', message)

export class ZipArchive {
	readonly entries: readonly ZipEntry[]

	private constructor(state: ArchiveState) {
		this.entries = Object.freeze(state.records.map((record) => record.entry))
		states.set(this, state)
	}

	// Keeps a reference to `bytes`, which must not change while the archive is in use
	static open(bytes: Uint8Array, limits?: Partial<ZipLimits>): ZipArchive {
		return ZipArchive.from(bytes, 0, {...DEFAULT_LIMITS, ...limits})
	}

	// An archive too big to fetch whole, read piece by piece: its end now (where its central directory is, read
	// further back if it starts before that), and an entry's own bytes when they're asked for. It can't be patched.
	static async read(size: number, read: ZipReader, limits?: Partial<ZipLimits>): Promise<ZipArchive> {
		if (size < 22) throw corrupt('Not a zip archive')
		const resolved = {...DEFAULT_LIMITS, ...limits}
		// Enough to hold the end record with the longest comment it can have
		let base = Math.max(0, size - 22 - MAX16)
		let bytes = await read(base, size)
		// Too many entries, or a directory too big or out of bounds, are refused here, before fetching a directory
		// that could be most of the file
		const {offset} = directoryOf(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), base, resolved)
		if (offset < 0) {
			const whole = new Uint8Array(bytes.length - offset)
			whole.set(await read(base + offset, base))
			whole.set(bytes, -offset)
			bytes = whole
			base += offset
		}
		return ZipArchive.from(bytes, base, resolved, read)
	}

	// `bytes` holds the archive from `base` on
	private static from(bytes: Uint8Array, base: number, limits: ZipLimits, read?: ZipReader): ZipArchive {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const {
			eocd,
			count,
			size: directorySize,
			offset: directoryOffset,
			limit: directoryLimit,
		} = directoryOf(view, base, limits)
		const directoryEnd = directoryOffset + directorySize
		if (directoryOffset < 0 || directoryEnd > directoryLimit) throw corrupt('Central directory is out of bounds')

		const records: EntryRecord[] = []
		const byName = new Map<string, EntryRecord>()
		let total = 0
		for (let p = directoryOffset, i = 0; i < count; i++) {
			if (p + 46 > directoryEnd || view.getUint32(p, true) !== CENTRAL_HEADER) {
				throw corrupt('Malformed central directory')
			}
			const flags = view.getUint16(p + 8, true)
			const nameStart = p + 46
			const extraStart = nameStart + view.getUint16(p + 28, true)
			const extraEnd = extraStart + view.getUint16(p + 30, true)
			const end = extraEnd + view.getUint16(p + 32, true)
			if (end > directoryEnd) throw corrupt('Malformed central directory')
			let compressedSize = view.getUint32(p + 20, true)
			let size = view.getUint32(p + 24, true)
			let localOffset = view.getUint32(p + 42, true)
			let offsetSlot = -1
			if (size === MAX32 || compressedSize === MAX32 || localOffset === MAX32) {
				// The zip64 extra carries only the saturated fields, in this order
				const field = findExtra(view, extraStart, extraEnd, ZIP64_EXTRA)
				const fieldEnd = field < 0 ? -1 : field + 4 + view.getUint16(field + 2, true)
				let q = field + 4
				const next = () => {
					if (q + 8 > fieldEnd) throw corrupt('Malformed zip64 extra field')
					q += 8
					return getUint64(view, q - 8)
				}
				if (size === MAX32) size = next()
				if (compressedSize === MAX32) compressedSize = next()
				if (localOffset === MAX32) {
					offsetSlot = q
					localOffset = next()
				}
			}
			const name = decodeName(bytes.subarray(nameStart, extraStart), flags)
			// Two entries with one name would let another reader see different content than we do (and patch)
			if (byName.has(name)) throw corrupt(`Duplicate entry ${name}`)
			// Declared sizes are enforced on inflate, so capping their sum caps the archive's total output
			total += size
			if (total > limits.maxTotalSize) throw new ZipError('limits', 'Archive expands beyond the size limit')
			const entry = Object.freeze({
				name,
				size,
				compressedSize,
				method: view.getUint16(p + 10, true),
				crc32: view.getUint32(p + 16, true),
				modified: modifiedOf(view, p, extraStart, extraEnd),
			})
			const record = {entry, flags, localOffset: localOffset - base, start: p, end, offsetSlot}
			records.push(record)
			byName.set(name, record)
			p = end
		}
		const comment = bytes.subarray(eocd + 22, eocd + 22 + view.getUint16(eocd + 20, true))
		return new ZipArchive({bytes, base, view, records, byName, limits, comment, read})
	}

	has(name: string): boolean {
		return stateOf(this).byName.has(name)
	}

	// What would stop bytes() reading an entry, as far as its directory record tells: the code it would fail with,
	// or undefined when it would try
	refusal(name: string): ZipErrorCode | undefined {
		const {byName, limits} = stateOf(this)
		const record = byName.get(name)
		return record ? refusalOf(record, limits)?.code : 'missing'
	}

	// A fresh buffer each call, owned by the caller (safe to transfer or wrap in a Blob)
	async bytes(name: string): Promise<Uint8Array<ArrayBuffer>> {
		const state = stateOf(this)
		const record = state.byName.get(name)
		if (!record) throw new ZipError('missing', `No entry named ${name}`)
		const refused = refusalOf(record, state.limits)
		if (refused) throw refused
		const {entry} = record
		const data = await compressed(state, record)
		let output: Uint8Array<ArrayBuffer>
		if (entry.method === 8) output = await inflate(data, entry.size)
		else if (data.length === entry.size) output = new Uint8Array(data)
		else throw corrupt(`${name} has inconsistent sizes`)
		if (crc32(output) !== entry.crc32) throw corrupt(`${name} failed its CRC check`)
		return output
	}

	async text(name: string): Promise<string> {
		const data = await this.bytes(name)
		// XML parts may be UTF-16 when they say so with a BOM; the decoder drops whichever BOM it finds
		const encoding =
			data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8'
		return new TextDecoder(encoding).decode(data)
	}
}

// Rebuilds the archive with `changes` applied (null deletes, unknown names are appended). Untouched entries are
// copied byte for byte in their original order, so everything we don't understand survives a save.
export async function patchZip(
	archive: ZipArchive,
	changes: ReadonlyMap<string, Uint8Array | string | null>,
): Promise<Uint8Array<ArrayBuffer>> {
	const {bytes, view, records, byName, comment} = stateOf(archive)
	const encoded = new Map<string, Encoded>()
	for (const [name, content] of changes) if (content !== null) encoded.set(name, await encode(content))

	const items: Array<{copy: EntryRecord; localEnd: number} | {header: Header; encoded: Encoded}> = []
	for (const record of records) {
		const replacement = encoded.get(record.entry.name)
		if (replacement) items.push({header: headerOf(bytes, view, record), encoded: replacement})
		else if (!changes.has(record.entry.name)) items.push({copy: record, localEnd: localEnd(view, record)})
	}
	for (const [name, replacement] of encoded) {
		if (!byName.has(name)) items.push({header: newHeader(name), encoded: replacement})
	}

	let length = 22 + comment.length
	for (const item of items) {
		if ('copy' in item) length += item.localEnd - item.copy.localOffset + item.copy.end - item.copy.start
		else length += 76 + 2 * item.header.name.length + item.header.comment.length + item.encoded.data.length
	}
	// Writing zip64 isn't supported: below these bounds every count, offset and size fits its classic field
	const oversized = items.some((item) => 'encoded' in item && item.encoded.size >= MAX32)
	if (oversized || items.length >= MAX16 || length >= MAX32) throw new ZipError('limits', 'Archive would need zip64')
	const out = new Uint8Array(length)
	const o = new DataView(out.buffer)

	let at = 0
	const offsets: number[] = []
	for (const item of items) {
		offsets.push(at)
		if ('copy' in item) {
			out.set(bytes.subarray(item.copy.localOffset, item.localEnd), at)
			at += item.localEnd - item.copy.localOffset
			continue
		}
		// Fields not written stay zero: no extra field, no disk number
		const {header, encoded} = item
		o.setUint32(at, LOCAL_HEADER, true)
		writeCommonFields(o, at + 4, header, encoded)
		out.set(header.name, at + 30)
		out.set(encoded.data, at + 30 + header.name.length)
		at += 30 + header.name.length + encoded.data.length
	}

	const directoryOffset = at
	items.forEach((item, i) => {
		if ('copy' in item) {
			const {start, end, offsetSlot} = item.copy
			out.set(bytes.subarray(start, end), at)
			// The record is verbatim except where its entry now starts
			if (offsetSlot < 0) o.setUint32(at + 42, offsets[i], true)
			else setUint64(o, at + offsetSlot - start, offsets[i])
			at += end - start
			return
		}
		const {header, encoded} = item
		o.setUint32(at, CENTRAL_HEADER, true)
		o.setUint16(at + 4, header.versionMadeBy, true)
		writeCommonFields(o, at + 6, header, encoded)
		o.setUint16(at + 32, header.comment.length, true)
		o.setUint16(at + 36, header.internal, true)
		o.setUint32(at + 38, header.external, true)
		o.setUint32(at + 42, offsets[i], true)
		out.set(header.name, at + 46)
		out.set(header.comment, at + 46 + header.name.length)
		at += 46 + header.name.length + header.comment.length
	})

	o.setUint32(at, END_OF_DIRECTORY, true)
	o.setUint16(at + 8, items.length, true)
	o.setUint16(at + 10, items.length, true)
	o.setUint32(at + 12, at - directoryOffset, true)
	o.setUint32(at + 16, directoryOffset, true)
	o.setUint16(at + 20, comment.length, true)
	out.set(comment, at + 22)
	return out
}

// CRC-32 (IEEE 802.3), sliced by eight so verifying an entry costs a fraction of inflating it. Pass a previous
// result as `crc` to continue over more bytes.
export function crc32(bytes: Uint8Array, crc = 0): number {
	const t = CRC_TABLE
	let c = ~crc
	let i = 0
	for (const end = bytes.length - (bytes.length % 8); i < end; i += 8) {
		c ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)
		c =
			t[1792 + (c & 0xff)] ^
			t[1536 + ((c >>> 8) & 0xff)] ^
			t[1280 + ((c >>> 16) & 0xff)] ^
			t[1024 + (c >>> 24)] ^
			t[768 + bytes[i + 4]] ^
			t[512 + bytes[i + 5]] ^
			t[256 + bytes[i + 6]] ^
			t[bytes[i + 7]]
	}
	for (; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
	return ~c >>> 0
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256 * 8)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c
	}
	for (let i = 256; i < table.length; i++) table[i] = (table[i - 256] >>> 8) ^ table[table[i - 256] & 0xff]
	return table
})()

const getUint64 = (view: DataView, at: number) => view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32

const setUint64 = (view: DataView, at: number, value: number) => {
	view.setUint32(at, value % 2 ** 32, true)
	view.setUint32(at + 4, Math.floor(value / 2 ** 32), true)
}

// The end record sits in the last 64 KiB + 22 bytes, followed by its comment. The comment could itself contain the
// signature, so a candidate whose comment ends exactly at the end of the file wins; trailing junk is tolerated.
function findEndOfDirectory(view: DataView): number {
	let fallback = -1
	for (let p = view.byteLength - 22, stop = Math.max(0, p - MAX16); p >= stop; p--) {
		if (view.getUint32(p, true) !== END_OF_DIRECTORY) continue
		const end = p + 22 + view.getUint16(p + 20, true)
		if (end === view.byteLength) return p
		if (end < view.byteLength && fallback < 0) fallback = p
	}
	if (fallback < 0) throw corrupt('Not a zip archive')
	return fallback
}

// Where the central directory is (in `view`, which holds the archive from `base` on), how many entries it lists, and
// where it must end by: from the end record, or the zip64 end record when the end record's fields are saturated
function directoryOf(view: DataView, base: number, {maxEntries, maxDirectorySize}: ZipLimits) {
	const eocd = findEndOfDirectory(view)
	let count = view.getUint16(eocd + 10, true)
	let size = view.getUint32(eocd + 12, true)
	let offset = view.getUint32(eocd + 16, true)
	let limit = eocd
	if (count === MAX16 || size === MAX32 || offset === MAX32) {
		const locator = eocd - 20
		if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) throw corrupt('Missing zip64 locator')
		const record = getUint64(view, locator + 8) - base
		if (record < 0 || record + 56 > locator || view.getUint32(record, true) !== ZIP64_END_OF_DIRECTORY) {
			throw corrupt('Missing zip64 end of central directory')
		}
		count = getUint64(view, record + 32)
		size = getUint64(view, record + 40)
		offset = getUint64(view, record + 48)
		limit = record
	}
	if (count > maxEntries) throw new ZipError('limits', `Archive has ${count} entries`)
	if (size > maxDirectorySize) throw new ZipError('limits', `Central directory is ${size} bytes`)
	if (offset - base + size > limit) throw corrupt('Central directory is out of bounds')
	return {eocd, count, size, offset: offset - base, limit}
}

// When an entry last changed: the extended timestamp's UTC seconds, where the writer added one (Info-ZIP and macOS
// do), else the MS-DOS date and time, which carry no time zone and are read as local, as unzip reads them
function modifiedOf(view: DataView, p: number, extraStart: number, extraEnd: number): number {
	const stamp = findExtra(view, extraStart, extraEnd, TIMESTAMP_EXTRA)
	// Its first byte says which times follow; in the central directory, only the modification time can
	if (stamp >= 0 && view.getUint16(stamp + 2, true) >= 5 && view.getUint8(stamp + 4) & 1) {
		return view.getInt32(stamp + 5, true) * 1000
	}
	const time = view.getUint16(p + 12, true)
	const date = view.getUint16(p + 14, true)
	if (!date) return 0
	const [year, month, day] = [1980 + (date >>> 9), ((date >>> 5) & 15) - 1, date & 31]
	return new Date(year, month, day, time >>> 11, (time >>> 5) & 63, (time & 31) * 2).getTime()
}

// Why an entry can't be read, as far as its directory record tells
function refusalOf({entry, flags}: EntryRecord, limits: ZipLimits): ZipError | undefined {
	const {name, method, size, compressedSize} = entry
	if (flags & FLAG_ENCRYPTED) return new ZipError('encrypted', `${name} is encrypted`)
	if (method !== 0 && method !== 8) return new ZipError('unsupported', `${name} uses compression method ${method}`)
	// Its stored bytes are read whole before inflating, so they're capped as its output is
	if (size > limits.maxEntrySize || compressedSize > limits.maxEntrySize) {
		return new ZipError('limits', `${name} is too large`)
	}
	if (method === 0 && compressedSize !== size) return corrupt(`${name} is stored at a size it doesn't have`)
	// Deflate can't expand beyond 1032:1, so a bigger claim is a lie we refuse before allocating for it
	if (method === 8 && size > entry.compressedSize * 1032) return corrupt(`${name} claims an impossible size`)
	return undefined
}

// Offset of the extra field with this id within [start, end), or -1
function findExtra(view: DataView, start: number, end: number, id: number): number {
	for (let p = start; p + 4 <= end; ) {
		const next = p + 4 + view.getUint16(p + 2, true)
		if (next > end) return -1
		if (view.getUint16(p, true) === id) return p
		p = next
	}
	return -1
}

const CP437 =
	'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'
const utf8 = new TextDecoder('utf-8', {ignoreBOM: true})
const strictUtf8 = new TextDecoder('utf-8', {ignoreBOM: true, fatal: true})

// Names are UTF-8 when the writer says so (flag bit 11), otherwise the format's original code page, CP437, unless
// they read as UTF-8 anyway: macOS (Finder and its zip alike) writes UTF-8 names without the flag, unar (which Files
// extracts with) reads them as UTF-8 too, and a CP437 name that happens to be valid UTF-8 is implausible.
function decodeName(raw: Uint8Array, flags: number): string {
	if (flags & FLAG_UTF8) return utf8.decode(raw)
	try {
		return strictUtf8.decode(raw)
	} catch {
		return Array.from(raw, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80])).join('')
	}
}

function dataStart(view: DataView, localOffset: number): number {
	if (localOffset < 0 || localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_HEADER) {
		throw corrupt('Malformed local header')
	}
	return localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
}

// An entry's compressed bytes: from those in hand, or, for an archive read piecewise, read when they aren't among
// them (its local header first, for the length of the name and extra field before the data)
async function compressed({bytes, view, base, read}: ArchiveState, {entry, localOffset}: EntryRecord) {
	let data: Uint8Array
	if (read && localOffset < 0) {
		const header = await read(base + localOffset, base + localOffset + 30)
		const start = base + localOffset + dataStart(new DataView(header.buffer, header.byteOffset, header.byteLength), 0)
		// An empty entry has nothing to read, and an empty range is no range at all
		data = entry.compressedSize ? await read(start, start + entry.compressedSize) : new Uint8Array(0)
	} else {
		const start = dataStart(view, localOffset)
		data = bytes.subarray(start, start + entry.compressedSize)
	}
	if (data.length !== entry.compressedSize) throw corrupt(`${entry.name} is truncated`)
	return data
}

// End of the entry's local record: header, data, then the data descriptor when flag bit 3 says one follows. The
// descriptor's signature is optional and its sizes are 64-bit for zip64 entries, so its length is read off its
// contents, which must agree with the central directory.
function localEnd(view: DataView, record: EntryRecord): number {
	const {entry, flags, localOffset} = record
	const dataEnd = dataStart(view, localOffset) + entry.compressedSize
	if (dataEnd > view.byteLength) throw corrupt(`${entry.name} is truncated`)
	if (!(flags & FLAG_DESCRIPTOR)) return dataEnd
	const at = (offset: number, width: number) =>
		offset + width > view.byteLength ? -1 : width === 4 ? view.getUint32(offset, true) : getUint64(view, offset)
	const signed = at(dataEnd, 4) === DATA_DESCRIPTOR && at(dataEnd + 4, 4) === entry.crc32
	const p = signed ? dataEnd + 4 : dataEnd
	const extraStart = localOffset + 30 + view.getUint16(localOffset + 26, true)
	const wide =
		entry.size >= MAX32 ||
		entry.compressedSize >= MAX32 ||
		findExtra(view, extraStart, extraStart + view.getUint16(localOffset + 28, true), ZIP64_EXTRA) >= 0
	if (at(p, 4) === entry.crc32) {
		for (const width of wide ? [8, 4] : [4, 8]) {
			if (at(p + 4, width) === entry.compressedSize && at(p + 4 + width, width) === entry.size) return p + 4 + 2 * width
		}
	}
	throw corrupt(`${entry.name} has a malformed data descriptor`)
}

// Browsers inflate a whole written chunk eagerly, so one big write would queue its entire output (or a zip bomb's)
// before we could look at it. Feeding small slices, each only after the previous one's output has been read, keeps
// memory to the declared size plus one slice's worth.
const INFLATE_SLICE = 64 * 1024

async function inflate(data: Uint8Array, size: number): Promise<Uint8Array<ArrayBuffer>> {
	let output: Uint8Array<ArrayBuffer>
	try {
		output = new Uint8Array(size)
	} catch {
		throw new ZipError('limits', 'Not enough memory to inflate the entry')
	}
	if (size === 0) return output
	const stream = deflateStream(() => new DecompressionStream('deflate-raw'))
	const writer = stream.writable.getWriter()
	const reader = stream.readable.getReader()
	const feed = async () => {
		for (let i = 0; i < data.length; i += INFLATE_SLICE) {
			// Never a SharedArrayBuffer here: those need a cross-origin isolated page
			await writer.write(data.subarray(i, i + INFLATE_SLICE) as Uint8Array<ArrayBuffer>)
		}
		await writer.close()
	}
	// Its failures surface through the reader as well
	feed().catch(() => {})
	let offset = 0
	try {
		for (;;) {
			const {done, value} = await reader.read()
			if (done) break
			if (value.length > size - offset) throw corrupt('Entry inflates beyond its declared size')
			output.set(value, offset)
			offset += value.length
		}
	} catch (error) {
		reader.cancel().catch(() => {})
		throw error instanceof ZipError ? error : corrupt('Invalid compressed data')
	}
	if (offset !== size) throw corrupt('Entry inflates short of its declared size')
	return output
}

// Safari before 16.4 has no 'deflate-raw': say so instead of calling the file corrupt
function deflateStream<T>(create: () => T): T {
	try {
		return create()
	} catch {
		throw new ZipError('unsupported', 'This browser cannot read or write deflate data')
	}
}

type Encoded = {data: Uint8Array; method: number; crc: number; size: number}

async function encode(content: Uint8Array | string): Promise<Encoded> {
	const raw = typeof content === 'string' ? new TextEncoder().encode(content) : content
	const stream = deflateStream(() => new CompressionStream('deflate-raw'))
	const writer = stream.writable.getWriter()
	writer.write(raw as Uint8Array<ArrayBuffer>).catch(() => {})
	writer.close().catch(() => {})
	const deflated = new Uint8Array(await new Response(stream.readable).arrayBuffer())
	// Already-compressed content (images, media) can grow under deflate, so it's stored as is
	const stored = deflated.length >= raw.length
	return {data: stored ? raw : deflated, method: stored ? 0 : 8, crc: crc32(raw), size: raw.length}
}

type Header = {
	versionMadeBy: number
	flags: number
	time: number
	date: number
	internal: number
	external: number
	name: Uint8Array
	comment: Uint8Array
}

// A replaced entry keeps its name bytes, timestamp, comment and attributes; only its data and sizes change
function headerOf(bytes: Uint8Array, view: DataView, {start: p, end, flags}: EntryRecord): Header {
	return {
		versionMadeBy: view.getUint16(p + 4, true),
		flags: flags & FLAG_UTF8,
		time: view.getUint16(p + 12, true),
		date: view.getUint16(p + 14, true),
		internal: view.getUint16(p + 36, true),
		external: view.getUint32(p + 38, true),
		name: bytes.subarray(p + 46, p + 46 + view.getUint16(p + 28, true)),
		comment: bytes.subarray(end - view.getUint16(p + 32, true), end),
	}
}

// New entries get 1980-01-01 00:00, the timestamp Office writes on every part
function newHeader(name: string): Header {
	const encoded = new TextEncoder().encode(name)
	return {
		versionMadeBy: 20,
		flags: encoded.length === name.length ? 0 : FLAG_UTF8,
		time: 0,
		date: 0x21,
		internal: 0,
		external: 0,
		name: encoded,
		comment: new Uint8Array(0),
	}
}

// The run shared by local and central headers: version needed through name length
function writeCommonFields(o: DataView, at: number, header: Header, encoded: Encoded) {
	o.setUint16(at, 20, true)
	o.setUint16(at + 2, header.flags, true)
	o.setUint16(at + 4, encoded.method, true)
	o.setUint16(at + 6, header.time, true)
	o.setUint16(at + 8, header.date, true)
	o.setUint32(at + 10, encoded.crc, true)
	o.setUint32(at + 14, encoded.data.length, true)
	o.setUint32(at + 18, encoded.size, true)
	o.setUint16(at + 22, header.name.length, true)
}
