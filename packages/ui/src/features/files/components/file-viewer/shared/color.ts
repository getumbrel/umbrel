// DrawingML colours: the models a document can name a colour in, the theme scheme and colour map that resolve
// scheme names, and the transforms (tints, shades, luminance, alpha…) applied on top in document order. Tints and
// shades work in linear light and the luminance, saturation and hue transforms in HSL, which is what reproduces
// PowerPoint's own palette values exactly.

import {attr, children, type XmlElement} from './xml'

// sRGB channels and alpha, each 0–1
export type Rgba = {r: number; g: number; b: number; a: number}

export type ColorContext = {
	// The theme's colour scheme, dk1 through folHlink
	scheme: Readonly<Record<string, Rgba>>
	// The colour map (a deck's master or slide, a document's settings): bg1 → lt1, tx1 → dk1, …
	map: Readonly<Record<string, string>>
	// phClr: the colour a style reference passes into the theme's fill, line and effect styles
	placeholder?: Rgba
}

const OFFICE_SCHEME =
	'dk1:000000 lt1:FFFFFF dk2:44546A lt2:E7E6E6 accent1:4472C4 accent2:ED7D31 accent3:A5A5A5 accent4:FFC000 ' +
	'accent5:5B9BD5 accent6:70AD47 hlink:0563C1 folHlink:954F72'

// A theme's colour scheme (its a:clrScheme). A theme that leaves a colour out, or has no scheme, gets Office's own.
export function schemeColors(clrScheme: XmlElement | undefined): Record<string, Rgba> {
	const colors: Record<string, Rgba> = {}
	for (const entry of OFFICE_SCHEME.split(' ')) {
		const [name, hex] = entry.split(':')
		colors[name] = fromHex(hex)!
	}
	const context: ColorContext = {scheme: {}, map: {}}
	for (const node of clrScheme ? children(clrScheme) : []) {
		if (Object.hasOwn(colors, node.local)) colors[node.local] = colorOf(node, context) ?? colors[node.local]
	}
	return colors
}

// A scheme colour by any name a document uses for it: through the colour map (tx1 → dk1), or directly (accent1)
export const schemeColor = (context: ColorContext, name: string): Rgba | undefined =>
	own(context.scheme, own(context.map, name) ?? name)

const COLOR_ELEMENTS = new Set(['srgbClr', 'scrgbClr', 'hslClr', 'sysClr', 'schemeClr', 'prstClr'])

// The colour inside a fill-like element (solidFill, a style reference, a gradient stop…)
export function colorOf(element: XmlElement | undefined, context: ColorContext): Rgba | undefined {
	if (!element) return undefined
	for (const node of element.children) {
		if ('local' in node && COLOR_ELEMENTS.has(node.local)) return parseColor(node, context)
	}
	return undefined
}

export function parseColor(element: XmlElement, context: ColorContext): Rgba | undefined {
	let color: Rgba | undefined
	switch (element.local) {
		case 'srgbClr':
			color = fromHex(attr(element, 'val'))
			break
		case 'scrgbClr':
			color = fromLinear(percent(element, 'r'), percent(element, 'g'), percent(element, 'b'))
			break
		case 'hslClr':
			color = fromHsl(number(element, 'hue') / 60000, percent(element, 'sat'), percent(element, 'lum'))
			break
		case 'sysClr':
			// Writers record the system colour's value at save time; windowText and friends are dark, window light
			color = fromHex(attr(element, 'lastClr')) ?? fromHex(attr(element, 'val') === 'window' ? 'FFFFFF' : '000000')
			break
		case 'schemeClr': {
			const name = attr(element, 'val') ?? ''
			const resolved = name === 'phClr' ? context.placeholder : schemeColor(context, name)
			color = resolved && {...resolved}
			break
		}
		case 'prstClr':
			color = presetColor(attr(element, 'val') ?? '')
			break
	}
	return color && transform(color, element)
}

