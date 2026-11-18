// Laying the rendered blocks out on pages. Blocks are rendered into an off-screen galley one column wide and
// measured; the planner decides the pages by arithmetic; only then are blocks split and moved into their pages.
// Reads and writes never interleave, so a long document costs a handful of layouts, not one per paragraph. After an
// edit only the blocks it changed are measured again (those of a rewritten paragraph first take the place of the
// blocks it had), the pages are planned again from what's known of the rest, and only the pages that changed are
// rebuilt.

import {lookup} from '@/features/files/components/file-viewer/shared/lookup'
import {RIGHT_TO_LEFT} from '@/features/files/components/file-viewer/shared/scripts'

import type {DocumentModel, Paragraph, Section, Story} from './model'
import {
	boundary,
	changes,
	plan,
	type Box,
	type FlowItem,
	type Measurer,
	type Piece,
	type PlannedPage,
	type PlanSection,
	type RowCells,
	type RowCut,
} from './plan'
import {
	anchored,
	applyCss,
	lock,
	locked,
	pageNumber,
	pagePosition,
	renderBlocks,
	renderStory,
	UNNUMBERED,
	type PageGeometry,
	type Registry,
	type RenderContext,
	type TabEntry,
} from './render'
import type {Settings} from './styles'

export type PageView = {
	// The page laid out at zoom 1, and the box holding it at the current zoom
	sheet: HTMLElement
	slot: HTMLElement
	width: number
	height: number
}

type Geometry = Omit<PageGeometry, 'margins'> & {
	margins: Section['margins']
	contentWidth: number
	columns: Array<{left: number; width: number}>
}

// A header or footer as rendered: its text a column wide, what it places on the page itself, and how tall the text
// measured. `numbers` are the page numbers its tabs are laid out by, each with how wide its texts have measured, and
// `fitted` is the text as laid out for each set of their widths: see fit().
type Rendered = {
	element: HTMLElement
	layer: HTMLElement
	height: number
	numbers: Array<{field: HTMLElement; widths: Map<string, string>}>
	fitted: Map<string, HTMLElement>
}

const px = (value: number) => `${Math.round(value * 1000) / 1000}px`

// Typography a page must not inherit from the app around it
const RESET: Record<string, string> = {
	color: '#000000',
	fontFamily: 'serif',
	fontSize: '16px',
	fontWeight: '400',
	fontStyle: 'normal',
	lineHeight: 'normal',
	letterSpacing: 'normal',
	wordSpacing: 'normal',
	textAlign: 'left',
	textIndent: '0',
	textTransform: 'none',
	whiteSpace: 'normal',
	direction: 'ltr',
	userSelect: 'text',
	webkitUserSelect: 'text',
	cursor: 'auto',
}

function geometry(section: Section, settings: DocumentModel['settings'], even = false): Geometry {
	const margins = {...section.margins}
	if (settings.gutterAtTop) margins.top = Math.sign(margins.top || 1) * (Math.abs(margins.top) + margins.gutter)
	else margins.left += margins.gutter
	// Mirrored margins swap inside and outside on even pages
	if (settings.mirrorMargins && even) [margins.left, margins.right] = [margins.right, margins.left]
	const contentWidth = Math.max(24, section.pageWidth - margins.left - margins.right)
	const {count, space, widths} = section.columns
	const columns: Geometry['columns'] = []
	if (widths?.length === count && widths.every((width) => width > 0)) {
		let left = 0
		for (const width of widths) {
			columns.push({left, width})
			left += width + space
		}
	} else {
		const width = Math.max(24, (contentWidth - space * (count - 1)) / count)
		for (let i = 0; i < count; i++) columns.push({left: i * (width + space), width})
	}
	return {width: section.pageWidth, height: section.pageHeight, margins, contentWidth, columns, grid: section.grid}
}

export type LayoutContext = Omit<RenderContext, 'page' | 'width' | 'editable' | 'body' | 'cell' | 'layer'>

export class DocumentLayout {
	views: PageView[] = []
	// Faces still loading when text was measured: an open waits for them 3 s at most, and an edit that brings one in
	// (bold, where nothing was) not at all. Once they're in, settled() lays out again what was measured without them.
	late: Promise<unknown> | undefined
	private unsettled: 'all' | HTMLElement[] | undefined
	// How many faces have been asked for, and font stacks measured
	private faces = 0
	private lines = 0
	private readonly doc: Document
	private readonly geometries: Geometry[]
	// Where blocks are measured: a box on the root for the layout's life, empty between layouts. A box put on the root
	// and taken off again would have WebKit lay out every page again each time (a second for a long document); what
	// comes and goes inside this one stays inside it.
	private readonly host: HTMLElement
	// Each section's blocks as rendered, in order: what every layout starts from
	private blocks: HTMLElement[][] = []
	// What each block measured and the pages they were planned on, which the next layout starts from
	private items: FlowItem[][] = []
	private measurers: GalleyMeasurer[] = []
	private planned: PlannedPage[] = []
	private stories = new Map<string, Rendered>()
	private notes = new Map<string, HTMLElement>()
	private noteHeights = new Map<string, number>()
	private separator!: HTMLElement
	private separatorHeight = 0
	// What cutting blocks into parts changed, so each can be put back as rendered
	private parts = new Map<HTMLElement, HTMLElement[]>()
	private styles = new Map<HTMLElement, Record<string, string>>()
	private rowSpans = new Map<HTMLTableCellElement, number>()
	private added = new Set<HTMLTableCellElement>()
	private copies = new WeakSet<Element>()
	// Of rows cut across pages: the rows that hold the rest of one, the cell each of their cells continues, and what
	// the cuts changed inside each table (those rows, the rows they continue, the paragraphs cut with them)
	private rests = new WeakSet<Element>()
	private origins = new WeakMap<HTMLTableCellElement, HTMLTableCellElement>()
	private inside = new Map<HTMLElement, HTMLElement[]>()
	// The element of each piece on the pages, both ways round (keyed section:item:start)
	private placed = new WeakMap<HTMLElement, Piece>()
	private elements = new Map<string, HTMLElement>()
	// Blocks that swap() put in or changed the inside of, which the next layout measures
	private stale = new Set<HTMLElement>()
	// Each section's blocks as the pages were planned with, once swap() has put others among them
	private swapped: HTMLElement[][] | undefined

	constructor(
		private readonly model: DocumentModel,
		private readonly root: HTMLElement,
		private readonly stack: HTMLElement,
		private readonly context: LayoutContext,
	) {
		this.doc = root.ownerDocument
		this.geometries = model.sections.map((section) => geometry(section, model.settings))
		this.host = this.doc.createElement('div')
		applyCss(this.host, {
			position: 'absolute',
			left: '0',
			top: '0',
			width: '0',
			height: '0',
			overflow: 'hidden',
			contain: 'strict',
		})
		root.append(this.host)
	}

	async render(zoom: number, stale: () => boolean = () => false): Promise<PageView[]> {
		const {model, geometries} = this
		const measure = this.measureBox()
		try {
			const contextFor = (page: PageGeometry, width: number, editable: boolean, body: boolean): RenderContext => ({
				...this.context,
				page,
				width,
				editable,
				body,
				cell: false,
			})
			// Headers and footers render once per story, width and line grid, and are cloned onto each page
			model.sections.forEach((section, i) => {
				const page = geometries[i]
				for (const story of [...Object.values(section.headers), ...Object.values(section.footers)]) {
					const key = storyKey(story, page)
					if (this.stories.has(key)) continue
					const layer = this.doc.createElement('div')
					applyCss(layer, {
						position: 'absolute',
						left: '0',
						top: '0',
						width: px(page.width),
						height: px(page.height),
						pointerEvents: 'none',
					})
					const element = galley(measure, page.contentWidth)
					const tabs = this.context.registry.tabs.length
					element.append(...renderStory(story.blocks, {...contextFor(page, page.contentWidth, false, false), layer}))
					const numbers = numbersOf(element, this.context.registry.tabs.slice(tabs))
					this.stories.set(key, {element, layer, height: 0, numbers, fitted: new Map()})
				}
			})
			// Footnotes are as wide as the text, and go on the page of their reference
			for (const [id, blocks] of model.footnotes) {
				const element = galley(measure, geometries[0].contentWidth)
				element.append(...renderBlocks(blocks, contextFor(geometries[0], geometries[0].contentWidth, false, false)))
				this.notes.set(id, element)
			}
			this.separator = galley(measure, geometries[0].contentWidth)
			this.separator.append(
				...(model.separator?.length
					? renderBlocks(model.separator, contextFor(geometries[0], geometries[0].contentWidth, false, false))
					: [rule(this.doc)]),
			)
			// The body, a column wide, with the endnotes after the last section
			const galleys = model.sections.map((section, i) => {
				const element = galley(measure, geometries[i].columns[0].width)
				const context = contextFor(geometries[i], geometries[i].columns[0].width, true, true)
				const last = i === model.sections.length - 1
				const endnotes = last && model.endnotes.length > 0
				element.append(...renderBlocks(section.blocks, {...context, last: last && !endnotes}))
				if (endnotes) {
					element.append(
						rule(this.doc),
						...renderBlocks(model.endnotes, contextFor(geometries[i], geometries[i].columns[0].width, false, false)),
					)
				}
				return element
			})
			this.blocks = galleys.map((element) => [...element.children] as HTMLElement[])

			this.late = (await settle(this.doc, this.root, this.context, measure)).late
			if (stale()) return []
			if (this.late) this.unsettled = 'all'
			this.faces = this.context.faces.size
			this.lines = this.context.stacks.size
			const scale = scaleOf(galleys[0], geometries[0].columns[0].width)
			layoutTabs(this.context.registry.tabs, scale, model.settings, this.context.registry.range)
			for (const rendered of this.stories.values())
				rendered.height = rendered.element.getBoundingClientRect().height / scale
			for (const [id, element] of this.notes) this.noteHeights.set(id, element.getBoundingClientRect().height / scale)
			this.separatorHeight = this.separator.getBoundingClientRect().height / scale
			this.items = this.blocks.map((blocks) => blocks.map((block) => flowItem(block, scale, this.context.registry)))
			this.measurers = this.blocks.map(
				(blocks) => new GalleyMeasurer(blocks, this.context.registry, this.noteHeights, this.separatorHeight),
			)
			return this.paginate(zoom, scale, measure, galleys, new Set())
		} finally {
			measure.remove()
		}
	}

