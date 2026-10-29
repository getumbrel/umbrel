// Laying the rendered blocks out on pages. Blocks are rendered into an off-screen galley one column wide and
// measured; the planner decides the pages by arithmetic; only then are blocks split and moved into their pages.
// Reads and writes never interleave, so a long document costs a handful of layouts, not one per paragraph. After an
// edit only the blocks it changed are measured again, the pages are planned again from what's known of the rest, and
// only the pages that changed are rebuilt.

import {lookup} from '@/features/files/components/file-viewer/shared/lookup'

import type {DocumentModel, Section, Story} from './model'
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
} from './plan'
import {
	applyCss,
	lock,
	locked,
	pageNumber,
	pagePosition,
	renderBlocks,
	type PageGeometry,
	type Registry,
	type RenderContext,
	type TabEntry,
} from './render'

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

type Rendered = {element: HTMLElement; layer: HTMLElement; height: number}

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
	return {width: section.pageWidth, height: section.pageHeight, margins, contentWidth, columns}
}

export type LayoutContext = Omit<RenderContext, 'page' | 'width' | 'editable' | 'body' | 'layer'>

export class DocumentLayout {
	views: PageView[] = []
	// Faces still loading when the text was measured (settle waits for them 3 s at most), which the document is laid
	// out again from scratch for once they're in
	late: Promise<unknown> | undefined
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
	// The element of each piece on the pages, both ways round (keyed section:item:from)
	private placed = new WeakMap<HTMLElement, Piece>()
	private elements = new Map<string, HTMLElement>()

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
			const contextFor = (
				page: PageGeometry,
				width: number,
				editable: boolean,
				body: boolean,
				layer?: HTMLElement,
			): RenderContext => ({...this.context, page, width, editable, body, layer})
			// Headers and footers render once per story and width, and are cloned onto each page
			model.sections.forEach((section, i) => {
				const page = geometries[i]
				for (const story of [...Object.values(section.headers), ...Object.values(section.footers)]) {
					const key = storyKey(story, page.contentWidth)
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
					element.append(...renderBlocks(story.blocks, contextFor(page, page.contentWidth, false, false, layer)))
					this.stories.set(key, {element, layer, height: 0})
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
				element.append(
					...renderBlocks(section.blocks, contextFor(geometries[i], geometries[i].columns[0].width, true, true)),
				)
				if (i === model.sections.length - 1 && model.endnotes.length) {
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
			const scale = scaleOf(galleys[0], geometries[0].columns[0].width)
			layoutTabs(this.context.registry.tabs, scale, model.settings.defaultTabStop)
			for (const rendered of this.stories.values())
				rendered.height = rendered.element.getBoundingClientRect().height / scale
			for (const [id, element] of this.notes) this.noteHeights.set(id, element.getBoundingClientRect().height / scale)
			this.separatorHeight = this.separator.getBoundingClientRect().height / scale
			this.items = this.blocks.map((blocks) => blocks.map((block) => flowItem(block, scale, this.context.registry)))
			this.measurers = this.blocks.map(
				(blocks) => new GalleyMeasurer(blocks, this.context.registry, this.noteHeights, this.separatorHeight),
			)
			return this.paginate(zoom, scale, galleys, new Set())
		} finally {
			measure.remove()
		}
	}

	// Lays the pages out again after an edit, given the elements of what it edited: those blocks are measured again in a
	// galley, the pages planned again with what's known of the rest, and only the pages that changed are rebuilt. Where
	// text wraps around objects a block depends on those before it, so everything is measured again.
	reflow(edited: HTMLElement[], zoom: number): PageView[] {
		const {registry} = this.context
		const measure = this.measureBox()
		try {
			const galleys = this.geometries.map((geometry) => galley(measure, geometry.columns[0].width))
			const scale = scaleOf(galleys[0], this.geometries[0].columns[0].width)
			const items = registry.floating
				? this.blocks.flatMap((blocks, section) => blocks.map((_, item) => ({section, item})))
				: edited.flatMap((element) => {
						let node: HTMLElement | null = element
						while (node && !this.placed.has(node)) node = node.parentElement
						return node ? [this.placed.get(node)!] : []
					})
			const whole = new Set<string>()
			for (const {section, item} of items) this.pull(galleys, whole, section, item)
			// Only their tabs can have moved
			this.layTabs(measure, scale)
			for (const {section, item} of items) {
				this.items[section][item] = flowItem(this.blocks[section][item], scale, registry)
				this.measurers[section].forget(item, scale)
			}
			return this.paginate(zoom, scale, galleys, whole)
		} finally {
			measure.remove()
		}
	}

	// Lays everything out again once the faces that were still loading at the first layout are in: line heights,
	// headers, footers, notes and every block measured again, and every page rebuilt
	relayout(zoom: number): PageView[] {
		const {registry} = this.context
		const measure = this.measureBox()
		try {
			lineHeights(this.doc, this.root, this.context.stacks, measure)
			const galleys = this.geometries.map((geometry) => galley(measure, geometry.columns[0].width))
			// The notes come off their pages to be measured; every page is rebuilt with them
			measure.append(...[...this.stories.values()].map(({element}) => element), ...this.notes.values(), this.separator)
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
			return this.paginate(zoom, scale, galleys, whole)
		} finally {
			measure.remove()
		}
	}

	// Whether edited paragraphs changed the height of what holds them on their pages (the paragraph itself, or the
	// table it's in), so the pages need laying out again. So does an edit to what shows on more than one page, whatever
	// its height: a paragraph cut across pages, whose text moves between its parts, or the header rows of a table cut
	// across pages, which its later parts repeat.
	moved(elements: HTMLElement[]): boolean {
		const {registry} = this.context
		const repeated = [...this.parts].flatMap(([block, parts]) =>
			registry.paragraphs.has(block) ? [block, ...parts] : headerRows(block as HTMLTableElement, registry),
		)
		return elements.some((element) => {
			let piece: HTMLElement | null = element
			while (piece && !this.placed.has(piece)) piece = piece.parentElement
			return (
				piece?.isConnected &&
				(repeated.some((node) => node.contains(element)) ||
					Math.abs(piece.offsetHeight - this.placed.get(piece)!.height) > 2)
			)
		})
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
	private paginate(zoom: number, scale: number, galleys: HTMLElement[], whole: Set<string>): PageView[] {
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
				from[kind] && this.stories.get(storyKey(from[kind]!, geometries[sectionIndex].contentWidth))
			const header = story(section.headers)
			const footer = story(section.footers)
			// A header taller than the top margin pushes the text down; a negative margin is exact and never moves
			const top =
				page.margins.top < 0
					? -page.margins.top
					: Math.max(page.margins.top, page.margins.header + (header?.height ?? 0))
			const bottom =
				page.margins.bottom < 0
					? -page.margins.bottom
					: Math.max(page.margins.bottom, page.margins.footer + (footer?.height ?? 0))
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
		const {from, to, cut} = changes(this.planned, planned, whole)
		// The last reads: where each split falls. From here on, only writes.
		const elements = this.split(planned.slice(from, to), cut, galleys, whole, scale)
		const sectionPages = new Map<number, number>()
		for (const page of planned) sectionPages.set(page.section, (sectionPages.get(page.section) ?? 0) + 1)
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
				if (header) view.sheet.append(placed(header.element, page, {top: page.margins.header}), layer(header.layer))
				if (footer) view.sheet.append(placed(footer.element, page, {bottom: page.margins.footer}), layer(footer.layer))
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
			const page = planned[index]
			for (const field of view.sheet.querySelectorAll<HTMLElement>('[data-field]')) {
				const kind = field.dataset.field
				const value =
					kind === 'page' ? page.number : kind === 'numpages' ? planned.length : (sectionPages.get(page.section) ?? 1)
				field.textContent = pageNumber(
					value,
					field.dataset.format || (kind === 'page' ? sections[page.section].pageNumbers.format : 'decimal'),
				)
			}
		})
		for (const key of this.elements.keys()) if (cut.has(key.slice(0, key.lastIndexOf(':')))) this.elements.delete(key)
		for (const [piece, element] of elements) this.elements.set(`${piece.section}:${piece.item}:${piece.from}`, element)
		this.planned = planned
		return this.views
	}

	// Lays out again the tabs of what's in the measuring box
	private layTabs(measure: HTMLElement, scale: number) {
		const tabs = this.context.registry.tabs.filter((tab) => measure.contains(tab.element))
		for (const tab of tabs) {
			tab.element.style.width = '0'
			tab.element.style.borderBottom = ''
		}
		layoutTabs(tabs, scale, this.model.settings.defaultTabStop)
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
		...properties: Array<'paddingTop' | 'paddingBottom' | 'textIndent' | 'textAlignLast'>
	) {
		const saved = this.styles.get(element) ?? {}
		for (const property of properties) if (!(property in saved)) saved[property] = element.style[property]
		this.styles.set(element, saved)
	}

	// Cuts the items `cut` names into the parts these pages hold, finding where each paragraph's parts begin while it's
	// whole in the galley, then cutting it from the last point back (so the earlier points stay valid). Other items
	// keep the parts they have. Returns the element of every piece.
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
			if (!cut.has(key)) for (const piece of pieces) out.set(piece, this.elements.get(`${key}:${piece.from}`)!)
			else if (pieces.length > 1 && registry.paragraphs.has(block)) {
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
				const positions = pieces.slice(0, -1).map((piece) => lineStart(list, lines, piece.to!, block, scale))
				jobs.push(() => {
					const content = contentOf(block, registry)
					this.keep(block, 'paddingTop', 'paddingBottom')
					this.keep(content, 'textAlignLast')
					const parts = [block]
					for (let i = positions.length - 1; i >= 0; i--) {
						parts.splice(
							1,
							0,
							positions[i] ? splitBlock(block, positions[i]!, registry) : (block.cloneNode(false) as HTMLElement),
						)
					}
					parts.forEach((part, i) => {
						const inner = contentOf(part, registry)
						// The part continuing from the previous page has no space before or first-line indent; the part that
						// goes on has no space after, and its last line stays justified
						if (i > 0) {
							part.style.paddingTop = '0'
							inner.style.textIndent = '0'
						}
						if (i < parts.length - 1) {
							part.style.paddingBottom = '0'
							if (inner.style.textAlign === 'justify') inner.style.textAlignLast = 'justify'
						}
					})
					this.parts.set(block, parts.slice(1))
					pieces.forEach((piece, i) => out.set(piece, parts[i]))
				})
			} else if (pieces.length > 1) {
				jobs.push(() => {
					const parts = this.splitTable(
						block as HTMLTableElement,
						pieces.map((piece) => piece.from),
					)
					this.parts.set(block, parts.slice(1))
					pieces.forEach((piece, i) => out.set(piece, parts[i]))
				})
			} else out.set(pieces[0], block)
			jobs.push(() => {
				for (const piece of pieces) {
					if (!piece.drop) continue
					const element = out.get(piece)!
					if (element === block) this.keep(block, 'paddingTop')
					element.style.paddingTop = '0'
				}
			})
		}
		for (const job of jobs) job()
		return out
	}

	// Splits a table into parts starting at the given rows. Later parts repeat the header rows, and a cell merged
	// across a split continues as an empty cell at the top of the next part.
	private splitTable(table: HTMLTableElement, starts: number[]): HTMLTableElement[] {
		const {registry} = this.context
		const rows = Array.from(table.rows)
		const headers = headerRows(table, registry)
		for (const start of starts.slice(1)) {
			const next = rows[start]
			if (!next) continue
			for (let r = 0; r < start; r++) {
				for (const cell of Array.from(rows[r].cells)) {
					if (r + cell.rowSpan <= start) continue
					if (!this.rowSpans.has(cell)) this.rowSpans.set(cell, cell.rowSpan)
					const continued = cell.cloneNode(false) as HTMLTableCellElement
					continued.rowSpan = r + cell.rowSpan - start
					cell.rowSpan = start - r
					const column = registry.columns.get(cell) ?? 0
					registry.columns.set(continued, column)
					const before = Array.from(next.cells).find((other) => (registry.columns.get(other) ?? 0) > column)
					next.insertBefore(continued, before ?? null)
					this.added.add(continued)
				}
			}
		}
		const parts: HTMLTableElement[] = [table]
		for (let i = starts.length - 1; i >= 1; i--) {
			const part = table.cloneNode(false) as HTMLTableElement
			const columns = table.querySelector(':scope > colgroup')
			if (columns) part.append(columns.cloneNode(true))
			const body = this.doc.createElement('tbody')
			for (const header of headers) {
				// A copy to read: the row that's edited is the original, on the first page
				const copy = header.cloneNode(true) as HTMLTableRowElement
				lock(copy)
				this.copies.add(copy)
				body.append(copy)
			}
			body.append(...rows.slice(starts[i], starts[i + 1]))
			part.append(body)
			parts.splice(1, 0, part)
		}
		return parts
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
			}
		}
		this.parts.delete(block)
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

