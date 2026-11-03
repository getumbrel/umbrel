// The document model: document.xml and the parts around it read into sections of blocks (paragraphs and tables)
// whose formatting is fully resolved. It holds no DOM, so it's built and tested anywhere; the renderer only maps it to
// elements. Every w:t that can be edited keeps its element, whose source offsets let a save splice the new text in.

import {colorOf, presetColor, toCss, type ColorContext} from '@/features/files/components/file-viewer/shared/color'
import {safeHref} from '@/features/files/components/file-viewer/shared/links'
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'
import type {Relationship} from '@/features/files/components/file-viewer/shared/opc'
import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'

import {symbolChar} from './fonts'
import {formatNumber, Numbering} from './numbering'
import {DocxError, DocxPackage, type XmlPart} from './package'
import {
	clamp,
	EMU,
	hex,
	int,
	isOn,
	length,
	mergeCell,
	mergePara,
	mergeRun,
	mergeTable,
	NO_BORDER,
	onOff,
	parseCellProps,
	parseParaProps,
	parseRowProps,
	parseRunProps,
	parseTableProps,
	POINT,
	TWIP,
	value,
	type Border,
	type CellProps,
	type ParaProps,
	type RowProps,
	type RunProps,
	type TabLeader,
	type TableProps,
	type Theme,
} from './props'
import {CONDITIONAL_ORDER, fontName, parseSettings, parseTheme, Styles, type Settings} from './styles'

// ---------------------------------------------------------------------------------------------------------------
// Model

export type TextRef = {
	id: number
	part: string
	element: XmlElement
	// As shown: entities decoded, and trimmed when the element doesn't preserve its whitespace
	text: string
}

// Where typed text goes in the XML: a w:t (ids from 0), or a place that had none (negative ids), which is an empty
// paragraph's mark, or beside an object in a run when text is typed there
export type Slot = TextRef | Insertion
export type Insertion = {
	id: number
	paragraph: Paragraph
	at?: {run: XmlElement; node: XmlElement; side: 'before' | 'after'}
}

export type Link = {href?: string; tooltip?: string}

// What the pages show only roughly or not at all: charts and SmartArt (empty frames), comments (nothing), equations
// (their plain text), embedded objects and pictures that can't be drawn (formats browsers don't decode, pictures
// linked from the web)
export type Approximated = 'charts' | 'comments' | 'diagrams' | 'equations' | 'objects' | 'pictures'

export type ImageContent = {
	kind: 'image'
	part: string
	width: number
	height: number
	// Fractions of the source cut from each side
	crop?: {left: number; top: number; right: number; bottom: number}
	rotation?: number
	flipH?: boolean
	flipV?: boolean
	alt?: string
	// The picture an embedded object shows of itself
	object?: boolean
}

export type ShapeContent = {
	kind: 'shape'
	width: number
	height: number
	geometry: 'rect' | 'roundRect' | 'ellipse' | 'line'
	fill?: string
	opacity?: number
	line?: {width: number; color: string; dashed: boolean}
	blocks?: Block[]
	insets?: {top: number; right: number; bottom: number; left: number}
	anchor?: 'top' | 'center' | 'bottom'
	rotation?: number
}

export type GroupContent = {
	kind: 'group'
	width: number
	height: number
	items: Array<{x: number; y: number; content: ImageContent | ShapeContent | PlaceholderContent}>
}

// What can't be drawn (charts, SmartArt, ink, linked pictures, objects with no picture) still holds its place in
// the layout, and says what it stands for
export type PlaceholderContent = {
	kind: 'placeholder'
	of: Exclude<Approximated, 'comments' | 'equations'>
	width: number
	height: number
}

export type WatermarkContent = {
	kind: 'watermark'
	text: string
	width: number
	height: number
	color: string
	opacity: number
	rotation: number
	font?: string
}

export type Graphic = ImageContent | ShapeContent | GroupContent | PlaceholderContent | WatermarkContent

export type Anchored = {
	content: Graphic
	x: {from: string; offset?: number; align?: string}
	y: {from: string; offset?: number; align?: string}
	wrap: 'none' | 'square' | 'tight' | 'through' | 'topAndBottom'
	behind: boolean
	distance: {top: number; right: number; bottom: number; left: number}
}

export type FieldKind = 'page' | 'numpages' | 'sectionpages'

// Inlines from a run keep the run and their own element in it (`node`), so typed text can go in beside them
export type Inline =
	| {
			kind: 'text'
			text: string
			style: RunProps
			ref?: TextRef
			link?: Link
			run?: XmlElement
			node?: XmlElement
			font?: string
			// An equation, as its plain text
			math?: boolean
	  }
	// A tab, from w:tab or (with `ref`) a tab character inside a w:t's text
	| {
			kind: 'tab'
			style: RunProps
			run?: XmlElement
			node?: XmlElement
			ref?: TextRef
			ptab?: {align: 'left' | 'center' | 'right'; leader: TabLeader}
	  }
	| {
			kind: 'break'
			type: 'line' | 'page' | 'column'
			clear?: 'left' | 'right' | 'both'
			style: RunProps
			run?: XmlElement
			node?: XmlElement
	  }
	| {kind: 'graphic'; content: Graphic; style: RunProps; link?: Link; run?: XmlElement; node?: XmlElement}
	| {kind: 'anchor'; object: Anchored; run?: XmlElement}
	| {kind: 'field'; field: FieldKind; format: string; style: RunProps; run?: XmlElement}
	// A footnote or endnote reference (`footnote` names the footnote, placed on the reference's page), or a note's own number
	| {kind: 'note'; label: string; footnote?: string; style: RunProps; run?: XmlElement; node?: XmlElement}
	| {kind: 'rule'; height: number; color: string; align: 'left' | 'center' | 'right'; width: number; run?: XmlElement}
	| {kind: 'separator'; continuation: boolean}

export type Numbered = {
	label: string
	style: RunProps
	suffix: 'tab' | 'space' | 'nothing'
	align: 'left' | 'center' | 'right'
}

export type Paragraph = {
	kind: 'paragraph'
	props: ParaProps
	styleId?: string
	mark: RunProps
	inlines: Inline[]
	numbering?: Numbered
	part: string
	element: XmlElement
	editable: boolean
	// Its mark is hidden or deleted and nothing in it shows: Word lays it out as nothing
	hidden: boolean
}

export type Cell = {
	blocks: Block[]
	props: CellProps
	column: number
	span: number
	rowSpan: number
	borders: {top: Border; right: Border; bottom: Border; left: Border}
	margins: {top: number; right: number; bottom: number; left: number}
}

export type Row = {props: RowProps; cells: Cell[]; header: boolean}

export type Table = {
	kind: 'table'
	props: TableProps
	grid: number[]
	rows: Row[]
	// Before Word 2013 a table hangs left by its cell margin, so cell text lines up with the text around it
	outdent: number
}

export type Block = Paragraph | Table

export type Story = {blocks: Block[]; part: string}

export type Section = {
	pageWidth: number
	pageHeight: number
	margins: {top: number; right: number; bottom: number; left: number; header: number; footer: number; gutter: number}
	columns: {count: number; space: number; separator: boolean; widths?: number[]}
	start: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn'
	titlePage: boolean
	headers: {default?: Story; first?: Story; even?: Story}
	footers: {default?: Story; first?: Story; even?: Story}
	pageNumbers: {start?: number; format: string}
	verticalAlign: 'top' | 'center' | 'bottom'
	blocks: Block[]
}

