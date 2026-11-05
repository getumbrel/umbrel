// Slides. A slide inherits from its layout and the layout from its master: placeholders are matched to theirs for
// position, geometry, fills and text styles, and the layout's and master's own shapes are drawn beneath the
// slide's. Everything is resolved here into the render-ready model.

import {colorOf, schemeColor, toCss, type ColorContext} from '@/features/files/components/file-viewer/shared/color'
import {safeHref} from '@/features/files/components/file-viewer/shared/links'
import {
	attr,
	child,
	children,
	parseXml,
	textContent,
	tokenizeXml,
	type XmlElement,
} from '@/features/files/components/file-viewer/shared/xml'
import {
	EMU_PER_PX,
	fillOf,
	parseTheme,
	resolveFill,
	resolveLine,
	resolveShadow,
	styleEntry,
	styleLine,
	truthy,
	type FillContext,
	type Theme,
} from '@/features/files/components/file-viewer/slides-viewer/engine/drawing'
import {
	customGeometry,
	presetGeometry,
	trimPath,
	type Geometry,
} from '@/features/files/components/file-viewer/slides-viewer/engine/geometry'
import type {
	Box,
	EditableParagraph,
	GroupElement,
	Line,
	LineEnd,
	Paint,
	ShapeElement,
	SlideElement,
	SlideModel,
	TableCell,
	TableElement,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import type {Package} from '@/features/files/components/file-viewer/slides-viewer/engine/package'
import {
	buildText,
	type TextContext,
	type TextLevel,
} from '@/features/files/components/file-viewer/slides-viewer/engine/text'

// Shared across slides, parsed once
export type Deck = {
	pkg: Package
	defaultTextStyle?: XmlElement
	tableStyles: Map<string, XmlElement>
	masters: Map<string, Master>
	layouts: Map<string, Layout>
}

type Placeholders = {byIdx: Map<string, XmlElement>; byType: Map<string, XmlElement>}

type Master = {
	part: string
	root: XmlElement
	theme: Theme
	themePart?: string
	map: Record<string, string>
	styles: {title?: XmlElement; body?: XmlElement; other?: XmlElement}
	placeholders: Placeholders
}

type Layout = {part: string; root: XmlElement; master?: Master; placeholders: Placeholders}

// Where an element's coordinates map into its container: (emu - offset) * scale gives px
type Space = {ox: number; oy: number; sx: number; sy: number}

type Context = {
	deck: Deck
	part: string
	kind: 'slide' | 'layout' | 'master'
	theme: Theme
	colors: ColorContext
	master?: Master
	layout?: Layout
	space: Space
	slideNumber: number
	// The enclosing group's fill, for grpFill
	group?: Paint | null
	// The slide's own text, for editing
	editable?: {text: string; paragraphs: EditableParagraph[]}
	// What one slide may draw before the rest is dropped: hostile decks can hold millions of shapes
	budget: {elements: number}
}

const SLIDE_SPACE: Space = {ox: 0, oy: 0, sx: 1 / EMU_PER_PX, sy: 1 / EMU_PER_PX}
const MAX_ELEMENTS = 10000
const DEFAULT_MAP: Record<string, string> = {bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2'}

export function buildSlide(deck: Deck, part: string, slideNumber: number): SlideModel {
	const {pkg} = deck
	const root = pkg.xml(part)
	if (!root) return {elements: [], paragraphs: []}
	const layoutPart = pkg.related(part, 'slideLayout')
	const layout = layoutPart ? layoutOf(deck, layoutPart) : undefined
	const master = layout?.master
	const theme = master?.theme ?? parseTheme(undefined)
	// A slide or layout can override the master's colour map
	const map = colorMap(root) ?? (layout && colorMap(layout.root)) ?? master?.map ?? DEFAULT_MAP
	const colors: ColorContext = {scheme: theme.colors, map}
	const paragraphs: EditableParagraph[] = []
	const base = {deck, theme, colors, master, layout, space: SLIDE_SPACE, slideNumber, budget: {elements: MAX_ELEMENTS}}

	const elements: SlideElement[] = []
	const showMaster = (node: XmlElement) => attr(node, 'showMasterSp') !== '0' && attr(node, 'showMasterSp') !== 'false'
	if (showMaster(root)) {
		if (master && layout && showMaster(layout.root)) {
			elements.push(...spTree(master.root, {...base, part: master.part, kind: 'master'}))
		}
		if (layout) elements.push(...spTree(layout.root, {...base, part: layout.part, kind: 'layout'}))
	}
	const text = pkg.text(part) ?? ''
	elements.push(...spTree(root, {...base, part, kind: 'slide', editable: {text, paragraphs}}))

	// The first of slide, layout and master that has a background supplies it
	let background: Paint | undefined
	for (const source of [{root, part}, layout, master]) {
		background = source && backgroundOf(source.root, {...base, part: source.part, kind: 'slide'})
		if (background) break
	}
	return {...(background ? {background} : {}), elements, paragraphs}
}

function layoutOf(deck: Deck, part: string): Layout | undefined {
	let layout = deck.layouts.get(part)
	if (!layout) {
		const root = deck.pkg.xml(part)
		if (!root) return undefined
		const masterPart = deck.pkg.related(part, 'slideMaster')
		layout = {
			part,
			root,
			master: masterPart ? masterOf(deck, masterPart) : undefined,
			placeholders: placeholdersOf(root),
		}
		deck.layouts.set(part, layout)
	}
	return layout
}

function masterOf(deck: Deck, part: string): Master | undefined {
	let master = deck.masters.get(part)
	if (!master) {
		const root = deck.pkg.xml(part)
		if (!root) return undefined
		const themePart = deck.pkg.related(part, 'theme')
		const styles = child(root, 'txStyles')
		master = {
			part,
			root,
			theme: parseTheme(themePart ? deck.pkg.xml(themePart) : undefined),
			themePart,
			map: mapOf(child(root, 'clrMap')) ?? DEFAULT_MAP,
			styles: {
				title: styles && child(styles, 'titleStyle'),
				body: styles && child(styles, 'bodyStyle'),
				other: styles && child(styles, 'otherStyle'),
			},
			placeholders: placeholdersOf(root),
		}
		deck.masters.set(part, master)
	}
	return master
}

function colorMap(root: XmlElement) {
	const override = child(root, 'clrMapOvr')
	return override && mapOf(child(override, 'overrideClrMapping'))
}

function mapOf(node: XmlElement | undefined) {
	if (!node) return undefined
	return {...DEFAULT_MAP, ...node.attributes}
}

const cSld = (root: XmlElement) => child(root, 'cSld')

function spTree(root: XmlElement, context: Context): SlideElement[] {
	const sld = cSld(root)
	const tree = sld && child(sld, 'spTree')
	return tree ? elementsOf(tree, context) : []
}

function elementsOf(tree: XmlElement, context: Context): SlideElement[] {
	const elements: SlideElement[] = []
	for (const node of children(tree)) {
		if (context.budget.elements <= 0) break
		let element: SlideElement | undefined
		switch (node.local) {
			case 'sp':
			case 'cxnSp':
			case 'pic':
				element = shape(node, context)
				break
			case 'grpSp':
				element = group(node, context)
				break
			case 'graphicFrame':
				element = frame(node, context)
				break
		}
		if (element) {
			context.budget.elements--
			elements.push(element)
		}
	}
	return elements
}

type PlaceholderInfo = {type?: string; idx?: string}

function placeholderOf(node: XmlElement): PlaceholderInfo | undefined {
	const nv = children(node).find((n) => n.local.startsWith('nv'))
	const nvPr = nv && child(nv, 'nvPr')
	const ph = nvPr && child(nvPr, 'ph')
	return ph && {type: attr(ph, 'type'), idx: attr(ph, 'idx')}
}

function placeholdersOf(root: XmlElement): Placeholders {
	const byIdx = new Map<string, XmlElement>()
	const byType = new Map<string, XmlElement>()
	const sld = cSld(root)
	const tree = sld && child(sld, 'spTree')
	for (const node of tree ? children(tree) : []) {
		const ph = placeholderOf(node)
		if (!ph) continue
		if (ph.idx !== undefined && !byIdx.has(ph.idx)) byIdx.set(ph.idx, node)
		const type = ph.type ?? 'obj'
		if (!byType.has(type)) byType.set(type, node)
	}
	return {byIdx, byType}
}

// A slide placeholder matches its layout's by index when it has one, else by type; the layout's matches the
// master's by type, where the master's title and body stand in for every title and content kind
function ancestorsOf(ph: PlaceholderInfo, context: Context) {
	const {layout, master} = context
	let fromLayout: XmlElement | undefined
	if (layout) {
		if (ph.idx !== undefined) fromLayout = layout.placeholders.byIdx.get(ph.idx)
		if (!fromLayout && ph.type) {
			fromLayout = layout.placeholders.byType.get(ph.type) ?? layout.placeholders.byType.get(TITLES.get(ph.type) ?? '')
		}
	}
	const type = ph.type ?? (fromLayout && placeholderOf(fromLayout)?.type) ?? 'obj'
	const fromMaster = master?.placeholders.byType.get(MASTER_TYPES.get(type) ?? 'body')
	return {type, nodes: [fromLayout, fromMaster].filter((node) => node !== undefined)}
}

const TITLES = new Map([
	['title', 'ctrTitle'],
	['ctrTitle', 'title'],
])
const MASTER_TYPES = new Map([
	['title', 'title'],
	['ctrTitle', 'title'],
	['dt', 'dt'],
	['ftr', 'ftr'],
	['sldNum', 'sldNum'],
	['hdr', 'hdr'],
])

function placement(xfrm: XmlElement | undefined, space: Space) {
	const off = xfrm && child(xfrm, 'off')
	const ext = xfrm && child(xfrm, 'ext')
	const n = (node: XmlElement | undefined, name: string) => clampEmu(Number((node && attr(node, name)) ?? 0))
	const box: Box = {
		x: (n(off, 'x') - space.ox) * space.sx,
		y: (n(off, 'y') - space.oy) * space.sy,
		w: Math.max(0, n(ext, 'cx') * space.sx),
		h: Math.max(0, n(ext, 'cy') * space.sy),
	}
	return {
		box,
		rotation: Number((xfrm && attr(xfrm, 'rot')) ?? 0) / 60000 || 0,
		flipH: truthy(xfrm && attr(xfrm, 'flipH')),
		flipV: truthy(xfrm && attr(xfrm, 'flipV')),
	}
}

// Coordinates far outside any slide are hostile or broken; keep the arithmetic and the DOM sane
const clampEmu = (value: number) => (Number.isFinite(value) ? Math.max(-1e11, Math.min(1e11, value)) : 0)

// Pictures are named through the relationships of the part the reference sits in
function fillContext(context: Context, part = context.part): FillContext {
	const {pkg} = context.deck
	return {
		...context.colors,
		image: (id) => {
			const target = pkg.target(part, id)
			return target && pkg.has(target) ? target : undefined
		},
		group: context.group,
	}
}

function geometryOf(properties: XmlElement[], box: Box): Geometry {
	const w = box.w * EMU_PER_PX
	const h = box.h * EMU_PER_PX
	for (const spPr of properties) {
		const preset = child(spPr, 'prstGeom')
		if (preset) {
			const geometry = presetGeometry(attr(preset, 'prst') ?? '', w, h, child(preset, 'avLst'))
			if (geometry) return geometry
		}
		const custom = child(spPr, 'custGeom')
		if (custom) return customGeometry(custom, w, h)
	}
	return presetGeometry('rect', w, h)!
}

function shape(node: XmlElement, context: Context): ShapeElement | undefined {
	const ph = placeholderOf(node)
	// Masters and layouts show their placeholders only through the slides that fill them
	if (ph && context.kind !== 'slide') return undefined
	const ancestors = ph ? ancestorsOf(ph, context) : undefined
	const chain = [node, ...(ancestors?.nodes ?? [])]
	const properties = chain.map((n) => child(n, 'spPr')).filter((n) => n !== undefined)
	const xfrm = properties.map((spPr) => child(spPr, 'xfrm')).find(Boolean)
	if (!xfrm) return undefined
	const place = placement(xfrm, context.space)
	const geometry = geometryOf(properties, place.box)
	const fills = fillContext(context)
	const {theme} = context
	// Each level (the shape, then its layout and master placeholders) offers its own properties and then its
	// style's; a shape's own style outranks anything it inherits
	const levels = chain.map((n) => ({spPr: child(n, 'spPr'), style: child(n, 'style')}))

	let fill: Paint | null | undefined
	for (const level of levels) {
		fill = resolveFill(fillOf(level.spPr), fills)
		if (fill === undefined && level.style) fill = styleFill(child(level.style, 'fillRef'), context, fills)
		if (fill !== undefined) break
	}

	const line = resolveLine(
		levels.flatMap(({spPr, style}) => {
			const ln = spPr && child(spPr, 'ln')
			const styled = style && styleLine(theme, child(style, 'lnRef'), fills)
			return [...(ln ? [{ln, context: fills}] : []), ...(styled ? [styled] : [])]
		}),
	)
	// Lines stop inside pointed arrowheads, as PowerPoint draws them, rather than running through their tips
	const inset = (end: LineEnd | undefined) =>
		line && (end?.type === 'triangle' || end?.type === 'stealth') ? (end.length / end.width + 0.5) * line.width : 0
	const paths = geometry.paths.map((path) =>
		path.stroke ? trimPath(path, inset(line?.head), inset(line?.tail)) : path,
	)

	let shadow = undefined
	for (const level of levels) {
		const effects = level.spPr && child(level.spPr, 'effectLst')
		if (effects) {
			shadow = resolveShadow(effects, fills)
			break
		}
		const entry = level.style && styleEntry(theme.effects, child(level.style, 'effectRef'), fills)
		if (entry) {
			shadow = resolveShadow(child(entry.entry, 'effectLst'), entry.context)
			break
		}
	}

	let picture: Paint | undefined
	if (node.local === 'pic') {
		const blip = chain.map((n) => child(n, 'blipFill')).find(Boolean)
		picture = resolveFill(blip, fills) ?? undefined
	}

	const own = child(node, 'txBody')
	// An empty placeholder or an unfilled, unlined shape with no text draws nothing
	if (!own && !fill && !line && !picture) return undefined
	let text = undefined
	if (own) {
		const bodies = [own, ...(ancestors?.nodes ?? []).map((n) => child(n, 'txBody')).filter((n) => n !== undefined)]
		const box = diagramTextBox(node, place.box, context.space) ?? geometry.text
		text = buildText(bodies, box, textContext(context, ancestors, child(node, 'style'), fills))
	}
	return {
		kind: 'shape',
		...place,
		paths,
		...(fill ? {fill} : {}),
		...(picture ? {picture} : {}),
		...(line ? {line} : {}),
		...(shadow ? {shadow} : {}),
		...(text ? {text} : {}),
		...(node.local === 'pic' && isMedia(node) ? {media: true} : {}),
	}
}

// The levels a shape's text inherits from: each placeholder ancestor's list style and style font, then the master's
// text style for that kind of placeholder and the presentation's defaults. Text boxes and other plain shapes use
// the presentation's defaults before the master's, as PowerPoint does.
function textContext(
	context: Context,
	ancestors: ReturnType<typeof ancestorsOf> | undefined,
	style: XmlElement | undefined,
	fills: FillContext,
): TextContext {
	const {deck, master} = context
	const inherited: TextLevel[] = (ancestors?.nodes ?? []).map((n) => {
		const body = child(n, 'txBody')
		const nodeStyle = child(n, 'style')
		return {list: body && child(body, 'lstStyle'), font: nodeStyle && fontReference(child(nodeStyle, 'fontRef'))}
	})
	const type = ancestors?.type
	const outer = !type
		? [deck.defaultTextStyle, master?.styles.other]
		: type === 'title' || type === 'ctrTitle'
			? [master?.styles.title, deck.defaultTextStyle]
			: type === 'dt' || type === 'ftr' || type === 'sldNum' || type === 'hdr'
				? [master?.styles.other, deck.defaultTextStyle]
				: [master?.styles.body, deck.defaultTextStyle]
	return {
		theme: context.theme,
		colors: fills,
		font: style && fontReference(child(style, 'fontRef')),
		levels: [...inherited, ...outer.map((list) => ({list}))],
		slideNumber: context.slideNumber,
		link: (id) => hyperlink(context, id),
		editable: context.editable,
	}
}

// A style's font reference as run properties: the theme's major or minor font in the reference's colour
function fontReference(reference: XmlElement | undefined, color?: XmlElement): XmlElement | undefined {
	if (!reference && !color) return undefined
	const idx = reference && attr(reference, 'idx')
	const nodes: XmlElement[] = []
	if (idx === 'major' || idx === 'minor') {
		const prefix = idx === 'major' ? '+mj' : '+mn'
		for (const script of ['latin', 'ea', 'cs']) {
			nodes.push(element(script, {typeface: `${prefix}-${script === 'latin' ? 'lt' : script}`}, []))
		}
	}
	const colorNode = color ?? (reference && children(reference)[0])
	if (colorNode) nodes.push(element('solidFill', {}, [colorNode]))
	return element('defRPr', {}, nodes)
}

const element = (local: string, attributes: Record<string, string>, nodes: XmlElement[]): XmlElement => ({
	name: `a:${local}`,
	local,
	attributes,
	children: nodes,
	start: 0,
	end: 0,
	contentStart: 0,
	contentEnd: 0,
})

// Only web and mail links are followed; anything else (files, scripts, other slides) isn't a link here
function hyperlink(context: Context, id: string | undefined) {
	const rel = id === undefined ? undefined : context.deck.pkg.rels(context.part).get(id)
	return rel?.external ? safeHref(rel.target) : undefined
}

function isMedia(pic: XmlElement) {
	const nv = child(pic, 'nvPicPr')
	const nvPr = nv && child(nv, 'nvPr')
	if (!nvPr) return false
	if (children(nvPr).some((n) => /^(videoFile|audioFile|quickTimeFile|wavAudioFile|audioCd)$/.test(n.local)))
		return true
	const ext = child(nvPr, 'extLst')
	return !!ext && children(ext).some((e) => children(e).some((n) => n.local === 'media'))
}

function group(node: XmlElement, context: Context): GroupElement | undefined {
	const properties = child(node, 'grpSpPr')
	const xfrm = properties && child(properties, 'xfrm')
	const place = placement(xfrm, context.space)
	const chOff = xfrm && child(xfrm, 'chOff')
	const chExt = xfrm && child(xfrm, 'chExt')
	const n = (el: XmlElement | undefined, name: string) => clampEmu(Number((el && attr(el, name)) ?? 0))
	// Children are laid out in the group's child space, stretched over the group's extent
	const sx = n(chExt, 'cx') > 0 ? place.box.w / n(chExt, 'cx') : context.space.sx
	const sy = n(chExt, 'cy') > 0 ? place.box.h / n(chExt, 'cy') : context.space.sy
	const fills = fillContext(context)
	const fill = resolveFill(fillOf(properties), fills)
	const effects = properties && child(properties, 'effectLst')
	const shadow = effects && resolveShadow(effects, fills)
	const items = elementsOf(node, {
		...context,
		space: {ox: n(chOff, 'x'), oy: n(chOff, 'y'), sx, sy},
		group: fill === undefined ? context.group : fill,
	})
	if (!items.length) return undefined
	return {kind: 'group', ...place, children: items, ...(shadow ? {shadow} : {})}
}

function frame(node: XmlElement, context: Context): SlideElement | undefined {
	if (placeholderOf(node) && context.kind !== 'slide') return undefined
	const place = placement(child(node, 'xfrm'), context.space)
	const graphic = child(node, 'graphic')
	const data = graphic && child(graphic, 'graphicData')
	if (!data) return undefined
	const uri = attr(data, 'uri') ?? ''
	const tbl = child(data, 'tbl')
	if (tbl) return table(tbl, place, context)
	if (uri.endsWith('/chart')) {
		const chart = child(data, 'chart')
		const part = chart && context.deck.pkg.target(context.part, attr(chart, 'id'))
		const text = part && context.deck.pkg.text(part)
		return {kind: 'frame', ...place, ...labelOf(text ? chartTitle(text) : undefined), color: frameColor(context)}
	}
	if (uri.endsWith('/diagram'))
		return diagram(data, place, context) ?? {kind: 'frame', ...place, color: frameColor(context)}
	// OLE objects and other embeddings show the preview picture they carry
	const pic = children(data)
		.flatMap((n) => (n.local === 'pic' ? [n] : children(n, 'pic')))
		.at(0)
	return pic ? shape(pic, context) : undefined
}

const labelOf = (label: string | undefined) => (label ? {label} : {})

function frameColor(context: Context) {
	const color = schemeColor(context.colors, 'tx1')
	return color ? toCss(color) : '#000000'
}

// A chart's cached title, read without parsing the (possibly large) data that follows it
function chartTitle(text: string): string | undefined {
	let depth = 0
	let titleDepth = -1
	let collecting = false
	let deleted = false
	let title = ''
	try {
		tokenizeXml(text, (event) => {
			if (event.type === 'open') {
				const local = event.name.slice(event.name.indexOf(':') + 1)
				if (local === 'plotArea') return false
				if (local === 'autoTitleDeleted' && truthy(event.attributes.val ?? '1')) deleted = true
				if (local === 'title' && titleDepth < 0 && depth === 2) titleDepth = depth
				if (titleDepth >= 0 && (local === 't' || local === 'v')) collecting = !event.selfClosing
				if (titleDepth >= 0 && local === 'p' && title) title += '\n'
				if (!event.selfClosing) depth++
			} else if (event.type === 'close') {
				depth--
				collecting = false
				if (depth === titleDepth) return false
			} else if (collecting) {
				title += event.text
			}
		})
	} catch {
		return undefined
	}
	return deleted ? undefined : title.trim() || undefined
}

// SmartArt is drawn from the shapes PowerPoint saved alongside the diagram's data, laid out in the frame's space
function diagram(data: XmlElement, place: ReturnType<typeof placement>, context: Context): GroupElement | undefined {
	const {pkg} = context.deck
	const ids = child(data, 'relIds')
	const dataPart = ids && pkg.target(context.part, attr(ids, 'dm'))
	const dataText = dataPart && pkg.text(dataPart)
	let relId: string | undefined
	if (dataText) {
		try {
			tokenizeXml(dataText, (event) => {
				if (event.type === 'open' && event.name.endsWith('dataModelExt')) {
					relId = event.attributes.relId
					return false
				}
			})
		} catch {
			return undefined
		}
	}
	const drawingPart = pkg.target(context.part, relId)
	const drawing = drawingPart && pkg.xml(drawingPart)
	const tree = drawing && child(drawing, 'spTree')
	if (!tree) return undefined
	// Diagram text belongs to the diagram's data, which PowerPoint redraws from: it's shown, never edited
	const items = elementsOf(tree, {
		...context,
		part: drawingPart,
		editable: undefined,
		space: {...context.space, ox: 0, oy: 0},
	})
	return items.length ? {kind: 'group', ...place, children: items} : undefined
}

// SmartArt shapes keep their text in a separate rectangle (dsp:txXfrm), given in the diagram's space
function diagramTextBox(node: XmlElement, box: Box, space: Space): Box | undefined {
	const txXfrm = child(node, 'txXfrm')
	if (!txXfrm) return undefined
	const text = placement(txXfrm, space).box
	return {x: text.x - box.x, y: text.y - box.y, w: text.w, h: text.h}
}

function table(tbl: XmlElement, place: ReturnType<typeof placement>, context: Context): TableElement | undefined {
	const grid = child(tbl, 'tblGrid')
	const columns = (grid ? children(grid, 'gridCol') : []).map((col) =>
		Math.max(0, clampEmu(Number(attr(col, 'w') ?? 0)) * context.space.sx),
	)
	const rows = children(tbl, 'tr')
	if (!columns.length || !rows.length) return undefined
	const heights = rows.map((tr) => Math.max(0, clampEmu(Number(attr(tr, 'h') ?? 0)) * context.space.sy))
	const tblPr = child(tbl, 'tblPr')
	const flag = (name: string) => truthy(tblPr && attr(tblPr, name))
	const styleId = tblPr && child(tblPr, 'tableStyleId')
	const style = styleId && tableStyle(context.deck, textContent(styleId).trim())
	const fills = fillContext(context)
	const R = rows.length
	const C = columns.length
	const firstRow = flag('firstRow')
	const firstCol = flag('firstCol')

	const cells: TableCell[] = []
	rows.forEach((tr, r) => {
		children(tr, 'tc').forEach((tc, c) => {
			if (c >= C || truthy(attr(tc, 'hMerge')) || truthy(attr(tc, 'vMerge'))) return
			const colSpan = Math.max(1, Math.min(C - c, Math.floor(Number(attr(tc, 'gridSpan') ?? 1)) || 1))
			const rowSpan = Math.max(1, Math.min(R - r, Math.floor(Number(attr(tc, 'rowSpan') ?? 1)) || 1))
			// Table style parts from lowest to highest priority, each with the region whose edges it borders
			const parts: Array<[string, number, number, number, number]> = [['wholeTbl', 0, 0, R, C]]
			const bandRow = r - (firstRow ? 1 : 0)
			const bandCol = c - (firstCol ? 1 : 0)
			if (flag('bandCol') && bandCol >= 0) parts.push([bandCol % 2 ? 'band2V' : 'band1V', 0, c, R, c + 1])
			if (flag('bandRow') && bandRow >= 0) parts.push([bandRow % 2 ? 'band2H' : 'band1H', r, 0, r + 1, C])
			if (flag('lastCol') && c + colSpan === C) parts.push(['lastCol', 0, C - 1, R, C])
			if (firstCol && c === 0) parts.push(['firstCol', 0, 0, R, 1])
			if (firstRow && r === 0) parts.push(['firstRow', 0, 0, 1, C])
			if (flag('lastRow') && r + rowSpan === R) parts.push(['lastRow', R - 1, 0, R, C])
			const corner = (row: boolean, col: boolean, name: string) =>
				row && col && parts.push([name, r, c, r + rowSpan, c + colSpan])
			corner(flag('lastRow') && r + rowSpan === R, flag('lastCol') && c + colSpan === C, 'seCell')
			corner(flag('lastRow') && r + rowSpan === R, firstCol && c === 0, 'swCell')
			corner(firstRow && r === 0, flag('lastCol') && c + colSpan === C, 'neCell')
			corner(firstRow && r === 0, firstCol && c === 0, 'nwCell')

			const tcPr = child(tc, 'tcPr')
			const borders: TableCell['borders'] = {
				left: undefined,
				right: undefined,
				top: undefined,
				bottom: undefined,
				down: undefined,
				up: undefined,
			}
			let styledFill: Paint | null | undefined
			let bold: string | undefined
			let italic: string | undefined
			let font: XmlElement | undefined
			let color: XmlElement | undefined
			for (const [name, r0, c0, r1, c1] of parts) {
				const part = style && child(style, name)
				if (!part) continue
				const tcStyle = child(part, 'tcStyle')
				const partFill = tcStyle && cellStyleFill(tcStyle, context, fills)
				if (partFill !== undefined) styledFill = partFill
				const bdr = tcStyle && child(tcStyle, 'tcBdr')
				// A cell edge on the part's region boundary takes that side's border, an inner one the inside border
				const edges = {
					left: c === c0 ? 'left' : 'insideV',
					right: c + colSpan === c1 ? 'right' : 'insideV',
					top: r === r0 ? 'top' : 'insideH',
					bottom: r + rowSpan === r1 ? 'bottom' : 'insideH',
					down: 'tl2br',
					up: 'tr2bl',
				}
				for (const side of SIDES) {
					const node = bdr && child(bdr, edges[side])
					if (node) borders[side] = cellStyleLine(node, context, fills)
				}
				const tx = child(part, 'tcTxStyle')
				if (tx) {
					bold = attr(tx, 'b') ?? bold
					italic = attr(tx, 'i') ?? italic
					font = children(tx).find((n) => n.local === 'fontRef' || n.local === 'font') ?? font
					color = children(tx).find((n) => n.local !== 'fontRef' && n.local !== 'font' && n.local !== 'extLst') ?? color
				}
			}
			// The cell's own properties win over the style's
			for (const side of SIDES) {
				const ln = tcPr && child(tcPr, CELL_LINES[side])
				if (ln) borders[side] = resolveLine([{ln, context: fills}])
			}
			const ownFill = resolveFill(fillOf(tcPr), fills)
			const fill = ownFill !== undefined ? ownFill : styledFill

			const sum = (sizes: number[], from: number, to: number) =>
				sizes.slice(from, to).reduce((total, size) => total + size, 0)
			const box = {
				x: sum(columns, 0, c),
				y: sum(heights, 0, r),
				w: sum(columns, c, c + colSpan),
				h: sum(heights, r, r + rowSpan),
			}
			const txBody = child(tc, 'txBody')
			const textCtx = {
				...textContext(context, undefined, undefined, fills),
				font: tableTextStyle(bold, italic, font, color),
			}
			cells.push({
				row: r,
				col: c,
				box,
				...(fill ? {fill} : {}),
				borders,
				text: buildText(txBody ? [txBody] : [], box, textCtx, {tcPr}),
			})
		})
	})
	return {kind: 'table', ...place, columns, rows: heights, cells}
}

const SIDES = ['left', 'right', 'top', 'bottom', 'down', 'up'] as const
const CELL_LINES = {left: 'lnL', right: 'lnR', top: 'lnT', bottom: 'lnB', down: 'lnTlToBr', up: 'lnBlToTr'}

// The theme fill a fillRef points at: fill styles from 1, background fill styles from 1001
function styleFill(reference: XmlElement | undefined, context: Context, fills: FillContext): Paint | null | undefined {
	if (!reference) return undefined
	const index = Number(attr(reference, 'idx') ?? 0)
	// Index 0 is the style saying "no fill"
	if (index === 0) return null
	const {theme, master} = context
	// A theme's textures belong to the theme part
	const themed = master?.themePart ? {...fills, image: fillContext(context, master.themePart).image} : fills
	const entry =
		index >= 1001 ? styleEntry(theme.backgrounds, reference, themed, 1001) : styleEntry(theme.fills, reference, themed)
	return entry ? resolveFill(entry.entry, {...themed, ...entry.context}) : undefined
}

function cellStyleFill(tcStyle: XmlElement, context: Context, fills: FillContext): Paint | null | undefined {
	const fill = child(tcStyle, 'fill')
	return fill ? resolveFill(fillOf(fill), fills) : styleFill(child(tcStyle, 'fillRef'), context, fills)
}

function cellStyleLine(border: XmlElement, context: Context, fills: FillContext): Line | undefined {
	const ln = child(border, 'ln')
	if (ln) return resolveLine([{ln, context: fills}])
	const styled = styleLine(context.theme, child(border, 'lnRef'), fills)
	return styled && resolveLine([styled])
}

// A table style's text properties as run properties beneath the cell's own
function tableTextStyle(bold?: string, italic?: string, font?: XmlElement, color?: XmlElement): XmlElement {
	const attributes: Record<string, string> = {}
	if (bold !== undefined) attributes.b = bold === 'on' || truthy(bold) ? '1' : '0'
	if (italic !== undefined) attributes.i = italic === 'on' || truthy(italic) ? '1' : '0'
	const faces = font?.local === 'font' ? children(font) : []
	const base =
		font?.local === 'fontRef'
			? fontReference(font, color)!
			: element('defRPr', {}, [...faces, ...(color ? [element('solidFill', {}, [color])] : [])])
	return {...base, attributes}
}

// Office's default table look, Medium Style 2, which PowerPoint doesn't write into tableStyles.xml. The other
// built-in styles are only drawn when the file carries their definition.
const BUILT_IN = new Map([
	['{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}', 'dk1'],
	['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', 'accent1'],
	['{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}', 'accent2'],
	['{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', 'accent3'],
	['{00A15C55-8517-42AA-B614-E9B94910E393}', 'accent4'],
	['{7DF18680-E054-41AD-8BC1-D1AEF772440D}', 'accent5'],
	['{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', 'accent6'],
])

// Style ids are GUIDs, compared without case
function tableStyle(deck: Deck, id: string): XmlElement | undefined {
	const key = id.toUpperCase()
	const stored = deck.tableStyles.get(key)
	if (stored) return stored
	const accent = BUILT_IN.get(key)
	if (!accent) return undefined
	const style = parseXml(mediumStyle2(accent))
	deck.tableStyles.set(key, style)
	return style
}

function mediumStyle2(accent: string) {
	const line = (side: string, w = 12700) =>
		`<${side}><ln w="${w}"><solidFill><schemeClr val="lt1"/></solidFill></ln></${side}>`
	const fill = (tint?: number) =>
		`<fill><solidFill><schemeClr val="${accent}">${tint ? `<tint val="${tint}"/>` : ''}</schemeClr></solidFill></fill>`
	const header = (border = '') =>
		`<tcTxStyle b="on"><fontRef idx="minor"/><schemeClr val="lt1"/></tcTxStyle><tcStyle><tcBdr>${border}</tcBdr>${fill()}</tcStyle>`
	const band = `<tcStyle><tcBdr/>${fill(40000)}</tcStyle>`
	return (
		`<tblStyle><wholeTbl><tcTxStyle><fontRef idx="minor"/><schemeClr val="dk1"/></tcTxStyle><tcStyle><tcBdr>` +
		['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((side) => line(side)).join('') +
		`</tcBdr>${fill(20000)}</tcStyle></wholeTbl><band1H>${band}</band1H><band1V>${band}</band1V>` +
		`<lastCol>${header()}</lastCol><firstCol>${header()}</firstCol>` +
		`<lastRow>${header(line('top', 38100))}</lastRow><firstRow>${header(line('bottom', 38100))}</firstRow></tblStyle>`
	)
}

function backgroundOf(root: XmlElement, context: Context): Paint | undefined {
	const sld = cSld(root)
	const bg = sld && child(sld, 'bg')
	if (!bg) return undefined
	const fills = fillContext(context)
	const properties = child(bg, 'bgPr')
	if (properties) return resolveFill(fillOf(properties), fills) ?? {kind: 'solid', color: '#ffffff'}
	const reference = child(bg, 'bgRef')
	const styled = styleFill(reference, context, fills)
	if (styled !== undefined) return styled ?? undefined
	const color = colorOf(reference, fills)
	return color ? {kind: 'solid', color: toCss(color)} : undefined
}
