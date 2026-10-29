// Draws a slide model as DOM: absolutely positioned boxes, inline SVG for outlines and fills, and real text that the
// browser lays out (and the user can select, find and edit). Nothing is built from markup strings: elements come
// from createElement, styles from style properties, and the only URLs are blob: URLs we made for the deck's own
// pictures, so a hostile document can't inject markup, script or network requests.

import {pathData} from '@/features/files/components/file-viewer/slides-viewer/engine/geometry'
import type {
	Box,
	FrameElement,
	GroupElement,
	Line,
	LineEnd,
	Paint,
	Paragraph,
	RunStyle,
	Shadow,
	ShapeElement,
	SlideElement,
	SlideModel,
	TableElement,
	TextBody,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import {MAX_PART, type Package} from '@/features/files/components/file-viewer/slides-viewer/engine/package'

const SVG = 'http://www.w3.org/2000/svg'

// The rendered text the editor works with: each editable paragraph's element, its runs' elements in order, for
// each run how many fixed pieces (bullet, fields, breaks) come before it in the paragraph, and how many come before
// the paragraph's own text (its bullet)
export type RenderedParagraph = {
	key: number
	element: HTMLElement
	runs: HTMLElement[]
	stretches: number[]
	offset: number
}
export type RenderedSlide = {bodies: Array<{element: HTMLElement; paragraphs: RenderedParagraph[]}>}
export const rendered = new WeakMap<HTMLElement, RenderedSlide>()
// Bullets, field results, line breaks and spacers: in the text flow but never part of what was typed
export const fixed = new WeakSet<Node>()

// Text typed into a paragraph and not yet saved, by paragraph key: each run's text, then a new run's text for each
// stretch between its fields and breaks
export type Overlay = (key: number) => readonly string[] | undefined

type Context = {images: Images; overlay: Overlay; slide: RenderedSlide}

// SVG ids are document-wide, so every rendered slide gets fresh ones
let nextId = 0
const id = () => `pptx-${(nextId++).toString(36)}`

export function renderSlide(
	model: SlideModel,
	size: {width: number; height: number},
	images: Images,
	overlay: Overlay,
): HTMLElement {
	const root = document.createElement('div')
	const style = root.style
	style.position = 'relative'
	style.width = `${size.width}px`
	style.height = `${size.height}px`
	style.overflow = 'hidden'
	style.contain = 'layout paint'
	style.isolation = 'isolate'
	// The slide sets every inherited text property, so nothing leaks in from the page around it
	Object.assign(style, {
		color: '#000000',
		fontSize: '24px',
		fontFamily: 'sans-serif',
		fontWeight: '400',
		fontStyle: 'normal',
		lineHeight: 'normal',
		letterSpacing: 'normal',
		wordSpacing: 'normal',
		textAlign: 'left',
		textIndent: '0',
		textTransform: 'none',
		textShadow: 'none',
		whiteSpace: 'normal',
		direction: 'ltr',
	})
	const background = model.background ?? {kind: 'solid', color: '#ffffff'}
	if (background.kind === 'solid') style.backgroundColor = background.color
	else root.append(paintLayer(background, {x: 0, y: 0, w: size.width, h: size.height}, images))

	const context: Context = {images, overlay, slide: {bodies: []}}
	for (const element of model.elements) root.append(renderElement(element, context, false))
	rendered.set(root, context.slide)
	return root
}

function renderElement(element: SlideElement, context: Context, mirrored: boolean): HTMLElement {
	const node = document.createElement('div')
	place(node, element)
	const flipped = mirrored !== (element.flipH !== element.flipV)
	if (element.kind === 'group') renderGroup(node, element, context, flipped)
	else if (element.kind === 'shape') renderShape(node, element, context, flipped)
	else if (element.kind === 'table') renderTable(node, element, context)
	else renderFrame(node, element)
	return node
}

function place(node: HTMLElement, element: SlideElement) {
	const {box} = element
	Object.assign(node.style, {
		position: 'absolute',
		left: `${box.x}px`,
		top: `${box.y}px`,
		width: `${box.w}px`,
		height: `${box.h}px`,
	})
	const transforms: string[] = []
	if (element.rotation) transforms.push(`rotate(${element.rotation}deg)`)
	if (element.flipH || element.flipV) transforms.push(`scale(${element.flipH ? -1 : 1}, ${element.flipV ? -1 : 1})`)
	if (transforms.length) node.style.transform = transforms.join(' ')
	if ('shadow' in element && element.shadow) node.style.filter = dropShadow(element.shadow, element)
}

// A drop shadow falls the same way whatever the shape's rotation unless it rotates with the shape, so its offset
// is turned back into the element's own frame before the element's transform turns it again
function dropShadow(shadow: Shadow, element: SlideElement) {
	let {dx, dy} = shadow
	if (!shadow.rotateWithShape) {
		const angle = (-element.rotation * Math.PI) / 180
		;[dx, dy] = [dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)]
		if (element.flipH) dx = -dx
		if (element.flipV) dy = -dy
	}
	return `drop-shadow(${round(dx)}px ${round(dy)}px ${round(shadow.blur)}px ${shadow.color})`
}

