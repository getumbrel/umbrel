// WordprocessingML formatting properties: parsed from rPr/pPr/tblPr/trPr/tcPr into typed values, and merged along
// the style cascade. Every number from the file is clamped and every colour validated here, so nothing downstream
// ever puts a document string into CSS.

import {
	fromHsl,
	schemeColor,
	toCss,
	toHsl,
	type ColorContext,
} from '@/features/files/components/file-viewer/shared/color'
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'
import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'

// ---------------------------------------------------------------------------------------------------------------
// Units: everything is CSS px at 96 dpi once parsed

export const TWIP = 1 / 15 // 1/1440 inch
export const EMU = 1 / 9525 // 1/914400 inch
const HALF_POINT = 2 / 3
export const POINT = 4 / 3

// 22 inches, the largest page Word allows: no measure on a page needs to exceed it
const MAX_LENGTH = 31680 * TWIP

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const UNIT_TWIPS: Record<string, number> = {mm: 1440 / 25.4, cm: 1440 / 2.54, in: 1440, pt: 20, pc: 240, pi: 240}

// ST_TwipsMeasure and friends: plain twips, or (strict and LibreOffice files) a number with a unit
function twips(value: string | undefined): number | undefined {
	if (value === undefined) return undefined
	const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))(mm|cm|in|pt|pc|pi)?\s*$/.exec(value)
	if (!match) return undefined
	const result = parseFloat(match[1]) * (match[2] ? UNIT_TWIPS[match[2]] : 1)
	return Number.isFinite(result) ? result : undefined
}

export function int(value: string | undefined): number | undefined {
	if (value === undefined || !/^\s*[-+]?\d+\s*$/.test(value)) return undefined
	return parseInt(value, 10)
}

// A length attribute in twips as px, clamped to a page's worth either way
export function length(element: XmlElement | undefined, name: string, min = -MAX_LENGTH): number | undefined {
	const value = element && twips(attr(element, name))
	return value === undefined ? undefined : clamp(value * TWIP, min, MAX_LENGTH)
}

// ST_OnOff: present means on, unless its value says otherwise
export function onOff(element: XmlElement | undefined): boolean | undefined {
	if (!element) return undefined
	const value = attr(element, 'val')
	return value === undefined || !(value === '0' || value === 'false' || value === 'off')
}

// An ST_OnOff attribute value (as opposed to an element), where absence means off
export const isOn = (value: string | undefined) => value === '1' || value === 'true' || value === 'on'

export const value = (element: XmlElement | undefined) => (element ? attr(element, 'val') : undefined)

// ---------------------------------------------------------------------------------------------------------------
// Colours

export type Theme = {
	// The scheme and the document's colour mapping, which theme colours resolve against: Word's (w:themeColor) and
	// DrawingML's (a shape's fill or line)
	palette: ColorContext
	major: ThemeFonts
	minor: ThemeFonts
}
export type ThemeFonts = {latin?: string; eastAsia?: string; cs?: string}

const HEX = /^[0-9A-Fa-f]{6}$/
export const hex = (value: string | undefined) => (value && HEX.test(value) ? `#${value.toLowerCase()}` : undefined)

// The scheme's colours by the names a w:themeColor uses (accent1 to accent6 are the same in both)
const THEME_NAMES = lookup<string>({
	dark1: 'dk1',
	light1: 'lt1',
	dark2: 'dk2',
	light2: 'lt2',
	text1: 'tx1',
	background1: 'bg1',
	text2: 'tx2',
	background2: 'bg2',
	hyperlink: 'hlink',
	followedHyperlink: 'folHlink',
})

// w:themeColor with w:themeTint/w:themeShade: Word lightens or darkens the theme colour's HSL luminance
function themeColor(theme: Theme | undefined, name: string | undefined, tint?: string, shade?: string) {
	if (!theme || !name) return undefined
	const base = schemeColor(theme.palette, THEME_NAMES[name] ?? name)
	if (!base) return undefined
	const [h, s, l] = toHsl(base.r, base.g, base.b)
	let lum = l
	const shadeValue = shade !== undefined && /^[0-9A-Fa-f]{2}$/.test(shade) ? parseInt(shade, 16) / 255 : undefined
	const tintValue = tint !== undefined && /^[0-9A-Fa-f]{2}$/.test(tint) ? parseInt(tint, 16) / 255 : undefined
	if (shadeValue !== undefined) lum = lum * shadeValue
	if (tintValue !== undefined) lum = lum * tintValue + (1 - tintValue)
	return toCss(fromHsl(h, s, clamp(lum, 0, 1)))
}

