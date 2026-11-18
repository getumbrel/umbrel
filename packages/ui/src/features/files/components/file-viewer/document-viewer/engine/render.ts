// The model as DOM. Elements are built with createElement, textContent and style properties only, never markup, so
// nothing from the document can become a tag, a script or a stylesheet. Each paragraph is a block whose spacing is
// padding, so that it's part of the block's height: what's between two paragraphs is worked out as Word does (see
// neighbourhood), where CSS margins would collapse by rules of their own. A block is laid out with no strut of its
// own so its lines are only as tall as the runs on them, as in Word.

import {fontStack} from '@/features/files/components/file-viewer/shared/fonts'
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'

import {DEFAULT_LINE_RATIO, lineRatio} from './fonts'
import {
	type Anchored,
	type Approximated,
	type Block,
	type Cell,
	type Graphic,
	type Inline,
	type Insertion,
	type Numbered,
	type Paragraph,
	type Row,
	type Slot,
	type Table,
} from './model'
import {formatNumber} from './numbering'
import {isDark, POINT, type Border, type Frame, type RunProps, type TabStop, type Theme} from './props'
import {fontName, type Settings} from './styles'

import './render.css'

// `grid` is the pitch of the line grid the paragraph's lines are set on, where they are
export type LineSpacing =
	| {rule: 'auto'; multiple: number; grid?: number}
	| {rule: 'atLeast'; height: number; grid?: number}
	| {rule: 'exact'; height: number}

// What layout needs to place a tab once its paragraph is laid out: its paragraph's stops, its indents on the left
// (`indent`, less `hanging` on the first line) and the right, how far its box reaches past its text on each side, and
// whether it's a table cell's
export type TabEntry = {
	element: HTMLElement
	stops: TabStop[]
	indent: number
	hanging: number
	right: number
	reach: {start: number; end: number}
	cell: boolean
	ptab?: {align: 'left' | 'center' | 'right'}
}

// Floating objects positioned on the page, placed once their paragraph's page is known
export type PageAnchor = {element: HTMLElement; object: Anchored; block: HTMLElement}

// Everything editing and layout look elements up by
export class Registry {
	// Spans holding a slot's text: several when a page break splits it
	readonly refs = new WeakMap<Element, Slot>()
	readonly spans = new Map<number, HTMLElement[]>()
	private insertions = 0
	readonly fragments = new Map<Paragraph, HTMLElement[]>()
	readonly paragraphs = new WeakMap<Element, Paragraph>()
	readonly islands = new WeakMap<Element, Inline>()
	readonly marks = new WeakMap<Element, Paragraph>()
	readonly cells = new WeakMap<Element, Cell>()
	readonly rows = new WeakMap<Element, Row>()
	// The grid column each table cell starts at, to place the continuation of a merged cell on the next page
	readonly columns = new WeakMap<Element, number>()
	// Footnote references in the body, to place each note on its reference's page
	readonly notes: Array<{element: HTMLElement; id: string}> = []
	readonly tabs: TabEntry[] = []
	readonly anchors: PageAnchor[] = []
	// Paragraph blocks that begin on a new page or column because of an explicit break, and those that end theirs
	// with one: what follows them begins the next
	readonly breaks = new WeakMap<Element, 'page' | 'column'>()
	readonly breaksAfter = new WeakMap<Element, 'page' | 'column'>()
	// The inner box of a paragraph with borders or shading, which holds its content inside the block that spaces it
	readonly boxes = new WeakSet<Element>()
	// Whether text wraps around an object somewhere: the blocks after it then depend on it
	floating = false
	// For paragraphs that can be edited: the blocks each is one of (a section's, a cell's), how those were rendered,
	// what each was rendered beside, and the element holding its list label. An edit that rewrites a paragraph renders
	// it again in the same place, and counts the lists again.
	readonly homes = new WeakMap<Paragraph, Block[]>()
	readonly containers = new WeakMap<Block[], {ctx: RenderContext; background?: string}>()
	readonly near = new WeakMap<Paragraph, Neighbourhood>()
	readonly labels = new WeakMap<Paragraph, HTMLElement>()
	// The range that text is measured and places are compared with, the one for all of it: it's left where it was last
	// put, so whoever takes it sets both its ends. A document keeps every range made in it up to date through each
	// change to its nodes for as long as the range lives, which is until it's collected: one made for each measurement
	// leaves thousands behind in a long document, and every node put on a page after that takes that much longer.
	readonly range: Range
	// The elements of paragraphs that left the document, until what's listed of them is swept out
	private left = new WeakSet<Element>()
	private swept = true

	constructor(doc: Document) {
		this.range = doc.createRange()
	}

	insertion(paragraph: Paragraph, at?: Insertion['at']): Insertion {
		return {id: -++this.insertions, paragraph, at}
	}

	register(span: HTMLElement, ref: Slot, after?: HTMLElement) {
		this.refs.set(span, ref)
		const list = this.spans.get(ref.id) ?? []
		const index = after ? list.indexOf(after) : -1
		list.splice(index >= 0 ? index + 1 : list.length, 0, span)
		this.spans.set(ref.id, list)
	}

	fragment(paragraph: Paragraph, element: HTMLElement, after?: HTMLElement) {
		this.paragraphs.set(element, paragraph)
		const list = this.fragments.get(paragraph) ?? []
		const index = after ? list.indexOf(after) : -1
		list.splice(index >= 0 ? index + 1 : list.length, 0, element)
		this.fragments.set(paragraph, list)
	}

	// A paragraph leaves the document, its blocks whole again: what was kept of them, and of what they hold, goes
	forget(paragraph: Paragraph) {
		for (const block of this.fragments.get(paragraph) ?? []) {
			for (const element of [block, ...block.querySelectorAll('*')]) {
				this.left.add(element)
				const slot = this.refs.get(element)
				if (slot) this.spans.delete(slot.id)
				const held = this.paragraphs.get(element)
				if (held) this.fragments.delete(held)
			}
		}
		this.swept = false
	}

	// Drops the tabs, note references and floating objects of the paragraphs that left, in one pass however many did
	sweep() {
		if (this.swept) return
		this.swept = true
		const stays = <T>(list: T[], gone: (item: T) => boolean) => {
			let kept = 0
			for (const item of list) if (!gone(item)) list[kept++] = item
			list.length = kept
		}
		for (const anchor of this.anchors) if (this.left.has(anchor.block)) anchor.element.remove()
		stays(this.anchors, (anchor) => this.left.has(anchor.block))
		stays(this.tabs, (tab) => this.left.has(tab.element))
		stays(this.notes, (note) => this.left.has(note.element))
	}
}

export type RenderContext = {
	doc: Document
	theme: Theme | undefined
	settings: Settings
	images: Map<string, string | undefined>
	registry: Registry
	// Font stacks get an index, and lines a CSS variable holding that stack's measured line height
	stacks: Map<string, number>
	// The faces text is set in, as CSS font shorthands, to load before anything is laid out
	faces: Set<string>
	styles: WeakMap<RunProps, Map<string, Record<string, string>>>
	// Content that renders but isn't edited: headers, footers, notes, repeated header rows
	editable: boolean
	body: boolean
	// The blocks are a table cell's own
	cell: boolean
	// The blocks end the document: nothing comes after the last of them
	last?: boolean
	page: PageGeometry
	// The width blocks are laid out in: the column, a cell's text area, a text box's
	width: number
	// Headers and footers repeat on every page, so their page-positioned objects go in a layer cloned with them
	layer?: HTMLElement
	// What was drawn only roughly or not at all, noted as it's drawn
	approximated: Set<Approximated>
}

