// Text bodies. Paragraph and run properties are inherited property by property through a chain of levels: the
// shape's own list style and style font, its layout and master placeholders' in the same order, then the master's
// text styles and the presentation defaults. Autofit scales stored by PowerPoint are applied, bullets and automatic
// numbering are worked out, and the slide's own paragraphs are recorded with their offsets for editing.

import {colorOf, schemeColor, toCss, type ColorContext} from '@/features/files/components/file-viewer/shared/color'
import {fontStack} from '@/features/files/components/file-viewer/shared/fonts'
import {attr, child, children, textContent, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'
import {
	EMU_PER_PX,
	fillOf,
	resolveFill,
	truthy,
	type FillContext,
	type Theme,
} from '@/features/files/components/file-viewer/slides-viewer/engine/drawing'
import type {
	Box,
	EditableParagraph,
	Paragraph,
	Run,
	RunStyle,
	TextBody,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import {alternates} from '@/features/files/components/file-viewer/slides-viewer/engine/package'

const PX_PER_POINT = 96 / 72
// PowerPoint's single line spacing is 1.2 times the font size
const SINGLE_LINE = 1.2

// A list style (lvl1pPr…lvl9pPr) and the run properties of a style's font reference, either optional
export type TextLevel = {list?: XmlElement; font?: XmlElement}

export type TextContext = {
	theme: Theme
	colors: FillContext
	// The shape's own style font (a p:style fontRef or a table style's text style, as run properties), then the
	// inherited levels in priority order
	font?: XmlElement
	levels: TextLevel[]
	slideNumber: number
	link: (id: string | undefined) => string | undefined
	// Set for the slide's own text: its source text and the list its editable paragraphs are added to
	editable?: {text: string; paragraphs: EditableParagraph[]}
}

// `bodies` is the shape's txBody followed by its placeholder ancestors', whose bodyPr it inherits. A table cell
// passes its tcPr (possibly missing) instead: cells take margins, anchoring and direction from there.
export function buildText(bodies: XmlElement[], box: Box, context: TextContext, cell?: {tcPr?: XmlElement}): TextBody {
	const [own] = bodies
	const props = bodies.map((body) => child(body, 'bodyPr')).filter((node) => node !== undefined)
	const prop = (name: string) => {
		for (const node of props) {
			const value = attr(node, name)
			if (value !== undefined) return value
		}
		return undefined
	}
	const autofit = props.map((node) => children(node).find((n) => /^(norm|sp|no)Autofit$/.test(n.local))).find(Boolean)
	const fontScale = autofit?.local === 'normAutofit' ? ratio(attr(autofit, 'fontScale'), 1) : 1
	const lineReduction = autofit?.local === 'normAutofit' ? ratio(attr(autofit, 'lnSpcReduction'), 0) : 0

	const tcPr = cell?.tcPr
	const cellProp = (name: string) => tcPr && attr(tcPr, name)
	const inset = (name: string, cellName: string, fallback: number) =>
		emu((cell ? cellProp(cellName) : prop(name)) ?? fallback)
	const anchor = (cell ? cellProp('anchor') : prop('anchor')) ?? 't'
	const vertical = VERTICAL.get((cell ? cellProp('vert') : prop('vert')) ?? 'horz')

	const levels = [{list: own && child(own, 'lstStyle'), font: context.font}, ...context.levels]
	const paragraphs: Paragraph[] = []
	const numbering: Array<{type: string; start: number; value: number} | undefined> = []
	for (const p of own ? children(own, 'p') : []) {
		const paragraph = buildParagraph(p, levels, context, fontScale, lineReduction)
		number(paragraph.paragraph, paragraph.autoNumber, paragraph.level, numbering)
		paragraphs.push(paragraph.paragraph)
	}
	return {
		box,
		insets: {
			l: inset('lIns', 'marL', 91440),
			t: inset('tIns', 'marT', 45720),
			r: inset('rIns', 'marR', 91440),
			b: inset('bIns', 'marB', 45720),
		},
		anchor: anchor === 'ctr' || anchor === 'dist' || anchor === 'just' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
		anchorCenter: !cell && truthy(prop('anchorCtr')),
		wrap: !!cell || prop('wrap') !== 'none',
		...(vertical ? {vertical} : {}),
		rotation: cell ? 0 : Number(prop('rot') ?? 0) / 60000 || 0,
		columns: {
			count: Math.max(1, Math.min(16, Math.floor(Number(prop('numCol') ?? 1)) || 1)),
			gap: emu(prop('spcCol') ?? 0),
		},
		paragraphs,
	}
}

const VERTICAL = new Map<string, TextBody['vertical']>([
	['vert', 'vert'],
	['vert270', 'vert270'],
	['eaVert', 'eaVert'],
	['mongolianVert', 'eaVert'],
	['wordArtVert', 'stacked'],
	['wordArtVertRtl', 'stacked'],
])

type AutoNumber = {type: string; start: number} | undefined

function buildParagraph(
	p: XmlElement,
	levels: TextLevel[],
	context: TextContext,
	fontScale: number,
	lineReduction: number,
) {
	const pPr = child(p, 'pPr')
	const level = Math.max(0, Math.min(8, Math.floor(Number((pPr && attr(pPr, 'lvl')) ?? 0)) || 0))
	const levelName = `lvl${level + 1}pPr`
	const props = (list: XmlElement | undefined) => (list ? [child(list, levelName), child(list, 'defPPr')] : [])
	const defined = <T>(nodes: Array<T | undefined>) => nodes.filter((node) => node !== undefined)
	const paragraphSources = defined([pPr, ...levels.flatMap(({list}) => props(list))])
	const runSources = defined([
		pPr && child(pPr, 'defRPr'),
		...levels.flatMap(({list, font}) => [...props(list).map((node) => node && child(node, 'defRPr')), font]),
	])

	const pick = (name: string) => first(paragraphSources, (node) => attr(node, name))
	const pickChild = (...names: string[]) =>
		first(paragraphSources, (node) => children(node).find((n) => names.includes(n.local)))
	const style = (rPr: XmlElement | undefined) => runStyle(rPr ? [rPr, ...runSources] : runSources, context, fontScale)

	const runs: Run[] = []
	// Text from a markup-compatibility fallback isn't what PowerPoint reads, so editing it would change nothing
	let editable = !!context.editable && !alternates.has(p) && !p.children.some((node) => alternates.has(node))
	const spliced: EditableParagraph['runs'] = []
	// The fields and line breaks, which end the paragraph's stretches of text
	const pieces: XmlElement[] = []
	for (const node of children(p)) {
		if (node.local === 'r') {
			const rPr = child(node, 'rPr')
			const t = child(node, 't')
			const link = rPr && child(rPr, 'hlinkClick')
			const href = link && context.link(attr(link, 'id'))
			const runStyleValue = style(rPr)
			if (href) Object.assign(runStyleValue, linkStyle(context))
			runs.push({kind: 'text', text: t ? textContent(t) : '', style: runStyleValue, ...(href ? {href} : {})})
			// A run without <a:t> has nowhere to put text
			if (!t) editable = false
			else spliced.push({...contentSplice(t), text: textContent(t)})
		} else if (node.local === 'br') {
			pieces.push(node)
			runs.push({kind: 'break', style: style(child(node, 'rPr'))})
		} else if (node.local === 'fld') {
			pieces.push(node)
			const t = child(node, 't')
			const text = attr(node, 'type') === 'slidenum' ? String(context.slideNumber) : t ? textContent(t) : ''
			runs.push({kind: 'field', text, style: style(child(node, 'rPr'))})
		}
	}
	const end = style(child(p, 'endParaRPr'))
	const firstText = runs.find((run) => run.kind === 'text' || run.kind === 'field')
	const base = firstText?.style ?? end

	let key: number | undefined
	if (editable && context.editable) {
		key = context.editable.paragraphs.length
		const source = context.editable.text
		context.editable.paragraphs.push({
			runs: spliced,
			gaps: [...pieces.map((piece) => pieceRunSplice(p, piece, source)), newRunSplice(p, source)],
		})
	}

	const spacing = (name: string) => {
		const node = pickChild(name)
		const pts = node && child(node, 'spcPts')
		if (pts) return (Number(attr(pts, 'val') ?? 0) / 100) * PX_PER_POINT || 0
		const pct = node && child(node, 'spcPct')
		return pct ? ratio(attr(pct, 'val'), 0) * SINGLE_LINE * base.size : 0
	}
	const lineNode = pickChild('lnSpc')
	const linePoints = lineNode && child(lineNode, 'spcPts')
	const linePercent = lineNode && child(lineNode, 'spcPct')
	const lineHeight: Paragraph['lineHeight'] = linePoints
		? {px: Math.max(1, (Number(attr(linePoints, 'val') ?? 0) / 100) * PX_PER_POINT || 0)}
		: {multiple: Math.max(0.1, (linePercent ? ratio(attr(linePercent, 'val'), 1) : 1) - lineReduction) * SINGLE_LINE}

	const hasText = runs.some((run) => run.kind !== 'break' && run.text !== '')
	const bulletType = hasText ? pickChild('buNone', 'buAutoNum', 'buChar', 'buBlip') : undefined
	let bullet: Paragraph['bullet']
	let autoNumber: AutoNumber
	if (bulletType && bulletType.local !== 'buNone') {
		const bulletStyle = bulletRunStyle(base, pickChild, context, fontScale)
		if (bulletType.local === 'buAutoNum') {
			autoNumber = {
				type: attr(bulletType, 'type') ?? 'arabicPeriod',
				start: Math.max(1, Number(attr(bulletType, 'startAt') ?? 1) || 1),
			}
			bullet = {text: '', style: bulletStyle}
		} else {
			const char = bulletType.local === 'buChar' ? (attr(bulletType, 'char') ?? '•') : '•'
			const symbol = symbolBullet(char, pickChild('buFontTx', 'buFont'))
			if (symbol) bulletStyle.family = base.family
			bullet = {text: symbol ?? char, style: bulletStyle}
		}
	}

	const align = pick('algn') ?? 'l'
	const paragraph: Paragraph = {
		align:
			align === 'ctr'
				? 'center'
				: align === 'r'
					? 'right'
					: align === 'just' || align === 'justLow'
						? 'justify'
						: align === 'dist' || align === 'thaiDist'
							? 'distributed'
							: 'left',
		rtl: truthy(pick('rtl')),
		marginLeft: emu(pick('marL') ?? 0),
		indent: emu(pick('indent') ?? 0),
		lineHeight,
		spaceBefore: spacing('spcBef'),
		spaceAfter: spacing('spcAft'),
		tabSize: emu(pick('defTabSz') ?? 914400) || 96,
		...(bullet ? {bullet} : {}),
		runs,
		end,
		...(key === undefined ? {} : {key}),
	}
	return {paragraph, autoNumber, level}
}

// Each property comes from the first source that sets it
function first<T>(sources: XmlElement[], read: (node: XmlElement) => T | undefined): T | undefined {
	for (const node of sources) {
		const value = read(node)
		if (value !== undefined) return value
	}
	return undefined
}

function runStyle(sources: XmlElement[], context: TextContext, fontScale: number): RunStyle {
	const pick = (name: string) => first(sources, (node) => attr(node, name))
	// An empty typeface says nothing; a theme reference can resolve to "no particular face"
	const face = (script: string) =>
		first(sources, (node) => {
			const font = child(node, script)
			const typeface = font && attr(font, 'typeface')
			return typeface ? themeFont(typeface, context.theme) : undefined
		})
	const fill = first(sources, (node) => resolveFill(fillOf(node), context.colors))
	const highlight = first(sources, (node) => child(node, 'highlight'))
	const highlightColor = highlight && colorOf(highlight, context.colors)
	const underline = UNDERLINES.get(pick('u') ?? 'none')
	const strike = pick('strike')
	const cap = pick('cap')
	return {
		family: fontStack([face('latin') ?? context.theme.fonts.minor.latin, face('ea') ?? '', face('cs') ?? '']),
		size: (Math.max(1, Math.min(400000, Number(pick('sz') ?? 1800) || 1800)) / 100) * PX_PER_POINT * fontScale,
		bold: truthy(pick('b')),
		italic: truthy(pick('i')),
		...(underline ? {underline} : {}),
		...(strike === 'sngStrike' ? {strike: 'single'} : strike === 'dblStrike' ? {strike: 'double'} : {}),
		...(cap === 'all' || cap === 'small' ? {caps: cap} : {}),
		baseline: Math.max(-1, Math.min(1, ratio(pick('baseline'), 0))),
		spacing: (Number(pick('spc') ?? 0) / 100) * PX_PER_POINT * fontScale || 0,
		color: fill === null ? 'transparent' : fill ? paintColor(fill) : textColor(context.colors),
		...(highlightColor ? {highlight: toCss(highlightColor)} : {}),
	}
}

const UNDERLINES = new Map<string, RunStyle['underline']>([
	['sng', 'solid'],
	['heavy', 'solid'],
	['words', 'solid'],
	['dbl', 'double'],
	['dotted', 'dotted'],
	['dottedHeavy', 'dotted'],
	['dash', 'dashed'],
	['dashHeavy', 'dashed'],
	['dashLong', 'dashed'],
	['dashLongHeavy', 'dashed'],
	['dotDash', 'dashed'],
	['dotDashHeavy', 'dashed'],
	['dotDotDash', 'dashed'],
	['dotDotDashHeavy', 'dashed'],
	['wavy', 'wavy'],
	['wavyHeavy', 'wavy'],
	['wavyDbl', 'wavy'],
])

// Text is drawn in one colour: a gradient's first stop, or black for a picture fill
function paintColor(paint: NonNullable<ReturnType<typeof resolveFill>>): string {
	if (paint.kind === 'solid') return paint.color
	if (paint.kind === 'linear' || paint.kind === 'radial') return paint.stops[0].color
	return '#000000'
}

const textColor = (colors: ColorContext) => {
	const color = schemeColor(colors, 'tx1')
	return color ? toCss(color) : '#000000'
}

// Hyperlinks take the theme's hyperlink colour and an underline, as PowerPoint draws them
function linkStyle(context: TextContext): Partial<RunStyle> {
	const color = schemeColor(context.colors, 'hlink')
	return {underline: 'solid', ...(color ? {color: toCss(color)} : {})}
}

// '+mj-lt' and friends name the theme's major (headings) or minor (body) fonts by script
function themeFont(typeface: string, theme: Theme): string {
	const match = /^\+(mj|mn)-(lt|ea|cs)$/.exec(typeface)
	if (!match) return typeface
	const set = match[1] === 'mj' ? theme.fonts.major : theme.fonts.minor
	return match[2] === 'lt' ? set.latin : match[2] === 'ea' ? set.ea : set.cs
}

function bulletRunStyle(
	base: RunStyle,
	pickChild: (...names: string[]) => XmlElement | undefined,
	context: TextContext,
	fontScale: number,
): RunStyle {
	const style: RunStyle = {
		...base,
		bold: false,
		italic: false,
		underline: undefined,
		strike: undefined,
		highlight: undefined,
	}
	const font = pickChild('buFontTx', 'buFont')
	if (font?.local === 'buFont' && attr(font, 'typeface'))
		style.family = fontStack([themeFont(attr(font, 'typeface')!, context.theme)])
	const color = pickChild('buClrTx', 'buClr')
	const resolved = color?.local === 'buClr' && colorOf(color, context.colors)
	if (resolved) style.color = toCss(resolved)
	const size = pickChild('buSzTx', 'buSzPct', 'buSzPts')
	if (size?.local === 'buSzPct') style.size = base.size * Math.max(0.25, Math.min(4, ratio(attr(size, 'val'), 1)))
	if (size?.local === 'buSzPts')
		style.size = (Number(attr(size, 'val') ?? 0) / 100) * PX_PER_POINT * fontScale || base.size
	return style
}

// Symbol fonts map ordinary code points to pictures. The usual bullet glyphs are swapped for their Unicode
// equivalents, which any font draws; an unknown one becomes a plain bullet. Undefined when the font isn't one.
function symbolBullet(char: string, font: XmlElement | undefined): string | undefined {
	const typeface = font?.local === 'buFont' ? (attr(font, 'typeface') ?? '').toLowerCase() : ''
	const table = typeface.startsWith('wingdings') ? WINGDINGS : typeface === 'symbol' ? SYMBOL : undefined
	if (!table) return undefined
	let code = char.codePointAt(0) ?? 0
	// Symbol-encoded text puts the font's code points in the private use area
	if (code >= 0xf000 && code <= 0xf0ff) code -= 0xf000
	return table[code] ?? '•'
}

const WINGDINGS: Record<number, string> = {
	0x6c: '●',
	0x6e: '■',
	0x6f: '□',
	0x71: '❑',
	0x75: '◆',
	0x76: '❖',
	0x77: '⬥',
	0xa7: '▪',
	0xa8: '◻',
	0xd8: '➢',
	0xe0: '➔',
	0xe8: '➔',
	0xf0: '⇨',
	0xfb: '✗',
	0xfc: '✓',
	0xfe: '☑',
}
const SYMBOL: Record<number, string> = {0xb7: '•', 0xa8: '♦', 0xa9: '♥', 0xaa: '♠', 0xab: '♣', 0x2d: '−'}

// Numbered paragraphs count up per level; a paragraph at the level without numbering, or one at a shallower
// level, starts the count over. Empty paragraphs show no number and don't interrupt.
function number(
	paragraph: Paragraph,
	auto: AutoNumber,
	level: number,
	counters: Array<{type: string; start: number; value: number} | undefined>,
) {
	const empty = !paragraph.runs.some((run) => run.kind !== 'break' && run.text !== '')
	if (empty) return
	counters.length = Math.min(counters.length, level + 1)
	if (!auto) {
		counters[level] = undefined
		return
	}
	const current = counters[level]
	const value = current && current.type === auto.type && current.start === auto.start ? current.value + 1 : auto.start
	counters[level] = {...auto, value}
	if (paragraph.bullet) paragraph.bullet.text = formatNumber(value, auto.type)
}

export function formatNumber(value: number, scheme: string): string {
	const match = /^(alphaLc|alphaUc|arabic|romanLc|romanUc)(ParenBoth|ParenR|Period|Plain)$/.exec(scheme)
	if (!match) {
		if (scheme.startsWith('circleNum') && value <= 20) {
			return String.fromCodePoint((scheme === 'circleNumWdBlackPlain' && value <= 10 ? 0x2775 : 0x245f) + value)
		}
		return `${value}.`
	}
	const [, kind, wrap] = match
	let text = String(value)
	if (kind.startsWith('alpha'))
		text = String.fromCharCode(97 + ((value - 1) % 26)).repeat(Math.floor((value - 1) / 26) + 1)
	if (kind.startsWith('roman')) text = roman(value)
	if (kind.endsWith('Uc')) text = text.toUpperCase()
	return wrap === 'ParenBoth' ? `(${text})` : wrap === 'ParenR' ? `${text})` : wrap === 'Period' ? `${text}.` : text
}

function roman(value: number): string {
	if (value >= 4000) return String(value)
	let text = ''
	let rest = value
	for (const [amount, numeral] of ROMAN) {
		while (rest >= amount) {
			text += numeral
			rest -= amount
		}
	}
	return text
}

const ROMAN: Array<[number, string]> = [
	[1000, 'm'],
	[900, 'cm'],
	[500, 'd'],
	[400, 'cd'],
	[100, 'c'],
	[90, 'xc'],
	[50, 'l'],
	[40, 'xl'],
	[10, 'x'],
	[9, 'ix'],
	[5, 'v'],
	[4, 'iv'],
	[1, 'i'],
]

// The text of an <a:t> is replaced between its tags, or by a whole new element when it's self-closing
function contentSplice(t: XmlElement) {
	if (t.contentStart !== t.end) return {start: t.contentStart, end: t.contentEnd, before: '', after: ''}
	return {start: t.start, end: t.end, before: `<${t.name}>`, after: `</${t.name}>`}
}

// A run typed just before a field or line break, carrying that piece's properties as its own
function pieceRunSplice(p: XmlElement, piece: XmlElement, source: string) {
	const prefix = p.name.slice(0, p.name.indexOf(':') + 1)
	const rPr = child(piece, 'rPr')
	const properties = rPr ? source.slice(rPr.start, rPr.end) : ''
	return {
		start: piece.start,
		end: piece.start,
		before: `<${prefix}r>${properties}<${prefix}t>`,
		after: `</${prefix}t></${prefix}r>`,
	}
}

// A run typed at the end of a paragraph goes before its paragraph mark, carrying the mark's properties as its own
function newRunSplice(p: XmlElement, source: string) {
	const prefix = p.name.slice(0, p.name.indexOf(':') + 1)
	const mark = child(p, 'endParaRPr')
	let properties = ''
	if (mark) {
		const closing = `</${mark.name}>`
		properties = `<${prefix}rPr${source.slice(mark.start + 1 + mark.name.length, mark.end)}`
		if (properties.endsWith(closing)) properties = `${properties.slice(0, -closing.length)}</${prefix}rPr>`
	}
	const open = `<${prefix}r>${properties}<${prefix}t>`
	const close = `</${prefix}t></${prefix}r>`
	if (p.contentStart === p.end)
		return {start: p.start, end: p.end, before: `<${p.name}>${open}`, after: `${close}</${p.name}>`}
	const at = mark ? mark.start : p.contentEnd
	return {start: at, end: at, before: open, after: close}
}

const emu = (value: string | number) => {
	const n = Number(value) / EMU_PER_PX
	return Number.isFinite(n) ? Math.max(-1e5, Math.min(1e5, n)) : 0
}

// Percentages in thousandths of a percent
const ratio = (value: string | undefined, fallback: number) => {
	if (value === undefined) return fallback
	const n = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value) / 100000
	return Number.isFinite(n) ? n : fallback
}
