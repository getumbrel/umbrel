// The OPC layer of a .pptx: parts, their content types and relationships, and parsed XML. Parts are read
// (inflated) up front because slides render synchronously; parsing happens on first use and is cached.

import {
	failureCode,
	openPackage,
	parseRelationships,
	relsPartOf,
	resolveTarget,
	type PackageErrorCode,
	type Relationship,
} from '@/features/files/components/file-viewer/shared/opc'
import {
	attr,
	children,
	parseXml,
	type XmlElement,
	type XmlNode,
} from '@/features/files/components/file-viewer/shared/xml'
import {patchZip, type ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

export type PresentationErrorCode = PackageErrorCode

export class PresentationError extends Error {
	readonly code: PresentationErrorCode

	constructor(code: PresentationErrorCode, message: string) {
		super(message)
		this.name = 'PresentationError'
		this.code = code
	}
}

// What a phone can hold for one deck: XML is read whole at open, pictures only as they're drawn
const MAX_XML_TOTAL = 256 * 2 ** 20
export const MAX_PART = 128 * 2 ** 20

// Nodes taken from a markup-compatibility Fallback. PowerPoint reads the Choice branch instead, so text inside one
// of these must never be edited: the change wouldn't show up there.
export const alternates = new WeakSet<XmlNode>()

export class Package {
	private texts = new Map<string, string>()
	private trees = new Map<string, XmlElement | null>()
	private relationships = new Map<string, Map<string, Relationship>>()
	private sizes: Map<string, number>
	private defaults = new Map<string, string>()
	private overrides = new Map<string, string>()
	private budget = MAX_XML_TOTAL
	// Every part saved so far: each save patches the package as it was opened with all of them, so the engine never
	// holds a second copy of the package beside the bytes it was opened from
	private saved = new Map<string, string>()

	private constructor(readonly archive: ZipArchive) {
		this.sizes = new Map(archive.entries.map((entry) => [entry.name, entry.size]))
	}

	static async open(bytes: Uint8Array): Promise<Package> {
		const pkg = new Package(guard(() => openPackage(bytes, {maxEntrySize: MAX_PART})))
		await pkg.load(['[Content_Types].xml', '_rels/.rels'])
		const types = pkg.xml('[Content_Types].xml')
		for (const node of types ? children(types) : []) {
			const type = attr(node, 'ContentType')?.toLowerCase()
			if (!type) continue
			if (node.local === 'Default') pkg.defaults.set(attr(node, 'Extension')?.toLowerCase() ?? '', type)
			if (node.local === 'Override') pkg.overrides.set(resolveTarget('', attr(node, 'PartName') ?? ''), type)
		}
		return pkg
	}

	// Reads these parts and their relationships, so xml(), text() and rels() can answer synchronously
	async load(parts: Iterable<string>): Promise<void> {
		const wanted = new Set<string>()
		for (const part of parts) {
			for (const name of [part, relsPartOf(part)]) {
				if (this.texts.has(name) || wanted.has(name) || !this.sizes.has(name)) continue
				this.budget -= this.sizes.get(name)!
				if (this.budget < 0) throw new PresentationError('limits', 'The presentation is too large to show')
				wanted.add(name)
			}
		}
		const names = [...wanted]
		const texts = await Promise.all(names.map((name) => guardAsync(() => this.archive.text(name))))
		names.forEach((name, i) => this.texts.set(name, texts[i]))
	}

	has(part: string): boolean {
		return this.sizes.has(part)
	}

	size(part: string): number {
		return this.sizes.get(part) ?? 0
	}

	text(part: string): string | undefined {
		return this.texts.get(part)
	}

	// The part's root element, or undefined when it's absent or wasn't loaded
	xml(part: string): XmlElement | undefined {
		let tree = this.trees.get(part)
		if (tree === undefined) {
			const text = this.texts.get(part)
			tree = text === undefined ? null : guard(() => parseXml(text))
			if (tree) resolveAlternates(tree, false)
			this.trees.set(part, tree)
		}
		return tree ?? undefined
	}

	// Drops a parsed part that's no longer needed (a slide, once its model is built); its text stays for saving
	release(part: string): void {
		this.trees.delete(part)
	}

	// The package with these parts' new text and every part saved before. From then on their text is what's read,
	// parsed afresh on next use.
	async save(changes: ReadonlyMap<string, string>): Promise<Uint8Array<ArrayBuffer>> {
		const saved = new Map([...this.saved, ...changes])
		const bytes = await patchZip(this.archive, saved)
		this.saved = saved
		for (const [part, text] of changes) {
			this.texts.set(part, text)
			this.trees.delete(part)
		}
		return bytes
	}

	rels(part: string): Map<string, Relationship> {
		let rels = this.relationships.get(part)
		if (!rels) {
			rels = parseRelationships(this.xml(relsPartOf(part)), part)
			this.relationships.set(part, rels)
		}
		return rels
	}

	// The internal part relationship `id` of `part` points at
	target(part: string, id: string | undefined): string | undefined {
		const rel = id === undefined ? undefined : this.rels(part).get(id)
		return rel && !rel.external ? rel.target : undefined
	}

	// The first internal relationship of a type
	related(part: string, type: string): string | undefined {
		for (const rel of this.rels(part).values()) if (!rel.external && rel.type === type) return rel.target
		return undefined
	}

	contentType(part: string): string {
		return this.overrides.get(part) ?? this.defaults.get(part.slice(part.lastIndexOf('.') + 1).toLowerCase()) ?? ''
	}
}

const isAlternateContent = (node: XmlNode): node is XmlElement => 'local' in node && node.local === 'AlternateContent'

// Puts each mc:AlternateContent's Fallback in its place, since we understand none of the extensions a Choice
// requires, and marks everything that came from one. Without a Fallback nothing is kept, as the spec prescribes.
function resolveAlternates(element: XmlElement, inFallback: boolean) {
	const fromFallback = new Set<XmlNode>()
	if (element.children.some(isAlternateContent)) {
		element.children = element.children.flatMap((node) => {
			if (!isAlternateContent(node)) return [node]
			const fallback = children(node).find((branch) => branch.local === 'Fallback')
			fallback?.children.forEach((kid) => fromFallback.add(kid))
			return fallback?.children ?? []
		})
	}
	for (const node of element.children) {
		const alternate = inFallback || fromFallback.has(node)
		if (alternate) alternates.add(node)
		if ('local' in node) resolveAlternates(node, alternate)
	}
}

function guard<T>(run: () => T): T {
	try {
		return run()
	} catch (error) {
		throw translate(error)
	}
}

async function guardAsync<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (error) {
		throw translate(error)
	}
}

// The viewer handles one error type: zip and XML failures become corrupt, encrypted, unsupported or limits
export function translate(error: unknown): unknown {
	const code = failureCode(error)
	return code ? new PresentationError(code, (error as Error).message) : error
}
