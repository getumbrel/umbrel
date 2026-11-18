// Editing on the rendered pages. The browser does the typing (caret, selection, IME, spellcheck) wherever an edit
// stays inside the text of one run: the paragraph's DOM is then read back into the slots (w:t elements, or new runs)
// its text came from. Every other edit (a new paragraph, two joined, a selection deleted across runs or paragraphs, a
// picture deleted, bold) rewrites the XML of the paragraphs it changes (rewrite.ts): the model reads the result, and
// those paragraphs are rendered again where they stood. Places in the text are counted the way the rewriter counts
// them, one for each character of editable text and one for anything else that takes a place in the line.
//
// Undo is ours too, because re-pagination moves the DOM under the browser's own history. Every step is the XML of the
// paragraphs an edit changed, as they were before it.

import type {Block, Cell, DocumentModel, Paragraph, Slot, TextRef} from './model'
import {displaced, locked, renderInPlace, type Registry} from './render'
import {Draft} from './rewrite'
import {paragraphXml} from './save'

// Edits that put text in or take it out, wherever they reach
const EDITS = new Set([
	'insertText',
	'insertReplacementText',
	'insertFromPaste',
	'insertFromPasteAsQuotation',
	'insertFromYank',
	'insertTranspose',
	'insertParagraph',
	'insertLineBreak',
	'deleteContent',
	'deleteContentBackward',
	'deleteContentForward',
	'deleteWordBackward',
	'deleteWordForward',
	'deleteSoftLineBackward',
	'deleteSoftLineForward',
	'deleteHardLineBackward',
	'deleteHardLineForward',
	'deleteEntireSoftLine',
	'deleteByCut',
])
// Those a browser asks for at a caret while naming text for them to replace: a word that's corrected or dictated
// again, a letter given the accent chosen for it, two letters changing places
const REPLACES = new Set(['insertText', 'insertReplacementText', 'insertTranspose'])

export type Format = 'bold' | 'italic' | 'underline'
export type Formatting = Record<Format, boolean>

// Formatting the browser asks for where editing is rich, and the keys that ask for it everywhere
const FORMATS: Record<string, Format | undefined> = {
	formatBold: 'bold',
	formatItalic: 'italic',
	formatUnderline: 'underline',
}
const FORMAT_KEYS: Record<string, Format | undefined> = {b: 'bold', i: 'italic', u: 'underline'}
// The keys that only change what another key does
const MODIFIER_KEYS = new Set(['shift', 'control', 'alt', 'meta', 'altgraph', 'capslock'])
// How far an arrow key moves the caret on to find a place: further than a browser stops on the way from one to the
// next (around a paragraph's mark, at a table's edges, where a page ends)
const MAX_STEPS = 8
// How many places a search for the line above or below one goes through before it gives up: the lines of a page or two
const MAX_WALK = 4000

// A place in the text: a paragraph, by where it is among the blocks of its section or cell, and how far into it.
// It survives the paragraph being rendered again, and the DOM being split and rejoined across pages.
export type Place = {container: Block[]; index: number; offset: number}
export type Selected = {anchor: Place; focus: Place}

// `count` blocks from `index` give way to the paragraphs read from `entries`, each standing for a paragraph of the file
type Entry = {xml: string; origin: Paragraph}
type Change = {container: Block[]; index: number; count: number; entries: Entry[]}
// What takes an edit back, and the selection before it and after it
type Step = {changes: Change[]; before?: Selected; after?: Selected; kind: 'insert' | 'delete' | 'edit'; time: number}

// What takes a place in a paragraph's line, as rendered: a text node of a slot, an object, or a page break: the one a
// block of the paragraph begins after, or (`end`) the one its last block ends with
type Unit =
	| {node: Text; length: number; kind: 'text'}
	| {node: HTMLElement; length: 1; kind: 'object'}
	| {node: HTMLElement; length: 1; kind: 'break'; end?: boolean}

// A place a caret can be at, the box that says which line it's on there, and how far along the line it is; and the
// places of one paragraph (see `stops`)
type Stop = {place: Place; box: DOMRect; x: number}
type Stops = {
	length: number
	at: (offset: number) => Stop | undefined
	lines: (offset: number) => Stop[]
	leads: (offset: number) => boolean
}

export type EditorOptions = {
	host: HTMLElement
	registry: Registry
	model: Pick<DocumentModel, 'sections' | 'derive'>
	// Puts the blocks rendered for rewritten paragraphs where those of the paragraphs they replace are
	swap: (old: Paragraph[], blocks: HTMLElement[]) => void
	// Lays the pages out again around what was swapped
	layout: () => void
	// Text changed in a paragraph that stays as it's rendered: the pages follow in their own time
	onEdit: (paragraph: Paragraph) => void
	// The document changed some other way, or what can be undone did
	onChange: () => void
	onRefuse: () => void
	// Where the selection is on screen after an edit that put it there: its caret, and its other end (the same, for a
	// caret alone)
	onCaret: (caret: DOMRect, anchor: DOMRect) => void
}

const NOTHING: ReadonlyMap<Slot, string> = new Map()

const originOf = (paragraph: Paragraph) => paragraph.origin ?? paragraph
const samePlace = (a: Place, b: Place) => a.container === b.container && a.index === b.index && a.offset === b.offset
const isHidden = (block: Block | undefined) => block?.kind === 'paragraph' && block.hidden

export class Editor {
	// What the slots of each paragraph hold now, where that isn't what its XML has
	private pending = new Map<Paragraph, Map<Slot, string>>()
	// The paragraphs of the file that an edit changed, or whose place others took
	private touched = new Set<Paragraph>()
	// The blocks each section and cell held as the file has them, from when an edit first exchanged some
	private opened = new Map<Block[], Block[]>()
	private undoStack: Step[] = []
	private redoStack: Step[] = []
	// Text being composed (an IME's, or a phone keyboard's word): the paragraph it's in and where it began, formatting
	// switched on for it, and the first undo step it took
	private composition: {paragraph: Paragraph; from: number; change?: Partial<Formatting>; first?: Step} | undefined
	// The paragraph the edit in progress targeted, which its input event reads back
	private active: Paragraph | undefined
	// Formatting switched at a caret, for what's typed there next
	private armed: {place: Place; change: Partial<Formatting>} | undefined
	// The column the up and down arrows keep to, through lines that end short of it: how far to the side of the caret
	// it is, where the last of them left the caret (`place`: it stands while the caret is there and no other key is
	// pressed). The browser keeps to the column too, until the caret is put on a line here, or on a foothold: it counts
	// anew from there, and the column is `ours` alone.
	private column: {place: Place; aside: number; ours: boolean} | undefined
	// Whether Shift was down with the last Enter: a line break, not a paragraph
	private soft = false
	// The pages kept rendered wherever they scroll to (see hold())
	private held = new Set<HTMLElement>()
	// Whether the last press was the mouse's: a click doesn't say what made it in every browser
	private mouse = false
	// What the caret stands on where the browser has no place for one (see foot())
	private foothold: HTMLElement | undefined
	private enabled = false

	constructor(private options: EditorOptions) {
		// Heard while the document is only read as well: the pages kept for a selection are let go as it moves on
		options.host.ownerDocument.addEventListener('selectionchange', this.selectionChange)
	}

	setEnabled(enabled: boolean) {
		if (enabled === this.enabled) return
		this.enabled = enabled
		const {host} = this.options
		if (enabled) {
			host.contentEditable = 'plaintext-only'
			// Browsers without plaintext-only editing get rich editing, with pasting and formatting intercepted
			if (host.contentEditable !== 'plaintext-only') host.contentEditable = 'true'
			host.spellcheck = true
			host.style.outline = 'none'
			host.addEventListener('keydown', this.keyDown)
			host.addEventListener('beforeinput', this.beforeInput)
			host.addEventListener('input', this.input)
			host.addEventListener('compositionstart', this.compositionStart)
			host.addEventListener('compositionend', this.compositionEnd)
			host.addEventListener('drop', this.drop)
			host.addEventListener('selectstart', this.selectStart)
			host.addEventListener('pointerdown', this.pointerDown)
			host.addEventListener('click', this.click)
		} else {
			host.removeAttribute('contenteditable')
			// Text still being composed is read back as it stands: nothing listens for the end of its composition now
			if (this.composition) this.compositionEnd()
			host.removeEventListener('keydown', this.keyDown)
			host.removeEventListener('beforeinput', this.beforeInput)
			host.removeEventListener('input', this.input)
			host.removeEventListener('compositionstart', this.compositionStart)
			host.removeEventListener('compositionend', this.compositionEnd)
			host.removeEventListener('drop', this.drop)
			host.removeEventListener('selectstart', this.selectStart)
			host.removeEventListener('pointerdown', this.pointerDown)
			host.removeEventListener('click', this.click)
			this.armed = undefined
			this.foothold?.remove()
		}
		this.hold()
	}

	// Puts the model back as the file has it, for the render that follows to start from. What was being composed goes
	// with the rest.
	dispose() {
		this.composition = undefined
		this.setEnabled(false)
		this.options.host.ownerDocument.removeEventListener('selectionchange', this.selectionChange)
		for (const [container, blocks] of this.opened) container.splice(0, container.length, ...blocks)
	}

