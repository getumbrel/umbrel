// Saving writes edits back into the original XML by splicing at the source offsets the parser recorded: changed w:t
// contents, plus runs for text typed where the paragraph had none. Everything else in each part, and every part
// that wasn't edited, stays byte for byte as it was.

import {asUtf8} from '@/features/files/components/file-viewer/shared/opc'
import {child, escapeXmlText, parseXml, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'
import {patchZip} from '@/features/files/components/file-viewer/shared/zip'

import type {Insertion, Slot, TextRef} from './model'
import {DocxError, type DocxPackage, type XmlPart} from './package'

type Splice = {start: number; end: number; text: string}

// Leading, trailing or repeated whitespace only survives in a w:t that preserves it
const NEEDS_PRESERVE = /^\s|\s$|\s\s|[\t\n]/

const prefixOf = (element: XmlElement) => element.name.slice(0, element.name.length - element.local.length)

// A w:t's new content, adding xml:space="preserve" to its tag when the text needs it
function textSplice(source: string, element: XmlElement, text: string): Splice {
	const escaped = escapeXmlText(text)
	const tag = source.slice(element.start, element.contentStart)
	const selfClosing = element.contentStart === element.end && tag.endsWith('/>')
	let open = selfClosing ? `${tag.slice(0, -2).trimEnd()}>` : tag
	if (NEEDS_PRESERVE.test(text) && !/\sxml:space\s*=\s*(["'])preserve\1/.test(open)) {
		open = /\sxml:space\s*=\s*(["'])[^"']*\1/.test(open)
			? open.replace(/(\sxml:space\s*=\s*)(["'])[^"']*\2/, '$1"preserve"')
			: `${open.slice(0, -1)} xml:space="preserve">`
	}
	if (selfClosing) return {start: element.start, end: element.end, text: `${open}${escaped}</${element.name}>`}
	if (open === tag) return {start: element.contentStart, end: element.contentEnd, text: escaped}
	return {start: element.start, end: element.contentEnd, text: `${open}${escaped}`}
}

// The paragraph mark's formatting as a run's, without the revision marks only a mark can carry
function markProperties(source: string, paragraph: XmlElement, prefix: string): string {
	const pPr = child(paragraph, 'pPr')
	const rPr = pPr && child(pPr, 'rPr')
	if (!rPr) return ''
	const kept = rPr.children
		.filter(
			(node): node is XmlElement =>
				'local' in node && !['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].includes(node.local),
		)
		.map((node) => source.slice(node.start, node.end))
		.join('')
	return kept ? `<${prefix}rPr>${kept}</${prefix}rPr>` : ''
}

// Text typed where there was no w:t: beside an object, a w:t goes into the object's run next to the run's child that
// holds it (never inside an mc:Choice); in an empty paragraph, a new run formatted like the paragraph mark
function insertionSplice(source: string, insertion: Insertion, text: string): Splice {
	const escaped = escapeXmlText(text)
	if (insertion.at) {
		const {run, node, side} = insertion.at
		const prefix = prefixOf(run)
		const holder =
			run.children.find(
				(element): element is XmlElement =>
					'local' in element && element.start <= node.start && node.end <= element.end,
			) ?? node
		const at = side === 'before' ? holder.start : holder.end
		return {start: at, end: at, text: `<${prefix}t xml:space="preserve">${escaped}</${prefix}t>`}
	}
	const p = insertion.paragraph.element
	const prefix = prefixOf(p)
	const run = `<${prefix}r>${markProperties(source, p, prefix)}<${prefix}t xml:space="preserve">${escaped}</${prefix}t></${prefix}r>`
	const tag = source.slice(p.start, p.contentStart)
	if (p.contentStart === p.end && tag.endsWith('/>'))
		return {start: p.start, end: p.end, text: `${tag.slice(0, -2).trimEnd()}>${run}</${p.name}>`}
	return {start: p.contentEnd, end: p.contentEnd, text: run}
}

export function applySplices(source: string, splices: Splice[]): string {
	const ordered = [...splices].sort((a, b) => b.start - a.start || b.end - a.end)
	let out = source
	let limit = Infinity
	for (const splice of ordered) {
		// Two edits of one span would mean a bookkeeping bug; refuse rather than write a broken part
		if (splice.end > limit) throw new DocxError('corrupt', 'Overlapping edits')
		out = out.slice(0, splice.start) + splice.text + out.slice(splice.end)
		limit = splice.start
	}
	return out
}

const isRef = (slot: Slot): slot is TextRef => slot.id >= 0

// The package with each slot's text in place of what it held when opened
export async function save(
	pkg: DocxPackage,
	parts: Map<string, XmlPart>,
	texts: Map<Slot, string>,
): Promise<Uint8Array<ArrayBuffer>> {
	const byPart = new Map<string, Splice[]>()
	for (const [slot, text] of texts) {
		const name = isRef(slot) ? slot.part : slot.paragraph.part
		const part = parts.get(name)
		if (!part || text === (isRef(slot) ? slot.text : '')) continue
		const splice = isRef(slot) ? textSplice(part.text, slot.element, text) : insertionSplice(part.text, slot, text)
		byPart.set(name, [...(byPart.get(name) ?? []), splice])
	}
	const changes = new Map<string, string>()
	for (const [name, splices] of byPart) {
		const part = parts.get(name)!
		const text = applySplices(part.text, splices)
		// A last check that what we write is well-formed
		parseXml(text)
		changes.set(name, asUtf8(text))
	}
	if (!changes.size) return new Uint8Array(pkg.source)
	return patchZip(pkg.archive, changes)
}