const storyKey = (story: Story, width: number) => `${story.part}@${width}`

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
	applyCss(slot, {position: 'relative', flex: 'none', overflow: 'hidden', backgroundColor: background ?? '#ffffff'})
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
		for (const stack of stacks.keys()) loads.push(fonts.load(`200px ${stack}`, 'x'))
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

// Each font stack's natural line height, as a share of its size, into the CSS variables, from probes put in
// `holder`. Heights are read in layout px (whole pixels, as browsers round a normal line anyway): a viewer's entrance
// may still be scaling the pages, and a height on screen would make the same file paginate differently from one open
// to the next.
function lineHeights(doc: Document, root: HTMLElement, stacks: LayoutContext['stacks'], holder: HTMLElement) {
	const box = doc.createElement('div')
	applyCss(box, RESET)
	applyCss(box, {position: 'absolute', left: '0', top: '0', visibility: 'hidden'})
	const probes = [...stacks].map(([stack, index]) => {
		const probe = doc.createElement('div')
		applyCss(probe, {
			fontFamily: stack,
			fontSize: '200px',
			lineHeight: 'normal',
			whiteSpace: 'nowrap',
			position: 'absolute',
			top: '0',
			left: '0',
		})
		probe.textContent = 'x'
		box.append(probe)
		return [probe, index] as const
	})
	holder.append(box)
	const ratios = probes.map(([probe, index]) => [probe.offsetHeight / 200, index] as const)
	box.remove()
	for (const [ratio, index] of ratios)
		if (ratio > 0) root.style.setProperty(`--docx-line-${index}`, String(Math.round(ratio * 10000) / 10000))
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

// Sizes each tab so what follows starts at the next stop. A paragraph's tabs depend on the ones before them, so
// paragraphs go in rounds (every paragraph's first tab, then every second…), each one pass of reads, one of writes.
function layoutTabs(entries: TabEntry[], scale: number, defaultStop: number) {
	const byBlock = new Map<HTMLElement, TabEntry[]>()
	for (const entry of entries) {
		const list = byBlock.get(entry.block) ?? []
		list.push(entry)
		byBlock.set(entry.block, list)
	}
	const lists = [...byBlock.values()]
	const rounds = Math.min(64, Math.max(0, ...lists.map((list) => list.length)))
	const range = entries[0]?.element.ownerDocument.createRange()
	for (let round = 0; round < rounds && range; round++) {
		const updates: Array<[TabEntry, number, string]> = []
		for (const list of lists) {
			const entry = list[round]
			if (!entry) continue
			const box = entry.block.getBoundingClientRect()
			const rect = entry.element.getBoundingClientRect()
			// Stops count from the column edge, which is the paragraph's indent left of its box
			const x = (rect.left - box.left) / scale + entry.indent
			const following = followingWidth(range, entry, list[round + 1]?.element, rect, scale)
			updates.push([
				entry,
				...tabWidth(
					{...entry, leader: entry.element.dataset.leader},
					x,
					following,
					box.width / scale + entry.indent,
					defaultStop,
				),
			])
		}
		for (const [entry, width, leader] of updates) {
			entry.element.style.width = px(width)
			if (leader) entry.element.style.borderBottom = `${leader === 'heavy' ? 2 : 1}px ${LEADERS[leader]} currentColor`
		}
	}
	for (const list of lists) for (const entry of list.slice(rounds)) entry.element.style.width = px(defaultStop)
}

function tabWidth(
	entry: Pick<TabEntry, 'stops' | 'indent' | 'hanging' | 'ptab'> & {leader?: string},
	x: number,
	following: {width: number; decimal: number},
	columnWidth: number,
	defaultStop: number,
): [number, string] {
	let stop: {pos: number; align: string; leader: string}
	if (entry.ptab) {
		const pos = entry.ptab.align === 'right' ? columnWidth : entry.ptab.align === 'center' ? columnWidth / 2 : x
		stop = {pos, align: entry.ptab.align, leader: entry.leader ?? 'none'}
	} else {
		// A hanging indent is a stop of its own; custom stops clear the default stops before them
		const stops = entry.stops.filter((tab) => tab.align !== 'bar' && tab.align !== 'clear')
		const hanging =
			entry.hanging > 0 && !stops.some((tab) => Math.abs(tab.pos - entry.indent) < 0.5)
				? [{pos: entry.indent, align: 'left', leader: 'none'}]
				: []
		const custom = [...stops, ...hanging].sort((a, b) => a.pos - b.pos)
		stop = custom.find((tab) => tab.pos > x + 0.5) ?? {
			pos: (Math.floor(x / defaultStop + 1e-6) + 1) * defaultStop,
			align: 'left',
			leader: 'none',
		}
	}
	const gap = stop.pos - x
	const width =
		stop.align === 'right'
			? gap - following.width
			: stop.align === 'center'
				? gap - following.width / 2
				: stop.align === 'decimal'
					? gap - following.decimal
					: gap
	return [Math.max(0, width), stop.leader === 'none' ? '' : stop.leader]
}

// The width of what follows a tab on its line up to the next tab, and up to its first decimal point
function followingWidth(range: Range, entry: TabEntry, next: HTMLElement | undefined, rect: DOMRect, scale: number) {
	range.setStartAfter(entry.element)
	if (next && entry.block.contains(next)) range.setEndBefore(next)
	else range.setEnd(entry.block, entry.block.childNodes.length)
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
	return {
		kind: 'paragraph',
		height,
		before: parseFloat(block.style.paddingTop) || 0,
		after: parseFloat(block.style.paddingBottom) || 0,
		breakBefore: registry.breaks.get(block),
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

	// A block measured again, whole in the galley: what was known of it goes, and its notes are found where they now are
	forget(index: number, scale: number) {
		const block = this.blocks[index]
		this.lineCache.delete(index)
		this.rowCache.delete(index)
		this.noteCache?.set(
			block,
			this.registry.notes
				.filter(({element}) => block.contains(element))
				.map(({element, id}) => noteAt(block, element, id, scale)),
		)
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
			const origin = block.getBoundingClientRect().top
			rows =
				block instanceof HTMLTableElement
					? Array.from(block.rows, (row) => {
							const rect = row.getBoundingClientRect()
							return {
								top: (rect.top - origin) / this.scale,
								bottom: (rect.bottom - origin) / this.scale,
								header: this.registry.rows.get(row)?.header ?? false,
							}
						})
					: []
			this.rowCache.set(index, rows)
		}
		return rows
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

// Where a note's reference sits in its block, from the block's top
const noteAt = (block: HTMLElement, element: HTMLElement, id: string, scale: number) => ({
	y: (element.getBoundingClientRect().top - block.getBoundingClientRect().top) / scale,
	id,
})

// Line boxes, clustered from the boxes of a paragraph's text and of the objects that sit on its lines
function lineBoxes(block: HTMLElement, scale: number, registry: Registry): Box[] {
	const origin = block.getBoundingClientRect().top
	const range = block.ownerDocument.createRange()
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
	return lines
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
function lineStart(list: Atom[], lines: Box[], k: number, block: HTMLElement, scale: number): Position | undefined {
	const range = block.ownerDocument.createRange()
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