	// What now stands in the place of each paragraph of the file that an edit touched, as XML: itself as it now is, or
	// the paragraphs it was rewritten into (none, where it was joined to another)
	current(): Map<Paragraph, string> {
		const out = new Map<Paragraph, string>()
		for (const origin of this.touched) out.set(origin, '')
		const visit = (blocks: Block[]) => {
			for (const block of blocks) {
				if (block.kind === 'table') for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks)
				else if (out.has(originOf(block))) out.set(originOf(block), out.get(originOf(block)) + this.xml(block))
			}
		}
		for (const section of this.options.model.sections) visit(section.blocks)
		return out
	}

	get history(): {undo: boolean; redo: boolean} {
		return {undo: this.undoStack.length > 0, redo: this.redoStack.length > 0}
	}

	// Whether text is being composed. Nothing may move it meanwhile: the composition would end under the keyboard,
	// leaving what was composed so far in the text.
	get composing(): boolean {
		return this.composition !== undefined
	}

	undo() {
		this.travel('undo')
	}

	redo() {
		this.travel('redo')
	}

	// Where the selection is in the text, to put it back after the DOM moves
	selection(): Selected | undefined {
		const selection = this.options.host.ownerDocument.getSelection()
		if (!selection?.anchorNode || !selection.focusNode) return undefined
		const anchor = this.place(selection.anchorNode, selection.anchorOffset)
		const focus = this.place(selection.focusNode, selection.focusOffset)
		return anchor && focus ? {anchor, focus} : undefined
	}

	restoreSelection(saved: Selected | undefined) {
		if (!saved) return
		const anchor = this.position(saved.anchor)
		const focus = this.position(saved.focus)
		if (!anchor || !focus) return
		// Its pages are rendered first, for the browser to find it a place on them (see hold())
		this.hold([anchor.node, focus.node])
		this.options.host.ownerDocument
			.getSelection()
			?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
		this.foot(focus)
		this.hold()
	}

	// Selects the document's text: all of it or, while it's being edited, all that can be, from the first place in it to
	// the last. A browser asked to select all the host holds may end with nothing selected: Chrome does where the pages
	// have a header or a footer, which can't be edited.
	selectAll() {
		const {host} = this.options
		if (!this.enabled) return host.ownerDocument.getSelection()?.selectAllChildren(host)
		const all = host.ownerDocument.createRange()
		all.selectNodeContents(host)
		const range = this.range(all)
		if (!range) return
		// The keyboard goes where the selection is, in the browsers that don't take it there themselves
		host.focus({preventScroll: true})
		this.restoreSelection({anchor: range.start, focus: range.end})
	}

	// Whether the selected text is bold, italic and underlined (all of it), or what's typed at a caret would be.
	// Undefined when the selection isn't in text that can be edited.
	formatting(): Formatting | undefined {
		const range = this.range()
		if (!this.enabled || !range) return undefined
		const read = (element: HTMLElement | null): Formatting => ({
			bold: element?.style.fontWeight === '700',
			italic: element?.style.fontStyle === 'italic',
			underline: Boolean(element?.style.textDecorationLine.includes('underline')),
		})
		if (range.collapsed) {
			const at = this.position(range.start)
			const paragraph = range.start.container[range.start.index] as Paragraph
			const typed = at?.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : this.markOf(paragraph)
			return {...read(typed ?? null), ...this.armedAt(range.start)?.change}
		}
		// Text is looked at only until none of the three is left to find
		const state: Formatting = {bold: true, italic: true, underline: true}
		let any = false
		for (const text of this.selected(range.dom)) {
			const own = read(text.parentElement)
			for (const format of Object.keys(state) as Format[]) state[format] &&= own[format]
			any = true
			if (!state.bold && !state.italic && !state.underline) break
		}
		return any ? state : {bold: false, italic: false, underline: false}
	}

	// Switches bold, italic or underline for the selected text, or at a caret for what's typed there next
	toggle(format: Format) {
		if (this.composition) return
		const range = this.range()
		const state = this.formatting()
		if (!range || !state) return this.options.onRefuse()
		const change = {[format]: !state[format]}
		if (range.collapsed) {
			this.armed = {place: range.start, change: {...this.armedAt(range.start)?.change, ...change}}
			this.options.onChange()
			return
		}
		const {registry} = this.options
		const changes: Change[] = []
		const first = range.start.container[range.start.index]
		const last = range.end.container[range.end.index]
		for (const paragraph of new Set(this.parts(range.dom).map((part) => registry.paragraphs.get(part)!))) {
			const from = paragraph === first ? range.start.offset : 0
			const to = paragraph === last ? range.end.offset : this.length(paragraph)
			const draft = from < to ? this.draft(paragraph) : undefined
			if (!draft || !this.format(draft, paragraph, from, to, change)) continue
			const container = registry.homes.get(paragraph)!
			const entries = [{xml: draft.xml(), origin: originOf(paragraph)}]
			changes.push({container, index: container.indexOf(paragraph), count: 1, entries})
		}
		if (!changes.length) return this.options.onRefuse()
		this.commit(changes, this.selection())
	}

	private keyDown = (event: KeyboardEvent) => {
		if (this.composition || event.isComposing) return
		this.surface()
		const key = event.key.toLowerCase()
		const mod = (event.metaKey || event.ctrlKey) && !event.altKey
		this.soft = key === 'enter' && event.shiftKey
		// Any key but the up and down arrows lets go of the column they keep to, as it's pressed. Where it leaves the
		// caret is heard of later (see selectionChange), and by then the caret can be back where those arrows left it:
		// the left arrow and then the right bring it back.
		if (key !== 'arrowup' && key !== 'arrowdown' && !MODIFIER_KEYS.has(key)) this.column = undefined
		// Undo and redo: browsers only send history input events while their own undo history (which we never let
		// them apply) has something in it, so redo would never arrive
		if (mod && (key === 'z' || key === 'y')) {
			event.preventDefault()
			this.travel(key === 'z' && !event.shiftKey ? 'undo' : 'redo')
			return
		}
		// Select all is made here: left to the browser, it can come to nothing (see selectAll)
		if (mod && !event.shiftKey && key === 'a') {
			event.preventDefault()
			this.selectAll()
			return
		}
		// Bold, italic and underline: plain-text editing sends no input event for them
		const format = mod && !event.shiftKey ? FORMAT_KEYS[key] : undefined
		if (format) {
			event.preventDefault()
			this.toggle(format)
			return
		}
		if (key === 'tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault()
			this.tab(event.shiftKey)
			return
		}
		if ((key === 'arrowleft' || key === 'arrowright') && !event.metaKey && !event.ctrlKey && !event.altKey) {
			this.step(event, key === 'arrowleft' ? 'left' : 'right')
			return
		}
		if ((key === 'arrowup' || key === 'arrowdown') && !event.metaKey && !event.ctrlKey && !event.altKey) {
			this.lineStep(event, key === 'arrowdown')
			return
		}
		if (this.lineEdge(event)) return
		// A deletion the browser can't be left to make. Some it wouldn't even ask about: Safari sends no input event
		// for one at the edge of a page.
		if ((key === 'backspace' || key === 'delete') && !event.metaKey && !event.ctrlKey && !event.altKey) {
			const range = this.range()
			const erased = range?.collapsed ? this.erase(range.start, key === 'backspace') : 'native'
			if (erased === 'native') return
			event.preventDefault()
			if (!erased) this.options.onRefuse()
		}
	}

	// Moves the caret, or with Shift the end of the selection, to the next place on the left or the right. Left to
	// itself a browser's caret also stops where there's no place to be: before and after a table, where nothing can be
	// typed, and on either side of the mark that ends a paragraph, where a press would seem to do nothing. Where no
	// place is found to go to, the move is the browser's after all.
	//
	// From its foothold Safari's caret can have no way on where the end of a selection has one, as before a line break.
	// The end is moved then, and the caret put where it comes to.
	private step(event: KeyboardEvent, direction: 'left' | 'right') {
		const selection = this.options.host.ownerDocument.getSelection()
		if (!selection?.anchorNode || !selection.focusNode) return
		const {anchorNode, anchorOffset, focusNode, focusOffset} = selection
		const from = this.place(focusNode, focusOffset)
		// A selection the arrow only ends, and one that isn't in the text, are the browser's to move too
		if (!selection.isCollapsed && (!event.shiftKey || !from)) return
		// So is text turned on its side, where these keys go from line to line
		const element = focusNode.nodeType === Node.ELEMENT_NODE ? (focusNode as Element) : focusNode.parentElement
		if (element && /^(vertical|sideways)/.test(getComputedStyle(element).writingMode)) return
		const ways = event.shiftKey ? ['extend'] : this.footed(focusNode, focusOffset) ? ['move', 'extend'] : ['move']
		for (const way of ways) {
			for (let moves = 0; moves < MAX_STEPS; moves++) {
				const node: Node | null = selection.focusNode
				const offset = selection.focusOffset
				selection.modify(way, direction, 'character')
				// The document ends here
				if (!selection.focusNode || (selection.focusNode === node && selection.focusOffset === offset)) break
				const to = this.place(selection.focusNode, selection.focusOffset)
				if (!to || (from && samePlace(to, from))) continue
				event.preventDefault()
				// Left beside the text (before a list's number, after a paragraph's mark), the caret goes where typing does.
				// So does the caret whose way on was the end of a selection's.
				if (selection.isCollapsed ? selection.focusNode.nodeType !== Node.TEXT_NODE : !event.shiftKey)
					this.restoreSelection({anchor: to, focus: to})
				this.follow()
				return
			}
			selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
		}
	}

	// Moves the caret, or with Shift the end of the selection, to the line above or below, as far along it as the caret
	// was when these moves began: the column they keep to, through lines that end short of it. The move is the
	// browser's, which keeps to the column too, wherever that leaves the caret on that line, at the place on it nearest
	// the column. Around an object (a tab, a date, a picture, which no caret goes into) it may not. A line that has
	// nothing a caret goes into across from the caret, as the line of a picture or a date with no text beside it,
	// Chrome's caret passes by, or it goes to the end of the document, or to its start. From before an object that
	// starts a line it stays on that line for the line below, on the other side of the object. And it comes to no
	// place beside an object where no text is: on a line that starts with a tab it ends after the tab, however near
	// the start of the line the column is. The caret is then put at that place here. The browser counts anew from
	// where it's put, as if the moves began there: on the lines after, its move is right only where it ends as near
	// the column as any place is.
	//
	// A selection that the key takes back to a caret is ended first, at its end that way: the caret goes up from where
	// the selection starts and down from where it ends, as in Word and on a Mac. Elsewhere Chrome goes on from the end
	// that was put last, whichever the key. What ends where a line starts reaches no further than the line before:
	// the caret is on the line below what was selected already, and stays.
	private lineStep(event: KeyboardEvent, down: boolean) {
		const selection = this.options.host.ownerDocument.getSelection()
		if (!selection?.anchorNode || !selection.focusNode) return
		const ends = !event.shiftKey && !selection.isCollapsed
		let [node, offset] = [selection.focusNode, selection.focusOffset]
		if (ends) {
			const range = selection.getRangeAt(0)
			;[node, offset] = down ? [range.endContainer, range.endOffset] : [range.startContainer, range.startOffset]
		}
		const from = this.place(node, offset)
		// Text turned on its side has its lines side by side: there these keys go along a line
		const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
		if (!from || !element || /^(vertical|sideways)/.test(getComputedStyle(element).writingMode)) return
		if (ends) {
			selection.collapse(node, offset)
			if (down && this.stops(from.container, from.index)?.leads(from.offset)) {
				event.preventDefault()
				this.foot({node, offset})
				this.follow()
				return
			}
		}
		const line = this.lineBeside(from, down)
		// No line found that way (the text ends, or a table comes next): the browser's to find
		if (!line) return
		event.preventDefault()
		const kept = this.column && samePlace(this.column.place, from) ? this.column : undefined
		const {anchorNode, anchorOffset} = selection
		selection.modify(event.shiftKey ? 'extend' : 'move', down ? 'forward' : 'backward', 'line')
		// Inside an object is no place for the move to end at, as Safari's with Shift does
		const to =
			selection.focusNode && !this.inObject(selection.focusNode)
				? this.place(selection.focusNode, selection.focusOffset)
				: undefined
		const ended = (to && this.stops(to.container, to.index)?.lines(to.offset)) ?? []
		const on = (box: DOMRect | undefined) => (box ? ended.find((stop) => sameLine(stop.box, box)) : undefined)
		const there = on(line.stops[0].box)
		// From the end of a line that wraps at the caret, the browser's move ends a line short of the one found, rightly
		const wrap = !there && on(line.wrap?.line) ? line.wrap : undefined
		const x = kept ? line.x + kept.aside : (wrap ?? line).x
		const off = (stop: Stop) => Math.abs(stop.x - x)
		// Where the caret is left, and on which of its lines it's seen there
		let left: Stop | undefined = ended[0]
		let seen = there ?? on(wrap?.line)
		let ours = kept?.ours ?? false
		if (!wrap) {
			// Of two places as near, the one that comes first in the text
			const nearest = line.stops.reduce((best, stop) => (off(stop) < off(best) ? stop : best))
			const position = this.position(nearest.place)
			// While it keeps to the column too, the browser's caret ends at the nearest place it comes to: one in text
			const known = !ours && position?.node.nodeType === Node.TEXT_NODE
			if (position && !(there && (known || off(there) <= off(nearest)))) {
				if (event.shiftKey) selection.setBaseAndExtent(anchorNode, anchorOffset, position.node, position.offset)
				else selection.collapse(position.node, position.offset)
				this.foot(position)
				left = seen = nearest
				ours = true
			}
		}
		this.column = left && {place: left.place, aside: x - left.x, ours}
		this.follow(seen)
	}

	// The line next to the one a place is on, above it or below: the places on that line, in the order of the text,
	// and how far along its own line the place is (`x`). Where the place's own line wraps there, a caret at it is at the
	// end of one line or at the start of the next, and only the browser knows which: `wrap` is how far along the line
	// that ends there the place is, and the line that the browser's move from there rightly ends on, a line short of
	// the one found. Undefined where no line is found that way: the text ends, a table comes next, or the place is in
	// the last line of its cell.
	private lineBeside(
		from: Place,
		down: boolean,
	): {stops: Stop[]; x: number; wrap?: {x: number; line: DOMRect}} | undefined {
		let {container, index, offset} = from
		let row = this.stops(container, index)
		const [own, wrapped] = row?.lines(offset) ?? []
		if (!row || !own) return undefined
		const stops: Stop[] = []
		const found = (beyond?: DOMRect) => {
			if (!stops.length) return undefined
			const other = down ? own.box : beyond
			return {stops, x: own.x, wrap: wrapped && other ? {x: wrapped.x, line: other} : undefined}
		}
		// Not for ever: where the text isn't laid out (a page far off screen), nothing in it is on any line
		for (let walked = 0; walked < MAX_WALK; walked++) {
			offset += down ? 1 : -1
			if (offset < 0 || offset > row.length) {
				// On in the paragraph before or after, past any that takes no room: where the section ends, in the one
				// before it or after it
				do {
					index += down ? 1 : -1
					const beside = container[index] ? undefined : this.sectionBeside(container, down)
					if (beside) [container, index] = [beside, down ? 0 : beside.length - 1]
				} while (isHidden(container[index]))
				row = this.stops(container, index)
				if (!row) break
				offset = down ? 0 : row.length
			}
			const stop = row.at(offset)
			if (!stop) continue
			if (stops.length && !sameLine(stop.box, stops[0].box)) return found(stop.box)
			if (!stops.length && sameLine(stop.box, own.box)) continue
			if (down) stops.push(stop)
			else stops.unshift(stop)
		}
		return found()
	}

	// The blocks of the section before or after the one whose blocks these are. A cell's blocks are no section's.
	private sectionBeside(blocks: Block[], down: boolean): Block[] | undefined {
		const {sections} = this.options.model
		const index = sections.findIndex((section) => section.blocks === blocks)
		return index < 0 ? undefined : sections[index + (down ? 1 : -1)]?.blocks
	}

	// The places a caret can be at in a paragraph, each asked for by how far into the paragraph it is: before a
	// character or an object, where its box says which line it's on and how far along; and where nothing follows on a
	// line (at the paragraph's end, before a page break), at the end of what's before it or, with nothing before it on
	// its line either, where the caret stands. Inside a letter (between the halves of an emoji, or a letter and its
	// accent) is no place for one. `lines` are a place as a caret may be at it: on its own line and, where what's
	// before it is on another (the line wraps there), at the end of that one. A place `leads` where a line starts at
	// it.
	private stops(container: Block[], index: number): Stops | undefined {
		const paragraph = container[index]
		if (paragraph?.kind !== 'paragraph') return undefined
		const {islands, range} = this.options.registry
		const units = this.units(paragraph)
		let length = 0
		const starts = units.map((unit) => (length += unit.length) - unit.length)
		const rtl = Boolean(paragraph.props.bidi)
		const unitAt = (offset: number) => units[starts.findLastIndex((start) => start <= offset)]
		// The boxes of what's so far into the paragraph: a character's or an object's. A page break stands on no line.
		const boxes = (offset: number): DOMRect[] => {
			const unit = offset < length ? unitAt(offset) : undefined
			if (!unit || unit.kind === 'break') return []
			if (unit.kind === 'object') return [...unit.node.getClientRects()]
			const at = offset - starts[units.indexOf(unit)]
			range.setStart(unit.node, at)
			range.setEnd(unit.node, at + 1)
			return [...range.getClientRects()]
		}
		// What ends a line: a line break, or a page break
		const ends = (offset: number) => {
			const unit = unitAt(offset)
			return unit?.kind === 'break' || (unit?.kind === 'object' && islands.get(unit.node)?.kind === 'break')
		}
		const before = (offset: number) => (offset > 0 && !ends(offset - 1) ? boxes(offset - 1).at(-1) : undefined)
		const at = (offset: number): Stop | undefined => {
			const unit = offset < length ? unitAt(offset) : undefined
			if (unit?.kind === 'text' && splits(unit.node.data, offset - starts[units.indexOf(unit)])) return undefined
			const place = {container, index, offset}
			const [box] = boxes(offset)
			if (box) return {place, box, x: rtl ? box.right : box.left}
			const last = before(offset)
			if (last) return {place, box: last, x: rtl ? last.left : last.right}
			const position = this.position(place)
			const own = position && this.caretBox(position.node, position.offset)
			// A box of no size at no place is that of something not laid out
			return own && (own.height || own.width || own.top || own.left) ? {place, box: own, x: own.left} : undefined
		}
		const lines = (offset: number): Stop[] => {
			const own = at(offset)
			const last = boxes(offset).length ? before(offset) : undefined
			if (!own) return []
			return last && !sameLine(last, own.box) ? [own, {...own, box: last, x: rtl ? last.left : last.right}] : [own]
		}
		const leads = (offset: number) => (before(offset) ? lines(offset).length > 1 : Boolean(at(offset)))
		return {length, at, lines, leads}
	}

	// Takes the key that sends the caret to an end of its line where a browser can't be left to find that end: on a line
	// that ends there with an object (a picture, a page number, a tab), and from beside an object. A browser finds no
	// place for a caret on the far side of an object, or none to start from. From the end of a paragraph that ends with
	// an object, the key for the end takes Chrome's caret and Safari's to the end of the document, and the key for the
	// start takes Safari's to the start of it. Safari's also goes from a line that starts with a tab to the end of the
	// line above, and from a line that ends with a tab before a line break to the start of the line below. A line of
	// text with text at that end stays the browser's.
	private lineEdge(event: KeyboardEvent): boolean {
		const selection = this.options.host.ownerDocument.getSelection()
		const edge = lineKey(event, Boolean(this.paragraphAt(selection?.focusNode)?.props.bidi))
		if (!selection?.anchorNode || !selection.focusNode || !edge) return false
		// The end of the selection that stays, and the end the key moves: its anchor and its focus. On Apple's platforms a
		// selection only grows towards an end of a line: its end on that side is the one that moves.
		const ends = (): [Node, number, Node, number] => {
			const {anchorNode, anchorOffset, focusNode, focusOffset} = selection
			if (!event.shiftKey || selection.isCollapsed || !apple())
				return [anchorNode!, anchorOffset, focusNode!, focusOffset]
			const {startContainer, startOffset, endContainer, endOffset} = selection.getRangeAt(0)
			return edge === 'start'
				? [endContainer, endOffset, startContainer, startOffset]
				: [startContainer, startOffset, endContainer, endOffset]
		}
		const [base, baseOffset, node, offset] = ends()
		const paragraph = this.paragraphAt(node)
		const to = paragraph && this.lineEnd(paragraph, node, offset, edge)
		if (!to) return false
		event.preventDefault()
		const move = () =>
			selection.modify(event.shiftKey ? 'extend' : 'move', edge === 'start' ? 'backward' : 'forward', 'lineboundary')
		// Where its line wraps, a caret in text is at the end of one line or at the start of the next, and only the
		// browser knows which. Its own move tells: that leaves a caret in its place that's at that end of its line already.
		if (to.wrap) {
			const from = this.place(node, offset)
			move()
			const [, , moved, movedOffset] = ends()
			const stays = this.place(moved, movedOffset)
			if (from && stays && samePlace(from, stays)) return true
		}
		if (event.shiftKey) selection.setBaseAndExtent(base, baseOffset, to.node, to.offset)
		else selection.collapse(to.node, to.offset)
		// The rest of the line is text, which the browser crosses
		if (to.onward) move()
		else this.foot(to)
		this.reveal()
		return true
	}

	// Where the key for an end of the caret's line takes the caret, when that isn't the browser's to say: found from
	// what the paragraph holds on that line, going from the caret towards that end. Text runs on from line to line:
	// where the line ends within some, the browser crosses the rest of it (`onward`) from the nearest of that text. An
	// object is one thing: one that runs over more than one line (a field's result) is on the line it starts on for the
	// start of a line, and on the line it ends on for the end, where no browser's line ends. A caret in text where its
	// line wraps may be on the line that ends there, at that end of it already, which is said (`wrap`). Undefined where
	// the key is the browser's: in text turned on its side, whose lines are side by side, and from text on a line that
	// has text at that end or only wraps there.
	private lineEnd(
		paragraph: Paragraph,
		node: Node,
		offset: number,
		edge: 'start' | 'end',
	): {node: Node; offset: number; onward?: boolean; wrap?: boolean} | undefined {
		const {islands, range} = this.options.registry
		const fragment = this.fragmentOf(node)
		const island = fragment && this.islandOf(node, fragment)
		if (island) [node, offset] = [island.parentNode!, childIndex(island) + (endsAt(node, offset, island) ? 1 : 0)]
		const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
		const at = this.place(node, offset)?.offset
		if (!element || at === undefined || /^(vertical|sideways)/.test(getComputedStyle(element).writingMode))
			return undefined
		const back = edge === 'start'
		const inText = node.nodeType === Node.TEXT_NODE
		const units = this.units(paragraph)
		let total = 0
		const starts = units.map((unit) => (total += unit.length) - unit.length)
		// The box of one of a unit's characters, an object being one: where it starts, or where it ends
		const box = (unit: Unit, index: number, end: boolean) => {
			if (unit.kind === 'text') {
				range.setStart(unit.node, index)
				range.setEnd(unit.node, index + 1)
			}
			const boxes = unit.kind === 'text' ? range.getClientRects() : unit.node.getClientRects()
			return boxes[end ? boxes.length - 1 : 0]
		}
		// What's on a side of the caret, as met from it: its box nearest the caret, and its furthest. Nothing past a
		// break, or in another block: a line ends there.
		const meet = (index: number, behind: boolean) => {
			const unit: Unit | undefined = units[index]
			const broken = unit?.kind === 'break' || (unit?.kind === 'object' && islands.get(unit.node)?.kind === 'break')
			if (!unit || broken || this.fragmentOf(unit.node) !== fragment) return undefined
			const first = behind ? Math.min(unit.length, at - starts[index]) - 1 : Math.max(0, at - starts[index])
			return {unit, near: box(unit, first, behind), far: box(unit, behind ? 0 : unit.length - 1, !behind)}
		}
		const before = units.findLastIndex((_, index) => starts[index] < at)
		const after = units.findIndex((unit, index) => starts[index] + unit.length > at)
		const [from, other] = back ? [before, after] : [after, before]
		// The caret's line is the line of what's next to it
		let met = meet(from, back)
		let line = met?.near
		const lined = (box: DOMRect | undefined) => Boolean(box && line && sameLine(box, line))
		// Unless the line wraps at the caret, which is then on one of two lines. Beside an object it's on the line that
		// starts there; in text the browser knows (see lineEdge).
		const away = meet(other, !back)?.near
		const wrapped = Boolean(away) && !lined(away)
		if (wrapped && !inText && back) return {node, offset}
		const wrap = wrapped && inText
		// From text the key is the browser's, as long as its line is this one: not past an object that runs on to another
		let ours = !inText
		let to: {node: Node; offset: number} | undefined
		let object = false
		let wraps = false
		for (let index = from; met; index += back ? -1 : 1, met = meet(index, back)) {
			const {unit, near, far} = met
			wraps = !lined(near)
			if (wraps) break
			if (!lined(far)) {
				// The line ends within this text
				if (unit.kind === 'text')
					return ours ? {node: unit.node, offset: back ? unit.length : 0, onward: true, wrap} : undefined
				;[line, ours] = [far, true]
			}
			object = unit.kind === 'object'
			to = object
				? {node: unit.node.parentNode!, offset: childIndex(unit.node) + (back ? 0 : 1)}
				: {node: unit.node, offset: back ? 0 : unit.length}
		}
		// With nothing on that side of it on its line, the caret is there already
		if (!to) return inText ? undefined : {node, offset}
		// A line with text at that end, and one that only wraps there, the browser ends itself
		if (!ours && (!object || wraps)) return undefined
		// A line that wraps after text ends in the place the next line starts in, where a caret that's put is on the next
		// line: the browser's own move leaves it on this one
		return wraps && !object && !back ? {node: to.node, offset: 0, onward: true, wrap} : {...to, wrap}
	}

	private beforeInput = (event: InputEvent) => {
		const type = event.inputType
		// Whatever the last edit was left to the browser for, it's over
		this.active = undefined
		this.surface()
		if (type === 'historyUndo' || type === 'historyRedo') {
			event.preventDefault()
			this.travel(type === 'historyUndo' ? 'undo' : 'redo')
			return
		}
		// IME composition can't be cancelled; it's read back when it ends
		if (type === 'insertCompositionText' || this.composition) return
		const format = FORMATS[type]
		if (format) {
			event.preventDefault()
			this.toggle(format)
			return
		}
		// Links, lists, drag and drop: not ours to make
		if (!EDITS.has(type)) return this.refuse(event)
		const soft = this.soft
		this.soft = false
		const selected = this.range()
		if (!selected) return this.refuse(event)
		const deleting = type.startsWith('delete')
		const pasting = type.startsWith('insertFrom')
		// The edit is made where the selection is: where the document shows it, and where it was last put. What the
		// browser says it would change is the same place, or it isn't left to make the edit: its own idea of where the
		// selection is can be another (see hold()). Only text it names for a caret to replace, as a correction does a
		// word, is taken from it: Enter or a paste is made at the caret whatever it names.
		const given = event.getTargetRanges?.()[0]
		const named = given && this.range(given)
		const replaces = selected.collapsed && REPLACES.has(type) && given !== undefined && !given.collapsed
		if (replaces && !named) return this.refuse(event)
		const agrees = named && samePlace(named.start, selected.start) && samePlace(named.end, selected.end)
		let range = named && (replaces || agrees) ? named : selected
		let own = range.own && (!given || range === named)

		// A deletion at a caret, whatever range the browser makes of it
		if (deleting && selected.collapsed) {
			const caret = selected.start
			const backward = type.includes('Backward')
			// Nothing is selected for a cut or a plain delete to take
			if (!backward && !type.includes('Forward')) return event.preventDefault()
			const paragraph = caret.container[caret.index] as Paragraph
			const edge = backward ? caret.offset === 0 : caret.offset === this.length(paragraph)
			if (edge || type === 'deleteContentBackward' || type === 'deleteContentForward') {
				const erased = this.erase(caret, backward, given)
				if (erased === 'native') return this.native(paragraph, 'delete')
				event.preventDefault()
				if (!erased) this.options.onRefuse()
				return
			}
			// A word or a line, as far as the browser would take it, but never out of the paragraph
			const reach = this.range(extent(this.options.host.ownerDocument.getSelection()!, type))
			const inside = (place: Place | undefined) => place?.container === caret.container && place.index === caret.index
			range = {
				start: backward ? (inside(reach?.start) ? reach!.start : {...caret, offset: 0}) : caret,
				end: backward ? caret : inside(reach?.end) ? reach!.end : {...caret, offset: this.length(paragraph)},
				collapsed: false,
				own: false,
				dom: reach?.dom ?? selected.dom,
			}
			own = false
		}

		const {start, end, trimmed} = selected.collapsed ? {...range, trimmed: false} : this.chosen(range)
		own &&= !trimmed
		const data = pasting
			? (event.dataTransfer?.getData('text/plain') ?? event.data ?? '')
			: (event.data ?? event.dataTransfer?.getData('text/plain') ?? '')
		const text =
			type === 'insertParagraph' || type === 'insertLineBreak' ? (soft ? '\v' : '\n') : deleting ? '' : clean(data)
		const change = samePlace(start, end) ? this.armedAt(start)?.change : undefined
		const paragraph = start.container[start.index] as Paragraph
		const one = start.container === end.container && start.index === end.index
		// A caret away from the text named for it to replace stays where it is in the text, as a browser leaves it: a word
		// is often corrected only once the space after it is typed, or the paragraph after it begun
		const stays = replaces && one && !text.includes('\n') ? carried(selected.start, start, end, text) : undefined
		// Text a run can take as typed, in the text of one run: made in the DOM, by the browser where it would do the same
		if (one && !change && !/[\n\t\v]/.test(text) && type !== 'insertTranspose') {
			if (start.offset === end.offset) {
				if (!text) return event.preventDefault()
				if (own && !pasting) return this.native(paragraph, 'insert')
				event.preventDefault()
				this.begin(paragraph, 'insert')
				this.insertAt(this.position(start)!, text)
				return this.made(paragraph)
			}
			const node = this.textAt(paragraph, start.offset, end.offset)
			if (node) {
				const kind = text ? 'insert' : 'delete'
				const {dom} = range
				if (own && !pasting && dom.startContainer === node.text && dom.endContainer === node.text)
					return this.native(paragraph, kind)
				event.preventDefault()
				this.begin(paragraph, kind)
				node.text.replaceData(node.from, node.to - node.from, text)
				if (stays) this.restoreSelection({anchor: stays, focus: stays})
				else this.options.host.ownerDocument.getSelection()?.collapse(node.text, node.from + text.length)
				return this.made(paragraph)
			}
		}
		if (type === 'insertTranspose') {
			// Two characters changing places is the browser's to do, in one run's text or not at all
			const {dom} = range
			if (own && dom.startContainer === dom.endContainer && dom.startContainer.nodeType === Node.TEXT_NODE)
				return this.native(paragraph, 'insert')
			return this.refuse(event)
		}
		event.preventDefault()
		if (!this.replace(start, end, text, change, stays, type === 'insertText')) this.options.onRefuse()
	}

	private input = () => {
		const paragraph =
			this.composition?.paragraph ??
			this.active ??
			this.paragraphAt(this.options.host.ownerDocument.getSelection()?.anchorNode)
		this.active = undefined
		if (paragraph) this.settle(paragraph)
	}

	private compositionStart = () => {
		const selection = this.options.host.ownerDocument.getSelection()
		const top = this.undoStack[this.undoStack.length - 1]
		let range = this.range()
		// What the composed text replaces goes first where it's more than text in one run: the IME can't be left to
		// take a picture or a paragraph's end with it, and can't be stopped
		if (range && !range.collapsed) {
			const {start, end, trimmed} = this.chosen(range)
			const single =
				range.own &&
				!trimmed &&
				start.container === end.container &&
				start.index === end.index &&
				this.textAt(start.container[start.index] as Paragraph, start.offset, end.offset)
			if (!single && !this.replace(start, end, '')) selection?.collapseToEnd()
			range = this.range()
		}
		const caret = range?.start
		const paragraph = caret && (caret.container[caret.index] as Paragraph)
		if (!paragraph) return
		const change = this.armedAt(caret)?.change
		this.begin(paragraph, 'insert')
		const first = this.undoStack[this.undoStack.indexOf(top) + 1]
		this.composition = {paragraph, from: caret.offset, change, first}
	}

	private compositionEnd = () => {
		const composition = this.composition
		this.composition = undefined
		if (!composition) return
		const {from, change, first} = composition
		const paragraph = this.settle(composition.paragraph)
		// A composition given up leaves nothing to undo
		this.idle(paragraph)
		// Formatting that was switched at the caret goes onto what was composed there
		const caret = this.selection()?.focus
		const container = this.options.registry.homes.get(paragraph)
		const draft =
			change && caret && container?.[caret.index] === paragraph && caret.offset > from && this.draft(paragraph)
		if (draft && this.format(draft, paragraph, from, caret.offset, change)) {
			const entries = [{xml: draft.xml(), origin: originOf(paragraph)}]
			this.commit([{container, index: caret.index, count: 1, entries}], {anchor: caret, focus: caret})
		}
		// Whatever it took (the selection it replaced going first, its formatting after), it's one step to undo
		const index = first ? this.undoStack.indexOf(first) : -1
		if (index < 0 || index === this.undoStack.length - 1) return
		const steps = this.undoStack.splice(index).reverse()
		const changes = steps.flatMap((step) => step.changes)
		this.undoStack.push({changes, before: first!.before, after: steps[0].after, kind: 'edit', time: 0})
		this.options.onChange()
	}

	private drop = (event: DragEvent) => this.refuse(event)

	// Select All from a menu, which the browser asks about at the host itself. A press on the host's own ground (around
	// the pages) asks there too, but with a button or a finger down: that selection is the browser's to start.
	private selectStart = (event: Event) => {
		const {host} = this.options
		if (event.target !== host || host.matches(':active')) return
		event.preventDefault()
		this.selectAll()
	}

	// Puts the caret on the side of an object that the mouse pressed. A browser's own goes to a side that has little to
	// do with where on the object the press was: Chrome's after a tab pressed anywhere on it, which with a wide tab is
	// the far end of its gap, and before a picture or a date. The browser places its caret once the press has been
	// heard, so the caret is moved in the frame that follows, before it's drawn anywhere. Unless the pointer has moved
	// by then: that starts a selection, which is the browser's to make, and Chrome stops extending one whose start is
	// moved under it. A finger's press is the system's alone: the caret it places comes later.
	private pointerDown = (event: PointerEvent) => {
		this.mouse = event.pointerType === 'mouse'
		if (!this.mouse || event.button !== 0) return
		let still = true
		this.options.host.addEventListener('pointermove', () => (still = false), {once: true})
		requestAnimationFrame(() => still && this.side(event))
	}

	// And again once the button is up: Chrome places its caret anew as the pointer first moves, however little, and
	// after a press on selected text deals with the selection only once the click has been heard
	private click = (event: MouseEvent) => {
		if (this.mouse && event.button === 0) requestAnimationFrame(() => this.side(event))
	}

	// Moves a caret that a press left beside an object to the side of the object that was pressed or, with Shift, the
	// end of the selection that the press moved there. Pressed inside a selection, an object leaves Chrome with no
	// selection at all, and so with no caret: it gets one.
	private side(event: MouseEvent) {
		if (!this.enabled || this.composition) return
		const selected = this.selection()
		const caret = this.options.host.ownerDocument.getSelection()?.isCollapsed
		// A selection that the press made, or left as it was, is no caret to move
		if (selected ? !(event.shiftKey || caret) : event.shiftKey) return
		const focus = this.pressed(event, selected?.focus)
		if (!focus || (selected && samePlace(focus, selected.focus))) return
		this.restoreSelection({anchor: selected && event.shiftKey ? selected.anchor : focus, focus})
	}

	// The place beside an object in a paragraph's line that a press on the object is nearer: before it, or after it from
	// halfway along it, as the paragraph's text runs. The object is the one that took the press. Or, for a press on the
	// paragraph's own ground, one beside the caret that the press left, with the pointer within its width on its line:
	// a drawn object, which a press goes through (see render.css), or one that isn't as tall as its line, as a tab
	// isn't. Where a line wraps at the caret, what's on the caret's other side is on another line, and the pointer may
	// be on that one.
	private pressed({target, clientX: x, clientY: y}: MouseEvent, caret: Place | undefined): Place | undefined {
		const {registry} = this.options
		const fragment = this.fragmentOf(target as Node)
		const paragraph = fragment && registry.paragraphs.get(fragment)
		const container = paragraph && registry.homes.get(paragraph)
		if (!fragment || !paragraph || !container) return undefined
		const index = container.indexOf(paragraph)
		const took = this.islandOf(target as Node, fragment)
		const beside = !took && caret?.container === container && caret.index === index ? caret : undefined
		const position = beside && this.position(beside)
		const line = position && this.caretBox(position.node, position.offset)
		const away = (box: DOMRect) => Math.max(box.top - y, y - box.bottom, 0)
		const width = (boxes: DOMRect[]) => boxes.reduce((sum, box) => sum + box.width, 0)
		let at = 0
		for (const unit of this.units(paragraph)) {
			const start = at
			at += unit.length
			if (unit.kind !== 'object') continue
			if (took ? unit.node !== took : !line || (start !== beside?.offset && at !== beside?.offset)) continue
			const boxes = [...unit.node.getClientRects()]
			const [over] = boxes.filter((box) => box.left <= x && x <= box.right).sort((a, b) => away(a) - away(b))
			if (!over || (line && !sameLine(over, line) && away(line) < away(over))) continue
			const along = width(boxes.slice(0, boxes.indexOf(over))) + (paragraph.props.bidi ? over.right - x : x - over.left)
			return {container, index, offset: along * 2 > width(boxes) ? at : start}
		}
		return undefined
	}

	private selectionChange = () => {
		// A document that's only read has no caret to place, only pages to let go of
		if (!this.enabled) return this.hold()
		this.surface(false)
		this.foot()
		this.hold()
		// The column the up and down arrows keep to is for the caret where they left it
		if (this.column) {
			const focus = this.selection()?.focus
			if (!focus || !samePlace(focus, this.column.place)) this.column = undefined
		}
		// Formatting switched at a caret is for what's typed there, not for where the caret goes next
		if (!this.armed) return
		const range = this.range()
		if (range?.collapsed && samePlace(range.start, this.armed.place)) return
		this.armed = undefined
		this.options.onChange()
	}

	// Brings an end of the selection that the browser left inside an object out beside it, where what's typed has
	// somewhere to go: sent to the end of a line that ends with a tab, a browser's caret stops inside the tab, and over a
	// selection that starts inside an object, as one dragged back onto a field does, Chrome takes nothing typed, pasted
	// or cut. A caret is brought out as soon as the browser says the selection changed, and before a key or an edit is
	// acted on, which can come sooner. A selection only then (`ranges`): while it's being made, its end may be on its
	// way through the object.
	private surface(ranges = true) {
		const selection = this.options.host.ownerDocument.getSelection()
		if (this.composition || !selection?.anchorNode || !selection.focusNode) return
		if (!ranges && !selection.isCollapsed) return
		if (this.inObject(selection.anchorNode) || this.inObject(selection.focusNode))
			this.restoreSelection(this.selection())
	}

	// Keeps pages rendered: those a selection's ends are on and, while the document is edited, those a key can take a
	// caret to from there (the pages beside them, and the document's first and last). A page skipped as off screen
	// (which one just built is, until its first frame) has no lines for a caret to be put on. Safari settles where a
	// selection is as it's set, and in such a page settles on the nearest place it finds outside the page's text, for
	// good: the next key would act there. So a page is rendered before a selection is put on it (`ends`), and the pages
	// follow a selection the browser moves. A page is let go once the selection has moved on from it, but not with
	// selected text on it: Safari looks at which pages a selection covers only as the selection changes, and the text
	// of a page let go since would be missing from what's selected. A document that's only read keeps no other page.
	private hold(ends?: Array<Node | null | undefined>) {
		const {host} = this.options
		const selection = host.ownerDocument.getSelection()
		const pages = new Set<HTMLElement>()
		for (const end of ends ?? (this.enabled ? [selection?.anchorNode, selection?.focusNode] : [])) {
			let page = end
			while (page && page.parentNode !== host) page = page.parentNode
			if (!page) continue
			const reached = this.enabled ? [page.previousSibling, page.nextSibling, host.firstChild, host.lastChild] : []
			for (const node of [page, ...reached]) if (node) pages.add(node as HTMLElement)
		}
		const selected = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : undefined
		for (const page of this.held) {
			if (pages.has(page)) continue
			if (selected?.intersectsNode(page)) pages.add(page)
			else page.style.contentVisibility = 'auto'
		}
		for (const page of pages) page.style.contentVisibility = 'visible'
		this.held = pages
	}

	private refuse(event: Event) {
		event.preventDefault()
		this.options.onRefuse()
	}

	// Leaves an edit to the browser, to be read back when its input event comes
	private native(paragraph: Paragraph, kind: 'insert' | 'delete') {
		this.active = paragraph
		this.begin(paragraph, kind)
	}

	// Settles an edit made here in a paragraph's text. The browser keeps the caret in view after an edit of its own; after
	// this one, the viewer does.
	private made(paragraph: Paragraph) {
		this.settle(paragraph)
		this.reveal()
	}

	// Reads a paragraph back after its text changed in the DOM, and has the step that changed it end here. Returns the
	// paragraph that stands there now: another one, where what was typed had to go in through its XML.
	private settle(paragraph: Paragraph): Paragraph {
		this.reconcile(paragraph, !this.composition)
		const now = (!this.composition && this.rehome(paragraph)) || paragraph
		this.armed = undefined
		const step = this.undoStack[this.undoStack.length - 1]
		if (step && this.typedIn(step, now)) {
			step.after = this.selection()
			step.time = Date.now()
		}
		if (now === paragraph) this.options.onEdit(paragraph)
		return now
	}

	// Text the DOM has no home for goes into the paragraph's XML where it stands, and the paragraph is rendered again with
	// it: typed where the browser took a run's span away with the last of its text and none is left beside, or after a
	// page break with nothing else there. What's shown is then what's saved. Returns the paragraph as rendered again, or
	// undefined when it holds no such text.
	private rehome(paragraph: Paragraph): Paragraph | undefined {
		const {registry} = this.options
		const container = registry.homes.get(paragraph)
		const strays = (registry.fragments.get(paragraph) ?? []).flatMap((fragment) => this.strays(fragment, paragraph))
		if (!container || !strays.length) return undefined
		const places = strays.map((node) => this.place(node, 0)?.offset)
		const draft = this.draft(paragraph)
		// In order, each after what went in before it; the caret goes after the last
		let caret: number | undefined
		let typed = 0
		for (const [i, node] of strays.entries()) {
			const text = clean(node.data)
			const at = places[i]
			const where = at === undefined ? undefined : draft?.insert(at + typed, text)
			if (where === undefined) continue
			typed += text.length
			caret = where + text.length
		}
		// Nowhere for it to go (the paragraph is part of a field, say): what was typed is gone again, and the document
		// says so
		if (!draft || caret === undefined) {
			for (const node of strays) node.remove()
			this.idle(paragraph)
			this.options.onRefuse()
			return undefined
		}
		const index = container.indexOf(paragraph)
		this.exchange([{container, index, count: 1, entries: [{xml: draft.xml(), origin: originOf(paragraph)}]}])
		const place = {container, index, offset: caret}
		this.finish({anchor: place, focus: place})
		return container[index] as Paragraph
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Places

	// The selection, or a range an edit names, as the places it runs between, in order. An end that isn't in text that
	// can be edited (on the page around it, between a table's cells) is the nearest place inside the range, which `own`
	// is false for. Undefined when the range holds no such text.
	private range(
		given?: AbstractRange,
	): {start: Place; end: Place; collapsed: boolean; own: boolean; dom: AbstractRange} | undefined {
		const selection = this.options.host.ownerDocument.getSelection()
		const dom = given ?? (selection?.rangeCount ? selection.getRangeAt(0) : undefined)
		if (!dom) return undefined
		let start = this.place(dom.startContainer, dom.startOffset)
		let end = dom.collapsed ? start : this.place(dom.endContainer, dom.endOffset)
		const own = Boolean(start && end)
		if (!own && !dom.collapsed) {
			const parts = this.parts(dom)
			const last = parts[parts.length - 1]
			start ??= parts[0] && this.place(parts[0], 0)
			end ??= last && this.place(last, last.childNodes.length)
		}
		return start && end ? {start, end, collapsed: dom.collapsed, own, dom} : undefined
	}

	// A selection as an edit takes it: one that ends before a paragraph's first character (as a triple click's does)
	// ends with the paragraph before, and is `trimmed`
	private chosen(range: {start: Place; end: Place}): {start: Place; end: Place; trimmed: boolean} {
		const {start, end} = range
		const whole = {start, end, trimmed: false}
		if (end.offset > 0 || (start.container === end.container && start.index === end.index)) return whole
		const stretches = this.stretches(start, end)
		const last = stretches?.at(-1)
		const before = last && (last.to > last.from ? {...last, to: last.to - 1} : stretches!.at(-2))
		if (!before) return whole
		const {container, to: index} = before
		return {start, end: {container, index, offset: this.length(container[index] as Paragraph)}, trimmed: true}
	}

	// The paragraphs from one place to another, in the stretches they follow one another in: a table between them
	// ends one, and so does the edge of a cell or a section. Undefined when the second place isn't after the first.
	private stretches(start: Place, end: Place): Array<{container: Block[]; from: number; to: number}> | undefined {
		if (start.container === end.container && start.index === end.index)
			return [{container: start.container, from: start.index, to: start.index}]
		const out: Array<{container: Block[]; from: number; to: number}> = []
		let state = 'before' as 'before' | 'within' | 'after'
		const visit = (container: Block[]) => {
			for (let index = 0; index < container.length && state !== 'after'; index++) {
				const block = container[index]
				if (block.kind === 'table') {
					for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks)
					continue
				}
				if (container === start.container && index === start.index) state = 'within'
				if (state !== 'within') continue
				const open = out[out.length - 1]
				if (open?.container === container && open.to === index - 1) open.to = index
				else out.push({container, from: index, to: index})
				if (container === end.container && index === end.index) state = 'after'
			}
		}
		for (const section of this.options.model.sections) visit(section.blocks)
		return state === 'after' ? out : undefined
	}

	// A range as one that can be asked what it runs through: itself, unless it's one of an edit's, which can't
	private live(range: AbstractRange): Range {
		if (range instanceof Range) return range
		const live = this.options.host.ownerDocument.createRange()
		live.setStart(range.startContainer, range.startOffset)
		live.setEnd(range.endContainer, range.endOffset)
		return live
	}

	// The parts of editable paragraphs a range runs through or touches, in the order they're in on the pages
	private parts(range: AbstractRange): HTMLElement[] {
		const {registry, host} = this.options
		const dom = this.live(range)
		const out: HTMLElement[] = []
		const visit = (element: Element) => {
			for (const child of element.children) {
				if (!dom.intersectsNode(child)) continue
				const paragraph = registry.paragraphs.get(child)
				if (paragraph && registry.homes.has(paragraph)) out.push(child as HTMLElement)
				else if (!paragraph) visit(child)
			}
		}
		visit(host)
		return out
	}

	// The text nodes a range selects some editable text of, in order, found as they're asked for
	private *selected(range: AbstractRange): Generator<Text> {
		const {registry, host} = this.options
		const dom = this.live(range)
		const visit = function* (parent: Node, slot: boolean): Generator<Text> {
			for (let child = parent.firstChild; child; child = child.nextSibling) {
				if (!dom.intersectsNode(child)) continue
				if (child.nodeType === Node.TEXT_NODE) {
					const text = child as Text
					const from = text === dom.startContainer ? dom.startOffset : 0
					const to = text === dom.endContainer ? dom.endOffset : text.length
					if (slot && from < to) yield text
				} else if (!locked(child)) yield* visit(child, slot || registry.refs.has(child as Element))
			}
		}
		yield* visit(host, false)
	}

	// The part of an editable paragraph a node is in
	private fragmentOf(node: Node | null | undefined): HTMLElement | undefined {
		const {registry, host} = this.options
		for (let current: Node | null | undefined = node; current && current !== host; current = current.parentNode) {
			if (current.nodeType !== Node.ELEMENT_NODE) continue
			const paragraph = registry.paragraphs.get(current as Element)
			if (paragraph && registry.homes.has(paragraph)) return current as HTMLElement
		}
		return undefined
	}

	private paragraphAt(node: Node | null | undefined): Paragraph | undefined {
		const fragment = this.fragmentOf(node)
		return fragment && this.options.registry.paragraphs.get(fragment)
	}

	// What takes a place in a paragraph's line, in order
	private units(paragraph: Paragraph): Unit[] {
		const {registry} = this.options
		const out: Unit[] = []
		const walk = (parent: Node) => {
			for (let child = parent.firstChild; child; child = child.nextSibling) {
				if (child.nodeType !== Node.ELEMENT_NODE) continue
				const element = child as HTMLElement
				const slot = registry.refs.has(element)
				if (locked(element)) {
					// A tab inside a w:t is a character of its text; an object that floats beside the text takes no place
					const inline = registry.islands.get(element)
					if (slot || (inline && inline.kind !== 'anchor' && inline.kind !== 'separator'))
						out.push({node: element, length: 1, kind: 'object'})
				} else if (slot) {
					for (const text of texts(element)) if (text.length) out.push({node: text, length: text.length, kind: 'text'})
				} else walk(element)
			}
		}
		const fragments = registry.fragments.get(paragraph) ?? []
		for (const fragment of fragments) {
			if (registry.breaks.has(fragment)) out.push({node: fragment, length: 1, kind: 'break'})
			walk(fragment)
		}
		// The break the paragraph ends with comes after everything in it
		if (fragments.some((fragment) => registry.breaksAfter.has(fragment)))
			out.push({node: fragments[fragments.length - 1], length: 1, kind: 'break', end: true})
		return out
	}

	private length(paragraph: Paragraph): number {
		return this.units(paragraph).reduce((sum, unit) => sum + unit.length, 0)
	}

	// Where a paragraph's last line ends: the last thing in it and the place after that, before the page break the
	// paragraph ends with if it has one
	private end(paragraph: Paragraph): {unit?: Unit; offset: number} {
		const units = this.units(paragraph).filter((unit) => unit.kind !== 'break' || !unit.end)
		return {unit: units[units.length - 1], offset: units.reduce((sum, unit) => sum + unit.length, 0)}
	}

	// The place of a DOM position: what comes before it in its paragraph. A position inside an object is before it, or
	// after it at the end of what the object holds.
	private place(node: Node, offset: number): Place | undefined {
		const {registry} = this.options
		const fragment = this.fragmentOf(node)
		const paragraph = fragment && registry.paragraphs.get(fragment)
		const container = paragraph && registry.homes.get(paragraph)
		if (!paragraph || !container) return undefined
		const island = this.islandOf(node, fragment)
		if (island) [node, offset] = [island.parentNode!, childIndex(island) + (endsAt(node, offset, island) ? 1 : 0)]
		const index = container.indexOf(paragraph)
		const point = registry.range
		let total = 0
		try {
			point.setStart(node, offset)
			point.collapse(true)
			for (const unit of this.units(paragraph)) {
				if (unit.node === node && unit.kind === 'text') return {container, index, offset: total + offset}
				// Where the unit ends (for a page break a block begins after, where that block begins; for the one a
				// paragraph ends with, after its last block): past the position, it comes after
				const [parent, at] =
					unit.kind === 'text'
						? [unit.node, unit.length]
						: unit.kind === 'break' && !unit.end
							? [unit.node, 0]
							: [unit.node.parentNode!, childIndex(unit.node) + 1]
				if (point.comparePoint(parent, at) > 0) break
				total += unit.length
			}
		} catch {
			// A position in blocks that aren't on the pages (yet, or any more) is no place
			return undefined
		}
		return {container, index, offset: total}
	}

	// Where the caret goes for a place: at the end of the text before it, so typing carries on in that run; else at the
	// start of the text after it; else between the objects it's between
	private position(place: Place): {node: Node; offset: number} | undefined {
		const paragraph = place.container[place.index]
		if (paragraph?.kind !== 'paragraph') return undefined
		let at = 0
		let before: Unit | undefined
		let after: Unit | undefined
		for (const unit of this.units(paragraph)) {
			if (unit.kind === 'text' && place.offset > at && place.offset < at + unit.length)
				return {node: unit.node, offset: place.offset - at}
			if (at >= place.offset) {
				after = unit
				break
			}
			before = unit
			at += unit.length
		}
		const beside = (node: Node, side: 0 | 1) => ({node: node.parentNode!, offset: childIndex(node) + side})
		if (before?.kind === 'text') return {node: before.node, offset: before.length}
		if (after?.kind === 'text') return {node: after.node, offset: 0}
		if (after?.kind === 'object') return beside(after.node, 0)
		if (before?.kind === 'object') return beside(before.node, 1)
		// Nothing beside it in its part of the paragraph, or in the paragraph at all: the mark that ends the part. Before
		// a page break that's the break's own, and otherwise the paragraph's, which takes typing where the paragraph has
		// no text.
		const mark = this.markOf(paragraph, after?.kind === 'break' && !after.end ? after.node : undefined)
		if (!mark) return undefined
		return this.options.registry.refs.has(mark) ? {node: mark, offset: 0} : beside(mark, 0)
	}

	// The mark that ends a part of a paragraph: the part before the block that a page break begins (`next`), or the
	// last part
	private markOf(paragraph: Paragraph, next?: HTMLElement): HTMLElement | undefined {
		const {registry} = this.options
		const fragments = registry.fragments.get(paragraph) ?? []
		const block = next ? fragments[fragments.indexOf(next) - 1] : fragments.at(-1)
		return block && [...block.querySelectorAll('span')].find((span) => registry.marks.get(span) === paragraph)
	}

	// The text node holding all of [from, to), where one does: what an edit can change in the DOM
	private textAt(paragraph: Paragraph, from: number, to: number): {text: Text; from: number; to: number} | undefined {
		let at = 0
		for (const unit of this.units(paragraph)) {
			if (unit.kind === 'text' && at <= from && to <= at + unit.length)
				return {text: unit.node, from: from - at, to: to - at}
			at += unit.length
		}
		return undefined
	}

	private armedAt(place: Place) {
		return this.armed && samePlace(this.armed.place, place) ? this.armed : undefined
	}

	// Tells the viewer where the selection went
	private reveal() {
		const selection = this.options.host.ownerDocument.getSelection()
		if (!selection?.focusNode || !selection.anchorNode) return
		const caret = this.caretBox(selection.focusNode, selection.focusOffset)
		const anchor = selection.isCollapsed ? caret : this.caretBox(selection.anchorNode, selection.anchorOffset)
		if (caret && anchor) this.options.onCaret(caret, anchor)
	}

	// Tells the viewer where an arrow key took the caret, or the end of the selection that it moves: the end to keep in
	// view, whatever else is selected. That's where its place in the DOM says, unless it's known better (`at`): where a
	// line wraps, a caret is at the end of that line or at the start of the next.
	private follow(at?: Stop) {
		const selection = this.options.host.ownerDocument.getSelection()
		const caret = at
			? new DOMRect(at.x, at.box.top, 0, at.box.height)
			: selection?.focusNode && this.caretBox(selection.focusNode, selection.focusOffset)
		if (caret) this.options.onCaret(caret, caret)
	}

	// Where a caret at a place in the DOM stands on screen
	private caretBox(node: Node, offset: number): DOMRect | undefined {
		const {range} = this.options.registry
		if (node.nodeType === Node.TEXT_NODE && (node as Text).length) {
			// A caret has no box of its own: the character before it has
			const end = Math.max(1, offset)
			range.setStart(node, end - 1)
			range.setEnd(node, end)
			const boxes = range.getClientRects()
			const box = boxes[offset ? boxes.length - 1 : 0]
			return box && new DOMRect(offset ? box.right : box.left, box.top, 0, box.height)
		}
		// Beside its foothold, it's beside what the foothold is beside
		const beside = (child: Node | undefined) =>
			child && child === this.foothold ? (child.nextSibling ?? child.previousSibling) : child
		range.selectNode(beside(node.childNodes[offset]) ?? beside(node.childNodes[offset - 1]) ?? node)
		return range.getBoundingClientRect()
	}

	// Gives the caret something to stand on where the browser has no place for one. Between two things no caret goes
	// into (two tabs, a line break and a tab, a picture and an object that floats) Safari has none: a caret put there is
	// where it was put for all the browser says, but none is drawn, and what's typed there is asked about by no event
	// and goes nowhere. So the caret gets a foothold: an image of no size, in the gap for as long as the caret is, with
	// the caret before it. Nothing on the page moves for it, and it's gone before anything else could come upon it. A
	// browser that has a caret there, as it says it would take text typed at it, is left as it is. `at` is where the
	// caret was just put; without it, wherever the selection says a caret is.
	//
	// What's selected from the caret has an end where the caret stood, and the foothold stays under that end: taken
	// away as the selection starts, it leaves Safari with a selection that doesn't stay as Shift and an arrow made it.
	private foot(at?: {node: Node; offset: number}) {
		const doc = this.options.host.ownerDocument
		const selection = doc.getSelection()
		// A composition is tied to what's around it in the DOM, and nothing there is touched meanwhile
		if (this.composition) return
		if (this.enabled && selection && !selection.isCollapsed) {
			const starts = this.footed(selection.anchorNode, selection.anchorOffset)
			const ends = this.footed(selection.focusNode, selection.focusOffset)
			// With both ends there, nothing is selected: the caret is back where it stood
			if (starts && ends) return this.stand()
			if (starts || ends) return
		}
		const caret =
			this.enabled && selection?.isCollapsed && selection.focusNode
				? (at ?? {node: selection.focusNode, offset: selection.focusOffset})
				: undefined
		const gap = caret && this.gap(caret.node, caret.offset)
		if (!selection || !caret || !gap) return void this.foothold?.remove()
		// The caret is beside its foothold already, from when it last came here
		const index = this.foothold?.parentNode === caret.node ? childIndex(this.foothold) : NaN
		if (caret.offset === index || caret.offset === index + 1) return
		const there = selection.focusNode === caret.node && selection.focusOffset === caret.offset
		if (there && doc.queryCommandEnabled?.('insertText') !== false) return void this.foothold?.remove()
		this.foothold ??= footholdOf(doc)
		gap.node.insertBefore(this.foothold, gap.node.childNodes[gap.offset] ?? null)
		this.stand()
	}

	// Whether a place in the DOM is the place the caret's foothold stands at. A browser can have an end of a selection
	// on either side of anything there that takes no place, as an object that floats takes none.
	private footed(node: Node | null, offset: number): boolean {
		const parent = this.foothold?.parentNode
		const stands = parent && this.place(parent, childIndex(this.foothold!))
		const place = stands && node && this.place(node, offset)
		return Boolean(place && samePlace(place, stands))
	}

	// Puts the caret before its foothold. The browser counts the column of the up and down arrows anew from a caret
	// that's put.
	private stand() {
		const foothold = this.foothold!
		this.options.host.ownerDocument.getSelection()?.collapse(foothold.parentNode, childIndex(foothold))
		if (this.column) this.column.ours = true
	}

	// Where a caret at a place in the DOM has no text to be in or beside: between the objects it's between, as
	// position() has it. Nowhere in a paragraph with no text, whose mark takes the typing.
	private gap(node: Node, offset: number): {node: Node; offset: number} | undefined {
		if (node.nodeType === Node.TEXT_NODE && (node as Text).length) return undefined
		const place = this.place(node, offset)
		const position = place && this.position(place)
		if (!position || position.node.nodeType !== Node.ELEMENT_NODE) return undefined
		return this.options.registry.refs.has(position.node as Element) ? undefined : position
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Rewriting

	private xml(paragraph: Paragraph): string {
		return paragraphXml(paragraph, this.pending.get(paragraph))
	}

	// A paragraph to rewrite, as it is now: with what was typed into it, and only where the rewriter counts its places
	// as its rendering does
	private draft(paragraph: Paragraph): Draft | undefined {
		if (!paragraph.editable) return undefined
		this.reconcile(paragraph)
		const draft = Draft.read(paragraph, this.pending.get(paragraph) ?? NOTHING)
		return draft && draft.length === this.length(paragraph) ? draft : undefined
	}

	// Gives [from, to) of a paragraph being rewritten the formats asked for. One that's switched off first goes with the
	// runs' own formatting, as Word has it; only where the text's style then still has it is it switched off outright.
	private format(draft: Draft, paragraph: Paragraph, from: number, to: number, change: Partial<Formatting>): boolean {
		const formats = Object.keys(change) as Format[]
		if (!draft.format(from, to, Object.fromEntries(formats.map((format) => [format, change[format] || null]))))
			return false
		const off = formats.filter((format) => !change[format])
		if (!off.length) return true
		const read = this.options.model.derive(draft.xml(), originOf(paragraph))
		const still = off.filter((format) => shows(read, from, to, format))
		return !still.length || draft.format(from, to, Object.fromEntries(still.map((format) => [format, false])))
	}

	// Puts `text` where [start, end) is. A line end in it starts a paragraph, a vertical tab breaks the line and a tab
	// is a tab; what's typed takes the formatting of what it replaces, and `change` on top of that. Paragraphs that
	// follow one another are joined where the text between them goes; a table stays, with whatever was in the range of
	// its cells' text gone. The caret is left after what was put in, or at `after`. Text that was `typed` is a step the
	// typing after it goes on with (see commit). False, with nothing changed, where the document can't take it: a
	// footnote would lose its reference, a field would be cut in two.
	private replace(
		start: Place,
		end: Place,
		text: string,
		change?: Partial<Formatting>,
		after?: Place,
		typed = false,
	): boolean {
		const head = start.container[start.index]
		if (head?.kind !== 'paragraph') return false
		// Enter in an empty list item ends the list there
		if (text === '\n' && samePlace(start, end) && head.list && !this.length(head)) {
			const draft = this.draft(head)
			if (!draft) return false
			draft.unlist(head.list)
			const entries = [{xml: draft.xml(), origin: originOf(head)}]
			this.commit([{container: start.container, index: start.index, count: 1, entries}], start)
			return true
		}
		const stretches = this.stretches(start, end)
		if (!stretches) return false
		// The last stretch first, so the blocks before it are still where they were counted
		const changes: Change[] = []
		let caret = start
		for (const [i, {container, from, to}] of stretches.entries()) {
			const paragraphs = container.slice(from, to + 1) as Paragraph[]
			const a = i === 0 ? start.offset : 0
			const b = i === stretches.length - 1 ? end.offset : this.length(paragraphs[paragraphs.length - 1])
			const typed = i === 0 ? text : ''
			if (paragraphs.length === 1 && a === b && !typed) continue
			const drafts = paragraphs.map((paragraph) => this.draft(paragraph))
			if (drafts.includes(undefined)) return false
			const [first, ...rest] = drafts as Draft[]
			const like = typed && (rest.length || a < b) && a < first.length ? first.formatAt(a) : undefined
			if (!rest.length) {
				if (!first.remove(a, b)) return false
			} else {
				if (!first.remove(a, first.length)) return false
				if (rest.some((draft, k) => !draft.remove(0, k === rest.length - 1 ? b : draft.length))) return false
				// What's left of each (the end of a bookmark, say) goes with the paragraph they're joined to
				for (const draft of rest) first.append(draft)
			}
			const written = [first]
			if (typed) {
				const lines = typed.split('\n')
				const run = lines.join('').replace(/\v/g, '\n')
				const where = first.insert(a, run, like)
				if (where === undefined) return false
				if (change && !this.format(first, paragraphs[0], where, where + run.length, change)) return false
				// Divided from the last line end back, so each place still counts from the paragraph's start. A paragraph
				// begun at the end of one whose style names another for what follows (a heading's) is in that style.
				let at = where + run.length
				for (let line = lines.length - 1; line > 0; line--) {
					at -= lines[line].length
					const following = lines.length === 2 && !rest.length && at === first.length ? paragraphs[0].next : undefined
					const tail = first.split(at, following)
					if (!tail) return false
					written.splice(1, 0, tail)
				}
				caret =
					lines.length > 1
						? {container, index: from + lines.length - 1, offset: lines[lines.length - 1].length}
						: {container, index: from, offset: where + run.length}
			}
			const origin = originOf(paragraphs[0])
			const entries = written.map((draft) => ({xml: draft.xml(), origin}))
			changes.unshift({container, index: from, count: paragraphs.length, entries})
		}
		if (changes.length) this.commit(changes, after ?? caret, typed)
		return true
	}

	// A deletion at a caret. In the text the caret is in, it's the browser's to make ('native'), unless what the browser
	// says it would delete (`target`) isn't in that text, at the caret. At the start of a paragraph it takes a list item
	// out of its list, then joins the paragraph to the one before, where there is one; at the end it joins the one after.
	// Beside an object it takes the object, and beside text the caret isn't in (in another run, or on another page) a
	// character of that. False where the document can't take it.
	private erase(caret: Place, backward: boolean, target?: AbstractRange): boolean | 'native' {
		const {container, index, offset} = caret
		const paragraph = container[index] as Paragraph
		const selection = this.options.host.ownerDocument.getSelection()
		if (backward ? offset === 0 : offset === this.length(paragraph)) {
			if (backward && paragraph.list) {
				const draft = this.draft(paragraph)
				if (!draft) return false
				draft.unlist(paragraph.list)
				this.commit([{container, index, count: 1, entries: [{xml: draft.xml(), origin: originOf(paragraph)}]}], caret)
				return true
			}
			// Past paragraphs that don't show, to the one that does
			const step = backward ? -1 : 1
			let other = index + step
			while (isHidden(container[other])) other += step
			const beside = container[other]
			// Nothing to join at the edge of the text, of a cell, or of a table: the caret stays, and nothing is said
			if (beside?.kind !== 'paragraph') return true
			return backward
				? this.replace({container, index: other, offset: this.length(beside)}, caret, '')
				: this.replace(caret, {container, index: other, offset: 0}, '')
		}
		let at = 0
		for (const unit of this.units(paragraph)) {
			const end = at + unit.length
			if (backward ? offset > at && offset <= end : offset >= at && offset < end) {
				if (unit.kind !== 'text') {
					const from = backward ? offset - 1 : offset
					return this.replace({...caret, offset: from}, {...caret, offset: from + 1}, '')
				}
				const within = offset - at
				const elsewhere =
					target &&
					(target.startContainer !== unit.node ||
						target.endContainer !== unit.node ||
						(backward ? target.endOffset : target.startOffset) !== within)
				if (selection?.anchorNode === unit.node && selection.anchorOffset === within && !elsewhere) return 'native'
				const text = unit.node.data
				const size = backward ? lastGrapheme(text.slice(0, within)).length : firstGrapheme(text.slice(within)).length
				const from = backward ? within - size : within
				// The caret stays where it is beside a page break, which is where the text went in effect
				const near = this.fragmentOf(unit.node) === this.fragmentOf(selection?.anchorNode)
				this.begin(paragraph, 'delete')
				unit.node.deleteData(from, size)
				if (near) selection?.collapse(unit.node, from)
				this.settle(paragraph)
				return true
			}
			at = end
		}
		return false
	}

	// Tab moves to the next cell in a table (Shift, to the one before), moves a list item a level in or out from its
	// start, and anywhere else is a tab
	private tab(backward: boolean) {
		const range = this.range()
		if (!range) return this.options.onRefuse()
		const {start, end} = range.collapsed ? range : this.chosen(range)
		const paragraph = start.container[start.index] as Paragraph
		const cells = this.cellsAround(start.container)
		if (cells) {
			const cell = cells.all[cells.index + (backward ? -1 : 1)]
			const blocks = cell?.blocks.filter((block) => block.kind === 'paragraph') ?? []
			if (!cell || !blocks.length) return
			// Its text selected, for typing to replace
			const tail = blocks[blocks.length - 1] as Paragraph
			this.restoreSelection({
				anchor: {container: cell.blocks, index: cell.blocks.indexOf(blocks[0]), offset: 0},
				focus: {container: cell.blocks, index: cell.blocks.indexOf(tail), offset: this.length(tail)},
			})
			this.reveal()
			return
		}
		if (samePlace(start, end) && start.offset === 0 && paragraph.list?.direct) {
			const level = Math.min(8, Math.max(0, paragraph.list.ilvl + (backward ? -1 : 1)))
			const draft = level === paragraph.list.ilvl ? undefined : this.draft(paragraph)
			if (!draft) return
			draft.relevel(paragraph.list, level)
			const entry = {xml: draft.xml(), origin: originOf(paragraph)}
			// A list defines the levels it has: no further in than those
			if (!this.options.model.derive(entry.xml, entry.origin).numbering) return this.options.onRefuse()
			this.commit([{container: start.container, index: start.index, count: 1, entries: [entry]}], start)
			return
		}
		if (backward) return
		if (!this.replace(start, end, '\t', samePlace(start, end) ? this.armedAt(start)?.change : undefined))
			this.options.onRefuse()
	}

	// The cells of the table that a cell's blocks are in, in reading order, and which of them it is
	private cellsAround(container: Block[]): {all: Cell[]; index: number} | undefined {
		const within = (blocks: Block[]): {all: Cell[]; index: number} | undefined => {
			for (const block of blocks) {
				if (block.kind !== 'table') continue
				const all = block.rows.flatMap((row) => row.cells)
				const index = all.findIndex((cell) => cell.blocks === container)
				if (index >= 0) return {all, index}
				for (const cell of all) {
					const found = within(cell.blocks)
					if (found) return found
				}
			}
			return undefined
		}
		// A section's own blocks are in no table
		if (this.options.model.sections.some((section) => section.blocks === container)) return undefined
		for (const section of this.options.model.sections) {
			const found = within(section.blocks)
			if (found) return found
		}
		return undefined
	}

	// Makes changes as one step that undo takes back, leaving the selection at `after`. Text that was `typed` where the
	// browser couldn't be left to put it (over more than one run's text, or in formatting just switched) is typing all
	// the same: what's typed next goes on with the step, as begin() has it.
	private commit(changes: Change[], after: Place | Selected | undefined, typed = false) {
		const before = this.selection()
		const selected = after && ('anchor' in after ? after : {anchor: after, focus: after})
		const [kind, time] = typed ? (['insert', Date.now()] as const) : (['edit', 0] as const)
		this.undoStack.push({changes: this.exchange(changes), before, after: selected, kind, time})
		if (this.undoStack.length > 200) this.undoStack.shift()
		this.redoStack = []
		this.finish(selected)
	}

	private travel(direction: 'undo' | 'redo') {
		const [from, to] = direction === 'undo' ? [this.undoStack, this.redoStack] : [this.redoStack, this.undoStack]
		const step = this.composition ? undefined : from.pop()
		if (!step) return
		to.push({...step, changes: this.exchange(step.changes), time: 0})
		this.finish(direction === 'undo' ? step.before : step.after)
	}

	// After paragraphs were exchanged: the pages laid out around them, and the selection where it belongs, in view
	private finish(selection: Selected | undefined) {
		this.armed = undefined
		this.options.layout()
		this.restoreSelection(selection)
		this.reveal()
		this.options.onChange()
	}

	// Puts the paragraphs read from each change's XML where its blocks are, in the model and on the pages, and returns
	// the changes that take that back
	private exchange(changes: Change[]): Change[] {
		const {registry, model} = this.options
		const inverse: Change[] = []
		const beside = new Set<Block | undefined>()
		for (const {container, index, count, entries} of changes) {
			if (!this.opened.has(container)) this.opened.set(container, [...container])
			const old = container.slice(index, index + count) as Paragraph[]
			const was = old.map((paragraph) => ({xml: this.xml(paragraph), origin: originOf(paragraph)}))
			inverse.unshift({container, index, count: entries.length, entries: was})
			const next = entries.map(({xml, origin}) => model.derive(xml, origin))
			container.splice(index, count, ...next)
			for (const paragraph of old) this.pending.delete(paragraph)
			for (const {origin} of [...was, ...entries]) this.touched.add(origin)
			this.options.swap(
				old,
				next.flatMap((paragraph) => renderInPlace(paragraph, container, registry)),
			)
			// The nearest blocks that show, on either side
			let before = index - 1
			while (isHidden(container[before])) before--
			let after = index + next.length
			while (isHidden(container[after])) after++
			beside.add(container[before]).add(container[after])
		}
		// What's beside them may change with them: the space between paragraphs of one style, a border they share
		for (const block of beside) {
			if (block?.kind !== 'paragraph' || !registry.homes.get(block)?.includes(block)) continue
			if (displaced(block, registry)) this.refresh(block)
		}
		return inverse
	}

	// Renders a paragraph again where it stands, as its XML now is
	private refresh(paragraph: Paragraph) {
		const {registry, model} = this.options
		const container = registry.homes.get(paragraph)!
		if (!this.opened.has(container)) this.opened.set(container, [...container])
		const next = model.derive(this.xml(paragraph), originOf(paragraph))
		container.splice(container.indexOf(paragraph), 1, next)
		this.pending.delete(paragraph)
		this.options.swap([paragraph], renderInPlace(next, container, registry))
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Text typed in the DOM

	private insertAt(position: {node: Node; offset: number}, text: string) {
		const doc = this.options.host.ownerDocument
		let {node, offset} = position
		if (node.nodeType !== Node.TEXT_NODE) {
			const created = doc.createTextNode('')
			node.insertBefore(created, node.childNodes[offset] ?? null)
			node = created
			offset = 0
		}
		;(node as Text).insertData(offset, text)
		doc.getSelection()?.collapse(node, offset + text.length)
	}

	// Collects each slot's text from the paragraph's spans. Text the browser put outside any span, at the edge of a
	// run's text, joins that run first.
	reconcile(paragraph: Paragraph, normalize = true) {
		const {registry} = this.options
		const fragments = registry.fragments.get(paragraph) ?? []
		if (normalize) for (const fragment of fragments) this.adopt(fragment, paragraph)
		const pending = this.pending.get(paragraph) ?? new Map<Slot, string>()
		// Every slot starts empty, so one whose text is all gone (deleted, or undone) is read back as empty
		const collected = new Map<Slot, string>()
		for (const slot of [...refsOf(paragraph), ...pending.keys()]) collected.set(slot, '')
		for (const fragment of fragments) {
			for (const node of textNodes(paragraph, registry, fragment)) {
				const slot = this.ownerOf(node, fragment)
				if (slot) collected.set(slot, (collected.get(slot) ?? '') + node.data)
			}
		}
		for (const [slot, text] of collected)
			if (pending.has(slot) || text !== (isRef(slot) ? slot.text : '')) pending.set(slot, text)
		if (pending.size) {
			this.pending.set(paragraph, pending)
			this.touched.add(originOf(paragraph))
		}
		if (!normalize) return
		// A mark holds a line where its part of the paragraph shows nothing or ends with a line break, as it's rendered:
		// the text that was there may just have been deleted. The part before a page break has the break's mark, and the
		// last one the paragraph's.
		let shown: Unit | undefined
		const hold = (next?: HTMLElement) => {
			const lineBreak = shown?.kind === 'object' && registry.islands.get(shown.node)?.kind === 'break'
			const mark = (!shown || lineBreak) && (this.markOf(paragraph, next) ?? (next ? undefined : fragments.at(-1)))
			if (mark && mark.lastChild?.nodeName !== 'BR') mark.append(mark.ownerDocument.createElement('br'))
			shown = undefined
		}
		for (const unit of this.units(paragraph)) {
			if (unit.kind !== 'break') shown = unit
			else if (!unit.end) hold(unit.node)
		}
		hold()
	}

	private ownerOf(node: Node, fragment: HTMLElement): Slot | undefined {
		for (let current = node.parentNode; current && current !== fragment.parentNode; current = current.parentNode) {
			if (current.nodeType !== Node.ELEMENT_NODE) continue
			const slot = this.options.registry.refs.get(current as Element)
			if (slot) return slot
			if (locked(current)) return undefined
		}
		return undefined
	}

	// The object a node is in: the outermost thing around it in its paragraph part that no caret can be in
	private islandOf(node: Node, fragment: HTMLElement): HTMLElement | undefined {
		let island: HTMLElement | undefined
		for (let current: Node | null = node; current && current !== fragment; current = current.parentNode)
			if (locked(current)) island = current as HTMLElement
		return island
	}

	// Whether a node is inside an object, or is one
	private inObject(node: Node): boolean {
		const fragment = this.fragmentOf(node)
		return Boolean(fragment && this.islandOf(node, fragment))
	}

	// Text in a part of a paragraph that no slot holds: what the browser put outside the runs' spans
	private strays(fragment: HTMLElement, paragraph: Paragraph): Text[] {
		return textNodes(paragraph, this.options.registry, fragment).filter(
			(node) => node.length && !this.ownerOf(node, fragment) && !this.islandOf(node, fragment),
		)
	}

	// Has stray text at the edge of a run's text join that run: the one before it, else the one after. Text with no run
	// beside it stays where it is, to go in through the paragraph's XML.
	private adopt(fragment: HTMLElement, paragraph: Paragraph) {
		const {registry} = this.options
		const selection = fragment.ownerDocument.getSelection()
		for (const node of this.strays(fragment, paragraph)) {
			const before = neighbour(node, fragment, -1, registry)
			const after = before ? undefined : neighbour(node, fragment, 1, registry)
			if (!before && !after) continue
			const keep =
				selection && (selection.anchorNode === node || selection.focusNode === node)
					? {a: selection.anchorOffset, f: selection.focusOffset, an: selection.anchorNode!, fn: selection.focusNode!}
					: undefined
			if (before) before.append(node)
			else after!.prepend(node)
			if (keep) selection!.setBaseAndExtent(keep.an, keep.a, keep.fn, keep.f)
		}
	}

	// Whether a step is typing (or deleting) in this paragraph, where it now stands
	private typedIn(step: Step, paragraph: Paragraph): boolean {
		const [change] = step.changes
		const container = this.options.registry.homes.get(paragraph)
		return step.kind !== 'edit' && change.container === container && container[change.index] === paragraph
	}

	// Takes back the step begun for typing in a paragraph, where nothing came of it: there's nothing to undo. That's a
	// step that would put back this paragraph alone, as it is.
	private idle(paragraph: Paragraph) {
		const step = this.undoStack[this.undoStack.length - 1]
		if (step?.kind !== 'insert' || !this.typedIn(step, paragraph)) return
		const [{count, entries}, ...others] = step.changes
		if (!others.length && count === 1 && entries.length === 1 && entries[0].xml === this.xml(paragraph))
			this.undoStack.pop()
	}

	// Starts an undo step, or continues the last one: typing (or deleting) in one paragraph without a pause is one step
	private begin(paragraph: Paragraph, kind: 'insert' | 'delete') {
		const container = this.options.registry.homes.get(paragraph)
		if (!container) return
		const last = this.undoStack[this.undoStack.length - 1]
		if (last && last.kind === kind && this.typedIn(last, paragraph) && Date.now() - last.time < 1000) return
		this.reconcile(paragraph, false)
		const entries = [{xml: this.xml(paragraph), origin: originOf(paragraph)}]
		const changes = [{container, index: container.indexOf(paragraph), count: 1, entries}]
		this.undoStack.push({changes, before: this.selection(), kind, time: Date.now()})
		if (this.undoStack.length > 200) this.undoStack.shift()
		this.redoStack = []
	}
}

// The range a deletion at a collapsed caret would remove: the selection extended by the deletion's unit, which is
// then put back
function extent(selection: Selection, type: string): AbstractRange {
	const range = selection.getRangeAt(0).cloneRange()
	if (!range.collapsed || !type.startsWith('delete') || typeof selection.modify !== 'function') return range
	const backward = type.includes('Backward')
	const unit = type.includes('Word')
		? 'word'
		: type.includes('HardLine')
			? 'paragraphboundary'
			: type.includes('Line')
				? 'lineboundary'
				: 'character'
	selection.modify('extend', backward ? 'backward' : 'forward', unit)
	const extended = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : range
	selection.removeAllRanges()
	selection.addRange(range)
	return extended
}

// Where a caret away from [start, end) of a paragraph is in the text once `text` is there instead. Undefined for a
// caret in or beside what's replaced, which goes with what replaces it.
function carried(caret: Place, start: Place, end: Place, text: string): Place | undefined {
	if (caret.container !== start.container || caret.index !== start.index || caret.offset < start.offset) return caret
	if (caret.offset <= end.offset) return undefined
	return {...caret, offset: caret.offset + text.length - (end.offset - start.offset)}
}

// User-perceived characters, so a deletion never splits an emoji or a letter from its accent
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined
const graphemes = (text: string) =>
	segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text)
