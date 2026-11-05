// The Open Packaging Conventions layer the OOXML engines share: opening a package (and telling it from the OLE
// files that pose as one), how parts find each other through relationships, what a zip or XML failure means for
// the file, and the text a part is written back with. Each engine keeps its own error class and its own way of
// reading and caching parts.

import {attr, children, XmlError, type XmlElement} from './xml'
import {ZipArchive, ZipError, type ZipLimits} from './zip'

// What an engine's error says went wrong, for its viewer to explain
export type PackageErrorCode = 'corrupt' | 'encrypted' | 'unsupported' | 'limits'

// `type` is the last segment of the type's URI, which Transitional and Strict files spell alike
export type Relationship = {type: string; target: string; external: boolean}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

// Office wraps a password-protected package in an OLE compound file, which is also what a legacy .doc, .xls or
// .ppt is; only the encrypted one holds an EncryptedPackage stream. Both fail as the zip errors engines explain.
export function openPackage(bytes: Uint8Array, limits?: Partial<ZipLimits>): ZipArchive {
	if (OLE.every((byte, i) => bytes[i] === byte)) {
		throw hasStream(bytes, 'EncryptedPackage')
			? new ZipError('encrypted', 'The file is password-protected')
			: new ZipError('unsupported', 'This is a legacy binary Office file')
	}
	if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ZipError('corrupt', 'Not a zip archive')
	return ZipArchive.open(bytes, limits)
}

// A compound file's directory entries are 128 bytes, in sectors after its 512-byte header: each starts with its
// name in UTF-16 and gives the name's size, terminator included, at byte 64. Matching only there keeps a document
// whose text mentions the name from passing for an encrypted one.
function hasStream(bytes: Uint8Array, name: string): boolean {
	entries: for (let at = 512; at + 128 <= bytes.length; at += 128) {
		if (bytes[at + 64] !== name.length * 2 + 2 || bytes[at + 65] !== 0) continue
		for (let i = 0; i < name.length; i++) {
			if (bytes[at + 2 * i] !== name.charCodeAt(i) || bytes[at + 2 * i + 1] !== 0) continue entries
		}
		return true
	}
	return false
}

// The relationships of a part, or of the package itself for ''
export function relsPartOf(part: string): string {
	const slash = part.lastIndexOf('/')
	return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`
}

// A relationships part's entries by id: internal targets as part names, external ones as written (never fetched)
export function parseRelationships(root: XmlElement | undefined, source: string): Map<string, Relationship> {
	const relationships = new Map<string, Relationship>()
	for (const rel of root ? children(root, 'Relationship') : []) {
		const id = attr(rel, 'Id')
		const target = attr(rel, 'Target')
		if (!id || target === undefined) continue
		const type = attr(rel, 'Type') ?? ''
		const external = attr(rel, 'TargetMode') === 'External'
		relationships.set(id, {
			type: type.slice(type.lastIndexOf('/') + 1),
			target: external ? target : resolveTarget(source, target),
			external,
		})
	}
	return relationships
}

// A part name for a target: relative to the source part's folder unless it starts at the root, without its
// fragment, unescaped, and with backslashes read as the slashes some writers meant. `..` can't climb out of the
// package.
export function resolveTarget(source: string, target: string): string {
	let path = target.split('#')[0]
	try {
		path = decodeURIComponent(path)
	} catch {
		// A stray % is just a character
	}
	const segments = /^[/\\]/.test(path) ? [] : source.split('/').slice(0, -1)
	for (const segment of path.split(/[/\\]/)) {
		if (segment === '..') segments.pop()
		else if (segment && segment !== '.') segments.push(segment)
	}
	return segments.join('/')
}

// The code for what the zip and XML layers throw; anything else is a bug and has none, so it surfaces as itself
export function failureCode(error: unknown): PackageErrorCode | undefined {
	if (error instanceof ZipError) return error.code === 'missing' ? 'corrupt' : error.code
	if (error instanceof XmlError) return error.code === 'limits' ? 'limits' : 'corrupt'
	return undefined
}

// An edited part's text as patchZip writes it, in UTF-8, so its declaration has to say UTF-8 too. A part read as
// UTF-16 could be written back as UTF-16 instead, but every XML reader takes UTF-8, and only this stays right when
// a part's declaration and bytes disagreed to begin with.
export function asUtf8(xml: string): string {
	return xml.replace(
		/^(<\?xml\s[^>]*?encoding\s*=\s*)(["'])([^"']*)\2/,
		(match, head: string, quote: string, name: string) =>
			name.toLowerCase() === 'utf-8' ? match : `${head}${quote}UTF-8${quote}`,
	)
}