export type DocumentModel = {
	main: string
	sections: Section[]
	footnotes: Map<string, Block[]>
	endnotes: Block[]
	separator?: Block[]
	settings: Settings
	theme: Theme | undefined
	background?: string
	refs: TextRef[]
	parts: Map<string, XmlPart>
	images: Set<string>
	// Whether anything carries a comment, which the pages leave out
	comments: boolean
}

// ---------------------------------------------------------------------------------------------------------------
// Building

// Namespaces whose content we render: mc:AlternateContent picks the first choice that requires only these
const UNDERSTOOD = new Set([
	'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
	'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
	'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
	'http://schemas.microsoft.com/office/word/2010/wordml',
	'http://schemas.microsoft.com/office/word/2012/wordml',
	'http://schemas.microsoft.com/office/drawing/2010/main',
	'http://schemas.openxmlformats.org/drawingml/2006/main',
	'http://schemas.openxmlformats.org/drawingml/2006/picture',
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
	'http://schemas.openxmlformats.org/officeDocument/2006/math',
])

type Field = {instruction: string; separated: boolean; hide: boolean; kind?: FieldKind; format: string; link?: Link}

type StoryContext = {
	part: string
	rels: Map<string, Relationship>
	namespaces: Map<string, string>
	editable: boolean
	counters: (numId: number, ilvl: number) => string | undefined
	// Complex fields can span runs and paragraphs, so their state lives with the story
	fields: Field[]
	noteLabel?: string
}

type CellFormatting = {pPr: ParaProps; rPr: RunProps}

type Context = {
	pkg: DocxPackage
	styles: Styles
	numbering: Numbering
	theme: Theme | undefined
	settings: Settings
	refs: TextRef[]
	images: Set<string>
	runs: Map<string, RunProps>
	footnoteLabels: Map<string, string>
	endnoteOrder: string[]
	comments: boolean
	// Nesting guard: tables in cells in text boxes…
	depth: number
}

const MAX_NESTING = 24

// The relationships namespace is conventionally r:, but a document may bind it to any prefix
const relId = (element: XmlElement, name = 'id') => attr(element, `r:${name}`) ?? attr(element, name) ?? ''

export async function buildModel(pkg: DocxPackage): Promise<DocumentModel> {
	const main = await pkg.mainPart()
	const rels = await pkg.rels(main)
	const byType = (type: string) => [...rels.values()].find((rel) => rel.type === type && !rel.external)?.target
	const load = async (name: string | undefined) => (name ? pkg.xml(name) : undefined)
	const [documentPart, stylesPart, numberingPart, settingsPart, themePart, footnotesPart, endnotesPart] =
		await Promise.all([
			load(main),
			load(byType('styles')),
			load(byType('numbering')),
			load(byType('settings')),
			load(byType('theme')),
			load(byType('footnotes')),
			load(byType('endnotes')),
		])
	const body = documentPart && child(documentPart.root, 'body')
	if (!documentPart || documentPart.root.local !== 'document' || !body) {
		throw new DocxError('corrupt', 'The main part is not a Word document')
	}
	const settings = parseSettings(settingsPart?.root)
	const theme = parseTheme(themePart?.root, settings)
	const styles = new Styles(stylesPart?.root, theme)
	const ctx: Context = {
		pkg,
		styles,
		numbering: new Numbering(numberingPart?.root, theme, styles),
		theme,
		settings,
		refs: [],
		images: new Set(),
		runs: new Map(),
		footnoteLabels: new Map(),
		endnoteOrder: [],
		comments: false,
		depth: 0,
	}
	const parts = new Map<string, XmlPart>([[main, documentPart]])

	// A section ends with the paragraph carrying its w:sectPr; the body's own w:sectPr describes the last one
	const sections: Section[] = []
	const sectionEnds: Array<XmlElement | undefined> = []
	let blocks: Block[] = []
	walkBlocks(body, storyOf(main, rels, documentPart.root, true, ctx), ctx, blocks, undefined, (paragraph) => {
		const pPr = child(paragraph, 'pPr')
		const sectPr = pPr && child(pPr, 'sectPr')
		if (!sectPr) return undefined
		sections.push(sectionProps(sectPr, blocks))
		sectionEnds.push(sectPr)
		return (blocks = [])
	})
	sections.push(sectionProps(child(body, 'sectPr'), blocks))
	sectionEnds.push(child(body, 'sectPr'))
	await attachStories(sections, sectionEnds, rels, ctx, parts)

	const footnotes = new Map<string, Block[]>()
	let separator: Block[] | undefined
	if (footnotesPart && ctx.footnoteLabels.size) {
		parts.set(footnotesPart.name, footnotesPart)
		const noteRels = await pkg.rels(footnotesPart.name)
		for (const note of children(footnotesPart.root, 'footnote')) {
			const id = attr(note, 'id')
			if (attr(note, 'type') === 'separator') separator = noteBlocks(note, footnotesPart, noteRels, ctx)
			const label = id === undefined ? undefined : ctx.footnoteLabels.get(id)
			if (label !== undefined && !footnotes.has(id!))
				footnotes.set(id!, noteBlocks(note, footnotesPart, noteRels, ctx, label))
		}
	}
	const endnotes: Block[] = []
	if (endnotesPart && ctx.endnoteOrder.length) {
		parts.set(endnotesPart.name, endnotesPart)
		const noteRels = await pkg.rels(endnotesPart.name)
		const byId = new Map(children(endnotesPart.root, 'endnote').map((note) => [attr(note, 'id'), note]))
		ctx.endnoteOrder.forEach((id, index) => {
			const note = byId.get(id)
			const label = formatNumber(settings.endnotes.start + index, settings.endnotes.format)
			if (note) endnotes.push(...noteBlocks(note, endnotesPart, noteRels, ctx, label))
		})
	}

	const backgroundElement = child(documentPart.root, 'background')
	const background = settings.displayBackgroundShape
		? hex(backgroundElement && attr(backgroundElement, 'color'))
		: undefined
	return {
		main,
		sections,
		footnotes,
		endnotes,
		separator,
		settings,
		theme,
		background,
		refs: ctx.refs,
		parts,
		images: ctx.images,
		comments: ctx.comments,
	}
}

function storyOf(
	part: string,
	rels: Map<string, Relationship>,
	root: XmlElement,
	editable: boolean,
	ctx: Context,
): StoryContext {
	// mc:AlternateContent names namespaces by prefix, as declared on the part's root
	const namespaces = new Map<string, string>()
	for (const [key, uri] of Object.entries(root.attributes))
		if (key.startsWith('xmlns:')) namespaces.set(key.slice(6), uri)
	return {part, rels, namespaces, editable, counters: ctx.numbering.counters(), fields: []}
}

function noteBlocks(
	note: XmlElement,
	part: XmlPart,
	rels: Map<string, Relationship>,
	ctx: Context,
	label?: string,
): Block[] {
	const story = storyOf(part.name, rels, part.root, false, ctx)
	story.noteLabel = label ?? ''
	const blocks: Block[] = []
	walkBlocks(note, story, ctx, blocks, undefined)
	return blocks
}