const lastGrapheme = (text: string) => graphemes(text.slice(-16)).at(-1) ?? ''
const firstGrapheme = (text: string) => graphemes(text.slice(0, 16))[0] ?? ''
// Whether a place in a text is inside one of those characters. Plain letters are each one of their own. It's asked of
// the unit before the place, whose character ends at the place or goes on past it, and not of the unit after it: for
// the first half of an emoji, Safari gives a character that starts where the one before it does.
const splits = (text: string, at: number) => {
	if (at <= 0 || at >= text.length || (text.charCodeAt(at - 1) < 0x300 && text.charCodeAt(at) < 0x300)) return false
	const from = Math.max(0, at - 16)
	const part = segmenter?.segment(text.slice(from, at + 16)).containing(at - from - 1)
	return part ? part.index + part.segment.length > at - from : (text.charCodeAt(at) & 0xfc00) === 0xdc00
}

const isRef = (slot: Slot): slot is TextRef => slot.id >= 0

// Whether any of the text in [from, to) of a paragraph, as the model read it, has a format
function shows(paragraph: Paragraph, from: number, to: number, format: Format): boolean {
	const seen = new Set<TextRef>()
	let at = 0
	for (const inline of paragraph.inlines) {
		if (inline.kind === 'anchor' || inline.kind === 'separator') continue
		const ref = inline.kind === 'text' || inline.kind === 'tab' ? inline.ref : undefined
		if (ref && seen.has(ref)) continue
		if (ref) seen.add(ref)
		const length = ref ? ref.text.length : 1
		if (inline.kind === 'text' && at < to && at + length > from) {
			const {bold, boldCs, italic, italicCs, underline} = inline.style
			if (
				format === 'bold'
					? bold || boldCs
					: format === 'italic'
						? italic || italicCs
						: underline && underline !== 'none'
			)
				return true
		}
		at += length
	}
	return false
}

