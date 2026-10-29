import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {basename, join} from 'node:path'
import {deflateRawSync, inflateRawSync, crc32 as referenceCrc32} from 'node:zlib'
import {describe, expect, test} from 'vitest'

import {crc32, patchZip, ZipArchive, ZipError, type ZipErrorCode} from './zip'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''

const MAX32 = 0xffffffff
const utf8 = new TextEncoder()
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
// Element-wise toEqual is far too slow for multi-megabyte parts
const same = (a: Uint8Array, b: Uint8Array) =>
	Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length))

// Archives are built byte by byte so each test controls exactly the structure it exercises; node:zlib is the
// independent oracle for deflate and CRC-32.
class Bytes {
	parts: Uint8Array[] = []
	length = 0
	push(...parts: Uint8Array[]) {
		for (const part of parts) {
			this.parts.push(part)
			this.length += part.length
		}
		return this
	}
	u16(value: number) {
		return this.push(le(value, 2))
	}
	u32(value: number) {
		return this.push(le(value, 4))
	}
	u64(value: number) {
		return this.push(le(value, 8))
	}
	bytes() {
		return concat(...this.parts)
	}
}

function le(value: number, width: number) {
	const out = new Uint8Array(width)
	for (let i = 0; i < width; i++) out[i] = Math.floor(value / 2 ** (8 * i)) % 256
	return out
}

function concat(...parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
	let at = 0
	for (const part of parts) {
		out.set(part, at)
		at += part.length
	}
	return out
}

const zip64Extra = (values: number[]) =>
	new Bytes()
		.u16(1)
		.u16(values.length * 8)
		.push(...values.map((v) => le(v, 8)))
		.bytes()

type Spec = {
	name: string
	data?: string | Uint8Array
	method?: number
	flags?: number
	rawName?: Uint8Array
	descriptor?: 'signed' | 'bare' | 'zip64'
	zip64?: boolean
	extra?: Uint8Array
	comment?: string
	// Lies and corruption: the bytes actually stored, a declared size, a declared CRC
	payload?: Uint8Array
	size?: number
	crc?: number
}

function buildZip(specs: Spec[], options: {comment?: string; zip64End?: boolean; trailing?: Uint8Array} = {}) {
	const out = new Bytes()
	const directory = new Bytes()
	for (const spec of specs) {
		const data = typeof spec.data === 'string' ? utf8.encode(spec.data) : (spec.data ?? new Uint8Array(0))
		const method = spec.method ?? 8
		const payload = spec.payload ?? (method === 8 ? new Uint8Array(deflateRawSync(data)) : data)
		const name = spec.rawName ?? utf8.encode(spec.name)
		const crc = spec.crc ?? referenceCrc32(data)
		const size = spec.size ?? data.length
		const flags = (spec.flags ?? 0) | (spec.descriptor ? 0x8 : 0)
		const wide = spec.zip64 === true || spec.descriptor === 'zip64'
		const extra = spec.extra ?? new Uint8Array(0)
		const comment = utf8.encode(spec.comment ?? '')
		const offset = out.length

		const localExtra = wide ? concat(zip64Extra(spec.descriptor ? [0, 0] : [size, payload.length]), extra) : extra
		out
			.u32(0x04034b50)
			.u16(wide ? 45 : 20)
			.u16(flags)
			.u16(method)
			.u16(0)
			.u16(0x21)
		if (spec.descriptor)
			out
				.u32(0)
				.u32(wide ? MAX32 : 0)
				.u32(wide ? MAX32 : 0)
		else
			out
				.u32(crc)
				.u32(wide ? MAX32 : payload.length)
				.u32(wide ? MAX32 : size)
		out.u16(name.length).u16(localExtra.length).push(name, localExtra, payload)
		if (spec.descriptor === 'signed') out.u32(0x08074b50).u32(crc).u32(payload.length).u32(size)
		if (spec.descriptor === 'bare') out.u32(crc).u32(payload.length).u32(size)
		if (spec.descriptor === 'zip64') out.u32(0x08074b50).u32(crc).u64(payload.length).u64(size)

		const centralExtra = wide ? concat(zip64Extra([size, payload.length, offset]), extra) : extra
		directory
			.u32(0x02014b50)
			.u16(0x0314)
			.u16(wide ? 45 : 20)
			.u16(flags)
			.u16(method)
			.u16(0x6000)
			.u16(0x5821)
		directory
			.u32(crc)
			.u32(wide ? MAX32 : payload.length)
			.u32(wide ? MAX32 : size)
		directory.u16(name.length).u16(centralExtra.length).u16(comment.length).u16(0).u16(1).u32(0x81a40000)
		directory.u32(wide ? MAX32 : offset).push(name, centralExtra, comment)
	}
	const directoryOffset = out.length
	out.push(directory.bytes())
	const comment = utf8.encode(options.comment ?? '')
	if (options.zip64End) {
		const record = out.length
		out.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0)
		out.u64(specs.length).u64(specs.length).u64(directory.length).u64(directoryOffset)
		out.u32(0x07064b50).u32(0).u64(record).u32(1)
		out.u32(0x06054b50).u16(0).u16(0).u16(0xffff).u16(0xffff).u32(MAX32).u32(MAX32)
	} else {
		out.u32(0x06054b50).u16(0).u16(0).u16(specs.length).u16(specs.length).u32(directory.length).u32(directoryOffset)
	}
	out.u16(comment.length).push(comment, options.trailing ?? new Uint8Array(0))
	return out.bytes()
}

