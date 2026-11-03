// DrawingML shape properties: the theme (colour scheme, fonts, formatting styles), and fills, outlines and shadows
// resolved from a shape's own properties, its placeholder ancestors and the theme styles its p:style refers to.

import {
	colorOf,
	parseColor,
	schemeColors,
	toCss,
	type ColorContext,
	type Rgba,
} from '@/features/files/components/file-viewer/shared/color'
import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'
import type {
	Insets,
	Line,
	LineEnd,
	Paint,
	Shadow,
	Stop,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'

export const EMU_PER_PX = 9525

export type FontSet = {latin: string; ea: string; cs: string}

export type Theme = {
	colors: Record<string, Rgba>
	fonts: {major: FontSet; minor: FontSet}
	// The formatting scheme's lists that p:style and bgRef index into
	fills: XmlElement[]
	lines: XmlElement[]
	effects: XmlElement[]
	backgrounds: XmlElement[]
}

export function parseTheme(root: XmlElement | undefined): Theme {
	const elements = root && child(root, 'themeElements')
	const fontScheme = elements && child(elements, 'fontScheme')
	const fonts = (name: string, fallback: string): FontSet => {
		const set = fontScheme && child(fontScheme, name)
		const face = (script: string) => {
			const node = set && child(set, script)
			return (node && attr(node, 'typeface')) || ''
		}
		return {latin: face('latin') || fallback, ea: face('ea'), cs: face('cs')}
	}
	const format = elements && child(elements, 'fmtScheme')
	const list = (name: string) => {
		const parent = format && child(format, name)
		return parent ? children(parent) : []
	}
	return {
		colors: schemeColors(elements && child(elements, 'clrScheme')),
		fonts: {major: fonts('majorFont', 'Calibri Light'), minor: fonts('minorFont', 'Calibri')},
		fills: list('fillStyleLst'),
		lines: list('lnStyleLst'),
		effects: list('effectStyleLst'),
		backgrounds: list('bgFillStyleLst'),
	}
}

const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

// The fill element among a properties element's children
export const fillOf = (properties: XmlElement | undefined) =>
	properties && children(properties).find((node) => FILLS.has(node.local))

export type FillContext = ColorContext & {
	// The part whose relationships blip references resolve against
	image: (embed: string | undefined) => string | undefined
	// The enclosing group's fill, for grpFill
	group?: Paint | null
}

// undefined: the element says nothing; null: explicitly no fill
export function resolveFill(element: XmlElement | undefined, context: FillContext): Paint | null | undefined {
	if (!element) return undefined
	switch (element.local) {
		case 'noFill':
			return null
		case 'solidFill': {
			const color = colorOf(element, context)
			return color ? {kind: 'solid', color: toCss(color)} : null
		}
		case 'gradFill':
			return gradient(element, context)
		case 'blipFill':
			return image(element, context)
		case 'pattFill': {
			// Patterns are approximated by their two colours mixed by the pattern's ink coverage
			const fg = colorOf(child(element, 'fgClr'), context) ?? {r: 0, g: 0, b: 0, a: 1}
			const bg = colorOf(child(element, 'bgClr'), context) ?? {r: 1, g: 1, b: 1, a: 1}
			const coverage = Number(/^pct(\d+)$/.exec(attr(element, 'prst') ?? '')?.[1] ?? 50) / 100
			const mix = (a: number, b: number) => a * coverage + b * (1 - coverage)
			return {
				kind: 'solid',
				color: toCss({r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: mix(fg.a, bg.a)}),
			}
		}
		case 'grpFill':
			return context.group ?? null
	}
	return undefined
}

function gradient(element: XmlElement, context: ColorContext): Paint | null {
	const list = child(element, 'gsLst')
	const stops: Stop[] = []
	for (const gs of list ? children(list, 'gs') : []) {
		const color = colorOf(gs, context)
		if (color) stops.push({at: clamp01(Number(attr(gs, 'pos') ?? 0) / 100000), color: toCss(color)})
	}
	if (!stops.length) return null
	stops.sort((a, b) => a.at - b.at)
	const path = child(element, 'path')
	if (path) {
		// The gradient starts at the fill-to rectangle's centre and ends at the shape's edge
		const rect = child(path, 'fillToRect')
		const side = (name: string) => Number((rect && attr(rect, name)) ?? 0) / 100000 || 0
		const center = (start: number, end: number) => Math.max(-2, Math.min(3, (start + 1 - end) / 2))
		return {kind: 'radial', stops, center: {x: center(side('l'), side('r')), y: center(side('t'), side('b'))}}
	}
	const lin = child(element, 'lin')
	return {
		kind: 'linear',
		stops,
		angle: Number((lin && attr(lin, 'ang')) ?? 0) / 60000 || 0,
		scaled: !!lin && truthy(attr(lin, 'scaled')),
	}
}

function image(element: XmlElement, context: FillContext): Paint | null {
	const blip = child(element, 'blip')
	if (!blip) return null
	// Office keeps an SVG's PNG rendering here and the SVG itself in an svgBlip extension, which is never drawn: an SVG
	// would have to become a blob: URL on our own origin, a document that can run script wherever it's opened
	const part = context.image(attr(blip, 'embed'))
	if (!part) return null
	const alpha = child(blip, 'alphaModFix')
	const src = child(element, 'srcRect')
	const crop = (name: keyof Insets) => (src && Number(attr(src, name) ?? 0) / 100000) || 0
	const tile = child(element, 'tile')
	const scale = (name: string) => (tile && Number(attr(tile, name) ?? 100000) / 100000) || 1
	// Recolouring: duotone maps the picture's darks and lights to two colours (theme textures, Sepia and the like)
	const duotone = child(blip, 'duotone')
	const tones = duotone ? children(duotone).map((node) => parseColor(node, context)) : []
	const rgb = (color: Rgba): [number, number, number] => [color.r, color.g, color.b]
	return {
		kind: 'image',
		part,
		crop: {l: crop('l'), t: crop('t'), r: crop('r'), b: crop('b')},
		opacity: alpha ? clamp01(Number(attr(alpha, 'amt') ?? 100000) / 100000) : 1,
		...(tile ? {tile: {scale: {x: scale('sx'), y: scale('sy')}}} : {}),
		...(tones.length === 2 && tones[0] && tones[1] ? {duotone: [rgb(tones[0]), rgb(tones[1])]} : {}),
		...(child(blip, 'grayscl') ? {grayscale: true} : {}),
	}
}

// A theme style list entry with phClr bound to the reference's colour: p:style's fillRef/lnRef/effectRef, bgRef
export function styleEntry(list: XmlElement[], reference: XmlElement | undefined, context: ColorContext, offset = 1) {
	if (!reference) return undefined
	const index = Number(attr(reference, 'idx') ?? 0) - offset
	const entry = list[index]
	if (!entry) return undefined
	const placeholder = colorOf(reference, context) ?? context.placeholder
	return {entry, context: {...context, placeholder}}
}

const DASHES = new Map([
	['dot', [1, 3]],
	['dash', [4, 3]],
	['lgDash', [8, 3]],
	['dashDot', [4, 3, 1, 3]],
	['lgDashDot', [8, 3, 1, 3]],
	['lgDashDotDot', [8, 3, 1, 3, 1, 3]],
	['sysDash', [3, 1]],
	['sysDot', [1, 1]],
	['sysDashDot', [3, 1, 1, 1]],
	['sysDashDotDot', [3, 1, 1, 1, 1, 1]],
])
const CAPS = new Map<string, Line['cap']>([
	['rnd', 'round'],
	['sq', 'square'],
	['flat', 'butt'],
])
const END_SIZES = new Map([
	['sm', 2],
	['med', 3],
	['lg', 5],
])
const END_TYPES = new Set(['triangle', 'stealth', 'diamond', 'oval', 'arrow'])

export type LineSource = {ln: XmlElement; context: FillContext}

// The theme line style an lnRef points at, as a line source with phClr bound to the reference's colour
export function styleLine(
	theme: Theme,
	reference: XmlElement | undefined,
	context: FillContext,
): LineSource | undefined {
	const style = styleEntry(theme.lines, reference, context)
	return style && {ln: style.entry, context: {...context, ...style.context}}
}

// Outline properties are inherited one by one: each comes from the first source that sets it (the shape's own
// a:ln, its style's line, then its placeholder ancestors' in the same order)
export function resolveLine(sources: LineSource[]): Line | undefined {
	let paint: Paint | null | undefined
	for (const {ln, context} of sources) {
		paint = resolveFill(fillOf(ln), context)
		if (paint !== undefined) break
	}
	if (!paint) return undefined
	const first = <T>(read: (ln: XmlElement) => T | undefined): T | undefined => {
		for (const {ln} of sources) {
			const value = read(ln)
			if (value !== undefined) return value
		}
		return undefined
	}
	const width = Number(first((ln) => attr(ln, 'w')) ?? 0) / EMU_PER_PX
	const dash = first((ln) => {
		const preset = child(ln, 'prstDash')
		if (preset) return DASHES.get(attr(preset, 'val') ?? '') ?? []
		const custom = child(ln, 'custDash')
		return (
			custom &&
			children(custom, 'ds').flatMap((ds) => [
				Number(attr(ds, 'd') ?? 0) / 100000,
				Number(attr(ds, 'sp') ?? 0) / 100000,
			])
		)
	})
	const join = first(
		(ln) =>
			children(ln).find((node) => node.local === 'round' || node.local === 'bevel' || node.local === 'miter')?.local,
	)
	const end = (name: string) =>
		first((ln) => {
			const node = child(ln, name)
			if (!node) return undefined
			const type = attr(node, 'type') ?? 'none'
			const size = (key: string) => END_SIZES.get(attr(node, key) ?? 'med') ?? 3
			return END_TYPES.has(type) ? ({type, width: size('w'), length: size('len')} as LineEnd) : null
		}) ?? undefined
	return {
		// A zero width is PowerPoint's hairline: the thinnest line the device can draw
		width: width > 0 ? width : 1,
		paint,
		...(dash?.length && dash.every((n) => Number.isFinite(n) && n >= 0) && dash.some((n) => n > 0) ? {dash} : {}),
		cap: CAPS.get(first((ln) => attr(ln, 'cap')) ?? 'sq') ?? 'square',
		join: (join as Line['join']) ?? 'round',
		head: end('headEnd'),
		tail: end('tailEnd'),
	}
}

// Only outer shadows are drawn; glows, reflections, soft edges and 3-D are left out
export function resolveShadow(effects: XmlElement | undefined, context: ColorContext): Shadow | undefined {
	const shadow = effects && child(effects, 'outerShdw')
	if (!shadow) return undefined
	const color = colorOf(shadow, context)
	if (!color) return undefined
	const distance = Number(attr(shadow, 'dist') ?? 0) / EMU_PER_PX
	const direction = (Number(attr(shadow, 'dir') ?? 0) / 60000) * (Math.PI / 180)
	return {
		dx: distance * Math.cos(direction) || 0,
		dy: distance * Math.sin(direction) || 0,
		blur: Number(attr(shadow, 'blurRad') ?? 0) / EMU_PER_PX || 0,
		color: toCss(color),
		rotateWithShape: attr(shadow, 'rotWithShape') !== '0' && attr(shadow, 'rotWithShape') !== 'false',
	}
}

export const truthy = (value: string | undefined) => value === '1' || value === 'true' || value === 'on'
const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)