	// Puts the blocks rendered for rewritten paragraphs where the blocks of those they stand in for were. `old` are
	// whole paragraphs, one after another in a section or a cell, and `next` the blocks of what replaces them, in
	// order. The pages show what they did until the next reflow().
	swap(old: Paragraph[], next: HTMLElement[]) {
		const {registry} = this.context
		const head = registry.fragments.get(old[0])![0]
		const section = this.blocks.findIndex((blocks) => blocks.includes(head))
		if (section < 0) {
			// In a cell, whose table is measured again
			const piece = this.pieceOf(head)
			if (piece) this.stale.add((this.swapped ?? this.blocks)[piece.section][piece.item])
			head.before(...next)
			for (const paragraph of old) for (const block of registry.fragments.get(paragraph) ?? []) block.remove()
		} else {
			this.swapped ??= this.blocks.map((blocks) => [...blocks])
			const blocks = this.blocks[section]
			const index = blocks.indexOf(head)
			const leaving = new Set<Paragraph | undefined>(old)
			let count = 1
			while (index + count < blocks.length && leaving.has(registry.paragraphs.get(blocks[index + count]))) count++
			const removed = blocks.splice(index, count, ...next)
			for (const block of removed) {
				this.unsplit(block)
				block.remove()
				this.stale.delete(block)
			}
			for (const block of next) this.stale.add(block)
			const unmeasured = next.map<FlowItem>(() => ({kind: 'paragraph', height: 0, before: 0, after: 0}))
			this.items[section].splice(index, count, ...unmeasured)
			this.measurers[section].splice(index, removed, next.length)
		}
		for (const paragraph of old) registry.forget(paragraph)
	}

	// After swap() put blocks in and took blocks out, however many: what was listed of the blocks that went goes too,
	// the pieces on the pages count their blocks from where those now are, and the pieces of blocks that went are no
	// block's, for the next plan to be compared with this one
	private recount() {
		this.context.registry.sweep()
		const before = this.swapped
		if (!before) return
		this.swapped = undefined
		const now = this.blocks.map((blocks) => new Map(blocks.map((block, item) => [block, item])))
		const elements = new Map<string, HTMLElement>()
		for (const piece of this.planned.flatMap((page) => page.bands.flatMap((band) => band.columns.flat()))) {
			const element = this.elements.get(`${piece.section}:${piece.item}:${startOf(piece)}`)
			piece.item = now[piece.section].get(before[piece.section][piece.item]) ?? -1
			if (!element) continue
			if (piece.item < 0) this.placed.delete(element)
			else {
				elements.set(`${piece.section}:${piece.item}:${startOf(piece)}`, element)
				this.placed.set(element, piece)
			}
		}
		this.elements = elements
	}

	// Lays the pages out again after an edit, given the elements of what it edited: those blocks, and the ones swap()
	// brought, are measured again in a galley, the pages planned again with what's known of the rest, and only the
	// pages that changed are rebuilt. Where text wraps around objects a block depends on those before it, so everything
	// is measured again.
	reflow(edited: HTMLElement[], zoom: number): PageView[] {
		const {registry, stacks} = this.context
		const measure = this.measureBox()
		try {
			this.recount()
			// A rewritten paragraph can be the first set in a stack of fonts
			const known = this.lines
			if (stacks.size !== known) lineHeights(this.doc, this.root, stacks, measure)
			this.lines = stacks.size
			const stale = this.stale
			this.stale = new Set()
			const galleys = this.geometries.map((geometry) => galley(measure, geometry.columns[0].width))
			const scale = scaleOf(galleys[0], this.geometries[0].columns[0].width)
			const items = new Map<string, {section: number; item: number}>()
			const add = (section: number, item: number) => items.set(`${section}:${item}`, {section, item})
			if (registry.floating || stale.size) {
				this.blocks.forEach((blocks, section) =>
					blocks.forEach((block, item) => (registry.floating || stale.has(block)) && add(section, item)),
				)
			}
			for (const element of edited) {
				const piece = this.pieceOf(element)
				if (piece) add(piece.section, piece.item)
			}
			this.request(
				[...items.values()].map(({section, item}) => this.blocks[section][item]),
				known,
			)
			const whole = new Set<string>()
			for (const {section, item} of items.values()) this.pull(galleys, whole, section, item)
			// Only their tabs can have moved
			this.layTabs(measure, scale)
			for (const {section, item} of items.values()) {
				this.items[section][item] = flowItem(this.blocks[section][item], scale, registry)
				this.measurers[section].forget(item, scale)
			}
			return this.paginate(zoom, scale, measure, galleys, whole)
		} finally {
			measure.remove()
		}
	}

	// Lays out again what was measured while its faces were still loading, now that they're in: everything after an
	// open, and after an edit the blocks it brought the faces in with. Nothing, if that has been done since.
	settled(zoom: number): PageView[] | undefined {
		const unsettled = this.unsettled
		this.unsettled = undefined
		if (unsettled === 'all') return this.relayout(zoom)
		return unsettled && this.reflow(unsettled, zoom)
	}

	// Asks for the faces that the blocks being measured are the first to be set in, and for those the line heights of
	// font stacks not `known` before were probed with. What's measured before they're in is measured again after:
	// see settled().
	private request(blocks: HTMLElement[], known: number) {
		const {faces, stacks} = this.context
		const fonts = (this.doc as Document & {fonts?: FontFaceSet}).fonts
		const text = blocks.map((block) => block.textContent ?? '').join('')
		const asked = [
			...[...faces].slice(this.faces).map((face) => [face, text] as const),
			...[...stacks.keys()].slice(known).map((stack) => [probeFont(stack), 'x'] as const),
		]
		this.faces = faces.size
		if (!fonts || !asked.length) return
		const loads = asked.map(([face, sample]) => fonts.load(face, sample))
		// A face that's here already (or is the device's own) changes nothing when it "arrives"
		try {
			if (asked.every(([face, sample]) => fonts.check(face, sample))) return
		} catch {
			return
		}
		if (this.unsettled !== 'all') this.unsettled = [...(this.unsettled ?? []), ...blocks]
		this.lines = known
		this.late = Promise.allSettled([this.late, ...loads])
	}

	// Lays everything out again once the faces that were still loading at the first layout are in: line heights,
	// headers, footers, notes and every block measured again, and every page rebuilt
	relayout(zoom: number): PageView[] {
		const {registry} = this.context
		const measure = this.measureBox()
		try {
			this.recount()
			lineHeights(this.doc, this.root, this.context.stacks, measure)
			this.lines = this.context.stacks.size
			this.stale.clear()
			const galleys = this.geometries.map((geometry) => galley(measure, geometry.columns[0].width))
			// The notes come off their pages to be measured; every page is rebuilt with them
			measure.append(...[...this.stories.values()].map(({element}) => element), ...this.notes.values(), this.separator)
			// What headers and footers measured for the pages' numbers went with the faces they were measured in, and each
			// is as tall as it was rendered: with no page's number in it yet
			for (const story of this.stories.values()) {
				story.fitted.clear()
				for (const {field, widths} of story.numbers) {
					widths.clear()
					field.textContent = UNNUMBERED
				}
			}
			const scale = scaleOf(galleys[0], this.geometries[0].columns[0].width)
			const whole = new Set<string>()
			this.blocks.forEach((blocks, section) => blocks.forEach((_, item) => this.pull(galleys, whole, section, item)))
			this.layTabs(measure, scale)
			for (const rendered of this.stories.values())
				rendered.height = rendered.element.getBoundingClientRect().height / scale
			for (const [id, element] of this.notes) this.noteHeights.set(id, element.getBoundingClientRect().height / scale)
			this.separatorHeight = this.separator.getBoundingClientRect().height / scale
			this.items = this.blocks.map((blocks) => blocks.map((block) => flowItem(block, scale, registry)))
			this.measurers = this.blocks.map(
				(blocks) => new GalleyMeasurer(blocks, registry, this.noteHeights, this.separatorHeight),
			)
			return this.paginate(zoom, scale, measure, galleys, whole)
		} finally {
			measure.remove()
		}
	}

	// Whether edited paragraphs changed the height of what holds them on their pages (the paragraph itself, or the
	// table it's in), so the pages need laying out again. So does an edit to what shows on more than one page, whatever
	// its height: a paragraph or a table's row cut across pages, whose text moves between its parts, or the header rows
	// of a table cut across pages, which its later parts repeat.
	moved(elements: HTMLElement[]): boolean {
		const {registry} = this.context
		const repeated = [...this.parts].flatMap(([block, parts]) =>
			registry.paragraphs.has(block)
				? [block, ...parts]
				: [...headerRows(block as HTMLTableElement, registry), ...(this.inside.get(block) ?? [])],
		)
		return elements.some((element) => {
			const holder = this.holderOf(element)
			return (
				holder?.isConnected &&
				(repeated.some((node) => node.contains(element)) ||
					Math.abs(holder.offsetHeight - this.placed.get(holder)!.height) > 2)
			)
		})
	}

	// Notes paragraphs typed in where the pages stay as they are (see moved()). What was measured inside the blocks
	// they're in can have changed all the same, and is forgotten. A block that references footnotes is measured again
	// by the next layout, which finds where they're referenced now.
	touched(elements: HTMLElement[]) {
		for (const element of elements) {
			const piece = this.pieceOf(element)
			if (!piece) continue
			const block = (this.swapped ?? this.blocks)[piece.section][piece.item]
			const index = this.blocks[piece.section].indexOf(block)
			if (index >= 0 && this.measurers[piece.section].touch(index, element)) this.stale.add(block)
		}
	}

	// What holds an element on its page: the element of a piece, which the element is or is inside
	private holderOf(element: HTMLElement): HTMLElement | null {
		let holder: HTMLElement | null = element
		while (holder && !this.placed.has(holder)) holder = holder.parentElement
		return holder
	}

	// …and that piece
	private pieceOf(element: HTMLElement): Piece | undefined {
		const holder = this.holderOf(element)
		return holder ? this.placed.get(holder) : undefined
	}

	// Lays out a paragraph's tabs again where its blocks stand on their pages, so that what follows a tab keeps to its
	// stop while the text around it is typed
	retab(blocks: HTMLElement[]) {
		const {tabs} = this.context.registry
		for (const block of blocks) {
			if (!tabs.some((tab) => block.contains(tab.element))) continue
			const view = this.views.find((view) => view.sheet.contains(block))
			if (view) this.layTabs(block, scaleOf(view.sheet, view.width))
		}
	}

	setZoom(zoom: number) {
		for (const view of this.views) zoomView(view, zoom)
	}

	private measureBox(): HTMLElement {
		const measure = this.doc.createElement('div')
		applyCss(measure, {
			position: 'absolute',
			left: '0',
			top: '0',
			visibility: 'hidden',
			pointerEvents: 'none',
			zIndex: '-1',
		})
		applyCss(measure, RESET)
		this.host.append(measure)
		return measure
	}