// A colour: its hex value, which Word keeps resolved from any theme colour; else the theme colour; else 'auto'. It's
// in w:val on w:color, and in w:color on underlines and borders, whose w:val is their style.
export function color(element: XmlElement | undefined, theme: Theme | undefined, name = 'val'): string | undefined {
	if (!element) return undefined
	const val = attr(element, name)
	return (
		hex(val) ??
		themeColor(theme, attr(element, 'themeColor'), attr(element, 'themeTint'), attr(element, 'themeShade')) ??
		(val === 'auto' ? 'auto' : undefined)
	)
}

const HIGHLIGHTS = lookup<string>({
	black: '#000000',
	blue: '#0000ff',
	cyan: '#00ffff',
	green: '#00ff00',
	magenta: '#ff00ff',
	red: '#ff0000',
	yellow: '#ffff00',
	white: '#ffffff',
	darkBlue: '#000080',
	darkCyan: '#008080',
	darkGreen: '#008000',
	darkMagenta: '#800080',
	darkRed: '#800000',
	darkYellow: '#808000',
	darkGray: '#808080',
	lightGray: '#c0c0c0',
})

// w:shd as one background colour ('none' when transparent): the fill, with any pattern blended in at its density
export function shading(element: XmlElement | undefined, theme: Theme | undefined): string | undefined {
	if (!element) return undefined
	const pattern = attr(element, 'val') ?? 'clear'
	if (pattern === 'nil') return 'none'
	const fill =
		hex(attr(element, 'fill')) ??
		themeColor(theme, attr(element, 'themeFill'), attr(element, 'themeFillTint'), attr(element, 'themeFillShade'))
	const ink =
		hex(attr(element, 'color')) ??
		themeColor(theme, attr(element, 'themeColor'), attr(element, 'themeTint'), attr(element, 'themeShade'))
	if (pattern === 'clear') return fill ?? 'none'
	if (pattern === 'solid') return ink ?? '#000000'
	const percent = /^pct(\d+)$/.exec(pattern)
	// Stripes and crosses can't be drawn as one colour; half density is the closest flat look
	const density = percent ? clamp(parseInt(percent[1], 10), 0, 100) / 100 : 0.5
	return mix(ink ?? '#000000', fill ?? '#ffffff', density)
}

function mix(a: string, b: string, amount: number): string {
	const x = parseInt(a.slice(1), 16)
	const y = parseInt(b.slice(1), 16)
	let out = '#'
	for (const shift of [16, 8, 0]) {
		const channel = Math.round(((x >> shift) & 255) * amount + ((y >> shift) & 255) * (1 - amount))
		out += channel.toString(16).padStart(2, '0')
	}
	return out
}

// Relative luminance, to pick legible 'auto' text on dark fills
export function isDark(color: string): boolean {
	const n = parseInt(color.slice(1), 16)
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
	return 0.299 * r + 0.587 * g + 0.114 * b < 96
}

// ---------------------------------------------------------------------------------------------------------------
// Borders

export type BorderStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'groove' | 'ridge' | 'inset' | 'outset' | 'none'
export type Border = {style: BorderStyle; width: number; color: string; space: number}

const BORDER_STYLES = lookup<BorderStyle>({
	single: 'solid',
	thick: 'solid',
	wave: 'solid',
	doubleWave: 'double',
	double: 'double',
	triple: 'double',
	dotted: 'dotted',
	dashed: 'dashed',
	dashSmallGap: 'dashed',
	dotDash: 'dashed',
	dotDotDash: 'dashed',
	dashDotStroked: 'dashed',
	threeDEmboss: 'ridge',
	threeDEngrave: 'groove',
	inset: 'inset',
	outset: 'outset',
})

export const NO_BORDER: Border = {style: 'none', width: 0, color: 'auto', space: 0}