function renderGroup(node: HTMLElement, group: GroupElement, context: Context, mirrored: boolean) {
	for (const child of group.children) node.append(renderElement(child, context, mirrored))
}

function renderShape(node: HTMLElement, shape: ShapeElement, context: Context, mirrored: boolean) {
	if (shape.fill || shape.line || shape.picture || shape.media) node.append(shapeSvg(shape, context))
	if (shape.text) node.append(renderText(shape.text, context, mirrored))
}

function shapeSvg(shape: ShapeElement, context: Context): SVGSVGElement {
	const {w, h} = shape.box
	const line = shape.line
	const ends =
		line && (line.head || line.tail)
			? 3 * Math.max(line.head?.width ?? 0, line.tail?.width ?? 0, line.head?.length ?? 0, line.tail?.length ?? 0)
			: 0
	// The drawing area overhangs the box by whatever strokes and arrowheads can reach, and never collapses to
	// nothing (a straight line has no height, and SVG won't draw into an empty viewport)
	const margin = Math.ceil((line ? line.width * (0.5 + ends) : 0) + 2)
	const svg = svgElement('svg', {
		width: w + 2 * margin,
		height: h + 2 * margin,
		viewBox: `${-margin} ${-margin} ${w + 2 * margin} ${h + 2 * margin}`,
	})
	Object.assign(svg.style, {position: 'absolute', left: `${-margin}px`, top: `${-margin}px`, overflow: 'visible'})
	const defs = svgElement('defs', {})
	svg.append(defs)
	const box = {x: 0, y: 0, w, h}
	const fillable = shape.paths.filter((path) => path.fill !== 'none')

	// Fill, then the picture, then the outline, as PowerPoint layers them
	if (shape.fill) {
		const paint = paintValue(shape.fill, box, defs, context.images)
		for (const path of fillable) {
			svg.append(svgElement('path', {d: pathData(path), fill: paint, stroke: 'none'}))
			const shade = SHADES.get(path.fill)
			if (shade) svg.append(svgElement('path', {d: pathData(path), fill: shade, stroke: 'none'}))
		}
	}
	if (shape.picture && fillable.length) {
		const d = fillable.map(pathData).join('')
		svg.append(svgElement('path', {d, fill: paintValue(shape.picture, box, defs, context.images), stroke: 'none'}))
	}
	if (line) {
		const paint = paintValue(line.paint, box, defs, context.images)
		for (const path of shape.paths) {
			if (!path.stroke) continue
			const element = svgElement('path', {d: pathData(path), fill: 'none', stroke: paint, ...strokeAttributes(line)})
			if (!path.closed) arrowheads(element, line, defs)
			svg.append(element)
		}
	}
	if (shape.media) svg.append(playBadge(w, h))
	return svg
}

// lighten/darken paths (the top of a can, the side of a cube) shade whatever fill the shape has
const SHADES = new Map([
	['darken', 'rgba(0, 0, 0, 0.4)'],
	['darkenLess', 'rgba(0, 0, 0, 0.2)'],
	['lighten', 'rgba(255, 255, 255, 0.4)'],
	['lightenLess', 'rgba(255, 255, 255, 0.2)'],
])