export type PageGeometry = {
	width: number
	height: number
	margins: {top: number; right: number; bottom: number; left: number}
	// The pitch of the section's line grid, where it has one
	grid?: number
}

// Where an object positioned relative to the page, its margins or a column lands, in page coordinates
export function pagePosition(
	object: Anchored,
	page: PageGeometry,
	column: {left: number; width: number},
): {left: number; top: number} {
	const {margins} = page
	const {width, height} = object.content
	const horizontal = lookup<[number, number]>({
		page: [0, page.width],
		margin: [margins.left, page.width - margins.right],
		leftMargin: [0, margins.left],
		rightMargin: [page.width - margins.right, page.width],
		insideMargin: [0, margins.left],
		outsideMargin: [page.width - margins.right, page.width],
	})
	const vertical = lookup<[number, number]>({
		page: [0, page.height],
		margin: [margins.top, page.height - margins.bottom],
		topMargin: [0, margins.top],
		bottomMargin: [page.height - margins.bottom, page.height],
	})
	const place = (
		[start, end]: [number, number],
		size: number,
		align: string | undefined,
		offset: number | undefined,
	) =>
		align === 'center'
			? (start + end - size) / 2
			: align === 'right' || align === 'bottom' || align === 'outside'
				? end - size
				: start + (align ? 0 : (offset ?? 0))
	return {
		left: place(
			horizontal[object.x.from] ?? [column.left, column.left + column.width],
			width,
			object.x.align,
			object.x.offset,
		),
		top: place(
			vertical[object.y.from] ?? [margins.top, page.height - margins.bottom],
			height,
			object.y.align,
			object.y.offset,
		),
	}
}

const DEFAULT_SIZE = 20 // half-points: Word's 10 pt when nothing says otherwise

// Text in 'auto' colour is black, or white on a dark fill
const autoColor = (background: string | undefined) =>
	background && background !== 'none' && isDark(background) ? '#ffffff' : '#000000'

const element = <K extends keyof HTMLElementTagNameMap>(ctx: RenderContext, tag: K) => ctx.doc.createElement(tag)

const px = (value: number) => `${Math.round(value * 1000) / 1000}px`

// What the caret can't enter, marked by the attribute (which also reaches cloned pages, and DOMs without editing)
export const lock = (node: Element) => node.setAttribute('contenteditable', 'false')
export const locked = (node: Node) =>
	node.nodeType === Node.ELEMENT_NODE && (node as Element).getAttribute('contenteditable') === 'false'

function island(ctx: RenderContext, inline: Inline | undefined): HTMLElement {
	const node = element(ctx, 'span')
	lock(node)
	if (inline) ctx.registry.islands.set(node, inline)
	return node
}

function stackIndex(ctx: Pick<RenderContext, 'stacks'>, stack: string): number {
	let index = ctx.stacks.get(stack)
	if (index === undefined) {
		index = ctx.stacks.size
		ctx.stacks.set(stack, index)
	}
	return index
}

// ---------------------------------------------------------------------------------------------------------------
// Runs

function isComplex(props: RunProps) {
	return Boolean(props.rtl || props.cs)
}

function runFace(props: RunProps, theme: Theme | undefined): string | undefined {
	return (
		fontName(isComplex(props) ? props.fontCs : (props.fontAscii ?? props.fontHAnsi), theme) ??
		fontName(props.fontHAnsi, theme)
	)
}

function runSize(props: RunProps): number {
	return ((isComplex(props) ? (props.sizeCs ?? props.size) : props.size) ?? DEFAULT_SIZE) * (2 / 3)
}

// A line's height is given in the unit browsers lay out in, the sixty-fourth of a pixel. Of a height between two of
// them Chrome takes the nearer and Safari the one below: left as it comes, 46 lines of Times New Roman at 12 pt are a
// third of a pixel shorter in Safari, which lets the page take a 47th, one more than in Chrome and in Word.
const UNIT = 1 / 64
const ROUNDS = typeof CSS !== 'undefined' && Boolean(CSS.supports?.('line-height', 'round(nearest, 1px, 1px)'))
const whole = (value: number) => `${Math.round(value / UNIT) * UNIT}px`

// What a line as tall as a grid's pitch, give or take what arithmetic leaves, is still under: one line of the grid
const HAIR = 0.01

function lineHeight(
	ctx: Pick<RenderContext, 'stacks'>,
	stack: string,
	face: string | undefined,
	size: number,
	line: LineSpacing,
): string {
	if (line.rule === 'exact') return whole(line.height)
	const multiple = line.rule === 'auto' ? line.multiple : 1
	const {grid} = line
	// As tall as the face named makes a line or, where that isn't known, as its stack of faces measures. On a grid a
	// line takes as many of the grid's lines as it needs to be that tall, and its spacing multiplies those.
	const ratio = lineRatio(face)
	if (ratio !== undefined) {
		const natural = ratio * size
		return whole((grid ? Math.ceil((natural - HAIR) / grid) * grid : natural) * multiple)
	}
	const measured = `var(--docx-line-${stackIndex(ctx, stack)}, ${DEFAULT_LINE_RATIO})`
	if (!ROUNDS) return `calc(${measured} * ${px(size * multiple)})`
	const height = grid
		? `calc(round(up, calc(${measured} * ${px(size)} - ${HAIR}px), ${grid}px) * ${multiple})`
		: `calc(${measured} * ${px(size * multiple)})`
	return `round(nearest, ${height}, ${UNIT}px)`
}

const UNDERLINE_STYLES = lookup<string>({double: 'double', wavyDouble: 'wavy', wave: 'wavy', wavyHeavy: 'wavy'})

