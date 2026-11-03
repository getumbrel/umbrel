// Cell text: the workbook's shared strings and each sheet's own. A string
// table packs its strings into joined batches. Millions of them then cost
// about their characters, and none pins the XML text it was sliced from:
// engines share memory between a substring and its source, so one kept cell
// could otherwise keep an 80 MB sheet alive.

import {parseXml, tokenizeXml, type XmlElement} from '../../../shared/xml'
import {XlsxError} from './package'
import {fontProperties, type Font, type Palette, type Theme} from './styles'

// Excel's limit on a cell's text; longer text from a hostile file is cut there
const MAX_TEXT = 32_767

// A copy of text that shares no memory with the string it was sliced from. Engines keep a substring of 13 or more
// characters as a view of its source; joining builds a new string instead.
export const detach = (text: string) => (text.length < 13 ? text : [text, ''].join(''))

const BATCH = 4096

export class StringTable {
	#batches: string[] = []
	#pending: string[] = []
	// Where each string ends within its batch
	#ends = new Uint32Array(BATCH)
	#count = 0

	get count() {
		return this.#count
	}

	add(text: string): number {
		const i = this.#count++
		const value = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
		if (i === this.#ends.length) {
			const ends = new Uint32Array(i * 2)
			ends.set(this.#ends)
			this.#ends = ends
		}
		this.#ends[i] = (i % BATCH ? this.#ends[i - 1] : 0) + value.length
		this.#pending.push(value)
		if (this.#count % BATCH === 0) this.seal()
		return i
	}

	get(i: number): string {
		if (i >= this.#count - this.#pending.length) this.seal()
		return this.#batches[Math.floor(i / BATCH)].slice(i % BATCH ? this.#ends[i - 1] : 0, this.#ends[i])
	}

	// Copies out the strings still waiting for a full batch; called once parsing is done, so nothing pins the XML.
	// A batch sealed before it's full is extended by the next.
	seal() {
		if (!this.#pending.length) return
		const batch = Math.floor((this.#count - 1) / BATCH)
		this.#batches[batch] = (this.#batches[batch] ?? '') + this.#pending.join('')
		this.#pending = []
	}
}

// A rich text run: its text and the font properties it sets over the cell's font
export type RichRun = {text: string; font?: Partial<Font>}

export type SharedStrings = {table: StringTable; runs: Map<number, RichRun[]>}

// OOXML writes characters XML can't carry as _xHHHH_ (Excel writes CR as _x000D_), and a literal "_x" as _x005F_x
const ESCAPE = /_x([0-9A-Fa-f]{4})_/g
export const unescapeText = (text: string) =>
	text.includes('_x') ? text.replace(ESCAPE, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : text

const localName = (name: string) => name.slice(name.indexOf(':') + 1)

// Streams sharedStrings.xml: plain items are collected as they pass, and only items with rich text runs are built
// into a tree, for their fonts. Phonetic guides (<rPh>) aren't part of the text.
export function parseSharedStrings(xml: string, theme: Theme, palette: Palette, maxItems: number): SharedStrings {
	const table = new StringTable()
	const runs = new Map<number, RichRun[]>()
	let start = -1
	let text = ''
	let capture = false
	let phonetic = 0
	let rich = false
	let items = 0
	const finish = (end: number) => {
		const index = table.add(unescapeText(text))
		if (rich) {
			const parsed = richRuns(parseXml(xml.slice(start, end)), theme, palette)
			items += parsed.length
			runs.set(index, parsed)
		}
		if (++items > maxItems) throw new XlsxError('limits', 'The workbook has too many strings')
		start = -1
	}
	tokenizeXml(xml, (event) => {
		if (event.type === 'text') {
			if (capture && !phonetic) text += event.text
			return
		}
		const name = localName(event.name)
		if (event.type === 'close') {
			if (name === 'si') finish(event.end)
			else if (name === 't') capture = false
			else if (name === 'rPh') phonetic--
		} else if (name === 'si') {
			start = event.start
			text = ''
			rich = false
			if (event.selfClosing) finish(event.end)
		} else if (start < 0) {
			// Outside an item
		} else if (name === 't') capture = !event.selfClosing
		else if (name === 'r') rich = true
		else if (name === 'rPh' && !event.selfClosing) phonetic++
	})
	table.seal()
	return {table, runs}
}

// The runs of a shared (<si>) or inline (<is>) string with rich text
export function richRuns(item: XmlElement, theme: Theme, palette: Palette): RichRun[] {
	const result: RichRun[] = []
	for (const node of item.children) {
		if (!('local' in node) || (node.local !== 'r' && node.local !== 't')) continue
		let run = node.local === 't' ? textOf(node) : ''
		let font: Partial<Font> | undefined
		for (const part of node.children) {
			if (!('local' in part)) continue
			if (part.local === 't') run += textOf(part)
			else if (part.local === 'rPr') font = fontProperties(part, theme, palette)
		}
		if (font?.name) font.name = detach(font.name)
		const text = detach(unescapeText(run))
		result.push(font ? {text, font} : {text})
	}
	return result
}

function textOf(element: XmlElement): string {
	let text = ''
	for (const node of element.children) if ('text' in node) text += node.text
	return text
}
