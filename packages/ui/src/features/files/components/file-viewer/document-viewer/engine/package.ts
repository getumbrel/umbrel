// The package layer of a .docx: how its parts find each other (relationships), and reading them as XML. Everything
// here treats the file as hostile: sizes are capped before anything is inflated, and parse failures surface as one
// typed error the viewer can explain.

import {
	failureCode,
	openPackage,
	parseRelationships,
	relsPartOf,
	type Relationship,
} from '@/features/files/components/file-viewer/shared/opc'
import {parseXml, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'
import type {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

export type DocxErrorCode = 'corrupt' | 'encrypted' | 'unsupported' | 'limits'

export class DocxError extends Error {
	readonly code: DocxErrorCode

	constructor(code: DocxErrorCode, message: string) {
		super(message)
		this.name = 'DocxError'
		this.code = code
	}
}

// About two and a half times the longest real document we've seen (a 190-page contract); past this, decoding and
// parsing alone would cost a phone's tab hundreds of megabytes, so it's refused before anything is inflated
const MAX_XML_PART = 32 * 1024 * 1024
const MAX_ENTRY = 256 * 1024 * 1024

// A part's text as parsed
export type XmlPart = {name: string; text: string; root: XmlElement}

export class DocxPackage {
	private relationships = new Map<string, Map<string, Relationship>>()

	private constructor(
		readonly archive: ZipArchive,
		// What was opened, which a save without edits gives back exactly
		readonly source: Uint8Array,
	) {}

	// A password-protected document fails as `encrypted`, a legacy .doc as `unsupported`, anything else not a zip as
	// `corrupt`
	static open(bytes: Uint8Array): DocxPackage {
		return new DocxPackage(
			guard(() => openPackage(bytes, {maxEntrySize: MAX_ENTRY})),
			bytes,
		)
	}

	has(name: string): boolean {
		return this.archive.has(name)
	}

	async bytes(name: string): Promise<Uint8Array<ArrayBuffer>> {
		return guardAsync(() => this.archive.bytes(name))
	}

	async xml(name: string): Promise<XmlPart | undefined> {
		const entry = this.archive.entries.find((candidate) => candidate.name === name)
		if (!entry) return undefined
		if (entry.size > MAX_XML_PART) throw new DocxError('limits', `${name} is too large to display`)
		const text = await guardAsync(() => this.archive.text(name))
		return {name, text, root: guard(() => parseXml(text))}
	}

	// The relationships of `source` (a part name, or '' for the package itself), by id. Targets are resolved to part
	// names; external targets are kept verbatim and never fetched.
	async rels(source: string): Promise<Map<string, Relationship>> {
		const cached = this.relationships.get(source)
		if (cached) return cached
		const map = parseRelationships((await this.xml(relsPartOf(source)))?.root, source)
		this.relationships.set(source, map)
		return map
	}

	// The main document part, wherever the package's own relationships put it
	async mainPart(): Promise<string> {
		for (const rel of (await this.rels('')).values()) {
			if (rel.type === 'officeDocument' && !rel.external && this.has(rel.target)) return rel.target
		}
		if (this.has('word/document.xml')) return 'word/document.xml'
		throw new DocxError('corrupt', 'The package has no main document')
	}
}

// What the zip and XML layers throw, as the error the viewer explains; anything else is a bug and stays itself
function toDocxError(error: unknown): unknown {
	const code = failureCode(error)
	return code ? new DocxError(code, (error as Error).message) : error
}

function guard<T>(run: () => T): T {
	try {
		return run()
	} catch (error) {
		throw toDocxError(error)
	}
}

async function guardAsync<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (error) {
		throw toDocxError(error)
	}
}