// Headers and footers: each section names its own, and inherits from the one before for any type it doesn't name
async function attachStories(
	sections: Section[],
	ends: Array<XmlElement | undefined>,
	rels: Map<string, Relationship>,
	ctx: Context,
	parts: Map<string, XmlPart>,
) {
	const cache = new Map<string, Promise<Story | undefined>>()
	const load = (target: string) => {
		let story = cache.get(target)
		if (!story) {
			story = (async () => {
				const part = await ctx.pkg.xml(target)
				if (!part) return undefined
				parts.set(target, part)
				const blocks: Block[] = []
				walkBlocks(
					part.root,
					storyOf(target, await ctx.pkg.rels(target), part.root, false, ctx),
					ctx,
					blocks,
					undefined,
				)
				return {blocks, part: target}
			})()
			cache.set(target, story)
		}
		return story
	}
	let inherited: Pick<Section, 'headers' | 'footers'> = {headers: {}, footers: {}}
	for (const [index, section] of sections.entries()) {
		const headers = {...inherited.headers}
		const footers = {...inherited.footers}
		for (const [local, into] of [
			['headerReference', headers],
			['footerReference', footers],
		] as const) {
			for (const reference of ends[index] ? children(ends[index]!, local) : []) {
				const type = attr(reference, 'type') ?? 'default'
				const rel = rels.get(relId(reference))
				if (!rel || rel.external || (type !== 'default' && type !== 'first' && type !== 'even')) continue
				into[type] = await load(rel.target)
			}
		}
		section.headers = headers
		section.footers = footers
		inherited = {headers, footers}
	}
}

