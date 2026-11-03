// Cell styles from styles.xml, resolved per cellXfs entry against the theme so
// the renderer gets plain values: fonts, fills, borders and alignment, with
// every colour as #RRGGBB (undefined meaning Excel's automatic colour).

import {schemeColors, toCss} from '../../../shared/color'
import {attr, child, children, parseXml, type XmlElement} from '../../../shared/xml'
import {builtinFormat, INDEXED_COLORS} from './number-format'

export type Font = {
	name: string
	size: number // points
	bold: boolean
	italic: boolean
	underline: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting'
	strike: boolean
	vertAlign: 'baseline' | 'superscript' | 'subscript'
	color?: string
}

export type PatternType =
	| 'solid'
	| 'gray125'
	| 'gray0625'
	| 'lightGray'
	| 'mediumGray'
	| 'darkGray'
	| 'lightHorizontal'
	| 'lightVertical'
	| 'lightDown'
	| 'lightUp'
	| 'lightGrid'
	| 'lightTrellis'
	| 'darkHorizontal'
	| 'darkVertical'
	| 'darkDown'
	| 'darkUp'
	| 'darkGrid'
	| 'darkTrellis'

// A solid fill's colour is `color`; patterns draw `color` over `background`
export type Fill =
	| {type: 'pattern'; pattern: PatternType; color?: string; background?: string}
	| {type: 'gradient'; gradient: 'linear' | 'path'; degree: number; stops: Array<{position: number; color: string}>}

export type BorderStyle =
	| 'thin'
	| 'medium'
	| 'thick'
	| 'hair'
	| 'dotted'
	| 'dashed'
	| 'double'
	| 'mediumDashed'
	| 'dashDot'
	| 'mediumDashDot'
	| 'dashDotDot'
	| 'mediumDashDotDot'
	| 'slantDashDot'

export type BorderEdge = {style: BorderStyle; color?: string}

export type Border = {
	left?: BorderEdge
	right?: BorderEdge
	top?: BorderEdge
	bottom?: BorderEdge
	diagonal?: BorderEdge
	diagonalUp: boolean
	diagonalDown: boolean
}

export type Alignment = {
	horizontal: 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed'
	vertical: 'top' | 'center' | 'bottom' | 'justify' | 'distributed'
	wrap: boolean
	shrink: boolean
	indent: number
	rotation: number // degrees as stored: 0–90 up, 91–180 down (90 + n is n down), 255 stacked vertically
	readingOrder: 'context' | 'ltr' | 'rtl'
}

export type CellStyle = {
	format: string // the number format code
	font: Font
	fill?: Fill
	border?: Border
	alignment: Alignment
	quotePrefix: boolean // typed with a leading apostrophe, which Excel keeps out of the value
	// On a protected sheet, a locked cell can't be changed and a hidden one keeps its formula out of view
	locked: boolean
	hidden: boolean
}

// By a cell's style index (its `s`); index 0 is the default for cells without one
export type ResolvedStyles = readonly CellStyle[]

export type Theme = {colors: string[]; majorFont?: string; minorFont?: string}
export type Palette = readonly (string | undefined)[]

// Excel's own limit on distinct cell formats; it also bounds what a hostile styles.xml makes us build
export const MAX_STYLES = 65_536

// clrScheme lists dark 1, light 1, dark 2, light 2...; SpreadsheetML's theme indexes swap each pair, so theme="1"
// (the default text colour) is dark 1
const THEME_ORDER = [
	'lt1',
	'dk1',
	'lt2',
	'dk2',
	'accent1',
	'accent2',
	'accent3',
	'accent4',
	'accent5',
	'accent6',
].concat(['hlink', 'folHlink'])

// A workbook without a theme, or whose theme leaves a colour out, gets Office's
export function parseTheme(xml: string | undefined): Theme {
	const elements = xml === undefined ? undefined : child(parseXml(xml), 'themeElements')
	const scheme = schemeColors(elements && child(elements, 'clrScheme'))
	const fonts = elements && child(elements, 'fontScheme')
	const typeface = (name: string) => {
		const font = fonts && child(fonts, name)
		const latin = font && child(font, 'latin')
		return (latin && attr(latin, 'typeface')) || undefined
	}
	return {
		// As #RRGGBB like every colour here: a cell's colours have no alpha
		colors: THEME_ORDER.map((name) => toCss({...scheme[name], a: 1}).toUpperCase()),
		majorFont: typeface('majorFont'),
		minorFont: typeface('minorFont'),
	}
}

const DEFAULT_FONT: Font = {
	name: 'Calibri',
	size: 11,
	bold: false,
	italic: false,
	underline: 'none',
	strike: false,
	vertAlign: 'baseline',
}

const DEFAULT_ALIGNMENT: Alignment = {
	horizontal: 'general',
	vertical: 'bottom',
	wrap: false,
	shrink: false,
	indent: 0,
	rotation: 0,
	readingOrder: 'context',
}

const DEFAULT_STYLE: CellStyle = {
	format: 'General',
	font: DEFAULT_FONT,
	alignment: DEFAULT_ALIGNMENT,
	quotePrefix: false,
	locked: true,
	hidden: false,
}