// The CSS of a run as a record of style properties, cached per formatting, line spacing and background
function runCss(
	ctx: Pick<RenderContext, 'theme' | 'stacks' | 'faces' | 'styles'>,
	props: RunProps,
	line: LineSpacing,
	background: string | undefined,
	font?: string,
): Record<string, string> {
	const grid = 'grid' in line ? line.grid : undefined
	const key = `${line.rule}:${'multiple' in line ? line.multiple : line.height}:${grid}:${background}:${font}`
	let cache = ctx.styles.get(props)
	const cached = cache?.get(key)
	if (cached) return cached
	const complex = isComplex(props)
	const face = font ?? runFace(props, ctx.theme)
	const stack = font
		? fontStack([font])
		: fontStack([
				face,
				fontName(props.fontEastAsia, ctx.theme),
				complex ? undefined : fontName(props.fontCs, ctx.theme),
			])
	const size = runSize(props)
	const css: Record<string, string> = {
		fontFamily: stack,
		fontSize: px(props.vertAlign === 'superscript' || props.vertAlign === 'subscript' ? size * 0.65 : size),
		lineHeight: lineHeight(ctx, stack, face, size, line),
		fontWeight: (complex ? props.boldCs : props.bold) ? '700' : '400',
		fontStyle: (complex ? props.italicCs : props.italic) ? 'italic' : 'normal',
	}
	ctx.faces.add(`${css.fontStyle} ${css.fontWeight} 16px ${stack}`)
	const decorations: string[] = []
	const underline = props.underline && props.underline !== 'none' ? props.underline : undefined
	if (underline) decorations.push('underline')
	if (props.strike || props.dstrike) decorations.push('line-through')
	if (decorations.length) {
		css.textDecorationLine = decorations.join(' ')
		const style =
			(underline && UNDERLINE_STYLES[underline]) ??
			(props.dstrike && !underline
				? 'double'
				: underline?.startsWith('dot') && !underline.startsWith('dotDash')
					? 'dotted'
					: underline?.toLowerCase().includes('dash')
						? 'dashed'
						: 'solid')
		css.textDecorationStyle = style
		if (underline && /heavy|thick/i.test(underline)) css.textDecorationThickness = '2px'
		if (props.underlineColor && props.underlineColor !== 'auto') css.textDecorationColor = props.underlineColor
	}
	const fill =
		props.highlight && props.highlight !== 'none'
			? props.highlight
			: props.shading && props.shading !== 'none'
				? props.shading
				: undefined
	if (fill) css.backgroundColor = fill
	css.color = props.color && props.color !== 'auto' ? props.color : autoColor(fill ?? background)
	if (props.spacing) css.letterSpacing = px(props.spacing)
	const raise = props.vertAlign === 'superscript' ? size * 0.33 : props.vertAlign === 'subscript' ? -size * 0.14 : 0
	if (raise + (props.position ?? 0)) css.verticalAlign = px(raise + (props.position ?? 0))
	if (props.caps) css.textTransform = 'uppercase'
	if (props.smallCaps) css.fontVariantCaps = 'small-caps'
	if (props.rtl) {
		css.direction = 'rtl'
		css.unicodeBidi = 'embed'
	}
	if (!cache) ctx.styles.set(props, (cache = new Map()))
	cache.set(key, css)
	return css
}

export function applyCss(node: HTMLElement, css: Record<string, string>) {
	const style = node.style as unknown as Record<string, string>
	for (const key in css) style[key] = css[key]
}

// ---------------------------------------------------------------------------------------------------------------
// Paragraphs

type Spacing = {before: number; after: number}

// A section's line grid sets the lines of every paragraph that doesn't opt out of it, but those of an exact height;
// in a table's cells only where the document asks for that
function lineSpacing(paragraph: Paragraph, ctx: Pick<RenderContext, 'page' | 'cell' | 'settings'>): LineSpacing {
	const {line, lineRule} = paragraph.props.spacing ?? {}
	if (lineRule === 'exact' && line !== undefined) return {rule: 'exact', height: line / 15}
	const grid =
		paragraph.props.snapToGrid !== false && (!ctx.cell || ctx.settings.gridInTables) ? ctx.page.grid : undefined
	if (line === undefined) return {rule: 'auto', multiple: 1, grid}
	if (lineRule === 'atLeast') return {rule: 'atLeast', height: line / 15, grid}
	return {rule: 'auto', multiple: Math.min(Math.max(line / 240, 0.06), 132), grid}
}

// The space a paragraph asks for around itself. Automatic spacing is the margin a browser gives a paragraph, or
// Word's fixed 5 pt before and 10 pt after in a document that isn't spaced as HTML is, and spacing in lines counts
// 12 pt lines.
function spacingOf(paragraph: Paragraph, settings: Settings): Spacing {
	const spacing = paragraph.props.spacing ?? {}
	const before = spacing.beforeAuto
		? (settings.htmlSpacing ? 14 : 5) * POINT
		: spacing.beforeLines !== undefined
			? spacing.beforeLines * 0.16
			: (spacing.before ?? 0)
	const after = spacing.afterAuto
		? (settings.htmlSpacing ? 14 : 10) * POINT
		: spacing.afterLines !== undefined
			? spacing.afterLines * 0.16
			: (spacing.after ?? 0)
	return {before, after}
}

// A border that's there to draw
const drawn = (border: Border | undefined) => (border && border.style !== 'none' ? border : undefined)

const boxed = (p: Paragraph) =>
	Boolean(
		(p.props.borders && Object.values(p.props.borders).some(drawn)) || (p.props.shading && p.props.shading !== 'none'),
	)

// How far the box of a paragraph with borders or shading reaches past its text, where its lines start and where they
// end. A border stands outside the text, the space it keeps from the text between them, so that text is set as wide
// with a border as without. And the box holds a first line that hangs, which is where a list has its number.
function reach(paragraph: Paragraph): TabEntry['reach'] {
	const {props} = paragraph
	if (!boxed(paragraph)) return {start: 0, end: 0}
	const outside = (border: Border | undefined) => {
		const shown = drawn(border)
		return shown ? shown.width + shown.space : 0
	}
	// w:ind left is the start side, which is the right in a right-to-left paragraph; a border is on the side it names
	const {left, right} = props.borders ?? {}
	const [start, end] = props.bidi ? [right, left] : [left, right]
	return {start: (props.indent?.hanging ?? 0) + outside(start), end: outside(end)}
}

// Whether two paragraphs' boxes are drawn alike and have the same sides, which makes them one box
const sameBox = (a: Paragraph, b: Paragraph) => {
	const box = ({props}: Paragraph) =>
		JSON.stringify([
			props.borders,
			props.shading,
			Boolean(props.bidi),
			(props.indent?.left ?? 0) - (props.indent?.hanging ?? 0),
			props.indent?.right ?? 0,
		])
	return box(a) === box(b)
}

// A break that ends a page or a column, where one in a line only ends the line
type Divide = Extract<Inline, {kind: 'break'}> & {type: 'page' | 'column'}
const divides = (inline: Inline): inline is Divide => inline.kind === 'break' && inline.type !== 'line'

// The page or column break a paragraph ends with, nothing coming after it: the paragraph's mark stays behind with
// the break, and what follows the paragraph begins the next page or column. Early versions of Word moved the mark
// along, to a line of its own, and a document can still ask for that.
export function trailingBreak(paragraph: Paragraph, settings: Settings): Divide | undefined {
	if (settings.markFollowsBreak) return undefined
	for (let index = paragraph.inlines.length - 1; index >= 0; index--) {
		const inline = paragraph.inlines[index]
		if (divides(inline)) return inline
		if (inline.kind !== 'text' || inline.text) return undefined
	}
	return undefined
}

export type Neighbourhood = {spacing: Spacing; groupStart: boolean; groupEnd: boolean; last: boolean}

