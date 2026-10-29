// Text editing on the rendered pages. The browser does the typing (caret, selection, IME, spellcheck), and we keep
// every change inside the text of one paragraph: no splitting or joining paragraphs, no deleting pictures, tabs or
// fields, no formatting. After each change the paragraph's DOM is read back into the slots (w:t elements, or new
// runs) its text came from. Undo is ours too, kept as snapshots of those slots, because re-pagination moves the DOM
// under the browser's own undo history.

import type {XmlElement} from '@/features/files/components/file-viewer/shared/xml'

import type {Inline, Insertion, Paragraph, Slot, TextRef} from './model'
import {applyCss, locked, type Registry} from './render'

// Edits we let the browser make once they're confined to one paragraph's text
const EDITS = new Set([
	'insertText',
	'insertReplacementText',
	'insertFromPaste',
	'insertFromPasteAsQuotation',
	'insertFromYank',
	'insertTranspose',
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

// A place in a slot's text, which survives the DOM being split and rejoined across pages
type Point = {slot: number; offset: number}
type Snapshot = {texts: Map<number, string>; selection?: {anchor: Point; focus: Point}}
type Step = {paragraph: Paragraph; kind: string; before: Snapshot; after?: Snapshot; time: number}

type Target = {paragraph: Paragraph; range: Range; manual: boolean; crossing: boolean}

export type EditorOptions = {
	host: HTMLElement
	registry: Registry
	// The CSS a new run's text renders with, inside its paragraph
	style: (paragraph: Paragraph, inline: Inline | undefined) => Record<string, string>
	onEdit: (paragraph: Paragraph) => void
	onRefuse: () => void
}

export class Editor {
	// Current text of every slot that has changed since opening
	readonly texts = new Map<number, string>()
	readonly slots = new Map<number, Slot>()
	private undoStack: Step[] = []
	private redoStack: Step[] = []
	private composing: Paragraph | undefined
	// The paragraph the edit in progress targeted, which its input event reads back
	private active: Paragraph | undefined
	private enabled = false

	constructor(private options: EditorOptions) {}

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
		} else {
			host.removeAttribute('contenteditable')
			host.removeEventListener('keydown', this.keyDown)
			host.removeEventListener('beforeinput', this.beforeInput)
			host.removeEventListener('input', this.input)
			host.removeEventListener('compositionstart', this.compositionStart)
			host.removeEventListener('compositionend', this.compositionEnd)
			host.removeEventListener('drop', this.drop)
		}
	}

	text(slot: Slot): string {
		return this.texts.get(slot.id) ?? (slot.id >= 0 ? (slot as TextRef).text : '')
	}

	// The slots whose text differs from `baseline` (by id), or from the file as opened
	changed(baseline?: Map<number, string>): Map<Slot, string> {
		const out = new Map<Slot, string>()
		for (const [id, text] of this.texts) {
			const slot = this.slots.get(id)!
			const before = baseline?.get(id) ?? (id >= 0 ? (slot as TextRef).text : '')
			if (text !== before) out.set(slot, text)
		}
		return out
	}

	// Where the selection is in slot terms, to put it back after the DOM moves
	selection(): Snapshot['selection'] {
		const selection = this.options.host.ownerDocument.getSelection()
		if (!selection?.anchorNode || !selection.focusNode) return undefined
		const anchor = this.point(selection.anchorNode, selection.anchorOffset)
		const focus = this.point(selection.focusNode, selection.focusOffset)
		return anchor && focus ? {anchor, focus} : undefined
	}

	restoreSelection(saved: Snapshot['selection']) {
		if (!saved) return
		const anchor = this.position(saved.anchor)
		const focus = this.position(saved.focus)
		if (anchor && focus)
			this.options.host.ownerDocument
				.getSelection()
				?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
	}

	private keyDown = (event: KeyboardEvent) => {
		if (this.composing) return
		const doc = this.options.host.ownerDocument
		const key = event.key.toLowerCase()
		// Undo and redo: browsers only send history input events while their own undo history (which we never let
		// them apply) has something in it, so redo would never arrive
		if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y')) {
			event.preventDefault()
			this.history(key === 'z' && !event.shiftKey ? 'undo' : 'redo')
			return
		}
		// Bold, italic and underline: plain-text editing sends no input event for them to be refused at
		if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			!event.shiftKey &&
			(key === 'b' || key === 'i' || key === 'u')
		)
			return this.refuse(event)
		// Deleting across a page break: Safari wouldn't even send the input event
		if ((key === 'backspace' || key === 'delete') && !event.metaKey && !event.ctrlKey) {
			const selection = doc.getSelection()
			const crossing = selection?.rangeCount
				? this.acrossPageBreak(selection, key === 'backspace' ? 'deleteContentBackward' : 'deleteContentForward')
				: undefined
			const paragraph = crossing && this.paragraphAt(crossing.startContainer)
			if (!crossing || !paragraph?.editable) return
			event.preventDefault()
			const range = doc.createRange()
			range.setStart(crossing.startContainer, crossing.startOffset)
			range.setEnd(crossing.endContainer, crossing.endOffset)
			this.begin(paragraph, 'delete')
			this.deleteRange({paragraph, range, manual: true, crossing: true})
			this.settle(paragraph)
		}
	}

	private beforeInput = (event: InputEvent) => {
		const type = event.inputType
		const doc = this.options.host.ownerDocument
		if (type === 'historyUndo' || type === 'historyRedo') {
			event.preventDefault()
			this.history(type === 'historyUndo' ? 'undo' : 'redo')
			return
		}
		// IME composition can't be cancelled; it's read back when it ends
		if (type === 'insertCompositionText' || this.composing) return
		// Paragraph breaks, formatting, links, lists, drag and drop: the document's structure stays as it is
		if (!EDITS.has(type)) return this.refuse(event)
		const target = this.target(event)
		if (!target) return this.refuse(event)
		this.active = target.paragraph
		this.begin(target.paragraph, type.startsWith('delete') ? 'delete' : 'insert')
		const pasted = type.startsWith('insertFrom')
			? (event.dataTransfer?.getData('text/plain') ?? event.data ?? '')
			: event.data
		const text = pasted === null || pasted === undefined ? '' : plain(pasted)
		// Pasted text, text with line breaks, and edits across a page break are done by hand; the rest natively
		if (target.manual || type.startsWith('insertFrom') || (pasted && text !== pasted)) {
			event.preventDefault()
			if (!target.range.collapsed) this.deleteRange(target)
			if (text && type.startsWith('insert')) this.insertAt(target.range, text)
			// The caret goes where the text went, except beside a page break, where it already is in effect
			else if (!target.crossing) doc.getSelection()?.collapse(target.range.startContainer, target.range.startOffset)
			this.active = undefined
			this.settle(target.paragraph)
		}
	}

	private input = () => {
		const paragraph =
			this.composing ?? this.active ?? this.paragraphAt(this.options.host.ownerDocument.getSelection()?.anchorNode)
		this.active = undefined
		if (paragraph) this.settle(paragraph)
	}

	private compositionStart = () => {
		this.composing = this.paragraphAt(this.options.host.ownerDocument.getSelection()?.anchorNode)
		if (this.composing) this.begin(this.composing, 'insert')
	}

	private compositionEnd = () => {
		const paragraph = this.composing
		this.composing = undefined
		if (paragraph) this.settle(paragraph)
	}

	private drop = (event: DragEvent) => this.refuse(event)

	private refuse(event: Event) {
		event.preventDefault()
		this.options.onRefuse()
	}

	// Reads a paragraph back and records the step
	private settle(paragraph: Paragraph) {
		this.reconcile(paragraph, !this.composing)
		const step = this.undoStack[this.undoStack.length - 1]
		if (step?.paragraph === paragraph) {
			step.after = this.snapshot(paragraph)
			step.time = Date.now()
		}
		this.options.onEdit(paragraph)
	}

	// The range an edit applies to, kept to the text of one editable paragraph: a selection running past it (a triple
	// click, select all, a deletion at its edge) is cut back to it, and anything that would remove a picture, tab or
	// field is refused
	private target(event: InputEvent): Target | undefined {
		const {registry, host} = this.options
		const doc = host.ownerDocument
		const selection = doc.getSelection()
		// Browsers don't always say what an edit will delete (Chrome editing plaintext-only never does); then it's the
		// selection, or for a deletion at a caret, what the caret would move over
		// Across a page break the range is ours, not what the browser would do, so it's applied by hand
		const crossing = selection?.rangeCount ? this.acrossPageBreak(selection, event.inputType) : undefined
		const source =
			crossing ??
			event.getTargetRanges?.()[0] ??
			(selection?.rangeCount ? extent(selection, event.inputType) : undefined)
		if (!source) return undefined
		const range = doc.createRange()
		range.setStart(source.startContainer, source.startOffset)
		range.setEnd(source.endContainer, source.endOffset)
		const paragraph = this.paragraphAt(range.startContainer) ?? this.paragraphAt(range.endContainer)
		if (!paragraph?.editable) return undefined
		const deleting = event.inputType.startsWith('delete')
		const nodes = textNodes(paragraph, registry).filter(
			(node) => this.ownerOf(node, this.fragmentOf(node)!) && !this.insideIsland(node, this.fragmentOf(node)!),
		)
		const first = nodes[0]
		const last = nodes[nodes.length - 1]
		let trimmed = false
		if (first && last) {
			const position = (node: Node, offset: number) => {
				const point = doc.createRange()
				point.setStart(node, offset)
				return point
			}
			const start = position(first, 0)
			const end = position(last, last.length)
			if (range.compareBoundaryPoints(Range.START_TO_START, start) < 0) {
				range.setStart(first, 0)
				trimmed = true
			}
			if (range.compareBoundaryPoints(Range.END_TO_END, end) > 0) {
				range.setEnd(last, last.length)
				trimmed = true
			}
			// A range that was wholly outside the text: the caret goes to its nearer end
			if (range.compareBoundaryPoints(Range.START_TO_END, start) < 0) range.setEnd(first, 0)
			if (range.compareBoundaryPoints(Range.END_TO_START, end) > 0) range.setStart(last, last.length)
		} else if (!range.collapsed || deleting || !this.ownerOfPosition(range)) {
			// No text yet: only typing at the paragraph's mark
			return undefined
		}
		if (range.collapsed && deleting) return undefined
		for (const fragment of registry.fragments.get(paragraph) ?? []) {
			for (const island of fragment.querySelectorAll('[contenteditable="false"]')) {
				if (
					!range.collapsed &&
					range.intersectsNode(island) &&
					!island.contains(range.startContainer) &&
					!island.contains(range.endContainer)
				)
					return undefined
			}
		}
		const manual =
			Boolean(crossing) || trimmed || this.fragmentOf(range.startContainer) !== this.fragmentOf(range.endContainer)
		return {paragraph, range, manual, crossing: Boolean(crossing)}
	}

	// A deletion at the edge of a paragraph part split off by a page break takes a character from the part beside it:
	// left to the browser, the caret would wander into the page's furniture
	private acrossPageBreak(selection: Selection, type: string): AbstractRange | undefined {
		if (!selection.isCollapsed || !type.startsWith('delete') || type.includes('Line')) return undefined
		const {registry} = this.options
		const node = selection.anchorNode!
		const fragment = this.fragmentOf(node)
		const paragraph = fragment && registry.paragraphs.get(fragment)
		const fragments = paragraph ? (registry.fragments.get(paragraph) ?? []) : []
		const index = fragment ? fragments.indexOf(fragment) : -1
		const backward = type.includes('Backward')
		const neighbour = fragments[backward ? index - 1 : index + 1]
		if (!paragraph || index < 0 || !neighbour) return undefined
		const editable = (part: HTMLElement) =>
			textNodes(paragraph, registry, part).filter(
				(text) => this.ownerOf(text, part) && !this.insideIsland(text, part) && text.length,
			)
		const own = editable(fragment!)
		const edge = backward ? own[0] : own[own.length - 1]
		const caret = node.ownerDocument!.createRange()
		caret.setStart(node, selection.anchorOffset)
		const atEdge = !edge || (backward ? caret.comparePoint(edge, 0) >= 0 : caret.comparePoint(edge, edge.length) <= 0)
		const target = backward ? editable(neighbour).at(-1) : editable(neighbour)[0]
		if (!atEdge || !target) return undefined
		const range = node.ownerDocument!.createRange()
		const size = backward ? lastGrapheme(target.data).length : firstGrapheme(target.data).length
		range.setStart(target, backward ? target.length - size : 0)
		range.setEnd(target, backward ? target.length : size)
		return range
	}

	// Whether a collapsed range sits in a slot's span (an empty paragraph's mark), where typing can go
	private ownerOfPosition(range: Range): boolean {
		for (let node: Node | null = range.startContainer; node && node !== this.options.host; node = node.parentNode) {
			if (node.nodeType === Node.ELEMENT_NODE && this.options.registry.refs.has(node as Element)) return true
		}
		return false
	}

	private fragmentOf(node: Node | null): HTMLElement | undefined {
		const {registry, host} = this.options
		for (let current: Node | null = node; current && current !== host; current = current.parentNode) {
			if (current.nodeType === Node.ELEMENT_NODE && registry.paragraphs.has(current as Element))
				return current as HTMLElement
		}
		return undefined
	}

	private paragraphAt(node: Node | null | undefined): Paragraph | undefined {
		const fragment = node ? this.fragmentOf(node) : undefined
		return fragment && this.options.registry.paragraphs.get(fragment)
	}

	private insideIsland(node: Node, fragment: HTMLElement): boolean {
		for (let current: Node | null = node; current && current !== fragment; current = current.parentNode) {
			if (locked(current)) return true
		}
		return false
	}

	// Deletes the text in a range of one paragraph, touching only its text nodes, never the page structure between two
	// parts of a paragraph split by a page break
	private deleteRange(target: Target) {
		const {range, paragraph} = target
		for (const node of textNodes(paragraph, this.options.registry)) {
			if (!range.intersectsNode(node)) continue
			const from =
				node === range.startContainer ? range.startOffset : range.comparePoint(node, 0) >= 0 ? 0 : node.length
			const to =
				node === range.endContainer ? range.endOffset : range.comparePoint(node, node.length) <= 0 ? node.length : 0
			if (to > from) node.deleteData(from, to - from)
		}
		range.collapse(true)
	}

	private insertAt(range: Range, text: string) {
		const doc = this.options.host.ownerDocument
		let node = range.startContainer
		let offset = range.startOffset
		if (node.nodeType !== Node.TEXT_NODE) {
			const created = doc.createTextNode('')
			range.insertNode(created)
			node = created
			offset = 0
		}
		;(node as Text).insertData(offset, text)
		doc.getSelection()?.collapse(node, offset + text.length)
	}

	// Collects each slot's text from the paragraph's spans. Text the browser put outside any span (at a boundary, or
	// where a run's whole text was deleted) joins the run beside it, or becomes a new run if objects surround it.
	reconcile(paragraph: Paragraph, normalize = true) {
		const {registry} = this.options
		const fragments = registry.fragments.get(paragraph) ?? []
		if (normalize) for (const fragment of fragments) this.adopt(fragment, paragraph)
		// Every slot starts empty, so one whose text is all gone (deleted, or undone) is read back as empty
		const collected = new Map<number, string>()
		for (const slot of [...refsOf(paragraph), ...this.insertionsOf(paragraph)]) collected.set(slot.id, '')
		for (const fragment of fragments) {
			for (const node of textNodes(paragraph, registry, fragment)) {
				const slot = this.ownerOf(node, fragment)
				if (slot) collected.set(slot.id, (collected.get(slot.id) ?? '') + node.data)
			}
		}
		for (const [id, text] of collected) {
			const slot = this.slotById(id, paragraph)
			if (!slot) continue
			this.slots.set(id, slot)
			if (text !== this.text(slot) || this.texts.has(id)) this.texts.set(id, text)
		}
		// An empty paragraph keeps a line's height (its last block alone may be empty: after a page break in it, or a
		// part when a page cuts it)
		const last = fragments[fragments.length - 1]
		if (normalize && last && fragments.every((fragment) => !fragment.textContent) && !last.querySelector('br')) {
			const mark = [...last.querySelectorAll('span')].find((span) => registry.marks.has(span))
			;(mark ?? last).append(last.ownerDocument.createElement('br'))
		}
	}

	// The places text was typed into a paragraph where it had none: its mark, or beside an object
	private insertionsOf(paragraph: Paragraph): Insertion[] {
		return [...this.slots.values()].filter(
			(slot): slot is Insertion => 'paragraph' in slot && slot.paragraph === paragraph,
		)
	}

	private slotById(id: number, paragraph: Paragraph): Slot | undefined {
		const known = this.slots.get(id)
		if (known) return known
		for (const ref of refsOf(paragraph)) if (ref.id === id) return ref
		const span = this.options.registry.spans.get(id)?.[0]
		return span ? this.options.registry.refs.get(span) : undefined
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

	// Gives stray text a home: the slot of the text span next to it with nothing between, else a new slot beside the
	// object next to it, else the paragraph's mark
	private adopt(fragment: HTMLElement, paragraph: Paragraph) {
		const {registry, style} = this.options
		const doc = fragment.ownerDocument
		for (const node of textNodes(paragraph, registry, fragment)) {
			if (!node.length || this.ownerOf(node, fragment) || this.insideIsland(node, fragment)) continue
			const selection = doc.getSelection()
			const keep =
				selection && (selection.anchorNode === node || selection.focusNode === node)
					? {a: selection.anchorOffset, f: selection.focusOffset, an: selection.anchorNode!, fn: selection.focusNode!}
					: undefined
			const before = neighbour(node, fragment, -1, registry)
			const after = neighbour(node, fragment, 1, registry)
			const object = (side: typeof before) => (side && 'inline' in side ? placed(side.inline) : undefined)
			const mark = [...fragment.querySelectorAll('span')].find(
				(element) => registry.marks.has(element) && registry.refs.has(element),
			)
			if (before && 'span' in before) before.span.append(node)
			else if (after && 'span' in after) after.span.prepend(node)
			else if (object(before) || object(after)) {
				// Between objects with no text beside it: a new w:t in the object's run
				const beside = (object(before) ?? object(after))!
				const holder = doc.createElement('span')
				applyCss(holder, style(paragraph, beside))
				node.replaceWith(holder)
				holder.append(node)
				registry.register(
					holder,
					registry.insertion(paragraph, {
						run: beside.run,
						node: beside.node,
						side: object(before) ? 'after' : 'before',
					}),
				)
			} else if (mark) mark.prepend(node)
			else {
				// Beside something no text can go next to (a field): the nearest run takes it
				const nearest = neighbour(node, fragment, -1, registry, true) ?? neighbour(node, fragment, 1, registry, true)
				if (nearest && 'span' in nearest) nearest.span.append(node)
			}
			if (keep) selection!.setBaseAndExtent(keep.an, keep.a, keep.fn, keep.f)
		}
	}

	private snapshot(paragraph: Paragraph): Snapshot {
		const texts = new Map<number, string>()
		const refs = refsOf(paragraph)
		for (const [id, spans] of this.options.registry.spans) {
			const slot = spans.length ? this.options.registry.refs.get(spans[0]) : undefined
			if (!slot || (slot.id >= 0 ? !refs.has(slot as TextRef) : (slot as Insertion).paragraph !== paragraph)) continue
			texts.set(id, this.text(slot))
		}
		return {texts, selection: this.selection()}
	}

	// Starts an undo step, or continues the last one: typing (or deleting) in one paragraph without a pause is one step
	private begin(paragraph: Paragraph, kind: string) {
		const last = this.undoStack[this.undoStack.length - 1]
		if (last && last.paragraph === paragraph && last.kind === kind && Date.now() - last.time < 1000) return
		this.reconcile(paragraph, false)
		this.undoStack.push({paragraph, kind, before: this.snapshot(paragraph), time: Date.now()})
		if (this.undoStack.length > 200) this.undoStack.shift()
		this.redoStack = []
	}

	private history(direction: 'undo' | 'redo') {
		const undoing = direction === 'undo'
		const [from, to] = undoing ? [this.undoStack, this.redoStack] : [this.redoStack, this.undoStack]
		const step = from.pop()
		if (!step) return
		const state = undoing ? step.before : step.after
		if (!state) return
		to.push(step)
		const {registry} = this.options
		// A slot made since the state was recorded (text typed where there was none) was empty then
		const texts = new Map(this.insertionsOf(step.paragraph).map((slot) => [slot.id, '']))
		for (const [id, text] of state.texts) texts.set(id, text)
		// Each stretch between a slot's tabs goes in its first span (re-pagination spreads text over pages again); the
		// tabs themselves can't be edited, so they're as they were
		for (const [id, text] of texts) {
			const pieces = text.split('\t')
			let piece = 0
			let filled = false
			for (const span of (registry.spans.get(id) ?? []).filter((element) => element.isConnected)) {
				if (locked(span)) {
					piece++
					filled = false
				} else {
					span.textContent = filled ? '' : (pieces[piece] ?? '')
					filled = true
				}
			}
		}
		this.reconcile(step.paragraph)
		this.restoreSelection(state.selection)
		step.time = 0
		this.options.onEdit(step.paragraph)
	}

	private point(node: Node, offset: number): Point | undefined {
		const fragment = this.fragmentOf(node)
		if (!fragment) return undefined
		let target: Text | undefined
		let within = offset
		if (node.nodeType === Node.TEXT_NODE) target = node as Text
		else {
			// An element position: the end of the text just before it, or the start of the text after it
			const child = node.childNodes[offset]
			const text = child ? firstText(child) : undefined
			target = text
			within = 0
			if (!target && offset > 0) {
				target = lastText(node.childNodes[offset - 1])
				within = target?.length ?? 0
			}
		}
		const slot = target && this.ownerOf(target, fragment)
		if (!slot || !target) return undefined
		let total = 0
		for (const span of this.options.registry.spans.get(slot.id) ?? []) {
			for (const text of texts(span)) {
				if (text === target) return {slot: slot.id, offset: total + within}
				total += text.length
			}
		}
		return undefined
	}

	private position(point: Point): {node: Node; offset: number} | undefined {
		let rest = point.offset
		let last: Text | undefined
		for (const span of (this.options.registry.spans.get(point.slot) ?? []).filter((element) => element.isConnected)) {
			// A tab counts in the text, but the caret goes beside it, never in it
			if (locked(span)) {
				if (rest === 0 && !last)
					return {node: span.parentNode!, offset: Array.prototype.indexOf.call(span.parentNode!.childNodes, span)}
				rest -= span.textContent?.length ?? 0
				continue
			}
			for (const text of texts(span)) {
				if (rest <= text.length) return {node: text, offset: Math.max(0, rest)}
				rest -= text.length
				last = text
			}
			if (!last && !span.firstChild) return {node: span, offset: 0}
		}
		return last ? {node: last, offset: last.length} : undefined
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

// User-perceived characters, so a deletion never splits an emoji or a letter from its accent
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined
const graphemes = (text: string) =>
	segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text)
const lastGrapheme = (text: string) => graphemes(text.slice(-16)).at(-1) ?? ''
const firstGrapheme = (text: string) => graphemes(text.slice(0, 16))[0] ?? ''

// An object that sits in a run, beside which typed text can go
type Placed = Inline & {run: XmlElement; node: XmlElement}
const placed = (inline: Inline | undefined): Placed | undefined =>
	inline && 'node' in inline && inline.node && inline.run ? (inline as Placed) : undefined

// The w:t elements a paragraph's text comes from
function refsOf(paragraph: Paragraph): Set<TextRef> {
	const refs = new Set<TextRef>()
	for (const inline of paragraph.inlines)
		if ((inline.kind === 'text' || inline.kind === 'tab') && inline.ref) refs.add(inline.ref)
	return refs
}

// Line breaks, tabs and control characters can't be typed into a run's text
function plain(text: string): string {
	return text.replace(/\r\n?|[\n\u2028\u2029\t\v\f]/g, ' ').replace(/\p{Cc}/gu, '')
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

const firstText = (node: Node): Text | undefined => (node.nodeType === Node.TEXT_NODE ? (node as Text) : texts(node)[0])
const lastText = (node: Node): Text | undefined =>
	node.nodeType === Node.TEXT_NODE ? (node as Text) : texts(node).at(-1)

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

// The nearest thing beside a node within its paragraph part, skipping floating objects: a slot's span (`span`), or
// an object in the text (`inline`); `spans` skips objects to find the nearest span
function neighbour(
	node: Node,
	fragment: HTMLElement,
	direction: 1 | -1,
	registry: Registry,
	spans = false,
): {span: HTMLElement} | {inline: Inline | undefined} | undefined {
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
		if (span) return {span}
		const inline = registry.islands.get(leaf as Element)
		if (inline?.kind === 'anchor' || leaf.nodeType === Node.TEXT_NODE) continue
		if (!spans) return {inline}
	}
	return undefined
}
