// A .docx as paginated, editable DOM. Open parses the package into a model (no DOM needed); render lays it out on
// white pages in a container; edits are saved by writing the paragraphs they changed over those the file has, in the
// original XML.

import {Editor, type Format, type Formatting} from './editing'
import {ImageStore} from './images'
import {DocumentLayout} from './layout'
import {buildModel, type Approximated, type DocumentModel, type Paragraph} from './model'
import {DocxPackage} from './package'
import {applyCss, Registry, relabel} from './render'
import {save} from './save'
import type {Settings} from './styles'

export type {Format, Formatting} from './editing'
export type {Approximated} from './model'
export {DocxError, type DocxErrorCode} from './package'

export type RenderOptions = {
	// Space between pages, in screen px
	gap?: number
	signal?: AbortSignal
	// After an edit, or anything else that changes what isDirty(), formatting() or history say
	onChange?: () => void
	// After edits made the pages lay out again
	onLayout?: (result: RenderResult) => void
	// When an edit is turned away (one that would take a footnote's reference with it, or run into a table), leaving
	// the document as it was
	onRefuse?: () => void
	// Where an edit left the selection, on screen, for it to be kept in view: its caret, and its other end (the same,
	// for a caret alone)
	onCaret?: (caret: DOMRect, anchor: DOMRect) => void
}

export type RenderResult = {pages: HTMLElement[]}

export type DocxDocument = {
	// Builds the pages (CSS px at 96 dpi) into `container`, replacing what it held. It needs to be laid out (in the
	// document, not display: none) for text to be measured. Rendering again starts over from the file as opened.
	render(container: HTMLElement, options?: RenderOptions): Promise<RenderResult>
	// What the last render drew only roughly or not at all (empty until a render has finished)
	readonly approximated: ReadonlySet<Approximated>
	// Why the document shouldn't be edited here, if it shouldn't: Track Changes is on, or editing is restricted
	readonly protection: Settings['protection']
	// Scales the pages on screen: layout always happens at 1, so zooming never moves a line
	setZoom(zoom: number): void
	setEditable(editable: boolean): void
	// Selects the document's text: all of it or, while it's being edited, all that can be
	selectAll(): void
	// Whether the selected text is bold, italic and underlined, or what's typed at the caret would be. Undefined while
	// the selection isn't in text that can be edited.
	formatting(): Formatting | undefined
	// Switches one of them for the selected text, or at the caret for what's typed there next
	format(format: Format): void
	// What there is to undo and redo
	readonly history: {undo: boolean; redo: boolean}
	undo(): void
	redo(): void
	isDirty(): boolean
	// The file with the document as it now is; editing can carry on while it's being written
	save(): Promise<Uint8Array>
	// The bytes from the last save() are now the file's contents: isDirty() compares against them
	markSaved(): void
	destroy(): void
}

// How long typing pauses before the pages are laid out again around the new text
const REFLOW_DELAY = 300

// A paragraph of the file as the file has it
const written = ({source, element}: Paragraph) => source.slice(element.start, element.end)

export async function openDocument(bytes: Uint8Array): Promise<DocxDocument> {
	const pkg = DocxPackage.open(bytes)
	return new DocxView(pkg, await buildModel(pkg))
}

class DocxView implements DocxDocument {
	approximated: ReadonlySet<Approximated> = new Set()
	private readonly images: ImageStore
	private layout: DocumentLayout | undefined
	private editor: Editor | undefined
	private registry: Registry | undefined
	private root: HTMLElement | undefined
	private options: RenderOptions = {}
	private zoom = 1
	private editable = false
	// What the saved file holds in place of the paragraphs it was opened with, where that's something else
	private baseline = new Map<Paragraph, string>()
	private saved: Map<Paragraph, string> | undefined
	// Paragraphs typed in since the pages were last laid out
	private edited = new Set<Paragraph>()
	private timer: ReturnType<typeof setTimeout> | undefined
	// The faces still loading that a layout is waiting to be laid out again for, and whether they're in
	private awaited: Promise<unknown> | undefined
	private arrived = false
	private destroyed = false

	constructor(
		private readonly pkg: DocxPackage,
		private readonly model: DocumentModel,
	) {
		this.images = new ImageStore(pkg)
	}

	get protection() {
		return this.model.settings.protection
	}

	get history() {
		return this.editor?.history ?? {undo: false, redo: false}
	}