	// Plans the pages from what the blocks measured, and builds those the plan changed. A block it measures for the first
	// time is put in the galley whole, which `whole` notes (as section:item) with the blocks measured again before.
	private paginate(
		zoom: number,
		scale: number,
		measure: HTMLElement,
		galleys: HTMLElement[],
		whole: Set<string>,
	): PageView[] {
		const {model, geometries, doc} = this
		const {registry} = this.context
		const {sections, settings} = model
		this.measurers.forEach((measurer, section) =>
			measurer.use(scale, (item) => this.pull(galleys, whole, section, item)),
		)
		const variant = (section: Section, index: number, number: number) =>
			section.titlePage && index === 0 ? 'first' : settings.evenAndOddHeaders && number % 2 === 0 ? 'even' : 'default'
		const pageBox = (sectionIndex: number, index: number, number: number) => {
			const section = sections[sectionIndex]
			const page = geometry(section, settings, number % 2 === 0)
			const kind = variant(section, index, number)
			const story = (from: Section['headers']) =>
				from[kind] && this.stories.get(storyKey(from[kind]!, geometries[sectionIndex]))
			const header = story(section.headers)
			const footer = story(section.footers)
			// A header that ends below the top margin pushes the text down, and a footer that starts above the bottom
			// margin pushes it up. A page without one keeps no room for it, wherever it would have been put. A negative
			// margin is exact and never moves.
			const room = (margin: number, distance: number, rendered?: Rendered) =>
				margin < 0 ? -margin : Math.max(margin, rendered ? distance + rendered.height : 0)
			const top = room(page.margins.top, page.margins.header, header)
			const bottom = room(page.margins.bottom, page.margins.footer, footer)
			return {page, top, height: Math.max(24, page.height - top - bottom), header, footer}
		}
		const planned = plan(
			sections.map<PlanSection>((section, i) => ({
				items: this.items[i],
				columns: geometries[i].columns,
				start: section.start,
				firstNumber: section.pageNumbers.start,
				bodyHeight: (index, number) => pageBox(i, index, number).height,
				pageKey: `${section.pageWidth}x${section.pageHeight}`,
			})),
			this.measurers,
		)
		const sectionPages = new Map<number, number>()
		for (const page of planned) sectionPages.set(page.section, (sectionPages.get(page.section) ?? 0) + 1)
		// What a page-number field reads on a page
		const numberOn = (page: PlannedPage, field: HTMLElement) => {
			const kind = field.dataset.field
			const value =
				kind === 'page' ? page.number : kind === 'numpages' ? planned.length : (sectionPages.get(page.section) ?? 1)
			return pageNumber(
				value,
				field.dataset.format || (kind === 'page' ? sections[page.section].pageNumbers.format : 'decimal'),
			)
		}
		const numbered = planned.flatMap((page) => {
			if (page.blank) return []
			const {header, footer} = pageBox(page.section, page.index, page.number)
			return [header, footer].flatMap((story) => (story?.numbers.length ? [{story, page}] : []))
		})
		this.fit(numbered, numberOn, measure, scale)
		const fitted = (story: Rendered, page: PlannedPage) =>
			story.fitted.get(widthsOf(story, (field) => numberOn(page, field))) ?? story.element
		const {from, to, cut} = changes(this.planned, planned, whole)
		// The last reads: where each split falls. From here on, only writes.
		const elements = this.split(planned.slice(from, to), cut, galleys, whole, scale)
		const views = planned.slice(from, to).map((planned_, offset) => {
			const index = from + offset
			const section = sections[planned_.section]
			const view = createPage(doc, section, model.background, zoom)
			view.sheet.dataset.page = String(index)
			const {page, top, height, header, footer} = pageBox(planned_.section, planned_.index, planned_.number)
			// Nothing outside the body's paragraphs takes the caret: not headers and footers, their page-sized layers, or
			// a page left blank
			if (planned_.blank) lock(view.sheet)
			else {
				if (header) {
					const element = placed(fitted(header, planned_), page, {top: page.margins.header})
					view.sheet.append(element, layer(header.layer))
				}
				if (footer) {
					const element = placed(fitted(footer, planned_), page, {bottom: page.margins.footer})
					view.sheet.append(element, layer(footer.layer))
				}
			}
			for (const band of planned_.bands) {
				const bandGeometry = geometries[band.section]
				const used = Math.max(0, ...band.columns.map((pieces) => pieces.reduce((sum, piece) => sum + piece.height, 0)))
				// Vertical alignment moves the text of a page that holds one section
				const shift =
					planned_.bands.length === 1 && section.verticalAlign !== 'top'
						? Math.max(0, height - used) / (section.verticalAlign === 'center' ? 2 : 1)
						: 0
				band.columns.forEach((pieces, c) => {
					const columnGeometry = bandGeometry.columns[c] ?? bandGeometry.columns[0]
					const column = doc.createElement('div')
					applyCss(column, {
						position: 'absolute',
						left: px(page.margins.left + columnGeometry.left),
						top: px(top + band.top + shift),
						width: px(columnGeometry.width),
					})
					for (const piece of pieces) {
						const element = elements.get(piece)!
						this.placed.set(element, piece)
						column.append(element)
					}
					view.sheet.append(column)
					// Word draws a column separator midway between columns, as tall as the text beside it
					const before = bandGeometry.columns[c - 1]
					if (before && sections[band.section].columns.separator && used > 0) {
						const line = doc.createElement('div')
						const x = page.margins.left + (before.left + before.width + columnGeometry.left) / 2
						applyCss(line, {
							position: 'absolute',
							left: px(x),
							top: px(top + band.top + shift),
							width: '0',
							height: px(used),
							borderLeft: '1px solid #000000',
						})
						view.sheet.append(line)
					}
				})
			}
			if (planned_.notes.length) {
				const area = doc.createElement('div')
				applyCss(area, {
					position: 'absolute',
					left: px(page.margins.left),
					bottom: px(page.height - top - height),
					width: px(page.contentWidth),
				})
				lock(area)
				area.append(this.separator.cloneNode(true))
				for (const id of planned_.notes) {
					const note = this.notes.get(id)
					if (note) area.append(note)
				}
				view.sheet.append(area)
			}
			return view
		})
		// The pages around them stay, renumbered after pages that came or went
		const fewer = this.planned.length - planned.length
		const kept = this.views.slice(to + fewer)
		for (const view of this.views.slice(from, to + fewer)) view.slot.remove()
		const after = kept[0]?.slot ?? null
		for (const view of views) this.stack.insertBefore(view.slot, after)
		kept.forEach((view, k) => (view.sheet.dataset.page = String(to + k)))
		this.views = [...this.views.slice(0, from), ...views, ...kept]
		// Objects positioned on the page join the page their paragraph landed on
		for (const anchor of registry.anchors) {
			const sheet = anchor.block.closest<HTMLElement>('[data-page]')
			const index = Number(sheet?.dataset.page)
			if (!sheet || index < from || index >= to) continue
			const planned_ = planned[index]
			const page = geometry(sections[planned_.section], settings, planned_.number % 2 === 0)
			const column = geometries[planned_.section].columns[0]
			const position = pagePosition(anchor.object, page, {left: page.margins.left + column.left, width: column.width})
			anchor.element.style.left = px(position.left)
			anchor.element.style.top = px(position.top)
			sheet.append(anchor.element)
		}
		// Page numbers, now that every page has one
		this.views.forEach((view, index) => {
			for (const field of view.sheet.querySelectorAll<HTMLElement>('[data-field]'))
				field.textContent = numberOn(planned[index], field)
		})
		for (const key of this.elements.keys()) if (cut.has(key.slice(0, key.lastIndexOf(':')))) this.elements.delete(key)
		for (const [piece, element] of elements)
			this.elements.set(`${piece.section}:${piece.item}:${startOf(piece)}`, element)
		this.planned = planned
		return this.views
	}

	// Lays each header and footer out for the numbers of the pages it's on, and notes on each page which layout it
	// takes. The text of one is laid out once, with every number a 1, and copied onto its pages: but tabs go by the
	// width of what's around them, and "Page 1 of 10" that ends at the right margin has no room on its line for a number
	// of two digits. So the text is laid out again for each set of widths its numbers have on some page, which is a
	// few however long the document, digits being mostly as wide as each other. The numbers not met before are all
	// measured at once, and each layout is one more pass of reads and writes: none at all for most edits.
	private fit(
		numbered: Array<{story: Rendered; page: PlannedPage}>,
		numberOn: (page: PlannedPage, field: HTMLElement) => string,
		measure: HTMLElement,
		scale: number,
	) {
		const holder = this.doc.createElement('div')
		const probes: Array<{widths: Map<string, string>; probe: HTMLElement}> = []
		for (const {story, page} of numbered) {
			for (const {field, widths} of story.numbers) {
				const text = numberOn(page, field)
				if (widths.has(text)) continue
				const probe = field.cloneNode(false) as HTMLElement
				probe.textContent = text
				holder.append(probe)
				probes.push({widths, probe})
				// Noted as asked for, so that it's measured once
				widths.set(text, '')
			}
		}
		if (probes.length) {
			measure.append(holder)
			for (const {widths, probe} of probes)
				widths.set(probe.textContent!, px(probe.getBoundingClientRect().width / scale))
			holder.remove()
		}
		for (const {story, page} of numbered) {
			const key = widthsOf(story, (field) => numberOn(page, field))
			page.numbers = `${page.numbers ?? ''}${key};`
			if (story.fitted.has(key)) continue
			if (!story.element.isConnected) measure.append(story.element)
			for (const {field} of story.numbers) field.textContent = numberOn(page, field)
			this.layTabs(story.element, scale)
			story.fitted.set(key, story.element.cloneNode(true) as HTMLElement)
		}
	}

	// Lays out again the tabs of what's in a box
	private layTabs(box: HTMLElement, scale: number) {
		const tabs = this.context.registry.tabs.filter((tab) => box.contains(tab.element))
		for (const tab of tabs) resetTab(tab.element)
		layoutTabs(tabs, scale, this.model.settings, this.context.registry.range)
	}

	// Puts a block whole in its section's galley, to be measured or cut again
	private pull(galleys: HTMLElement[], whole: Set<string>, section: number, item: number) {
		const block = this.blocks[section][item]
		whole.add(`${section}:${item}`)
		if (block.parentElement === galleys[section]) return
		this.unsplit(block)
		galleys[section].append(block)
	}

	// Keeps an element's styles as rendered before a layout changes them
	private keep(
		element: HTMLElement,
		...properties: Array<'paddingTop' | 'paddingBottom' | 'textAlignLast' | 'height'>
	) {
		const saved = this.styles.get(element) ?? {}
		for (const property of properties) if (!(property in saved)) saved[property] = element.style[property]
		this.styles.set(element, saved)
	}