// Spacing and border grouping depend on what a paragraph is beside: the space between two paragraphs is worked out
// from both, and consecutive paragraphs with the same borders share one box with the space between them inside it.
// Hidden paragraphs are beside nothing. The paragraph nothing follows is the document's `last`.
export function neighbourhood(
	blocks: Block[],
	index: number,
	{settings, cell, body, last}: Pick<RenderContext, 'settings' | 'cell' | 'body' | 'last'>,
): Neighbourhood {
	const block = blocks[index] as Paragraph
	const shown = (other: Block | undefined) => other !== undefined && (other.kind === 'table' || !other.hidden)
	const beside = (step: -1 | 1) => {
		let at = index + step
		while (blocks[at] && !shown(blocks[at])) at += step
		return blocks[at]
	}
	const previous = beside(-1)
	const next = beside(1)
	// The space a paragraph leaves on one side, by what's there. Contextual spacing leaves none between paragraphs of
	// one style. Automatic spacing as HTML's falls as a browser's margins do: the items of a list have none between
	// them, and there's none above the first paragraph or, in a table cell, below the last.
	const space = (paragraph: Paragraph, other: Block | undefined, side: 'before' | 'after') => {
		const alike = other?.kind === 'paragraph' && other.styleId === paragraph.styleId
		const item =
			other?.kind === 'paragraph' && paragraph.list !== undefined && other.list?.numId === paragraph.list.numId
		const edge = !other && (side === 'before' || cell)
		const auto = settings.htmlSpacing && paragraph.props.spacing?.[`${side}Auto`]
		if ((paragraph.props.contextualSpacing && alike) || (auto && (item || edge))) return 0
		return spacingOf(paragraph, settings)[side]
	}
	const spacing = {before: space(block, previous, 'before'), after: space(block, next, 'after')}
	// Spaced as HTML is, two paragraphs have the larger of their spaces between them, not both: of the space before
	// this one, only what's more than the one above leaves after itself. A paragraph that starts a page or a column
	// has it all.
	const starts =
		body && (block.props.pageBreakBefore || (previous?.kind === 'paragraph' && trailingBreak(previous, settings)))
	if (settings.htmlSpacing && previous?.kind === 'paragraph' && !starts)
		spacing.before = Math.max(0, spacing.before - space(previous, block, 'after'))
	const grouped = (other: Block | undefined) => other?.kind === 'paragraph' && boxed(block) && sameBox(block, other)
	return {spacing, groupStart: !grouped(previous), groupEnd: !grouped(next), last: Boolean(body && last) && !next}
}

function borderCss(
	node: HTMLElement,
	side: 'Top' | 'Right' | 'Bottom' | 'Left',
	border: Border | undefined,
	padding = 0,
) {
	const style = node.style
	const shown = drawn(border)
	if (shown) {
		style[`border${side}Style`] = shown.style
		style[`border${side}Width`] = px(shown.width)
		style[`border${side}Color`] = shown.color === 'auto' ? '#000000' : shown.color
	}
	style[`padding${side}`] = px(padding + (shown?.space ?? 0))
}

// Renders a paragraph as one block, or several when explicit page or column breaks divide it: each starts on a new
// page or column, as Word lays it out. Inside cells and headers breaks only end the line.
function renderParagraph(
	paragraph: Paragraph,
	ctx: RenderContext,
	near: Neighbourhood,
	background?: string,
): HTMLElement[] {
	const {registry} = ctx
	const props = paragraph.props
	const line = lineSpacing(paragraph, ctx)
	const shading = props.shading && props.shading !== 'none' ? props.shading : undefined
	const fill = shading ?? background
	const markCss = runCss(ctx, paragraph.mark, line, fill)
	const blocks: HTMLElement[] = []
	let content!: HTMLElement
	const indent = props.indent ?? {}
	const hanging = indent.hanging ?? 0
	const past = reach(paragraph)

	const start = (breakBefore?: 'page' | 'column') => {
		const block = element(ctx, 'div')
		const first = blocks.length === 0
		block.style.paddingTop = px(first && near.groupStart ? near.spacing.before : 0)
		block.style.position = 'relative'
		const box = boxed(paragraph) ? element(ctx, 'div') : block
		if (box !== block) {
			block.append(box)
			registry.boxes.add(box)
		}
		// w:ind left is the start side, which is the right in a right-to-left paragraph
		box.style.marginInlineStart = px((indent.left ?? 0) - past.start)
		box.style.marginInlineEnd = px((indent.right ?? 0) - past.end)
		box.style.textIndent = first ? px(hanging ? -hanging : (indent.firstLine ?? 0)) : '0'
		box.style.textAlign = (
			{left: 'start', center: 'center', right: 'end', both: 'justify', distribute: 'justify'} as const
		)[props.align ?? 'left']
		if (props.align === 'distribute') box.style.textAlignLast = 'justify'
		box.style.whiteSpace = 'pre-wrap'
		box.style.overflowWrap = 'break-word'
		if (props.bidi) box.style.direction = 'rtl'
		if (ctx.settings.autoHyphenation && !props.suppressAutoHyphens) {
			box.style.hyphens = 'auto'
			const lang = paragraph.mark.lang ?? ctx.settings.languages.latin
			if (lang && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(lang)) box.lang = lang
		}
		// Exact and minimum spacing set every line's height through the strut; auto lines take their runs' heights
		if (line.rule === 'auto') {
			box.style.fontSize = '0'
			box.style.lineHeight = '0'
		} else {
			box.style.fontSize = markCss.fontSize
			box.style.fontFamily = markCss.fontFamily
			box.style.lineHeight = whole(line.height)
		}
		if (box !== block) {
			const borders = props.borders ?? {}
			const inner = !near.groupStart || !first
			// Inside a shared box the spacing between paragraphs is part of the box
			borderCss(
				box,
				'Top',
				near.groupStart && first ? borders.top : borders.between,
				inner && first ? near.spacing.before : 0,
			)
			// The text starts as far inside the box as the first line hangs
			borderCss(box, 'Left', borders.left, props.bidi ? 0 : hanging)
			borderCss(box, 'Right', borders.right, props.bidi ? hanging : 0)
			if (shading) box.style.backgroundColor = shading
		}
		if (breakBefore) registry.breaks.set(block, breakBefore)
		registry.fragment(paragraph, block)
		blocks.push(block)
		content = box
	}
	start()

	if (paragraph.numbering) content.append(renderLabel(paragraph, ctx, line, fill))

	let shown = false
	let lastBreak = false
	let link: {href?: string; node: HTMLElement} | undefined
	// What the paragraph holds as far as the break it ends with, where it ends with one: the empty runs past that
	// aren't rendered, so that nothing is typed into them and lands on the other side of the break from where it shows.
	// The document's last paragraph has its mark after the break all the same: the page the break begins is there
	// with nothing else on it, and that's where the document is typed on from.
	const ending = ctx.body && !near.last ? trailingBreak(paragraph, ctx.settings) : undefined
	const inlines = ending ? paragraph.inlines.slice(0, paragraph.inlines.indexOf(ending)) : paragraph.inlines
	// A mark ends each part of the paragraph: a page or column break's own, before the part that begins after it, and
	// the paragraph's. A mark sets the height of the line it's on, and holds a line where nothing else is on it: a
	// break that starts a paragraph has a line to itself on the page it ends, as in Word (on a page of its own, when
	// that page is full). That's where a caret is put to type before the break.
	const endMark = (css: Record<string, string>) => {
		const mark = element(ctx, 'span')
		applyCss(mark, css)
		if (!shown || lastBreak) mark.append(ctx.doc.createElement('br'))
		registry.marks.set(mark, paragraph)
		content.append(mark)
		return mark
	}
	for (const inline of inlines) {
		if (divides(inline) && ctx.body) {
			lock(endMark(runCss(ctx, inline.style, line, fill)))
			start(inline.type)
			shown = false
			lastBreak = false
			link = undefined
			continue
		}
		const node = renderInline(inline, paragraph, ctx, line, fill, content)
		if (!node) continue
		// A run whose text is empty (all of it deleted, say) shows nothing, and leaves the line to the mark
		if (inline.kind !== 'text' || inline.text) {
			shown ||= inline.kind !== 'anchor'
			lastBreak = inline.kind === 'break'
		}
		// Consecutive runs of one hyperlink share its anchor
		const target = 'link' in inline ? inline.link : undefined
		if (target?.href) {
			if (link?.href !== target.href) {
				const anchor = element(ctx, 'a')
				anchor.href = target.href
				anchor.target = '_blank'
				anchor.rel = 'noopener noreferrer'
				anchor.referrerPolicy = 'no-referrer'
				if (target.tooltip) anchor.title = target.tooltip
				anchor.style.color = 'inherit'
				anchor.style.textDecoration = 'inherit'
				content.append(anchor)
				link = {href: target.href, node: anchor}
			}
			link.node.append(node)
		} else {
			link = undefined
			content.append(node)
		}
	}

	// The paragraph's own mark. Where the paragraph has no text of its own yet, typing goes into it and becomes a new
	// run, before the break the paragraph ends its page with if it has one; otherwise the caret stays in the runs'
	// text. Nothing is typed into the mark of a paragraph that ends inside a field: it would become part of the
	// field's result.
	const mark = endMark(markCss)
	const at = ending?.run && ending.node ? ({run: ending.run, node: ending.node, side: 'before'} as const) : undefined
	const editable = ctx.editable && paragraph.editable && !paragraph.endsInField
	const takes = !inlines.some((inline) => inline.kind === 'text' && inline.ref) && (at || !ending)
	if (editable && takes) registry.register(mark, registry.insertion(paragraph, at))
	else lock(mark)
	if (ending) registry.breaksAfter.set(blocks[blocks.length - 1], ending.type)

	const last = blocks[blocks.length - 1]
	last.style.paddingBottom = px(near.groupEnd ? near.spacing.after : 0)
	if (last !== content && content.parentElement === last) {
		const bottom = near.groupEnd ? props.borders?.bottom : undefined
		borderCss(content, 'Bottom', bottom, near.groupEnd ? 0 : near.spacing.after)
	}
	if (paragraph.hidden) for (const block of blocks) block.style.display = 'none'
	return blocks
}

