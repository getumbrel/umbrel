// Slide models from real decks and purpose-built ones: inheritance, theme colours, groups, tables, autofit, notes.
// Models are plain data, so these run without a DOM.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'vitest'

import {loadPresentation, PresentationError} from '@/features/files/components/file-viewer/slides-viewer/engine'
import type {
	ShapeElement,
	SlideModel,
	TableElement,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import {
	buildDeck,
	DECKS,
	flatten,
	placeholder,
	rels,
	shape,
	slide,
	textOf,
	xfrm,
	zip,
} from '@/features/files/components/file-viewer/slides-viewer/engine/test-pptx'
import {formatNumber} from '@/features/files/components/file-viewer/slides-viewer/engine/text'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''
const fixture = (path: string) => join(FIXTURES, path)
const hasFixtures = Boolean(FIXTURES) && existsSync(fixture('Samples/PowerPoint/deck.pptx'))
const load = (path: string) => loadPresentation(new Uint8Array(readFileSync(fixture(path))))

// The first shape whose text starts with `start`
function find(model: SlideModel, start: string): ShapeElement {
	const found = flatten(model.elements).find((element) => element.kind === 'shape' && textOf(element).startsWith(start))
	if (!found) throw new Error(`No shape starting "${start}"`)
	return found as ShapeElement
}
const near = (value: number, expected: number, digits = 1) => expect(value).toBeCloseTo(expected, digits)

describe.skipIf(!hasFixtures)('fixtures', () => {
	test.each(DECKS)('%s: every slide builds, with finite geometry', async (path) => {
		const deck = await load(path)
		expect(deck.slides.length).toBeGreaterThan(0)
		for (let i = 0; i < deck.slides.length; i++) {
			const model = deck.model(i)
			for (const element of flatten(model.elements)) {
				expect(Object.values(element.box).every(Number.isFinite)).toBe(true)
			}
			expect(model.elements.length + (model.background ? 1 : 0)).toBeGreaterThan(0)
			deck.notes(i)
		}
	})

	test('a truncated deck is reported as corrupt, not hung on', async () => {
		await expect(load('Samples2/PowerPoint/corrupt-truncated.pptx')).rejects.toMatchObject({
			name: 'PresentationError',
			code: 'corrupt',
		})
	})

	test('slide size, hidden slides, notes and approximated content', async () => {
		const features = await load('Samples2/PowerPoint/features-16x9.pptx')
		expect(features.slideSize).toEqual({width: 1280, height: 720})
		expect(features.slides.map((s) => s.hidden).indexOf(true)).toBe(12)
		expect(features.notes(0)).toBe(
			'Speaker notes on the title slide. Present mode should show these to the presenter only.',
		)
		expect(features.notes(8)).toBe('')
		expect([...features.approximated]).toEqual(['charts'])
		const long = await load('Samples2/PowerPoint/long-40-slides.pptx')
		expect(long.slides).toHaveLength(40)
		for (let i = 0; i < 40; i++) expect(long.notes(i)).toMatch(new RegExp(`^Notes for slide ${i + 1}\\. `))
		expect((await load('Samples2/PowerPoint/deck-4x3.pptx')).slideSize).toEqual({width: 960, height: 720})
		expect([...(await load('Samples/PowerPoint/EmbeddedVideo.pptx')).approximated]).toEqual(['media'])
		// An EMF picture on the slide
		expect([...(await load('Samples/PowerPoint/KEY02.pptx')).approximated]).toEqual(['pictures'])
	})

	test('placeholders inherit position and text styles through layout and master', async () => {
		const model = (await load('Samples2/PowerPoint/features-16x9.pptx')).model(1)
		const title = find(model, 'Bullets at five levels')
		// The slide's title has no geometry of its own: the master's (widened to 16:9) applies
		expect(title.box.x).toBeCloseTo(64, 1)
		expect(title.box.y).toBeCloseTo(274638 / 9525, 1)
		expect(title.box.w).toBeCloseTo(1152, 1)
		const titleRun = title.text!.paragraphs[0].runs[0]
		expect(title.text!.paragraphs[0].align).toBe('center')
		expect(title.text!.anchor).toBe('middle')
		expect(titleRun.style.size).toBeCloseTo((44 * 96) / 72, 3)
		expect(titleRun.style.family.startsWith('"Calibri"')).toBe(true)
		expect(titleRun.style.color).toBe('#000000')

		const body = find(model, 'Level 0').text!.paragraphs
		body.forEach((p, i) => near(p.runs[0].style.size, ([32, 28, 24, 20, 20, 32][i] * 96) / 72, 6))
		expect(body.map((p) => p.bullet?.text)).toEqual(['•', '–', '•', '–', '»', '•'])
		expect(body[0].bullet!.style.family.startsWith('"Arial"')).toBe(true)
		expect(body[0].marginLeft).toBeCloseTo(36, 3)
		expect(body[0].indent).toBeCloseTo(-36, 3)
		expect(body[1].marginLeft).toBeCloseTo(742950 / 9525, 3)
		// 20% space before, as a fraction of a line
		expect(body[1].spaceBefore).toBeCloseTo(0.2 * 1.2 * ((28 * 96) / 72), 3)

		const runs = body[5].runs.filter((run) => run.kind === 'text')
		expect(runs.map((run) => run.text)).toEqual([
			'Mixed runs: ',
			'bold',
			', ',
			'italic',
			', ',
			'brand colour',
			', and a ',
			'hyperlink',
		])
		expect(runs[1].style.bold).toBe(true)
		expect(runs[3].style.italic).toBe(true)
		expect(runs[5].style.color).toBe('#5865f2')
		// Hyperlinks draw in the theme's hyperlink colour, underlined, and keep only web and mail targets
		expect(runs[7]).toMatchObject({href: 'https://umbrel.com/', style: {color: '#0000ff', underline: 'solid'}})
	})

	test('theme colours through lumMod/lumOff, as PowerPoint 2007’s palette', async () => {
		const model = (await load('Samples2/PowerPoint/preset-shapes-poi.pptx')).model(5)
		const fills = flatten(model.elements)
			.filter((element): element is ShapeElement => element.kind === 'shape' && element.fill?.kind === 'solid')
			.map((element) => (element.fill as {color: string}).color)
		const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
		const expected = ['#4f81bd', '#dce6f2', '#b9cde5', '#95b3d7', '#376092', '#254061']
		expect(fills).toHaveLength(6)
		fills.forEach((fill, i) =>
			channels(fill).forEach((value, c) => expect(Math.abs(value - channels(expected[i])[c])).toBeLessThanOrEqual(1)),
		)
	})

	test('group children are laid out in the group’s child space', async () => {
		const model = (await load('Samples2/PowerPoint/features-16x9.pptx')).model(11)
		const group = model.elements.find((element) => element.kind === 'group')!
		expect(group.box).toEqual({x: 96, y: 288, w: 1056, h: 144})
		if (group.kind !== 'group') throw new Error()
		expect(group.children.map((child) => [child.box.x, child.box.y, child.box.w, child.box.h])).toEqual([
			[0, 0, 288, 144],
			[288, 72, 96, 0],
			[384, 0, 288, 144],
			[672, 72, 96, 0],
			[768, 0, 288, 144],
		])
		const connector = group.children[1] as ShapeElement
		expect(connector.line).toMatchObject({width: (2 * 96) / 72, tail: {type: 'triangle', width: 3, length: 3}})
		// …and stops inside its arrowhead, 1.5 line widths short of the tip
		expect(connector.paths[0].segments.at(-1)).toEqual({op: 'L', to: [96 - Math.round(1.5 * (8 / 3) * 100) / 100, 0]})
	})

	test('stored autofit scales text and line spacing', async () => {
		const model = (await load('Samples2/PowerPoint/features-16x9.pptx')).model(3)
		const fit = find(model, 'Shrink text on overflow')
		const paragraph = fit.text!.paragraphs[0]
		expect(paragraph.runs[0].style.size).toBeCloseTo(((20 * 96) / 72) * 0.625, 3)
		expect(paragraph.lineHeight).toEqual({multiple: (1 - 0.2) * 1.2})
		expect(find(model, 'word_wrap off').text!.wrap).toBe(false)
		expect(find(model, 'Two text columns').text!.columns.count).toBe(2)
		near(find(model, 'Two text columns').text!.columns.gap, 0.2 * 96, 6)
		expect(find(model, 'Anchored bottom').text!.anchor).toBe('bottom')
		expect(find(model, 'مرحبا').text!.paragraphs[0]).toMatchObject({rtl: true, align: 'right'})
	})

	test('fills, outlines and pictures', async () => {
		const deck = await load('Samples2/PowerPoint/features-16x9.pptx')
		const shapes = deck.model(2)
		expect(find(shapes, 'Rounded').rotation).toBe(8)
		expect(find(shapes, 'Ellipse').line).toMatchObject({dash: [4, 3], width: 2})
		expect(find(shapes, 'Cloud').fill).toEqual({kind: 'solid', color: 'rgba(148, 163, 184, 0.55)'})
		expect(find(shapes, 'Linear gradient').fill).toMatchObject({
			kind: 'linear',
			angle: 0,
			stops: [
				{at: 0, color: '#5865f2'},
				{at: 1, color: '#ec4899'},
			],
		})
		expect(find(shapes, 'Linear gradient').line).toBeUndefined()
		// Shapes take white text from their style's font reference
		expect(find(shapes, 'Rectangle').text!.paragraphs[0].runs[0].style.color).toBe('#ffffff')

		const pictures = flatten(deck.model(4).elements).filter(
			(element): element is ShapeElement => !!(element.kind === 'shape' && element.picture),
		)
		expect(pictures).toHaveLength(4)
		expect(pictures[1].picture).toMatchObject({kind: 'image', crop: {l: 0.25, t: 0.1, r: 0.25, b: 0.1}})
		expect(deck.model(11).background).toEqual({kind: 'solid', color: '#0f172a'})
		// python-pptx's 90° counter-clockwise is DrawingML's 270°: dark at the bottom, light at the top
		expect(deck.model(12).background).toMatchObject({kind: 'linear', angle: 270})
	})

	test('tables: grid, merges and the default table style', async () => {
		const table = (await load('Samples2/PowerPoint/features-16x9.pptx'))
			.model(5)
			.elements.find((element) => element.kind === 'table') as TableElement
		expect(table.columns).toHaveLength(5)
		expect(table.rows).toHaveLength(6)
		const cell = (row: number, col: number) => table.cells.find((c) => c.row === row && c.col === col)!
		const span = (sizes: number[], from: number, count: number) =>
			sizes.slice(from, from + count).reduce((sum, size) => sum + size, 0)
		// Merged cells cover their whole span
		expect(cell(4, 1).box).toMatchObject({w: span(table.columns, 1, 3), h: table.rows[4]})
		expect(cell(1, 4).box).toMatchObject({w: table.columns[4], h: span(table.rows, 1, 3)})
		expect(table.cells.find((c) => c.row === 4 && c.col === 2)).toBeUndefined()
		// Medium Style 2 – Accent 1 with the 2007 Office theme: accent header, banded rows, white rules
		expect(cell(0, 0).fill).toEqual({kind: 'solid', color: '#4f81bd'})
		expect(cell(0, 0).text.paragraphs[0].runs[0].style).toMatchObject({bold: true, color: '#ffffff'})
		expect(cell(1, 0).fill).toEqual({kind: 'solid', color: '#d0d8e8'})
		expect(cell(2, 0).fill).toEqual({kind: 'solid', color: '#e9edf4'})
		expect(cell(1, 0).borders.bottom).toMatchObject({width: (1 * 96) / 72, paint: {kind: 'solid', color: '#ffffff'}})
		expect(cell(0, 0).borders.bottom).toMatchObject({width: (3 * 96) / 72})
		// The cell's own fill wins over the style
		expect(cell(5, 2).fill).toEqual({kind: 'solid', color: '#fff2cc'})
		expect(cell(1, 1).text.paragraphs[0].align).toBe('right')
	})

	test('bullets defined on the paragraph, numbered and symbolic', async () => {
		const body = find((await load('Samples2/PowerPoint/features-16x9.pptx')).model(13), 'First numbered item').text!
			.paragraphs
		expect(body.map((p) => p.bullet?.text)).toEqual(['1.', '2.', '3.', '→', '→'])
	})

	test('a shape’s own style outranks what it inherits; text boxes use the presentation’s defaults', async () => {
		// customGeo's title: the master's title placeholder says no fill, the slide's own style fills it with accent 1
		const title = find((await load('Samples/PowerPoint/customGeo.pptx')).model(0), 'Ohio’s New Learning')
		expect(title.fill).toEqual({kind: 'solid', color: '#4f81bd'})
		expect(title.text!.paragraphs[0].runs[0].style.color).toBe('#ffffff')
		expect(title.shadow).toMatchObject({rotateWithShape: false, color: 'rgba(0, 0, 0, 0.4)'})
		// 2411's text box gets Trebuchet MS from defaultTextStyle, not the master's other style
		const credit = find((await load('Samples/PowerPoint/2411-Performance_Up.pptx')).model(0), 'Sander Temme')
		expect(credit.text!.paragraphs[0].runs[0].style.family.startsWith('"Trebuchet MS"')).toBe(true)
		// KEY02's title is white on its dark photo
		expect(
			find((await load('Samples/PowerPoint/KEY02.pptx')).model(0), 'Welcome to Internet').text!.paragraphs[0].runs[0]
				.style.color,
		).toBe('#ffffff')
	})

	test('slide numbers, SmartArt drawings and charts', async () => {
		const apache = await load('Samples/PowerPoint/2411-Performance_Up.pptx')
		const number = flatten(apache.model(4).elements).find((element) => textOf(element) === '5')
		expect(number).toBeDefined()
		const smartArt = (await load('Samples/PowerPoint/customGeo.pptx')).model(7)
		const diagram = smartArt.elements.find((element) => element.kind === 'group')!
		expect(textOf(diagram)).toContain('Reading Strand')
		// Diagram text is the diagram's, not the slide's: never offered for editing
		expect(smartArt.paragraphs).toHaveLength(0)
		const chart = (await load('Samples2/PowerPoint/features-16x9.pptx'))
			.model(6)
			.elements.filter((element) => element.kind === 'frame')
		expect(chart.map((frame) => (frame.kind === 'frame' ? frame.label : ''))).toEqual([
			'Storage growth (GB)',
			undefined,
		])
	})

	test('theme textures resolve through the theme part and keep their duotone', async () => {
		const background = (await load('Samples/PowerPoint/themes.pptx')).model(7).background
		// rId2 of the theme's own relationships, not the slide's or master's
		expect(background).toMatchObject({kind: 'image', part: 'ppt/media/image3.jpeg'})
		expect(background?.kind === 'image' && background.duotone).toHaveLength(2)
	})
})

describe('automatic numbering', () => {
	test.each([
		['arabicPeriod', [1, 2, 10], ['1.', '2.', '10.']],
		['arabicParenR', [3], ['3)']],
		['alphaLcParenBoth', [1, 26, 27, 28], ['(a)', '(z)', '(aa)', '(bb)']],
		['alphaUcPeriod', [2], ['B.']],
		['romanUcPeriod', [4, 9, 14, 1999], ['IV.', 'IX.', 'XIV.', 'MCMXCIX.']],
		['romanLcParenR', [3], ['iii)']],
		['circleNumDbPlain', [1, 20, 21], ['①', '⑳', '21.']],
		['circleNumWdBlackPlain', [1, 10], ['❶', '❿']],
		['ea1JpnKorPeriod', [5], ['5.']],
	])('%s', (scheme, values, expected) => {
		expect(values.map((value) => formatNumber(value, scheme))).toEqual(expected)
	})

	test('counts restart at a paragraph without numbering or a shallower level, and skip empty paragraphs', async () => {
		const numbered = (text: string, level = 0) =>
			`<a:p><a:pPr lvl="${level}"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>${text}</a:t></a:r></a:p>`
		const body =
			numbered('one') +
			'<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr></a:p>' +
			numbered('two') +
			numbered('nested a', 1) +
			numbered('nested b', 1) +
			numbered('three') +
			numbered('nested again', 1) +
			'<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>plain</a:t></a:r></a:p>' +
			numbered('restart')
		const model = (await loadPresentation(await buildDeck({slides: [slide(shape(xfrm(0, 0, 100, 100), body))]}))).model(
			0,
		)
		expect(find(model, 'one').text!.paragraphs.map((p) => p.bullet?.text)).toEqual([
			'1.',
			undefined,
			'2.',
			'1.',
			'2.',
			'3.',
			'1.',
			undefined,
			'1.',
		])
	})
})

describe('inheritance in purpose-built decks', () => {
	test('placeholders match by index, then type; layout overrides master', async () => {
		const bytes = await buildDeck({
			master:
				placeholder('title', undefined, xfrm(100, 100, 1000, 500)) +
				placeholder('body', '1', xfrm(100, 700, 1000, 3000)) +
				placeholder('dt', '2', xfrm(0, 6000000, 100, 100)),
			layout: placeholder('title', undefined, '') + placeholder(undefined, '13', xfrm(5000, 5000, 2000, 2000)),
			slides: [
				slide(
					placeholder('title', undefined, '', '<a:p><a:r><a:t>Title</a:t></a:r></a:p>') +
						placeholder(undefined, '13', '', '<a:p><a:r><a:t>By index</a:t></a:r></a:p>') +
						placeholder('body', '42', '', '<a:p><a:r><a:t>By type</a:t></a:r></a:p>') +
						placeholder('pic', '99', ''),
				),
			],
		})
		const model = (await loadPresentation(bytes)).model(0)
		const px = (emu: number) => emu / 9525
		expect(find(model, 'Title').box).toEqual({x: px(100), y: px(100), w: px(1000), h: px(500)})
		expect(find(model, 'By index').box).toEqual({x: px(5000), y: px(5000), w: px(2000), h: px(2000)})
		// No layout placeholder with idx 42: the master's body supplies geometry and the body text style
		const body = find(model, 'By type')
		expect(body.box).toEqual({x: px(100), y: px(700), w: px(1000), h: px(3000)})
		expect(body.text!.paragraphs[0].bullet?.text).toBe('•')
		expect(find(model, 'Title').text!.paragraphs[0].bullet).toBeUndefined()
		// Placeholders on masters and layouts never show by themselves; an empty slide placeholder draws nothing
		expect(model.elements).toHaveLength(3)
	})

	test('master and layout shapes draw beneath, unless hidden', async () => {
		const decoration = shape(
			xfrm(0, 0, 100, 100) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
			'<a:p><a:r><a:t>Logo</a:t></a:r></a:p>',
		)
		const options = {master: decoration, layout: decoration.replace('Logo', 'Band')}
		const shown = (await loadPresentation(await buildDeck({...options, slides: [slide('')]}))).model(0)
		expect(shown.elements.map(textOf)).toEqual(['Logo', 'Band'])
		const hidden = (
			await loadPresentation(await buildDeck({...options, slides: [slide('', ' showMasterSp="0"')]}))
		).model(0)
		expect(hidden.elements).toEqual([])
	})

	test('scaled, nested groups', async () => {
		const child = shape(
			xfrm(10, 10, 20, 10) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>',
		)
		const group = (inner: string, x: number, chExt: number) =>
			`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>` +
			`<a:xfrm rot="5400000" flipH="1"><a:off x="${x}" y="${x}"/><a:ext cx="200" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="${chExt}" cy="${chExt / 2}"/></a:xfrm>` +
			`</p:grpSpPr>${inner}</p:grpSp>`
		const tree = group(group(child, 0, 400), 1000, 100)
		const model = (await loadPresentation(await buildDeck({slides: [slide(tree)]}))).model(0)
		const outer = model.elements[0]
		expect(outer).toMatchObject({kind: 'group', rotation: 90, flipH: true})
		if (outer.kind !== 'group') throw new Error()
		const px = 1 / 9525
		near(outer.box.x, 1000 * px, 6)
		// The outer group doubles child space; the inner one (200 wide over 400 child units) halves it again
		const inner = outer.children[0]
		near(inner.box.w, 400 * px, 6)
		if (inner.kind !== 'group') throw new Error()
		const leaf = inner.children[0]
		near(leaf.box.x, 10 * px, 6)
		near(leaf.box.w, 20 * px, 6)
	})

	test('hyperlinks keep only web and mail targets', async () => {
		const link = (id: string, text: string) =>
			`<a:r><a:rPr><a:hlinkClick r:id="${id}"/></a:rPr><a:t>${text}</a:t></a:r>`
		const bytes = await buildDeck({
			slides: [
				slide(
					shape(
						xfrm(0, 0, 100, 100),
						`<a:p>${link('rId2', 'web')}${link('rId3', 'script')}${link('rId4', 'mail')}${link('rId5', 'slide')}${link('rId9', 'missing')}</a:p>`,
					),
				),
			],
			slideRels: [
				[
					['rId2', 'hyperlink', 'https://example.com/a?b=c', true],
					['rId3', 'hyperlink', 'javascript:alert(1)', true],
					['rId4', 'hyperlink', 'mailto:someone@example.com', true],
					['rId5', 'slide', 'slide2.xml'],
				],
			],
		})
		const runs = find((await loadPresentation(bytes)).model(0), 'web').text!.paragraphs[0].runs
		expect(runs.map((run) => (run.kind === 'text' ? (run.href ?? null) : null))).toEqual([
			'https://example.com/a?b=c',
			null,
			'mailto:someone@example.com',
			null,
			null,
		])
	})

	test('markup-compatibility fallbacks are drawn but never editable', async () => {
		const sp = shape(xfrm(0, 0, 100, 100), '<a:p><a:r><a:t>Fallback</a:t></a:r></a:p>')
		const tree =
			`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p14">` +
			`${sp.replace('Fallback', 'Choice')}</mc:Choice><mc:Fallback>${sp}</mc:Fallback></mc:AlternateContent>` +
			shape(xfrm(0, 200, 100, 100), '<a:p><a:r><a:t>Plain</a:t></a:r></a:p>')
		const model = (await loadPresentation(await buildDeck({slides: [slide(tree)]}))).model(0)
		expect(model.elements.map(textOf)).toEqual(['Fallback', 'Plain'])
		expect(model.paragraphs).toHaveLength(1)
		expect(find(model, 'Fallback').text!.paragraphs[0].key).toBeUndefined()
		expect(find(model, 'Plain').text!.paragraphs[0].key).toBe(0)
	})
})

describe('hostile and broken decks', () => {
	const open = async (parts: Record<string, string | Uint8Array>) => loadPresentation(await zip(parts))

	test('not a deck', async () => {
		await expect(loadPresentation(new TextEncoder().encode('hello'))).rejects.toMatchObject({code: 'corrupt'})
		// A legacy .ppt is an OLE compound file, and so is a password-protected deck: Office puts its package in an
		// EncryptedPackage stream, named in one of the file's 128-byte directory entries
		const ole = new Uint8Array(640)
		ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
		await expect(loadPresentation(ole)).rejects.toMatchObject({code: 'unsupported'})
		ole.set(
			[...'EncryptedPackage'].flatMap((c) => [c.charCodeAt(0), 0]),
			512,
		)
		ole[512 + 64] = 34
		await expect(loadPresentation(ole)).rejects.toMatchObject({code: 'encrypted'})
		await expect(open({'hello.txt': 'hi'})).rejects.toBeInstanceOf(PresentationError)
		await expect(
			open({
				'_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
				'word/document.xml': '<w:document xmlns:w="w"/>',
			}),
		).rejects.toMatchObject({code: 'unsupported'})
	})

	test('a DOCTYPE in the presentation part is refused; in a slide it costs only that slide', async () => {
		const doctype = '<!DOCTYPE p:sld [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
		const good = slide(shape(xfrm(0, 0, 100, 100), '<a:p><a:r><a:t>Fine</a:t></a:r></a:p>'))
		const deck = await loadPresentation(await buildDeck({slides: [doctype + good, good]}))
		expect(deck.model(0).elements).toEqual([])
		expect(textOf(deck.model(1).elements[0])).toBe('Fine')
		const parts = await buildDeck({slides: [good]})
		const {ZipArchive, patchZip} = await import('@/features/files/components/file-viewer/shared/zip')
		const archive = ZipArchive.open(parts)
		const presentation = await archive.text('ppt/presentation.xml')
		const broken = await patchZip(archive, new Map([['ppt/presentation.xml', doctype + presentation]]))
		await expect(loadPresentation(broken)).rejects.toMatchObject({code: 'corrupt'})
	})

	test('missing layouts, masters and themes still draw the slide', async () => {
		const bytes = await buildDeck({
			slides: [slide(shape(xfrm(0, 0, 100, 100), '<a:p><a:r><a:t>Alone</a:t></a:r></a:p>'))],
		})
		const {ZipArchive, patchZip} = await import('@/features/files/components/file-viewer/shared/zip')
		const stripped = await patchZip(
			ZipArchive.open(bytes),
			new Map([
				['ppt/slideLayouts/slideLayout1.xml', null],
				['ppt/slideMasters/slideMaster1.xml', null],
				['ppt/theme/theme1.xml', null],
			]),
		)
		const model = (await loadPresentation(stripped)).model(0)
		expect(textOf(model.elements[0])).toBe('Alone')
		expect(model.elements[0].kind === 'shape' && model.elements[0].text!.paragraphs[0].runs[0].style.color).toBe(
			'#000000',
		)
	})

	test('deep nesting, huge counts and absurd numbers are capped', async () => {
		const deep = '<p:grpSp><p:grpSpPr/>'.repeat(300) + '</p:grpSp>'.repeat(300)
		const many = shape(
			xfrm(0, 0, 10, 10) + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
		).repeat(20000)
		const absurd = shape(
			'<a:xfrm rot="99999999999"><a:off x="-1e300" y="NaN"/><a:ext cx="1e300" cy="-5"/></a:xfrm><a:prstGeom prst="star32"><a:avLst><a:gd name="adj" fmla="val 1e308"/></a:avLst></a:prstGeom>',
			'<a:p><a:pPr lvl="99" marL="1e300"/><a:r><a:rPr sz="999999999" spc="-1e300" baseline="1e9"/><a:t>x</a:t></a:r></a:p>',
		)
		const deck = await loadPresentation(await buildDeck({slides: [slide(deep), slide(many), slide(absurd)]}))
		expect(deck.model(0).elements).toEqual([])
		expect(flatten(deck.model(1).elements)).toHaveLength(10000)
		const element = deck.model(2).elements[0] as ShapeElement
		expect(Object.values(element.box).every(Number.isFinite)).toBe(true)
		expect(
			element.paths.every((path) =>
				path.segments.every((s) =>
					Object.values(s)
						.flat()
						.every((v) => typeof v !== 'number' || Number.isFinite(v)),
				),
			),
		).toBe(true)
		const run = element.text!.paragraphs[0].runs[0]
		expect(Number.isFinite(run.style.size) && run.style.size <= 4000 * (96 / 72)).toBe(true)
		expect(Math.abs(run.style.baseline)).toBeLessThanOrEqual(1)
	})

	test('names that collide with object prototypes are just unknown values', async () => {
		const tricky = shape(
			`${xfrm(0, 0, 100, 100)}<a:prstGeom prst="constructor"/><a:solidFill><a:schemeClr val="__proto__"/></a:solidFill>` +
				'<a:ln w="9525" cap="constructor"><a:solidFill><a:prstClr val="toString"/></a:solidFill><a:prstDash val="hasOwnProperty"/><a:tailEnd type="constructor"/></a:ln>',
			'<a:p><a:r><a:rPr u="constructor" strike="__proto__"><a:latin typeface="constructor"/></a:rPr><a:t>ok</a:t></a:r></a:p>',
		).replace('<a:bodyPr/>', '<a:bodyPr vert="constructor" anchor="__proto__"/>')
		const element = (await loadPresentation(await buildDeck({slides: [slide(tricky)]}))).model(0)
			.elements[0] as ShapeElement
		expect(element.paths).toHaveLength(1)
		expect(element.fill).toBeUndefined()
		expect(element.text!.vertical).toBeUndefined()
		expect(element.text!.paragraphs[0].runs[0].style.underline).toBeUndefined()
		expect(element.text!.paragraphs[0].runs[0].style.family).toBe('"constructor", sans-serif')
	})

	test('a colour map naming what every object inherits leaves text in the default colour', async () => {
		const link = '<a:r><a:rPr><a:hlinkClick r:id="rId2"/></a:rPr><a:t>link</a:t></a:r>'
		const xml = slide(shape(xfrm(0, 0, 100, 100), `<a:p><a:r><a:t>plain</a:t></a:r>${link}</a:p>`)).replace(
			'</p:sld>',
			'<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="constructor" hlink="toString"/></p:clrMapOvr></p:sld>',
		)
		const bytes = await buildDeck({slides: [xml], slideRels: [[['rId2', 'hyperlink', 'https://example.com/', true]]]})
		const element = (await loadPresentation(bytes)).model(0).elements[0] as ShapeElement
		expect(element.text!.paragraphs[0].runs.map((run) => run.style.color)).toEqual(['#000000', '#000000'])
	})

	test('a picture with an SVG draws the PNG Office saves beside it; an SVG alone is left out, like EMF', async () => {
		const svgBlip =
			'<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip ' +
			'xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId3"/></a:ext></a:extLst>'
		const deck = async (blip: string) =>
			loadPresentation(
				await buildDeck({
					slides: [
						slide(
							`<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill>${blip}</p:blipFill>` +
								`<p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`,
						),
					],
					slideRels: [
						[
							['rId2', 'image', '../media/image1.png'],
							['rId3', 'image', '../media/image2.svg'],
						],
					],
					parts: {
						'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
						'ppt/media/image2.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
					},
				}),
			)
		const withPng = await deck(`<a:blip r:embed="rId2">${svgBlip}</a:blip>`)
		expect((withPng.model(0).elements[0] as ShapeElement).picture).toMatchObject({part: 'ppt/media/image1.png'})
		expect([...withPng.approximated]).toEqual([])
		expect([...(await deck('<a:blip r:embed="rId3"/>')).approximated]).toEqual(['pictures'])
	})

	test('relationship targets can’t climb out of the package, and backslashes are slashes', async () => {
		const pic = (id: string) =>
			`<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${id}"/></p:blipFill><p:spPr>` +
			xfrm(0, 0, 10, 10) +
			'</p:spPr></p:pic>'
		const bytes = await buildDeck({
			slides: [slide(pic('rId2') + pic('rId3'))],
			slideRels: [
				[
					['rId2', 'image', '../../../../../../media/x.png'],
					['rId3', 'image', '..\\media\\y.png'],
				],
			],
			parts: {'media/x.png': new Uint8Array([1, 2, 3]), 'ppt/media/y.png': new Uint8Array([1, 2, 3])},
		})
		const [climbing, backslashed] = (await loadPresentation(bytes)).model(0).elements as ShapeElement[]
		expect(climbing.picture).toMatchObject({part: 'media/x.png'})
		expect(backslashed.picture).toMatchObject({part: 'ppt/media/y.png'})
	})
})