	// Cuts the items `cut` names into the parts these pages hold, finding where each paragraph's parts begin while it's
	// whole in the galley (a paragraph of the body, or of a table's row that's cut across pages), then cutting it from
	// the last point back (so the earlier points stay valid). Other items keep the parts they have. Returns the element
	// of every piece.
	private split(
		pages: PlannedPage[],
		cut: Set<string>,
		galleys: HTMLElement[],
		whole: Set<string>,
		scale: number,
	): Map<Piece, HTMLElement> {
		const {registry} = this.context
		const byItem = new Map<string, Piece[]>()
		for (const piece of pages.flatMap((page) => page.bands.flatMap((band) => band.columns.flat()))) {
			const key = `${piece.section}:${piece.item}`
			byItem.set(key, [...(byItem.get(key) ?? []), piece])
		}
		const out = new Map<Piece, HTMLElement>()
		const parted: Piece[][] = []
		for (const [key, pieces] of byItem) {
			const {section, item} = pieces[0]
			const block = this.blocks[section][item]
			if (!cut.has(key)) for (const piece of pieces) out.set(piece, this.elements.get(`${key}:${startOf(piece)}`)!)
			else if (pieces.length > 1 && (registry.paragraphs.has(block) || pieces.some((piece) => piece.cut))) {
				this.pull(galleys, whole, section, item)
				parted.push(pieces)
			} else {
				this.unsplit(block)
				parted.push(pieces)
			}
		}
		const jobs: Array<() => void> = []
		for (const pieces of parted) {
			const block = this.blocks[pieces[0].section][pieces[0].item]
			if (pieces.length > 1 && registry.paragraphs.has(block)) {
				const lines = this.measurers[pieces[0].section].lines(pieces[0].item)
				const list = atoms(block, registry)
				const positions = pieces
					.slice(0, -1)
					.map((piece) => lineStart(list, lines, piece.to!, block, scale, registry.range))
				jobs.push(() => {
					const parts = positions.map((_, i) => this.cutParagraph(block, positions[positions.length - 1 - i]))
					pieces.forEach((piece, i) => out.set(piece, i ? parts[parts.length - i] : block))
				})
			} else if (pieces.length > 1) {
				const measurer = this.measurers[pieces[0].section]
				const cuts = pieces.map(({item, to, cut}) => cut && measurer.places(item, to! - 1, cut))
				jobs.push(() => {
					const table = block as HTMLTableElement
					const parts = this.splitTable(table, pieces, cuts, headerRows(table, registry))
					pieces.forEach((piece, i) => out.set(piece, parts[i]))
				})
			} else out.set(pieces[0], block)
			jobs.push(() => {
				for (const piece of pieces) {
					if (!piece.drop) continue
					const element = out.get(piece)!
					for (const spacer of spacers(element, registry, 'Top')) {
						if (element === block) this.keep(spacer, 'paddingTop')
						spacer.style.paddingTop = '0'
					}
				}
			})
		}
		for (const job of jobs) job()
		return out
	}

	// Cuts a paragraph's block in two at a position in it (or after it all, with none), and returns the part that
	// continues it, which is counted the first of its later parts: a block cut more than once is cut from the last
	// point back. The part that goes on has no space after, and its last line stays justified; the part that continues
	// it has no space before and no first-line indent.
	private cutParagraph(block: HTMLElement, position: Position | undefined): HTMLElement {
		const {registry} = this.context
		const inner = contentOf(block, registry)
		this.keep(inner, 'textAlignLast')
		const part = position ? splitBlock(block, position, registry) : (block.cloneNode(false) as HTMLElement)
		for (const spacer of spacers(block, registry, 'Bottom')) {
			this.keep(spacer, 'paddingBottom')
			spacer.style.paddingBottom = '0'
		}
		if (inner.style.textAlign === 'justify') inner.style.textAlignLast = 'justify'
		for (const spacer of spacers(part, registry, 'Top')) spacer.style.paddingTop = '0'
		contentOf(part, registry).style.textIndent = '0'
		this.parts.set(block, [part, ...(this.parts.get(block) ?? [])])
		return part
	}

	// Splits a table into the parts its pieces are. Later parts repeat `headers`, the table's header rows, and a cell
	// merged across the start of a part continues as an empty cell at its top. A part that ends inside a row (`cuts`
	// has where, in each of the row's cells) is followed by one that starts with the rest of that row, as a row of its
	// own whose cells hold what's below the cut; each part of the row is as tall as it was planned. A table inside one
	// of the row's cells is split the same way, into what each part of the row holds of it.
	private splitTable(
		table: HTMLTableElement,
		pieces: TablePart[],
		cuts: Array<RowCuts | undefined>,
		headers: HTMLTableRowElement[],
	): HTMLTableElement[] {
		const rows = Array.from(table.rows)
		const inside: HTMLElement[] = []
		const parts: HTMLTableElement[] = [table]
		// The part of a table inside a cell that goes below each cut of the cell
		const below = new Map<CellCut, HTMLTableElement>()
		// From the last part back, so that a cell cut more than once is cut where each cut was found
		for (let i = pieces.length - 1; i >= 1; i--) {
			const {from, to = rows.length, skip, cut} = pieces[i]
			const held = rows.slice(from, to)
			const row = held[0]
			const places = cuts[i - 1]
			if (row && skip && places) {
				// The tables in the row's cells come first, each split at every cut of the row at once: the part after
				// this one doesn't start inside the row, so this is the last of them
				const next = pieces[i + 1]
				if (!next?.skip || next.from !== from) inside.push(...this.splitInner(pieces, cuts, i, below))
				// The part ends inside the row it starts in when the row is cut again there
				const within = cut !== undefined && held.length === 1
				const rest = row.cloneNode(false) as HTMLTableRowElement
				held[0] = rest
				this.rests.add(rest)
				inside.push(rest)
				// A part's height is its rows' and what the table has outside them, which differs at its top and its bottom
				// from what it has between two rows
				const {between} = places
				const top = headers.length ? between : places.top
				const bottom = held.length === 1 ? places.bottom : between
				rest.style.height = px((within ? cut.height : skip.rest) - top - bottom)
				// Unless the part before starts inside the row too, it ends with the row itself
				const before = pieces[i - 1]
				if (before.skip === undefined || before.from !== from) {
					this.keep(row, 'height')
					row.style.height = px(skip.height - (before.from === from ? top : between) - places.bottom)
					inside.push(row)
				}
				const where = new Map(places.cells.map((cell, c) => [cell.td, c]))
				for (const [cell, continued] of this.continueCells(rows, from, from + 1, rest)) {
					if (!cell.firstElementChild) continue
					this.origins.set(continued, cell)
					// A cell cut in the same place twice has nothing in the part between
					const c = where.get(cell)
					const none = c === undefined || (within && samePlace(cut, skip, c))
					inside.push(...this.carry(cell, continued, none ? undefined : places.cells[c], below))
				}
			} else if (row) for (const [, continued] of this.continueCells(rows, from, from, row)) this.added.add(continued)
			const part = this.shell(table)
			for (const header of headers) {
				// A copy to read: the row that's edited is the original, on the first page
				const copy = header.cloneNode(true) as HTMLTableRowElement
				lock(copy)
				this.copies.add(copy)
				part.tBodies[0].append(copy)
			}
			part.tBodies[0].append(...held)
			parts.splice(1, 0, part)
		}
		// A table inside a cell merged across rows is split once for each of those rows that's cut: the parts and the
		// rows made first are the last in it
		this.parts.set(table, [...parts.slice(1), ...(this.parts.get(table) ?? [])])
		if (inside.length) this.inside.set(table, [...(this.inside.get(table) ?? []), ...inside])
		return parts
	}

	// Splits the tables inside the cells of a row cut across pages, each into what the row's parts hold of it. The
	// row's cuts are where the table's parts up to `last` start, those that start inside the row. A table is cut where
	// they fall in it: before a row of its own, or through one. Returns the tables, and notes in `below` the part of
	// each that goes below each cut.
	private splitInner(
		pieces: TablePart[],
		cuts: Array<RowCuts | undefined>,
		last: number,
		below: Map<CellCut, HTMLTableElement>,
	): HTMLTableElement[] {
		const {from} = pieces[last]
		let first = last
		while (first > 1 && pieces[first - 1].skip && pieces[first - 1].from === from) first--
		const series = pieces.slice(first, last + 1).map((piece, k) => ({cut: piece.skip!, places: cuts[first + k - 1]!}))
		const tables: HTMLTableElement[] = []
		series[0].places.cells.forEach((_, c) => {
			// Where the cell is cut, but for a cut in the same place as the next: nothing of the cell is between them
			const marks = series
				.filter(({cut}, k) => k === series.length - 1 || !samePlace(cut, series[k + 1].cut, c))
				.map(({cut, places}) => ({cell: places.cells[c], through: cut.inner?.[c]}))
			for (let k = 0; k < marks.length; k++) {
				const table = marks[k].cell.block
				if (!(table instanceof HTMLTableElement) || !marks[k].cell.inside) continue
				// The cuts that fall in this table, each where a part of it starts: at a row, or inside one
				const starts: Array<{cell: CellCut; row: number; skip?: RowCut; places?: RowCuts}> = []
				for (; k < marks.length && marks[k].cell.block === table; k++) {
					const {cell, through} = marks[k]
					const inside = cell.inside as {row: number; cut?: RowCuts}
					starts.push({cell, row: inside.row, skip: inside.cut && through, places: inside.cut})
				}
				k--
				// A part ends where the next one starts, with the row that's cut there
				const parts = this.splitTable(
					table,
					[undefined, ...starts].map((start, t) => {
						const end = starts[t]
						return {from: start?.row ?? 0, skip: start?.skip, to: end && end.row + (end.skip ? 1 : 0), cut: end?.skip}
					}),
					[...starts.map((start) => start.places), undefined],
					[],
				)
				starts.forEach(({cell}, t) => below.set(cell, parts[t + 1]))
				tables.push(table)
			}
		})
		return tables
	}

	// An empty table like another, for a part of its rows
	private shell(table: HTMLTableElement): HTMLTableElement {
		const part = table.cloneNode(false) as HTMLTableElement
		const columns = table.querySelector(':scope > colgroup')
		if (columns) part.append(columns.cloneNode(true))
		part.append(this.doc.createElement('tbody'))
		return part
	}