function strokeAttributes(line: Line): Record<string, string | number> {
	return {
		'stroke-width': round(line.width),
		'stroke-linecap': line.cap,
		'stroke-linejoin': line.join,
		'stroke-miterlimit': 8,
		...(line.dash ? {'stroke-dasharray': line.dash.map((d) => round(d * line.width)).join(' ')} : {}),
	}
}

// Arrowheads are markers sized in line widths, so they scale with the stroke like PowerPoint's
function arrowheads(path: SVGElement, line: Line, defs: SVGElement) {
	const color =
		line.paint.kind === 'solid' ? line.paint.color : line.paint.kind === 'image' ? '#000000' : line.paint.stops[0].color
	if (line.head) path.setAttribute('marker-start', `url(#${marker(line.head, color, defs)})`)
	if (line.tail) path.setAttribute('marker-end', `url(#${marker(line.tail, color, defs)})`)
}

function marker(end: LineEnd, color: string, defs: SVGElement): string {
	const name = id()
	const {length: l, width: w} = end
	const element = svgElement('marker', {
		id: name,
		viewBox: `-1 -1 ${l + 2} ${w + 2}`,
		markerWidth: l + 2,
		markerHeight: w + 2,
		markerUnits: 'strokeWidth',
		refX: end.type === 'diamond' || end.type === 'oval' ? l / 2 : l,
		refY: w / 2,
		orient: 'auto-start-reverse',
	})
	const shapes: Record<LineEnd['type'], () => SVGElement> = {
		triangle: () => svgElement('path', {d: `M0 0L${l} ${w / 2}L0 ${w}Z`, fill: color}),
		stealth: () => svgElement('path', {d: `M0 0L${l} ${w / 2}L0 ${w}L${l * 0.3} ${w / 2}Z`, fill: color}),
		diamond: () => svgElement('path', {d: `M0 ${w / 2}L${l / 2} 0L${l} ${w / 2}L${l / 2} ${w}Z`, fill: color}),
		oval: () => svgElement('ellipse', {cx: l / 2, cy: w / 2, rx: l / 2, ry: w / 2, fill: color}),
		arrow: () =>
			svgElement('path', {
				d: `M0 0L${l} ${w / 2}L0 ${w}`,
				fill: 'none',
				stroke: color,
				'stroke-width': 1,
				'stroke-linejoin': 'miter',
			}),
	}
	element.append(shapes[end.type]())
	defs.append(element)
	return name
}

// A small, neutral play badge marks a video or audio poster: we show the frame, not the media
function playBadge(w: number, h: number): SVGElement {
	const r = Math.max(6, Math.min(28, Math.min(w, h) * 0.16))
	const g = svgElement('g', {transform: `translate(${round(w / 2)} ${round(h / 2)})`})
	g.append(
		svgElement('circle', {r, fill: 'rgba(0, 0, 0, 0.55)'}),
		svgElement('path', {d: `M${-r * 0.3} ${-r * 0.45}L${r * 0.5} 0L${-r * 0.3} ${r * 0.45}Z`, fill: '#ffffff'}),
	)
	return g
}