function border(element: XmlElement | undefined, theme: Theme | undefined): Border | undefined {
	if (!element) return undefined
	const val = attr(element, 'val')
	if (!val || val === 'nil' || val === 'none') return NO_BORDER
	// Art borders (apples, stars…) have no CSS equivalent; a plain line keeps the frame
	const style = BORDER_STYLES[val] ?? (val.startsWith('thinThick') || val.startsWith('thickThin') ? 'double' : 'solid')
	// w:sz is in eighths of a point; the thinnest Word line still shows as a hairline
	const size = int(attr(element, 'sz')) ?? 4
	const width = Math.max(1, clamp(size, 2, 96) / 6) * (style === 'double' ? 3 : 1)
	const space = clamp(int(attr(element, 'space')) ?? 0, 0, 31) * POINT
	return {style, width: Math.min(width, 48), color: color(element, theme, 'color') ?? 'auto', space}
}

type Sides<K extends string> = Partial<Record<K, Border>>

function borders<K extends string>(element: XmlElement | undefined, theme: Theme | undefined, keys: Record<string, K>) {
	if (!element) return undefined
	const out: Sides<K> = {}
	for (const side of children(element)) {
		const key = keys[side.local]
		const parsed = key && border(side, theme)
		if (parsed) out[key] = parsed
	}
	return out
}

// ---------------------------------------------------------------------------------------------------------------
// Run properties

export type ThemeFont = {theme: string}
export type FontRef = string | ThemeFont

export type RunProps = {
	styleId?: string
	fontAscii?: FontRef
	fontHAnsi?: FontRef
	fontEastAsia?: FontRef
	fontCs?: FontRef
	size?: number // half-points
	sizeCs?: number
	bold?: boolean
	boldCs?: boolean
	italic?: boolean
	italicCs?: boolean
	caps?: boolean
	smallCaps?: boolean
	strike?: boolean
	dstrike?: boolean
	vanish?: boolean
	underline?: string
	underlineColor?: string
	color?: string
	highlight?: string
	shading?: string
	spacing?: number // px
	position?: number // px, positive raises
	vertAlign?: 'superscript' | 'subscript' | 'baseline'
	rtl?: boolean
	cs?: boolean
	lang?: string
}

// Toggle properties flip, rather than set, the value inherited from the paragraph when a character style turns them
// on (so an italic Emphasis inside an italic Quote reads upright); direct formatting always sets them outright
const TOGGLES = new Set<keyof RunProps>([
	'bold',
	'boldCs',
	'italic',
	'italicCs',
	'caps',
	'smallCaps',
	'strike',
	'dstrike',
	'vanish',
])

const FONT_SLOTS = [
	['ascii', 'fontAscii'],
	['hAnsi', 'fontHAnsi'],
	['eastAsia', 'fontEastAsia'],
	['cs', 'fontCs'],
] as const

const ON_OFF_RUN = new Map<string, keyof RunProps>([
	['b', 'bold'],
	['bCs', 'boldCs'],
	['i', 'italic'],
	['iCs', 'italicCs'],
	['caps', 'caps'],
	['smallCaps', 'smallCaps'],
	['strike', 'strike'],
	['dstrike', 'dstrike'],
	['vanish', 'vanish'],
	['rtl', 'rtl'],
	['cs', 'cs'],
])

const FONT_NAME = /^\P{Cc}{1,128}$/u

export function parseRunProps(rPr: XmlElement | undefined, theme: Theme | undefined): RunProps {
	const props: RunProps = {}
	if (!rPr) return props
	for (const element of rPr.children) {
		if (!('local' in element)) continue
		switch (element.local) {
			case 'rStyle':
				props.styleId = value(element)
				break
			case 'rFonts':
				for (const [slot, key] of FONT_SLOTS) {
					// A theme reference on the same element wins over the explicit name beside it
					const themed = attr(element, slot === 'hAnsi' ? 'hAnsiTheme' : slot === 'cs' ? 'cstheme' : `${slot}Theme`)
					const name = attr(element, slot)
					if (themed) props[key] = {theme: themed}
					else if (name && FONT_NAME.test(name)) props[key] = name
				}
				break
			case 'sz':
			case 'szCs': {
				const size = int(value(element))
				if (size !== undefined) props[element.local === 'sz' ? 'size' : 'sizeCs'] = clamp(size, 2, 3276)
				break
			}
			case 'u':
				props.underline = value(element) ?? 'single'
				props.underlineColor = color(element, theme, 'color')
				break
			case 'color':
				props.color = color(element, theme)
				break
			case 'highlight': {
				const name = value(element)
				props.highlight = name && HIGHLIGHTS[name] ? HIGHLIGHTS[name] : 'none'
				break
			}
			case 'shd':
				props.shading = shading(element, theme)
				break
			case 'spacing': {
				const spacing = length(element, 'val')
				if (spacing !== undefined) props.spacing = clamp(spacing, -100, 100)
				break
			}
			case 'position': {
				const position = int(value(element))
				if (position !== undefined) props.position = clamp(position, -3168, 3168) * HALF_POINT
				break
			}
			case 'vertAlign': {
				const align = value(element)
				if (align === 'superscript' || align === 'subscript' || align === 'baseline') props.vertAlign = align
				break
			}
			case 'lang': {
				const lang = value(element)
				if (lang && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(lang)) props.lang = lang
				break
			}
			default: {
				const key = ON_OFF_RUN.get(element.local)
				if (key) (props as Record<string, unknown>)[key] = onOff(element)
			}
		}
	}
	return props
}