// An independent read of a (classic, contiguous) archive: each entry's raw local record and its central record with
// the offset field zeroed, for byte comparisons across a patch
function rawRecords(zip: Uint8Array) {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
	let eocd = zip.length - 22
	while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
	const directoryOffset = view.getUint32(eocd + 16, true)
	const found: Array<{name: string; offset: number; central: Uint8Array}> = []
	for (let p = directoryOffset, i = 0; i < view.getUint16(eocd + 10, true); i++) {
		const end = p + 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
		const central = zip.slice(p, end)
		new DataView(central.buffer).setUint32(42, 0, true)
		found.push({
			name: decode(zip.subarray(p + 46, p + 46 + view.getUint16(p + 28, true))),
			offset: view.getUint32(p + 42, true),
			central,
		})
		p = end
	}
	const starts = found.map((entry) => entry.offset).sort((a, b) => a - b)
	return found.map(({name, offset, central}) => ({
		name,
		central,
		local: zip.subarray(offset, starts.find((start) => start > offset) ?? directoryOffset),
	}))
}

// Checks an archive without our reader: every local header agrees with the central directory and every entry
// inflates (with zlib) to its declared size and CRC
function validate(zip: Uint8Array) {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
	let eocd = zip.length - 22
	while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
	const count = view.getUint16(eocd + 10, true)
	let p = view.getUint32(eocd + 16, true)
	expect(p + view.getUint32(eocd + 12, true)).toBe(eocd)
	for (let i = 0; i < count; i++) {
		expect(view.getUint32(p, true)).toBe(0x02014b50)
		const [flags, method, crc, compressedSize, size] = [8, 10, 16, 20, 24].map((at) =>
			at >= 16 ? view.getUint32(p + at, true) : view.getUint16(p + at, true),
		)
		const nameLength = view.getUint16(p + 28, true)
		const offset = view.getUint32(p + 42, true)
		expect(view.getUint32(offset, true)).toBe(0x04034b50)
		expect(view.getUint16(offset + 26, true)).toBe(nameLength)
		expect(zip.subarray(offset + 30, offset + 30 + nameLength)).toEqual(zip.subarray(p + 46, p + 46 + nameLength))
		expect(view.getUint16(offset + 8, true)).toBe(method)
		if (!(flags & 8))
			expect([14, 18, 22].map((at) => view.getUint32(offset + at, true))).toEqual([crc, compressedSize, size])
		const start = offset + 30 + nameLength + view.getUint16(offset + 28, true)
		const data = zip.subarray(start, start + compressedSize)
		const content = method === 8 ? new Uint8Array(inflateRawSync(data)) : data
		expect(content.length).toBe(size)
		expect(referenceCrc32(content)).toBe(crc)
		p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
	}
}

function syncError(run: () => unknown): ZipErrorCode | 'none' {
	try {
		run()
	} catch (error) {
		if (error instanceof ZipError) return error.code
		throw error
	}
	return 'none'
}

async function asyncError(promise: Promise<unknown>): Promise<ZipErrorCode | 'none'> {
	try {
		await promise
	} catch (error) {
		if (error instanceof ZipError) return error.code
		throw error
	}
	return 'none'
}

// Deterministic randomness for fuzzing (mulberry32)
function seeded(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
	}
}