// An SVG paint for a fill: a colour, or a gradient or picture pattern laid out over `box`
function paintValue(paint: Paint, box: Box, defs: SVGElement, images: Images): string {
	if (paint.kind === 'solid') return paint.color
	const name = id()
	if (paint.kind === 'linear' || paint.kind === 'radial') {
		let gradient: SVGElement
		if (paint.kind === 'linear') {
			// A scaled angle is measured on a unit square stretched over the box
			let angle = (paint.angle * Math.PI) / 180
			if (paint.scaled) angle = Math.atan2(box.w * Math.sin(angle), box.h * Math.cos(angle))
			const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
			const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2
			const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2]
			gradient = svgElement('linearGradient', {
				id: name,
				gradientUnits: 'userSpaceOnUse',
				x1: round(cx - dx * half),
				y1: round(cy - dy * half),
				x2: round(cx + dx * half),
				y2: round(cy + dy * half),
			})
		} else {
			const cx = box.x + box.w * paint.center.x
			const cy = box.y + box.h * paint.center.y
			const r = Math.max(
				...[box.x, box.x + box.w].flatMap((x) => [box.y, box.y + box.h].map((y) => Math.hypot(x - cx, y - cy))),
			)
			gradient = svgElement('radialGradient', {
				id: name,
				gradientUnits: 'userSpaceOnUse',
				cx: round(cx),
				cy: round(cy),
				r: round(r) || 1,
			})
		}
		for (const stop of paint.stops) gradient.append(svgElement('stop', {offset: stop.at, 'stop-color': stop.color}))
		defs.append(gradient)
		return `url(#${name})`
	}
	// A stretched picture covers the box, trimmed by its crop; a tiled one repeats at its natural size
	const {crop} = paint
	const width = box.w / (1 - crop.l - crop.r || 1)
	const height = box.h / (1 - crop.t - crop.b || 1)
	const pattern = svgElement('pattern', {
		id: name,
		patternUnits: 'userSpaceOnUse',
		x: round(box.x),
		y: round(box.y),
		width: round(box.w) || 1,
		height: round(box.h) || 1,
	})
	const image = svgElement('image', {
		x: round(-crop.l * width),
		y: round(-crop.t * height),
		width: round(width),
		height: round(height),
		preserveAspectRatio: 'none',
		...(paint.opacity < 1 ? {opacity: paint.opacity} : {}),
	})
	if (paint.duotone || paint.grayscale) image.setAttribute('filter', `url(#${recolor(paint, defs)})`)
	pattern.append(image)
	defs.append(pattern)
	images.load(paint.part).then(async (url) => {
		if (!url) return
		image.setAttribute('href', url)
		const tile = paint.tile
		const size = tile && (await naturalSize(url))
		if (!tile || !size) return
		for (const node of [pattern, image]) {
			node.setAttribute('width', String(round(size.width * tile.scale.x)))
			node.setAttribute('height', String(round(size.height * tile.scale.y)))
		}
		image.setAttribute('x', '0')
		image.setAttribute('y', '0')
	})
	return `url(#${name})`
}

// Grayscale, then (for duotone) each channel stretched between the two colours
function recolor(paint: Extract<Paint, {kind: 'image'}>, defs: SVGElement): string {
	const name = id()
	const filter = svgElement('filter', {id: name, 'color-interpolation-filters': 'sRGB'})
	const luminance = '0.2126 0.7152 0.0722 0 0 '
	filter.append(svgElement('feColorMatrix', {type: 'matrix', values: `${luminance.repeat(3)}0 0 0 1 0`}))
	if (paint.duotone) {
		const [dark, light] = paint.duotone
		const transfer = svgElement('feComponentTransfer', {})
		;(['feFuncR', 'feFuncG', 'feFuncB'] as const).forEach((channel, i) =>
			transfer.append(svgElement(channel, {type: 'table', tableValues: `${round(dark[i])} ${round(light[i])}`})),
		)
		filter.append(transfer)
	}
	defs.append(filter)
	return name
}

// A full-size layer painting a background that isn't a flat colour
function paintLayer(paint: Paint, box: Box, images: Images): SVGSVGElement {
	const svg = svgElement('svg', {width: box.w, height: box.h})
	Object.assign(svg.style, {position: 'absolute', left: '0', top: '0'})
	const defs = svgElement('defs', {})
	svg.append(defs, svgElement('rect', {width: box.w, height: box.h, fill: paintValue(paint, box, defs, images)}))
	return svg
}

function renderTable(node: HTMLElement, table: TableElement, context: Context) {
	const width = table.columns.reduce((sum, size) => sum + size, 0)
	const height = table.rows.reduce((sum, size) => sum + size, 0)
	const svg = svgElement('svg', {width: width + 8, height: height + 8, viewBox: `-4 -4 ${width + 8} ${height + 8}`})
	Object.assign(svg.style, {position: 'absolute', left: '-4px', top: '-4px', overflow: 'visible'})
	const defs = svgElement('defs', {})
	svg.append(defs)
	const lines: SVGElement[] = []
	const texts: HTMLElement[] = []
	for (const cell of table.cells) {
		const {box} = cell
		if (cell.fill)
			svg.append(
				svgElement('rect', {
					x: box.x,
					y: box.y,
					width: box.w,
					height: box.h,
					fill: paintValue(cell.fill, box, defs, context.images),
				}),
			)
		const [l, t, r, b] = [box.x, box.y, box.x + box.w, box.y + box.h]
		const edges: Array<[Line | undefined, number, number, number, number]> = [
			[cell.borders.top, l, t, r, t],
			[cell.borders.bottom, l, b, r, b],
			[cell.borders.left, l, t, l, b],
			[cell.borders.right, r, t, r, b],
			[cell.borders.down, l, t, r, b],
			[cell.borders.up, l, b, r, t],
		]
		for (const [line, x1, y1, x2, y2] of edges) {
			if (!line) continue
			const paint = paintValue(line.paint, box, defs, context.images)
			lines.push(svgElement('line', {x1, y1, x2, y2, stroke: paint, ...strokeAttributes({...line, cap: 'square'})}))
		}
		texts.push(renderText(cell.text, context, false))
	}
	// Borders go over every fill, so a neighbour's background never hides a shared edge
	svg.append(...lines)
	node.append(svg, ...texts)
}