const childIndex = (node: Node) => Array.prototype.indexOf.call(node.parentNode!.childNodes, node)

// A caret's foothold (see foot()): an image, which a caret can be beside in every browser, of no size, and at the top
// of its line, where it adds nothing to the line's height
function footholdOf(doc: Document): HTMLElement {
	const image = doc.createElement('img')
	image.setAttribute('aria-hidden', 'true')
	image.style.cssText = 'display:inline;width:0;height:0;vertical-align:top'
	return image
}

// The end of the caret's line that a key asks for, if it asks for one: Home and End, or on Apple's platforms (where
// those scroll the document) Command with the arrow that points to that end
function lineKey(event: KeyboardEvent, rtl: boolean): 'start' | 'end' | undefined {
	if (event.altKey || event.ctrlKey) return undefined
	const key = event.key.toLowerCase()
	const [start, end] = apple() ? (rtl ? ['arrowright', 'arrowleft'] : ['arrowleft', 'arrowright']) : ['home', 'end']
	if (event.metaKey !== apple()) return undefined
	return key === start ? 'start' : key === end ? 'end' : undefined
}

const apple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform)

// Whether two boxes are on one line. They needn't be as tall as each other: the middle of the shorter is within the
// taller.
function sameLine(a: DOMRect, b: DOMRect): boolean {
	const [short, tall] = a.height < b.height ? [a, b] : [b, a]
	const middle = (short.top + short.bottom) / 2
	return tall.top <= middle && middle <= tall.bottom
}