const sample = () =>
	buildZip([
		{name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>'},
		{name: 'word/document.xml', data: '<w:document>' + 'Hello, world. '.repeat(200) + '</w:document>'},
		{name: 'word/media/image1.bin', data: new Uint8Array(300).map((_, i) => (i * 7919) % 251), method: 0},
	])

describe('crc32', () => {
	test('matches the standard check values', () => {
		expect(crc32(new Uint8Array(0))).toBe(0)
		expect(crc32(utf8.encode('123456789'))).toBe(0xcbf43926)
		expect(crc32(utf8.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
	})

	test('agrees with zlib on every length around the eight-byte stride, and chains', () => {
		const random = seeded(7)
		const data = new Uint8Array(4096).map(() => Math.floor(random() * 256))
		for (let length = 0; length <= 70; length++)
			expect(crc32(data.subarray(0, length))).toBe(referenceCrc32(data.subarray(0, length)))
		expect(crc32(data)).toBe(referenceCrc32(data))
		expect(crc32(data.subarray(1000), crc32(data.subarray(0, 1000)))).toBe(crc32(data))
	})
})

describe('ZipArchive', () => {
	test('reads several entries at once', async () => {
		const archive = ZipArchive.open(sample())
		const texts = await Promise.all(archive.entries.map((entry) => archive.bytes(entry.name)))
		expect(texts.map((bytes) => bytes.length)).toEqual(archive.entries.map((entry) => entry.size))
	})

	test('lists entries and reads stored and deflated data', async () => {
		const archive = ZipArchive.open(sample())
		expect(archive.entries.map((entry) => entry.name)).toEqual([
			'[Content_Types].xml',
			'word/document.xml',
			'word/media/image1.bin',
		])
		const document = archive.entries[1]
		expect(document).toMatchObject({method: 8, size: 12 + 14 * 200 + 13})
		expect(document.compressedSize).toBeLessThan(document.size)
		expect(document.crc32).toBe(
			referenceCrc32(utf8.encode('<w:document>' + 'Hello, world. '.repeat(200) + '</w:document>')),
		)
		expect(await archive.text('word/document.xml')).toBe(
			'<w:document>' + 'Hello, world. '.repeat(200) + '</w:document>',
		)
		const image = await archive.bytes('word/media/image1.bin')
		expect(image).toEqual(new Uint8Array(300).map((_, i) => (i * 7919) % 251))
		expect(archive.has('word/document.xml')).toBe(true)
		expect(archive.has('word/Document.xml')).toBe(false)
	})

	test('hands out fresh buffers that never alias the archive', async () => {
		const zip = sample()
		const archive = ZipArchive.open(zip)
		const first = await archive.bytes('word/media/image1.bin')
		first.fill(0)
		expect(await archive.bytes('word/media/image1.bin')).toEqual(new Uint8Array(300).map((_, i) => (i * 7919) % 251))
		expect(Object.isFrozen(archive.entries) && Object.isFrozen(archive.entries[0])).toBe(true)
	})

	test('reads an archive that lives inside a larger buffer', async () => {
		const zip = sample()
		const padded = new Uint8Array(zip.length + 20)
		padded.set(zip, 10)
		const archive = ZipArchive.open(padded.subarray(10, 10 + zip.length))
		expect(await archive.text('[Content_Types].xml')).toBe('<?xml version="1.0"?><Types/>')
	})

	test('text strips a UTF-8 BOM and honours UTF-16 BOMs', async () => {
		const utf16 = (text: string, bigEndian: boolean) => {
			const out = new Uint8Array(2 + text.length * 2)
			const view = new DataView(out.buffer)
			view.setUint16(0, 0xfeff, !bigEndian)
			for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), !bigEndian)
			return out
		}
		const archive = ZipArchive.open(
			buildZip([
				{name: 'bom.xml', data: concat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8.encode('<a>é</a>'))},
				{name: 'le.xml', data: utf16('<a>ü</a>', false)},
				{name: 'be.xml', data: utf16('<a>ß</a>', true)},
				{name: 'bad.txt', data: new Uint8Array([0x61, 0xff, 0x62])},
			]),
		)
		expect(await archive.text('bom.xml')).toBe('<a>é</a>')
		expect(await archive.text('le.xml')).toBe('<a>ü</a>')
		expect(await archive.text('be.xml')).toBe('<a>ß</a>')
		expect(await archive.text('bad.txt')).toBe('a\ufffdb')
	})

	test('decodes names as UTF-8 when flag bit 11 says so or they read as UTF-8, otherwise as CP437', () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'flagged', rawName: utf8.encode('Résumé ✓.xml'), flags: 0x800},
				{name: 'dos', rawName: new Uint8Array([0x81, 0x62, 0xe1, 0x2e, 0x78, 0xff])},
				{name: 'macOS-style unflagged UTF-8', rawName: utf8.encode('Café/日本語.txt')},
				{name: 'flagged but not UTF-8', rawName: new Uint8Array([0x61, 0xff, 0x62]), flags: 0x800},
			]),
		)
		// Unflagged UTF-8 is what macOS's Finder and zip write, and unar (which Files extracts with) reads it so too
		expect(archive.entries.map((entry) => entry.name)).toEqual([
			'Résumé ✓.xml',
			'übß.x\u00a0',
			'Café/日本語.txt',
			'a\ufffdb',
		])
	})

	test('dates entries by their extended timestamp, else by their MS-DOS date and time, read as local', () => {
		const stamp = new Bytes()
			.u16(0x5455)
			.u16(5)
			.push(new Uint8Array([1]))
			.u32(1_700_000_000)
			.bytes()
		const zip = buildZip([
			{name: 'dos.txt', data: 'a'},
			{name: 'unix.txt', data: 'b', extra: stamp},
			// Its timestamp comes after the zip64 extra in the record
			{name: 'wide.txt', data: 'c', zip64: true, extra: stamp},
			{name: 'undated.txt', data: 'd'},
		])
		// The helper dates every entry 2024-01-01 12:00; the last one's date is zeroed, which is no date at all
		const records = rawRecords(zip)
		const last = zip.length - 22 - records[3].central.length
		new DataView(zip.buffer).setUint16(last + 14, 0, true)
		expect(ZipArchive.open(zip).entries.map((entry) => entry.modified)).toEqual([
			new Date(2024, 0, 1, 12).getTime(),
			1_700_000_000_000,
			1_700_000_000_000,
			0,
		])
	})

	test('says why an entry would be refused without reading it, exactly as reading it fails', async () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'locked.txt', data: 'secret', flags: 0x1},
				{name: 'a.bz2', data: 'x', method: 12, payload: utf8.encode('BZh')},
				{name: 'huge.txt', data: 'x', size: 2 ** 29 + 1},
				{name: 'liar.txt', data: 'tiny', size: 400 * 1024 * 1024},
				{name: 'fine.txt', data: 'fine'},
			]),
		)
		const refusals = archive.entries.map((entry) => archive.refusal(entry.name))
		expect(refusals).toEqual(['encrypted', 'unsupported', 'limits', 'corrupt', undefined])
		for (const [i, entry] of archive.entries.entries()) {
			expect(await asyncError(archive.bytes(entry.name)), entry.name).toBe(refusals[i] ?? 'none')
		}
		expect(archive.refusal('nope.txt')).toBe('missing')
	})

	test('reads entries followed by data descriptors, signed, bare and zip64', async () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'a.xml', data: '<a/>'.repeat(50), descriptor: 'signed'},
				{name: 'b.xml', data: '<b/>'.repeat(50), descriptor: 'bare'},
				{name: 'c.xml', data: '<c/>'.repeat(50), descriptor: 'zip64'},
				{name: 'd.bin', data: 'stored', method: 0, descriptor: 'signed'},
			]),
		)
		for (const [name, text] of [
			['a.xml', '<a/>'.repeat(50)],
			['b.xml', '<b/>'.repeat(50)],
			['c.xml', '<c/>'.repeat(50)],
			['d.bin', 'stored'],
		]) {
			expect(await archive.text(name)).toBe(text)
		}
	})

	test('reads zip64 end records and zip64 extra fields', async () => {
		const zip = buildZip(
			[
				{name: 'small.xml', data: '<small/>', zip64: true},
				{name: 'classic.xml', data: '<classic/>'},
				{
					name: 'streamed.xml',
					data: '<streamed/>'.repeat(9),
					descriptor: 'zip64',
					extra: new Uint8Array([0xca, 0xfe, 2, 0, 1, 2]),
				},
			],
			{zip64End: true, comment: 'zip64 archive'},
		)
		const archive = ZipArchive.open(zip)
		expect(archive.entries.map(({name, size}) => [name, size])).toEqual([
			['small.xml', 8],
			['classic.xml', 10],
			['streamed.xml', 99],
		])
		expect(await archive.text('small.xml')).toBe('<small/>')
		expect(await archive.text('streamed.xml')).toBe('<streamed/>'.repeat(9))
	})

	test('takes the real end record when the archive comment contains a fake one, and tolerates trailing junk', async () => {
		const decoy = new Bytes().u32(0x06054b50).u16(0).u16(0).u16(9).u16(9).u32(5).u32(0).u16(1).bytes()
		const zip = buildZip([{name: 'a.txt', data: 'real'}], {comment: decode(decoy) + ' and then some'})
		expect(await ZipArchive.open(zip).text('a.txt')).toBe('real')
		const junk = buildZip([{name: 'a.txt', data: 'junk after'}], {trailing: utf8.encode('\0'.repeat(100))})
		expect(await ZipArchive.open(junk).text('a.txt')).toBe('junk after')
	})

	test('opens empty archives and empty entries', async () => {
		expect(ZipArchive.open(buildZip([])).entries).toEqual([])
		const archive = ZipArchive.open(
			buildZip([
				{name: 'dir/', method: 0},
				{name: 'empty.xml', data: ''},
			]),
		)
		expect(await archive.bytes('dir/')).toEqual(new Uint8Array(0))
		expect(await archive.text('empty.xml')).toBe('')
	})
})