	// Ends the cells of the rows before `above` that reach past row `from`, and continues each with an empty cell at
	// its column in the row `into`. Returns each with the cell that continues it.
	private continueCells(rows: HTMLTableRowElement[], from: number, above: number, into: HTMLTableRowElement) {
		const {registry} = this.context
		const continued: Array<[HTMLTableCellElement, HTMLTableCellElement]> = []
		for (let r = 0; r < above; r++) {
			for (const cell of Array.from(rows[r].cells)) {
				if (r + cell.rowSpan <= from) continue
				if (!this.rowSpans.has(cell)) this.rowSpans.set(cell, cell.rowSpan)
				const next = cell.cloneNode(false) as HTMLTableCellElement
				next.rowSpan = r + cell.rowSpan - from
				cell.rowSpan = above - r
				const column = registry.columns.get(cell) ?? 0
				registry.columns.set(next, column)
				const before = Array.from(into.cells).find((other) => (registry.columns.get(other) ?? 0) > column)
				into.insertBefore(next, before ?? null)
				continued.push([cell, next])
			}
		}
		return continued
	}

	// Moves what a cell holds below a cut into the cell that continues it: the blocks from the cut's on, and of the
	// first of them what's below the cut where the cut is inside it (a paragraph is cut in two there, and a table has
	// been: `below` has its part). A block that starts below the cut keeps its space before, as the first in any cell
	// does. Returns the paragraph it cut.
	private carry(
		cell: HTMLTableCellElement,
		continued: HTMLTableCellElement,
		cut: CellCut | undefined,
		below: Map<CellCut, HTMLTableElement>,
	): HTMLElement[] {
		const rest = cell.firstElementChild!.cloneNode(false) as HTMLElement
		continued.append(rest)
		const block = cut?.block
		if (!block) return []
		const following: Element[] = []
		for (let next = block.nextElementSibling; next; next = next.nextElementSibling) following.push(next)
		const {inside} = cut
		const first = !inside ? block : 'row' in inside ? below.get(cut)! : this.cutParagraph(block, inside.position)
		rest.append(first, ...following)
		return inside && 'position' in inside ? [block] : []
	}

	// Puts a block back as rendered: its parts rejoined, merged cells whole, styles restored
	private unsplit(block: HTMLElement) {
		const {registry} = this.context
		for (const part of this.parts.get(block) ?? []) {
			if (registry.paragraphs.has(block)) {
				join(contentOf(block, registry), contentOf(part, registry), registry)
				part.remove()
				const paragraph = registry.paragraphs.get(part)
				const fragments = paragraph && registry.fragments.get(paragraph)
				if (fragments) fragments.splice(fragments.indexOf(part), 1)
			} else {
				const body = (block as HTMLTableElement).tBodies[0]
				for (const row of Array.from((part as HTMLTableElement).rows)) if (!this.copies.has(row)) body.append(row)
				part.remove()
			}
		}
		this.parts.delete(block)
		// What cutting a table's rows changed inside it: the paragraphs and tables cut with them rejoin and the rows are
		// as tall as they were, then what else the rest of each row holds goes back into the row, the first rest first
		// (they were made last)
		const inside = this.inside.get(block) ?? []
		this.inside.delete(block)
		for (const element of inside) if (!this.rests.has(element)) this.unsplit(element)
		for (const row of inside.reverse()) {
			if (!this.rests.has(row)) continue
			for (const cell of Array.from((row as HTMLTableRowElement).cells)) {
				const origin = this.origins.get(cell)
				if (origin) origin.firstElementChild!.append(...cell.firstElementChild!.childNodes)
			}
			row.remove()
		}
		for (const cell of this.added) {
			if (!block.contains(cell)) continue
			cell.remove()
			this.added.delete(cell)
		}
		for (const [cell, span] of this.rowSpans) {
			if (!block.contains(cell)) continue
			cell.rowSpan = span
			this.rowSpans.delete(cell)
		}
		for (const element of [block, contentOf(block, registry)]) {
			const saved = this.styles.get(element)
			if (saved) Object.assign(element.style, saved)
			this.styles.delete(element)
		}
	}
}

// A piece among its item's, by where it starts: at a line or a row, or inside a row that was cut, by how much of the
// row is left
const startOf = (piece: Piece) => (piece.skip ? `${piece.from}+${piece.skip.rest}` : `${piece.from}`)

const storyKey = (story: Story, page: Geometry) => `${story.part}@${page.contentWidth}@${page.grid ?? ''}`

// The page numbers of a header or footer that share a paragraph with one of its tabs, which are laid out by them.
// Each is made a box of its own, as wide as its text whatever is beside it, so that pages whose numbers are as wide
// can share a layout: letters side by side are shaped together, across the edges of what they're in too. Not in a
// paragraph with anything set from right to left, though, where a box isn't ordered in its line as a number is.
function numbersOf(story: HTMLElement, tabs: TabEntry[]): Rendered['numbers'] {
	const boxes = new Set(tabs.map((tab) => tab.element.closest('div')))
	return [...story.querySelectorAll<HTMLElement>('[data-field]')]
		.filter((field) => {
			const box = field.closest('div')
			return box && boxes.has(box) && !rightToLeft(box)
		})
		.map((field) => {
			applyCss(field, {display: 'inline-block', whiteSpace: 'pre', textIndent: '0'})
			return {field, widths: new Map()}
		})
}

// Whether anything of a paragraph is set from right to left: all of it (as its table may have it too), a run of it,
// or letters written that way
const rightToLeft = (box: HTMLElement) =>
	getComputedStyle(box).direction === 'rtl' ||
	[...box.querySelectorAll<HTMLElement>('span')].some((span) => span.style.direction === 'rtl') ||
	RIGHT_TO_LEFT.test(box.textContent!)

// How wide the page numbers of a header or footer are with the texts a page gives them, which names the layout of it
// that the page takes
const widthsOf = (story: Rendered, text: (field: HTMLElement) => string) =>
	story.numbers.map(({field, widths}) => widths.get(text(field))).join(' ')

// The rows a table starts with that its parts on later pages repeat
function headerRows(table: HTMLTableElement, registry: Registry): HTMLTableRowElement[] {
	const headers: HTMLTableRowElement[] = []
	for (const row of Array.from(table.rows)) {
		if (!registry.rows.get(row)?.header) break
		headers.push(row)
	}
	return headers
}

function galley(measure: HTMLElement, width: number): HTMLElement {
	const element = measure.ownerDocument.createElement('div')
	applyCss(element, {position: 'relative', width: px(width), display: 'flow-root'})
	measure.append(element)
	return element
}

// The element that holds a paragraph block's content: its inner box when it has borders or shading
function contentOf(block: HTMLElement, registry: Registry): HTMLElement {
	const first = block.firstElementChild
	return first && registry.boxes.has(first) ? (first as HTMLElement) : block
}

// What holds the space before a paragraph (at its top) or after it, as padding: its block, and the block's box too
// where the box is one with that of the paragraph beside it, so that the space between the two is inside. Not a box
// with a border on that side, though, whose padding there is how far the border is from the text.
function spacers(block: HTMLElement, registry: Registry, side: 'Top' | 'Bottom'): HTMLElement[] {
	const inner = contentOf(block, registry)
	return inner === block || inner.style[`border${side}Style`] ? [block] : [block, inner]
}

// Appends one part's content to another, rejoining the elements a split cloned on the way down
function join(target: HTMLElement, source: HTMLElement, registry: Registry) {
	let left = target.lastChild
	let right = source.firstChild
	target.append(...source.childNodes)
	const twins = (a: Node, b: Node) => {
		if (!(a instanceof HTMLElement) || !(b instanceof HTMLElement) || a.tagName !== b.tagName) return false
		const slot = registry.refs.get(a)
		return slot
			? slot === registry.refs.get(b)
			: a instanceof HTMLAnchorElement
				? a.href === (b as HTMLAnchorElement).href
				: false
	}
	while (left && right && twins(left, right)) {
		const nextLeft: ChildNode | null = left.lastChild
		const nextRight: ChildNode | null = right.firstChild
		;(left as HTMLElement).append(...right.childNodes)
		const slot = registry.refs.get(right as Element)
		if (slot) {
			const spans = registry.spans.get(slot.id)
			spans?.splice(spans.indexOf(right as HTMLElement), 1)
			registry.refs.delete(right as Element)
		}
		right.remove()
		left = nextLeft
		right = nextRight
	}
	target.normalize()
}

function layer(element: HTMLElement): HTMLElement {
	const copy = element.cloneNode(true) as HTMLElement
	lock(copy)
	return copy
}

// A header or footer, cloned and placed on a page
function placed(element: HTMLElement, page: Geometry, at: {top: number} | {bottom: number}): HTMLElement {
	const copy = element.cloneNode(true) as HTMLElement
	applyCss(copy, {position: 'absolute', left: px(page.margins.left), width: px(page.contentWidth)})
	if ('top' in at) copy.style.top = px(at.top)
	else copy.style.bottom = px(at.bottom)
	lock(copy)
	return copy
}

function zoomView(view: PageView, zoom: number) {
	view.slot.style.width = px(view.width * zoom)
	view.slot.style.height = px(view.height * zoom)
	view.sheet.style.transform = `scale(${zoom})`
}

function createPage(doc: Document, section: Section, background: string | undefined, zoom: number): PageView {
	const slot = doc.createElement('div')
	// A page off screen isn't laid out or painted, so a long document scrolls and zooms as lightly as a short one: the
	// slot's size is set, so skipping what's in it moves nothing. The pages the selection is on are kept from that (see
	// the editor's hold()).
	applyCss(slot, {
		position: 'relative',
		flex: 'none',
		overflow: 'hidden',
		backgroundColor: background ?? '#ffffff',
		contentVisibility: 'auto',
	})
	const sheet = doc.createElement('div')
	applyCss(sheet, RESET)
	applyCss(sheet, {
		position: 'absolute',
		left: '0',
		top: '0',
		width: px(section.pageWidth),
		height: px(section.pageHeight),
		transformOrigin: '0 0',
		overflow: 'hidden',
		isolation: 'isolate',
	})
	slot.append(sheet)
	const view = {sheet, slot, width: section.pageWidth, height: section.pageHeight}
	zoomView(view, zoom)
	return view
}

// The short line above footnotes and endnotes
function rule(doc: Document): HTMLElement {
	const line = doc.createElement('div')
	applyCss(line, {
		width: '33%',
		maxWidth: '192px',
		height: '12px',
		borderTop: '1px solid #000000',
		marginTop: '6px',
		boxSizing: 'border-box',
	})
	lock(line)
	return line
}

// How much the galley is scaled on screen (by a transformed ancestor), so measurements come back in layout px
function scaleOf(galley: HTMLElement, width: number): number {
	const actual = galley.getBoundingClientRect().width
	return actual > 0 && width > 0 ? actual / width : 1
}