const labelText = (numbering: Numbered) => numbering.label + (numbering.suffix === 'space' ? ' ' : '')

function renderLabel(
	paragraph: Paragraph,
	ctx: RenderContext,
	line: LineSpacing,
	fill: string | undefined,
): HTMLElement {
	const numbering = paragraph.numbering!
	const label = island(ctx, undefined)
	const style = numbering.style
	// A bullet mapped out of a symbol font draws in the paragraph's own font
	const face = fontName(style.fontAscii, ctx.theme)
	const symbolic = face !== undefined && /^(symbol|wingdings.*|webdings)$/i.test(face)
	const css = runCss(ctx, style, line, fill, symbolic ? (runFace(paragraph.mark, ctx.theme) ?? 'Calibri') : undefined)
	applyCss(label, css)
	label.style.textIndent = '0'
	label.style.whiteSpace = 'pre'
	label.style.display = 'inline-block'
	const text = labelText(numbering)
	ctx.registry.labels.set(paragraph, label)
	if (numbering.align === 'left') label.textContent = text
	else {
		// Centred and right-aligned numbers hang from the number position instead of starting at it
		label.style.width = '0'
		const inner = element(ctx, 'span')
		inner.style.position = 'relative'
		inner.style.display = 'inline-block'
		inner.style.transform = numbering.align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)'
		inner.textContent = text
		label.append(inner)
		ctx.registry.labels.set(paragraph, inner)
	}
	if (numbering.suffix !== 'tab') return label
	const wrapper = island(ctx, undefined)
	wrapper.append(label, tabElement(ctx, undefined, paragraph, css))
	return wrapper
}

// A tab is a box standing on the baseline, as wide as layout makes it, with its leader as the border under it. The
// tab character is its text, at no size: that's what copying the text gives, and what a tab inside a w:t reads back
// as. It stays in the flow, neither positioned nor clipped: Chrome looks for the text composed after a tab from the
// text before it, and gives the composition up at a box it finds nothing in. A line of no height leaves the box's
// baseline at its top, so the box is raised by its own height.
//
// The lines under and through its run cross a tab, as they do in Word, where an underlined tab is the usual line to
// fill in. A browser draws them for text and not across a box, so render.css draws them, from what the tab is given
// here of how its run is set. They start where the box does: the box's first line is its own, and has none of the
// indent its paragraph's has.
function tabElement(
	ctx: RenderContext,
	inline: Inline | undefined,
	paragraph: Paragraph,
	css: Record<string, string>,
	ptab?: {align: 'left' | 'center' | 'right'},
) {
	const tab = island(ctx, inline)
	const height = `calc(${css.fontSize} * 0.7)`
	applyCss(tab, {
		display: 'inline-block',
		boxSizing: 'border-box',
		width: '0',
		height,
		verticalAlign: height,
		fontSize: '0',
		lineHeight: '0',
		textIndent: '0',
	})
	tab.textContent = '\t'
	if (css.textDecorationLine) {
		tab.classList.add('umbrel-docx-lined-tab')
		tab.style.setProperty('--docx-size', css.fontSize)
		applyCss(tab, {
			fontFamily: css.fontFamily,
			fontWeight: css.fontWeight,
			fontStyle: css.fontStyle,
			textDecorationLine: css.textDecorationLine,
			textDecorationStyle: css.textDecorationStyle,
			textDecorationThickness: css.textDecorationThickness ?? 'auto',
			textDecorationColor: css.textDecorationColor ?? css.color,
		})
	}
	const indent = paragraph.props.indent ?? {}
	ctx.registry.tabs.push({
		element: tab,
		stops: paragraph.props.tabs ?? [],
		indent: indent.left ?? 0,
		hanging: indent.hanging ?? 0,
		right: indent.right ?? 0,
		reach: reach(paragraph),
		cell: ctx.cell,
		ptab,
	})
	return tab
}