// An archive kept elsewhere, served range by range, with every range asked for noted
function remote(zip: Uint8Array) {
	const asked: Array<[number, number]> = []
	const read = async (start: number, end: number) => {
		asked.push([start, end])
		return zip.slice(start, end)
	}
	return {asked, read}
}

describe('ZipArchive.read', () => {
	// A Keynote deck's shape: its preview first, then a lot of media
	const preview = new Uint8Array(5000).map((_, i) => i % 256)
	const media = new Uint8Array(400_000).map((_, i) => (i * 31) % 251)
	const deck = () =>
		buildZip([
			{name: 'preview.jpg', data: preview, method: 0},
			{name: 'Index/Document.iwa', data: 'document'},
			...Array.from({length: 4}, (_, i) => ({name: `Data/movie-${i}.mov`, data: media, method: 0})),
		])

	test('reads an entry from far back with the end of the archive, its local header and its data alone', async () => {
		const zip = deck()
		const {asked, read} = remote(zip)
		const archive = await ZipArchive.read(zip.length, read)
		expect(archive.entries).toEqual(ZipArchive.open(zip).entries)
		expect(await archive.bytes('preview.jpg')).toEqual(preview)
		const data = 30 + 'preview.jpg'.length
		expect(asked).toEqual([
			[zip.length - 65557, zip.length],
			[0, 30],
			[data, data + 5000],
		])
	})

	test('reads what the end it holds already has without asking again: a small archive in one read', async () => {
		const zip = sample()
		const {asked, read} = remote(zip)
		const archive = await ZipArchive.read(zip.length, read)
		for (const entry of archive.entries)
			expect(await archive.bytes(entry.name)).toEqual(await ZipArchive.open(zip).bytes(entry.name))
		expect(asked).toEqual([[0, zip.length]])
	})

	test('reads the central directory from further back when it starts before the end read first', async () => {
		const names = Array.from({length: 900}, (_, i) => `Data/${'long-name-'.repeat(8)}${i}.bin`)
		const zip = buildZip(names.map((name) => ({name, data: name, method: 0})))
		const {asked, read} = remote(zip)
		const archive = await ZipArchive.read(zip.length, read)
		expect(archive.entries).toHaveLength(900)
		expect(await archive.text(names[0])).toBe(names[0])
		expect(asked[1][1]).toBe(zip.length - 65557)
		expect(asked[1][0]).toBeLessThan(asked[1][1])
	})

	test('refuses too many entries from the end record alone, before fetching their directory', async () => {
		const names = Array.from({length: 900}, (_, i) => `Data/${'long-name-'.repeat(8)}${i}.bin`)
		const zip = buildZip(names.map((name) => ({name, data: name, method: 0})))
		const {asked, read} = remote(zip)
		expect(await asyncError(ZipArchive.read(zip.length, read, {maxEntries: 899}))).toBe('limits')
		expect(asked).toEqual([[zip.length - 65557, zip.length]])
	})

	test('reads an empty entry from far back without asking for an empty range', async () => {
		const zip = buildZip([
			{name: 'empty.txt', method: 0},
			{name: 'media.bin', data: media, method: 0},
		])
		const {asked, read} = remote(zip)
		const archive = await ZipArchive.read(zip.length, read)
		expect(await archive.bytes('empty.txt')).toEqual(new Uint8Array(0))
		expect(asked.some(([start, end]) => start === end)).toBe(false)
	})

	test('refuses a central directory too big or out of bounds from the end record alone, before fetching it', async () => {
		const names = Array.from({length: 900}, (_, i) => `Data/${'long-name-'.repeat(8)}${i}.bin`)
		const zip = buildZip(names.map((name) => ({name, data: name, method: 0})))
		const tooBig = remote(zip)
		expect(await asyncError(ZipArchive.read(zip.length, tooBig.read, {maxDirectorySize: 1000}))).toBe('limits')
		expect(tooBig.asked).toHaveLength(1)

		// An end record whose directory would run past the record itself
		const lying = zip.slice()
		new DataView(lying.buffer).setUint32(lying.length - 22 + 12, lying.length, true)
		const outOfBounds = remote(lying)
		expect(await asyncError(ZipArchive.read(lying.length, outOfBounds.read))).toBe('corrupt')
		expect(outOfBounds.asked).toHaveLength(1)
	})

	test('reads zip64 archives', async () => {
		const zip = buildZip(
			[
				{name: 'small.xml', data: '<small/>', zip64: true},
				{name: 'classic.xml', data: '<classic/>'},
			],
			{zip64End: true},
		)
		const archive = await ZipArchive.read(zip.length, remote(zip).read)
		expect(await archive.text('small.xml')).toBe('<small/>')
		expect(await archive.text('classic.xml')).toBe('<classic/>')
	})

	test('a short read, a damaged entry and what is not a zip are corrupt', async () => {
		const zip = deck()
		const {read} = remote(zip)
		const short = await ZipArchive.read(zip.length, (start, end) => read(start, end - start === 5000 ? end - 1 : end))
		expect(await asyncError(short.bytes('preview.jpg'))).toBe('corrupt')
		const damaged = zip.slice()
		damaged[30 + 'preview.jpg'.length + 10] ^= 0xff
		const archive = await ZipArchive.read(damaged.length, remote(damaged).read)
		expect(await asyncError(archive.bytes('preview.jpg'))).toBe('corrupt')
		const pem = utf8.encode('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n')
		expect(await asyncError(ZipArchive.read(pem.length, remote(pem).read))).toBe('corrupt')
		// Too short to hold an end record, it isn't read at all
		const empty = remote(new Uint8Array(0))
		expect(await asyncError(ZipArchive.read(0, empty.read))).toBe('corrupt')
		expect(empty.asked).toEqual([])
	})
})