function sectionProps(sectPr: XmlElement | undefined, blocks: Block[]): Section {
	// Properties apply in order, so a repeated element's last occurrence wins, as in the other property lists
	const get = (local: string) => (sectPr ? children(sectPr, local).at(-1) : undefined)
	const size = get('pgSz')
	const margin = get('pgMar')
	const cols = get('cols')
	const pageNumbers = get('pgNumType')
	// Letter with one-inch margins, Word's own default
	const page = (name: string, fallback: number) => clamp(length(size, name) ?? fallback, 96, 31680 * TWIP)
	const side = (name: string, fallback: number) => length(margin, name) ?? fallback
	const count = clamp(int(cols && attr(cols, 'num')) ?? 1, 1, 45)
	const defined = cols ? children(cols, 'col') : []
	const equal = !cols || attr(cols, 'equalWidth') !== '0' || defined.length < count
	const type = value(get('type'))
	const vAlign = value(get('vAlign'))
	return {
		pageWidth: page('w', 816),
		pageHeight: page('h', 1056),
		margins: {
			top: side('top', 96),
			right: Math.max(0, side('right', 96)),
			bottom: side('bottom', 96),
			left: Math.max(0, side('left', 96)),
			header: Math.max(0, side('header', 48)),
			footer: Math.max(0, side('footer', 48)),
			gutter: Math.max(0, side('gutter', 0)),
		},
		columns: {
			count,
			space: Math.max(0, length(cols, 'space') ?? 48),
			separator: isOn(cols && attr(cols, 'sep')),
			widths: equal ? undefined : defined.slice(0, count).map((col) => Math.max(0, length(col, 'w') ?? 0)),
		},
		start:
			type === 'continuous' || type === 'evenPage' || type === 'oddPage' || type === 'nextColumn' ? type : 'nextPage',
		titlePage: onOff(get('titlePg')) ?? false,
		headers: {},
		footers: {},
		pageNumbers: {
			start: int(pageNumbers && attr(pageNumbers, 'start')),
			format: (pageNumbers && attr(pageNumbers, 'fmt')) || 'decimal',
		},
		verticalAlign: vAlign === 'center' || vAlign === 'both' ? 'center' : vAlign === 'bottom' ? 'bottom' : 'top',
		blocks,
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Blocks

// The block content of a body, cell, text box, header or note, appended to `out`. In the body, `onParagraph` sees
// each paragraph after it's added and may hand back a new array to continue into (when a section ends there).
function walkBlocks(
	container: XmlElement,
	story: StoryContext,
	ctx: Context,
	out: Block[],
	cell: CellFormatting | undefined,
	onParagraph?: (element: XmlElement) => Block[] | undefined,
): Block[] {
	if (ctx.depth > MAX_NESTING) return out
	for (const node of container.children) {
		if (!('local' in node)) continue
		switch (node.local) {
			case 'p':
				out.push(paragraph(node, story, ctx, cell))
				out = onParagraph?.(node) ?? out
				break
			case 'tbl':
				ctx.depth++
				out.push(table(node, story, ctx))
				ctx.depth--
				break
			case 'sdt': {
				const content = child(node, 'sdtContent')
				if (content) out = walkBlocks(content, story, ctx, out, cell, onParagraph)
				break
			}
			case 'customXml':
			case 'ins':
			case 'moveTo':
			case 'smartTag':
				out = walkBlocks(node, story, ctx, out, cell, onParagraph)
				break
			case 'AlternateContent': {
				const branch = chooseBranch(node, story)
				if (branch) out = walkBlocks(branch, story, ctx, out, cell, onParagraph)
				break
			}
		}
	}
	return out
}

function chooseBranch(element: XmlElement, story: StoryContext): XmlElement | undefined {
	for (const choice of children(element, 'Choice')) {
		const requires = (attr(choice, 'Requires') ?? '').split(/\s+/).filter(Boolean)
		if (requires.every((prefix) => UNDERSTOOD.has(story.namespaces.get(prefix) ?? ''))) return choice
	}
	return child(element, 'Fallback')
}

// Identical formatting resolves to one object, so the renderer can cache its CSS by identity
function intern(ctx: Context, props: RunProps): RunProps {
	const key = JSON.stringify(props)
	const existing = ctx.runs.get(key)
	if (existing) return existing
	ctx.runs.set(key, props)
	return props
}

type ParagraphContext = {story: StoryContext; runBase: RunProps; inlines: Inline[]}

function paragraph(
	element: XmlElement,
	story: StoryContext,
	ctx: Context,
	cell: CellFormatting | undefined,
): Paragraph {
	const {styles, numbering, theme} = ctx
	const pPr = child(element, 'pPr')
	const markElement = pPr && child(pPr, 'rPr')
	const direct = parseParaProps(pPr, theme)
	const styleId = styles.paragraphStyleId(direct.styleId)
	const style = styles.paragraphStyle(styleId)

	// The list comes from the paragraph's own w:numPr or its style's; numId 0 switches an inherited list off
	const numId = direct.numId ?? style.pPr.numId
	const fromStyle = direct.numId === undefined
	const ilvl =
		direct.ilvl ?? style.pPr.ilvl ?? (numId && styleId ? numbering.levelOfStyle(numId, styleId) : undefined) ?? 0
	const level = numId ? numbering.level(numId, ilvl) : undefined

	// A table style's formatting outranks the default paragraph style but not other styles (a Word quirk), and a
	// list's indents outrank its paragraph style only when the paragraph asks for the list itself
	const isDefault = styleId === styles.defaultParagraph
	let props = styles.paraDefaults
	if (cell && !isDefault) props = mergePara(props, cell.pPr)
	if (level && fromStyle) props = mergePara(props, level.pPr)
	props = mergePara(props, style.pPr)
	if (level && !fromStyle) props = mergePara(props, level.pPr)
	if (cell && isDefault) props = mergePara(props, cell.pPr)
	props = mergePara(props, direct)

	let runBase = styles.runDefaults
	if (cell && !isDefault) runBase = mergeRun(runBase, cell.rPr)
	runBase = mergeRun(runBase, style.rPr)
	if (cell && isDefault) runBase = mergeRun(runBase, cell.rPr)
	const mark = intern(ctx, styles.run(runBase, parseRunProps(markElement, theme)))

	const context: ParagraphContext = {story, runBase, inlines: []}
	walkInlines(element, context, ctx, undefined)

	let numbered: Numbered | undefined
	const label = level && numId ? story.counters(numId, ilvl) : undefined
	if (level && label !== undefined) {
		const labelStyle = intern(ctx, mergeRun(mark, level.rPr))
		numbered = {
			label: level.format === 'bullet' ? fromSymbolFont(label, labelStyle, theme) : label,
			style: labelStyle,
			suffix: level.suffix,
			align: level.align,
		}
	}
	const markDeleted = markElement !== undefined && child(markElement, 'del') !== undefined
	const shows = context.inlines.some((inline) => inline.kind !== 'anchor')
	return {
		kind: 'paragraph',
		props,
		styleId,
		mark,
		inlines: context.inlines,
		numbering: numbered,
		part: story.part,
		element,
		editable: story.editable,
		hidden: (Boolean(mark.vanish) || markDeleted) && !shows,
	}
}

// Bullets drawn from symbol fonts become the Unicode characters they depict
function fromSymbolFont(text: string, style: RunProps, theme: Theme | undefined): string {
	const font = fontName(style.fontAscii, theme)
	return Array.from(text, (char) => symbolChar(font, char.codePointAt(0)!) ?? char).join('')
}

// ---------------------------------------------------------------------------------------------------------------
// Inline content

function walkInlines(container: XmlElement, p: ParagraphContext, ctx: Context, link: Link | undefined) {
	for (const node of container.children) {
		if (!('local' in node)) continue
		switch (node.local) {
			case 'r':
				run(node, p, ctx, link)
				break
			case 'hyperlink': {
				const rel = p.story.rels.get(relId(node))
				walkInlines(node, p, ctx, {
					href: rel?.external ? safeHref(rel.target) : undefined,
					tooltip: attr(node, 'tooltip'),
				})
				break
			}
			case 'ins':
			case 'moveTo':
			case 'smartTag':
			case 'customXml':
			case 'dir':
			case 'bdo':
				walkInlines(node, p, ctx, link)
				break
			case 'sdt': {
				const content = child(node, 'sdtContent')
				if (content) walkInlines(content, p, ctx, link)
				break
			}
			case 'fldSimple': {
				const field = openField(attr(node, 'instr') ?? '', p.story)
				const shownOutside = visible(p.story, 1)
				field.separated = true
				field.hide = field.kind !== undefined
				if (field.kind && shownOutside) {
					const first = child(node, 'r')
					const style = first
						? intern(ctx, ctx.styles.run(p.runBase, parseRunProps(child(first, 'rPr'), ctx.theme)))
						: p.runBase
					p.inlines.push({kind: 'field', field: field.kind, format: field.format, style})
				}
				walkInlines(node, p, ctx, link)
				p.story.fields.pop()
				break
			}
			case 'oMath':
			case 'oMathPara': {
				// Equations show as their text; laying out OMML is a typesetter of its own
				const text = mathText(node)
				if (text && visible(p.story)) {
					p.inlines.push({
						kind: 'text',
						text,
						style: intern(ctx, mergeRun(p.runBase, {italic: true})),
						font: 'Cambria Math',
						math: true,
					})
				}
				break
			}
			case 'AlternateContent': {
				const branch = chooseBranch(node, p.story)
				if (branch) walkInlines(branch, p, ctx, link)
				break
			}
		}
	}
}

function mathText(element: XmlElement): string {
	let text = ''
	for (const node of element.children) {
		if (!('local' in node)) continue
		text += node.local === 't' ? textOf(node) : mathText(node)
	}
	return text
}

function textOf(element: XmlElement): string {
	let text = ''
	for (const node of element.children) if ('text' in node) text += node.text
	return text
}

// Run content shows unless an open field is still in its instruction, or its cached result is replaced by a value
// we compute (page numbers). `skip` leaves out the innermost fields, to ask about what encloses them.
const visible = (story: StoryContext, skip = 0) =>
	story.fields.slice(0, story.fields.length - skip).every((field) => field.separated && !field.hide)

const FIELD_FORMATS = lookup<string>({
	arabic: 'decimal',
	roman: 'lowerRoman',
	alphabetic: 'lowerLetter',
	ordinal: 'ordinal',
	cardtext: 'cardinalText',
	ordtext: 'ordinalText',
})

function openField(instruction: string, story: StoryContext): Field {
	const field: Field = {instruction, separated: false, hide: false, format: ''}
	story.fields.push(field)
	resolveField(field)
	return field
}

function resolveField(field: Field) {
	const tokens: string[] = field.instruction.match(/"[^"]*"|\S+/g) ?? []
	const unquote = (token: string | undefined) => token?.replace(/^"|"$/g, '')
	const type = tokens[0]?.toUpperCase()
	if (type === 'PAGE' || type === 'NUMPAGES' || type === 'SECTIONPAGES') {
		field.kind = type === 'PAGE' ? 'page' : type === 'NUMPAGES' ? 'numpages' : 'sectionpages'
		const format = unquote(tokens[tokens.indexOf('\\*') + 1])
		const mapped = tokens.includes('\\*') && format ? FIELD_FORMATS[format.toLowerCase()] : undefined
		// \* ROMAN and \* roman differ only by case
		field.format = mapped && format === format!.toUpperCase() ? mapped.replace('lower', 'upper') : (mapped ?? '')
	} else if (type === 'HYPERLINK') {
		let target: string | undefined
		let tooltip: string | undefined
		for (let i = 1; i < tokens.length; i++) {
			if (tokens[i] === '\\o') tooltip = unquote(tokens[++i])
			else if (tokens[i].startsWith('\\')) i += tokens[i] === '\\l' || tokens[i] === '\\t' ? 1 : 0
			else target ??= unquote(tokens[i])
		}
		field.link = {href: safeHref(target), tooltip}
	}
}

function run(element: XmlElement, p: ParagraphContext, ctx: Context, link: Link | undefined) {
	const style = intern(ctx, ctx.styles.run(p.runBase, parseRunProps(child(element, 'rPr'), ctx.theme)))
	runContent(element, element, style, p, ctx, link)
}

function runContent(
	container: XmlElement,
	run: XmlElement,
	style: RunProps,
	p: ParagraphContext,
	ctx: Context,
	link: Link | undefined,
) {
	const story = p.story
	const shown = () => visible(story) && !style.vanish
	const linked = () => link ?? story.fields.findLast((field) => field.link)?.link
	const push = (inline: Inline) => {
		if (shown()) p.inlines.push(inline)
	}
	for (const node of container.children) {
		if (!('local' in node)) continue
		switch (node.local) {
			case 't': {
				if (!shown()) break
				const raw = textOf(node)
				const text = (
					attr(node, 'xml:space') === 'preserve' ? raw : raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
				).replace(/[\r\n]/g, ' ')
				// Field results are regenerated by Word, so they aren't ours to edit
				const ref: TextRef | undefined =
					story.editable && story.fields.length === 0
						? {id: ctx.refs.length, part: story.part, element: node, text}
						: undefined
				if (ref) ctx.refs.push(ref)
				// A tab character in the text is a tab, as Word lays it out; each piece keeps the w:t it belongs to
				const pieces = text.split('\t')
				pieces.forEach((piece, i) => {
					if (i > 0) p.inlines.push({kind: 'tab', style, ref, run, node})
					if (piece || (ref && pieces.length === 1))
						p.inlines.push({kind: 'text', text: piece, style, ref, link: linked(), run})
				})
				break
			}
			case 'tab':
				push({kind: 'tab', style, run, node})
				break
			case 'ptab': {
				const align = attr(node, 'alignment')
				const leader = attr(node, 'leader') ?? 'none'
				push({
					kind: 'tab',
					style,
					run,
					node,
					ptab: {
						align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
						leader: (['dot', 'hyphen', 'underscore', 'middleDot'].includes(leader) ? leader : 'none') as TabLeader,
					},
				})
				break
			}
			case 'br':
			case 'cr': {
				const type = attr(node, 'type')
				const clear = attr(node, 'clear')
				push({
					kind: 'break',
					type:
						node.local === 'br' && type === 'page'
							? 'page'
							: node.local === 'br' && type === 'column'
								? 'column'
								: 'line',
					clear: clear === 'left' || clear === 'right' ? clear : clear === 'all' ? 'both' : undefined,
					style,
					run,
					node,
				})
				break
			}
			case 'sym': {
				const code = parseInt(attr(node, 'char') ?? '', 16)
				if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) break
				const font = attr(node, 'font')
				const mapped = symbolChar(font, code)
				push({
					kind: 'text',
					text: mapped ?? String.fromCodePoint(code),
					style,
					run,
					node,
					font: mapped ? undefined : font,
				})
				break
			}
			case 'noBreakHyphen':
				push({kind: 'text', text: '\u2011', style, run, node})
				break
			case 'softHyphen':
				push({kind: 'text', text: '\u00ad', style, run, node})
				break
			case 'drawing':
				if (shown()) drawing(node, p, ctx, style, linked(), run)
				break
			case 'pict':
			case 'object':
				if (shown()) vml(node, p, ctx, style, run)
				break
			case 'footnoteReference':
			case 'endnoteReference': {
				const id = attr(node, 'id')
				if (!shown() || id === undefined || isOn(attr(node, 'customMarkFollows'))) break
				const footnote = node.local === 'footnoteReference'
				const label = noteReference(footnote, id, story, ctx)
				const superscript = intern(ctx, mergeRun(style, {vertAlign: style.vertAlign ?? 'superscript'}))
				p.inlines.push({
					kind: 'note',
					label,
					footnote: footnote && label ? id : undefined,
					style: superscript,
					run,
					node,
				})
				break
			}
			case 'footnoteRef':
			case 'endnoteRef':
				if (story.noteLabel) push({kind: 'note', label: story.noteLabel, style, run})
				break
			case 'commentReference':
				ctx.comments = true
				break
			case 'separator':
			case 'continuationSeparator':
				push({kind: 'separator', continuation: node.local === 'continuationSeparator'})
				break
			case 'fldChar': {
				const type = attr(node, 'fldCharType')
				const field = story.fields[story.fields.length - 1]
				if (type === 'begin') openField('', story)
				else if ((type === 'separate' || type === 'end') && field) {
					if (!field.separated) {
						resolveField(field)
						// A computed field shows its value where its result starts, or where it ends if it has none
						if (field.kind && visible(story, 1) && !style.vanish) {
							p.inlines.push({kind: 'field', field: field.kind, format: field.format, style, run})
						}
						field.separated = true
						field.hide = field.kind !== undefined
					}
					if (type === 'end') story.fields.pop()
				}
				break
			}
			case 'instrText': {
				const field = story.fields[story.fields.length - 1]
				if (field && !field.separated) field.instruction += textOf(node)
				break
			}
			case 'ruby': {
				const base = child(node, 'rubyBase')
				if (base) walkInlines(base, p, ctx, link)
				break
			}
			case 'AlternateContent': {
				const branch = chooseBranch(node, story)
				if (branch) runContent(branch, run, style, p, ctx, link)
				break
			}
		}
	}
}

function noteReference(footnote: boolean, id: string, story: StoryContext, ctx: Context): string {
	// A reference inside a note doesn't start a note of its own
	if (story.noteLabel !== undefined) return ''
	const settings = footnote ? ctx.settings.footnotes : ctx.settings.endnotes
	if (footnote) {
		const existing = ctx.footnoteLabels.get(id)
		if (existing !== undefined) return existing
		const label = formatNumber(settings.start + ctx.footnoteLabels.size, settings.format)
		ctx.footnoteLabels.set(id, label)
		return label
	}
	let index = ctx.endnoteOrder.indexOf(id)
	if (index < 0) index = ctx.endnoteOrder.push(id) - 1
	return formatNumber(settings.start + index, settings.format)
}

// ---------------------------------------------------------------------------------------------------------------
// Drawings

const LIMIT = 31680 * TWIP

const emu = (element: XmlElement | undefined, name: string) => {
	const raw = element && int(attr(element, name))
	return raw === undefined ? undefined : clamp(raw * EMU, -LIMIT, LIMIT)
}

function drawing(
	element: XmlElement,
	p: ParagraphContext,
	ctx: Context,
	style: RunProps,
	link: Link | undefined,
	run: XmlElement,
) {
	const box = child(element, 'inline') ?? child(element, 'anchor')
	if (!box) return
	const docPr = child(box, 'docPr')
	if (docPr && isOn(attr(docPr, 'hidden'))) return
	const extent = child(box, 'extent')
	const width = Math.max(0, emu(extent, 'cx') ?? 0)
	const height = Math.max(0, emu(extent, 'cy') ?? 0)
	const graphic = child(box, 'graphic')
	const data = graphic && child(graphic, 'graphicData')
	const alt = (docPr && (attr(docPr, 'descr') || attr(docPr, 'title'))) || undefined
	const content: Graphic = data
		? graphicContent(data, width, height, p, ctx, alt)
		: {kind: 'placeholder', of: 'pictures', width, height}
	if (box.local === 'inline') {
		p.inlines.push({kind: 'graphic', content, style, link, run, node: element})
		return
	}
	const position = (local: string, fallback: string) => {
		const element = child(box, local)
		const offset = element && child(element, 'posOffset')
		const align = element && child(element, 'align')
		const parsed = offset ? int(textOf(offset)) : undefined
		return {
			from: (element && attr(element, 'relativeFrom')) || fallback,
			offset: parsed === undefined ? undefined : clamp(parsed * EMU, -LIMIT, LIMIT),
			align: align ? textOf(align).trim() : undefined,
		}
	}
	const simplePos = isOn(attr(box, 'simplePos')) ? child(box, 'simplePos') : undefined
	const wrap = box.children.find((node): node is XmlElement => 'local' in node && node.local.startsWith('wrap'))?.local
	p.inlines.push({
		kind: 'anchor',
		run,
		object: {
			content,
			x: simplePos ? {from: 'page', offset: emu(simplePos, 'x') ?? 0} : position('positionH', 'column'),
			y: simplePos ? {from: 'page', offset: emu(simplePos, 'y') ?? 0} : position('positionV', 'paragraph'),
			wrap:
				wrap === 'wrapSquare'
					? 'square'
					: wrap === 'wrapTight'
						? 'tight'
						: wrap === 'wrapThrough'
							? 'through'
							: wrap === 'wrapTopAndBottom'
								? 'topAndBottom'
								: 'none',
			behind: isOn(attr(box, 'behindDoc')),
			distance: {
				top: Math.max(0, emu(box, 'distT') ?? 0),
				right: Math.max(0, emu(box, 'distR') ?? 0),
				bottom: Math.max(0, emu(box, 'distB') ?? 0),
				left: Math.max(0, emu(box, 'distL') ?? 0),
			},
		},
	})
}

function graphicContent(
	data: XmlElement,
	width: number,
	height: number,
	p: ParagraphContext,
	ctx: Context,
	alt?: string,
): Graphic {
	const picture = child(data, 'pic')
	if (picture)
		return pictureContent(picture, width, height, p, ctx, alt) ?? {kind: 'placeholder', of: 'pictures', width, height}
	const shape = child(data, 'wsp')
	if (shape) return shapeContent(shape, width, height, p, ctx)
	const group = child(data, 'wgp')
	if (group) return groupContent(group, width, height, p, ctx)
	// The graphic's kind is the last segment of its URI (…/drawingml/2006/chart); ink, canvases and the like are
	// drawings, so they count as pictures
	const kind = (attr(data, 'uri') ?? '').split('/').pop()
	return {
		kind: 'placeholder',
		of: kind === 'chart' || kind === 'chartex' ? 'charts' : kind === 'diagram' ? 'diagrams' : 'pictures',
		width,
		height,
	}
}

function pictureContent(
	picture: XmlElement,
	width: number,
	height: number,
	p: ParagraphContext,
	ctx: Context,
	alt?: string,
): ImageContent | undefined {
	const fill = child(picture, 'blipFill')
	// The blip's own picture: for an SVG, the PNG Word writes beside it (the SVG itself sits in an extension)
	const blip = fill && child(fill, 'blip')
	const rel = blip && p.story.rels.get(relId(blip, 'embed'))
	// Linked (external) pictures are never fetched
	if (!rel || rel.external || !ctx.pkg.has(rel.target)) return undefined
	ctx.images.add(rel.target)
	const image: ImageContent = {kind: 'image', part: rel.target, width, height, alt}
	const source = fill && child(fill, 'srcRect')
	if (source) {
		const side = (name: string) => clamp((int(attr(source, name)) ?? 0) / 100000, -1, 0.99)
		const crop = {left: side('l'), top: side('t'), right: side('r'), bottom: side('b')}
		const sane = crop.left + crop.right < 0.99 && crop.top + crop.bottom < 0.99
		if (sane && Object.values(crop).some((v) => v !== 0)) image.crop = crop
	}
	const spPr = child(picture, 'spPr')
	const xfrm = spPr && child(spPr, 'xfrm')
	return xfrm ? {...image, ...transform(xfrm)} : image
}

function transform(xfrm: XmlElement) {
	const rotation = (int(attr(xfrm, 'rot')) ?? 0) / 60000
	return {
		rotation: rotation ? clamp(rotation, -3600, 3600) : undefined,
		flipH: isOn(attr(xfrm, 'flipH')) || undefined,
		flipV: isOn(attr(xfrm, 'flipV')) || undefined,
	}
}

// Without a theme, scheme colours name nothing
const NO_PALETTE: ColorContext = {scheme: {}, map: {}}

// The colour of a solid fill, gradient stop or style reference, with its transforms applied as Office applies them
function drawingColor(
	fill: XmlElement | undefined,
	theme: Theme | undefined,
): {color: string; opacity?: number} | undefined {
	const rgba = colorOf(fill, theme?.palette ?? NO_PALETTE)
	return rgba && {color: toCss({...rgba, a: 1}), opacity: rgba.a < 1 ? rgba.a : undefined}
}

function shapeContent(
	shape: XmlElement,
	width: number,
	height: number,
	p: ParagraphContext,
	ctx: Context,
): ShapeContent {
	const spPr = child(shape, 'spPr')
	const geometryElement = spPr && child(spPr, 'prstGeom')
	const preset = geometryElement && attr(geometryElement, 'prst')
	const content: ShapeContent = {
		kind: 'shape',
		width,
		height,
		geometry:
			preset === 'ellipse'
				? 'ellipse'
				: preset === 'roundRect'
					? 'roundRect'
					: preset === 'line' || preset?.includes('Connector')
						? 'line'
						: 'rect',
	}
	// A shape without its own fill or line takes them from the theme, through its style references
	const styleElement = child(shape, 'style')
	const reference = (local: string) => {
		const element = styleElement && child(styleElement, local)
		return element && attr(element, 'idx') !== '0' ? drawingColor(element, ctx.theme) : undefined
	}
	if (!spPr || !child(spPr, 'noFill')) {
		const gradient = spPr && child(spPr, 'gradFill')
		const stops = gradient && child(gradient, 'gsLst')
		const solid = (spPr && child(spPr, 'solidFill')) ?? (stops && child(stops, 'gs'))
		const fill = solid ? drawingColor(solid, ctx.theme) : reference('fillRef')
		if (fill) Object.assign(content, {fill: fill.color, opacity: fill.opacity})
	}
	const ln = spPr && child(spPr, 'ln')
	if (!ln || !child(ln, 'noFill')) {
		const lineFill = ln && child(ln, 'solidFill')
		const lineColor = lineFill ? drawingColor(lineFill, ctx.theme) : reference('lnRef')
		const dash = ln && child(ln, 'prstDash')
		if (lineColor) {
			content.line = {
				width: Math.max(0.5, (int(ln && attr(ln, 'w')) ?? 9525) * EMU),
				color: lineColor.color,
				dashed: dash !== undefined && attr(dash, 'val') !== 'solid',
			}
		}
	}
	const xfrm = spPr && child(spPr, 'xfrm')
	if (xfrm) content.rotation = transform(xfrm).rotation
	const textBox = child(shape, 'txbx')
	const textContent = textBox && child(textBox, 'txbxContent')
	if (textContent) {
		content.blocks = textBoxBlocks(textContent, p, ctx)
		const body = child(shape, 'bodyPr')
		const inset = (name: string, fallback: number) => Math.max(0, (int(body && attr(body, name)) ?? fallback) * EMU)
		content.insets = {
			top: inset('tIns', 45720),
			right: inset('rIns', 91440),
			bottom: inset('bIns', 45720),
			left: inset('lIns', 91440),
		}
		const anchor = body && attr(body, 'anchor')
		content.anchor = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'bottom' : 'top'
	}
	return content
}

// Text box content renders but isn't editable: Word keeps a second copy of it in the VML fallback
function textBoxBlocks(container: XmlElement, p: ParagraphContext, ctx: Context): Block[] {
	const blocks: Block[] = []
	ctx.depth++
	walkBlocks(container, {...p.story, editable: false, fields: []}, ctx, blocks, undefined)
	ctx.depth--
	return blocks
}

type Box = [x: number, y: number, width: number, height: number]

function groupContent(
	group: XmlElement,
	width: number,
	height: number,
	p: ParagraphContext,
	ctx: Context,
): GroupContent {
	const items: GroupContent['items'] = []
	const collect = (container: XmlElement, place: (box: Box) => Box) => {
		for (const node of container.children) {
			if (!('local' in node)) continue
			const properties = child(node, 'spPr') ?? child(node, 'grpSpPr')
			const xfrm = properties && child(properties, 'xfrm')
			const [x, y, w, h] = place(boxOf(xfrm))
			if (node.local === 'wsp') items.push({x, y, content: shapeContent(node, w, h, p, ctx)})
			else if (node.local === 'pic') {
				const content = pictureContent(node, w, h, p, ctx)
				items.push({x, y, content: content ?? {kind: 'placeholder', of: 'pictures', width: w, height: h}})
			} else if (node.local === 'grpSp' && ctx.depth < MAX_NESTING) {
				ctx.depth++
				collect(node, childSpace(xfrm, [x, y, w, h]))
				ctx.depth--
			}
		}
	}
	const properties = child(group, 'grpSpPr')
	collect(group, childSpace(properties && child(properties, 'xfrm'), [0, 0, width, height]))
	return {kind: 'group', width, height, items}
}

function boxOf(xfrm: XmlElement | undefined): Box {
	const off = xfrm && child(xfrm, 'off')
	const ext = xfrm && child(xfrm, 'ext')
	return [emu(off, 'x') ?? 0, emu(off, 'y') ?? 0, emu(ext, 'cx') ?? 0, emu(ext, 'cy') ?? 0]
}

// A group places its children in its own coordinate space (chOff/chExt), scaled into the box it occupies
function childSpace(xfrm: XmlElement | undefined, [ox, oy, ow, oh]: Box): (box: Box) => Box {
	const childOffset = xfrm && child(xfrm, 'chOff')
	const childExtent = xfrm && child(xfrm, 'chExt')
	const cx = emu(childOffset, 'x') ?? 0
	const cy = emu(childOffset, 'y') ?? 0
	const cw = emu(childExtent, 'cx') || ow || 1
	const ch = emu(childExtent, 'cy') || oh || 1
	return ([x, y, w, h]) => [ox + ((x - cx) * ow) / cw, oy + ((y - cy) * oh) / ch, (w * ow) / cw, (h * oh) / ch]
}

// ---------------------------------------------------------------------------------------------------------------
// VML (w:pict, w:object): legacy drawings, still written for horizontal lines, watermarks and OLE previews

function vmlStyle(element: XmlElement): Map<string, string> {
	const map = new Map<string, string>()
	for (const declaration of (attr(element, 'style') ?? '').split(';')) {
		const colon = declaration.indexOf(':')
		if (colon > 0) map.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim())
	}
	return map
}