function renderInline(
	inline: Inline,
	paragraph: Paragraph,
	ctx: RenderContext,
	line: LineSpacing,
	fill: string | undefined,
	block: HTMLElement,
): HTMLElement | undefined {
	switch (inline.kind) {
		case 'text': {
			if (inline.math) ctx.approximated.add('equations')
			const editable = inline.ref && ctx.editable && paragraph.editable
			const span = editable ? element(ctx, 'span') : island(ctx, inline)
			applyCss(span, runCss(ctx, inline.style, line, fill, inline.font))
			span.textContent = inline.text
			if (editable) ctx.registry.register(span, inline.ref!)
			return span
		}
		case 'tab': {
			const tab = tabElement(ctx, inline, paragraph, runCss(ctx, inline.style, line, fill), inline.ptab)
			if (inline.ptab && inline.ptab.leader !== 'none') tab.dataset.leader = inline.ptab.leader
			if (inline.ref && ctx.editable && paragraph.editable) ctx.registry.register(tab, inline.ref)
			return tab
		}
		case 'break': {
			const node = island(ctx, inline)
			applyCss(node, runCss(ctx, inline.style, line, fill))
			const br = ctx.doc.createElement('br')
			if (inline.clear) br.style.clear = inline.clear
			node.append(br)
			return node
		}
		case 'graphic': {
			const node = objectNode(ctx, island(ctx, inline), inline.content)
			node.style.display = 'inline-block'
			node.style.verticalAlign = 'baseline'
			return node
		}
		case 'anchor':
			return renderAnchor(inline, ctx, block, paragraph.props.indent?.left ?? 0)
		case 'field': {
			const node = island(ctx, inline)
			applyCss(node, runCss(ctx, inline.style, line, fill))
			node.dataset.field = inline.field
			node.dataset.format = inline.format
			node.textContent = UNNUMBERED
			return node
		}
		case 'note': {
			const node = island(ctx, inline)
			applyCss(node, runCss(ctx, inline.style, line, fill))
			node.textContent = inline.label
			if (inline.footnote) ctx.registry.notes.push({element: node, id: inline.footnote})
			return node
		}
		case 'rule': {
			const node = island(ctx, inline)
			node.style.display = 'block'
			node.style.height = px(inline.height)
			node.style.width = `${inline.width * 100}%`
			node.style.backgroundColor = inline.color
			node.style.margin = inline.align === 'center' ? '0 auto' : inline.align === 'right' ? '0 0 0 auto' : '0'
			return node
		}
		case 'separator': {
			const node = island(ctx, inline)
			node.style.display = 'inline-block'
			node.style.width = inline.continuation ? '100%' : '33%'
			node.style.maxWidth = '192px'
			node.style.borderTop = '1px solid #000000'
			node.style.verticalAlign = 'middle'
			return node
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Floating objects

// The class of the node an object's box is in: render.css has a press go through it while the document is edited
const OBJECT = 'umbrel-docx-object'

// Puts an object's box in a node, on a line of the text or apart from it. The box is all the node holds: its
// paragraph's first line is indented or hangs, and the node's own would be too, moving the box by as much.
function objectNode(ctx: RenderContext, node: HTMLElement, content: Graphic): HTMLElement {
	node.classList.add(OBJECT)
	node.style.lineHeight = '0'
	node.style.textIndent = '0'
	node.append(renderGraphic(content, ctx))
	return node
}

// The box of an object that's placed from where it's anchored in a paragraph's text, given the island that stays in
// the line for it (see renderAnchor). Any other node has none.
export function anchored(node: Element): HTMLElement | undefined {
	const box = locked(node) ? node.firstElementChild : null
	return box?.classList.contains(OBJECT) ? (box as HTMLElement) : undefined
}

function renderAnchor(
	inline: Extract<Inline, {kind: 'anchor'}>,
	ctx: RenderContext,
	content: HTMLElement,
	indent: number,
): HTMLElement | undefined {
	const {object} = inline
	const {distance} = object
	const width = object.content.width
	if (object.wrap === 'none' && object.y.from !== 'paragraph' && object.y.from !== 'line') {
		// Positioned on the page: header and footer objects go to their layer now, body ones once layout knows the page
		const node = objectNode(ctx, island(ctx, inline), object.content)
		node.style.position = 'absolute'
		node.style.zIndex = object.behind ? '-1' : '1'
		if (ctx.layer) {
			const position = pagePosition(object, ctx.page, {
				left: ctx.page.margins.left,
				width: ctx.page.width - ctx.page.margins.left - ctx.page.margins.right,
			})
			node.style.left = px(position.left)
			node.style.top = px(position.top)
			ctx.layer.append(node)
			return undefined
		}
		ctx.registry.anchors.push({element: node, object, block: content})
		return undefined
	}
	// Placed from where it's anchored in the paragraph's text, the object is a box out of the line there, and Chrome
	// keeps no caret between such a box and another object: one put there is somewhere else by the next key, and
	// what's typed goes in there. So the box is held by an island that stays in the line, which a caret can be beside.
	const held = island(ctx, inline)
	const node = held.appendChild(objectNode(ctx, element(ctx, 'span'), object.content))
	// Horizontal offsets are from the column, which starts the paragraph's indent to the left of its content box;
	// absolute positions are taken from the paragraph's block, which carries the indent only when it is that box
	const fromColumn = (object.x.offset ?? 0) - (object.x.from === 'page' ? ctx.page.margins.left : 0)
	if (object.wrap === 'none') {
		node.style.position = 'absolute'
		node.style.zIndex = object.behind ? '-1' : '1'
		node.style.top = px(object.y.offset ?? 0)
		const origin = content.style.position === 'relative' ? indent : 0
		node.style.left = object.x.align === 'center' ? `calc(50% - ${px(width / 2)})` : px(fromColumn - origin)
		if (object.x.align === 'right') {
			node.style.left = 'auto'
			node.style.right = '0'
		}
		return held
	}
	node.style.display = 'block'
	if (object.wrap === 'topAndBottom') {
		node.style.width = px(width)
		const side =
			object.x.align === 'center' ? 'auto' : object.x.align === 'right' ? 'auto' : px(Math.max(0, fromColumn - indent))
		node.style.margin = `${px(distance.top)} ${object.x.align === 'center' ? 'auto' : '0'} ${px(distance.bottom)} ${side}`
		return held
	}
	// Square, tight and through wrapping float to the side the object sits on: CSS can't flow text around both sides
	const right =
		object.x.align === 'right' || object.x.align === 'outside' || (object.x.align === undefined && fromColumn > 0)
	node.style.cssFloat = right ? 'right' : 'left'
	ctx.registry.floating = true
	node.style.margin = `${px(distance.top)} ${px(right ? 0 : distance.right)} ${px(distance.bottom)} ${px(right ? distance.left : Math.max(0, fromColumn - indent))}`
	return held
}

// ---------------------------------------------------------------------------------------------------------------
// Graphics

function renderGraphic(content: Graphic, ctx: RenderContext): HTMLElement {
	const box = element(ctx, 'span')
	box.style.display = 'inline-block'
	box.style.position = 'relative'
	box.style.width = px(content.width)
	box.style.height = px(content.height)
	switch (content.kind) {
		case 'image': {
			// Formats the browser can't decode (EMF, WMF…) have no URL and show as an empty frame
			const url = ctx.images.get(content.part)
			if (!url) {
				ctx.approximated.add(content.object ? 'objects' : 'pictures')
				return placeholder(box)
			}
			const img = element(ctx, 'img')
			img.src = url
			img.alt = content.alt ?? ''
			img.draggable = false
			img.decoding = 'async'
			img.style.display = 'block'
			img.style.position = 'absolute'
			img.style.maxWidth = 'none'
			const crop = content.crop ?? {left: 0, top: 0, right: 0, bottom: 0}
			const width = content.width / (1 - crop.left - crop.right)
			const height = content.height / (1 - crop.top - crop.bottom)
			img.style.width = px(width)
			img.style.height = px(height)
			img.style.left = px(-crop.left * width)
			img.style.top = px(-crop.top * height)
			box.style.overflow = 'hidden'
			const transforms = [
				content.rotation ? `rotate(${content.rotation}deg)` : '',
				content.flipH ? 'scaleX(-1)' : '',
				content.flipV ? 'scaleY(-1)' : '',
			].filter(Boolean)
			if (transforms.length) {
				box.style.transform = transforms.join(' ')
				box.style.overflow = 'visible'
			}
			img.addEventListener(
				'error',
				() => {
					img.remove()
					placeholder(box)
				},
				{once: true},
			)
			box.append(img)
			return box
		}
		case 'shape': {
			if (content.geometry === 'line') {
				const angle = Math.atan2(content.height, content.width)
				const line = element(ctx, 'span')
				line.style.position = 'absolute'
				line.style.left = '0'
				line.style.top = '0'
				line.style.width = px(Math.hypot(content.width, content.height))
				line.style.borderTop = `${px(content.line?.width ?? 1)} ${content.line?.dashed ? 'dashed' : 'solid'} ${content.line?.color ?? '#000000'}`
				line.style.transformOrigin = '0 0'
				line.style.transform = `rotate(${angle}rad)`
				box.append(line)
				return box
			}
			if (content.fill) box.style.backgroundColor = content.fill
			if (content.opacity !== undefined) box.style.opacity = String(content.opacity)
			if (content.line)
				box.style.outline = `${px(content.line.width)} ${content.line.dashed ? 'dashed' : 'solid'} ${content.line.color}`
			if (content.line) box.style.outlineOffset = px(-content.line.width / 2)
			if (content.geometry === 'ellipse') box.style.borderRadius = '50%'
			if (content.geometry === 'roundRect')
				box.style.borderRadius = px(Math.min(content.width, content.height) * 0.1667)
			if (content.rotation) box.style.transform = `rotate(${content.rotation}deg)`
			if (content.blocks) {
				const inner = element(ctx, 'div')
				const insets = content.insets ?? {top: 0, right: 0, bottom: 0, left: 0}
				inner.style.position = 'absolute'
				inner.style.inset = '0'
				inner.style.padding = `${px(insets.top)} ${px(insets.right)} ${px(insets.bottom)} ${px(insets.left)}`
				inner.style.display = 'flex'
				inner.style.flexDirection = 'column'
				inner.style.justifyContent =
					content.anchor === 'center' ? 'center' : content.anchor === 'bottom' ? 'flex-end' : 'flex-start'
				inner.style.lineHeight = 'normal'
				inner.style.overflow = 'hidden'
				const column = element(ctx, 'div')
				const width = Math.max(0, content.width - insets.left - insets.right)
				for (const child of renderBlocks(
					content.blocks,
					{...ctx, editable: false, body: false, cell: false, width},
					content.fill,
				))
					column.append(child)
				inner.append(column)
				box.append(inner)
			}
			return box
		}
		case 'group': {
			for (const item of content.items) {
				const child = renderGraphic(item.content, ctx)
				child.style.position = 'absolute'
				child.style.left = px(item.x)
				child.style.top = px(item.y)
				box.append(child)
			}
			return box
		}
		case 'watermark': {
			const text = element(ctx, 'span')
			text.textContent = content.text
			text.style.position = 'absolute'
			text.style.left = '50%'
			text.style.top = '50%'
			text.style.whiteSpace = 'nowrap'
			text.style.fontFamily = fontStack([content.font ?? 'Calibri'])
			ctx.faces.add(`16px ${text.style.fontFamily}`)
			text.style.fontSize = px(Math.max(8, content.height * 0.9))
			text.style.lineHeight = '1'
			text.style.color = content.color
			text.style.opacity = String(content.opacity)
			text.style.transform = `translate(-50%, -50%) rotate(${content.rotation}deg)`
			box.append(text)
			box.style.pointerEvents = 'none'
			return box
		}
		case 'placeholder':
			ctx.approximated.add(content.of)
			return placeholder(box)
	}
}

function placeholder(box: HTMLElement): HTMLElement {
	box.style.display = 'inline-block'
	box.style.backgroundColor = '#f3f4f6'
	box.style.outline = '1px solid #e5e7eb'
	box.style.outlineOffset = '-1px'
	return box
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

function renderTable(table: Table, ctx: RenderContext): HTMLElement {
	const node = element(ctx, 'table')
	const props = table.props
	node.style.borderCollapse = props.cellSpacing ? 'separate' : 'collapse'
	if (props.cellSpacing) node.style.borderSpacing = px(props.cellSpacing * 2)
	node.style.tableLayout = 'fixed'
	const grid = gridOf(table, ctx.width)
	node.style.width = px(grid.reduce((sum, width) => sum + width, 0))
	node.style.marginLeft = px((props.indent ?? 0) - table.outdent)
	if (props.align === 'center') {
		node.style.marginLeft = 'auto'
		node.style.marginRight = 'auto'
	} else if (props.align === 'right') node.style.marginLeft = 'auto'
	if (props.bidi) node.style.direction = 'rtl'
	if (props.shading && props.shading !== 'none') node.style.backgroundColor = props.shading
	const columns = element(ctx, 'colgroup')
	for (const width of grid) {
		const col = element(ctx, 'col')
		col.style.width = px(width)
		columns.append(col)
	}
	node.append(columns)
	// Grid columns a row skips (w:gridBefore) need empty cells; those under a cell merged down from above don't
	const covered = table.rows.map(() => new Set<number>())
	table.rows.forEach((row, r) => {
		for (const cell of row.cells) {
			for (let below = r + 1; below < r + cell.rowSpan && below < covered.length; below++) {
				for (let c = cell.column; c < cell.column + cell.span; c++) covered[below].add(c)
			}
		}
	})
	const body = element(ctx, 'tbody')
	table.rows.forEach((row, r) => {
		const tr = element(ctx, 'tr')
		ctx.registry.rows.set(tr, row)
		if (row.props.height) tr.style.height = px(row.props.height)
		let column = 0
		const fill = (end: number) => {
			for (let c = column; c < end; c++) {
				if (covered[r].has(c)) continue
				let to = c + 1
				while (to < end && !covered[r].has(to)) to++
				const td = element(ctx, 'td')
				td.colSpan = to - c
				td.style.padding = '0'
				ctx.registry.columns.set(td, c)
				tr.append(td)
				c = to - 1
			}
		}
		for (const cell of row.cells) {
			fill(cell.column)
			const td = renderCell(cell, table, grid, row.props.heightRule === 'exact' ? row.props.height : undefined, ctx)
			ctx.registry.columns.set(td, cell.column)
			tr.append(td)
			column = cell.column + cell.span
		}
		body.append(tr)
	})
	node.append(body)
	return node
}

function renderCell(
	cell: Cell,
	table: Table,
	grid: number[],
	exactHeight: number | undefined,
	ctx: RenderContext,
): HTMLElement {
	const td = element(ctx, 'td')
	ctx.registry.cells.set(td, cell)
	td.colSpan = cell.span
	td.rowSpan = cell.rowSpan
	const width = grid.slice(cell.column, cell.column + cell.span).reduce((sum, w) => sum + w, 0)
	td.style.width = px(width)
	td.style.verticalAlign = cell.props.vAlign === 'center' ? 'middle' : (cell.props.vAlign ?? 'top')
	td.style.padding = `${px(cell.margins.top)} ${px(cell.margins.right)} ${px(cell.margins.bottom)} ${px(cell.margins.left)}`
	td.style.overflowWrap = 'break-word'
	const shading = cell.props.shading && cell.props.shading !== 'none' ? cell.props.shading : undefined
	if (shading) td.style.backgroundColor = shading
	for (const [side, border] of Object.entries(cell.borders) as Array<[keyof Cell['borders'], Border]>) {
		const name = (side.charAt(0).toUpperCase() + side.slice(1)) as 'Top'
		if (border.style === 'none') {
			td.style[`border${name}Style`] = 'none'
			continue
		}
		td.style[`border${name}Style`] = border.style
		td.style[`border${name}Width`] = px(border.width)
		td.style[`border${name}Color`] = border.color === 'auto' ? '#000000' : border.color
	}
	const content = element(ctx, 'div')
	if (exactHeight !== undefined) {
		content.style.maxHeight = px(Math.max(0, exactHeight - cell.margins.top - cell.margins.bottom))
		content.style.overflow = 'hidden'
	}
	if (cell.props.vertical) content.style.writingMode = 'vertical-rl'
	if (cell.props.noWrap) content.style.whiteSpace = 'nowrap'
	const inner = {...ctx, cell: true, width: Math.max(0, width - cell.margins.left - cell.margins.right)}
	for (const child of renderBlocks(
		cell.blocks,
		inner,
		shading ?? (table.props.shading !== 'none' ? table.props.shading : undefined),
	))
		content.append(child)
	td.append(content)
	return td
}

// Column widths: the grid as saved (Word's own layout of it), scaled when the table asks for a share of the space it's
// in; where a file has no grid, the table's width shared out evenly
export function gridOf(table: Table, available: number): number[] {
	const total = table.grid.reduce((sum, width) => sum + width, 0)
	const wanted = table.props.width
	const width =
		wanted?.type === 'pct'
			? wanted.value * available
			: wanted?.type === 'dxa' && wanted.value > 0
				? wanted.value
				: total || available
	if (!total || table.grid.some((column) => column === 0)) {
		const known = table.grid.filter((column) => column > 0)
		const rest = Math.max(0, width - known.reduce((sum, column) => sum + column, 0))
		const missing = table.grid.length - known.length
		return table.grid.map((column) =>
			column > 0 && known.length < table.grid.length ? column : missing ? rest / missing : column,
		)
	}
	return wanted?.type === 'pct' ? table.grid.map((column) => (column * width) / total) : table.grid
}

// ---------------------------------------------------------------------------------------------------------------

export function renderBlocks(blocks: Block[], ctx: RenderContext, background?: string): HTMLElement[] {
	if (ctx.editable) ctx.registry.containers.set(blocks, {ctx, background})
	return blocks.flatMap((_, index) => renderBlock(blocks, index, ctx, background))
}

function renderBlock(blocks: Block[], index: number, ctx: RenderContext, background?: string): HTMLElement[] {
	const block = blocks[index]
	if (block.kind === 'table') return [renderTable(block, {...ctx, body: false})]
	return renderAmong(block, blocks, index, ctx, background)
}

// A header's or footer's blocks, with its frames set apart from its text. Paragraphs that follow each other framed
// alike are in one frame, spaced and boxed among themselves, as the text's are with no frame between them. A frame
// placed from the text stays in it, ahead of the block that comes after it, and one placed on the page is with
// what's drawn over the page. Frames elsewhere stay among the paragraphs: the body's are cut into pages by how tall
// each is.
export function renderStory(blocks: Block[], ctx: RenderContext & {layer: HTMLElement}): HTMLElement[] {
	const text = blocks.filter((block) => !framed(block))
	const out: HTMLElement[] = []
	for (let index = 0, plain = 0; index < blocks.length; ) {
		const frame = framed(blocks[index])
		if (!frame) {
			out.push(...renderBlock(text, plain++, ctx))
			index++
			continue
		}
		let end = index + 1
		while (end < blocks.length && JSON.stringify(framed(blocks[end])) === JSON.stringify(frame)) end++
		const box = renderFrame(frame, ctx)
		box.append(...renderBlocks(blocks.slice(index, end), ctx))
		if (frame.y.from === 'text') out.push(box)
		else ctx.layer.append(box)
		index = end
	}
	return out
}

// The frame that sets a block apart. Text stops above a frame it isn't to run beside and goes on below it, which is
// where that frame's paragraphs are in the text without it.
function framed(block: Block): Frame | undefined {
	const frame = block.kind === 'paragraph' ? block.props.frame : undefined
	return frame && (frame.y.from !== 'text' || frame.wrap !== 'notBeside') ? frame : undefined
}

// The box that holds a frame's paragraphs, as wide as they are unless the frame has a width. One placed from the
// text stands at a side of the block after it, whose lines run beside it; or over that block, where it's centred or
// text runs under it. One placed on the page is put there, from the page's edges or its margins'.
function renderFrame(frame: Frame, ctx: RenderContext): HTMLElement {
	const {margins} = ctx.page
	const {x, y, distance} = frame
	const box = element(ctx, 'div')
	box.style.width = frame.width === undefined ? 'fit-content' : px(frame.width)
	if (frame.height !== undefined) box.style[frame.exact ? 'height' : 'minHeight'] = px(frame.height)
	const inText = y.from === 'text'
	// How far the sides it's placed from are inside those of what it's in: the page, or the text between the margins
	const [left, right] = [margins.left, margins.right].map(
		(margin) => (x.from === 'page' ? 0 : margin) - (inText ? margin : 0),
	)
	const along = x.align ? 0 : x.offset
	if (inText && frame.wrap === 'around' && x.align !== 'center') {
		const side = x.align === 'right' ? 'right' : 'left'
		box.style.cssFloat = side
		box.style.clear = side
		const sides = side === 'right' ? [distance.x, right] : [left + along, distance.x]
		box.style.margin = `${px(y.offset)} ${px(sides[1])} ${px(distance.y)} ${px(sides[0])}`
		return box
	}
	box.style.position = 'absolute'
	if (x.align === 'center') applyCss(box, {left: px(left), right: px(right), marginLeft: 'auto', marginRight: 'auto'})
	else if (x.align === 'right') box.style.right = px(right)
	else box.style.left = px(left + along)
	const [top, bottom] = [margins.top, margins.bottom].map((margin) => (y.from === 'page' ? 0 : margin))
	if (inText) box.style.marginTop = px(y.offset)
	else if (y.align === 'center') {
		applyCss(box, {top: px(top), bottom: px(bottom), marginTop: 'auto', marginBottom: 'auto'})
		box.style.height ||= 'fit-content'
	} else if (y.align === 'bottom') box.style.bottom = px(bottom)
	else box.style.top = px(top + (y.align ? 0 : y.offset))
	return box
}

function renderAmong(paragraph: Paragraph, blocks: Block[], index: number, ctx: RenderContext, background?: string) {
	const near = neighbourhood(blocks, index, ctx)
	if (ctx.editable) {
		ctx.registry.homes.set(paragraph, blocks)
		ctx.registry.near.set(paragraph, near)
	}
	return renderParagraph(paragraph, ctx, near, background)
}

// A paragraph an edit put among blocks that are already rendered, rendered as they were
export function renderInPlace(paragraph: Paragraph, blocks: Block[], registry: Registry): HTMLElement[] {
	const {ctx, background} = registry.containers.get(blocks)!
	return renderAmong(paragraph, blocks, blocks.indexOf(paragraph), ctx, background)
}

// Whether a paragraph would now be rendered with other spacing or borders than it was, because what it's beside changed
export function displaced(paragraph: Paragraph, registry: Registry): boolean {
	const blocks = registry.homes.get(paragraph)
	const was = registry.near.get(paragraph)
	if (!blocks || !was) return false
	const {ctx} = registry.containers.get(blocks)!
	return JSON.stringify(was) !== JSON.stringify(neighbourhood(blocks, blocks.indexOf(paragraph), ctx))
}

// Shows a list label that was counted again
export function relabel(paragraph: Paragraph, registry: Registry) {
	const label = registry.labels.get(paragraph)
	if (label && paragraph.numbering) label.textContent = labelText(paragraph.numbering)
}

// What a page number reads until the page it lands on is known: one of a typical width, to be laid out with
export const UNNUMBERED = '1'

// A page number as its section formats it
export function pageNumber(n: number, format: string): string {
	if (format === 'numberInDash') return `- ${n} -`
	return formatNumber(n, format || 'decimal')
}