// `cellFormats`: how many cell formats (cellXfs entries) the file has. Styles stand for them one for one only when
// it has some, and no more than MAX_STYLES.
export function parseStyles(
	xml: string | undefined,
	theme: Theme,
): {styles: ResolvedStyles; palette: Palette; cellFormats: number} {
	if (xml === undefined) return {styles: [DEFAULT_STYLE], palette: INDEXED_COLORS, cellFormats: 0}
	const root = parseXml(xml)
	const list = (parent: string, item: string) => {
		const element = child(root, parent)
		return element ? children(element, item).slice(0, MAX_STYLES) : []
	}

	const colors = child(root, 'colors')
	const indexed = colors && child(colors, 'indexedColors')
	const custom = indexed ? children(indexed, 'rgbColor').map((color) => hex(attr(color, 'rgb'))) : []
	const palette: Palette = INDEXED_COLORS.map((color, i) => custom[i] ?? color)

	const formats = new Map<number, string>()
	for (const format of list('numFmts', 'numFmt')) {
		const code = attr(format, 'formatCode')
		if (code !== undefined) formats.set(Number(attr(format, 'numFmtId')), code)
	}
	const fonts = list('fonts', 'font').map((font): Font => ({...DEFAULT_FONT, ...fontProperties(font, theme, palette)}))
	const fills = list('fills', 'fill').map((fill) => parseFill(fill, theme, palette))
	const borders = list('borders', 'border').map((border) => parseBorder(border, theme, palette))
	const bases = list('cellStyleXfs', 'xf')

	const styles = list('cellXfs', 'xf').map((xf): CellStyle => {
		// Anything the format leaves out comes from its named style
		const base = bases[index(attr(xf, 'xfId')) ?? 0]
		const pick = (name: string) => index(attr(xf, name)) ?? (base && index(attr(base, name))) ?? 0
		const numFmtId = pick('numFmtId')
		const alignment = child(xf, 'alignment') ?? (base && child(base, 'alignment'))
		// Cells are locked unless their format says otherwise
		const protection = child(xf, 'protection')
		const locked = protection && attr(protection, 'locked')
		return {
			format: formats.get(numFmtId) ?? builtinFormat(numFmtId) ?? 'General',
			font: fonts[pick('fontId')] ?? fonts[0] ?? DEFAULT_FONT,
			fill: fills[pick('fillId')],
			border: borders[pick('borderId')],
			alignment: alignment ? parseAlignment(alignment) : DEFAULT_ALIGNMENT,
			quotePrefix: flag(attr(xf, 'quotePrefix')),
			locked: locked === undefined || flag(locked),
			hidden: flag(protection && attr(protection, 'hidden')),
		}
	})
	const cellXfs = child(root, 'cellXfs')
	const cellFormats = cellXfs ? children(cellXfs, 'xf').length : 0
	return {styles: styles.length ? styles : [DEFAULT_STYLE], palette, cellFormats}
}

// The properties a <font> or a rich text run's <rPr> sets, and only those
export function fontProperties(element: XmlElement, theme: Theme, palette: Palette): Partial<Font> {
	const font: Partial<Font> = {}
	for (const property of children(element)) {
		const value = attr(property, 'val')
		switch (property.local) {
			case 'name':
			case 'rFont':
				if (value) font.name = value
				break
			case 'sz': {
				const size = Number(value)
				if (size > 0) font.size = Math.min(size, 409)
				break
			}
			case 'b':
				font.bold = value === undefined || flag(value)
				break
			case 'i':
				font.italic = value === undefined || flag(value)
				break
			case 'strike':
				font.strike = value === undefined || flag(value)
				break
			case 'u':
				font.underline = value === undefined ? 'single' : oneOf(value, UNDERLINES, 'none')
				break
			case 'vertAlign':
				font.vertAlign = oneOf(value, VERTICAL_ALIGNMENTS, 'baseline')
				break
			case 'color':
				font.color = color(property, theme, palette)
				break
		}
	}
	// A theme font follows the theme, whatever name the element repeats
	const scheme = child(element, 'scheme')
	const schemeValue = scheme && attr(scheme, 'val')
	if (schemeValue === 'minor' || schemeValue === 'major') font.name = theme[`${schemeValue}Font`] ?? font.name
	return font
}

// A <color>-like element: automatic, a theme colour, an indexed one or ARGB, then lightened or darkened by tint
function color(element: XmlElement | undefined, theme: Theme, palette: Palette): string | undefined {
	if (!element || flag(attr(element, 'auto'))) return undefined
	const themeIndex = attr(element, 'theme')
	const rgb = attr(element, 'rgb')
	const indexed = attr(element, 'indexed')
	const base =
		themeIndex !== undefined
			? theme.colors[index(themeIndex) ?? -1]
			: rgb !== undefined
				? hex(rgb)
				: indexed !== undefined
					? palette[index(indexed) ?? -1]
					: undefined
	const tint = Number(attr(element, 'tint'))
	return base && tint ? applyTint(base, Math.max(-1, Math.min(1, tint))) : base
}