// A calm stand-in for content we don't draw: a faint frame in the slide's text colour, the chart's title where a
// chart's would be, and a simple bar glyph so it reads as a chart without words
function renderFrame(node: HTMLElement, frame: FrameElement) {
	const {w, h} = frame.box
	Object.assign(node.style, {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		boxSizing: 'border-box',
		padding: `${round(Math.min(w, h) * 0.05)}px`,
		overflow: 'hidden',
		color: frame.color,
	})
	const border = document.createElement('div')
	Object.assign(border.style, {
		position: 'absolute',
		inset: '0',
		border: `1px dashed ${frame.color}`,
		borderRadius: '4px',
		opacity: '0.35',
	})
	node.append(border)
	if (frame.label) {
		const label = document.createElement('div')
		Object.assign(label.style, {
			fontFamily: 'sans-serif',
			fontSize: `${round(Math.max(10, Math.min(28, h * 0.06)))}px`,
			fontWeight: '600',
			textAlign: 'center',
			opacity: '0.8',
		})
		label.textContent = frame.label
		node.append(label)
	}
	const size = Math.max(12, Math.min(64, Math.min(w, h) * 0.25))
	const glyph = svgElement('svg', {width: size, height: size, viewBox: '0 0 24 24'})
	Object.assign(glyph.style, {margin: 'auto', opacity: '0.3'})
	for (const [x, height] of [
		[3, 10],
		[10, 16],
		[17, 7],
	]) {
		glyph.append(svgElement('rect', {x, y: 21 - height, width: 4, height, rx: 1, fill: frame.color}))
	}
	node.append(glyph)
}

function renderText(text: TextBody, context: Context, mirrored: boolean): HTMLElement {
	const body = document.createElement('div')
	const {box, insets} = text
	const style = body.style
	Object.assign(style, {
		position: 'absolute',
		left: `${box.x + insets.l}px`,
		top: `${box.y + insets.t}px`,
		width: `${Math.max(0, box.w - insets.l - insets.r)}px`,
		height: `${Math.max(0, box.h - insets.t - insets.b)}px`,
		display: 'flex',
		flexDirection: 'column',
		justifyContent: text.anchor === 'middle' ? 'center' : text.anchor === 'bottom' ? 'flex-end' : 'flex-start',
	})
	const transforms: string[] = []
	// Flipping a shape never mirrors its text (a vertical flip turns it upside down instead), so an odd number of
	// reflections above is undone here
	if (mirrored) transforms.push('scaleX(-1)')
	if (text.rotation) transforms.push(`rotate(${text.rotation}deg)`)
	if (text.vertical) {
		style.writingMode = 'vertical-rl'
		style.textOrientation = text.vertical === 'eaVert' ? 'mixed' : text.vertical === 'stacked' ? 'upright' : 'sideways'
		if (text.vertical === 'vert270') transforms.push('rotate(180deg)')
	}
	if (transforms.length) style.transform = transforms.join(' ')

	let container: HTMLElement = body
	// Centred anchoring shrinks the text to its widest line and centres that block, paragraphs aligned within it
	if (text.anchorCenter) {
		style.alignItems = 'center'
		container = document.createElement('div')
		Object.assign(container.style, {width: 'fit-content', maxWidth: '100%'})
		body.append(container)
	}
	if (text.columns.count > 1) {
		const columns = document.createElement('div')
		Object.assign(columns.style, {
			columnCount: String(text.columns.count),
			columnGap: `${text.columns.gap}px`,
			columnFill: 'auto',
			height: '100%',
		})
		container.append(columns)
		container = columns
	}
	const paragraphs: RenderedParagraph[] = []
	text.paragraphs.forEach((paragraph, i) => {
		const element = renderParagraph(paragraph, i === 0, text.wrap, context, paragraphs)
		container.append(element)
	})
	if (paragraphs.length) context.slide.bodies.push({element: body, paragraphs})
	return body
}

