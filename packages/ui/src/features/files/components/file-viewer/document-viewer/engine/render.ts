// The model as DOM. Elements are built with createElement, textContent and style properties only, never markup, so
// nothing from the document can become a tag, a script or a stylesheet. Each paragraph is a block whose spacing is
// padding (Word adds the space after one paragraph to the space before the next; CSS margins would collapse them),
// laid out with no strut of its own so its lines are only as tall as the runs on them, as in Word.

import {fontStack} from '@/features/files/components/file-viewer/shared/fonts'
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'

import {lineRatio} from './fonts'
import {
	type Anchored,
	type Approximated,
	type Block,
	type Cell,
	type Graphic,
	type Inline,
	type Insertion,
	type Paragraph,
	type Row,
	type Slot,
	type Table,
} from './model'
import {formatNumber} from './numbering'
import {isDark, POINT, type Border, type RunProps, type TabStop, type Theme} from './props'
import {fontName, type Settings} from './styles'

export type LineSpacing = {rule: 'auto'; multiple: number} | {rule: 'exact' | 'atLeast'; height: number}

// What layout needs to place a tab once its paragraph is laid out
export type TabEntry = {
	element: HTMLElement
	block: HTMLElement
	stops: TabStop[]
	indent: number
	hanging: number
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
	// Paragraph blocks that begin on a new page or column because of an explicit break
	readonly breaks = new WeakMap<Element, 'page' | 'column'>()
	// The inner box of a paragraph with borders or shading, which holds its content inside the block that spaces it
	readonly boxes = new WeakSet<Element>()
	// Whether text wraps around an object somewhere: the blocks after it then depend on it
	floating = false

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

function lineHeight(
	ctx: Pick<RenderContext, 'stacks'>,
	stack: string,
	face: string | undefined,
	size: number,
	line: LineSpacing,
): string {
	if (line.rule === 'exact') return px(line.height)
	const multiple = line.rule === 'auto' ? line.multiple : 1
	return `calc(var(--docx-line-${stackIndex(ctx, stack)}, ${lineRatio(face)}) * ${px(size * multiple)})`
}

const UNDERLINE_STYLES = lookup<string>({double: 'double', wavyDouble: 'wavy', wave: 'wavy', wavyHeavy: 'wavy'})

// The CSS of a run as a record of style properties, cached per formatting, line spacing and background
export function runCss(
	ctx: Pick<RenderContext, 'theme' | 'stacks' | 'faces' | 'styles'>,
	props: RunProps,
	line: LineSpacing,
	background: string | undefined,
	font?: string,
): Record<string, string> {
	const key = `${line.rule}:${'multiple' in line ? line.multiple : line.height}:${background}:${font}`
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

export function lineSpacing(paragraph: Paragraph): LineSpacing {
	const {line, lineRule} = paragraph.props.spacing ?? {}
	if (line === undefined) return {rule: 'auto', multiple: 1}
	if (lineRule === 'exact' || lineRule === 'atLeast') return {rule: lineRule, height: line / 15}
	return {rule: 'auto', multiple: Math.min(Math.max(line / 240, 0.06), 132)}
}

function spacingOf(paragraph: Paragraph, first: boolean): Spacing {
	const spacing = paragraph.props.spacing ?? {}
	// Auto spacing is HTML's paragraph margin, dropped at the top of a cell; spacing in lines counts 12 pt lines
	const before = spacing.beforeAuto
		? first
			? 0
			: 14 * POINT
		: spacing.beforeLines !== undefined
			? spacing.beforeLines * 0.16
			: (spacing.before ?? 0)
	const after = spacing.afterAuto
		? 14 * POINT
		: spacing.afterLines !== undefined
			? spacing.afterLines * 0.16
			: (spacing.after ?? 0)
	return {before, after}
}

const sameBorders = (a: Paragraph, b: Paragraph) =>
	JSON.stringify([a.props.borders, a.props.shading, a.props.indent?.left, a.props.indent?.right]) ===
	JSON.stringify([b.props.borders, b.props.shading, b.props.indent?.left, b.props.indent?.right])

const boxed = (p: Paragraph) =>
	Boolean(
		(p.props.borders && Object.values(p.props.borders).some((b) => b && b.style !== 'none')) ||
		(p.props.shading && p.props.shading !== 'none'),
	)

type Neighbourhood = {spacing: Spacing; groupStart: boolean; groupEnd: boolean}

// Spacing and border grouping depend on neighbours: contextual spacing drops the space between paragraphs of one
// style, and consecutive paragraphs with the same borders share one box with the space between them inside it
function neighbourhoods(blocks: Block[]): Map<Paragraph, Neighbourhood> {
	const out = new Map<Paragraph, Neighbourhood>()
	const visible = blocks.filter((block) => block.kind === 'table' || !block.hidden)
	visible.forEach((block, i) => {
		if (block.kind !== 'paragraph') return
		const spacing = spacingOf(block, i === 0)
		const previous = visible[i - 1]
		const next = visible[i + 1]
		if (block.props.contextualSpacing) {
			if (previous?.kind === 'paragraph' && previous.styleId === block.styleId) spacing.before = 0
			if (next?.kind === 'paragraph' && next.styleId === block.styleId) spacing.after = 0
		}
		const grouped = (other: Block | undefined) =>
			other?.kind === 'paragraph' && boxed(block) && sameBorders(block, other)
		out.set(block, {spacing, groupStart: !grouped(previous), groupEnd: !grouped(next)})
	})
	return out
}

function borderCss(
	node: HTMLElement,
	side: 'Top' | 'Right' | 'Bottom' | 'Left',
	border: Border | undefined,
	padding = 0,
) {
	const style = node.style
	if (!border || border.style === 'none') return
	style[`border${side}Style`] = border.style
	style[`border${side}Width`] = px(border.width)
	style[`border${side}Color`] = border.color === 'auto' ? '#000000' : border.color
	style[`padding${side}`] = px(padding + border.space)
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
	const line = lineSpacing(paragraph)
	const shading = props.shading && props.shading !== 'none' ? props.shading : undefined
	const fill = shading ?? background
	const markCss = runCss(ctx, paragraph.mark, line, fill)
	const blocks: HTMLElement[] = []
	let content!: HTMLElement
	const indent = props.indent ?? {}
	const hanging = indent.hanging ?? 0

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
		box.style.marginInlineStart = px(indent.left ?? 0)
		box.style.marginInlineEnd = px(indent.right ?? 0)
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
			box.style.lineHeight = px(line.height)
		}
		if (box !== block) {
			const borders = props.borders ?? {}
			const inner = !near.groupStart || !first
			// Inside a shared box the spacing between paragraphs is part of the box
			if (inner && first) box.style.paddingTop = px(near.spacing.before)
			borderCss(
				box,
				'Top',
				near.groupStart && first ? borders.top : borders.between,
				inner && first ? near.spacing.before : 0,
			)
			borderCss(box, 'Left', borders.left)
			borderCss(box, 'Right', borders.right)
			if (shading) box.style.backgroundColor = shading
		}
		if (breakBefore) registry.breaks.set(block, breakBefore)
		registry.fragment(paragraph, block)
		blocks.push(block)
		content = box
	}
	start()

	if (paragraph.numbering) content.append(renderLabel(paragraph, ctx, line, fill, content))

	let shown = false
	let lastBreak = false
	let link: {href?: string; node: HTMLElement} | undefined
	for (const inline of paragraph.inlines) {
		if (inline.kind === 'break' && inline.type !== 'line' && ctx.body) {
			start(inline.type)
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

	// The paragraph mark: it sets the last line's height, and an empty line's. Where the paragraph has no text of its
	// own yet, typing goes into it and becomes a new run; otherwise the caret stays in the runs' text.
	const mark = element(ctx, 'span')
	applyCss(mark, markCss)
	if (!shown || lastBreak) mark.append(ctx.doc.createElement('br'))
	registry.marks.set(mark, paragraph)
	const editable = ctx.editable && paragraph.editable
	if (editable && !paragraph.inlines.some((inline) => inline.kind === 'text' && inline.ref))
		registry.register(mark, registry.insertion(paragraph))
	else lock(mark)
	content.append(mark)

	const last = blocks[blocks.length - 1]
	last.style.paddingBottom = px(near.groupEnd ? near.spacing.after : 0)
	if (last !== content && content.parentElement === last) {
		borderCss(content, 'Bottom', near.groupEnd ? paragraph.props.borders?.bottom : undefined)
		if (!near.groupEnd) content.style.paddingBottom = px(near.spacing.after)
	}
	if (paragraph.hidden) for (const block of blocks) block.style.display = 'none'
	return blocks
}

function renderLabel(
	paragraph: Paragraph,
	ctx: RenderContext,
	line: LineSpacing,
	fill: string | undefined,
	block: HTMLElement,
): HTMLElement {
	const numbering = paragraph.numbering!
	const label = island(ctx, undefined)
	const style = numbering.style
	// A bullet mapped out of a symbol font draws in the paragraph's own font
	const face = fontName(style.fontAscii, ctx.theme)
	const symbolic = face !== undefined && /^(symbol|wingdings.*|webdings)$/i.test(face)
	applyCss(
		label,
		runCss(ctx, style, line, fill, symbolic ? (runFace(paragraph.mark, ctx.theme) ?? 'Calibri') : undefined),
	)
	label.style.textIndent = '0'
	label.style.whiteSpace = 'pre'
	label.style.display = 'inline-block'
	const text = numbering.label + (numbering.suffix === 'space' ? ' ' : '')
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
	}
	if (numbering.suffix !== 'tab') return label
	const wrapper = island(ctx, undefined)
	wrapper.append(label, tabElement(ctx, undefined, paragraph, block))
	return wrapper
}

function tabElement(
	ctx: RenderContext,
	inline: Inline | undefined,
	paragraph: Paragraph,
	block: HTMLElement,
	ptab?: {align: 'left' | 'center' | 'right'},
) {
	const tab = island(ctx, inline)
	// An empty box sitting on the baseline, where a leader's dots go; the tab character inside, out of the flow, is
	// what copying the text gives (and what a tab inside a w:t reads back as)
	tab.style.display = 'inline-block'
	tab.style.position = 'relative'
	tab.style.width = '0'
	tab.style.height = '0.7em'
	const character = element(ctx, 'span')
	character.style.position = 'absolute'
	character.style.width = '0'
	character.style.overflow = 'hidden'
	character.textContent = '\t'
	tab.append(character)
	const indent = paragraph.props.indent ?? {}
	ctx.registry.tabs.push({
		element: tab,
		block,
		stops: paragraph.props.tabs ?? [],
		indent: indent.left ?? 0,
		hanging: indent.hanging ?? 0,
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
			const tab = tabElement(ctx, inline, paragraph, block, inline.ptab)
			applyCss(tab, {fontSize: runCss(ctx, inline.style, line, fill).fontSize})
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
			const node = island(ctx, inline)
			node.style.display = 'inline-block'
			node.style.verticalAlign = 'baseline'
			node.style.lineHeight = '0'
			node.append(renderGraphic(inline.content, ctx))
			return node
		}
		case 'anchor':
			return renderAnchor(inline, ctx, block, paragraph.props.indent?.left ?? 0)
		case 'field': {
			const node = island(ctx, inline)
			applyCss(node, runCss(ctx, inline.style, line, fill))
			node.dataset.field = inline.field
			node.dataset.format = inline.format
			// Laid out with a typical width until the page it lands on is known
			node.textContent = '1'
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

function renderAnchor(
	inline: Extract<Inline, {kind: 'anchor'}>,
	ctx: RenderContext,
	content: HTMLElement,
	indent: number,
): HTMLElement | undefined {
	const {object} = inline
	const node = island(ctx, inline)
	node.style.lineHeight = '0'
	node.append(renderGraphic(object.content, ctx))
	const {distance} = object
	const width = object.content.width
	if (object.wrap === 'none' && object.y.from !== 'paragraph' && object.y.from !== 'line') {
		// Positioned on the page: header and footer objects go to their layer now, body ones once layout knows the page
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
		return node
	}
	node.style.display = 'block'
	if (object.wrap === 'topAndBottom') {
		node.style.width = px(width)
		const side =
			object.x.align === 'center' ? 'auto' : object.x.align === 'right' ? 'auto' : px(Math.max(0, fromColumn - indent))
		node.style.margin = `${px(distance.top)} ${object.x.align === 'center' ? 'auto' : '0'} ${px(distance.bottom)} ${side}`
		return node
	}
	// Square, tight and through wrapping float to the side the object sits on: CSS can't flow text around both sides
	const right =
		object.x.align === 'right' || object.x.align === 'outside' || (object.x.align === undefined && fromColumn > 0)
	node.style.cssFloat = right ? 'right' : 'left'
	ctx.registry.floating = true
	node.style.margin = `${px(distance.top)} ${px(right ? 0 : distance.right)} ${px(distance.bottom)} ${px(right ? distance.left : Math.max(0, fromColumn - indent))}`
	return node
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
				for (const child of renderBlocks(content.blocks, {...ctx, editable: false, body: false, width}, content.fill))
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
	const inner = {...ctx, width: Math.max(0, width - cell.margins.left - cell.margins.right)}
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
	const near = neighbourhoods(blocks)
	const out: HTMLElement[] = []
	for (const block of blocks) {
		if (block.kind === 'table') out.push(renderTable(block, {...ctx, body: false}))
		else
			out.push(
				...renderParagraph(
					block,
					ctx,
					near.get(block) ?? {spacing: {before: 0, after: 0}, groupStart: true, groupEnd: true},
					background,
				),
			)
	}
	return out
}

// A page number as its section formats it
export function pageNumber(n: number, format: string): string {
	if (format === 'numberInDash') return `- ${n} -`
	return formatNumber(n, format || 'decimal')
}