// Loads the faces the galley's text is set in, then measures each font stack's natural line height (Word's single
// line spacing) into the CSS variables that size lines. The galley stays out of layout until then: laid out before
// those are set, or while its faces load, it would only be laid out again. Faces still loading after 3 s are left to
// load, and handed back as `late` (wrapped: an async function's promise would wait for a promise it returned).
async function settle(
	doc: Document,
	root: HTMLElement,
	{stacks, faces}: Pick<LayoutContext, 'stacks' | 'faces'>,
	measure: HTMLElement,
): Promise<{late?: Promise<unknown>}> {
	measure.style.display = 'none'
	const fonts = (doc as Document & {fonts?: FontFaceSet}).fonts
	let late: Promise<unknown> | undefined
	if (fonts) {
		// The text picks which of a face's subsets (Latin, Cyrillic…) to load
		const text = measure.textContent ?? ''
		const loads = [...faces].map((face) => fonts.load(face, text))
		for (const stack of stacks.keys()) loads.push(fonts.load(probeFont(stack), 'x'))
		const loaded = Promise.allSettled(loads)
		const done = await Promise.race([
			loaded.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
		])
		if (!done) late = loaded
	}
	lineHeights(doc, root, stacks, root)
	measure.style.display = ''
	return {late}
}

// The sizes a font stack's line is probed at, which add up to EM. A browser rounds a face's ascent, descent and line
// gap to whole pixels each, so a line's height at one size is up to a pixel and a half out: at 200 px, Times New
// Roman's comes to 1.145 of its size instead of 1.1499, and a page takes a line more than Word's. Most faces are
// drawn on 2048 units to the em, and at two sizes that add up to as many pixels, what one rounds away the other
// rounds in: the two heights add up to the face's own units.
const EM = 2048
const PROBES = [1000, EM - 1000]

// The font shorthand that loads the face a stack's probes are set in
const probeFont = (stack: string) => `${PROBES[0]}px ${stack}`

// Each font stack's natural line height, as a share of its size, into the CSS variables, from probes put in
// `holder`. Heights are read in layout px (whole pixels, as browsers round a normal line anyway): a viewer's entrance
// may still be scaling the pages, and a height on screen would make the same file paginate differently from one open
// to the next.
function lineHeights(doc: Document, root: HTMLElement, stacks: LayoutContext['stacks'], holder: HTMLElement) {
	const box = doc.createElement('div')
	applyCss(box, RESET)
	applyCss(box, {position: 'absolute', left: '0', top: '0', visibility: 'hidden'})
	const probes = [...stacks].map(([stack, index]) => {
		const lines = PROBES.map((size) => {
			const line = doc.createElement('div')
			applyCss(line, {
				fontFamily: stack,
				fontSize: px(size),
				lineHeight: 'normal',
				whiteSpace: 'nowrap',
				position: 'absolute',
				top: '0',
				left: '0',
			})
			line.textContent = 'x'
			return line
		})
		box.append(...lines)
		return [lines, index] as const
	})
	holder.append(box)
	const ratios = probes.map(
		([lines, index]) => [lines.reduce((sum, line) => sum + line.offsetHeight, 0) / EM, index] as const,
	)
	box.remove()
	for (const [ratio, index] of ratios) if (ratio > 0) root.style.setProperty(`--docx-line-${index}`, String(ratio))
}

// ---------------------------------------------------------------------------------------------------------------
// Tabs

const LEADERS = lookup<string>({
	dot: 'dotted',
	hyphen: 'dashed',
	underscore: 'solid',
	heavy: 'solid',
	middleDot: 'dotted',
})

// Less than a browser can place anything by: it rounds to a 64th of a pixel, or a 60th
const HAIR = 0.01

// More than any line is long: Word's widest page is 22 inches
const ROOM = 2112

// The boxes each tab draws further on than the line has them: see layoutTabs()
const hung = new WeakMap<HTMLElement, HTMLElement[]>()

// A tab as it was rendered, to be laid out again
function resetTab(tab: HTMLElement) {
	applyCss(tab, {width: '0', marginRight: '', borderBottom: ''})
	for (const box of hung.get(tab) ?? []) applyCss(box, {position: '', left: ''})
	hung.delete(tab)
}

// Sizes each tab so what follows starts at the next stop. A paragraph's tabs depend on the ones before them, so
// paragraphs go in rounds (every paragraph's first tab, then every second…), each one pass of reads, one of writes.
//
// A stop can be past the right edge of its paragraph's lines: the page numbers of a contents page indented on the
// right stand beyond the indent, and a header's stops are often those of narrower margins. Word sets the text at such a
// stop all the same, on the tab's line, and whatever comes after it on that line. A browser's line takes no more than
// it's wide, so the tab takes up that much less of the line than it's wide, and what follows it on the line is drawn
// that much further on. What follows is measured for that with room for all of it on the tab's line, which is one
// more pass of reads and one of writes.
function layoutTabs(entries: TabEntry[], scale: number, settings: Settings, range: Range) {
	// Each tab with the others in the box it's in now: a paragraph cut across pages has a box on each
	const byBlock = new Map<HTMLElement, TabEntry[]>()
	for (const entry of entries) {
		const block = entry.element.closest('div')
		if (!block) continue
		const list = byBlock.get(block) ?? []
		list.push(entry)
		byBlock.set(block, list)
	}
	const lists = [...byBlock]
	const rounds = Math.min(64, Math.max(0, ...lists.map(([, list]) => list.length)))
	for (let round = 0; round < rounds; round++) {
		const tabs = lists.flatMap(([block, list]) => {
			const entry = list[round]
			if (!entry) return []
			const next = list[round + 1]?.element
			const box = block.getBoundingClientRect()
			const rect = entry.element.getBoundingClientRect()
			// Stops count from the column edge, which is the paragraph's indent left of its text. Its box starts there
			// and ends where the lines do, unless it reaches past them.
			const left = entry.indent - entry.reach.start
			const x = (rect.left - box.left) / scale + left
			const edge = box.width / scale + left - entry.reach.end
			const stop = tabStop({...entry, leader: entry.element.dataset.leader}, x, edge, settings)
			const width = tabWidth(stop, x, followingWidth(range, block, entry.element, next, rect, scale))
			// How far on the tab is drawn itself, after another whose stop is past the edge
			const drawn = parseFloat(entry.element.style.left) || 0
			const past = (drawn > 0 || (stop.align !== 'left' && stop.pos > edge + HAIR)) && block.style.direction !== 'rtl'
			return [{entry, block, next, x, edge, stop, width, drawn, past}]
		})
		for (const {entry, stop, width, past} of tabs) {
			applyCss(entry.element, past ? {width: '0', marginRight: px(-ROOM)} : {width: px(width)})
			if (stop.leader !== 'none')
				entry.element.style.borderBottom = `${stop.leader === 'heavy' ? 2 : 1}px ${LEADERS[stop.leader]} currentColor`
		}
		const beyond = tabs.filter(({past}) => past)
		const places = beyond.map(({entry, block, next, x, edge, stop, drawn}) => {
			const following = followingWidth(range, block, entry.element, next, entry.element.getBoundingClientRect(), scale)
			const width = tabWidth(stop, x, following)
			// Text too long to end at its stop starts where the tab does, and takes the lines it needs unless it's past the
			// edge already. Half a pixel is to spare, for a line that rounding can't overfill.
			return {width, pull: width > 0 || drawn > 0 ? x + width + following.width - edge + 0.5 : 0}
		})
		beyond.forEach(({entry, block, drawn}, i) => {
			const {width, pull} = places[i]
			applyCss(entry.element, {width: px(width), marginRight: pull ? px(drawn - pull) : ''})
			if (!pull) return
			const boxes = tail(entry.element, block)
			for (const box of boxes) applyCss(box, {position: 'relative', left: px(pull)})
			hung.set(entry.element, boxes)
		})
	}
	for (const [, list] of lists)
		for (const entry of list.slice(rounds)) entry.element.style.width = px(settings.defaultTabStop)
}

type Stop = {pos: number; align: string; leader: string}

// The stop a tab that starts at `x` runs to, in a paragraph whose lines end at `edge`
export function tabStop(
	entry: Pick<TabEntry, 'stops' | 'indent' | 'hanging' | 'right' | 'cell' | 'ptab'> & {leader?: string},
	x: number,
	edge: number,
	settings: Pick<Settings, 'defaultTabStop' | 'compatibilityMode'>,
): Stop {
	if (entry.ptab) {
		const pos = entry.ptab.align === 'right' ? edge : entry.ptab.align === 'center' ? edge / 2 : x
		return {pos, align: entry.ptab.align, leader: entry.leader ?? 'none'}
	}
	// A hanging indent is a stop of its own; custom stops clear the default stops before them
	const stops = entry.stops.filter((tab) => tab.align !== 'bar' && tab.align !== 'clear')
	const hanging =
		entry.hanging > 0 && !stops.some((tab) => Math.abs(tab.pos - entry.indent) < 0.5)
			? [{pos: entry.indent, align: 'left', leader: 'none'}]
			: []
	const custom = [...stops, ...hanging].sort((a, b) => a.pos - b.pos)
	// The first stop past where the tab starts. A place measured a hair short of a stop is at it: a tab that follows
	// another starts where the first one ended, which is its stop as the browser rounded it.
	const past = x + 0.5
	const stop = custom.find((tab) => tab.pos > past) ?? {
		pos: (Math.floor(past / settings.defaultTabStop) + 1) * settings.defaultTabStop,
		align: 'left',
		leader: 'none',
	}
	// Past the edge of the lines, text is set at its stop as anywhere: in the page's margin too by a document made
	// before Word 2013, and since then only as far as the margin, where a stop beyond is a right-aligned one at the edge.
	// A cell has no margin for its text to stand in: past its edge is the cell beside it.
	const margin = edge + Math.max(0, entry.right)
	if (stop.align !== 'left' && stop.pos > margin + HAIR && (entry.cell || settings.compatibilityMode >= 15))
		return {...stop, pos: edge, align: 'right'}
	return stop
}

// How wide a tab that starts at `x` is, for what follows it to be set at its stop
export function tabWidth(stop: Stop, x: number, following: {width: number; decimal: number}): number {
	const gap = stop.pos - x
	const width =
		stop.align === 'right'
			? gap - following.width
			: stop.align === 'center'
				? gap - following.width / 2
				: stop.align === 'decimal'
					? gap - following.decimal
					: gap
	return Math.max(0, width)
}