const UNDERLINES = ['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'] as const
const VERTICAL_ALIGNMENTS = ['baseline', 'superscript', 'subscript'] as const
const PATTERNS = [
	'solid',
	'gray125',
	'gray0625',
	'lightGray',
	'mediumGray',
	'darkGray',
	'lightHorizontal',
	'lightVertical',
	'lightDown',
	'lightUp',
	'lightGrid',
	'lightTrellis',
	'darkHorizontal',
	'darkVertical',
	'darkDown',
	'darkUp',
	'darkGrid',
	'darkTrellis',
] as const
const BORDER_STYLES = [
	'thin',
	'medium',
	'thick',
	'hair',
	'dotted',
	'dashed',
	'double',
	'mediumDashed',
	'dashDot',
	'mediumDashDot',
	'dashDotDot',
	'mediumDashDotDot',
	'slantDashDot',
] as const
const HORIZONTAL = ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed'] as const
const VERTICAL = ['top', 'center', 'bottom', 'justify', 'distributed'] as const

function parseFill(element: XmlElement, theme: Theme, palette: Palette): Fill | undefined {
	const pattern = child(element, 'patternFill')
	if (pattern) {
		// No patternType means no fill (the spec's default, and the first fill in every styles.xml)
		const type = oneOf(attr(pattern, 'patternType'), PATTERNS, undefined)
		if (!type) return undefined
		return {
			type: 'pattern',
			pattern: type,
			color: color(child(pattern, 'fgColor'), theme, palette),
			background: color(child(pattern, 'bgColor'), theme, palette),
		}
	}
	const gradient = child(element, 'gradientFill')
	if (!gradient) return undefined
	const stops = children(gradient, 'stop').flatMap((stop) => {
		const value = color(child(stop, 'color'), theme, palette)
		const position = Number(attr(stop, 'position'))
		return value && position >= 0 && position <= 1 ? [{position, color: value}] : []
	})
	if (!stops.length) return undefined
	return {
		type: 'gradient',
		gradient: attr(gradient, 'type') === 'path' ? 'path' : 'linear',
		degree: Number(attr(gradient, 'degree')) || 0,
		stops,
	}
}

function parseBorder(element: XmlElement, theme: Theme, palette: Palette): Border | undefined {
	const edge = (...names: string[]): BorderEdge | undefined => {
		for (const name of names) {
			const side = child(element, name)
			const style = side && oneOf(attr(side, 'style'), BORDER_STYLES, undefined)
			if (style) return {style, color: color(child(side, 'color'), theme, palette)}
		}
		return undefined
	}
	// Strict-conformance files say start and end for left and right
	const border: Border = {
		left: edge('left', 'start'),
		right: edge('right', 'end'),
		top: edge('top'),
		bottom: edge('bottom'),
		diagonal: edge('diagonal'),
		diagonalUp: flag(attr(element, 'diagonalUp')),
		diagonalDown: flag(attr(element, 'diagonalDown')),
	}
	return border.left || border.right || border.top || border.bottom || border.diagonal ? border : undefined
}

function parseAlignment(element: XmlElement): Alignment {
	const rotation = index(attr(element, 'textRotation')) ?? 0
	const readingOrder = attr(element, 'readingOrder')
	return {
		horizontal: oneOf(attr(element, 'horizontal'), HORIZONTAL, 'general'),
		vertical: oneOf(attr(element, 'vertical'), VERTICAL, 'bottom'),
		wrap: flag(attr(element, 'wrapText')),
		shrink: flag(attr(element, 'shrinkToFit')),
		indent: Math.min(index(attr(element, 'indent')) ?? 0, 250),
		rotation: rotation <= 180 || rotation === 255 ? rotation : 0,
		readingOrder: readingOrder === '1' ? 'ltr' : readingOrder === '2' ? 'rtl' : 'context',
	}
}

// Lightens (tint > 0) or darkens (tint < 0) in HLS space, per ECMA-376 Part 1 §18.8.19
function applyTint(color: string, tint: number): string {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	let lightness = (max + min) / 2
	let hue = 0
	let saturation = 0
	if (max !== min) {
		const delta = max - min
		saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
		hue = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6
	}
	lightness = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint
	const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
	const p = 2 * lightness - q
	const channel = (t: number) => {
		t = t < 0 ? t + 1 : t > 1 ? t - 1 : t
		const value = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0')
	}
	return `#${channel(hue + 1 / 3)}${channel(hue)}${channel(hue - 1 / 3)}`.toUpperCase()
}

// ARGB or RGB hex to #RRGGBB; Excel ignores the alpha byte
function hex(value: string | undefined): string | undefined {
	if (!value || !/^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(value)) return undefined
	return `#${value.slice(-6).toUpperCase()}`
}

export const flag = (value: string | undefined) => value === '1' || value === 'true'

// A non-negative integer attribute, or undefined
export function index(value: string | undefined): number | undefined {
	if (value === undefined) return undefined
	const n = Number(value)
	return Number.isInteger(n) && n >= 0 ? n : undefined
}

function oneOf<const T extends string, D>(value: string | undefined, allowed: readonly T[], fallback: D): T | D {
	return allowed.includes(value as T) ? (value as T) : fallback
}