describe('hostile and broken archives', () => {
	test('reports encrypted entries distinctly, while the rest stays readable', async () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'EncryptedPackage', data: 'secret', flags: 0x1},
				{name: 'readme.txt', data: 'plain'},
			]),
		)
		expect(await asyncError(archive.bytes('EncryptedPackage'))).toBe('encrypted')
		expect(await archive.text('readme.txt')).toBe('plain')
	})

	test('reports a platform without deflate-raw as unsupported, not corrupt', async () => {
		const archive = ZipArchive.open(sample())
		const original = globalThis.DecompressionStream
		globalThis.DecompressionStream = class {
			constructor() {
				throw new TypeError('Unsupported compression format')
			}
		} as unknown as typeof DecompressionStream
		try {
			expect(await asyncError(archive.bytes('word/document.xml'))).toBe('unsupported')
		} finally {
			globalThis.DecompressionStream = original
		}
		expect(await asyncError(archive.bytes('word/document.xml'))).toBe('none')
	})

	test('rejects compression methods other than store and deflate, and missing entries', async () => {
		const archive = ZipArchive.open(buildZip([{name: 'a.bz2', data: 'x', method: 12, payload: utf8.encode('BZh')}]))
		expect(await asyncError(archive.bytes('a.bz2'))).toBe('unsupported')
		expect(await asyncError(archive.text('nope.xml'))).toBe('missing')
	})

	test('catches CRC mismatches in stored and deflated entries', async () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'deflated.xml', data: '<a>hello</a>', crc: 1234},
				{name: 'stored.xml', data: '<a>hello</a>', method: 0, crc: 1234},
			]),
		)
		expect(await asyncError(archive.bytes('deflated.xml'))).toBe('corrupt')
		expect(await asyncError(archive.bytes('stored.xml'))).toBe('corrupt')
	})

	test('stops a zip bomb at its declared size instead of inflating it', async () => {
		const bomb = new Uint8Array(deflateRawSync(new Uint8Array(64 * 1024 * 1024)))
		const archive = ZipArchive.open(buildZip([{name: 'bomb.xml', payload: bomb, size: 4096, crc: 0}]))
		const started = performance.now()
		expect(await asyncError(archive.bytes('bomb.xml'))).toBe('corrupt')
		expect(performance.now() - started).toBeLessThan(1000)
	})

	test('refuses declared sizes deflate could never produce, before allocating them', async () => {
		const archive = ZipArchive.open(buildZip([{name: 'liar.xml', data: 'tiny', size: 400 * 1024 * 1024}]))
		expect(await asyncError(archive.bytes('liar.xml'))).toBe('corrupt')
	})

	test('rejects data that inflates short of its declared size, and invalid deflate streams', async () => {
		const archive = ZipArchive.open(
			buildZip([
				{name: 'short.xml', data: '<a>short</a>', size: 40},
				{name: 'garbage.xml', payload: new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]), size: 10},
				{
					name: 'cut.xml',
					payload: new Uint8Array(deflateRawSync(utf8.encode('x'.repeat(5000)))).subarray(0, 6),
					size: 5000,
				},
				{name: 'stored.xml', data: 'abc', method: 0, size: 5},
			]),
		)
		for (const name of ['short.xml', 'garbage.xml', 'cut.xml', 'stored.xml']) {
			expect(await asyncError(archive.bytes(name)), name).toBe('corrupt')
		}
	})

	test('enforces the entry count, entry size and total size limits', async () => {
		const many = buildZip(Array.from({length: 20}, (_, i) => ({name: `part${i}.xml`, data: 'x'})))
		expect(syncError(() => ZipArchive.open(many, {maxEntries: 19}))).toBe('limits')
		expect(syncError(() => ZipArchive.open(many, {maxEntries: 20}))).toBe('none')

		const big = buildZip([{name: 'big.xml', data: 'x'.repeat(10_000)}])
		expect(await asyncError(ZipArchive.open(big, {maxEntrySize: 9_999}).bytes('big.xml'))).toBe('limits')
		expect(await asyncError(ZipArchive.open(big, {maxEntrySize: 10_000}).bytes('big.xml'))).toBe('none')
		expect(syncError(() => ZipArchive.open(big, {maxTotalSize: 9_999}))).toBe('limits')
	})

	test('caps the bytes an entry stores, not only what it inflates to, and refuses stored sizes that disagree', () => {
		const random = seeded(7)
		// Random bytes don't deflate, so they're stored in deflate's own blocks, a few bytes longer
		const noise = new Uint8Array(1000).map(() => Math.floor(random() * 256))
		const archive = ZipArchive.open(
			buildZip([
				{name: 'noise.bin', data: noise},
				{name: 'stored.bin', data: 'stored', method: 0, size: 3},
			]),
			{maxEntrySize: 1002},
		)
		expect(archive.refusal('noise.bin')).toBe('limits')
		expect(archive.refusal('stored.bin')).toBe('corrupt')
	})

	test('caps the total declared output of overlapping entries (one deflate stream, many names)', () => {
		const data = new Uint8Array(deflateRawSync(new Uint8Array(4 * 1024 * 1024)))
		const zip = buildZip(Array.from({length: 1200}, (_, i) => ({name: `x${i}`, payload: data, size: 4 * 1024 * 1024})))
		expect(syncError(() => ZipArchive.open(zip))).toBe('limits')
	})

	test('rejects duplicate names, which another reader could resolve differently', () => {
		const zip = buildZip([
			{name: 'word/document.xml', data: '<a/>'},
			{name: 'word/document.xml', data: '<b/>'},
		])
		expect(syncError(() => ZipArchive.open(zip))).toBe('corrupt')
	})

	test('rejects what is not a zip, and zip64 markers without their records', () => {
		expect(syncError(() => ZipArchive.open(new Uint8Array(0)))).toBe('corrupt')
		expect(syncError(() => ZipArchive.open(utf8.encode('-----BEGIN PRIVATE KEY-----\nMIIEvQ...')))).toBe('corrupt')
		const zip = buildZip([{name: 'a', data: 'a'}])
		const view = new DataView(zip.buffer)
		view.setUint16(zip.length - 12, 0xffff, true)
		expect(syncError(() => ZipArchive.open(zip))).toBe('corrupt')
	})

	test('every truncation is rejected as corrupt', () => {
		const zip = sample()
		for (let length = 0; length < zip.length; length++) {
			expect(
				syncError(() => ZipArchive.open(zip.slice(0, length))),
				`length ${length}`,
			).toBe('corrupt')
		}
	})

	test('entries pointing outside the archive are corrupt, never read out of bounds', async () => {
		const zip = buildZip([
			{name: 'a.xml', data: 'x'.repeat(100)},
			{name: 'b.xml', data: 'y'.repeat(100)},
		])
		const records = rawRecords(zip)
		const directory = zip.length - 22 - records[0].central.length - records[1].central.length
		const view = new DataView(zip.buffer)
		view.setUint32(directory + 42, zip.length - 10, true)
		// Past the archive's end, though under the entry size cap
		view.setUint32(directory + records[0].central.length + 20, zip.length * 2, true)
		const archive = ZipArchive.open(zip)
		expect(await asyncError(archive.bytes('a.xml'))).toBe('corrupt')
		expect(await asyncError(archive.bytes('b.xml'))).toBe('corrupt')
		expect(await asyncError(patchZip(archive, new Map()))).toBe('corrupt')
	})

	test('random corruption only ever surfaces as ZipError', async () => {
		const zip = buildZip([
			{name: '[Content_Types].xml', data: '<Types/>'},
			{name: 'a.xml', data: '<a>' + 'abc'.repeat(300) + '</a>', descriptor: 'signed'},
			{name: 'b.bin', data: 'stored bytes', method: 0},
			{name: 'c.xml', data: '<c/>', zip64: true, comment: 'note'},
		])
		const random = seeded(42)
		let opened = 0
		for (let round = 0; round < 1500; round++) {
			const mutated = zip.slice()
			for (let k = 0; k < 1 + random() * 3; k++)
				mutated[Math.floor(random() * mutated.length)] = Math.floor(random() * 256)
			let archive: ZipArchive
			try {
				archive = ZipArchive.open(mutated, {maxEntrySize: 1 << 20})
			} catch (error) {
				expect(error).toBeInstanceOf(ZipError)
				continue
			}
			opened++
			for (const entry of archive.entries) await asyncError(archive.bytes(entry.name))
			await asyncError(patchZip(archive, new Map([['a.xml', 'changed']])))
		}
		expect(opened).toBeGreaterThan(100)
	})
})