export function mergeRun(base: RunProps, over: RunProps | undefined, toggle = false): RunProps {
	if (!over) return base
	const out: RunProps = {...base}
	for (const key of Object.keys(over) as Array<keyof RunProps>) {
		if (key === 'styleId') continue
		const next = over[key]
		if (next === undefined) continue
		if (toggle && TOGGLES.has(key)) {
			if (next) (out as Record<string, unknown>)[key] = !base[key]
		} else {
			;(out as Record<string, unknown>)[key] = next
		}
	}
	return out
}

// ---------------------------------------------------------------------------------------------------------------
// Paragraph properties

export type Spacing = {
	before?: number
	after?: number
	beforeLines?: number
	afterLines?: number
	beforeAuto?: boolean
	afterAuto?: boolean
	line?: number // twips for exact/atLeast, 240ths of a line for auto
	lineRule?: 'auto' | 'exact' | 'atLeast'
}

export type Indent = {left?: number; right?: number; firstLine?: number; hanging?: number}

export type TabAlign = 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear'
export type TabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot'
export type TabStop = {pos: number; align: TabAlign; leader: TabLeader}

export type ParagraphBorders = Sides<'top' | 'left' | 'bottom' | 'right' | 'between'>
export type Justification = 'left' | 'center' | 'right' | 'both' | 'distribute'

export type ParaProps = {
	styleId?: string
	keepNext?: boolean
	keepLines?: boolean
	pageBreakBefore?: boolean
	widowControl?: boolean
	numId?: number
	ilvl?: number
	borders?: ParagraphBorders
	shading?: string
	tabs?: TabStop[]
	spacing?: Spacing
	indent?: Indent
	align?: Justification
	contextualSpacing?: boolean
	bidi?: boolean
	suppressAutoHyphens?: boolean
}

const PARAGRAPH_BORDERS = {
	top: 'top',
	left: 'left',
	start: 'left',
	bottom: 'bottom',
	right: 'right',
	end: 'right',
	between: 'between',
} as const

const JUSTIFICATIONS = lookup<Justification>({
	left: 'left',
	start: 'left',
	center: 'center',
	right: 'right',
	end: 'right',
	both: 'both',
	distribute: 'distribute',
	mediumKashida: 'both',
	highKashida: 'both',
	lowKashida: 'both',
	thaiDistribute: 'both',
})

const TAB_ALIGNS = lookup<TabAlign>({
	left: 'left',
	start: 'left',
	num: 'left',
	center: 'center',
	right: 'right',
	end: 'right',
	decimal: 'decimal',
	bar: 'bar',
	clear: 'clear',
})

const TAB_LEADERS = new Set<string>(['dot', 'hyphen', 'underscore', 'heavy', 'middleDot'])

function parseTabStop(element: XmlElement): TabStop | undefined {
	const pos = length(element, 'pos')
	const align = TAB_ALIGNS[attr(element, 'val') ?? '']
	if (pos === undefined || !align) return undefined
	const leader = attr(element, 'leader') ?? 'none'
	return {pos, align, leader: TAB_LEADERS.has(leader) ? (leader as TabLeader) : 'none'}
}