function renderParagraph(
	paragraph: Paragraph,
	first: boolean,
	wrap: boolean,
	context: Context,
	registry: RenderedParagraph[],
): HTMLElement {
	const element = document.createElement('div')
	const style = element.style
	const sizes = paragraph.runs.filter((run) => run.kind !== 'break').map((run) => run.style.size)
	// The paragraph's own font sets each line's minimum height: the smallest run's, or the mark's when it's empty
	const strut = sizes.length ? Math.min(...sizes) : paragraph.end.size
	Object.assign(style, {
		margin: '0',
		// PowerPoint adds no space above a text box's first paragraph
		paddingTop: `${first ? 0 : paragraph.spaceBefore}px`,
		paddingBottom: `${paragraph.spaceAfter}px`,
		[paragraph.rtl ? 'paddingRight' : 'paddingLeft']: `${paragraph.marginLeft}px`,
		textIndent: `${paragraph.indent}px`,
		textAlign: paragraph.align === 'distributed' ? 'justify' : paragraph.align,
		// Distributed text spreads its last line too
		...(paragraph.align === 'distributed' ? {textAlignLast: 'justify'} : {}),
		direction: paragraph.rtl ? 'rtl' : 'ltr',
		lineHeight: 'px' in paragraph.lineHeight ? `${paragraph.lineHeight.px}px` : String(paragraph.lineHeight.multiple),
		tabSize: `${paragraph.tabSize}px`,
		whiteSpace: wrap ? 'pre-wrap' : 'pre',
		overflowWrap: wrap ? 'break-word' : 'normal',
		fontFamily: paragraph.end.family,
		fontSize: `${strut}px`,
	})
	// Unwrapped text runs past the box, centred on it or pinned to the side its alignment says
	if (!wrap) {
		style.width = 'max-content'
		style.alignSelf = paragraph.align === 'center' ? 'center' : paragraph.align === 'right' ? 'flex-end' : 'flex-start'
	}

	let fixedCount = 0
	if (paragraph.bullet) {
		fixedCount++
		const bullet = document.createElement('span')
		applyStyle(bullet, paragraph.bullet.style)
		Object.assign(bullet.style, {display: 'inline-block', textIndent: '0', whiteSpace: 'pre', userSelect: 'none'})
		if (paragraph.indent < 0) bullet.style.minWidth = `${-paragraph.indent}px`
		bullet.textContent = paragraph.bullet.text
		fixedNode(bullet)
		element.append(bullet)
	}

	const overlay = paragraph.key === undefined ? undefined : context.overlay(paragraph.key)
	const runs: HTMLElement[] = []
	const stretches: number[] = []
	const offset = fixedCount
	const count = paragraph.runs.filter((run) => run.kind === 'text').length
	let textIndex = 0
	let empty = true
	// Text typed into the stretch that ends here (with no run of its own): shown in the style of what ends it until
	// it's saved as a run there
	const typed = (style: RunStyle) => {
		const text = overlay?.[count + fixedCount - offset]
		if (!text) return false
		const span = document.createElement('span')
		applyStyle(span, style)
		span.textContent = text
		element.append(span)
		empty = false
		return true
	}
	for (const run of paragraph.runs) {
		if (run.kind !== 'text') typed(run.style)
		if (run.kind === 'break') {
			const br = document.createElement('br')
			fixed.add(br)
			fixedCount++
			element.append(br)
			continue
		}
		let node: HTMLElement
		if (run.kind === 'text' && run.href) {
			const link = document.createElement('a')
			link.href = run.href
			link.target = '_blank'
			link.rel = 'noopener noreferrer'
			node = link
		} else {
			node = document.createElement('span')
		}
		applyStyle(node, run.style)
		if (run.kind === 'field') {
			node.textContent = run.text
			fixedNode(node)
			fixedCount++
		} else {
			node.textContent = overlay?.[textIndex] ?? run.text
			runs.push(node)
			stretches.push(fixedCount)
			textIndex++
		}
		if (node.textContent) empty = false
		element.append(node)
	}
	const trailing = typed(paragraph.end)
	// An empty line (or one ending in a break with nothing typed after it) still has the height of its paragraph mark
	if (empty || (paragraph.runs.at(-1)?.kind === 'break' && !trailing)) {
		const spacer = document.createElement('br')
		fixed.add(spacer)
		element.append(spacer)
	}
	if (paragraph.key !== undefined) registry.push({key: paragraph.key, element, runs, stretches, offset})
	return element
}