describe('patchZip', () => {
	test('with no changes rebuilds a canonical archive byte for byte', async () => {
		for (const zip of [
			sample(),
			buildZip(
				[
					{name: 'a', data: 'a', descriptor: 'bare'},
					{name: 'b', data: 'b', descriptor: 'zip64'},
				],
				{comment: 'kept'},
			),
			buildZip([]),
		]) {
			expect(await patchZip(ZipArchive.open(zip), new Map())).toEqual(zip)
		}
	})

	test('replaces an entry in place and leaves every other record byte-identical', async () => {
		const zip = buildZip(
			[
				{name: '[Content_Types].xml', data: '<Types/>'},
				{
					name: 'word/document.xml',
					data: '<w:document>old</w:document>',
					descriptor: 'signed',
					comment: 'part comment',
				},
				{name: 'word/styles.xml', data: '<w:styles/>'.repeat(40), extra: new Uint8Array([0x55, 0x54, 1, 0, 7])},
				{name: 'docProps/thumbnail.jpeg', data: new Uint8Array(500).fill(9), method: 0},
			],
			{comment: 'archive comment'},
		)
		const before = rawRecords(zip)
		const patched = await patchZip(
			ZipArchive.open(zip),
			new Map([['word/document.xml', '<w:document>new ✓</w:document>']]),
		)
		validate(patched)
		const after = rawRecords(patched)
		expect(after.map((record) => record.name)).toEqual(before.map((record) => record.name))
		for (const i of [0, 2, 3]) {
			expect(after[i].local).toEqual(before[i].local)
			expect(after[i].central).toEqual(before[i].central)
		}
		const archive = ZipArchive.open(patched)
		expect(await archive.text('word/document.xml')).toBe('<w:document>new ✓</w:document>')
		expect(decode(patched.subarray(patched.length - 15))).toBe('archive comment')

		// The replacement drops the data descriptor but keeps the record's comment, timestamp and attributes
		const view = new DataView(after[1].central.buffer)
		expect(view.getUint16(8, true) & 0x8).toBe(0)
		expect([view.getUint16(4, true), view.getUint16(12, true), view.getUint16(14, true)]).toEqual([
			0x0314, 0x6000, 0x5821,
		])
		expect([view.getUint16(36, true), view.getUint32(38, true)]).toEqual([1, 0x81a40000])
		expect(decode(after[1].central.subarray(after[1].central.length - 12))).toBe('part comment')
	})

	test('deletes with null and appends unknown names in order', async () => {
		const zip = sample()
		const patched = await patchZip(
			ZipArchive.open(zip),
			new Map<string, string | Uint8Array | null>([
				['word/media/image1.bin', null],
				['customXml/item1.xml', '<item/>'],
				['word/media/ünïcode.bin', new Uint8Array([1, 2, 3])],
				['not/there.xml', null],
			]),
		)
		validate(patched)
		const archive = ZipArchive.open(patched)
		expect(archive.entries.map((entry) => entry.name)).toEqual([
			'[Content_Types].xml',
			'word/document.xml',
			'customXml/item1.xml',
			'word/media/ünïcode.bin',
		])
		expect(await archive.bytes('word/media/ünïcode.bin')).toEqual(new Uint8Array([1, 2, 3]))
		// Non-ASCII names are written as flagged UTF-8, so any reader decodes them the same way
		const raw = rawRecords(patched)
		expect(new DataView(raw[3].central.buffer).getUint16(8, true) & 0x800).toBe(0x800)
		expect(new DataView(raw[2].central.buffer).getUint16(8, true) & 0x800).toBe(0)
	})

	test('stores content that deflate would not shrink, and handles empty content', async () => {
		const random = seeded(3)
		const noise = new Uint8Array(2000).map(() => Math.floor(random() * 256))
		const patched = await patchZip(
			ZipArchive.open(sample()),
			new Map<string, Uint8Array | string>([
				['noise.bin', noise],
				['empty.xml', ''],
				['word/document.xml', '<w:document>' + 'compressible '.repeat(500) + '</w:document>'],
			]),
		)
		validate(patched)
		const archive = ZipArchive.open(patched)
		const method = (name: string) => archive.entries.find((entry) => entry.name === name)?.method
		expect([method('noise.bin'), method('empty.xml'), method('word/document.xml')]).toEqual([0, 0, 8])
		expect(await archive.bytes('noise.bin')).toEqual(noise)
		expect(await archive.text('empty.xml')).toBe('')
	})

	test('moves zip64 entries by rewriting the offset inside their extra field', async () => {
		const zip = buildZip(
			[
				{name: 'first.xml', data: '<first/>'.repeat(30)},
				{name: 'second.xml', data: '<second/>', zip64: true},
				{name: 'third.xml', data: '<third/>', descriptor: 'zip64'},
			],
			{zip64End: true},
		)
		const patched = await patchZip(ZipArchive.open(zip), new Map([['first.xml', null]]))
		const archive = ZipArchive.open(patched)
		expect(archive.entries.map((entry) => entry.name)).toEqual(['second.xml', 'third.xml'])
		expect(await archive.text('second.xml')).toBe('<second/>')
		expect(await archive.text('third.xml')).toBe('<third/>')
	})

	test('keeps CP437 names as their original bytes when replacing an entry', async () => {
		const zip = buildZip([{name: 'dos', rawName: new Uint8Array([0x81, 0x2e, 0x78, 0x6d, 0x6c]), data: '<old/>'}])
		const patched = await patchZip(ZipArchive.open(zip), new Map([['ü.xml', '<new/>']]))
		expect(rawRecords(patched)[0].local.subarray(30, 35)).toEqual(new Uint8Array([0x81, 0x2e, 0x78, 0x6d, 0x6c]))
		expect(await ZipArchive.open(patched).text('ü.xml')).toBe('<new/>')
	})
})