export function parseParaProps(pPr: XmlElement | undefined, theme: Theme | undefined): ParaProps {
	const props: ParaProps = {}
	if (!pPr) return props
	for (const element of pPr.children) {
		if (!('local' in element)) continue
		switch (element.local) {
			case 'pStyle':
				props.styleId = value(element)
				break
			case 'keepNext':
			case 'keepLines':
			case 'pageBreakBefore':
			case 'widowControl':
			case 'contextualSpacing':
			case 'bidi':
			case 'suppressAutoHyphens':
				props[element.local] = onOff(element)
				break
			case 'numPr': {
				const numId = int(value(child(element, 'numId')))
				const ilvl = int(value(child(element, 'ilvl')))
				if (numId !== undefined) props.numId = numId
				if (ilvl !== undefined) props.ilvl = clamp(ilvl, 0, 8)
				break
			}
			case 'pBdr':
				props.borders = borders(element, theme, PARAGRAPH_BORDERS)
				break
			case 'shd':
				props.shading = shading(element, theme)
				break
			case 'tabs':
				props.tabs = children(element, 'tab')
					.map(parseTabStop)
					.filter((tab) => tab !== undefined)
				break
			case 'spacing': {
				const spacing: Spacing = {}
				const before = length(element, 'before', 0)
				const after = length(element, 'after', 0)
				if (before !== undefined) spacing.before = before
				if (after !== undefined) spacing.after = after
				const beforeLines = int(attr(element, 'beforeLines'))
				const afterLines = int(attr(element, 'afterLines'))
				if (beforeLines !== undefined) spacing.beforeLines = clamp(beforeLines, 0, 10000)
				if (afterLines !== undefined) spacing.afterLines = clamp(afterLines, 0, 10000)
				const beforeAuto = attr(element, 'beforeAutospacing')
				const afterAuto = attr(element, 'afterAutospacing')
				if (beforeAuto !== undefined) spacing.beforeAuto = isOn(beforeAuto)
				if (afterAuto !== undefined) spacing.afterAuto = isOn(afterAuto)
				const line = twips(attr(element, 'line'))
				const rule = attr(element, 'lineRule')
				if (line !== undefined && line > 0) {
					spacing.line = clamp(line, 1, 31680)
					spacing.lineRule = rule === 'exact' || rule === 'atLeast' ? rule : 'auto'
				}
				props.spacing = spacing
				break
			}
			case 'ind': {
				const indent: Indent = {}
				const left = length(element, 'left') ?? length(element, 'start')
				const right = length(element, 'right') ?? length(element, 'end')
				const firstLine = length(element, 'firstLine', 0)
				const hanging = length(element, 'hanging', 0)
				if (left !== undefined) indent.left = left
				if (right !== undefined) indent.right = right
				// Hanging wins when both are given, as in Word
				if (hanging !== undefined) indent.hanging = hanging
				else if (firstLine !== undefined) indent.firstLine = firstLine
				props.indent = indent
				break
			}
			case 'jc': {
				const align = JUSTIFICATIONS[value(element) ?? '']
				if (align) props.align = align
				break
			}
		}
	}
	return props
}

export function mergePara(base: ParaProps, over: ParaProps | undefined): ParaProps {
	if (!over) return base
	const out: ParaProps = {...base}
	for (const key of Object.keys(over) as Array<keyof ParaProps>) {
		if (key === 'styleId' || over[key] === undefined) continue
		switch (key) {
			case 'spacing':
				out.spacing = {...base.spacing, ...over.spacing}
				break
			case 'indent': {
				const indent = {...base.indent, ...over.indent}
				// firstLine and hanging are one setting seen from two sides: the later level replaces both
				if (over.indent!.hanging !== undefined) delete indent.firstLine
				else if (over.indent!.firstLine !== undefined) delete indent.hanging
				out.indent = indent
				break
			}
			case 'borders':
				out.borders = {...base.borders, ...over.borders}
				break
			case 'tabs':
				out.tabs = mergeTabs(base.tabs, over.tabs!)
				break
			default:
				;(out as Record<string, unknown>)[key] = over[key]
		}
	}
	return out
}