function fixedNode(node: HTMLElement) {
	node.setAttribute('contenteditable', 'false')
	fixed.add(node)
}

function applyStyle(node: HTMLElement, run: RunStyle) {
	const style = node.style
	style.fontFamily = run.family
	// Superscript and subscript are drawn smaller and shifted, as PowerPoint does
	const size = run.baseline ? run.size * (2 / 3) : run.size
	style.fontSize = `${round(size)}px`
	if (run.baseline) style.verticalAlign = `${round(run.baseline * run.size)}px`
	style.fontWeight = run.bold ? '700' : '400'
	style.fontStyle = run.italic ? 'italic' : 'normal'
	const lines = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean)
	style.textDecorationLine = lines.length ? lines.join(' ') : 'none'
	if (run.underline && run.underline !== 'solid') style.textDecorationStyle = run.underline
	else if (run.strike === 'double') style.textDecorationStyle = 'double'
	if (run.caps === 'all') style.textTransform = 'uppercase'
	if (run.caps === 'small') style.fontVariantCaps = 'small-caps'
	if (run.spacing) style.letterSpacing = `${round(run.spacing)}px`
	style.color = run.color
	if (run.highlight) style.backgroundColor = run.highlight
	// Text decorations take the text's colour, never a link's default blue
	style.textDecorationColor = run.color
}

function svgElement<K extends keyof SVGElementTagNameMap>(
	name: K,
	attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const element = document.createElementNS(SVG, name)
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
	return element
}

const round = (value: number) => Math.round(value * 100) / 100

// Picture formats every browser draws. Safari also draws TIFF, so that's tried too and fails quietly elsewhere. SVG
// isn't one: as a blob: URL on our origin it would be a document that can run script, so it's left out like EMF.
export const PICTURE_TYPES = /^image\/(png|jpe?g|gif|bmp|webp|avif|x-icon|vnd\.microsoft\.icon)$/

// Pictures are read from the package only when a slide that shows them is drawn, and each becomes one blob: URL
// shared by every slide using it. Formats no browser decodes (EMF, WMF, PDF…) are skipped.
export class Images {
	private urls = new Map<string, Promise<string | undefined>>()
	private created: string[] = []
	private revoked = false

	constructor(private pkg: Package) {}

	load(part: string): Promise<string | undefined> {
		let url = this.urls.get(part)
		if (!url) {
			url = this.read(part).catch(() => undefined)
			this.urls.set(part, url)
		}
		return url
	}

	private async read(part: string): Promise<string | undefined> {
		const type = this.pkg.contentType(part)
		if (!(PICTURE_TYPES.test(type) || type === 'image/tiff') || this.pkg.size(part) > MAX_PART) return undefined
		const bytes = await this.pkg.archive.bytes(part)
		if (this.revoked) return undefined
		const url = URL.createObjectURL(new Blob([bytes], {type}))
		this.created.push(url)
		return url
	}

	revoke() {
		this.revoked = true
		for (const url of this.created) URL.revokeObjectURL(url)
		this.created = []
		this.urls.clear()
	}
}

// Only tiles need a picture's natural size, and only the browser knows it for every format
async function naturalSize(url: string): Promise<{width: number; height: number} | undefined> {
	const image = new Image()
	image.src = url
	try {
		await image.decode()
		return image.naturalWidth && image.naturalHeight
			? {width: image.naturalWidth, height: image.naturalHeight}
			: undefined
	} catch {
		return undefined
	}
}
