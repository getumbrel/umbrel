// A .docx as paginated, editable DOM. Open parses the package into a model (no DOM needed); render lays it out on
// white pages in a container; text edits are saved by splicing the changed w:t contents into the original XML.

import {Editor} from './editing'
import {ImageStore} from './images'
import {DocumentLayout} from './layout'
import {buildModel, type Approximated, type DocumentModel, type Paragraph} from './model'
import {DocxPackage} from './package'
import {applyCss, lineSpacing, Registry, runCss} from './render'
import {save} from './save'
import type {Settings} from './styles'

export type {Approximated} from './model'
export {DocxError, type DocxErrorCode} from './package'

export type RenderOptions = {
	// Space between pages, in screen px
	gap?: number
	signal?: AbortSignal
	// After the text changes, once it's been read back (isDirty() may have changed)
	onChange?: () => void
	// After edits made the pages lay out again
	onLayout?: (result: RenderResult) => void
	// When an edit is turned away (a new paragraph, formatting, deleting a picture), leaving the text as it was
	onRefuse?: () => void
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
	isDirty(): boolean
	// The file with the current text; editing can carry on while it's being written
	save(): Promise<Uint8Array>
	// The bytes from the last save() are now the file's contents: isDirty() compares against them
	markSaved(): void
	destroy(): void
}

// How long typing pauses before the pages are laid out again around the new text
const REFLOW_DELAY = 300

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
	private baseline = new Map<number, string>()
	private saved: Map<number, string> | undefined
	private edited = new Set<Paragraph>()
	private timer: ReturnType<typeof setTimeout> | undefined
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
		const registry = new Registry()
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
			style: (paragraph, inline) =>
				runCss(context, inline && 'style' in inline ? inline.style : paragraph.mark, lineSpacing(paragraph), undefined),
			onEdit: (paragraph) => this.edit(paragraph),
			onRefuse: () => this.options.onRefuse?.(),
		})
		this.editor.setEnabled(this.editable)
		// Faces still loading when the pages were measured: once they're in, the document is laid out again as an open
		// would lay it out now
		void layout.late?.then(() => {
			if (this.layout !== layout) return
			const selection = this.editor?.selection()
			const pages = layout.relayout(this.zoom)
			this.editor?.restoreSelection(selection)
			this.options.onLayout?.({pages: pages.map((view) => view.slot)})
		})
		return {pages: views.map((view) => view.slot)}
	}

	setZoom(zoom: number) {
		this.zoom = zoom
		this.layout?.setZoom(zoom)
	}

	setEditable(editable: boolean) {
		this.editable = editable
		this.editor?.setEnabled(editable)
		if (!editable) this.flush()
	}

	isDirty(): boolean {
		return (this.editor?.changed(this.baseline).size ?? 0) > 0
	}

	async save(): Promise<Uint8Array> {
		const editor = this.editor
		this.saved = new Map(editor?.texts)
		return save(this.pkg, this.model.parts, editor?.changed() ?? new Map())
	}

	markSaved() {
		this.baseline = this.saved ?? new Map(this.editor?.texts)
		this.saved = undefined
	}

	destroy() {
		this.destroyed = true
		this.teardown()
		this.images.revoke()
	}

	private teardown() {
		clearTimeout(this.timer)
		this.editor?.setEnabled(false)
		this.editor = undefined
		this.registry = undefined
		this.layout = undefined
		this.root?.remove()
		this.root = undefined
		this.edited.clear()
	}

	private edit(paragraph: Paragraph) {
		this.edited.add(paragraph)
		this.options.onChange?.()
		clearTimeout(this.timer)
		this.timer = setTimeout(() => this.flush(), REFLOW_DELAY)
	}

	// Lays the pages out again if an edit changed a paragraph's height, keeping the caret where it was
	private flush() {
		clearTimeout(this.timer)
		const {layout, editor, registry} = this
		if (!layout || !editor || !registry || !this.edited.size) return
		const fragments = [...this.edited].flatMap((paragraph) => registry.fragments.get(paragraph) ?? [])
		this.edited.clear()
		if (!layout.moved(fragments)) return
		const selection = editor.selection()
		const views = layout.reflow(fragments, this.zoom)
		editor.restoreSelection(selection)
		this.options.onLayout?.({pages: views.map((view) => view.slot)})
	}
}
