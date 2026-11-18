// Edits that change more than a w:t's text (a paragraph divided in two, two joined, a selection deleted across runs,
// bold switched on) rewrite the paragraph's XML, and the model reads the result again. A Draft is one paragraph taken
// apart just far enough for that: its properties, then a flat list of tokens. Runs and the elements that wrap runs
// (hyperlinks, content controls) are an open and a close token around their content; editable text is a token of its
// own; everything else is carried as the XML it was. Nothing is interpreted that doesn't have to be, so what an edit
// doesn't touch is written back as it was read.
//
// Places are flat offsets: every character of editable text counts one, and so does everything else that takes a place
// in the line (a tab, a picture, a field's value). The editor counts the same way over the rendered paragraph.

import {attr, escapeXmlText, parseXml, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'

import type {Insertion, Paragraph, Slot, TextRef} from './model'
import {applySplices, NEEDS_PRESERVE, prefixOf, textSplice, type Splice} from './save'

type Open = {
	kind: 'open'
	tag: string
	// A run's w:rPr, or '' when it has none
	props: string
	run: boolean
	// Whether the element can end in one paragraph and start again in the next. A content control can't (its id and
	// binding would repeat), so what follows a division leaves it.
	divisible: boolean
	end: string
	// The run or wrapper this one carries on after a division
	of?: Open
}
type Close = {kind: 'close'; open: Open}
// `xml` is the w:t as the file has it, kept for as long as its text is what the file has
type Text = {kind: 'text'; text: string; xml?: string}
type Raw = {
	kind: 'raw'
	xml: string
	// The places it takes in the line: none for what doesn't show (a bookmark, a field's instruction)
	length: number
	// +1 where a complex field begins, -1 where one ends
	field: number
	// One end of a range that also ends somewhere else (a bookmark, a comment's extent)
	marker?: {range: string; id: string}
	// A footnote or endnote reference: the note it names would be left behind
	pinned: boolean
}
type Token = Open | Close | Text | Raw

// Formatting for runs to take: on, off (said outright, whatever their style has), or null for none of their own (so
// as their style has it)
export type RunChange = {bold?: boolean | null; italic?: boolean | null; underline?: boolean | null}
export type Alignment = 'left' | 'center' | 'right' | 'both'

// Elements that wrap runs and can be closed and opened again around a division
const DIVISIBLE = new Set(['hyperlink', 'ins', 'moveTo', 'smartTag', 'customXml', 'dir', 'bdo'])
// Content with a story of its own, whose fields aren't this paragraph's; and deleted text, which the model doesn't read
const OWN_FIELDS = new Set(['drawing', 'pict', 'object', 'del', 'moveFrom'])

// CT_RPr and CT_PPr are sequences: Word refuses a part whose properties are out of order
const RUN_ORDER = [
	'rStyle',
	'rFonts',
	'b',
	'bCs',
	'i',
	'iCs',
	'caps',
	'smallCaps',
	'strike',
	'dstrike',
	'outline',
	'shadow',
	'emboss',
	'imprint',
	'noProof',
	'snapToGrid',
	'vanish',
	'webHidden',
	'color',
	'spacing',
	'w',
	'kern',
	'position',
	'sz',
	'szCs',
	'highlight',
	'u',
	'effect',
	'bdr',
	'shd',
	'fitText',
	'vertAlign',
	'rtl',
	'cs',
	'em',
	'lang',
	'eastAsianLayout',
	'specVanish',
	'oMath',
	// Anything else is a later extension, which goes here
	'',
	'rPrChange',
]
const PARAGRAPH_ORDER = [
	'pStyle',
	'keepNext',
	'keepLines',
	'pageBreakBefore',
	'framePr',
	'widowControl',
	'numPr',
	'suppressLineNumbers',
	'pBdr',
	'shd',
	'tabs',
	'suppressAutoHyphens',
	'kinsoku',
	'wordWrap',
	'overflowPunct',
	'topLinePunct',
	'autoSpaceDE',
	'autoSpaceDN',
	'bidi',
	'adjustRightInd',
	'snapToGrid',
	'spacing',
	'ind',
	'contextualSpacing',
	'mirrorIndents',
	'suppressOverlap',
	'jc',
	'textDirection',
	'textAlignment',
	'textboxTightWrap',
	'outlineLvl',
	'divId',
	'cnfStyle',
	'',
	'rPr',
	'sectPr',
	'pPrChange',
]

const escapeAttribute = (value: string) => escapeXmlText(value).replace(/"/g, '&quot;')

// A property list (`name` is w:pPr or w:rPr) with some of its children replaced, added or (null) taken out
function withProps(xml: string, name: string, order: string[], change: Record<string, string | null>): string {
	const kept: Array<{local: string; xml: string}> = []
	if (xml) {
		for (const node of parseXml(xml).children) {
			if ('local' in node && !Object.hasOwn(change, node.local))
				kept.push({local: node.local, xml: xml.slice(node.start, node.end)})
		}
	}
	for (const [local, value] of Object.entries(change)) if (value !== null) kept.push({local, xml: value})
	const rank = (local: string) => (order.includes(local) ? order.indexOf(local) : order.indexOf(''))
	const sorted = kept
		.map((entry, index) => ({...entry, index}))
		.sort((a, b) => rank(a.local) - rank(b.local) || a.index - b.index)
	return sorted.length ? `<${name}>${sorted.map((entry) => entry.xml).join('')}</${name}>` : ''
}

function propOf(xml: string, local: string): string | undefined {
	if (!xml) return undefined
	for (const node of parseXml(xml).children)
		if ('local' in node && node.local === local) return xml.slice(node.start, node.end)
	return undefined
}

const isInsertion = (slot: Slot): slot is Insertion => slot.id < 0

const lengthOf = (token: Token) => (token.kind === 'text' ? token.text.length : token.kind === 'raw' ? token.length : 0)

export class Draft {
	private constructor(
		private readonly prefix: string,
		// The paragraph's open tag, and its w:pPr or ''
		private readonly tag: string,
		private props: string,
		private tokens: Token[],
	) {}

	// `texts`: what the paragraph's slots hold now, where that isn't what the file has. Undefined when the paragraph
	// can't be rewritten on its own: a field runs into or out of it, or its content isn't all accounted for.
	static read(paragraph: Paragraph, texts: ReadonlyMap<Slot, string>): Draft | undefined {
		if (paragraph.fielded) return undefined
		const {source, element: p} = paragraph
		const prefix = prefixOf(p)

		// What takes a place in the line, by where it is in the XML
		const units: Array<{start: number; end: number; length: number}> = []
		const current = new Map<XmlElement, string>()
		const edited = new Set<XmlElement>()
		const splices: Splice[] = []
		const seen = new Set<TextRef>()
		for (const inline of paragraph.inlines) {
			if (inline.kind === 'anchor' || inline.kind === 'separator') continue
			if ((inline.kind === 'text' || inline.kind === 'tab') && inline.ref) {
				const ref = inline.ref
				if (seen.has(ref)) continue
				seen.add(ref)
				const text = texts.get(ref) ?? ref.text
				current.set(ref.element, text)
				if (text !== ref.text) {
					edited.add(ref.element)
					splices.push(textSplice(source, ref.element, text))
				}
				units.push({start: ref.element.start, end: ref.element.end, length: text.length})
			} else {
				if (!inline.node) return undefined
				units.push({start: inline.node.start, end: inline.node.end, length: 1})
			}
		}
		let marked = ''
		const beside = new Map<XmlElement, Array<{node: XmlElement; side: 'before' | 'after'; text: string}>>()
		for (const [slot, text] of texts) {
			if (!isInsertion(slot) || slot.paragraph !== paragraph || !text) continue
			if (!slot.at) marked = text
			else beside.set(slot.at.run, [...(beside.get(slot.at.run) ?? []), {...slot.at, text}])
		}

		// A stretch of the source as it stands now: text typed inside something carried whole is still typed
		const cut = (start: number, end: number) => {
			const inside = splices.filter((splice) => splice.start >= start && splice.end <= end)
			if (!inside.length) return source.slice(start, end)
			return applySplices(
				source.slice(start, end),
				inside.map((splice) => ({start: splice.start - start, end: splice.end - start, text: splice.text})),
			)
		}
		const within = (node: XmlElement) =>
			units.reduce((sum, unit) => (unit.start >= node.start && unit.end <= node.end ? sum + unit.length : sum), 0)
		const fields = (node: XmlElement): number => {
			if (node.local === 'fldChar') {
				const type = attr(node, 'fldCharType')
				return type === 'begin' ? 1 : type === 'end' ? -1 : 0
			}
			if (OWN_FIELDS.has(node.local)) return 0
			let sum = 0
			for (const inner of node.children) if ('local' in inner) sum += fields(inner)
			return sum
		}
		const pinned = (node: XmlElement): boolean =>
			node.local === 'footnoteReference' ||
			node.local === 'endnoteReference' ||
			node.children.some((inner) => 'local' in inner && pinned(inner))
		const raw = (node: XmlElement, level: boolean): Raw => {
			const range = level ? /^(.+)(Start|End)$/.exec(node.local)?.[1] : undefined
			const id = attr(node, 'id')
			return {
				kind: 'raw',
				xml: cut(node.start, node.end),
				length: within(node),
				field: fields(node),
				marker: range && id !== undefined ? {range, id} : undefined,
				pinned: pinned(node),
			}
		}

		const tokens: Token[] = []
		let props = ''
		const walk = (container: XmlElement) => {
			for (const node of container.children) {
				if (!('local' in node)) continue
				const selfClosing = node.contentStart === node.end
				if (node.local === 'pPr' && container === p) {
					props = source.slice(node.start, node.end)
				} else if (node.local === 'r' && !selfClosing) {
					const rPr = node.children.find((inner): inner is XmlElement => 'local' in inner && inner.local === 'rPr')
					const open: Open = {
						kind: 'open',
						tag: source.slice(node.start, node.contentStart),
						props: rPr ? source.slice(rPr.start, rPr.end) : '',
						run: true,
						divisible: true,
						end: source.slice(node.contentEnd, node.end),
					}
					tokens.push(open)
					const typed = beside.get(node) ?? []
					for (const item of node.children) {
						if (!('local' in item) || item === rPr) continue
						const here = typed.filter((entry) => item.start <= entry.node.start && entry.node.end <= item.end)
						for (const entry of here) if (entry.side === 'before') tokens.push({kind: 'text', text: entry.text})
						const text = current.get(item)
						if (item.local !== 't' || text === undefined) tokens.push(raw(item, false))
						else
							tokens.push({kind: 'text', text, xml: edited.has(item) ? undefined : source.slice(item.start, item.end)})
						for (const entry of here) if (entry.side === 'after') tokens.push({kind: 'text', text: entry.text})
					}
					tokens.push({kind: 'close', open})
				} else if (DIVISIBLE.has(node.local) && !selfClosing) {
					const open: Open = {
						kind: 'open',
						tag: source.slice(node.start, node.contentStart),
						props: '',
						run: false,
						divisible: true,
						end: source.slice(node.contentEnd, node.end),
					}
					tokens.push(open)
					walk(node)
					tokens.push({kind: 'close', open})
				} else if (node.local === 'sdt' && hasContent(node)) {
					const content = node.children.find(
						(inner): inner is XmlElement => 'local' in inner && inner.local === 'sdtContent',
					)!
					const open: Open = {
						kind: 'open',
						tag: source.slice(node.start, content.contentStart),
						props: '',
						run: false,
						divisible: false,
						end: source.slice(content.contentEnd, node.end),
					}
					tokens.push(open)
					walk(content)
					tokens.push({kind: 'close', open})
				} else {
					tokens.push(raw(node, true))
				}
			}
		}
		walk(p)
		// Everything the editor counts has to be somewhere in the tokens, or its offsets would land in the wrong place
		const typed = [...beside.values()].flat().reduce((sum, entry) => sum + entry.text.length, 0)
		const counted = units.reduce((sum, unit) => sum + unit.length, typed)
		if (tokens.reduce((sum, token) => sum + lengthOf(token), 0) !== counted) return undefined

		const open = source.slice(p.start, p.contentStart)
		const tag = p.contentStart === p.end && open.endsWith('/>') ? `${open.slice(0, -2).trimEnd()}>` : open
		const draft = new Draft(prefix, tag, props, tokens)
		// Text typed into an empty paragraph is a run of its own, formatted like the paragraph mark
		if (marked) draft.tokens.push(...draft.run(draft.markProps(), [{kind: 'text', text: marked}]))
		return draft
	}

	get length(): number {
		return this.tokens.reduce((sum, token) => sum + lengthOf(token), 0)
	}

	xml(): string {
		this.tidy()
		let out = this.tag + this.props
		for (const token of this.tokens) {
			if (token.kind === 'open') out += token.tag + token.props
			else if (token.kind === 'close') out += token.open.end
			else if (token.kind === 'raw' || token.xml !== undefined) out += token.xml
			else {
				const preserve = NEEDS_PRESERVE.test(token.text) ? ' xml:space="preserve"' : ''
				out += `<${this.prefix}t${preserve}>${escapeXmlText(token.text)}</${this.prefix}t>`
			}
		}
		return `${out}</${this.prefix}p>`
	}

	// Divides the paragraph at `at`. This keeps what's before it, and what follows is returned as a paragraph of its
	// own with the same formatting, or in `style` alone (the style that follows a heading, say).
	split(at: number, style?: string): Draft | undefined {
		const index = this.caret(at, at > 0 && at === this.length ? 'before' : 'after')
		if (index === undefined) return undefined
		const enclosing = this.enclosing(index)
		const head = this.tokens.slice(0, index)
		const tail = this.tokens.slice(index)
		for (const open of [...enclosing].reverse()) head.push({kind: 'close', open})
		const reopened: Token[] = []
		for (const open of enclosing) {
			const close = tail.find((token): token is Close => token.kind === 'close' && token.open === open)!
			if (open.divisible) {
				const again = {...open, of: open.of ?? open}
				reopened.push(again)
				close.open = again
			} else tail.splice(tail.indexOf(close), 1)
		}
		// A section ends with its last paragraph, which is now the second; a forced page break stays with the first
		const section = propOf(this.props, 'sectPr') ?? null
		const name = `${this.prefix}pPr`
		const following =
			style === undefined
				? withProps(this.props, name, PARAGRAPH_ORDER, {pageBreakBefore: null})
				: withProps('', name, PARAGRAPH_ORDER, {
						pStyle: `<${this.prefix}pStyle ${this.prefix}val="${escapeAttribute(style)}"/>`,
						sectPr: section,
					})
		if (section) this.props = withProps(this.props, name, PARAGRAPH_ORDER, {sectPr: null})
		this.tokens = head
		return new Draft(this.prefix, `<${this.prefix}p>`, following, [...reopened, ...tail])
	}

	// Joins `other` on. The result keeps this paragraph's formatting, unless this one is empty: then it simply goes,
	// as Word has it. Either way a section that ended with `other` now ends here.
	append(other: Draft): void {
		if (!this.length) this.props = other.props
		else this.set({sectPr: propOf(other.props, 'sectPr') ?? null})
		this.tokens.push(...other.tokens)
	}

	// Takes out [from, to). False, with nothing changed, when that would leave a footnote without its reference or
	// reach into a field that isn't all in this paragraph.
	remove(from: number, to: number): boolean {
		if (from >= to) return true
		const start = this.edge(from, 'start')
		const end = this.edge(to, 'end')
		if (start === undefined || end === undefined) return false
		const range = this.tokens.slice(start, end)
		if (range.some((token) => token.kind === 'raw' && token.pinned)) return false
		// A range marker stays unless its other end goes too
		const ends = new Map<string, number>()
		for (const token of range) {
			if (token.kind === 'raw' && token.marker) {
				const key = `${token.marker.range} ${token.marker.id}`
				ends.set(key, (ends.get(key) ?? 0) + 1)
			}
		}
		const drop = new Set<Token>()
		const opened = new Set<Open>()
		for (const token of range) {
			if (token.kind === 'text') drop.add(token)
			else if (token.kind === 'raw') {
				if (!token.marker || ends.get(`${token.marker.range} ${token.marker.id}`) === 2) drop.add(token)
			} else if (token.kind === 'open') opened.add(token)
			else if (opened.has(token.open)) drop.add(token).add(token.open)
		}
		this.tokens = this.tokens.filter((token) => !drop.has(token))
		return true
	}

	// Puts text in at `at`, formatted like the text before it (or as `like`, a w:rPr, has it). With no text right
	// before it, a run right there whose own text is all gone takes it: what's typed where text was deleted is formatted
	// as that text was. A tab character becomes a tab and a newline a line break. Returns where the text went, which is
	// beside a field when `at` is inside one, or undefined when it can't go anywhere.
	insert(at: number, text: string, like?: string): number | undefined {
		let index = this.caret(at, 'after')
		if (index === undefined) return undefined
		const where = this.tokens.slice(0, index).reduce((sum, token) => sum + lengthOf(token), 0)
		if (like === undefined && this.tokens[index - 1]?.kind !== 'text') index = this.emptied(index) ?? index
		const content: Token[] = []
		for (const piece of text.split(/([\t\n])/)) {
			if (piece === '\t') content.push(this.object('tab'))
			else if (piece === '\n') content.push(this.object('br'))
			else if (piece) content.push({kind: 'text', text: piece})
		}
		if (!content.length) return where
		const inside = this.enclosing(index).at(-1)
		const props = like ?? (inside?.run ? inside.props : (this.neighbour(index)?.props ?? this.markProps()))
		if (inside?.run && inside.props === props) this.tokens.splice(index, 0, ...content)
		else if (inside?.run) {
			const again = {...inside, of: inside.of ?? inside}
			const close = this.tokens.find((token): token is Close => token.kind === 'close' && token.open === inside)!
			close.open = again
			this.tokens.splice(index, 0, {kind: 'close', open: inside}, ...this.run(props, content), again)
		} else this.tokens.splice(index, 0, ...this.run(props, content))
		return where
	}

	// The formatting (a w:rPr, or '') of the run holding what's at `at`: what text put in its place is formatted like
	formatAt(at: number): string | undefined {
		const index = this.boundary(at, 'before')
		if (index === undefined || index >= this.tokens.length) return undefined
		const inside = this.enclosing(index).at(-1)
		return inside?.run ? inside.props : undefined
	}

	// Changes the formatting of the runs in [from, to), dividing the runs at its ends
	format(from: number, to: number, change: RunChange): boolean {
		if (from >= to) return true
		let start = this.edge(from, 'start')
		if (start === undefined) return false
		start = this.divide(start)
		let end = this.edge(to, 'end')
		if (end === undefined) return false
		end = this.divide(end)
		const props = this.runProps(change)
		for (const token of this.tokens.slice(start, end)) {
			if (token.kind === 'open' && token.run)
				token.props = withProps(token.props, `${this.prefix}rPr`, RUN_ORDER, props)
		}
		return true
	}

	align(alignment: Alignment): void {
		this.set({jc: `<${this.prefix}jc ${this.prefix}val="${alignment}"/>`})
	}

	// Moves a list item to another level of its list, whose indent it then takes
	relevel(list: NonNullable<Paragraph['list']>, ilvl: number): void {
		const w = this.prefix
		this.set({
			numPr: `<${w}numPr><${w}ilvl ${w}val="${ilvl}"/><${w}numId ${w}val="${list.numId}"/></${w}numPr>`,
			ind: null,
		})
	}

	// Takes the paragraph out of its list. A list it names itself just goes, with the indent that came with it (and
	// the style, when that is Word's own for list items); one its style gives it has to be switched off.
	unlist(list: NonNullable<Paragraph['list']>): void {
		const w = this.prefix
		if (list.direct) this.set({numPr: null, ind: null, ...(list.styled ? {pStyle: null} : {})})
		else
			this.set({
				numPr: `<${w}numPr><${w}numId ${w}val="0"/></${w}numPr>`,
				ind: `<${w}ind ${w}left="0" ${w}firstLine="0"/>`,
			})
	}

	private set(change: Record<string, string | null>): void {
		this.props = withProps(this.props, `${this.prefix}pPr`, PARAGRAPH_ORDER, change)
	}

	private object(local: string): Raw {
		return {kind: 'raw', xml: `<${this.prefix}${local}/>`, length: 1, field: 0, pinned: false}
	}

	private run(props: string, content: Token[]): Token[] {
		const open: Open = {
			kind: 'open',
			tag: `<${this.prefix}r>`,
			props,
			run: true,
			divisible: true,
			end: `</${this.prefix}r>`,
		}
		return [open, ...content, {kind: 'close', open}]
	}

	private runProps(change: RunChange): Record<string, string | null> {
		const w = this.prefix
		const toggle = (local: string, on: boolean | null) =>
			on === null ? null : on ? `<${w}${local}/>` : `<${w}${local} ${w}val="0"/>`
		const out: Record<string, string | null> = {}
		if (change.bold !== undefined) Object.assign(out, {b: toggle('b', change.bold), bCs: toggle('bCs', change.bold)})
		if (change.italic !== undefined)
			Object.assign(out, {i: toggle('i', change.italic), iCs: toggle('iCs', change.italic)})
		if (change.underline !== undefined)
			out.u = change.underline === null ? null : `<${w}u ${w}val="${change.underline ? 'single' : 'none'}"/>`
		return out
	}

	// The paragraph mark's formatting as a run's, for text typed where there is no run to take after
	private markProps(): string {
		const rPr = propOf(this.props, 'rPr')
		if (!rPr) return ''
		return withProps(rPr, `${this.prefix}rPr`, RUN_ORDER, {
			ins: null,
			del: null,
			moveFrom: null,
			moveTo: null,
			rPrChange: null,
		})
	}

	// Where the text of a run was before it all went, when that's at a token boundary: past only what takes no place
	// there, outside any field and in the same wrappers (text put in beside a hyperlink doesn't become part of it)
	private emptied(index: number): number | undefined {
		const wrappers = this.enclosing(index).filter((open) => !open.run)
		for (let i = index; i < this.tokens.length && lengthOf(this.tokens[i]) === 0; i++) {
			if (this.tokens[i].kind !== 'text' || this.depth(i) > 0) continue
			const around = this.enclosing(i)
			if (around.length === wrappers.length + 1 && wrappers.every((open, depth) => open === around[depth])) return i
		}
		return undefined
	}

	// The runs and wrappers open at a token boundary, outermost first
	private enclosing(index: number): Open[] {
		const stack: Open[] = []
		for (const token of this.tokens.slice(0, index)) {
			if (token.kind === 'open') stack.push(token)
			else if (token.kind === 'close') stack.pop()
		}
		return stack
	}

	// The run that text put in at a boundary outside any run takes after: the one holding what comes just before it in
	// the line, else just after. Only what takes a place counts (a run of hidden text would hide what's typed), and only
	// in the same wrappers: text typed beside a hyperlink is not styled as one.
	private neighbour(index: number): Open | undefined {
		const wrappers = this.enclosing(index)
		const stack: Open[] = []
		let before: Open | undefined
		for (const [i, token] of this.tokens.entries()) {
			if (token.kind === 'open') stack.push(token)
			else if (token.kind === 'close') stack.pop()
			else if (lengthOf(token) > 0) {
				const run = stack.at(-1)
				const same = stack.length === wrappers.length + 1 && wrappers.every((open, depth) => open === stack[depth])
				if (!run?.run || !same) continue
				if (i >= index) return before ?? run
				before = run
			}
		}
		return before
	}

	// The boundary between tokens at a flat offset, dividing a text token to make one. Where tokens that take no place
	// sit at the offset, 'after' is the boundary right after what precedes them, 'before' the one right before what
	// follows. An offset inside something carried whole moves out of it, to the side named.
	private boundary(at: number, bias: 'before' | 'after'): number | undefined {
		let offset = 0
		for (let i = 0; i <= this.tokens.length; i++) {
			if (offset === at) {
				if (bias === 'after') return i
				let j = i
				while (j < this.tokens.length && lengthOf(this.tokens[j]) === 0) j++
				return j
			}
			if (i === this.tokens.length) break
			const token = this.tokens[i]
			const length = lengthOf(token)
			if (at < offset + length) {
				if (token.kind !== 'text') return bias === 'after' ? i + 1 : i
				// Never between the two halves of one character
				let cut = at - offset
				if ((token.text.charCodeAt(cut) & 0xfc00) === 0xdc00 && (token.text.charCodeAt(cut - 1) & 0xfc00) === 0xd800)
					cut += bias === 'after' ? 1 : -1
				if (cut === 0) return i
				if (cut === length) return i + 1
				this.tokens.splice(
					i,
					1,
					{kind: 'text', text: token.text.slice(0, cut)},
					{kind: 'text', text: token.text.slice(cut)},
				)
				return i + 1
			}
			offset += length
		}
		return undefined
	}

	private depth(index: number): number {
		let depth = 0
		for (const token of this.tokens.slice(0, index)) if (token.kind === 'raw') depth += token.field
		return depth
	}

	// One end of a range. Tokens that take no place stay outside it, and an end inside a field takes the whole field in:
	// part of a field is not something a document can hold.
	private edge(at: number, side: 'start' | 'end'): number | undefined {
		let index = this.boundary(at, side === 'start' ? 'before' : 'after')
		if (index === undefined) return undefined
		if (side === 'start') while (index > 0 && this.depth(index) > 0) index--
		else while (index < this.tokens.length && this.depth(index) > 0) index++
		return this.depth(index) > 0 ? undefined : index
	}

	// Where text is put in or the paragraph divided: never inside a field, but before it when the place is at its
	// start and after it otherwise
	private caret(at: number, bias: 'before' | 'after'): number | undefined {
		const index = this.boundary(at, bias)
		if (index === undefined || this.depth(index) === 0) return index
		let before = index
		while (before > 0 && this.depth(before) > 0) before--
		if (!this.tokens.slice(before, index).some((token) => lengthOf(token) > 0)) return before
		let after = index
		while (after < this.tokens.length && this.depth(after) > 0) after++
		return this.depth(after) > 0 ? undefined : after
	}

	// Makes a range's end fall between runs rather than inside one, and returns where it then is
	private divide(index: number): number {
		const inside = this.enclosing(index).at(-1)
		if (!inside?.run) return index
		const previous = this.tokens[index - 1]
		const next = this.tokens[index]
		// At the run's own start or end the whole run is on one side
		if (previous === inside) return index - 1
		if (next?.kind === 'close' && next.open === inside) return index + 1
		const again = {...inside, of: inside.of ?? inside}
		const close = this.tokens.find((token): token is Close => token.kind === 'close' && token.open === inside)!
		close.open = again
		this.tokens.splice(index, 0, {kind: 'close', open: inside}, again)
		return index + 1
	}

	// Leaves no empty text, run or wrapper behind, and puts back together the halves of a run that was divided for
	// nothing: the runs of the file itself stay as they were
	private tidy(): void {
		const tokens = this.tokens
		for (let changed = true; changed; ) {
			changed = false
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i]
				const next = tokens[i + 1]
				if (token.kind === 'text' && !token.text) tokens.splice(i, 1)
				else if (token.kind === 'text' && next?.kind === 'text')
					tokens.splice(i, 2, {kind: 'text', text: token.text + next.text})
				else if (token.kind === 'open' && next?.kind === 'close' && next.open === token) tokens.splice(i, 2)
				else if (
					token.kind === 'close' &&
					next?.kind === 'open' &&
					token.open.run &&
					(next.of ?? next) === (token.open.of ?? token.open) &&
					token.open.props === next.props
				) {
					const close = tokens.find((other): other is Close => other.kind === 'close' && other.open === next)!
					close.open = token.open
					tokens.splice(i, 2)
				} else continue
				changed = true
				i--
			}
		}
	}
}

function hasContent(sdt: XmlElement): boolean {
	const content = sdt.children.find((inner): inner is XmlElement => 'local' in inner && inner.local === 'sdtContent')
	return content !== undefined && content.contentStart !== content.end
}