	async render(container: HTMLElement, options: RenderOptions = {}): Promise<RenderResult> {
		this.teardown()
		this.options = options
		const doc = container.ownerDocument
		const root = doc.createElement('div')
		applyCss(root, {position: 'relative'})
		const stack = doc.createElement('div')
		applyCss(stack, {display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${options.gap ?? 16}px`})
		// A page wider than the container starts at its left edge, where it can be scrolled to, instead of spilling over
		// both sides (browsers without safe alignment keep plain centring)
		stack.style.alignItems = 'safe center'
		root.append(stack)
		container.replaceChildren(root)
		this.root = root
		// Destroyed, aborted or rendered again since: this render's work stops at its next pause
		const stale = () => this.destroyed || Boolean(options.signal?.aborted) || this.root !== root
		const images = await this.images.load(this.model.images)
		if (stale()) return {pages: []}
		const registry = new Registry(doc)
		const context = {
			doc,
			theme: this.model.theme,
			settings: this.model.settings,
			images,
			registry,
			stacks: new Map(),
			faces: new Set<string>(),
			styles: new WeakMap(),
			approximated: new Set<Approximated>(this.model.comments ? ['comments'] : []),
		}
		const layout = new DocumentLayout(this.model, root, stack, context)
		const views = await layout.render(this.zoom, stale)
		if (stale()) return {pages: []}
		this.approximated = context.approximated
		this.layout = layout
		this.registry = registry
		this.editor = new Editor({
			host: stack,
			registry,
			model: this.model,
			swap: (old, blocks) => layout.swap(old, blocks),
			layout: () => this.reflow(true),
			onEdit: (paragraph) => this.edit(paragraph),
			onChange: () => this.options.onChange?.(),
			onRefuse: () => this.options.onRefuse?.(),
			onCaret: (caret, anchor) => this.options.onCaret?.(caret, anchor),
		})
		this.editor.setEnabled(this.editable)
		this.watch(layout)
		return {pages: views.map((view) => view.slot)}
	}

	setZoom(zoom: number) {
		this.zoom = zoom
		this.layout?.setZoom(zoom)
	}

	setEditable(editable: boolean) {
		if (editable === this.editable) return
		this.editable = editable
		this.editor?.setEnabled(editable)
		if (!editable) this.reflow()
		// What formatting() says of the selection goes with it
		this.options.onChange?.()
	}

	selectAll() {
		this.editor?.selectAll()
	}

	formatting() {
		return this.editor?.formatting()
	}

	format(format: Format) {
		this.editor?.toggle(format)
	}

	undo() {
		this.editor?.undo()
	}

	redo() {
		this.editor?.redo()
	}

	isDirty(): boolean {
		const current = this.editor?.current() ?? new Map<Paragraph, string>()
		for (const [origin, xml] of current) if (xml !== (this.baseline.get(origin) ?? written(origin))) return true
		// Rendered again since it was saved, the document is the file as opened once more
		for (const [origin, xml] of this.baseline) if (!current.has(origin) && xml !== written(origin)) return true
		return false
	}

	async save(): Promise<Uint8Array> {
		const current = this.editor?.current() ?? new Map<Paragraph, string>()
		this.saved = current
		return save(this.pkg, this.model.parts, current)
	}

	markSaved() {
		this.baseline = this.saved ?? this.editor?.current() ?? new Map()
		this.saved = undefined
	}

	destroy() {
		this.destroyed = true
		this.teardown()
		this.images.revoke()
	}

	private teardown() {
		clearTimeout(this.timer)
		// The model goes back to the file's own paragraphs, counted as the file counts them
		if (this.editor) {
			this.editor.dispose()
			this.model.renumber()
		}
		this.editor = undefined
		this.registry = undefined
		this.layout = undefined
		this.root?.remove()
		this.root = undefined
		this.edited.clear()
	}

	private edit(paragraph: Paragraph) {
		this.edited.add(paragraph)
		this.layout?.retab(this.registry?.fragments.get(paragraph) ?? [])
		this.options.onChange?.()
		clearTimeout(this.timer)
		this.timer = setTimeout(() => this.reflow(), REFLOW_DELAY)
	}

	// Lays the pages out again after edits. Typing leaves a paragraph where it is, so the pages only follow where its
	// height changed, and the caret stays where it was. An edit that exchanged paragraphs (`exchanged`) has the lists
	// counted again and always moves the pages; its caret is the editor's to place. While text is being composed the
	// pages wait: the end of the composition is an edit, which comes back here.
	private reflow(exchanged = false) {
		clearTimeout(this.timer)
		const {layout, editor, registry} = this
		if (!layout || !editor || !registry || editor.composing) return
		const edited = [...this.edited]
		this.edited.clear()
		if (exchanged) {
			for (const paragraph of this.model.renumber()) {
				relabel(paragraph, registry)
				edited.push(paragraph)
			}
		}
		const fragments = edited.flatMap((paragraph) => registry.fragments.get(paragraph) ?? [])
		const arrived = this.arrived
		this.arrived = false
		const selection = exchanged ? undefined : editor.selection()
		// What was measured before its faces were in first, so that the edits are laid out with them
		let views = arrived ? layout.settled(this.zoom) : undefined
		if (exchanged || layout.moved(fragments)) views = layout.reflow(fragments, this.zoom)
		else layout.touched(fragments)
		if (!views) return
		editor.restoreSelection(selection)
		this.watch(layout)
		this.options.onLayout?.({pages: views.map((view) => view.slot)})
	}

	// Faces still loading when text was measured: once they're in, what was measured without them is laid out again,
	// as it would be laid out now
	private watch(layout: DocumentLayout) {
		const late = layout.late
		if (!late || late === this.awaited) return
		this.awaited = late
		void late.then(() => {
			// Not if more are awaited since: those are waited for with these
			if (this.layout !== layout || layout.late !== late) return
			this.arrived = true
			this.reflow()
		})
	}
}