// The boxes that follow a tab on its line, a link's boxes each one of them: up to the break that ends the line, and
// not the objects that are placed apart from it
function tail(tab: HTMLElement, block: HTMLElement): HTMLElement[] {
	const boxes: HTMLElement[] = []
	for (let node: Element = tab; node !== block; node = node.parentElement!) {
		for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
			for (const box of sibling instanceof HTMLAnchorElement ? [...sibling.children] : [sibling]) {
				if (!(box instanceof HTMLElement)) continue
				// An object placed apart from the line is the box that its island holds
				const {style} = anchored(box) ?? box
				if (style.position === 'absolute' || style.cssFloat) continue
				if (style.display === 'block') return boxes
				boxes.push(box)
				if (box.querySelector(':scope > br')) return boxes
			}
		}
	}
	return boxes
}

// The width of what follows a tab on its line up to the next tab, and up to its first decimal point
function followingWidth(
	range: Range,
	block: HTMLElement,
	tab: HTMLElement,
	next: HTMLElement | undefined,
	rect: DOMRect,
	scale: number,
) {
	range.setStartAfter(tab)
	if (next) range.setEndBefore(next)
	else range.setEnd(block, block.childNodes.length)
	const center = (rect.top + rect.bottom) / 2
	let left = Infinity
	let right = -Infinity
	for (const box of range.getClientRects()) {
		if (box.top <= center && box.bottom >= center && box.width > 0) {
			left = Math.min(left, box.left)
			right = Math.max(right, box.right)
		}
	}
	const width = right > left ? (right - left) / scale : 0
	const text = range.toString()
	const point = text.indexOf('.')
	return {width, decimal: point < 0 ? width : width * (point / Math.max(1, text.length))}
}

// ---------------------------------------------------------------------------------------------------------------
// Measuring

function flowItem(block: HTMLElement, scale: number, registry: Registry): FlowItem {
	const height = block.getBoundingClientRect().height / scale
	const paragraph = registry.paragraphs.get(block)
	if (!paragraph) return {kind: 'table', height, before: 0, after: 0}
	const fragments = registry.fragments.get(paragraph) ?? []
	const space = (side: 'Top' | 'Bottom') =>
		spacers(block, registry, side).reduce((sum, spacer) => sum + (parseFloat(spacer.style[`padding${side}`]) || 0), 0)
	return {
		kind: 'paragraph',
		height,
		before: space('Top'),
		after: space('Bottom'),
		breakBefore: registry.breaks.get(block),
		breakAfter: registry.breaksAfter.get(block),
		// A paragraph divided by explicit breaks starts with its first block and keeps with what follows its last
		pageBreakBefore: fragments[0] === block && paragraph.props.pageBreakBefore,
		keepNext: fragments[fragments.length - 1] === block && paragraph.props.keepNext,
		keepLines: paragraph.props.keepLines,
		widowControl: paragraph.props.widowControl,
	}
}

// What the planner asks of each block, measured in the galley once and kept: each layout says where its galley is,
// and blocks it hasn't measured yet are put there whole first
class GalleyMeasurer implements Measurer {
	private lineCache = new Map<number, Box[]>()
	private rowCache = new Map<number, Array<Box & {header: boolean}>>()
	private cellCache = new Map<number, Map<number, MeasuredRow>>()
	private noteCache: Map<HTMLElement, Array<{y: number; id: string}>> | undefined
	private scale = 1
	private whole: (index: number) => void = () => {}

	constructor(
		private blocks: HTMLElement[],
		private registry: Registry,
		private heights: Map<string, number>,
		private separator: number,
	) {}

	use(scale: number, whole: (index: number) => void) {
		this.scale = scale
		this.whole = whole
	}

	// Blocks came in where `removed` were, from `index`: what's known of the blocks after them moves with them
	splice(index: number, removed: HTMLElement[], added: number) {
		const shift = added - removed.length
		const move = <T>(cache: Map<number, T>) => {
			for (let key = index; key < index + removed.length; key++) cache.delete(key)
			if (!shift) return
			const known = [...cache]
			cache.clear()
			for (const [key, value] of known) cache.set(key < index ? key : key + shift, value)
		}
		move(this.lineCache)
		move(this.rowCache)
		move(this.cellCache)
		for (const block of removed) this.noteCache?.delete(block)
	}

	// A block measured again, whole in the galley: what was known of it goes, and its notes are found where they now are
	forget(index: number, scale: number) {
		const block = this.blocks[index]
		this.lineCache.delete(index)
		this.rowCache.delete(index)
		this.cellCache.delete(index)
		this.noteCache?.set(
			block,
			this.registry.notes
				.filter(({element}) => block.contains(element))
				.map(({element, id}) => noteAt(block, element, id, scale)),
		)
	}

	// A block was typed in where it is on its page, and is as tall as it was. What was measured inside it can have
	// changed all the same, and is measured again when next asked for: a paragraph's lines, and of a table the rows
	// that hold what was typed in. Returns whether the block references footnotes, which only measuring it again finds
	// where they now are.
	touch(index: number, element: HTMLElement): boolean {
		this.lineCache.delete(index)
		const rows = this.cellCache.get(index)
		for (const [row, {units}] of rows ?? []) if (units.some(({td}) => td.contains(element))) rows!.delete(row)
		return Boolean(this.noteCache?.get(this.blocks[index])?.length)
	}

	lines(index: number): Box[] {
		let lines = this.lineCache.get(index)
		if (!lines) {
			this.whole(index)
			lines = lineBoxes(this.blocks[index], this.scale, this.registry)
			this.lineCache.set(index, lines)
		}
		return lines
	}

	rows(index: number): Array<Box & {header: boolean}> {
		let rows = this.rowCache.get(index)
		if (!rows) {
			this.whole(index)
			const block = this.blocks[index]
			rows = block instanceof HTMLTableElement ? rowBoxes(block, this.scale, this.registry) : []
			this.rowCache.set(index, rows)
		}
		return rows
	}

	cells(index: number, row: number): RowCells {
		return this.row(index, row).cells
	}

	// Where a cut of a row falls in each of its cells, found while the table is whole in the galley
	places(index: number, row: number, cut: RowCut): RowCuts {
		return this.placesIn(this.row(index, row), cut)
	}

	private placesIn({cells, units, top, bottom, between}: MeasuredRow, cut: RowCut): RowCuts {
		const places = units.map(({td, units, rows}, c): CellCut => {
			const at = cut.units[c]
			const unit = units[at]
			if (!unit) return {td}
			const {block, line, lines} = unit
			// The cut goes on through the unit where that's a row
			const through = cut.inner?.[c]
			if (through && cells.cells[c].row?.(at))
				return {td, block, inside: {row: line, cut: this.placesIn(rows.get(at)!, through)}}
			if (!line) return {td, block}
			if (block instanceof HTMLTableElement) return {td, block, inside: {row: line}}
			const position = lineStart(atoms(block, this.registry), lines, line, block, this.scale, this.registry.range)
			return {td, block, inside: {position}}
		})
		return {cells: places, top, bottom, between}
	}

	// A row is measured when a page first ends at it
	private row(index: number, row: number): MeasuredRow {
		let rows = this.cellCache.get(index)
		if (!rows) this.cellCache.set(index, (rows = new Map()))
		let measured = rows.get(row)
		const block = this.blocks[index]
		if (!measured) rows.set(row, (measured = this.measure(block, block, row, this.rows(index))))
		return measured
	}

	// …with its block whole in the galley. So is a row of a table inside one of its cells, when a page first ends in
	// that one: which can be layouts later, with the block somewhere else among the blocks.
	private measure(block: HTMLElement, table: HTMLElement, row: number, boxes: Box[]): MeasuredRow {
		this.whole(this.blocks.indexOf(block))
		return measureRow(table, row, boxes, this.scale, this.registry, (inner, row, boxes) =>
			this.measure(block, inner, row, boxes),
		)
	}

	notes(index: number): Array<{y: number; id: string}> {
		if (!this.noteCache) {
			// A reference belongs to the top-level block that contains it
			this.noteCache = new Map()
			const blocks = new Set(this.blocks)
			for (const {element, id} of this.registry.notes) {
				let block: HTMLElement | null = element
				while (block && !blocks.has(block)) block = block.parentElement
				if (!block) continue
				const list = this.noteCache.get(block) ?? []
				list.push(noteAt(block, element, id, this.scale))
				this.noteCache.set(block, list)
			}
		}
		return this.noteCache.get(this.blocks[index]) ?? []
	}

	noteHeight(id: string): number {
		return this.heights.get(id) ?? 0
	}

	separatorHeight(): number {
		return this.separator
	}
}

// A table's rows from its border-box top, and whether each repeats as a header
function rowBoxes(table: HTMLTableElement, scale: number, registry: Registry): Array<Box & {header: boolean}> {
	const origin = table.getBoundingClientRect().top
	return Array.from(table.rows, (row) => {
		const rect = row.getBoundingClientRect()
		return {
			top: (rect.top - origin) / scale,
			bottom: (rect.bottom - origin) / scale,
			header: registry.rows.get(row)?.header ?? false,
		}
	})
}

// What a table has outside a row, which is part of the height of a part the row is in but not of the row's own: at
// the top and at the bottom of a part, and between the row and the next. Where borders collapse, half the border at
// the edge of a part is outside its rows, and nothing is between rows. Where they don't, the table's spacing is.
type Outside = {top: number; bottom: number; between: number}

// A row of a table as the planner cuts it, with what each unit of its cells is: a block, or from its second on a line
// of a paragraph or a row of a table (`lines` are the block's). `rows` are the units that are rows, of tables inside
// the cell, which the planner has asked for.
type MeasuredRow = Outside & {
	cells: RowCells
	units: Array<{
		td: HTMLTableCellElement
		units: Array<{block: HTMLElement; line: number; lines: Box[]}>
		rows: Map<number, MeasuredRow>
	}>
}

// Where a row is cut in each of its cells. A cell is cut before `block`, or inside it: at a position in a paragraph
// (after all of it, with none), or before a row of a table, or through that row, at `cut`. With no block, the cell
// holds nothing below the cut.
type RowCuts = Outside & {cells: CellCut[]}
type CellCut = {
	td: HTMLTableCellElement
	block?: HTMLElement
	inside?: {position: Position | undefined} | {row: number; cut?: RowCuts}
}

// A part of a table's rows, as the planner's pieces of the table are
type TablePart = Pick<Piece, 'from' | 'to' | 'skip' | 'cut'>

// Whether two cuts of a row fall in the same place in one of its cells
const samePlace = (a: RowCut, b: RowCut, cell: number) =>
	a.units[cell] === b.units[cell] && JSON.stringify(a.inner?.[cell]) === JSON.stringify(b.inner?.[cell])