// Whether nothing comes after a position in what `within` holds
function endsAt(node: Node, offset: number, within: Node): boolean {
	if (offset < (node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length)) return false
	for (let current = node; current !== within; current = current.parentNode!) if (current.nextSibling) return false
	return true
}

// The w:t elements a paragraph's text comes from
function refsOf(paragraph: Paragraph): Set<TextRef> {
	const refs = new Set<TextRef>()
	for (const inline of paragraph.inlines)
		if ((inline.kind === 'text' || inline.kind === 'tab') && inline.ref) refs.add(inline.ref)
	return refs
}

// Typed or pasted text as the document takes it: a line end starts a paragraph, a line separator (or the vertical tab
// Word copies one as) breaks the line, a tab is a tab, and no other control character goes in
function clean(text: string): string {
	return text
		.replace(/\r\n?|[\f\u2029]/g, '\n')
		.replace(/\u2028/g, '\v')
		.replace(/[^\n\t\v\P{Cc}]/gu, '')
}

function texts(root: Node): Text[] {
	const out: Text[] = []
	const walk = (node: Node) => {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === Node.TEXT_NODE) out.push(child as Text)
			else walk(child)
		}
	}
	walk(root)
	return out
}

// The paragraph's editable text nodes (outside objects), in order, across all its parts or in one part
function textNodes(paragraph: Paragraph, registry: Registry, only?: HTMLElement): Text[] {
	const out: Text[] = []
	const walk = (node: Node) => {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === Node.TEXT_NODE) out.push(child as Text)
			else if (child.nodeType === Node.ELEMENT_NODE && (!locked(child) || registry.refs.has(child as Element)))
				walk(child)
		}
	}
	for (const fragment of only ? [only] : (registry.fragments.get(paragraph) ?? [])) walk(fragment)
	return out
}