export function toCss({r, g, b, a}: Rgba): string {
	const channel = (value: number) => Math.round(clamp(value) * 255)
	if (a >= 1) return `#${[r, g, b].map((value) => channel(value).toString(16).padStart(2, '0')).join('')}`
	return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Math.round(clamp(a) * 1000) / 1000})`
}

function transform(color: Rgba, element: XmlElement): Rgba {
	let {r, g, b, a} = color
	for (const node of element.children) {
		if (!('local' in node)) continue
		// Angles in 60000ths of a degree, everything else a percentage
		const angle = number(node, 'val') / 60000
		const fraction = percent(node, 'val')
		switch (node.local) {
			case 'alpha':
				a = fraction
				break
			case 'alphaMod':
				a *= fraction
				break
			case 'alphaOff':
				a += fraction
				break
			case 'tint':
			case 'shade':
			case 'red':
			case 'redMod':
			case 'redOff':
			case 'green':
			case 'greenMod':
			case 'greenOff':
			case 'blue':
			case 'blueMod':
			case 'blueOff': {
				const linear = [toLinear(r), toLinear(g), toLinear(b)]
				const channel = 'rgb'.indexOf(node.local[0])
				if (node.local === 'tint') linear.forEach((c, i) => (linear[i] = 1 - (1 - c) * fraction))
				else if (node.local === 'shade') linear.forEach((c, i) => (linear[i] = c * fraction))
				else if (node.local.endsWith('Mod')) linear[channel] *= fraction
				else if (node.local.endsWith('Off')) linear[channel] += fraction
				else linear[channel] = fraction
				;({r, g, b} = fromLinear(linear[0], linear[1], linear[2]))
				break
			}
			case 'hue':
			case 'hueMod':
			case 'hueOff':
			case 'sat':
			case 'satMod':
			case 'satOff':
			case 'lum':
			case 'lumMod':
			case 'lumOff':
			case 'comp': {
				let [h, s, l] = toHsl(r, g, b)
				if (node.local === 'hue') h = angle
				else if (node.local === 'hueMod') h *= fraction
				else if (node.local === 'hueOff') h += angle
				else if (node.local === 'comp') h += 180
				else if (node.local === 'sat') s = fraction
				else if (node.local === 'satMod') s *= fraction
				else if (node.local === 'satOff') s += fraction
				else if (node.local === 'lum') l = fraction
				else if (node.local === 'lumMod') l *= fraction
				else l += fraction
				;({r, g, b} = fromHsl(h, clamp(s), clamp(l)))
				break
			}
			case 'inv':
				r = 1 - r
				g = 1 - g
				b = 1 - b
				break
			case 'gray':
				r = g = b = 0.3 * r + 0.59 * g + 0.11 * b
				break
			case 'gamma':
				r = fromLinearChannel(r)
				g = fromLinearChannel(g)
				b = fromLinearChannel(b)
				break
			case 'invGamma':
				r = toLinear(r)
				g = toLinear(g)
				b = toLinear(b)
				break
		}
		r = clamp(r)
		g = clamp(g)
		b = clamp(b)
		a = clamp(a)
	}
	return {r, g, b, a}
}

const clamp = (value: number) => (value > 1 ? 1 : value > 0 ? value : 0)

// Names come from the document, so lookups never reach into the object's prototype
const own = <T>(record: Readonly<Record<string, T>>, key: string) =>
	Object.hasOwn(record, key) ? record[key] : undefined

const number = (element: XmlElement, name: string) => {
	const value = Number(attr(element, name) ?? 0)
	return Number.isFinite(value) ? value : 0
}

// Percentages are written in thousandths (100000 = 100%), sometimes with a % sign in strict files
const percent = (element: XmlElement, name: string) => {
	const raw = attr(element, name) ?? '0'
	const value = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw) / 100000
	return Number.isFinite(value) ? value : 0
}

function fromHex(value: string | undefined): Rgba | undefined {
	if (!value || !/^[0-9a-fA-F]{6}$/.test(value)) return undefined
	const n = parseInt(value, 16)
	return {r: (n >> 16) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255, a: 1}
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinearChannel = (c: number) => {
	const v = clamp(c)
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}
const fromLinear = (r: number, g: number, b: number): Rgba => ({
	r: fromLinearChannel(r),
	g: fromLinearChannel(g),
	b: fromLinearChannel(b),
	a: 1,
})

// sRGB channels as hue in degrees (0–360), saturation and luminance (0–1), and back
export function toHsl(r: number, g: number, b: number): [number, number, number] {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	const d = max - min
	if (d === 0) return [0, 0, l]
	const s = d / (1 - Math.abs(2 * l - 1))
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return [(h * 60 + 360) % 360, s, l]
}

export function fromHsl(hue: number, s: number, l: number): Rgba {
	const h = (((hue % 360) + 360) % 360) / 60
	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs((h % 2) - 1))
	const m = l - c / 2
	const [r, g, b] =
		h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
	return {r: r + m, g: g + m, b: b + m, a: 1}
}

// A preset colour by name: DrawingML's, or the CSS name it abbreviates (which is what VML writes)
export const presetColor = (name: string): Rgba | undefined => fromHex(PRESET_COLORS.get(presetName(name)))

// DrawingML's preset colour names are the CSS ones, abbreviated: dkBlue, ltGray, medPurple, …
const presetName = (name: string) =>
	name
		.replace(/^(dk|lt|med)(?=[A-Z])/, (prefix) => ({dk: 'dark', lt: 'light', med: 'medium'})[prefix]!)
		.toLowerCase()
		.replace('grey', 'gray')

const PRESET_COLORS = new Map(
	(
		'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
		'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 ' +
		'cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc ' +
		'crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 ' +
		'darkgreen:006400 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 ' +
		'darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b ' +
		'darkslategray:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff ' +
		'dimgray:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff ' +
		'gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 ' +
		'greenyellow:adff2f honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 ' +
		'khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 ' +
		'lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 ' +
		'lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 ' +
		'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff ' +
		'maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db ' +
		'mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc ' +
		'mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
		'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 ' +
		'orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
		'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd ' +
		'powderblue:b0e0e6 purple:800080 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 ' +
		'salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 ' +
		'skyblue:87ceeb slateblue:6a5acd slategray:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 ' +
		'tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
		'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'
	)
		.split(' ')
		.map((entry) => entry.split(':') as [string, string]),
)