const PACKAGE_DIRS = [
	'Samples/Word',
	'Samples/PowerPoint',
	'Samples/Spreadsheets',
	'Samples/iWork',
	'Samples2/Word',
	'Samples2/PowerPoint',
	'Samples2/Spreadsheets',
]
// The corpus's deliberately broken packages, and what each must fail with
const BROKEN: Record<string, ZipErrorCode> = {
	'not-a-zip.xlsx': 'corrupt',
	'corrupt-truncated.pptx': 'corrupt',
	// An encrypted Office file is a Compound File, not a zip
	'encrypted-password-pass-poi.docx': 'corrupt',
}
const BOMB = 'Samples2/Spreadsheets/hostile-zip-bomb-1gib.xlsx'
const packages = PACKAGE_DIRS.flatMap((dir) =>
	FIXTURES && existsSync(join(FIXTURES, dir))
		? readdirSync(join(FIXTURES, dir))
				.filter((file) => /\.(docx|xlsx|pptx|key|numbers|pages)$/.test(file))
				.map((file) => join(dir, file))
		: [],
)
const broken = packages.filter((path) => basename(path) in BROKEN)
const sound = packages.filter((path) => !broken.includes(path) && path !== BOMB)

describe.skipIf(packages.length === 0)('real packages', () => {
	test.each(broken)('%s: refused as broken', (path) => {
		expect(syncError(() => ZipArchive.open(new Uint8Array(readFileSync(join(FIXTURES, path)))))).toBe(
			BROKEN[basename(path)],
		)
	})

	test.skipIf(!packages.includes(BOMB))('a 1 MB sheet that inflates to 1 GiB is refused before inflating', async () => {
		const archive = ZipArchive.open(new Uint8Array(readFileSync(join(FIXTURES, BOMB))))
		const started = performance.now()
		expect(await asyncError(archive.bytes('xl/worksheets/sheet1.xml'))).toBe('limits')
		expect(performance.now() - started).toBeLessThan(50)
	})

	test.each(sound)('%s: read piecewise, every entry is what the whole archive holds', async (path) => {
		const zip = new Uint8Array(readFileSync(join(FIXTURES, path)))
		const whole = ZipArchive.open(zip)
		const piecewise = await ZipArchive.read(zip.length, remote(zip).read)
		expect(piecewise.entries).toEqual(whole.entries)
		for (const entry of whole.entries)
			expect(same(await piecewise.bytes(entry.name), await whole.bytes(entry.name)), entry.name).toBe(true)
	})

	test.each(sound)('%s: every entry inflates, and saves keep untouched parts byte-identical', async (path) => {
		const zip = new Uint8Array(readFileSync(join(FIXTURES, path)))
		const archive = ZipArchive.open(zip)
		expect(archive.entries.length).toBeGreaterThan(0)
		for (const entry of archive.entries) expect((await archive.bytes(entry.name)).length).toBe(entry.size)

		expect(same(await patchZip(archive, new Map()), zip)).toBe(true)

		const target = archive.entries.filter((entry) => !entry.name.endsWith('/')).sort((a, b) => a.size - b.size)[0]
		const patched = await patchZip(archive, new Map([[target.name, 'edited ✓']]))
		validate(patched)
		const reopened = ZipArchive.open(patched)
		expect(await reopened.text(target.name)).toBe('edited ✓')
		const before = rawRecords(zip)
		const after = rawRecords(patched)
		expect(after.map((record) => record.name)).toEqual(before.map((record) => record.name))
		before.forEach((record, i) => {
			if (record.name === target.name) return
			expect(same(after[i].local, record.local), record.name).toBe(true)
			expect(same(after[i].central, record.central), record.name).toBe(true)
		})
	})

	test.skipIf(!packages.includes('Samples/Spreadsheets/r200k.xlsx'))('r200k.xlsx: timings', async () => {
		const zip = new Uint8Array(readFileSync(join(FIXTURES, 'Samples/Spreadsheets/r200k.xlsx')))
		let started = performance.now()
		const archive = ZipArchive.open(zip)
		const opened = performance.now() - started
		started = performance.now()
		const sheet = await archive.bytes('xl/worksheets/sheet1.xml')
		const inflated = performance.now() - started
		started = performance.now()
		crc32(sheet)
		const checksummed = performance.now() - started
		started = performance.now()
		await patchZip(archive, new Map([['docProps/app.xml', '<Properties/>']]))
		const patched = performance.now() - started
		const mbps = (ms: number) => Math.round(sheet.length / 1e6 / (ms / 1000))
		console.info(
			`r200k.xlsx (${(zip.length / 1e6).toFixed(1)} MB): open ${opened.toFixed(1)} ms; inflate + CRC of the ` +
				`${(sheet.length / 1e6).toFixed(1)} MB sheet ${inflated.toFixed(0)} ms (${mbps(inflated)} MB/s); CRC-32 alone ` +
				`${mbps(checksummed)} MB/s; patch one part ${patched.toFixed(0)} ms`,
		)
		expect(inflated).toBeLessThan(10_000)
	})
})
