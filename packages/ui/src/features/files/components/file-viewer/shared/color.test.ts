import {describe, expect, test} from 'vitest'

import {fromHsl, parseColor, presetColor, schemeColor, schemeColors, toCss, toHsl, type ColorContext} from './color'
import {parseXml} from './xml'

// Office 2013's scheme, which a theme without one gets
const context: ColorContext = {
	scheme: schemeColors(undefined),
	map: {bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2'},
}
const color = (xml: string, ctx = context) => {
	const parsed = parseColor(parseXml(xml), ctx)
	return parsed && toCss(parsed)
}
const scheme = (name: string, transforms = '') => color(`<a:schemeClr val="${name}">${transforms}</a:schemeClr>`)
const mod = (lumMod: number, lumOff?: number) =>
	`<a:lumMod val="${lumMod}"/>${lumOff === undefined ? '' : `<a:lumOff val="${lumOff}"/>`}`
// PowerPoint rounds inside its HSL conversion slightly differently from the standard formulas (LibreOffice's are
// ours): some darkest swatches land one unit away in a channel, which no eye can see
const channels = (css: string | undefined) => (css?.match(/[0-9a-f]{2}/g) ?? []).map((pair) => parseInt(pair, 16))
const near = (actual: string | undefined, expected: string) =>
	channels(actual).every((value, i) => Math.abs(value - channels(expected)[i]) <= 1) && channels(actual).length === 3

describe('theme palette variants match PowerPoint’s colour picker', () => {
	// Office 2013+ "Lighter 80/60/40%" and "Darker 25/50%" swatches, as PowerPoint writes them (lumMod/lumOff)
	test.each([
		['accent1', ['#dae3f3', '#b4c7e7', '#8faadc', '#2f5597', '#203864']],
		['accent2', ['#fbe5d6', '#f8cbad', '#f4b183', '#c55a11', '#843c0c']],
		['accent3', ['#ededed', '#dbdbdb', '#c9c9c9', '#7c7c7c', '#525252']],
		['accent4', ['#fff2cc', '#ffe699', '#ffd966', '#bf9000', '#7f6000']],
		['tx2', ['#d6dce5', '#adb9ca', '#8497b0', '#333f50', '#222a35']],
	])('%s', (name, [lighter80, lighter60, lighter40, darker25, darker50]) => {
		expect(scheme(name, mod(20000, 80000))).toBe(lighter80)
		expect(scheme(name, mod(40000, 60000))).toBe(lighter60)
		expect(scheme(name, mod(60000, 40000))).toBe(lighter40)
		expect(scheme(name, mod(75000))).toBe(darker25)
		expect(near(scheme(name, mod(50000)), darker50)).toBe(true)
	})

	test('tints and shades work in linear light, matching the default table style', () => {
		// Medium Style 2 – Accent 1: body rows are accent1 tinted 20% and 40%
		expect(scheme('accent1', '<a:tint val="20000"/>')).toBe('#e9ebf5')
		expect(scheme('accent1', '<a:tint val="40000"/>')).toBe('#cfd5ea')
		// …and with the Office 2007 theme's accent1, PowerPoint 2007's familiar table bands
		expect(color('<a:srgbClr val="4F81BD"><a:tint val="40000"/></a:srgbClr>')).toBe('#d0d8e8')
		expect(color('<a:srgbClr val="4F81BD"><a:tint val="20000"/></a:srgbClr>')).toBe('#e9edf4')
		expect(color('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>')).toBe('#bcbcbc')
		expect(color('<a:srgbClr val="808080"><a:tint val="100000"/><a:shade val="100000"/></a:srgbClr>')).toBe('#808080')
	})
})

describe('colour models', () => {
	test('scheme names go through the colour map; dk/lt names are direct', () => {
		expect(scheme('tx1')).toBe('#000000')
		expect(scheme('bg1')).toBe('#ffffff')
		expect(scheme('dk2')).toBe('#44546a')
		const dark = {...context, map: {...context.map, bg1: 'dk1', tx1: 'lt1'}}
		expect(color('<a:schemeClr val="bg1"/>', dark)).toBe('#000000')
		expect(color('<a:schemeClr val="tx1"/>', dark)).toBe('#ffffff')
	})

	test('phClr is the colour a style reference passes in', () => {
		expect(scheme('phClr')).toBeUndefined()
		const styled = {...context, placeholder: context.scheme.accent2}
		expect(color('<a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr>', styled)).toBe('#ae5a21')
	})

	test('preset colours use the CSS values under their DrawingML names', () => {
		expect(color('<a:prstClr val="black"/>')).toBe('#000000')
		expect(color('<a:prstClr val="dkBlue"/>')).toBe('#00008b')
		expect(color('<a:prstClr val="ltGray"/>')).toBe('#d3d3d3')
		expect(color('<a:prstClr val="medPurple"/>')).toBe('#9370db')
		expect(color('<a:prstClr val="darkSlateGrey"/>')).toBe('#2f4f4f')
		expect(color('<a:prstClr val="nope"/>')).toBeUndefined()
	})

	test('a preset by name, as DrawingML abbreviates it or as VML writes it', () => {
		expect(toCss(presetColor('dkBlue')!)).toBe('#00008b')
		expect(toCss(presetColor('Navy')!)).toBe('#000080')
		expect(toCss(presetColor('grey')!)).toBe('#808080')
		expect(presetColor('nope')).toBeUndefined()
		expect(presetColor('constructor')).toBeUndefined()
	})

	test('HSL both ways, for an engine that sets luminance itself', () => {
		const [h, s, l] = toHsl(0x44 / 255, 0x72 / 255, 0xc4 / 255)
		expect([h, s, l].map((value) => Math.round(value * 1000) / 1000)).toEqual([218.438, 0.52, 0.518])
		expect(toCss(fromHsl(h, s, l))).toBe('#4472c4')
		expect(toCss(fromHsl(h, s, l * 0.75))).toBe('#2f5597')
	})

	test('system colours use their saved value', () => {
		expect(color('<a:sysClr val="windowText" lastClr="1F1F1F"/>')).toBe('#1f1f1f')
		expect(color('<a:sysClr val="window"/>')).toBe('#ffffff')
		expect(color('<a:sysClr val="windowText"/>')).toBe('#000000')
	})

	test('scRGB is linear light; HSL is hue, saturation, luminance', () => {
		expect(color('<a:scrgbClr r="0" g="0" b="0"/>')).toBe('#000000')
		expect(color('<a:scrgbClr r="100000" g="100000" b="100000"/>')).toBe('#ffffff')
		expect(color('<a:scrgbClr r="50000" g="50000" b="50000"/>')).toBe('#bcbcbc')
		expect(color('<a:scrgbClr r="100%" g="0%" b="0%"/>')).toBe('#ff0000')
		expect(color('<a:hslClr hue="14400000" sat="100000" lum="50000"/>')).toBe('#0000ff')
	})

	test('transforms apply in document order', () => {
		expect(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>')).toBe('rgba(255, 0, 0, 0.5)')
		expect(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/><a:alphaMod val="50000"/></a:srgbClr>')).toBe(
			'rgba(255, 0, 0, 0.25)',
		)
		expect(color('<a:srgbClr val="FF0000"><a:comp/></a:srgbClr>')).toBe('#00ffff')
		expect(color('<a:srgbClr val="FF0000"><a:inv/></a:srgbClr>')).toBe('#00ffff')
		expect(color('<a:srgbClr val="FF0000"><a:hueOff val="7200000"/></a:srgbClr>')).toBe('#00ff00')
		expect(color('<a:srgbClr val="FF0000"><a:satMod val="0"/></a:srgbClr>')).toBe('#808080')
		expect(color('<a:srgbClr val="FF8000"><a:gray/></a:srgbClr>')).toBe('#989898')
		// Luminance clamps rather than wrapping
		expect(color('<a:srgbClr val="808080"><a:lumOff val="90000"/></a:srgbClr>')).toBe('#ffffff')
	})

	test('a transform’s percentage may be written with a % sign, as strict files do', () => {
		expect(color('<a:srgbClr val="FF0000"><a:alpha val="50%"/></a:srgbClr>')).toBe(
			color('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>'),
		)
		expect(scheme('accent1', '<a:lumMod val="75%"/>')).toBe('#2f5597')
		expect(scheme('accent1', '<a:lumMod val="75000"/>')).toBe('#2f5597')
	})

	test('hue modulation scales the hue as an angle round the colour wheel', () => {
		// Magenta is at 300°: half of that is spring green
		expect(color('<a:srgbClr val="FF00FF"><a:hueMod val="50000"/></a:srgbClr>')).toBe('#00ff80')
	})

	test('a theme’s scheme, with Office’s colours for what it leaves out', () => {
		const scheme = schemeColors(
			parseXml(
				'<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:accent1><a:srgbClr val="5865F2"/></a:accent1>' +
					'<a:accent2><a:srgbClr val="nope"/></a:accent2><a:constructor><a:srgbClr val="FF0000"/></a:constructor></a:clrScheme>',
			),
		)
		expect(Object.keys(scheme)).toHaveLength(12)
		expect(toCss(scheme.dk1)).toBe('#111111')
		expect(toCss(scheme.accent1)).toBe('#5865f2')
		expect(toCss(scheme.accent2)).toBe('#ed7d31')
		expect(toCss(scheme.lt2)).toBe('#e7e6e6')
		expect(Object.hasOwn(scheme, 'constructor')).toBe(false)
	})

	test('scheme colours by any name, never by one every object inherits', () => {
		expect(toCss(schemeColor(context, 'tx1')!)).toBe('#000000')
		expect(toCss(schemeColor(context, 'accent1')!)).toBe('#4472c4')
		const crafted = {...context, map: {...context.map, tx1: 'constructor', hlink: 'toString'}}
		for (const name of ['tx1', 'hlink', 'constructor', '__proto__']) expect(schemeColor(crafted, name)).toBeUndefined()
	})

	test('malformed values are ignored, not thrown', () => {
		expect(color('<a:srgbClr val="xyz"/>')).toBeUndefined()
		expect(color('<a:srgbClr val="FF0000"><a:lumMod val="NaN"/></a:srgbClr>')).toBe('#000000')
		expect(color('<a:srgbClr val="FF0000"><a:alpha val="-5"/></a:srgbClr>')).toBe('rgba(255, 0, 0, 0)')
		expect(color('<a:schemeClr val="__proto__"/>')).toBeUndefined()
		expect(color('<a:schemeClr val="constructor"/>')).toBeUndefined()
	})
})
