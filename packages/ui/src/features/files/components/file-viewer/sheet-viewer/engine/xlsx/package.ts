// The package around a workbook, shared by the reader and the writer: finding
// parts through their relationships, the workbook part's sheet list, A1
// references, and the one error type every entry point throws.

import {
	failureCode,
	openPackage,
	parseRelationships,
	relsPartOf,
	type PackageErrorCode,
	type Relationship,
} from '../../../shared/opc'
import {attr, child, children, parseXml, type XmlElement} from '../../../shared/xml'
import type {ZipArchive} from '../../../shared/zip'

export class XlsxError extends Error {
	readonly code: PackageErrorCode

	constructor(code: PackageErrorCode, message: string, options?: {cause?: unknown}) {
		super(message, options)
		this.name = 'XlsxError'
		this.code = code
	}
}

// Runs one entry point, turning what the zip and XML layers throw, and typed arrays or strings bigger than the
// engine allows, into XlsxError
export async function guard<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work()
	} catch (error) {
		const code = failureCode(error) ?? (error instanceof RangeError ? 'limits' : undefined)
		if (code) throw new XlsxError(code, (error as Error).message, {cause: error})
		throw error
	}
}

export type SheetKind = 'worksheet' | 'chartsheet' | 'other'
export type SheetState = 'visible' | 'hidden' | 'veryHidden'

export type WorkbookPart = {
	part: string
	xml: string
	root: XmlElement
	relsPart: string
	rels: Map<string, Relationship>
	sheets: Array<{name: string; state: SheetState; kind: SheetKind; part: string | undefined}>
}

// A part has to become one string to parse, and V8 caps strings just above 2^29 characters: refuse bigger parts
// before inflating them (a zip bomb's included)
const MAX_PART_SIZE = 2 ** 29

export class Package {
	readonly archive: ZipArchive
	// Part names are case-insensitive, and some writers disagree with their own relationships about case or slashes
	readonly #names: Map<string, string>

	private constructor(archive: ZipArchive) {
		this.archive = archive
		this.#names = new Map(archive.entries.map((entry) => [normalize(entry.name), entry.name]))
	}

	static open(bytes: Uint8Array): Package {
		return new Package(openPackage(bytes, {maxEntrySize: MAX_PART_SIZE}))
	}

	// The zip entry holding a part, if there is one
	entry(part: string): string | undefined {
		return this.archive.has(part) ? part : this.#names.get(normalize(part))
	}

	async text(part: string | undefined): Promise<string | undefined> {
		const entry = part === undefined ? undefined : this.entry(part)
		return entry === undefined ? undefined : this.archive.text(entry)
	}

	// The relationships of a part ('' for the package's own), by id
	async rels(part: string): Promise<Map<string, Relationship>> {
		const xml = await this.text(relsPartOf(part))
		return parseRelationships(xml === undefined ? undefined : parseXml(xml), part)
	}

	async workbook(): Promise<WorkbookPart> {
		const main = [...(await this.rels('')).values()].find((rel) => rel.type === 'officeDocument' && !rel.external)
		const part = main?.target ?? 'xl/workbook.xml'
		if (part.toLowerCase().endsWith('.bin')) {
			throw new XlsxError('unsupported', 'Binary workbooks (.xlsb) are not supported')
		}
		const xml = await this.text(part)
		if (xml === undefined) throw new XlsxError('corrupt', 'The workbook part is missing')
		const root = parseXml(xml)
		const rels = await this.rels(part)
		const list = child(root, 'sheets')
		const sheets = (list ? children(list, 'sheet') : []).map((sheet, i) => {
			const rel = rels.get(attr(sheet, 'id') ?? '')
			const state = attr(sheet, 'state')
			return {
				name: attr(sheet, 'name') ?? `Sheet${i + 1}`,
				state: state === 'hidden' || state === 'veryHidden' ? state : 'visible',
				// A sheet without its relationship reads as an empty worksheet
				kind: !rel || rel.type === 'worksheet' ? 'worksheet' : rel.type === 'chartsheet' ? 'chartsheet' : 'other',
				part: rel && !rel.external ? rel.target : undefined,
			} as const
		})
		return {part, xml, root, relsPart: relsPartOf(part), rels, sheets}
	}
}

const normalize = (name: string) => name.replace(/\\/g, '/').toLowerCase()

// ---------------------------------------------------------------------------
// A1 references

export const MAX_ROWS = 1_048_576
export const MAX_COLS = 16_384

// 0-based and inclusive
export type Range = {top: number; left: number; bottom: number; right: number}

// "AB12" → row * MAX_COLS + col (0-based), or -1 when it isn't a cell reference on the sheet. One number, so the
// million-cell parse loop allocates nothing for it; $ signs are allowed.
export function parseRef(ref: string, from = 0, to = ref.length): number {
	let i = from
	if (ref.charCodeAt(i) === 36) i++
	let col = 0
	const colStart = i
	for (; i < to; i++) {
		const c = ref.charCodeAt(i) | 32
		if (c < 97 || c > 122) break
		col = col * 26 + c - 96
	}
	if (i === colStart || i - colStart > 3 || col > MAX_COLS) return -1
	if (ref.charCodeAt(i) === 36) i++
	let row = 0
	const rowStart = i
	for (; i < to; i++) {
		const c = ref.charCodeAt(i) - 48
		if (c < 0 || c > 9) return -1
		row = row * 10 + c
	}
	if (i === rowStart || i - rowStart > 7 || row < 1 || row > MAX_ROWS) return -1
	return (row - 1) * MAX_COLS + col - 1
}

// "A1:C3" or "B2"; undefined when malformed
export function parseRange(text: string): Range | undefined {
	const colon = text.indexOf(':')
	const a = parseRef(text, 0, colon < 0 ? text.length : colon)
	const b = colon < 0 ? a : parseRef(text, colon + 1)
	if (a < 0 || b < 0) return undefined
	const [r1, c1, r2, c2] = [Math.floor(a / MAX_COLS), a % MAX_COLS, Math.floor(b / MAX_COLS), b % MAX_COLS]
	return {top: Math.min(r1, r2), left: Math.min(c1, c2), bottom: Math.max(r1, r2), right: Math.max(c1, c2)}
}

export function columnName(col: number): string {
	let name = ''
	for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
	return name
}

export const refName = (row: number, col: number) => `${columnName(col)}${row + 1}`

export function rangeName({top, left, bottom, right}: Range): string {
	const start = refName(top, left)
	return top === bottom && left === right ? start : `${start}:${refName(bottom, right)}`
}