// Later tab definitions add stops, and a 'clear' removes the inherited stop at its position
function mergeTabs(base: TabStop[] | undefined, over: TabStop[]): TabStop[] {
	const near = (a: number, b: number) => Math.abs(a - b) < 0.5
	const kept = (base ?? []).filter((stop) => !over.some((tab) => near(tab.pos, stop.pos)))
	return [...kept, ...over.filter((tab) => tab.align !== 'clear')].sort((a, b) => a.pos - b.pos)
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

export type Width = {type: 'dxa' | 'pct' | 'auto' | 'nil'; value: number} // dxa in px, pct as a fraction

function width(element: XmlElement | undefined): Width | undefined {
	if (!element) return undefined
	const type = attr(element, 'type') ?? 'dxa'
	const raw = attr(element, 'w')
	if (type === 'auto' || type === 'nil') return {type, value: 0}
	if (type === 'pct') {
		// Fiftieths of a percent, or (strict) an explicit percentage
		const percent = raw?.endsWith('%') ? parseFloat(raw) : (int(raw) ?? 0) / 50
		return Number.isFinite(percent) ? {type, value: clamp(percent, 0, 1000) / 100} : undefined
	}
	const dxa = twips(raw)
	return dxa === undefined ? undefined : {type: 'dxa', value: clamp(dxa * TWIP, 0, MAX_LENGTH)}
}

export type TableBorders = Sides<'top' | 'left' | 'bottom' | 'right' | 'insideH' | 'insideV'>
export type CellMargins = Partial<Record<'top' | 'left' | 'bottom' | 'right', number>>
export type TableLook = {
	firstRow: boolean
	lastRow: boolean
	firstColumn: boolean
	lastColumn: boolean
	noHBand: boolean
	noVBand: boolean
}

export type TableProps = {
	styleId?: string
	width?: Width
	align?: 'left' | 'center' | 'right'
	indent?: number
	borders?: TableBorders
	cellMargins?: CellMargins
	cellSpacing?: number
	shading?: string
	look?: TableLook
	rowBandSize?: number
	colBandSize?: number
	bidi?: boolean
}

const TABLE_BORDERS = {
	top: 'top',
	left: 'left',
	start: 'left',
	bottom: 'bottom',
	right: 'right',
	end: 'right',
	insideH: 'insideH',
	insideV: 'insideV',
} as const

function margins(element: XmlElement | undefined): CellMargins | undefined {
	if (!element) return undefined
	const out: CellMargins = {}
	for (const side of children(element)) {
		const key = ({top: 'top', left: 'left', start: 'left', bottom: 'bottom', right: 'right', end: 'right'} as const)[
			side.local as 'top'
		]
		const w = width(side)
		if (key && w?.type === 'dxa') out[key] = w.value
		else if (key && w?.type === 'nil') out[key] = 0
	}
	return out
}

// tblLook: attributes in newer files, a bit mask in w:val in older ones
function look(element: XmlElement | undefined): TableLook | undefined {
	if (!element) return undefined
	const mask = parseInt(attr(element, 'val') ?? '', 16)
	const flag = (name: string, bit: number) => {
		const explicit = attr(element, name)
		if (explicit !== undefined) return isOn(explicit)
		return Number.isFinite(mask) ? (mask & bit) !== 0 : false
	}
	return {
		firstRow: flag('firstRow', 0x20),
		lastRow: flag('lastRow', 0x40),
		firstColumn: flag('firstColumn', 0x80),
		lastColumn: flag('lastColumn', 0x100),
		noHBand: flag('noHBand', 0x200),
		noVBand: flag('noVBand', 0x400),
	}
}

export function parseTableProps(tblPr: XmlElement | undefined, theme: Theme | undefined): TableProps {
	const props: TableProps = {}
	if (!tblPr) return props
	for (const element of tblPr.children) {
		if (!('local' in element)) continue
		switch (element.local) {
			case 'tblStyle':
				props.styleId = value(element)
				break
			case 'tblW':
				props.width = width(element)
				break
			case 'jc': {
				const jc = value(element)
				props.align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left'
				break
			}
			case 'tblInd': {
				const indent = width(element)
				if (indent?.type === 'dxa') props.indent = indent.value
				else if (indent?.type === 'nil') props.indent = 0
				break
			}
			case 'tblBorders':
				props.borders = borders(element, theme, TABLE_BORDERS)
				break
			case 'tblCellMar':
				props.cellMargins = margins(element)
				break
			case 'tblCellSpacing': {
				const spacing = width(element)
				if (spacing?.type === 'dxa') props.cellSpacing = spacing.value
				break
			}
			case 'shd':
				props.shading = shading(element, theme)
				break
			case 'tblLook':
				props.look = look(element)
				break
			case 'tblStyleRowBandSize':
			case 'tblStyleColBandSize': {
				const size = int(value(element))
				if (size !== undefined)
					props[element.local === 'tblStyleRowBandSize' ? 'rowBandSize' : 'colBandSize'] = clamp(size, 1, 100)
				break
			}
			case 'bidiVisual':
				props.bidi = onOff(element)
				break
		}
	}
	return props
}

export function mergeTable(base: TableProps, over: TableProps | undefined): TableProps {
	if (!over) return base
	const out: TableProps = {...base}
	for (const key of Object.keys(over) as Array<keyof TableProps>) {
		if (key === 'styleId' || over[key] === undefined) continue
		if (key === 'borders') out.borders = {...base.borders, ...over.borders}
		else if (key === 'cellMargins') out.cellMargins = {...base.cellMargins, ...over.cellMargins}
		else (out as Record<string, unknown>)[key] = over[key]
	}
	return out
}

export type RowProps = {
	height?: number
	heightRule?: 'atLeast' | 'exact'
	header?: boolean
	gridBefore?: number
	hidden?: boolean
}

export function parseRowProps(trPr: XmlElement | undefined): RowProps {
	const props: RowProps = {}
	if (!trPr) return props
	for (const element of trPr.children) {
		if (!('local' in element)) continue
		switch (element.local) {
			case 'trHeight': {
				const height = length(element, 'val', 0)
				const rule = attr(element, 'hRule')
				if (height !== undefined && rule !== 'auto') {
					props.height = height
					props.heightRule = rule === 'exact' ? 'exact' : 'atLeast'
				}
				break
			}
			case 'tblHeader':
				props.header = onOff(element)
				break
			case 'hidden':
				props.hidden = onOff(element)
				break
			case 'gridBefore': {
				const span = int(value(element))
				if (span !== undefined) props.gridBefore = clamp(span, 0, 63)
				break
			}
		}
	}
	return props
}

export type CellBorders = Sides<'top' | 'left' | 'bottom' | 'right' | 'insideH' | 'insideV'>
export type VerticalAlign = 'top' | 'center' | 'bottom'

export type CellProps = {
	gridSpan?: number
	vMerge?: 'restart' | 'continue'
	hMerge?: 'restart' | 'continue'
	borders?: CellBorders
	shading?: string
	margins?: CellMargins
	vAlign?: VerticalAlign
	noWrap?: boolean
	vertical?: boolean // text runs top to bottom (tbRl, btLr)
}

export function parseCellProps(tcPr: XmlElement | undefined, theme: Theme | undefined): CellProps {
	const props: CellProps = {}
	if (!tcPr) return props
	for (const element of tcPr.children) {
		if (!('local' in element)) continue
		switch (element.local) {
			case 'gridSpan': {
				const span = int(value(element))
				if (span !== undefined) props.gridSpan = clamp(span, 1, 63)
				break
			}
			case 'vMerge':
			case 'hMerge':
				props[element.local] = value(element) === 'restart' ? 'restart' : 'continue'
				break
			case 'tcBorders':
				props.borders = borders(element, theme, TABLE_BORDERS)
				break
			case 'shd':
				props.shading = shading(element, theme)
				break
			case 'tcMar':
				props.margins = margins(element)
				break
			case 'vAlign': {
				const align = value(element)
				props.vAlign = align === 'center' ? 'center' : align === 'bottom' ? 'bottom' : 'top'
				break
			}
			case 'noWrap':
				props.noWrap = onOff(element)
				break
			case 'textDirection': {
				const direction = value(element)
				props.vertical = direction === 'tbRl' || direction === 'btLr' || direction === 'tbRlV' || direction === 'tb'
				break
			}
		}
	}
	return props
}

export function mergeCell(base: CellProps, over: CellProps | undefined): CellProps {
	if (!over) return base
	const out: CellProps = {...base}
	for (const key of Object.keys(over) as Array<keyof CellProps>) {
		if (over[key] === undefined) continue
		if (key === 'borders') out.borders = {...base.borders, ...over.borders}
		else if (key === 'margins') out.margins = {...base.margins, ...over.margins}
		else (out as Record<string, unknown>)[key] = over[key]
	}
	return out
}