const VML_UNITS: Record<string, number> = {pt: POINT, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, px: 1, pc: 16}

function vmlLength(text: string | undefined): number | undefined {
	const match = text && /^([-+]?(?:\d+\.?\d*|\.\d+))(pt|in|cm|mm|px|pc)?$/.exec(text)
	if (!match) return undefined
	const result = parseFloat(match[1]) * (match[2] ? VML_UNITS[match[2]] : 1)
	return Number.isFinite(result) ? clamp(result, -LIMIT, LIMIT) : undefined
}

function vmlColor(text: string | undefined): string | undefined {
	const trimmed = text?.trim()
	if (!trimmed) return undefined
	const match = /^#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(trimmed)
	if (match) return `#${match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]}`.toLowerCase()
	const preset = presetColor(trimmed.split(/\s/)[0])
	return preset && toCss(preset)
}

const VML_SHAPES = new Set(['shape', 'rect', 'roundrect', 'oval', 'image'])

function vml(element: XmlElement, p: ParagraphContext, ctx: Context, style: RunProps, run: XmlElement) {
	const shape = element.children.find((node): node is XmlElement => 'local' in node && VML_SHAPES.has(node.local))
	if (!shape) return
	const css = vmlStyle(shape)
	if (css.get('visibility') === 'hidden' || css.get('display') === 'none') return
	const width = Math.max(0, vmlLength(css.get('width')) ?? 0)
	const height = Math.max(0, vmlLength(css.get('height')) ?? 0)
	if (attr(shape, 'o:hr') === 't') {
		const align = attr(shape, 'o:hralign')
		p.inlines.push({
			kind: 'rule',
			height: Math.max(1, height),
			color: vmlColor(attr(shape, 'fillcolor')) ?? '#a0a0a0',
			align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
			width: clamp((int(attr(shape, 'o:hrpct')) || 1000) / 1000, 0.01, 1),
			run,
		})
		return
	}
	let content: Graphic
	const textPath = child(shape, 'textpath')
	const imageData = child(shape, 'imagedata')
	const rel = imageData && p.story.rels.get(relId(imageData))
	if (textPath && attr(textPath, 'string')) {
		const fill = child(shape, 'fill')
		const opacity = parseFloat(fill ? (attr(fill, 'opacity') ?? '1') : '1')
		const font = /font-family:\s*"?([^";]+)"?/.exec(attr(textPath, 'style') ?? '')?.[1]
		content = {
			kind: 'watermark',
			text: attr(textPath, 'string')!.slice(0, 200),
			width,
			height,
			color: vmlColor(attr(shape, 'fillcolor')) ?? '#c0c0c0',
			opacity: Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 0.5,
			rotation: clamp(parseFloat(css.get('rotation') ?? '0') || 0, -360, 360),
			font,
		}
	} else if (rel && !rel.external && ctx.pkg.has(rel.target)) {
		ctx.images.add(rel.target)
		content = {kind: 'image', part: rel.target, width, height, object: element.local === 'object' || undefined}
	} else if (element.local === 'object') {
		// An embedded object without a picture of itself to show
		content = {kind: 'placeholder', of: 'objects', width, height}
	} else {
		const textBox = child(shape, 'textbox')
		const textContent = textBox && child(textBox, 'txbxContent')
		const filled = attr(shape, 'filled') !== 'f' && attr(shape, 'filled') !== 'false'
		const stroked = attr(shape, 'stroked') !== 'f' && attr(shape, 'stroked') !== 'false'
		content = {
			kind: 'shape',
			width,
			height,
			geometry: shape.local === 'oval' ? 'ellipse' : shape.local === 'roundrect' ? 'roundRect' : 'rect',
			fill: filled ? (vmlColor(attr(shape, 'fillcolor')) ?? '#ffffff') : undefined,
			line: stroked
				? {
						width: vmlLength(attr(shape, 'strokeweight')) ?? 1,
						color: vmlColor(attr(shape, 'strokecolor')) ?? '#000000',
						dashed: false,
					}
				: undefined,
			blocks: textContent ? textBoxBlocks(textContent, p, ctx) : undefined,
			insets: {top: 4.8, right: 9.6, bottom: 4.8, left: 9.6},
		}
	}
	if (css.get('position') !== 'absolute') {
		p.inlines.push({kind: 'graphic', content, style, run, node: element})
		return
	}
	const relative = (key: string, fallback: string) => {
		const from = css.get(key)
		return from === 'page' || from === 'margin' ? from : fallback
	}
	const aligned = (key: string) => {
		const align = css.get(key)
		return align && align !== 'absolute' ? align : undefined
	}
	p.inlines.push({
		kind: 'anchor',
		run,
		object: {
			content,
			x: {
				from: relative('mso-position-horizontal-relative', 'column'),
				offset: vmlLength(css.get('margin-left')) ?? 0,
				align: aligned('mso-position-horizontal'),
			},
			y: {
				from: relative('mso-position-vertical-relative', 'paragraph'),
				offset: vmlLength(css.get('margin-top')) ?? 0,
				align: aligned('mso-position-vertical'),
			},
			wrap: 'none',
			behind: (int(css.get('z-index')) ?? 0) < 0,
			distance: {top: 0, right: 0, bottom: 0, left: 0},
		},
	})
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