// The span of a run's text right beside a node in its paragraph part, with nothing between them that takes a place
function neighbour(node: Node, fragment: HTMLElement, direction: 1 | -1, registry: Registry): HTMLElement | undefined {
	// The part's leaves in order: text, objects (whole), and empty slot spans
	const leaves: Node[] = []
	const walk = (parent: Node) => {
		for (let child = parent.firstChild; child; child = child.nextSibling) {
			if (
				child.nodeType === Node.TEXT_NODE ||
				locked(child) ||
				(registry.refs.has(child as Element) && !child.firstChild)
			)
				leaves.push(child)
			else if (child.nodeType === Node.ELEMENT_NODE) walk(child)
		}
	}
	walk(fragment)
	const owner = (leaf: Node) => {
		for (
			let parent: Node | null = leaf.nodeType === Node.TEXT_NODE ? leaf.parentNode : leaf;
			parent && parent !== fragment.parentNode;
			parent = parent.parentNode
		) {
			if (registry.refs.has(parent as Element) && !locked(parent) && !registry.marks.has(parent as Element))
				return parent as HTMLElement
		}
		return undefined
	}
	for (let i = leaves.indexOf(node) + direction; i >= 0 && i < leaves.length; i += direction) {
		const leaf = leaves[i]
		if (leaf.nodeType === Node.TEXT_NODE && !(leaf as Text).length) continue
		const span = locked(leaf) ? undefined : owner(leaf)
		if (span) return span
		// Past other stray text and what floats beside the text; anything else stands between
		if (leaf.nodeType !== Node.TEXT_NODE && registry.islands.get(leaf as Element)?.kind !== 'anchor') return undefined
	}
	return undefined
}