// Measures a row for cutting: every cell that covers it (one merged down from a row above too), in column order,
// with the lines of its paragraphs and the rows of its tables. All that a cell holds sideways stays whole. A row of a
// table inside a cell is measured in turn (by `inner`) when the planner asks for it.
function measureRow(
	block: HTMLElement,
	index: number,
	boxes: Box[],
	scale: number,
	registry: Registry,
	inner: (table: HTMLTableElement, row: number, boxes: Box[]) => MeasuredRow,
): MeasuredRow {
	const rows = block instanceof HTMLTableElement ? Array.from(block.rows) : []
	const row = registry.rows.get(rows[index])
	const height = block.getBoundingClientRect().height / scale
	const top = boundary(boxes, index, height)
	const bottom = boundary(boxes, index + 1, height)
	const cut = !row || row.header || row.props.heightRule === 'exact' ? 'never' : row.props.cantSplit ? 'forced' : 'free'
	const collapsed = block.style.borderCollapse === 'collapse'
	// Spacing between cells is above and below every row, half of it the row's as the planner counts them
	const spacing = collapsed ? 0 : parseFloat(block.style.borderSpacing) || 0
	const measured: MeasuredRow = {
		cells: {height: bottom - top, cut, cells: [], notes: []},
		units: [],
		top: spacing,
		bottom: spacing,
		between: spacing / 2,
	}
	if (cut === 'never') return measured
	const covering: Array<[HTMLTableCellElement, number]> = []
	for (let r = 0; r <= index; r++)
		for (const td of Array.from(rows[r].cells)) if (r + td.rowSpan > index) covering.push([td, r])
	covering.sort(([a], [b]) => (registry.columns.get(a) ?? 0) - (registry.columns.get(b) ?? 0))
	for (const [td, r] of covering) {
		// As wide as they're drawn, which is in whole device pixels
		const style = getComputedStyle(td)
		const borders = [parseFloat(style.borderTopWidth) || 0, parseFloat(style.borderBottomWidth) || 0]
		if (collapsed) {
			measured.top = Math.max(measured.top, borders[0] / 2)
			measured.bottom = Math.max(measured.bottom, borders[1] / 2)
		}
		const padding = (parseFloat(td.style.paddingTop) || 0) + (parseFloat(td.style.paddingBottom) || 0)
		const breaks: number[] = []
		const units: MeasuredRow['units'][number]['units'] = []
		const content = td.firstElementChild
		const origin = content?.getBoundingClientRect()
		const sideways = content instanceof HTMLElement && content.style.writingMode !== ''
		for (const child of Array.from(content?.children ?? []) as HTMLElement[]) {
			if (child.style.display === 'none') continue
			const y = (child.getBoundingClientRect().top - origin!.top) / scale
			const lines: Box[] = sideways
				? []
				: registry.paragraphs.has(child)
					? lineBoxes(child, scale, registry)
					: child instanceof HTMLTableElement
						? rowBoxes(child, scale, registry)
						: []
			units.push({block: child, line: 0, lines})
			breaks.push(y)
			for (let line = 1; line < lines.length; line++) {
				units.push({block: child, line, lines})
				breaks.push(y + boundary(lines, line, Infinity))
			}
			if (sideways) break
		}
		breaks.push(units.length ? origin!.height / scale : 0)
		const nested = new Map<number, MeasuredRow>()
		measured.units.push({td, units, rows: nested})
		measured.cells.cells.push({
			above: top - boundary(boxes, r, height),
			below: boundary(boxes, r + td.rowSpan, height) - bottom,
			inset: padding + borders[0] + borders[1] + 2 * spacing,
			breaks,
			row: (k) => {
				const unit = units[k]
				if (!(unit?.block instanceof HTMLTableElement) || !unit.lines.length) return undefined
				let row = nested.get(k)
				if (!row) nested.set(k, (row = inner(unit.block, unit.line, unit.lines)))
				return row.cells
			},
		})
	}
	// A footnote is referenced in the unit of the line its reference is on
	for (const {element, id} of registry.notes) {
		if (!block.contains(element)) continue
		const cell = measured.units.findIndex(({td}) => td.contains(element))
		const units = measured.units[cell]?.units ?? []
		const first = units.findIndex((unit) => unit.block.contains(element))
		if (first < 0) continue
		const {block: holder, lines} = units[first]
		const y = (element.getBoundingClientRect().top - holder.getBoundingClientRect().top) / scale
		const line = lines.findIndex((box) => y < box.bottom)
		measured.cells.notes.push({id, cell, unit: first + (line < 0 ? Math.max(0, lines.length - 1) : line)})
	}
	return measured
}

// Where a note's reference sits in its block, from the block's top
const noteAt = (block: HTMLElement, element: HTMLElement, id: string, scale: number) => ({
	y: (element.getBoundingClientRect().top - block.getBoundingClientRect().top) / scale,
	id,
})

// Line boxes, clustered from the boxes of a paragraph's text and of the objects that sit on its lines. A line begins
// above its text, by the leading a browser puts there: not always half of the line's (Chromium rounds that half down
// to a whole pixel). The first line, which begins where the paragraph's content does, shows how much, and a line with
// text as tall begins as far above its own, where that's between its text and the text above. Any other line begins
// halfway between the two.
function lineBoxes(block: HTMLElement, scale: number, registry: Registry): Box[] {
	const origin = block.getBoundingClientRect().top
	const {range} = registry
	const boxes: Box[] = []
	const add = (rect: DOMRect) => {
		if (rect.height > 0) boxes.push({top: (rect.top - origin) / scale, bottom: (rect.bottom - origin) / scale})
	}
	const walk = (node: Node) => {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === Node.TEXT_NODE) {
				if (!(child as Text).length) continue
				range.selectNodeContents(child)
				for (const rect of range.getClientRects()) add(rect)
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const element = child as HTMLElement
				const inline = registry.islands.get(element)
				if (inline?.kind === 'anchor') continue
				if (inline?.kind === 'graphic' || inline?.kind === 'rule') add(element.getBoundingClientRect())
				else walk(element)
			}
		}
	}
	walk(block)
	boxes.sort((a, b) => a.top - b.top)
	const lines: Box[] = []
	for (const box of boxes) {
		const line = lines[lines.length - 1]
		const overlap = line ? Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top) : 0
		if (line && overlap > 0.5 * Math.min(line.bottom - line.top, box.bottom - box.top)) {
			line.top = Math.min(line.top, box.top)
			line.bottom = Math.max(line.bottom, box.bottom)
		} else lines.push({...box})
	}
	if (lines.length < 2) return lines
	const content = contentOf(block, registry)
	const style = getComputedStyle(content)
	const top =
		(content.getBoundingClientRect().top - origin) / scale +
		(parseFloat(style.borderTopWidth) || 0) +
		(parseFloat(style.paddingTop) || 0)
	const [first] = lines
	const leading = first.top - top
	const tops = lines.map((line, k) => {
		if (!k) return top
		const above = lines[k - 1].bottom
		const start = line.top - leading
		const between = start > Math.min(above, line.top) - HAIR && start < Math.max(above, line.top) + HAIR
		const alike = Math.abs(line.bottom - line.top - (first.bottom - first.top)) < HAIR
		return alike && between ? start : (above + line.top) / 2
	})
	return lines.map((line, k) => ({top: tops[k], bottom: tops[k + 1] ?? line.bottom}))
}

// ---------------------------------------------------------------------------------------------------------------
// Splitting

// What sits on a paragraph's lines, in order: text, and the objects that take a place on a line like a character
type Atom = Text | HTMLElement
type Position = {node: Node; offset: number}

function atoms(block: HTMLElement, registry: Registry): Atom[] {
	const out: Atom[] = []
	const walk = (node: Node) => {
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.nodeType === Node.TEXT_NODE) {
				if ((child as Text).length) out.push(child as Text)
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const element = child as HTMLElement
				const inline = registry.islands.get(element)
				if (inline?.kind === 'anchor') continue
				// The paragraph mark counts too: an empty last line holds nothing else
				if (registry.marks.has(element) || (locked(element) && inline?.kind !== 'text')) out.push(element)
				else walk(element)
			}
		}
	}
	walk(block)
	return out
}

// The position before the first character or object of line `k`: bisecting the atoms for the first that reaches
// past the line's top, then that text's characters
function lineStart(
	list: Atom[],
	lines: Box[],
	k: number,
	block: HTMLElement,
	scale: number,
	range: Range,
): Position | undefined {
	const origin = block.getBoundingClientRect().top
	const limit = boundary(lines, k, Infinity)
	const below = (rect: DOMRect | undefined) =>
		rect !== undefined && ((rect.top + rect.bottom) / 2 - origin) / scale > limit
	const character = (text: Text, offset: number) => {
		range.setStart(text, offset)
		range.setEnd(text, offset + 1)
		return below(range.getClientRects()[0])
	}
	const reaches = (atom: Atom) =>
		atom.nodeType === Node.TEXT_NODE
			? character(atom as Text, (atom as Text).length - 1)
			: below((atom as HTMLElement).getBoundingClientRect())
	const search = (count: number, test: (index: number) => boolean) => {
		let low = 0
		let high = count
		while (low < high) {
			const middle = (low + high) >> 1
			if (test(middle)) high = middle
			else low = middle + 1
		}
		return low
	}
	const atom = list[search(list.length, (index) => reaches(list[index]))]
	if (!atom) return undefined
	if (atom.nodeType === Node.TEXT_NODE) {
		const text = atom as Text
		return {node: text, offset: search(text.length - 1, (offset) => character(text, offset))}
	}
	const parent = atom.parentNode!
	return {node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, atom)}
}

// Splits a block in two at a position inside it, cloning each element on the way up; the original keeps what comes
// before. Clones of slot spans, paragraph blocks and boxes are registered like their originals.
function splitBlock(block: HTMLElement, position: Position, registry: Registry): HTMLElement {
	let tail: Node | null
	let container: Node
	if (position.node.nodeType === Node.TEXT_NODE) {
		const text = position.node as Text
		tail = position.offset > 0 ? text.splitText(position.offset) : text
		container = tail.parentNode!
	} else {
		container = position.node
		tail = container.childNodes[position.offset] ?? null
	}
	for (;;) {
		const clone = container.cloneNode(false) as HTMLElement
		for (let node: Node | null = tail; node; ) {
			const next: Node | null = node.nextSibling
			clone.appendChild(node)
			node = next
		}
		const original = container as HTMLElement
		const slot = registry.refs.get(original)
		if (slot) registry.register(clone, slot, original)
		const paragraph = registry.paragraphs.get(original)
		if (paragraph) registry.fragment(paragraph, clone, original)
		if (registry.boxes.has(original)) registry.boxes.add(clone)
		if (container === block) return clone
		original.after(clone)
		tail = clone
		container = clone.parentNode!
	}
}