type Edges = Record<'top' | 'right' | 'bottom' | 'left', Border | undefined>

function table(element: XmlElement, story: StoryContext, ctx: Context): Table {
	const {styles, theme, settings} = ctx
	const direct = parseTableProps(child(element, 'tblPr'), theme)
	const tableStyle = styles.tableStyle(direct.styleId)
	const props = mergeTable(mergeTable(styles.tableStyle(undefined).tblPr, tableStyle.tblPr), direct)
	const gridElement = child(element, 'tblGrid')
	const grid = (gridElement ? children(gridElement, 'gridCol') : []).map((col) => Math.max(0, length(col, 'w') ?? 0))

	// Rows and cells can sit inside content controls and revisions as well
	const collect = (container: XmlElement, local: string, out: XmlElement[]) => {
		for (const node of container.children) {
			if (!('local' in node)) continue
			if (node.local === local) out.push(node)
			else if (node.local === 'sdt') collect(child(node, 'sdtContent') ?? node, local, out)
			else if (node.local === 'customXml' || node.local === 'ins' || node.local === 'moveTo') collect(node, local, out)
		}
		return out
	}

	type Draft = {element: XmlElement; props: CellProps; column: number; span: number}
	const drafts: Array<{props: RowProps; cells: Draft[]}> = []
	for (const rowElement of collect(element, 'tr', [])) {
		const trPr = child(rowElement, 'trPr')
		const rowProps = parseRowProps(trPr)
		// A deleted row is gone in the final view
		if (rowProps.hidden || (trPr && child(trPr, 'del'))) continue
		let column = rowProps.gridBefore ?? 0
		const cells: Draft[] = []
		for (const cellElement of collect(rowElement, 'tc', [])) {
			const cellProps = parseCellProps(child(cellElement, 'tcPr'), theme)
			const span = cellProps.gridSpan ?? 1
			// Legacy horizontal merges extend the cell to their left
			if (cellProps.hMerge === 'continue' && cells.length) cells[cells.length - 1].span += span
			else cells.push({element: cellElement, props: cellProps, column, span})
			column += span
		}
		drafts.push({props: rowProps, cells})
	}
	const used = drafts.flatMap((row) => row.cells.map((cell) => cell.column + cell.span))
	const columnCount = Math.min(63 * 4, Math.max(grid.length, ...used, 0))
	while (grid.length < columnCount) grid.push(0)

	const look = props.look ?? {
		firstRow: false,
		lastRow: false,
		firstColumn: false,
		lastColumn: false,
		noHBand: false,
		noVBand: false,
	}
	const rowBand = props.rowBandSize ?? 1
	const colBand = props.colBandSize ?? 1
	const outer = props.borders ?? {}
	const defaultMargins = {top: 0, right: 7.2, bottom: 0, left: 7.2, ...props.cellMargins}
	const rowCount = drafts.length
	const rows: Row[] = []
	const owners: Array<Array<Cell | undefined>> = []

	drafts.forEach((draft, r) => {
		const row: Row = {props: draft.props, cells: [], header: Boolean(draft.props.header)}
		owners[r] = []
		for (const cellDraft of draft.cells) {
			const {column, span} = cellDraft
			const own = cellDraft.props.borders ?? {}
			// A continuing vertical merge adds this row to the cell above
			if (cellDraft.props.vMerge === 'continue' && r > 0) {
				const above = owners[r - 1][column]
				if (above && above.column === column) {
					above.rowSpan++
					above.borders.bottom = own.bottom ?? (r === rowCount - 1 ? outer.bottom : outer.insideH) ?? NO_BORDER
					for (let c = column; c < column + span; c++) owners[r][c] = above
					continue
				}
			}
			const first = look.firstRow && r === 0
			const last = look.lastRow && r === rowCount - 1 && rowCount > 1
			const firstColumn = look.firstColumn && column === 0
			const lastColumn = look.lastColumn && column + span === columnCount
			const conditions = new Set<string>(['wholeTable'])
			if (!look.noVBand && !firstColumn && !lastColumn) {
				conditions.add(
					Math.floor((column - (look.firstColumn ? 1 : 0)) / colBand) % 2 === 0 ? 'band1Vert' : 'band2Vert',
				)
			}
			if (!look.noHBand && !first && !last) {
				conditions.add(Math.floor((r - (look.firstRow ? 1 : 0)) / rowBand) % 2 === 0 ? 'band1Horz' : 'band2Horz')
			}
			if (firstColumn) conditions.add('firstCol')
			if (lastColumn) conditions.add('lastCol')
			if (first) conditions.add('firstRow')
			if (last) conditions.add('lastRow')
			if (first && lastColumn) conditions.add('neCell')
			if (first && firstColumn) conditions.add('nwCell')
			if (last && lastColumn) conditions.add('seCell')
			if (last && firstColumn) conditions.add('swCell')

			let cellProps: CellProps = tableStyle.tcPr
			const formatting: CellFormatting = {pPr: tableStyle.pPr, rPr: tableStyle.rPr}
			const edges: Edges = {
				top: r === 0 ? outer.top : outer.insideH,
				bottom: r === rowCount - 1 ? outer.bottom : outer.insideH,
				left: column === 0 ? outer.left : outer.insideV,
				right: column + span === columnCount ? outer.right : outer.insideV,
			}
			for (const type of CONDITIONAL_ORDER) {
				const conditional = conditions.has(type) ? tableStyle.conditional.get(type) : undefined
				if (!conditional) continue
				formatting.pPr = mergePara(formatting.pPr, conditional.pPr)
				formatting.rPr = mergeRun(formatting.rPr, conditional.rPr)
				cellProps = mergeCell(cellProps, {...conditional.tcPr, borders: undefined})
				// A row region's left and right are its outer edges, with insideV between its cells; a column region's top
				// and bottom likewise, with insideH
				const b = {...conditional.tblPr.borders, ...conditional.tcPr.borders}
				const rowRegion = type.endsWith('Horz') || type === 'firstRow' || type === 'lastRow'
				const columnRegion = type.endsWith('Vert') || type === 'firstCol' || type === 'lastCol'
				edges.top = (columnRegion && r > 0 ? b.insideH : b.top) ?? edges.top
				edges.bottom = (columnRegion && r < rowCount - 1 ? b.insideH : b.bottom) ?? edges.bottom
				edges.left = (rowRegion && column > 0 ? b.insideV : b.left) ?? edges.left
				edges.right = (rowRegion && column + span < columnCount ? b.insideV : b.right) ?? edges.right
			}
			cellProps = mergeCell(cellProps, cellDraft.props)
			const blocks: Block[] = []
			ctx.depth++
			walkBlocks(cellDraft.element, story, ctx, blocks, formatting)
			ctx.depth--
			const cell: Cell = {
				blocks,
				props: cellProps,
				column,
				span,
				rowSpan: 1,
				borders: {
					top: own.top ?? edges.top ?? NO_BORDER,
					right: own.right ?? edges.right ?? NO_BORDER,
					bottom: own.bottom ?? edges.bottom ?? NO_BORDER,
					left: own.left ?? edges.left ?? NO_BORDER,
				},
				margins: {...defaultMargins, ...cellProps.margins},
			}
			for (let c = column; c < column + span; c++) owners[r][c] = cell
			row.cells.push(cell)
		}
		rows.push(row)
	})
	// Header rows repeat only as an unbroken run from the top
	let header = true
	for (const row of rows) {
		header &&= row.header
		row.header = header
	}
	const leftAligned = props.align !== 'center' && props.align !== 'right'
	return {
		kind: 'table',
		props,
		grid,
		rows,
		outdent: settings.compatibilityMode < 15 && leftAligned ? defaultMargins.left : 0,
	}
}
