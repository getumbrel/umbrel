// @vitest-environment jsdom

import {afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi} from 'vitest'

import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

import {openDocument, type DocxDocument, type RenderOptions} from '.'
import {tabStop, tabWidth} from './layout'
import type {Table} from './model'
import {gridOf} from './render'
import {docx, fixture, hasFixture, NAMESPACES, PNG, structures, WORD_FIXTURES} from './test-helpers'

// jsdom has no layout: every box measures zero, which lays each section out on one page, and it lacks the few
// layout and blob APIs the engine calls
let urls = 0
const revoked: string[] = []
beforeAll(() => {
	URL.createObjectURL = () => `blob:test/${++urls}`
	URL.revokeObjectURL = (url: string) => void revoked.push(url)
	const empty = () => Object.assign([], {item: () => null}) as unknown as DOMRectList
	Range.prototype.getClientRects = empty
	Range.prototype.getBoundingClientRect = () => new DOMRect()
})

let current: {doc: DocxDocument; container: HTMLElement} | undefined
afterEach(() => {
	current?.doc.destroy()
	current?.container.remove()
	current = undefined
})

async function show(bytes: Uint8Array, editable = false, options?: RenderOptions) {
	const container = document.createElement('div')
	document.body.append(container)
	const doc = await openDocument(bytes)
	const result = await doc.render(container, options)
	if (editable) doc.setEditable(true)
	current = {doc, container}
	return {doc, container, result}
}

const textOf = (container: HTMLElement) => container.textContent ?? ''

// What a browser sends for an edit, to where the selection is: a key, a word on what it's about to do (with what's
// pasted, for a paste, and with the ranges it would change, which jsdom's own events can't name), and a word once it
// has changed the DOM itself
const focused = () => {
	const node = document.getSelection()!.anchorNode!
	return node instanceof Element ? node : node.parentElement!
}
const press = (key: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...init})
	focused().dispatchEvent(event)
	return event
}
const input = (init: InputEventInit, pasted?: string) => {
	const event = new InputEvent('beforeinput', {bubbles: true, cancelable: true, ...init})
	if (pasted !== undefined)
		Object.defineProperty(event, 'dataTransfer', {
			value: {getData: (type: string) => (type === 'text/plain' ? pasted : '')},
		})
	if (init.targetRanges) Object.defineProperty(event, 'getTargetRanges', {value: () => init.targetRanges})
	focused().dispatchEvent(event)
	return event
}
const changed = (target: Element = focused()) => target.dispatchEvent(new InputEvent('input', {bubbles: true}))

describe('rendering', () => {
	// jsdom builds DOM a hundred times slower than a browser: the 12 MB contract is left to the browser runs
	test.skipIf(!WORD_FIXTURES.length)(
		'every fixture renders, built only from safe elements',
		{timeout: 120000},
		async () => {
			for (const path of WORD_FIXTURES.filter((name) => !/encrypted|doctype|bug65649/.test(name))) {
				const {container, result} = await show(fixture(path))
				expect(result.pages.length, path).toBeGreaterThan(0)
				expect(
					result.pages.every((page) => container.contains(page)),
					path,
				).toBe(true)
				expect(
					container.querySelector('script, style, iframe, object, embed, link, svg, form, input, base'),
					path,
				).toBeNull()
				for (const image of container.querySelectorAll('img'))
					expect(image.getAttribute('src'), path).toMatch(/^blob:test\//)
				for (const anchor of container.querySelectorAll('a'))
					expect(anchor.getAttribute('href'), path).toMatch(/^(https?:|mailto:)/)
				// Nothing from a document can set a property that loads something
				for (const element of container.querySelectorAll<HTMLElement>('[style]')) {
					expect(
						[
							element.style.backgroundImage,
							element.style.listStyleImage,
							element.style.content,
							element.style.borderImage,
						],
						path,
					).toEqual(['', '', '', ''])
				}
				current!.doc.destroy()
				current!.container.remove()
				current = undefined
			}
		},
	)

	test.skipIf(!hasFixture('Samples/Word/zz-css-injection.docx'))(
		'a hostile font name can only ever be a font name',
		async () => {
			const {container} = await show(fixture('Samples/Word/zz-css-injection.docx'))
			expect(document.styleSheets).toHaveLength(0)
			const families = [...container.querySelectorAll<HTMLElement>('span')]
				.map((span) => span.style.fontFamily)
				.filter((family) => family.includes('beacon'))
			expect(families.length).toBeGreaterThan(0)
			for (const family of families)
				expect(
					family.startsWith(
						'"Arial;}body{background-image:url(https://css-beacon.example.invalid/opened.png)}.x{color:red"',
					),
				).toBe(true)
			for (const element of container.querySelectorAll<HTMLElement>('[style]'))
				expect(element.style.backgroundImage).toBe('')
		},
	)

	test.skipIf(!hasFixture('Samples2/Word/hostile-external-image-link.docx'))(
		'a picture linked to the web gets an empty frame, not a request',
		async () => {
			const fetch = vi.spyOn(globalThis, 'fetch')
			const {container} = await show(fixture('Samples2/Word/hostile-external-image-link.docx'))
			expect(container.querySelector('img')).toBeNull()
			expect(fetch).not.toHaveBeenCalled()
			fetch.mockRestore()
		},
	)

	test('pages carry their size, zoom scales them without laying them out again', async () => {
		const {doc, result} = await show(
			docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>two</w:t></w:r></w:p>'),
		)
		expect(result.pages).toHaveLength(2)
		const [page] = result.pages
		expect([page.style.width, page.style.height]).toEqual(['816px', '1056px'])
		doc.setZoom(0.5)
		expect([page.style.width, page.style.height]).toEqual(['408px', '528px'])
		expect((page.firstElementChild as HTMLElement).style.transform).toBe('scale(0.5)')
		expect(result.pages[1].textContent).toContain('two')
	})

	// A probe's line as a browser gives it for Carlito: the face's ascent and descent (1950 and 550 of its 2048 units
	// to the em, with no line gap), each rounded to whole pixels at the probe's size
	const probed = (element: Element) =>
		({'1000px': 1221, '1048px': 1279})[(element as HTMLElement).style?.fontSize] as number | undefined

	test('line heights are measured as laid out, not as a scaled stage shows them', async () => {
		// Each probe's line is shown at 99% while a viewer's entrance still scales the stage
		const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
			this: HTMLElement,
		) {
			return probed(this) ?? 0
		})
		const rect = Element.prototype.getBoundingClientRect
		const onScreen = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			const height = probed(this)
			return height ? new DOMRect(0, 0, 100, height * 0.99) : rect.call(this)
		})
		onTestFinished(() => {
			offsetHeight.mockRestore()
			onScreen.mockRestore()
		})
		const {container} = await show(docx('<w:p><w:r><w:t>text</w:t></w:r></w:p>'))
		// The two probes' lines add up to the face's own 2500 units: a line is 2500/2048 of its size
		const ratio = (container.firstElementChild as HTMLElement).style.getPropertyValue('--docx-line-0')
		expect(ratio).toBe(String(2500 / 2048))
	})

	test('a line is as tall as the face the document names makes it, whichever face stands in for it', async () => {
		// Every stack is drawn in Carlito here, whose lines are 2500 of its 2048 units
		const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
			this: HTMLElement,
		) {
			return probed(this) ?? 0
		})
		onTestFinished(() => offsetHeight.mockRestore())
		const run = (face: string, text: string) =>
			`<w:p><w:r><w:rPr><w:rFonts w:ascii="${face}" w:hAnsi="${face}"/><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
		const {container} = await show(docx(run('Cambria', 'named') + run('Aptos', 'measured')))
		const [named, measured] = ['named', 'measured'].map(
			(text) => [...container.querySelectorAll('span')].find((span) => span.textContent === text)!,
		)
		// Cambria's own 2400 units of a 16 px size
		expect(named.style.lineHeight).toBe('18.75px')
		// A face with no line height known takes what its stack measures
		const [, variable] = /^calc\(var\((--docx-line-\d+), [\d.]+\) \* 16px\)$/.exec(measured.style.lineHeight)!
		expect((container.firstElementChild as HTMLElement).style.getPropertyValue(variable)).toBe(String(2500 / 2048))
	})

	test("a section's line grid sets the lines of its paragraphs", async () => {
		// Times New Roman, whose line is 2355 of its 2048 units: 16.1 px at 10.5 pt and 21.5 px at 14 pt, on a grid of
		// lines 20.8 px apart
		const p = (text: string, props = '', size = 21) =>
			`<w:p><w:pPr>${props}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="${size}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
		const body =
			p('one line') +
			p('two lines', '', 28) +
			p('one and a half', '<w:spacing w:line="360" w:lineRule="auto"/>') +
			p('at least', '<w:spacing w:line="200" w:lineRule="atLeast"/>') +
			p('exact', '<w:spacing w:line="400" w:lineRule="exact"/>') +
			p('off the grid', '<w:snapToGrid w:val="0"/>') +
			`<w:tbl><w:tr><w:tc>${p('in a cell')}</w:tc></w:tr></w:tbl>`
		const grid = (type = ' w:type="lines"') => `<w:sectPr><w:docGrid${type} w:linePitch="312"/></w:sectPr>`
		const heights = async (bytes: Uint8Array) => {
			const {container} = await show(bytes)
			const spans = [...container.querySelectorAll('span')]
			return Object.fromEntries(
				['one line', 'two lines', 'one and a half', 'at least', 'exact', 'off the grid', 'in a cell'].map((text) => [
					text,
					parseFloat(spans.find((span) => span.textContent === text)!.style.lineHeight),
				]),
			)
		}
		// As many of the grid's lines as the text is tall, times the paragraph's spacing. A height that's exact stays
		// as it is, as do the lines of a paragraph that opts out and those in a table's cells.
		const set = await heights(docx(body + grid()))
		expect(set['one line']).toBeCloseTo(20.8, 1)
		expect(set['two lines']).toBeCloseTo(41.6, 1)
		expect(set['one and a half']).toBeCloseTo(31.2, 1)
		expect(set['at least']).toBeCloseTo(20.8, 1)
		expect(set['exact']).toBeCloseTo(26.67, 1)
		expect(set['off the grid']).toBeCloseTo(16.1, 1)
		expect(set['in a cell']).toBeCloseTo(16.1, 1)
		// A document can ask for the lines in cells to be set on the grid too
		const cells = await heights(docx(body + grid(), {settings: '<w:compat><w:adjustLineHeightInTable/></w:compat>'}))
		expect(cells['in a cell']).toBeCloseTo(20.8, 1)
		// The pitch is written in every section: only a grid of lines sets them
		const none = await heights(docx(body + grid('')))
		expect(none['one line']).toBeCloseTo(16.1, 1)
		expect(none['two lines']).toBeCloseTo(21.5, 1)
	})

	test('a header is set on the line grid of each section that shows it', async () => {
		// Times New Roman at 10.5 pt, whose line is 16.1 px: one line of a grid, which are 20.8 px apart in the first
		// section and 32 px in the second, where the first's header goes on
		const head =
			`<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NAMESPACES}><w:p><w:r><w:rPr>` +
			'<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="21"/>' +
			'</w:rPr><w:t>Head</w:t></w:r></w:p></w:hdr>'
		const section = (pitch: number, header = '') =>
			`<w:sectPr>${header}<w:docGrid w:type="lines" w:linePitch="${pitch}"/></w:sectPr>`
		const {result} = await show(
			docx(
				`<w:p><w:pPr>${section(312, '<w:headerReference w:type="default" r:id="rIdHead"/>')}</w:pPr></w:p>` +
					`<w:p><w:r><w:t>Text</w:t></w:r></w:p>${section(480)}`,
				{parts: {'word/header1.xml': head}, rels: [{id: 'rIdHead', type: 'header', target: 'header1.xml'}]},
			),
		)
		const heights = result.pages.map((page) =>
			parseFloat([...page.querySelectorAll('span')].find((span) => span.textContent === 'Head')!.style.lineHeight),
		)
		expect(heights[0]).toBeCloseTo(20.8, 1)
		expect(heights[1]).toBeCloseTo(32, 1)
	})

	test('an East Asian face takes as many lines of a grid as it does in Word', async () => {
		const p = (face: string, size: number) =>
			`<w:p><w:r><w:rPr><w:rFonts w:ascii="${face}" w:hAnsi="${face}"/><w:sz w:val="${size}"/></w:rPr><w:t>${face}</w:t></w:r></w:p>`
		const {container} = await show(
			docx(p('宋体', 24) + p('微软雅黑', 21) + '<w:sectPr><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>'),
		)
		const height = (face: string) =>
			parseFloat([...container.querySelectorAll('span')].find((span) => span.textContent === face)!.style.lineHeight)
		// A line of 宋体 is 1.3 times its size: at 12 pt, the 15.6 pt between the lines of the grid such a document has,
		// and one of them. 微软雅黑 is taller, and at 10.5 pt needs two.
		expect(height('宋体')).toBeCloseTo(20.8, 1)
		expect(height('微软雅黑')).toBeCloseTo(41.6, 1)
	})

	test('the galley is first laid out with its faces loaded and its line heights set', async () => {
		// Reading layout lays out what's read: before the line heights are set, only their probes may be read
		const early: Element[] = []
		const read = (element: Element) => {
			if (!probed(element) && !element.closest('[style*="--docx-line"]')) early.push(element)
		}
		const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
			this: HTMLElement,
		) {
			read(this)
			return probed(this) ?? 0
		})
		const rect = Element.prototype.getBoundingClientRect
		const onScreen = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			read(this)
			return rect.call(this)
		})
		const loaded: string[][] = []
		Object.defineProperty(document, 'fonts', {
			configurable: true,
			value: {load: async (font: string, text: string) => void loaded.push([font, text])},
		})
		onTestFinished(() => {
			offsetHeight.mockRestore()
			onScreen.mockRestore()
			delete (document as {fonts?: unknown}).fonts
		})
		await show(
			docx(
				'<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/></w:rPr><w:t>Bold Привет</w:t></w:r>' +
					'<w:r><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr><w:t> and more</w:t></w:r></w:p>',
			),
		)
		expect(early).toEqual([])
		// Each face, with the text that picks which of its subsets to load, and each face the probes measure in: one
		// whose line height isn't known
		const stack = '"Calibri", "Carlito", sans-serif'
		expect(loaded).toContainEqual([`normal 700 16px ${stack}`, expect.stringContaining('Привет')])
		expect(loaded).toContainEqual(['1000px "Aptos", "Carlito", sans-serif', 'x'])
		expect(loaded).not.toContainEqual([`1000px ${stack}`, 'x'])
	})

	test('images become blob URLs that destroy revokes', async () => {
		const drawing =
			'<w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="p" descr="dot"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
		const {doc, container} = await show(
			docx(`<w:p><w:r>${drawing}</w:r></w:p><w:p><w:r>${drawing.replace('rIdImg', 'rIdBad')}</w:r></w:p>`, {
				parts: {
					'word/media/image1.png': PNG,
					'word/media/image2.emf': new Uint8Array([1, 0, 0, 0, 0x20, 0x45, 0x4d, 0x46]),
				},
				rels: [
					{id: 'rIdImg', type: 'image', target: 'media/image1.png'},
					{id: 'rIdBad', type: 'image', target: 'media/image2.emf'},
				],
			}),
		)
		const images = container.querySelectorAll('img')
		// The EMF can't be decoded by a browser: it gets no URL and shows as a frame
		expect(images).toHaveLength(1)
		expect(images[0].alt).toBe('dot')
		const url = images[0].getAttribute('src')!
		doc.destroy()
		expect(revoked).toContain(url)
		expect(container.childElementCount).toBe(0)
	})

	test('an SVG picture shows as the PNG Word writes beside it, and never as an SVG of its own', async () => {
		const picture = (blip: string) =>
			`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill>${blip}</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
		const svgBlip =
			'<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdSvg"/></a:ext></a:extLst>'
		const options = {
			parts: {
				'word/media/image1.png': PNG,
				'word/media/image2.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
			},
			rels: [
				{id: 'rIdPng', type: 'image', target: 'media/image1.png'},
				{id: 'rIdSvg', type: 'image', target: 'media/image2.svg'},
			],
		}
		const created = vi.spyOn(URL, 'createObjectURL')
		onTestFinished(() => created.mockRestore())
		const withPng = await show(docx(picture(`<a:blip r:embed="rIdPng">${svgBlip}</a:blip>`), options))
		expect(withPng.container.querySelectorAll('img')).toHaveLength(1)
		expect(created.mock.calls.map(([blob]) => (blob as Blob).type)).toEqual(['image/png'])
		withPng.doc.destroy()
		withPng.container.remove()
		// Alone, it's an empty frame the notice names, as a picture in a format browsers can't draw is
		const alone = await show(docx(picture('<a:blip r:embed="rIdSvg"/>'), options))
		expect(alone.container.querySelector('img')).toBeNull()
		expect([...alone.doc.approximated]).toEqual(['pictures'])
		expect(created).toHaveBeenCalledTimes(1)
	})

	test('a render begun while an earlier one is still reading the pictures draws them too', async () => {
		const container = document.createElement('div')
		document.body.append(container)
		const doc = await openDocument(
			docx(
				'<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
				{parts: {'word/media/image1.png': PNG}, rels: [{id: 'rIdImg', type: 'image', target: 'media/image1.png'}]},
			),
		)
		current = {doc, container}
		// As a viewer mounted twice in a row (React's strict mode) renders
		void doc.render(container)
		await doc.render(container)
		expect(container.querySelectorAll('img')).toHaveLength(1)
		expect([...doc.approximated]).toEqual([])
	})

	// Building and inflating the bomb takes seconds on a busy machine
	describe('the overlapping-stream bomb', {timeout: 60000}, () => {
		// Fifteen pictures whose directory records share one deflate stream of 32 MiB of zeros: 480 MiB from a file of
		// 33 KB (the one found in review claims 256 MiB a part)
		const names = Array.from({length: 15}, (_, i) => `word/media/image${i}.png`)
		const bomb = () =>
			docx(
				names
					.map(
						(_, i) =>
							`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="${i + 1}" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg${i}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
					)
					.join(''),
				{
					parts: {[names[0]]: new Uint8Array(32 * 2 ** 20)},
					deflate: [names[0]],
					aliases: Object.fromEntries(names.slice(1).map((name) => [name, names[0]])),
					rels: names.map((name, i) => ({id: `rIdImg${i}`, type: 'image', target: name.slice(5)})),
				},
			)
		// Counts the pictures read, and the most read at once
		const watch = () => {
			const reads = {started: 0, most: 0, now: 0}
			const read = ZipArchive.prototype.bytes
			const spy = vi.spyOn(ZipArchive.prototype, 'bytes').mockImplementation(async function (this: ZipArchive, name) {
				if (!names.includes(name)) return read.call(this, name)
				reads.started++
				reads.most = Math.max(reads.most, ++reads.now)
				try {
					return await read.call(this, name)
				} finally {
					reads.now--
				}
			})
			onTestFinished(() => spy.mockRestore())
			return reads
		}

		test('its pictures are read one at a time, and only as far as a budget', async () => {
			const reads = watch()
			const {doc, container} = await show(bomb())
			// 256 MiB in all: eight of the fifteen
			expect(reads).toMatchObject({started: 8, most: 1})
			// Zeros aren't a picture: every frame is empty, and the notice says so
			expect(container.querySelectorAll('img')).toHaveLength(0)
			expect([...doc.approximated]).toEqual(['pictures'])
		})

		test('closed while its pictures wait their turn, it reads none of them', async () => {
			const reads = watch()
			const container = document.createElement('div')
			document.body.append(container)
			const doc = await openDocument(bomb())
			const rendering = doc.render(container)
			doc.destroy()
			await rendering
			expect(reads.started).toBe(0)
			container.remove()
		})
	})

	test('what the pages draw only roughly is named, and nothing else', async () => {
		const frame = (data: string) =>
			`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="g"/><a:graphic>${data}</a:graphic></wp:inline></w:drawing></w:r></w:p>`
		const graphic = (uri: string, content = '') => frame(`<a:graphicData uri="${uri}">${content}</a:graphicData>`)
		const picture = (blip: string) =>
			graphic(
				'http://schemas.openxmlformats.org/drawingml/2006/picture',
				`<pic:pic><pic:blipFill><a:blip ${blip}/></pic:blipFill></pic:pic>`,
			)
		const object = (preview: string) =>
			`<w:p><w:r><w:object><v:shape style="width:68pt;height:38pt">${preview}</v:shape></w:object></w:r></w:p>`
		const approximated = async (body: string) => {
			const {doc, container} = await show(
				docx(body, {
					parts: {
						'word/media/image1.png': PNG,
						'word/media/image2.emf': new Uint8Array([1, 0, 0, 0, 0x20, 0x45, 0x4d, 0x46]),
					},
					rels: [
						{id: 'rIdPng', type: 'image', target: 'media/image1.png'},
						{id: 'rIdEmf', type: 'image', target: 'media/image2.emf'},
						{id: 'rIdWeb', type: 'image', target: 'https://example.com/pixel.png', external: true},
					],
				}),
			)
			const kinds = [...doc.approximated].sort()
			doc.destroy()
			container.remove()
			current = undefined
			return kinds
		}
		// Text, a picture, and an embedded object showing its picture of itself are drawn as they are
		expect(
			await approximated(
				`<w:p><w:r><w:t>text</w:t></w:r></w:p>${picture('r:embed="rIdPng"')}${object('<v:imagedata r:id="rIdPng"/>')}`,
			),
		).toEqual([])
		expect(await approximated(graphic('http://schemas.openxmlformats.org/drawingml/2006/chart'))).toEqual(['charts'])
		expect(await approximated(graphic('http://schemas.microsoft.com/office/drawing/2014/chartex'))).toEqual(['charts'])
		expect(await approximated(graphic('http://schemas.openxmlformats.org/drawingml/2006/diagram'))).toEqual([
			'diagrams',
		])
		expect(await approximated('<w:p><m:oMath><m:r><m:t>x²</m:t></m:r></m:oMath></w:p>')).toEqual(['equations'])
		// A picture in a format browsers can't draw, one linked from the web, a drawing of a kind we don't know
		expect(await approximated(picture('r:embed="rIdEmf"'))).toEqual(['pictures'])
		expect(await approximated(picture('r:link="rIdWeb"'))).toEqual(['pictures'])
		expect(await approximated(graphic('http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas'))).toEqual([
			'pictures',
		])
		// An embedded object whose picture can't be drawn, or that has none, is the object, not a picture
		expect(await approximated(object('<v:imagedata r:id="rIdEmf"/>'))).toEqual(['objects'])
		expect(await approximated(object(''))).toEqual(['objects'])
		// Comments aren't drawn at all, only the text they're on
		expect(
			await approximated(
				'<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>noted</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
			),
		).toEqual(['comments'])
	})

	test.skipIf(!hasFixture('Samples/Word/chartex.docx'))(
		'fixtures name what they hold that the pages draw only roughly',
		{timeout: 60000},
		async () => {
			const expected: Record<string, string[]> = {
				// Its newer charts carry pictures of themselves, drawn; its classic charts aren't
				'Samples/Word/chartex.docx': ['charts'],
				'Samples/Word/comprehensive-word.docx': ['comments', 'equations'],
				'Samples/Word/drawing.docx': ['objects'],
				'Samples2/Word/pictures-emf-wmf-png-jpeg-poi.docx': ['pictures'],
				'Samples2/Word/hostile-external-image-link.docx': ['pictures'],
				'Samples2/Word/features.docx': ['comments'],
				'Samples2/Word/long-40-pages.docx': [],
			}
			for (const [path, kinds] of Object.entries(expected)) {
				const {doc, container} = await show(fixture(path))
				expect([...doc.approximated].sort(), path).toEqual(kinds)
				doc.destroy()
				container.remove()
				current = undefined
			}
		},
	)

	test("objects are islands the caret can't enter, text is spans of the runs", async () => {
		const {container} = await show(
			docx(
				'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t><w:tab/><w:t>after tab</w:t></w:r></w:p>',
				{
					numbering:
						'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
				},
			),
		)
		const islands = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')]
		const texts = islands.map((element) => element.textContent)
		expect(texts).toContain('1.')
		expect(texts).toContain('\t')
		expect(textOf(container)).toContain('1.\titem\tafter tab')
		// A tab's character is in the flow of its line, neither positioned nor clipped: Chrome finds where text is
		// composed after a tab from the text before it, and gives the composition up at a box it finds none in
		for (const tab of islands.filter((element) => element.textContent === '\t' && !element.childElementCount))
			expect([tab.style.display, tab.style.position, tab.style.overflow]).toEqual(['inline-block', '', ''])
	})

	// The space above and below the paragraph that ends with a text, in points
	const spaceAround = (container: HTMLElement) => (text: string) => {
		const block = [...container.querySelectorAll<HTMLElement>('div')]
			.filter((div) => div.style.paddingTop && div.textContent!.endsWith(text))
			.pop()!
		return [block.style.paddingTop, block.style.paddingBottom].map((length) => Math.round(parseFloat(length) * 0.75))
	}

	test("automatic spacing falls as a browser's margins do", async () => {
		const auto = '<w:spacing w:beforeAutospacing="1" w:afterAutospacing="1"/>'
		const p = (text: string, pPr = auto) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
		const item = (text: string, numId: number) =>
			p(text, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>${auto}`)
		const {container} = await show(
			docx(
				`${p('first')}${p('second')}${item('one', 1)}${item('two', 1)}${item('other', 2)}${p('plain', '')}` +
					`<w:tbl><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc>${p('top')}${p('bottom')}</w:tc></w:tr></w:tbl>` +
					p('last'),
				{
					numbering:
						'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
						'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>',
				},
			),
		)
		const around = spaceAround(container)
		// None above the first paragraph, and where one paragraph's meets the next one's only the one
		expect(around('first')).toEqual([0, 14])
		expect(around('second')).toEqual([0, 14])
		// None between the items of a list, which is spaced from another list as from any paragraph
		expect(around('one')).toEqual([0, 0])
		expect(around('two')).toEqual([0, 14])
		expect(around('other')).toEqual([0, 14])
		expect(around('plain')).toEqual([0, 0])
		// A cell has none above its first paragraph or below its last
		expect(around('top')).toEqual([0, 14])
		expect(around('bottom')).toEqual([0, 0])
		expect(around('last')).toEqual([14, 14])
	})

	const spaced = (text: string, before: number, after: number, pPr = '') =>
		`<w:p><w:pPr>${pPr}<w:spacing w:before="${before * 20}" w:after="${after * 20}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
	const automatic = (text: string) =>
		`<w:p><w:pPr><w:spacing w:beforeAutospacing="1" w:afterAutospacing="1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

	test('two paragraphs have the larger of their spaces between them, not both', async () => {
		const {container} = await show(
			docx(
				spaced('first', 6, 10) +
					spaced('heading', 24, 0) +
					spaced('text', 0, 10) +
					spaced('more', 6, 10) +
					automatic('automatic') +
					spaced('fixed', 20, 10) +
					spaced('alike', 0, 10, '<w:contextualSpacing/>') +
					spaced('whole', 6, 10) +
					'<w:tbl><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>' +
					spaced('below', 6, 10) +
					spaced('page', 12, 0, '<w:pageBreakBefore/>'),
			),
		)
		const around = spaceAround(container)
		expect(around('first')).toEqual([6, 10])
		// Of the space before a paragraph, only what's more than the one above leaves after itself is its own
		expect(around('heading')).toEqual([14, 0])
		expect(around('text')).toEqual([0, 10])
		expect(around('more')).toEqual([0, 10])
		// Automatic spacing is 14 pt, and meets spacing that's set as it meets its own kind
		expect(around('automatic')).toEqual([4, 14])
		expect(around('fixed')).toEqual([6, 10])
		// What a paragraph leaves after itself is none beside one of its style, with contextual spacing
		expect(around('alike')).toEqual([0, 0])
		expect(around('whole')).toEqual([6, 10])
		// Beside a table there's nothing to share, and a paragraph that starts a page has all its space above it
		expect(around('below')).toEqual([6, 10])
		expect(around('page')).toEqual([12, 0])
	})

	test('a document that turns spacing as in HTML off has both spaces between two paragraphs', async () => {
		const {container} = await show(
			docx(spaced('first', 6, 10) + spaced('heading', 24, 0) + automatic('automatic') + automatic('again'), {
				settings: '<w:compat><w:doNotUseHTMLParagraphAutoSpacing/></w:compat>',
			}),
		)
		const around = spaceAround(container)
		expect(around('first')).toEqual([6, 10])
		expect(around('heading')).toEqual([24, 0])
		// Automatic spacing is then Word's own, the same wherever the paragraph is
		expect(around('automatic')).toEqual([5, 10])
		expect(around('again')).toEqual([5, 10])
	})

	test("a paragraph's box holds a first line that hangs, and its borders stand outside the text", async () => {
		// Borders a point wide and four from the text, with 10 pt after each paragraph
		const border = (side: string) => `<w:${side} w:val="single" w:sz="8" w:space="4" w:color="auto"/>`
		const boxed = (text: string, indent: string, pPr = '') =>
			`<w:p><w:pPr>${pPr}<w:pBdr>${border('left')}${border('right')}</w:pBdr><w:spacing w:after="200"/><w:ind ${indent}/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
		const {container} = await show(
			docx(
				boxed('hangs', 'w:left="720" w:hanging="360" w:right="240"') +
					boxed('level', 'w:left="360" w:right="240"') +
					boxed('indented', 'w:left="720" w:right="240"') +
					boxed('mirrored', 'w:left="720" w:hanging="360"', '<w:bidi/>'),
			),
		)
		const box = (text: string) =>
			[...container.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent === text)!.parentElement!
		const points = (length: string) => Math.round(parseFloat(length) * 0.75)
		// How far in from its column the box starts, its text from its left and right sides, and how far in it ends
		const sides = (text: string) => {
			const {marginInlineStart, paddingLeft, paddingRight, marginInlineEnd} = box(text).style
			return [marginInlineStart, paddingLeft, paddingRight, marginInlineEnd].map(points)
		}
		// Indented 36 pt, the first line 18 pt less: the border is 5 pt before that line, and 5 pt past where lines end
		expect(sides('hangs')).toEqual([13, 22, 4, 7])
		expect(points(box('hangs').style.textIndent)).toBe(-18)
		// A paragraph whose box has the same sides is in one box with it, the space between them inside
		expect(sides('level')).toEqual([13, 4, 4, 7])
		const below = (text: string) =>
			[box(text), box(text).parentElement!].map((node) => points(node.style.paddingBottom))
		expect(below('hangs')).toEqual([10, 0])
		expect(below('level')).toEqual([0, 10])
		// Not one whose text starts where the first one's does, but its box further in
		expect(sides('indented')).toEqual([31, 4, 4, 7])
		// Lines that start on the right hang there
		expect(sides('mirrored')).toEqual([13, 4, 22, -5])
	})

	test("a header's or footer's frames are set apart from its text", async () => {
		const p = (text: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
		const framed = (text: string, frame: string, pPr = '') => p(text, `<w:framePr ${frame}/>${pPr}`)
		const story = (root: string, blocks: string) =>
			`<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}>${blocks}</w:${root}>`
		// A page number as Word 97 to 2003 put one in: in a frame beside the paragraph after it
		const beside = 'w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:y="1"'
		// A rule above each paragraph of the footer, as its style may have it, and 10 pt after it
		const ruled =
			'<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="auto"/></w:pBdr><w:spacing w:after="200"/>'
		const header =
			p('above', '<w:spacing w:after="200"/>') +
			framed('centred', `${beside} w:xAlign="center"`) +
			framed('with it', `${beside} w:xAlign="center"`) +
			framed('under', 'w:w="2880" w:wrap="none" w:vAnchor="text" w:hAnchor="page" w:x="720" w:y="240"') +
			p('below', '<w:spacing w:before="120"/>') +
			framed(
				'banner',
				'w:w="2880" w:h="1440" w:wrap="none" w:vAnchor="page" w:hAnchor="page" w:xAlign="center" w:y="7200"',
			) +
			framed('note', 'w:w="1440" w:h="720" w:hRule="exact" w:x="-720" w:y="240"') +
			framed('low', 'w:hAnchor="margin" w:xAlign="right" w:yAlign="bottom"') +
			framed('alone', 'w:wrap="notBeside" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right"') +
			p('last')
		const footer = framed('number', `${beside} w:xAlign="right"`, ruled) + p('foot', ruled)
		// Letter, with margins of an inch but for the right one's inch and a quarter
		const {container} = await show(
			docx(
				`${framed('in the body', beside)}${p('body')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHead"/><w:footerReference w:type="default" r:id="rIdFoot"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>`,
				{
					parts: {'word/header1.xml': story('hdr', header), 'word/footer1.xml': story('ftr', footer)},
					rels: [
						{id: 'rIdHead', type: 'header', target: 'header1.xml'},
						{id: 'rIdFoot', type: 'footer', target: 'footer1.xml'},
					],
				},
			),
		)
		const span = (text: string) =>
			[...container.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent === text)!
		// A paragraph's block, which what's placed in it is placed from, and what holds that block
		const block = (text: string) => {
			let node = span(text).parentElement!
			while (node.style.position !== 'relative') node = node.parentElement!
			return node
		}
		const holder = (text: string) => block(text).parentElement!
		const placed = (text: string, ...sides: Array<'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>) =>
			sides.map((side) => holder(text).style[side])

		// Paragraphs framed alike are in one frame, in the text ahead of the paragraph it's beside: centred over it
		const text = holder('above')
		expect(holder('centred')).toBe(holder('with it'))
		expect(holder('centred').parentElement).toBe(text)
		expect(block('with it').nextElementSibling).toBeNull()
		expect(holder('centred').style.position).toBe('absolute')
		expect(placed('centred', 'left', 'right', 'width')).toEqual(['0px', '0px', 'fit-content'])
		expect([holder('centred').style.marginLeft, holder('centred').style.marginRight]).toEqual(['auto', 'auto'])
		// One that text runs under is half an inch from the page's edge, which is as far left of the text, and as wide
		// as it's said to be
		expect(placed('under', 'left', 'width')).toEqual(['-48px', '192px'])
		expect(holder('under').style.marginTop).toBe('16px')
		// The text's paragraphs are spaced as with no frame between them: of the 6 pt before this one, none is more than
		// the 10 pt the one above leaves after itself
		expect(block('below').style.paddingTop).toBe('0px')
		// A frame text isn't to run beside has its paragraphs where they are in the text
		expect(holder('alone')).toBe(text)

		// Frames placed on the page are with what's drawn over it: 5 in down and centred, at least an inch tall; from
		// the top margin and the text's left edge where nothing says what from; and at the right and bottom margins
		const layer = text.nextElementSibling
		for (const frame of ['banner', 'note', 'low']) expect(holder(frame).parentElement).toBe(layer)
		expect(placed('banner', 'left', 'right', 'top', 'width')).toEqual(['0px', '0px', '480px', '192px'])
		expect(holder('banner').style.minHeight).toBe('96px')
		expect(placed('note', 'left', 'top', 'width', 'height')).toEqual(['48px', '112px', '96px', '48px'])
		expect(placed('low', 'right', 'bottom')).toEqual(['120px', '96px'])

		// The footer's number is at the right of the line the footer's text starts, each under a rule of its own
		expect(holder('number').parentElement).toBe(holder('foot'))
		expect(holder('number').nextElementSibling).toBe(block('foot'))
		expect(holder('number').style.cssFloat).toBe('right')
		expect(['number', 'foot'].map((text) => span(text).parentElement!.style.borderTopStyle)).toEqual(['solid', 'solid'])

		// A frame in the body stays among its paragraphs
		expect(holder('in the body')).toBe(holder('body'))
		expect(block('in the body').nextElementSibling).toBe(block('body'))
	})

	test('a table starts as far from the edge of the text as it is indented, to either side of it', async () => {
		const table = (tblPr: string) =>
			`<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>`
		const indent = (twips: number) => `<w:tblInd w:w="${twips}" w:type="dxa"/>`
		const tables = table('') + table(indent(720)) + table(indent(-720)) + table(`<w:jc w:val="center"/>${indent(-720)}`)
		const starts = async (settings?: string) => {
			const {container} = await show(docx(tables, {settings}))
			return [...container.querySelectorAll('table')].map((node) => node.style.marginLeft)
		}
		// Half an inch in, and half an inch out into the margin; a centred table has no indent
		const mode =
			'<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
		expect(await starts(mode)).toEqual(['0px', '48px', '-48px', 'auto'])
		// In a document from before Word 2013 it's the text of the first cell that's placed, its border left of it
		expect(await starts()).toEqual(['-7.2px', '40.8px', '-55.2px', 'auto'])
	})

	test("a picture isn't moved by the indent of its paragraph's first line", async () => {
		const graphic = (wrap = '') =>
			`<wp:extent cx="457200" cy="228600"/>${wrap}<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>`
		const inline = `<w:r><w:drawing><wp:inline>${graphic()}</wp:inline></w:drawing></w:r>`
		// Beside the text, which runs around it
		const beside = `<w:r><w:drawing><wp:anchor behindDoc="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${graphic('<wp:wrapSquare wrapText="bothSides"/>')}</wp:anchor></w:drawing></w:r>`
		const {container} = await show(
			docx(
				`<w:p><w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:t>indented</w:t></w:r>${inline}${beside}</w:p>` +
					`<w:p><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr><w:r><w:t>hangs</w:t></w:r>${inline}</w:p>`,
				{parts: {'word/media/image1.png': PNG}, rels: [{id: 'rIdImg', type: 'image', target: 'media/image1.png'}]},
			),
		)
		// Each picture's box is alone in a node, on a line of the paragraph or floated beside its text
		const nodes = [...container.querySelectorAll('img')].map(
			(image) => image.closest<HTMLElement>('.umbrel-docx-object')!,
		)
		expect(nodes.map((node) => node.style.cssFloat || node.style.display)).toEqual([
			'inline-block',
			'left',
			'inline-block',
		])
		// The first line starts half an inch in, or half an inch before the others, and no such node's own does
		expect(nodes.map((node) => node.closest('div')!.style.textIndent)).toEqual(['48px', '48px', '-48px'])
		expect(nodes.map((node) => node.style.textIndent)).toEqual(['0px', '0px', '0px'])
	})

	test('an object placed from where its paragraph anchors it has an island that stays in the line', async () => {
		const shape = (wrap: string) =>
			`<w:r><w:drawing><wp:anchor behindDoc="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/>${wrap}<wp:docPr id="2" name="s"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
		const wraps = ['<wp:wrapNone/>', '<wp:wrapTopAndBottom/>', '<wp:wrapSquare wrapText="bothSides"/>']
		const {container} = await show(docx(`<w:p>${wraps.map(shape).join('')}<w:r><w:tab/></w:r></w:p>`))
		// Over the text, above and below it, and beside it: each is a box out of the line
		const boxes = [...container.querySelectorAll<HTMLElement>('.umbrel-docx-object')]
		expect(boxes.map((box) => box.style.position || box.style.cssFloat || box.style.display)).toEqual([
			'absolute',
			'block',
			'left',
		])
		// Chrome keeps no caret between such a box and another object, as the tab is here: a caret put there is somewhere
		// else by the next key. In the line with the tab is the island that holds the box, and holds nothing else
		const tab = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].find(
			(node) => node.textContent === '\t',
		)!
		for (const box of boxes) {
			const island = box.parentElement!
			expect(island.parentElement).toBe(tab.parentElement)
			expect(island.getAttribute('contenteditable')).toBe('false')
			expect(island.getAttribute('style')).toBeNull()
			expect(island.childNodes).toHaveLength(1)
		}
	})

	test("the line under a tab isn't moved by the indent of its paragraph's first line", async () => {
		const tab = '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r>'
		const {container} = await show(
			docx(
				`<w:p><w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:t>Name:</w:t></w:r>${tab}</w:p>` +
					`<w:p><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr><w:r><w:t>Date:</w:t></w:r>${tab}</w:p>`,
			),
		)
		// The line is drawn by what the tab's box holds, whose first line is the box's own
		const tabs = [...container.querySelectorAll<HTMLElement>('.umbrel-docx-lined-tab')]
		expect(tabs.map((tab) => tab.parentElement!.style.textIndent)).toEqual(['48px', '-48px'])
		expect(tabs.map((tab) => tab.style.textIndent)).toEqual(['0px', '0px'])
	})
})

// Laying documents out in jsdom, again and again, takes seconds on a busy machine
describe('laying out again after an edit', {timeout: 60000}, () => {
	// jsdom has no layout, so these tests give it one: a paragraph's text runs 40 characters to a 20 px line between its
	// space before and after, a table's rows stack, each as tall as its tallest cell, other boxes stack what they hold
	// (one that isn't displayed takes no room), and an inline box sits on the line of its first character. Enough for
	// pages to fill, paragraphs and tables to break across them, footnotes to take room, and edits to move lines.
	const LINE = 20
	const CHARS = 40
	// Characters to a line, which the face sets: a test of a face that arrives late changes it
	let chars = CHARS
	// How much of its line, from the top, the text is drawn in: all of it, but for a test of a line's leading
	let drawn = LINE
	// A paragraph's block (or a part of one): a positioned box in a galley or a page's column (which have a width), or
	// in a cell
	const paragraph = (element: Element) =>
		element instanceof HTMLDivElement &&
		element.style.position === 'relative' &&
		!element.style.width &&
		Boolean(element.parentElement?.style.width || element.parentElement?.parentElement instanceof HTMLTableCellElement)
	const blockOf = (node: Node) => {
		for (let element = node instanceof Element ? node : node.parentElement; element; element = element.parentElement)
			if (paragraph(element)) return element as HTMLElement
		return undefined
	}
	// Where a node's text starts in its paragraph, in characters
	const offsetOf = (block: HTMLElement, node: Node) => {
		let offset = 0
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
		for (let text = walker.nextNode(); text && !(node === text || node.contains(text)); text = walker.nextNode())
			offset += (text as Text).length
		return offset
	}
	const lines = (block: HTMLElement) => Math.max(1, Math.ceil((block.textContent?.length ?? 0) / chars))
	const before = (block: HTMLElement) => parseFloat(block.style.paddingTop) || 0
	const after = (block: HTMLElement) => parseFloat(block.style.paddingBottom) || 0
	const heightOf = (element: Element): number =>
		element instanceof HTMLElement && element.style.display === 'none'
			? 0
			: paragraph(element)
				? before(element as HTMLElement) + LINE * lines(element as HTMLElement) + after(element as HTMLElement)
				: element instanceof HTMLTableElement
					? [...element.rows].reduce((sum, row) => sum + heightOf(row), 0)
					: element instanceof HTMLTableRowElement
						? Math.max(0, ...[...element.cells].map((cell) => heightOf(cell)))
						: element instanceof HTMLDivElement || element instanceof HTMLTableCellElement
							? [...element.children].reduce((sum, child) => sum + heightOf(child), 0)
							: 0
	// A block in a cell is under the blocks before it there. Of any other box, only how tall it is gets asked.
	const topOf = (element: Element) => {
		let top = 0
		if (element.parentElement?.parentElement instanceof HTMLTableCellElement)
			for (let above = element.previousElementSibling; above; above = above.previousElementSibling)
				top += heightOf(above)
		return top
	}
	const line = (block: HTMLElement, k: number) => new DOMRect(0, topOf(block) + before(block) + k * LINE, 100, drawn)
	const rectOf = function (this: Element) {
		const block = blockOf(this)
		if (block && block !== this) {
			// The paragraph's mark ends its last line; anything else sits where its text starts
			const offset = Math.min(offsetOf(block, this), (lines(block) - 1) * chars)
			return line(block, Math.floor(offset / chars))
		}
		if (this instanceof HTMLTableRowElement) {
			const table = this.closest('table')!
			const rows = [...table.rows]
			const top = rows.slice(0, rows.indexOf(this)).reduce((sum, row) => sum + heightOf(row), topOf(table))
			return new DOMRect(0, top, 100, heightOf(this))
		}
		return new DOMRect(0, topOf(this), parseFloat((this as HTMLElement).style?.width) || 100, heightOf(this))
	}
	const rangeRects = function (this: Range) {
		const text = this.startContainer
		const block = text.nodeType === Node.TEXT_NODE && blockOf(text)
		if (!block || this.collapsed) return Object.assign([], {item: () => null}) as unknown as DOMRectList
		const start = offsetOf(block, text) + this.startOffset
		const end = offsetOf(block, text) + (this.endContainer === text ? this.endOffset : (text as Text).length)
		const rects: DOMRect[] = []
		for (let k = Math.floor(start / chars); k <= Math.floor((end - 1) / chars); k++) rects.push(line(block, k))
		return Object.assign(rects, {item: (i: number) => rects[i] ?? null}) as unknown as DOMRectList
	}
	beforeEach(() => {
		const stubs = [
			vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectOf),
			vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
				return heightOf(this)
			}),
			vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(rangeRects),
		]
		onTestFinished(() => stubs.forEach((stub) => stub.mockRestore()))
	})

	const pagesOf = (container: HTMLElement) =>
		[...container.firstElementChild!.firstElementChild!.children].map((slot) => slot.textContent)

	test('text taken out before a page break brings back the words after it', async () => {
		// 41 lines, then a paragraph of four whose first two end the page
		const {doc, container} = await show(
			docx(
				`<w:p><w:r><w:t>${'a'.repeat(41 * CHARS)}</w:t></w:r></w:p><w:p><w:r><w:t>${'b'.repeat(80)}${'c'.repeat(77)}</w:t></w:r></w:p>`,
			),
			true,
		)
		const part = [...container.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent!.startsWith('b'))!
		expect(part.textContent).toBe('b'.repeat(80))
		// Three letters fewer: the paragraph keeps its four lines, and the page's last one takes three more letters
		;(part.firstChild as Text).nodeValue = 'b'.repeat(77)
		document.getSelection()!.collapse(part.firstChild!, 0)
		part.dispatchEvent(new InputEvent('input', {bubbles: true}))
		doc.setEditable(false)
		expect(pagesOf(container)[0]!.endsWith(`${'b'.repeat(77)}ccc`)).toBe(true)
	})

	test('a paragraph cut where a page ends is as tall as its lines, wherever in them the text is drawn', async () => {
		// Text in the top 16 px of each 20 px line, as a browser draws it that puts all of a line's leading under the
		// text, on a page with room for 43 lines and all but a pixel of one more
		drawn = 16
		onTestFinished(() => void (drawn = LINE))
		const page = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1215"/></w:sectPr>'
		const {container} = await show(docx(`<w:p><w:r><w:t>${'a'.repeat(50 * CHARS)}</w:t></w:r></w:p>${page}`))
		expect(pagesOf(container).map((text) => text!.length / CHARS)).toEqual([43, 7])
	})

	test('a page keeps room for a header or a footer only when it has one', async () => {
		// A page 400 px tall with margins of a centimetre (37.8 px), narrower than the half inch (48 px) a header and a
		// footer are set in from its edges
		const page = (references = '') =>
			`<w:sectPr>${references}<w:pgSz w:w="12240" w:h="6000"/><w:pgMar w:top="567" w:bottom="567" w:header="720" w:footer="720"/></w:sectPr>`
		const text = `<w:p><w:r><w:t>${'a'.repeat(39 * CHARS)}</w:t></w:r></w:p>`
		const linesOf = (container: HTMLElement) =>
			pagesOf(container)
				.map((slot) => slot!.split('a').length - 1)
				.map((n) => n / CHARS)
		// With neither, the text has all that the margins leave: 324.4 px, 16 lines
		const bare = await show(docx(text + page()))
		expect(linesOf(bare.container)).toEqual([16, 16, 7])
		// A header of one line ends 68 px down the page and a footer of one starts 68 px up it: 264 px, 13 lines
		const story = (root: string) =>
			`<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}><w:p><w:r><w:t>b</w:t></w:r></w:p></w:${root}>`
		const both = await show(
			docx(
				text +
					page(
						'<w:headerReference w:type="default" r:id="rIdHead"/><w:footerReference w:type="default" r:id="rIdFoot"/>',
					),
				{
					parts: {'word/header1.xml': story('hdr'), 'word/footer1.xml': story('ftr')},
					rels: [
						{id: 'rIdHead', type: 'header', target: 'header1.xml'},
						{id: 'rIdFoot', type: 'footer', target: 'footer1.xml'},
					],
				},
			),
		)
		expect(linesOf(both.container)).toEqual([13, 13, 13])
	})

	test('a shaded paragraph cut where a page ends has its space before and after on neither side of the cut', async () => {
		// Three paragraphs shaded alike share a box, with the space between them inside it: 37 lines, then eight of
		// which four end the page, then one
		const shaded = (text: string) =>
			`<w:p><w:pPr><w:shd w:val="clear" w:fill="EEEEEE"/><w:spacing w:before="480" w:after="240"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
		const {container} = await show(docx(shaded('a'.repeat(37 * CHARS)) + shaded('b'.repeat(8 * CHARS)) + shaded('c')))
		const boxes = (letter: string) =>
			[...container.querySelectorAll<HTMLElement>('span')]
				.filter((span) => span.textContent!.startsWith(letter))
				.map((span) => span.parentElement!)
		const [first] = boxes('a')
		const [above, below] = boxes('b')
		const [last] = boxes('c')
		expect([above.textContent, below.textContent]).toEqual(['b'.repeat(4 * CHARS), 'b'.repeat(4 * CHARS)])
		// What's above the cut keeps the space before that the last paragraph has too, and what's below it the space after
		// that the first has
		expect(parseFloat(last.style.paddingTop)).toBeGreaterThan(0)
		expect(parseFloat(first.style.paddingBottom)).toBeGreaterThan(0)
		expect([above.style.paddingTop, above.style.paddingBottom]).toEqual([last.style.paddingTop, '0px'])
		expect([below.style.paddingTop, below.style.paddingBottom]).toEqual(['0px', first.style.paddingBottom])
	})

	test('a paragraph that ends with a page break stays whole before it, and the one after starts the page', async () => {
		const BREAK = '<w:r><w:br w:type="page"/></w:r>'
		const p = (text: string, end = '') => `<w:p>${text && `<w:r><w:t>${text}</w:t></w:r>`}${end}</w:p>`
		const body = p('one') + p('', BREAK) + p('two') + p('three', BREAK) + p('four')
		// The paragraphs on each page, by their text
		const blocksOf = (container: HTMLElement) =>
			[...container.firstElementChild!.firstElementChild!.children].map((slot) =>
				[...slot.querySelectorAll('div')].filter(paragraph).map((block) => block.textContent),
			)
		const {doc, container} = await show(docx(body))
		expect(blocksOf(container)).toEqual([['one', ''], ['two', 'three'], ['four']])
		doc.destroy()
		container.remove()
		// A document can ask for what early versions of Word did: the paragraph's mark goes on, to a line of its own
		const early = await show(docx(body, {settings: '<w:compat><w:splitPgBreakAndParaMark/></w:compat>'}))
		expect(blocksOf(early.container)).toEqual([
			['one', ''],
			['', 'two', 'three'],
			['', 'four'],
		])
	})

	test("an edit to a table's header row shows where the table goes on and repeats it", async () => {
		const row = (text: string, header = false) =>
			`<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`
		// A header row and 60 more: two pages
		const rows = Array.from({length: 60}, (_, i) => row(`row ${i}`)).join('')
		const {doc, container} = await show(
			docx(`<w:tbl><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>${row('heading', true)}${rows}</w:tbl>`),
			true,
		)
		expect(pagesOf(container)[1]!.startsWith('heading')).toBe(true)
		const heading = [...container.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent === 'heading')!
		;(heading.firstChild as Text).nodeValue = 'Heading'
		document.getSelection()!.collapse(heading.firstChild!, 0)
		heading.dispatchEvent(new InputEvent('input', {bubbles: true}))
		doc.setEditable(false)
		expect(pagesOf(container)[1]!.startsWith('Heading')).toBe(true)
	})

	test('once the pages are up, measuring never changes what the box they are in holds', async () => {
		// WebKit lays every page out again when that box's children change: a second for a long document
		const container = document.createElement('div')
		document.body.append(container)
		const records: MutationRecord[] = []
		const observer = new MutationObserver((list) => records.push(...list))
		observer.observe(container, {childList: true, subtree: true})
		const doc = await openDocument(
			docx(Array.from({length: 60}, (_, i) => `<w:p><w:r><w:t>${'a'.repeat(10 + i * 7)}</w:t></w:r></w:p>`).join('')),
		)
		await doc.render(container)
		current = {doc, container}
		// An edit that takes a paragraph onto another line, and so lays the pages out again
		doc.setEditable(true)
		const text = container.querySelector('span')!.firstChild as Text
		text.nodeValue += 'b'.repeat(CHARS)
		document.getSelection()!.collapse(text, 0)
		text.parentElement!.dispatchEvent(new InputEvent('input', {bubbles: true}))
		doc.setEditable(false)
		records.push(...observer.takeRecords())
		observer.disconnect()
		const root = container.firstElementChild!
		const up = records.findIndex((record) => record.target === root.firstElementChild && record.addedNodes.length)
		expect(up).toBeGreaterThanOrEqual(0)
		expect(records.slice(up).filter((record) => record.target === root)).toEqual([])
	})

	test('one range measures everything, however many paragraphs are measured and cut and whatever is typed', async () => {
		// A document keeps every range made in it up to date through each change to its nodes until the range is
		// collected: the thousands a long document's layout would leave slow every node put on a page after
		const made = vi.spyOn(document, 'createRange')
		onTestFinished(() => made.mockRestore())
		// Several pages, with paragraphs cut across them
		const {doc, container} = await show(
			docx(Array.from({length: 60}, (_, i) => `<w:p><w:r><w:t>${'a'.repeat(10 + i * 7)}</w:t></w:r></w:p>`).join('')),
			true,
		)
		expect(pagesOf(container).length).toBeGreaterThan(2)
		expect(made).toHaveBeenCalledTimes(1)
		// A caret placed, and an edit that takes a paragraph onto another line and so lays the pages out again
		const text = container.querySelector('span')!.firstChild as Text
		document.getSelection()!.collapse(text, 0)
		document.dispatchEvent(new Event('selectionchange'))
		text.nodeValue += 'b'.repeat(CHARS)
		text.parentElement!.dispatchEvent(new InputEvent('input', {bubbles: true}))
		doc.setEditable(false)
		expect(made).toHaveBeenCalledTimes(1)
	})

	test('a page stays rendered while a caret can be taken to it or text on it is selected', async () => {
		// Twelve pages, each filled by a paragraph
		const {doc, container} = await show(
			docx(
				Array.from(
					{length: 12},
					(_, i) => `<w:p><w:r><w:t>${fill(String.fromCharCode(97 + i), 43)}</w:t></w:r></w:p>`,
				).join(''),
			),
			true,
		)
		const slots = [...container.firstElementChild!.firstElementChild!.children] as HTMLElement[]
		expect(slots).toHaveLength(12)
		// The pages kept rendered wherever they scroll to, by number
		const held = () => slots.flatMap((slot, i) => (slot.style.contentVisibility === 'visible' ? [i + 1] : []))
		const selection = document.getSelection()!
		const select = (from: number, to = from) => {
			const text = (page: number) => slots[page - 1].querySelector('span')!.firstChild!
			selection.setBaseAndExtent(text(from), 0, text(to), from === to ? 0 : 1)
			document.dispatchEvent(new Event('selectionchange'))
		}
		// A caret's page, those beside it, and the document's first and last
		select(3)
		expect(held()).toEqual([1, 2, 3, 4, 12])
		// The pages a selection's end leaves behind as it grows have selected text on them, and stay: let go, they would
		// lose it from the selection in Safari
		select(3, 5)
		select(3, 9)
		expect(held()).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 12])
		select(9)
		expect(held()).toEqual([1, 8, 9, 10, 12])
		// A document that's only read keeps those with selected text on them, and selecting all of it changes none
		select(3, 9)
		doc.setEditable(false)
		expect(held()).toEqual([3, 4, 8, 9])
		doc.selectAll()
		expect(held()).toEqual([3, 4, 8, 9])
		expect(selection.toString()).toHaveLength(12 * 43 * CHARS)
		// And none once the selection has moved on
		select(5)
		expect(held()).toEqual([])
	})

	test("a footer's tabs are laid out for the page number of each page", async () => {
		// A page number is 10 px a digit here, and so is what follows a tab on its line
		vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
			const box = rectOf.call(this)
			const number = this instanceof HTMLElement && this.dataset.field
			return number ? new DOMRect(box.x, box.y, this.textContent!.length * 10, box.height) : box
		})
		vi.mocked(Range.prototype.getClientRects).mockImplementation(function (this: Range) {
			if (this.startContainer.nodeType === Node.TEXT_NODE) return rangeRects.call(this)
			const tab = (this.startContainer.childNodes[this.startOffset - 1] as Element).getBoundingClientRect()
			const rects = [new DOMRect(0, tab.y, this.toString().length * 10, tab.height)]
			return Object.assign(rects, {item: (i: number) => rects[i] ?? null}) as unknown as DOMRectList
		})
		// "Page", then the number set to end at a stop 80 px in
		const footer =
			`<?xml version="1.0" encoding="UTF-8"?><w:ftr ${NAMESPACES}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="1200"/></w:tabs></w:pPr>` +
			'<w:r><w:t>Page</w:t></w:r><w:r><w:tab/></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'
		// Ten pages and some, of one line to a paragraph
		const {container} = await show(
			docx(
				`${'<w:p><w:r><w:t>a</w:t></w:r></w:p>'.repeat(440)}<w:sectPr><w:footerReference w:type="default" r:id="rIdFoot"/></w:sectPr>`,
				{parts: {'word/footer1.xml': footer}, rels: [{id: 'rIdFoot', type: 'footer', target: 'footer1.xml'}]},
			),
		)
		const tabs = [...container.firstElementChild!.firstElementChild!.children].map((slot) => {
			const story = [...slot.firstElementChild!.children].find((part) => part.textContent!.startsWith('Page'))!
			const tab = [...story.querySelectorAll('span')].find((span) => span.textContent === '\t')!
			return `${story.textContent!.replace('\t', ' ')}: ${tab.style.width}`
		})
		expect(tabs.length).toBeGreaterThan(10)
		expect(tabs.slice(0, 2)).toEqual(['Page 1: 70px', 'Page 2: 70px'])
		expect(tabs.slice(8, 11)).toEqual(['Page 9: 70px', 'Page 10: 60px', 'Page 11: 60px'])
	})

	test('a page number beside anything set from right to left stays in the text of its line', async () => {
		// Each at a stop: after "Page", after a Hebrew word, in a paragraph set from right to left, and after a run set
		// so. Only the first is made a box of its own: as one, each of the others would take another place in its line.
		const paragraph = (run: string, props = '') =>
			`<w:p><w:pPr>${props}<w:tabs><w:tab w:val="right" w:pos="1200"/></w:tabs></w:pPr><w:r>${run}</w:r>` +
			'<w:r><w:tab/></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'
		const footer =
			`<?xml version="1.0" encoding="UTF-8"?><w:ftr ${NAMESPACES}>${paragraph('<w:t>Page</w:t>')}` +
			`${paragraph('<w:t>\u05e2\u05de\u05d5\u05d3</w:t>')}${paragraph('<w:t>Page</w:t>', '<w:bidi/>')}` +
			`${paragraph('<w:rPr><w:rtl/></w:rPr><w:t>Page</w:t>')}</w:ftr>`
		const {container} = await show(
			docx('<w:p/><w:sectPr><w:footerReference w:type="default" r:id="rIdFoot"/></w:sectPr>', {
				parts: {'word/footer1.xml': footer},
				rels: [{id: 'rIdFoot', type: 'footer', target: 'footer1.xml'}],
			}),
		)
		const numbers = [...container.querySelectorAll<HTMLElement>('[data-field]')]
		expect(numbers.map((number) => number.style.display)).toEqual(['inline-block', '', '', ''])
	})

	test('a face that arrives after an open stops waiting has the pages laid out again, as an open would now', async () => {
		// It comes after the 3 s an open waits, and sets text narrower than what stood in for it: 50 characters to a
		// line, not 40
		let arrive!: () => void
		const arrived = new Promise<void>((resolve) => (arrive = resolve))
		Object.defineProperty(document, 'fonts', {configurable: true, value: {load: () => arrived}})
		onTestFinished(() => {
			delete (document as {fonts?: unknown}).fonts
			chars = CHARS
		})
		const bytes = docx(
			Array.from({length: 40}, (_, i) => `<w:p><w:r><w:t>${'a'.repeat(100 + i * 9)}</w:t></w:r></w:p>`).join(''),
		)
		const onLayout = vi.fn()
		vi.useFakeTimers({toFake: ['setTimeout']})
		let shown: Awaited<ReturnType<typeof show>> | undefined
		void show(bytes, false, {onLayout}).then((result) => (shown = result))
		while (!shown) await vi.advanceTimersByTimeAsync(500)
		vi.useRealTimers()
		const {container} = shown
		const first = pagesOf(container)
		chars = 50
		arrive()
		await vi.waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1))
		const fresh = document.createElement('div')
		document.body.append(fresh)
		const reopened = await openDocument(bytes)
		await reopened.render(fresh)
		expect(pagesOf(container)).toEqual(pagesOf(fresh))
		expect(pagesOf(container)).not.toEqual(first)
		reopened.destroy()
		fresh.remove()
	})

	// A page as its elements, with their attributes and styles (in an order that doesn't depend on how they were set),
	// and its text
	const shapeOf = (node: Node): string => {
		if (node instanceof Text) return node.data
		if (!(node instanceof HTMLElement)) return ''
		const attributes = [...node.attributes]
			.filter(({name}) => name !== 'style')
			.map(({name, value}) => `${name}="${value}"`)
		const styles = Array.from(node.style, (property) => `${property}: ${node.style.getPropertyValue(property)}`)
		return `<${node.tagName} ${[...attributes.sort(), ...styles.sort()].join(' ')}>${[...node.childNodes].map(shapeOf).join('')}</>`
	}
	const shapesOf = (container: HTMLElement) =>
		[...container.firstElementChild!.firstElementChild!.children].map((slot) => shapeOf(slot))

	// Random paragraphs (some kept with the next, some spaced, some justified, some after a page break, some with a
	// footnote, some items of a list), tables (some with a header row, some with a cell merged down, some with a table
	// inside a cell), a second section
	function generated(seed: number) {
		let state = seed
		const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
		const text = (n: number) =>
			Array.from({length: n}, (_, i) => String.fromCharCode(97 + ((i * 7 + seed) % 26))).join('')
		// A table inside a cell now and then, and one inside a cell of that one
		const inside = (depth: number): string =>
			depth < 2 && random() < 0.1
				? `<w:tbl><w:tblPr><w:tblW w:w="4680" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>${Array.from({length: 1 + Math.floor(random() * 3)}, () => `<w:tr>${cell(text(5 + Math.floor(random() * 400)), '', depth + 1)}</w:tr>`).join('')}</w:tbl><w:p/>`
				: ''
		const cell = (content: string, merge = '', depth = 0): string =>
			`<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/>${merge}</w:tcPr><w:p>${content && `<w:r><w:t>${content}</w:t></w:r>`}</w:p>${inside(depth)}</w:tc>`
		const table = () => {
			const rows = 2 + Math.floor(random() * 10)
			const header = random() < 0.3
			// A cell of the first column merged down two to five rows from here
			const merged = random() < 0.6 ? Math.floor(random() * rows) : rows
			const span = 2 + Math.floor(random() * 4)
			const row = (r: number) => {
				const merge =
					r < merged || r >= merged + span ? '' : r === merged ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>'
				return `<w:tr>${r === 0 && header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cell(merge === '<w:vMerge/>' ? '' : text(5 + Math.floor(random() * 160)), merge)}${cell(text(5 + Math.floor(random() * 160)))}</w:tr>`
			}
			return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${Array.from({length: rows}, (_, r) => row(r)).join('')}</w:tbl>`
		}
		let notes = 0
		const body = Array.from({length: 60}, (_, i) => {
			if (i !== 30 && random() < 0.12) return table()
			const pPr = [
				random() < 0.1 ? '<w:keepNext/>' : '',
				random() < 0.1 ? '<w:widowControl/>' : '',
				random() < 0.15 ? `<w:numPr><w:ilvl w:val="${Math.floor(random() * 2)}"/><w:numId w:val="1"/></w:numPr>` : '',
				random() < 0.3 ? '<w:spacing w:before="120" w:after="240"/>' : '',
				random() < 0.2 ? '<w:jc w:val="both"/>' : '',
				i === 30 ? '<w:sectPr><w:type w:val="continuous"/></w:sectPr>' : '',
			].join('')
			const note = random() < 0.08 ? `<w:r><w:footnoteReference w:id="${++notes}"/></w:r>` : ''
			// A page break now and then: before the paragraph's text, or after it all
			const roll = random()
			const brk = (when: boolean) => (when ? '<w:r><w:br w:type="page"/></w:r>' : '')
			return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${brk(roll < 0.04)}<w:r><w:t>${text(5 + Math.floor(random() * 400))}</w:t></w:r>${note}${brk(roll > 0.96)}</w:p>`
		}).join('')
		const footnotes = Array.from(
			{length: notes},
			(_, i) => `<w:footnote w:id="${i + 1}"><w:p><w:r><w:t>${text(20 + i * 30)}</w:t></w:r></w:p></w:footnote>`,
		).join('')
		const numbering =
			'<w:abstractNum w:abstractNumId="0">' +
			'<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
			'<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
			'</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
		return {bytes: docx(body, {footnotes, numbering}), random}
	}

	// Where two sets of pages first differ, in a few words, or nothing when they're the same
	const difference = (pages: string[], others: string[]) => {
		const page = pages.findIndex((shape, i) => shape !== others[i])
		if (page < 0) return pages.length === others.length ? undefined : `${pages.length} pages, not ${others.length}`
		let at = 0
		while (pages[page][at] === others[page]?.[at]) at++
		const around = (shape = '') => `…${shape.slice(Math.max(0, at - 80), at + 80)}…`
		return `page ${page + 1} is ${around(pages[page])}, not ${around(others[page])}`
	}

	// An edit somewhere at random, made as a browser makes it: text typed or deleted in a run, a paragraph divided, its
	// line broken, or joined to the one before, a selection across paragraphs and cells deleted or pasted over, bold
	// switched, a list item moved a level, the last edit undone and done again
	const KINDS = ['type', 'erase', 'divide', 'break', 'join', 'delete', 'paste', 'bold', 'level', 'undo'] as const
	function edit(doc: DocxDocument, container: HTMLElement, random: () => number): (typeof KINDS)[number] {
		const kind = KINDS[Math.floor(random() * KINDS.length)]
		const runs = [...container.querySelectorAll<HTMLElement>('span')].filter(
			(span) => !span.closest('[contenteditable="false"]') && span.firstChild?.nodeType === Node.TEXT_NODE,
		)
		// A list item's text follows its number: only those change level
		const items = runs.filter((span) => /^\d+\./.test(span.parentElement!.textContent ?? ''))
		const among = kind === 'level' && items.length ? items : runs
		const node = among[Math.floor(random() * among.length)].firstChild as Text
		const at = Math.floor(random() * (node.length + 1))
		const selection = document.getSelection()!
		selection.collapse(node, at)
		// A selection reaches into one of the next few runs
		const reach = () => {
			const end = runs[Math.min(runs.length - 1, runs.indexOf(node.parentElement!) + Math.floor(random() * 4))]
				.firstChild as Text
			const to = Math.floor(random() * (end.length + 1))
			if (end !== node || to >= at) selection.setBaseAndExtent(node, at, end, to)
			else selection.setBaseAndExtent(end, to, node, at)
		}
		// What the browser is left to do, it does in the DOM and then says
		const natively = (init: InputEventInit, make: () => void) => {
			if (input(init).defaultPrevented) return
			make()
			changed()
		}
		if (kind === 'type') {
			const data = 'x'.repeat(10 + Math.floor(random() * 120))
			natively({inputType: 'insertText', data}, () => {
				node.insertData(at, data)
				selection.collapse(node, at + data.length)
			})
		} else if (kind === 'erase') {
			const to = Math.min(node.length, at + 1 + Math.floor(random() * 150))
			selection.setBaseAndExtent(node, at, node, to)
			natively({inputType: 'deleteContentBackward'}, () => {
				node.deleteData(at, to - at)
				selection.collapse(node, at)
			})
		} else if (kind === 'divide') input({inputType: 'insertParagraph'})
		else if (kind === 'break') {
			press('Enter', {shiftKey: true})
			input({inputType: 'insertLineBreak'})
		} else if (kind === 'join') {
			selection.collapse(node, 0)
			press('Backspace')
		} else if (kind === 'delete') {
			reach()
			natively({inputType: 'deleteContentBackward'}, () => {
				const range = selection.getRangeAt(0)
				// Within one run, or the character before a caret
				if (range.collapsed) range.setStart(range.startContainer, range.startOffset - 1)
				range.deleteContents()
			})
		} else if (kind === 'paste') {
			if (random() < 0.5) reach()
			input({inputType: 'insertFromPaste'}, `pasted\n${'y'.repeat(Math.floor(random() * 90))}\n\tlast`)
		} else if (kind === 'bold') {
			reach()
			doc.format('bold')
		} else if (kind === 'level') {
			selection.collapse(node, 0)
			press('Tab', {shiftKey: random() < 0.3})
		} else {
			doc.undo()
			if (random() < 0.4) doc.redo()
		}
		return kind
	}

	// The pages of a document as it is now, saved and opened again
	const afresh = async (doc: DocxDocument) => {
		const container = document.createElement('div')
		document.body.append(container)
		const reopened = await openDocument(await doc.save())
		await reopened.render(container)
		const pages = shapesOf(container)
		reopened.destroy()
		container.remove()
		return pages
	}

	// Text that fills a number of lines
	const fill = (letter: string, count: number) => letter.repeat(count * CHARS)
	// The text of a run (the first that starts with `letter`) as a browser leaves it after typing or deleting in it,
	// and the pages as a pause in typing does
	const retype = (doc: DocxDocument, container: HTMLElement, letter: string, text: string) => {
		doc.setEditable(true)
		const run = [...container.querySelectorAll<HTMLElement>('span')].find((span) =>
			span.textContent!.startsWith(letter),
		)!
		;(run.firstChild as Text).nodeValue = text
		document.getSelection()!.collapse(run.firstChild!, 0)
		changed(run)
		doc.setEditable(false)
	}

	test('a row is cut by what its cells hold, whatever was typed in them since a page first ended at it', async () => {
		const p = (text: string, spacing = '') =>
			`<w:p>${spacing && `<w:pPr>${spacing}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`
		const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`
		// 42 lines and some space after them, on a page of 43: no line of the row that follows fits, of four lines beside
		// two, and it goes to the next page whole
		const {doc, container} = await show(
			docx(
				`${p(fill('a', 42), '<w:spacing w:after="200"/>')}<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid><w:tr>${cell(fill('b', 4))}${cell(fill('c', 2))}</w:tr></w:tbl>`,
			),
		)
		expect(pagesOf(container)).toEqual([fill('a', 42), `${fill('b', 4)}${fill('c', 2)}`])
		// A third line in the shorter cell leaves the row as tall, and the pages as they are
		retype(doc, container, 'c', fill('c', 3))
		// Two lines fewer before the table: two lines of the row fit, and the third of that cell goes over with the rest
		retype(doc, container, 'a', fill('a', 40))
		expect(pagesOf(container)).toEqual([
			`${fill('a', 40)}${fill('b', 2)}${fill('c', 2)}`,
			`${fill('b', 2)}${fill('c', 1)}`,
		])
		expect(difference(shapesOf(container), await afresh(doc))).toBeUndefined()
	})

	test('a footnote goes on the page of its reference, wherever typing has moved that in its paragraph', async () => {
		const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`
		// 36 lines, then a paragraph of four with a footnote referenced on its second
		const {doc, container} = await show(
			docx(
				`<w:p>${run(fill('a', 36))}</w:p><w:p>${run('b'.repeat(70))}<w:r><w:footnoteReference w:id="1"/></w:r>${run('c'.repeat(60))}</w:p>`,
				{footnotes: `<w:footnote w:id="1"><w:p>${run('note')}</w:p></w:footnote>`},
			),
		)
		expect(pagesOf(container)).toEqual([`${fill('a', 36)}${'b'.repeat(70)}1${'c'.repeat(60)}note`])
		// Half a line more before the reference puts it on the third line, and leaves the paragraph as tall
		retype(doc, container, 'b', 'b'.repeat(90))
		// Five lines more before the paragraph: its first two lines end the page, and the footnote is on the next
		retype(doc, container, 'a', fill('a', 41))
		expect(pagesOf(container)).toEqual([`${fill('a', 41)}${'b'.repeat(80)}`, `${'b'.repeat(10)}1${'c'.repeat(60)}note`])
		expect(difference(shapesOf(container), await afresh(doc))).toBeUndefined()
	})

	test('a row of a table inside a cell runs over the pages once it has to, and is whole again once it fits', async () => {
		const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
		const table = (...cells: string[]) =>
			`<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>${cells.map((cell) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr>`).join('')}</w:tbl>`
		// Two paragraphs, of two lines and 13, then a row whose cell holds a line, a table and a line, then a line. The
		// table's rows are twelve lines, twelve and one: 43 lines in all, a page of them.
		const inside = table(p(fill('b', 12)), p(fill('c', 12)), p('d'))
		const {doc, container} = await show(
			docx(p(fill('x', 2)) + p(fill('a', 13)) + table(p('label') + inside + p('last')) + p('after')),
			true,
		)
		const whole = `${fill('x', 2)}${fill('a', 13)}label${fill('b', 12)}${fill('c', 12)}dlastafter`
		expect(pagesOf(container)).toEqual([whole])
		// The pages as a pause in typing leaves them, which are those of the document opened as it is now
		const pages = async () => {
			doc.setEditable(false)
			expect(difference(shapesOf(container), await afresh(doc))).toBeUndefined()
			doc.setEditable(true)
			return pagesOf(container)
		}
		const text = (letter: string, part = 0) =>
			[...container.querySelectorAll<HTMLElement>('span')].filter((span) => span.textContent!.startsWith(letter))[part]
				.firstChild as Text
		// Lines typed at the start of a part of a run, as a browser types them, which an undo takes back
		const type = (letter: string, part: number, count: number) => {
			document.getSelection()!.collapse(text(letter, part), 0)
			input({inputType: 'insertText', data: fill(letter, count)})
			text(letter, part).insertData(0, fill(letter, count))
			changed()
		}
		// 16 lines more before the table: the page ends eleven lines into the first row of twelve
		type('a', 0, 16)
		expect(await pages()).toEqual([
			`${fill('x', 2)}${fill('a', 29)}label${fill('b', 11)}`,
			`${fill('b', 1)}${fill('c', 12)}dlastafter`,
		])
		// Ten lines fewer, and the two paragraphs one: the page ends nine lines into the second row
		document.getSelection()!.setBaseAndExtent(text('x'), CHARS, text('a'), 9 * CHARS)
		input({inputType: 'deleteContentBackward'})
		expect(await pages()).toEqual([
			`${fill('x', 1)}${fill('a', 20)}label${fill('b', 12)}${fill('c', 9)}`,
			`${fill('c', 3)}dlastafter`,
		])
		// Three lines more below the cut, then one more above it
		type('c', 1, 3)
		expect((await pages())[1]).toBe(`${fill('c', 6)}dlastafter`)
		type('b', 0, 1)
		expect(await pages()).toEqual([
			`${fill('x', 1)}${fill('a', 20)}label${fill('b', 13)}${fill('c', 8)}`,
			`${fill('c', 7)}dlastafter`,
		])
		for (let step = 0; step < 4; step++) doc.undo()
		expect(await pages()).toEqual([whole])
	})

	test(
		'the pages equal the edited document laid out afresh, edit after edit, and the rest stay',
		{timeout: 120000},
		async () => {
			let kept = 0
			let rebuilt = 0
			const made = new Set<string>()
			for (let seed = 1; seed <= 4; seed++) {
				const {bytes, random} = generated(seed)
				const {doc, container} = await show(bytes, true)
				let last = shapesOf(container).join()
				for (let n = 0; n < 20; n++) {
					const slots = [...container.firstElementChild!.firstElementChild!.children]
					const kind = edit(doc, container, random)
					// A page with selected text on it stays rendered, as one laid out afresh isn't: a caret is left
					document.getSelection()!.collapseToEnd()
					// Leaving edit mode lays out what's pending, as a pause in typing does
					doc.setEditable(false)
					const pages = shapesOf(container)
					if (pages.join() !== last) made.add(kind)
					last = pages.join()
					expect(difference(pages, await afresh(doc)), `seed ${seed} edit ${n} (${kind})`).toBeUndefined()
					for (const slot of container.firstElementChild!.firstElementChild!.children)
						if (slots.includes(slot)) kept++
						else rebuilt++
					doc.setEditable(true)
				}
				doc.destroy()
				container.remove()
				current = undefined
				// The stubs remember every element they were asked about, and so would keep every page ever laid out
				vi.clearAllMocks()
			}
			// Every kind of edit changed the pages at least once
			expect([...made].sort()).toEqual([...KINDS].sort())
			// Pages an edit didn't change are the same elements as before
			expect(kept).toBeGreaterThan(rebuilt)
		},
	)
})

describe('hostile structures', {timeout: 60000}, () => {
	test('random documents render, edit and save without throwing', async () => {
		const random = structures(11)
		for (let i = 0; i < 150; i++) {
			const body = random()
			let opened: DocxDocument
			try {
				opened = await openDocument(docx(body))
			} catch {
				continue
			}
			const container = document.createElement('div')
			document.body.append(container)
			try {
				await opened.render(container)
				opened.setEditable(true)
				const text = [...container.querySelectorAll('span')].find(
					(span) => span.firstChild?.nodeType === Node.TEXT_NODE && span.getAttribute('contenteditable') !== 'false',
				)
				if (text) {
					text.firstChild!.nodeValue += ' edited'
					document.getSelection()!.collapse(text.firstChild!, 1)
					text.dispatchEvent(new InputEvent('input', {bubbles: true}))
				}
				await opened.save()
			} catch (error) {
				throw new Error(`${String(error)}\n${body}`)
			} finally {
				opened.destroy()
				container.remove()
			}
		}
	})

	test('names every object inherits are names like any other', async () => {
		const inherited = ['constructor', '__proto__', 'toString']
		const field = (format: string) =>
			`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE \\* ${format}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
		const anchor = (from: string) =>
			`<w:r><w:drawing><wp:anchor behindDoc="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${from}"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${from}"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/><wp:wrapNone/><wp:docPr id="2" name="s"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:prstGeom prst="rect"/><a:solidFill><a:prstClr val="${from}"/></a:solidFill></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
		const body = inherited
			.map(
				(name) =>
					`<w:p><w:pPr><w:jc w:val="${name}"/><w:tabs><w:tab w:val="${name}" w:leader="${name}" w:pos="2000"/></w:tabs><w:pBdr><w:top w:val="${name}" w:sz="4"/></w:pBdr></w:pPr>` +
					`<w:r><w:rPr><w:rFonts w:ascii="${name}" w:hAnsi="${name}"/><w:highlight w:val="${name}"/><w:u w:val="${name}"/><w:lang w:val="${name}"/></w:rPr><w:t>${name}</w:t></w:r>` +
					`${field(name)}${anchor(name)}</w:p>`,
			)
			.join('')
		const {container, result} = await show(docx(body))
		expect(result.pages.length).toBeGreaterThan(0)
		expect(container.textContent).toContain('constructor')
	})
})

describe('table widths', () => {
	const table = (grid: number[], width?: Table['props']['width']) =>
		({kind: 'table', props: {width}, grid, rows: [], outdent: 0}) as Table

	test('the saved grid, unless the table takes a share of its column', () => {
		expect(gridOf(table([100, 200]), 600)).toEqual([100, 200])
		expect(gridOf(table([100, 200], {type: 'dxa', value: 500}), 600)).toEqual([100, 200])
		expect(gridOf(table([100, 200], {type: 'pct', value: 0.5}), 600)).toEqual([100, 200])
		expect(gridOf(table([100, 200], {type: 'pct', value: 1}), 600)).toEqual([200, 400])
	})

	test('without a grid, the width is shared out', () => {
		expect(gridOf(table([0, 0, 0]), 600)).toEqual([200, 200, 200])
		expect(gridOf(table([0, 0], {type: 'dxa', value: 300}), 600)).toEqual([150, 150])
		expect(gridOf(table([100, 0, 0], {type: 'pct', value: 1}), 500)).toEqual([100, 200, 200])
	})
})

describe('tab stops', () => {
	const tab = {stops: [], indent: 0, hanging: 0, right: 0, cell: false}
	const made = (compatibilityMode: number) => ({defaultTabStop: 48, compatibilityMode})

	test('a tab runs to the next stop, and one that starts at a stop to the one after', () => {
		expect(tabStop(tab, 10, 600, made(15)).pos).toBe(48)
		expect(tabStop(tab, 48, 600, made(15)).pos).toBe(96)
		// A tab that follows another starts where that one ended: at its stop, as the browser rounded it
		expect(tabStop(tab, 96 - 1 / 64, 600, made(15)).pos).toBe(144)
		const dotted = {...tab, stops: [{pos: 96, align: 'left' as const, leader: 'dot' as const}]}
		expect(tabStop(dotted, 96 - 1 / 64, 600, made(15))).toEqual({pos: 144, align: 'left', leader: 'none'})
	})

	test('text is set at a stop past the end of its lines, but in the margin only by a document made before Word 2013', () => {
		// Lines that end at 600 in a column 650 wide, for the right indent
		const numbered = (pos: number) => ({
			...tab,
			right: 50,
			stops: [{pos, align: 'right' as const, leader: 'dot' as const}],
		})
		const number = {width: 20, decimal: 20}
		// Beyond the indent: the number ends at the stop
		for (const mode of [12, 15]) {
			const stop = tabStop(numbered(640), 100, 600, made(mode))
			expect(stop).toEqual({pos: 640, align: 'right', leader: 'dot'})
			expect(tabWidth(stop, 100, number)).toBe(520)
		}
		// In the margin: there too, or since Word 2013 at the end of the line
		expect(tabStop(numbered(700), 100, 600, made(12)).pos).toBe(700)
		expect(tabStop(numbered(700), 100, 600, made(15))).toEqual({pos: 600, align: 'right', leader: 'dot'})
		const centred = {...tab, stops: [{pos: 700, align: 'center' as const, leader: 'none' as const}]}
		expect(tabStop(centred, 100, 600, made(15))).toEqual({pos: 600, align: 'right', leader: 'none'})
		// A cell has no margin: past its edge is the cell beside it, whenever the document was made
		expect(tabStop({...numbered(700), cell: true}, 100, 600, made(12))).toEqual({
			pos: 600,
			align: 'right',
			leader: 'dot',
		})
		expect(tabStop({...numbered(640), cell: true}, 100, 600, made(12)).pos).toBe(640)
		// Text that starts at a stop is none of this
		const left = {...tab, stops: [{pos: 700, align: 'left' as const, leader: 'none' as const}]}
		expect(tabStop(left, 100, 600, made(15)).pos).toBe(700)
	})
})

describe('editing', () => {
	const BOLD = '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bold </w:t></w:r>'
	const EMPTY = '<w:p/>'
	const SECOND = '<w:p><w:r><w:t xml:space="preserve">Second paragraph</w:t></w:r></w:p>'
	const SAMPLE = `<w:p>${BOLD}<w:r><w:t>plain</w:t></w:r></w:p>${EMPTY}${SECOND}`
	const PAGE_BREAK = '<w:r><w:br w:type="page"/></w:r>'
	// A field as Word writes one: its code and the result it last gave, between marks
	const fieldMark = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`
	const field = (code: string, result: string) =>
		`${fieldMark('begin')}<w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>${fieldMark('separate')}` +
		`<w:r><w:t>${result}</w:t></w:r>${fieldMark('end')}`
	const sample = () => docx(SAMPLE)
	const span = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll('span')].find((element) => element.textContent === text)!
	// The document's body as a save writes it
	const body = async (doc: DocxDocument) => {
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		return xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('</w:body>'))
	}
	// The selection: put in the text of the runs showing these words, and read back as the text its caret is in
	const caret = (container: HTMLElement, text: string, offset: number) =>
		document.getSelection()!.collapse(span(container, text).firstChild, offset)
	const select = (container: HTMLElement, from: [string, number], to: [string, number]) =>
		document
			.getSelection()!
			.setBaseAndExtent(span(container, from[0]).firstChild!, from[1], span(container, to[0]).firstChild!, to[1])
	const caretAt = () => {
		const {anchorNode, anchorOffset} = document.getSelection()!
		return [anchorNode instanceof Text ? anchorNode.data : anchorNode?.nodeName, anchorOffset]
	}
	// What a browser says an edit would change, from one place in the DOM to another
	const named = (from: [Node, number], to: [Node, number]) => [
		new StaticRange({startContainer: from[0], startOffset: from[1], endContainer: to[0], endOffset: to[1]}),
	]
	// A run's text as typing or deleting in it leaves it, the caret at its end
	const retype = (container: HTMLElement, was: string, now: string) => {
		const text = span(container, was).firstChild as Text
		text.nodeValue = now
		document.getSelection()!.collapse(text, now.length)
		changed(text.parentElement!)
	}
	// What can't be edited that shows this text: a field's result, a tab
	const object = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].find(
			(element) => element.textContent === text,
		)!
	const childIndex = (node: Node) => [...node.parentNode!.childNodes].indexOf(node as ChildNode)
	// The mark of the one empty paragraph, which typing there goes into
	const emptyMark = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLElement>('span')].find(
			(element) => !element.matches('[contenteditable="false"]') && element.querySelector('br'),
		)!
	const NUMBERING =
		'<w:abstractNum w:abstractNumId="0">' +
		'<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
		'<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>' +
		'</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
	const item = (text: string, level = 0) =>
		`<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>${text && `<w:r><w:t>${text}</w:t></w:r>`}</w:p>`
	// What the list items are numbered, as the pages show it
	const labels = (container: HTMLElement) =>
		[...container.querySelectorAll('[contenteditable="false"]')]
			.map((element) => element.textContent ?? '')
			.filter((text) => /^\w+[.)]$/.test(text))

	test('edits made in the DOM are read back into their w:t and saved there alone', async () => {
		const {doc, container} = await show(sample(), true)
		expect(doc.isDirty()).toBe(false)
		const plain = span(container, 'plain')
		plain.firstChild!.nodeValue = 'plainly edited'
		document.getSelection()!.collapse(plain.firstChild!, 3)
		plain.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: 'x'}))
		expect(doc.isDirty()).toBe(true)
		expect(await body(doc)).toBe(`<w:p>${BOLD}<w:r><w:t>plainly edited</w:t></w:r></w:p>${EMPTY}${SECOND}`)
		// Saved, the edit is the new baseline; typing again makes the document dirty again
		doc.markSaved()
		expect(doc.isDirty()).toBe(false)
		plain.firstChild!.nodeValue = 'again'
		changed(plain)
		expect(doc.isDirty()).toBe(true)
	})

	test("what isn't the document's to take is refused, saying so; typing in a run is the browser's to make", async () => {
		let refused = 0
		const {doc, container} = await show(sample(), true, {onRefuse: () => refused++})
		caret(container, 'plain', 2)
		const types = ['insertFromDrop', 'insertOrderedList', 'insertLink', 'formatJustifyCenter']
		for (const inputType of types) expect(input({inputType}).defaultPrevented, inputType).toBe(true)
		const drop = new Event('drop', {bubbles: true, cancelable: true})
		focused().dispatchEvent(drop)
		expect(drop.defaultPrevented).toBe(true)
		expect(refused).toBe(types.length + 1)
		expect(doc.isDirty()).toBe(false)

		refused = 0
		expect(input({inputType: 'insertText', data: 'y'}).defaultPrevented).toBe(false)
		expect(press('s', {metaKey: true}).defaultPrevented).toBe(false)
		expect(refused).toBe(0)
	})

	test('Enter divides the paragraph at the caret, and with Shift breaks its line', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'plain', 2)
		expect(input({inputType: 'insertParagraph'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(
			`<w:p>${BOLD}<w:r><w:t>pl</w:t></w:r></w:p><w:p><w:r><w:t>ain</w:t></w:r></w:p>${EMPTY}${SECOND}`,
		)
		expect(caretAt()).toEqual(['ain', 0])
		// Plain-text editing asks for a line break either way: whether Shift was down says which it is
		caret(container, 'Second paragraph', 6)
		press('Enter')
		input({inputType: 'insertLineBreak'})
		expect(await body(doc)).toContain(
			'<w:p><w:r><w:t>Second</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve"> paragraph</w:t></w:r></w:p>',
		)
		caret(container, ' paragraph', 5)
		press('Enter', {shiftKey: true})
		input({inputType: 'insertLineBreak'})
		expect(await body(doc)).toContain('<w:r><w:t xml:space="preserve"> para</w:t><w:br/><w:t>graph</w:t></w:r>')
		expect(caretAt()).toEqual(['graph', 0])
	})

	test('deleting back from the start of a paragraph joins it to the one before, forward from its end to the one after', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'Second paragraph', 0)
		expect(press('Backspace').defaultPrevented).toBe(true)
		// The empty paragraph is the one that went
		expect(await body(doc)).toBe(`<w:p>${BOLD}<w:r><w:t>plain</w:t></w:r></w:p>${SECOND}`)
		expect(caretAt()).toEqual(['Second paragraph', 0])
		// As a keyboard that sends no keys asks for it
		caret(container, 'plain', 5)
		expect(input({inputType: 'deleteContentForward'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(
			`<w:p>${BOLD}<w:r><w:t>plain</w:t></w:r><w:r><w:t xml:space="preserve">Second paragraph</w:t></w:r></w:p>`,
		)
		expect(caretAt()).toEqual(['plain', 5])
		// Nothing before the first paragraph to join: the caret stays, and nothing is said
		caret(container, 'Bold ', 0)
		expect(press('Backspace').defaultPrevented).toBe(true)
		expect(textOf(container)).toBe('Bold plainSecond paragraph')
	})

	test("typing over a selection that runs across paragraphs joins what's left of them", async () => {
		const {doc, container} = await show(sample(), true)
		select(container, ['plain', 2], ['Second paragraph', 6])
		expect(input({inputType: 'insertText', data: 'Z'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(
			`<w:p>${BOLD}<w:r><w:t>plZ</w:t></w:r><w:r><w:t xml:space="preserve"> paragraph</w:t></w:r></w:p>`,
		)
		expect(caretAt()).toEqual(['plZ', 3])
	})

	test('a selection that ends before the first character of a paragraph leaves that paragraph alone', async () => {
		// As a triple click selects a paragraph
		const {doc, container} = await show(sample(), true)
		document
			.getSelection()!
			.setBaseAndExtent(span(container, 'Bold ').firstChild!, 0, span(container, 'Second paragraph').firstChild!, 0)
		expect(input({inputType: 'deleteContentBackward'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(`<w:p></w:p>${SECOND}`)
	})

	test('a deletion and a paste are made where the caret is, whatever text the browser names for them', async () => {
		const {container} = await show(sample(), true)
		const plain = span(container, 'plain').firstChild!
		// A deletion named at the other end of the caret's own text, where Safari can take the selection to be
		caret(container, 'plain', 5)
		const far = named([plain, 0], [plain, 1])
		expect(input({inputType: 'deleteContentBackward', targetRanges: far}).defaultPrevented).toBe(true)
		expect(textOf(container)).toBe('Bold plaiSecond paragraph')
		expect(caretAt()).toEqual(['plai', 4])
		// A paste with text named for it, as a correction names the word it replaces
		input({inputType: 'insertFromPaste', targetRanges: named([plain, 0], [plain, 2])}, 'n')
		expect(textOf(container)).toBe('Bold plainSecond paragraph')
		expect(caretAt()).toEqual(['plain', 5])
	})

	test('a word corrected under a caret that has moved on from it leaves the caret where it is in the text', async () => {
		// A word in two runs, as a file that was saved more than once has many
		const {doc, container} = await show(
			docx(
				`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>wi</w:t></w:r><w:r><w:t xml:space="preserve">ch one</w:t></w:r></w:p>${SECOND}`,
			),
			true,
		)
		const text = (shown: string) => span(container, shown).firstChild!
		// Corrected once the space after it is typed: the caret stays after the space
		caret(container, 'ch one', 3)
		const word = named([text('wi'), 0], [text('ch one'), 2])
		input({inputType: 'insertReplacementText', data: 'which', targetRanges: word})
		expect(await body(doc)).toBe(
			`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>which</w:t></w:r><w:r><w:t xml:space="preserve"> one</w:t></w:r></w:p>${SECOND}`,
		)
		expect(caretAt()).toEqual([' one', 1])
		// And one in its run's own text, corrected once the next paragraph is begun
		caret(container, 'Second paragraph', 0)
		const run = span(container, ' one')
		input({inputType: 'insertText', data: ' two', targetRanges: named([run, 0], [run, 1])})
		expect(textOf(container)).toBe('which twoSecond paragraph')
		expect(caretAt()).toEqual(['Second paragraph', 0])
		// A caret at the end of what's corrected goes with what replaces it
		caret(container, ' two', 4)
		const both = named([text('which'), 0], [text(' two'), 4])
		input({inputType: 'insertReplacementText', data: 'whichever', targetRanges: both})
		expect(caretAt()).toEqual(['whichever', 9])
	})

	test('pasted text arrives as plain text, a paragraph for each of its lines', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'plain', 5)
		expect(input({inputType: 'insertFromPaste'}, ' one\r\ntwo\tthree\u0007').defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(
			`<w:p>${BOLD}<w:r><w:t>plain one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t><w:tab/><w:t>three</w:t></w:r></w:p>${EMPTY}${SECOND}`,
		)
		expect(caretAt()).toEqual(['three', 5])
	})

	test("bold, italic and underline switch for the selected text, and at a caret for what's typed next", async () => {
		const onChange = vi.fn()
		const {doc, container} = await show(sample(), true, {onChange})
		select(container, ['plain', 2], ['plain', 4])
		expect(doc.formatting()).toEqual({bold: false, italic: false, underline: false})
		expect(press('b', {metaKey: true}).defaultPrevented).toBe(true)
		expect(await body(doc)).toContain(
			'<w:r><w:t>pl</w:t></w:r><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>ai</w:t></w:r><w:r><w:t>n</w:t></w:r>',
		)
		// The text stays selected, and says what it now is
		expect(document.getSelection()!.toString()).toBe('ai')
		expect(doc.formatting()).toEqual({bold: true, italic: false, underline: false})
		doc.format('bold')
		expect(await body(doc)).toContain('<w:r><w:t>pl</w:t></w:r><w:r><w:t>ai</w:t></w:r><w:r><w:t>n</w:t></w:r>')
		// Where editing is rich, the browser asks for it instead
		expect(input({inputType: 'formatItalic'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toContain('<w:r><w:rPr><w:i/><w:iCs/></w:rPr><w:t>ai</w:t></w:r>')
		// Text only some of which is bold isn't, and becomes so
		select(container, ['Bold ', 2], ['pl', 2])
		expect(doc.formatting()?.bold).toBe(false)
		doc.format('bold')
		expect(await body(doc)).toContain(
			'<w:r><w:rPr><w:b/></w:rPr><w:t>Bo</w:t></w:r>' +
				'<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">ld </w:t></w:r>' +
				'<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>pl</w:t></w:r>',
		)

		// At a caret it waits for what's typed there, and goes if the caret moves on first
		caret(container, 'n', 1)
		onChange.mockClear()
		doc.format('underline')
		expect(onChange).toHaveBeenCalled()
		expect(doc.formatting()).toEqual({bold: false, italic: false, underline: true})
		expect(input({inputType: 'insertText', data: 'x'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toContain(
			'<w:r><w:t>n</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>x</w:t></w:r>',
		)
		expect(caretAt()).toEqual(['x', 1])
		doc.format('underline')
		expect(doc.formatting()?.underline).toBe(false)
		caret(container, 'n', 0)
		document.dispatchEvent(new Event('selectionchange'))
		caret(container, 'x', 1)
		expect(doc.formatting()?.underline).toBe(true)
	})

	test('Tab is a tab in the text, and Backspace takes one as it takes a character', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'plain', 2)
		expect(press('Tab').defaultPrevented).toBe(true)
		expect(await body(doc)).toContain('<w:r><w:t>pl</w:t><w:tab/><w:t>ain</w:t></w:r>')
		expect(caretAt()).toEqual(['ain', 0])
		expect(press('Backspace').defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(SAMPLE)
		expect(doc.isDirty()).toBe(false)
	})

	test('a list counts again as items come, change level and go', async () => {
		let refused = 0
		const {doc, container} = await show(
			docx(`${item('one')}${item('two')}<w:p><w:r><w:t>after</w:t></w:r></w:p>`, {numbering: NUMBERING}),
			true,
			{onRefuse: () => refused++},
		)
		expect(labels(container)).toEqual(['1.', '2.'])
		// Enter at the end of an item starts the next one, and in an empty item ends the list there
		caret(container, 'one', 3)
		input({inputType: 'insertParagraph'})
		expect(labels(container)).toEqual(['1.', '2.', '3.'])
		expect(await body(doc)).toContain(`${item('one')}${item('')}${item('two')}`)
		input({inputType: 'insertParagraph'})
		expect(labels(container)).toEqual(['1.', '2.'])
		expect(await body(doc)).toContain(`${item('one')}<w:p></w:p>${item('two')}`)
		press('z', {metaKey: true})
		press('z', {metaKey: true})
		expect(labels(container)).toEqual(['1.', '2.'])
		expect(doc.isDirty()).toBe(false)
		// Tab at the start of an item moves it a level in, Shift+Tab back out, and never past the levels the list has
		caret(container, 'two', 0)
		expect(press('Tab').defaultPrevented).toBe(true)
		expect(labels(container)).toEqual(['1.', 'a)'])
		expect(await body(doc)).toContain(item('two', 1))
		press('Tab')
		expect(refused).toBe(1)
		expect(labels(container)).toEqual(['1.', 'a)'])
		press('Tab', {shiftKey: true})
		expect(labels(container)).toEqual(['1.', '2.'])
		// Backspace at the start of an item takes it out of the list, and only then joins it to the one before
		press('Backspace')
		expect(labels(container)).toEqual(['1.'])
		expect(await body(doc)).toContain(`${item('one')}<w:p><w:r><w:t>two</w:t></w:r></w:p>`)
		press('Backspace')
		expect(await body(doc)).toContain(item('one').replace('</w:p>', '<w:r><w:t>two</w:t></w:r></w:p>'))
	})

	test('in a table Tab goes from cell to cell, and a selection across cells empties them and leaves the table', async () => {
		const cell = (text: string) => `<w:tc><w:p>${text && `<w:r><w:t>${text}</w:t></w:r>`}</w:p></w:tc>`
		const table = (...cells: string[]) =>
			`<w:tbl><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
			`<w:tr>${cell(cells[0])}${cell(cells[1])}</w:tr><w:tr>${cell(cells[2])}${cell(cells[3])}</w:tr></w:tbl>`
		const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
		const {doc, container} = await show(
			docx(`${paragraph('before')}${table('one', 'two', 'three', 'four')}${paragraph('after')}`),
			true,
		)
		// The text of the cell it goes to is selected, for typing to replace
		caret(container, 'one', 1)
		expect(press('Tab').defaultPrevented).toBe(true)
		expect(document.getSelection()!.toString()).toBe('two')
		press('Tab', {shiftKey: true})
		expect(document.getSelection()!.toString()).toBe('one')
		select(container, ['one', 1], ['four', 2])
		expect(input({inputType: 'deleteContentBackward'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(`${paragraph('before')}${table('o', '', '', 'ur')}${paragraph('after')}`)
		// From outside a table into it, what's typed goes where the selection began
		select(container, ['before', 3], ['ur', 1])
		input({inputType: 'insertText', data: 'X'})
		expect(await body(doc)).toBe(`${paragraph('befX')}${table('', '', '', 'r')}${paragraph('after')}`)
		// A table is never joined to: deleting back from the paragraph after one does nothing
		caret(container, 'after', 0)
		expect(press('Backspace').defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(`${paragraph('befX')}${table('', '', '', 'r')}${paragraph('after')}`)
	})

	test("an edit that would take a footnote's reference with it is refused, and changes nothing", async () => {
		let refused = 0
		const noted =
			'<w:p><w:r><w:t>note</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>d text</w:t></w:r></w:p>' +
			'<w:p><w:r><w:t>next</w:t></w:r></w:p>'
		const {doc, container} = await show(
			docx(noted, {footnotes: '<w:footnote w:id="1"><w:p><w:r><w:t>The note.</w:t></w:r></w:p></w:footnote>'}),
			true,
			{onRefuse: () => refused++},
		)
		caret(container, 'd text', 0)
		expect(press('Backspace').defaultPrevented).toBe(true)
		select(container, ['note', 2], ['d text', 3])
		expect(input({inputType: 'insertText', data: 'Z'}).defaultPrevented).toBe(true)
		select(container, ['note', 2], ['next', 3])
		expect(input({inputType: 'deleteContentBackward'}).defaultPrevented).toBe(true)
		expect(refused).toBe(3)
		expect(await body(doc)).toBe(noted)
		expect(doc.isDirty()).toBe(false)
		expect(doc.history).toEqual({undo: false, redo: false})
	})

	test('typing into an empty paragraph makes a run there', async () => {
		const {doc, container} = await show(sample(), true)
		const marks = [...container.querySelectorAll<HTMLElement>('span')].filter(
			(element) => !element.matches('[contenteditable="false"]') && element.querySelector('br'),
		)
		expect(marks).toHaveLength(1)
		const typed = document.createTextNode('typed')
		marks[0].prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		changed(marks[0])
		expect(await body(doc)).toContain('<w:p><w:r><w:t xml:space="preserve">typed</w:t></w:r></w:p>')
	})

	test('text typed into an empty paragraph and deleted again leaves nothing to save', async () => {
		const {doc, container} = await show(sample(), true)
		const mark = emptyMark(container)
		const typed = document.createTextNode('typed')
		mark.prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		changed(mark)
		expect(doc.isDirty()).toBe(true)
		// Deleting the last character, the browser takes the text node away with it
		typed.remove()
		document.getSelection()!.collapse(mark, 0)
		changed(mark)
		expect(doc.isDirty()).toBe(false)
		expect(await body(doc)).toBe(SAMPLE)
	})

	test('a paragraph whose text is all deleted keeps its line, saved and opened again', async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p/>'), true)
		const text = span(container, 'one').firstChild as Text
		text.nodeValue = ''
		document.getSelection()!.collapse(text, 0)
		changed(text.parentElement!)
		// Each paragraph's line is a line break in its mark, where no text holds one
		expect(container.querySelectorAll('br')).toHaveLength(2)
		const reopened = await openDocument(await doc.save())
		const again = document.createElement('div')
		await reopened.render(again)
		expect(again.querySelectorAll('br')).toHaveLength(2)
		reopened.destroy()
	})

	test('a mark holds a line where its part of the paragraph shows nothing, and only there', async () => {
		const {container} = await show(
			docx(`<w:p><w:r><w:t>one</w:t></w:r>${PAGE_BREAK}<w:r><w:t>two</w:t></w:r></w:p>`),
			true,
		)
		const [first, second] = ['one', 'two'].map((text) => span(container, text).closest('div'))
		const lines = () => [...container.querySelectorAll('br')].map((line) => line.closest('div'))
		expect(lines()).toEqual([])
		// Typing before the page break leaves what's after it alone
		retype(container, 'one', 'once')
		expect(lines()).toEqual([])
		// With the text after the break gone, the caret there still has its line, which the paragraph's mark holds
		retype(container, 'two', '')
		expect(lines()).toEqual([second])
		// And with the text before the break gone, the break's own mark holds the line that the break is on
		retype(container, 'once', '')
		expect(lines()).toEqual([first, second])
	})

	test('a page break that starts a paragraph is on a line of its own, and what goes in there goes before it', async () => {
		const {doc, container} = await show(docx(`<w:p>${PAGE_BREAK}<w:r><w:t>two</w:t></w:r></w:p>`), true)
		// The line is on the page that the break ends, and the break's mark holds it
		const line = () => container.querySelector('br')!.closest('div')!
		expect(container.querySelectorAll('br')).toHaveLength(1)
		expect(line()).not.toBe(span(container, 'two').closest('div'))
		// A caret on that line is before the break, and so is what's pasted there
		document.getSelection()!.collapse(line(), 0)
		input({inputType: 'insertFromPaste'}, 'one')
		expect(await body(doc)).toBe(`<w:p><w:r><w:t>one</w:t></w:r>${PAGE_BREAK}<w:r><w:t>two</w:t></w:r></w:p>`)
		expect(caretAt()).toEqual(['one', 3])
		expect(span(container, 'one').closest('div')).not.toBe(span(container, 'two').closest('div'))
		// Taken back, it leaves the line as it was, with the caret on it
		input({inputType: 'historyUndo'})
		expect(await body(doc)).toBe(`<w:p>${PAGE_BREAK}<w:r><w:t>two</w:t></w:r></w:p>`)
		expect(document.getSelection()!.anchorNode).toBe(line())
	})

	test("a paragraph's mark holds a line after a line break its text ends with, and none beside an object", async () => {
		const {container} = await show(
			docx(
				'<w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>' +
					`<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE', '1')}</w:p>`,
			),
			true,
		)
		const marks = () => container.querySelectorAll('span:last-child > br').length
		expect(marks()).toBe(0)
		// The line after the break is the mark's to hold once the text on it is gone, as it is when rendered that way
		retype(container, 'two', '')
		expect(marks()).toBe(1)
		// A page number holds its own line
		retype(container, 'Page ', '')
		expect(marks()).toBe(1)
	})

	test('at a page break that ends its paragraph, text is typed before the break and a deletion takes it', async () => {
		const p = (text: string, end = '') => `<w:p>${text && `<w:r><w:t>${text}</w:t></w:r>`}${end}</w:p>`
		// The first paragraph holds only a break, and a run after it that text was deleted from: nothing to show
		const LEFT = '<w:r><w:t></w:t></w:r>'
		const {doc, container} = await show(
			docx(`<w:p>${PAGE_BREAK}${LEFT}</w:p>` + p('two') + p('three', PAGE_BREAK) + p('four')),
			true,
		)
		// What's typed there goes into the paragraph's mark, on the page the break ends, and so before the break
		const mark = emptyMark(container)
		const typed = document.createTextNode('typed')
		mark.prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		changed(mark)
		const first = `<w:r><w:t xml:space="preserve">typed</w:t><w:br w:type="page"/></w:r>${LEFT}`
		expect(await body(doc)).toBe(`<w:p>${first}</w:p>` + p('two') + p('three', PAGE_BREAK) + p('four'))
		// Forward from the end of the text, a deletion takes the break
		caret(container, 'three', 5)
		expect(input({inputType: 'deleteContentForward'}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(`<w:p>${first}</w:p>` + p('two') + p('three') + p('four'))
		// Back from the start of the paragraph after it, one joins that paragraph on, past the break, and the next takes
		// the break
		caret(container, 'two', 0)
		press('Backspace')
		const joined = (between: string) => `<w:p><w:r><w:t>typed</w:t>${between}</w:r><w:r><w:t>two</w:t></w:r></w:p>`
		expect(await body(doc)).toBe(joined('<w:br w:type="page"/>') + p('three') + p('four'))
		expect(caretAt()).toEqual(['two', 0])
		press('Backspace')
		expect(await body(doc)).toBe(joined('') + p('three') + p('four'))
	})

	test('text the browser puts outside any run joins the run beside it', async () => {
		const {doc, container} = await show(sample(), true)
		const plain = span(container, 'plain')
		const stray = document.createTextNode(' stray')
		plain.after(stray)
		document.getSelection()!.collapse(stray, 6)
		changed(plain)
		expect(plain.textContent).toBe('plain stray')
		// One space between words needs no xml:space
		expect(await body(doc)).toContain('<w:r><w:t>plain stray</w:t></w:r>')
	})

	test("stray text after a link joins the link's run; between two objects it becomes a w:t beside them", async () => {
		const {doc, container} = await show(
			docx(
				'<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:tab/></w:r></w:p>' +
					'<w:p><w:r><w:tab/></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r></w:p>',
				{rels: [{id: 'rIdLink', type: 'hyperlink', target: 'https://example.com/', external: true}]},
			),
			true,
		)
		const anchor = container.querySelector('a')!
		const stray = document.createTextNode('ed')
		anchor.after(stray)
		document.getSelection()!.collapse(stray, 2)
		changed(anchor)
		expect(anchor.textContent).toBe('linked')

		const tabs = [...container.querySelectorAll('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const between = document.createTextNode('mid')
		tabs[2].before(between)
		document.getSelection()!.collapse(between, 3)
		changed(tabs[2])
		const xml = await body(doc)
		expect(xml).toContain('<w:hyperlink r:id="rIdLink"><w:r><w:t>linked</w:t></w:r></w:hyperlink>')
		expect(xml).toContain('<w:r><w:tab/><w:t>mid</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r>')
	})

	test('text typed beside a field is saved outside it, on the side it shows', async () => {
		const SEE = '<w:r><w:t xml:space="preserve">see </w:t></w:r>'
		const SIMPLE = '<w:fldSimple w:instr=" REF fig "><w:r><w:t>Figure 4</w:t></w:r></w:fldSimple>'
		const {doc, container} = await show(
			docx(
				`<w:p>${SEE}${field('REF fig', 'Figure 3')}</w:p><w:p>${field('PAGE', '1')}</w:p><w:p>${SEE}${SIMPLE}</w:p>`,
			),
			true,
		)
		// As the browser types where the caret is beside a field's result: in the paragraph, in no run's text
		const type = (result: string, side: 'before' | 'after', text: string) => {
			const shown = object(container, result)
			document.getSelection()!.collapse(shown.parentNode, childIndex(shown) + (side === 'after' ? 1 : 0))
			expect(input({inputType: 'insertText', data: text}).defaultPrevented).toBe(false)
			const typed = document.createTextNode(text)
			shown[side](typed)
			document.getSelection()!.collapse(typed, text.length)
			changed()
		}
		type('Figure 3', 'after', '.')
		type('1', 'before', 'Page ')
		type('Figure 4', 'after', '!')
		expect(await body(doc)).toBe(
			`<w:p>${SEE}${field('REF fig', 'Figure 3').slice(0, -6)}<w:t>.</w:t></w:r></w:p>` +
				`<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE', '1')}</w:p>` +
				`<w:p>${SEE}${SIMPLE}<w:r><w:t>!</w:t></w:r></w:p>`,
		)
		expect(textOf(container)).toBe('see Figure 3.Page 1see Figure 4!')
		expect(caretAt()).toEqual(['!', 1])
	})

	test('text typed in a paragraph that a field runs through is refused, and leaves nothing behind', async () => {
		let refused = 0
		// As Word writes a table of contents: a field from its first entry to a paragraph after its last
		const CONTENTS =
			`<w:p>${fieldMark('begin')}<w:r><w:instrText> TOC </w:instrText></w:r>${fieldMark('separate')}<w:r><w:t>Entry</w:t></w:r></w:p>` +
			`<w:p>${fieldMark('end')}</w:p>`
		const {doc, container} = await show(docx(CONTENTS), true, {onRefuse: () => refused++})
		const entry = object(container, 'Entry')
		// Its mark takes no typing, so the browser puts what's typed at its end beside the entry's text
		document.getSelection()!.collapse(entry.parentNode, 1)
		expect(input({inputType: 'insertText', data: 'x'}).defaultPrevented).toBe(false)
		entry.after('x')
		document.getSelection()!.collapse(entry.nextSibling, 1)
		changed()
		expect(refused).toBe(1)
		expect(textOf(container)).toBe('Entry')
		expect(doc.isDirty()).toBe(false)
		expect(doc.history).toEqual({undo: false, redo: false})
		// The paragraph the field ends in is typed in after it
		const after = emptyMark(container)
		after.prepend('y')
		document.getSelection()!.collapse(after.firstChild, 1)
		changed(after)
		expect(await body(doc)).toBe(CONTENTS.replace(/<\/w:p>$/, '<w:r><w:t xml:space="preserve">y</w:t></w:r></w:p>'))
	})

	test('text typed where the browser left no run to take it is saved where it shows, formatted as the text deleted there', async () => {
		const title = (text: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
		const {doc, container} = await show(docx(title('T') + SECOND), true)
		// Deleting the last character of a run, the browser takes its span away too: the caret is left in the paragraph
		const gone = span(container, 'T')
		const block = gone.parentElement!
		caret(container, 'T', 1)
		expect(input({inputType: 'deleteContentBackward'}).defaultPrevented).toBe(false)
		gone.remove()
		document.getSelection()!.collapse(block, 0)
		changed(block)
		expect(await body(doc)).toBe(title('') + SECOND)
		// What's typed next it puts there in elements of its own
		expect(input({inputType: 'insertText', data: 'N'}).defaultPrevented).toBe(false)
		const font = document.createElement('font')
		font.append('N')
		block.prepend(font)
		document.getSelection()!.collapse(font.firstChild, 1)
		changed(block)
		expect(await body(doc)).toBe(title('N') + SECOND)
		expect(container.querySelector('font')).toBeNull()
		expect(caretAt()).toEqual(['N', 1])
		// The run is there again for the rest of the word, and it's all one step to undo
		expect(input({inputType: 'insertText', data: 'e'}).defaultPrevented).toBe(false)
		const text = span(container, 'N').firstChild as Text
		text.nodeValue = 'Ne'
		document.getSelection()!.collapse(text, 2)
		changed(text.parentElement!)
		expect(await body(doc)).toBe(title('Ne') + SECOND)
		input({inputType: 'historyUndo'})
		expect(await body(doc)).toBe(title('') + SECOND)
		input({inputType: 'historyUndo'})
		expect(await body(doc)).toBe(title('T') + SECOND)
		input({inputType: 'historyRedo'})
		input({inputType: 'historyRedo'})
		expect(await body(doc)).toBe(title('Ne') + SECOND)
		expect(caretAt()).toEqual(['Ne', 2])
	})

	test('a document that ends with a page break is typed on from the page after it', async () => {
		const {doc, container} = await show(docx(`<w:p><w:r><w:t>one</w:t></w:r>${PAGE_BREAK}</w:p>`), true)
		// The paragraph's mark is on the last page, with no run there for what's typed
		const block = [...container.querySelectorAll('br')].at(-1)!.closest('div')!
		expect(block.textContent).toBe('')
		document.getSelection()!.collapse(block, 0)
		expect(input({inputType: 'insertText', data: 'X'}).defaultPrevented).toBe(false)
		block.prepend('X')
		document.getSelection()!.collapse(block.firstChild, 1)
		changed(block)
		expect(await body(doc)).toBe('<w:p><w:r><w:t>one</w:t></w:r><w:r><w:br w:type="page"/><w:t>X</w:t></w:r></w:p>')
		expect(caretAt()).toEqual(['X', 1])
		expect(span(container, 'X').closest('div')).not.toBe(span(container, 'one').closest('div'))
	})

	test('the key for an end of the line is taken on a line that ends there with an object, and from beside an object', async () => {
		const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
		// Lines, of which jsdom lays out none: all that a paragraph holds is on its first, but what's said to be on its
		// second (a text from one of its characters on), and an object that's said to run over both
		const second = new Map<Node, number>()
		const both = new Set<Node>()
		const box = (line: number) => new DOMRect(0, line * 20, 8, 16)
		// The browser's own move to an end of a line, which jsdom hasn't: it goes nowhere, but where it's told to
		const modify = vi.fn()
		Object.assign(Selection.prototype, {modify})
		const mocks = [
			platform,
			vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
				return (both.has(this) ? [box(0), box(1)] : [box(second.has(this) ? 1 : 0)]) as unknown as DOMRectList
			}),
			vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
				return [box(this.startOffset < (second.get(this.startContainer) ?? Infinity) ? 0 : 1)] as unknown as DOMRectList
			}),
		]
		onTestFinished(() => {
			mocks.forEach((mock) => mock.mockRestore())
			delete (Selection.prototype as Partial<Selection>).modify
		})
		const [TAB, BREAK] = ['<w:r><w:tab/></w:r>', '<w:r><w:br/></w:r>']
		const numbered = (bidi = '') =>
			`<w:p>${bidi}<w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE', '1')}</w:p>`
		const dated = `<w:p>${field('DATE', '17 November 2026')}<w:r><w:t xml:space="preserve"> was the day</w:t></w:r></w:p>`
		const form = `<w:p><w:r><w:t>Name:</w:t></w:r>${TAB}${BREAK}${TAB}<w:r><w:t>Address</w:t></w:r></w:p>`
		const cited = `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>${field('REF title', 'the title')}<w:r><w:t xml:space="preserve"> there</w:t></w:r></w:p>`
		const {container} = await show(
			docx(numbered() + SECOND + numbered('<w:pPr><w:bidi/></w:pPr>') + dated + form + cited),
			true,
		)
		const [number, mirrored] = [...container.querySelectorAll<HTMLElement>('[data-field]')]
		const date = span(container, '17 November 2026')
		const tabs = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const [page, day] = [span(container, 'Page ').firstChild!, span(container, ' was the day').firstChild!]
		const start = (of: HTMLElement) => [of.parentNode!, childIndex(of)] as const
		const end = (of: HTMLElement) => [of.parentNode!, childIndex(of) + 1] as const
		const selection = document.getSelection()!
		const at = () => [selection.isCollapsed, selection.focusNode, selection.focusOffset]
		// The caret is at the end of its line there: a browser, left to find that end, goes to the document's instead
		selection.collapse(...end(number))
		expect(press('End').defaultPrevented).toBe(true)
		expect(press('End', {shiftKey: true}).defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(number)])
		// The end of the document is another key's
		expect(press('End', {ctrlKey: true}).defaultPrevented).toBe(false)
		// From there Safari, left to find the start of the line, goes to the document's: the caret is put at the line's
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, page, 0])
		// From the text of that line the caret is put at its end. From another line of the paragraph the end of the line
		// is the browser's to find, as it is in a paragraph that ends with text
		caret(container, 'Page ', 2)
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(number)])
		caret(container, 'Page ', 2)
		second.set(number, 0)
		expect(press('End').defaultPrevented).toBe(false)
		second.clear()
		caret(container, 'Second paragraph', 16)
		expect(press('End').defaultPrevented).toBe(false)
		// A selection that ends there stays as it is with Shift, and without ends where it ends
		selection.setBaseAndExtent(page, 1, ...end(number))
		expect(press('End', {shiftKey: true}).defaultPrevented).toBe(true)
		expect(selection.toString()).toBe('age 1')
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(number)])
		// The start of a line is the same, in a paragraph that starts with an object: Safari, left to find that start,
		// goes to the end of the paragraph above
		selection.collapse(...start(date))
		expect(press('Home').defaultPrevented).toBe(true)
		expect(press('Home', {shiftKey: true}).defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(date)])
		expect(press('Home', {ctrlKey: true}).defaultPrevented).toBe(false)
		// With Shift from the text of that line the selection ends before the object, and without the caret is put there
		caret(container, ' was the day', 4)
		expect(press('Home', {shiftKey: true}).defaultPrevented).toBe(true)
		expect(selection.toString()).toBe('17 November 2026 was')
		expect([selection.anchorNode, selection.anchorOffset]).toEqual([day, 4])
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(date)])
		// A selection is extended from its focus: the other end stays where it is
		selection.setBaseAndExtent(day, 4, day, 8)
		expect(press('Home', {shiftKey: true}).defaultPrevented).toBe(true)
		expect(selection.toString()).toBe('17 November 2026 was')
		selection.collapse(...start(date))
		// From beside the object, the end of the line is found as well
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, day, 12])
		// A line ends at a line break: with the tab it ends with, or starts with
		caret(container, 'Name:', 2)
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(tabs[0])])
		caret(container, 'Address', 2)
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(tabs[1])])
		// An object that runs over two lines is one thing: the line starts where the line it starts on does
		both.add(date)
		second.set(day, 0)
		caret(container, ' was the day', 4)
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(date)])
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, day, 12])
		// So it does from text after such an object that has text before it, a line the browser would find the start of
		// were the object on one line
		const [see, there] = [span(container, 'See ').firstChild!, span(container, ' there').firstChild!]
		caret(container, ' there', 3)
		expect(press('Home').defaultPrevented).toBe(false)
		both.add(span(container, 'the title'))
		second.set(there, 0)
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, see, 0])
		both.clear()
		second.clear()
		// Where the line wraps in the text after the object, its end isn't the paragraph's: from beside the object the
		// caret is put in that text, which the browser crosses. From the text the key is the browser's.
		second.set(day, 8)
		selection.collapse(...start(date))
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, day, 0])
		expect(modify.mock.lastCall).toEqual(['move', 'forward', 'lineboundary'])
		caret(container, ' was the day', 10)
		expect(press('Home').defaultPrevented).toBe(false)
		// So is the text that a line ends with where it wraps: a caret put after it would be on the next line
		second.set(span(container, 'the title'), 0)
		selection.collapse(see.parentNode!.parentNode!, 0)
		modify.mockClear()
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, see, 0])
		expect(modify.mock.lastCall).toEqual(['move', 'forward', 'lineboundary'])
		// Before an object that the next line starts with, the caret is on that line, at its start
		second.set(there, 0)
		selection.collapse(...start(span(container, 'the title')))
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(span(container, 'the title'))])
		expect(press('End').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, there, 6])
		// A caret where the line wraps is at the end of the first line, or at the start of the second: the browser knows
		// which, and its own move leaves the caret where it is at the start of the second. The move of one at the end of
		// the first gives way to the place before the object.
		caret(container, ' was the day', 8)
		expect(press('Home').defaultPrevented).toBe(true)
		expect(modify.mock.lastCall).toEqual(['move', 'backward', 'lineboundary'])
		expect(at()).toEqual([true, day, 8])
		modify.mockImplementationOnce(() => selection.collapse(day, 0))
		expect(press('Home').defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...start(date)])
		second.clear()
		// On a Mac those keys scroll the document, and the key is Command with the arrow that points to that end
		platform.mockReturnValue('MacIntel')
		selection.collapse(...end(number))
		expect(press('End').defaultPrevented).toBe(false)
		expect(press('ArrowRight', {metaKey: true}).defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(number)])
		expect(press('ArrowLeft', {metaKey: true}).defaultPrevented).toBe(true)
		expect(at()).toEqual([true, page, 0])
		// A selection only grows towards an end of a line there: its end on that side moves, whichever was put last
		selection.setBaseAndExtent(day, 4, day, 8)
		expect(press('ArrowLeft', {metaKey: true, shiftKey: true}).defaultPrevented).toBe(true)
		expect(selection.toString()).toBe('17 November 2026 was the')
		// In a paragraph that reads from the right, the left arrow points to the end of the line
		selection.collapse(...end(mirrored))
		expect(press('ArrowLeft', {metaKey: true}).defaultPrevented).toBe(true)
		expect(at()).toEqual([true, ...end(mirrored)])
		expect(press('ArrowRight', {metaKey: true, shiftKey: true}).defaultPrevented).toBe(true)
		expect(selection.toString()).toBe('Page 1')
	})

	test('an end of the selection the browser leaves inside an object comes out beside it, where typing has somewhere to go', async () => {
		const TAB = '<w:r><w:tab/></w:r>'
		const {doc, container} = await show(docx(`<w:p><w:r><w:t>Name:</w:t></w:r>${TAB}</w:p>`), true)
		const tab = object(container, '\t')
		const name = span(container, 'Name:').firstChild!
		const selection = document.getSelection()!
		const ends = () => [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]
		// Sent to the end of a line that ends with a tab, a browser's caret stops inside the tab
		selection.collapse(tab.firstChild, 1)
		document.dispatchEvent(new Event('selectionchange'))
		expect([selection.focusNode, selection.focusOffset]).toEqual([tab.parentNode, childIndex(tab) + 1])
		// A key can come before the browser says where it put the caret: before the tab's character is before the tab
		selection.collapse(tab.firstChild, 0)
		press('x')
		expect(caretAt()).toEqual(['Name:', 5])
		// A selection's end in there is on the same side of the tab. It's left where it is while the selection is only
		// changing, on its way through the tab perhaps, and brought out before a key is acted on: over a selection that
		// starts inside an object, Chrome takes nothing typed
		selection.setBaseAndExtent(tab.firstChild!, 1, name, 4)
		document.dispatchEvent(new Event('selectionchange'))
		expect(selection.anchorNode).toBe(tab.firstChild)
		press('x')
		expect(ends()).toEqual([tab.parentNode, childIndex(tab) + 1, name, 4])
		selection.setBaseAndExtent(name, 4, tab.firstChild!, 0)
		press('x')
		expect(ends()).toEqual([name, 4, name, 5])
		// What an edit takes is the same: with its end after the tab's character, the tab too
		selection.setBaseAndExtent(name, 3, tab.firstChild!, 1)
		input({inputType: 'deleteContentBackward'})
		expect(await body(doc)).toBe('<w:p><w:r><w:t>Nam</w:t></w:r></w:p>')
	})

	test('the up and down arrows leave the caret on the next line, in its column, also where the browser does not', async () => {
		// Lines, of which jsdom lays out none: a text's characters are 10 wide from where its box starts, and what's said
		// to be on a second line (a text from one of its characters on) starts 20 lower, at the left
		const boxes = new Map<Node, DOMRect>()
		const second = new Map<Node, number>()
		const boxOf = (node: Node | undefined) => (node && boxes.has(node) ? [boxes.get(node)!] : [])
		// The browser's own move to another line, which jsdom hasn't: it goes where it's told to here
		const modify = vi.fn()
		Object.assign(Selection.prototype, {modify})
		const segment = Intl.Segmenter.prototype.segment
		const mocks = [
			// Safari's segmenter: asked which character the first half of an emoji is in, it gives one that starts where
			// the character before it does
			vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (this: Intl.Segmenter, text) {
				const segments = segment.call(this, text)
				const containing = (index = 0) => {
					const part = segments.containing(index)
					const before = index > 0 && (text.charCodeAt(index) & 0xfc00) === 0xd800 && segments.containing(index - 1)
					if (!part || !before) return part
					return {...part, index: before.index, segment: text.slice(before.index, part.index + part.segment.length)}
				}
				return {containing, [Symbol.iterator]: () => segments[Symbol.iterator]()}
			}),
			vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
				return boxOf(this) as unknown as DOMRectList
			}),
			vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
				const box = boxes.get(this.startContainer)
				const wrapped = this.startOffset - (second.get(this.startContainer) ?? Infinity)
				const [x, y] =
					!box || wrapped < 0 ? [(box?.x ?? 0) + this.startOffset * 10, box?.y ?? 0] : [wrapped * 10, box.y + 20]
				return (box ? [new DOMRect(x, y, 10, box.height)] : []) as unknown as DOMRectList
			}),
			vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
				return boxOf(this.startContainer.childNodes[this.startOffset])[0] ?? new DOMRect()
			}),
		]
		onTestFinished(() => {
			mocks.forEach((mock) => mock.mockRestore())
			delete (Selection.prototype as Partial<Selection>).modify
		})
		const paragraph = (text: string, props = '') => `<w:p>${props}<w:r><w:t>${text}</w:t></w:r></w:p>`
		const tabbed = '<w:p><w:r><w:tab/></w:r><w:r><w:t>two</w:t></w:r></w:p>'
		const dated = `<w:p>${field('DATE', '17 Nov')}</w:p>`
		// The last two paragraphs are in a section of their own, with a table after them
		const section = '<w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr>'
		const texts = [paragraph('First one'), paragraph('Last'), paragraph('wrapping', section), paragraph('End')]
		const table = `<w:tbl><w:tr><w:tc>${paragraph('cell')}</w:tc></w:tr></w:tbl>`
		const onCaret = vi.fn<(caret: DOMRect, anchor: DOMRect) => void>()
		const {container} = await show(
			docx(texts[0] + tabbed + dated + texts.slice(1).join('') + paragraph('a😀😀b') + table),
			true,
			{onCaret},
		)
		const tab = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].find(
			(element) => element.textContent === '\t',
		)!
		const date = span(container, '17 Nov')
		const [first, two, last, wrapping, end, emoji, cell] = [
			'First one',
			'two',
			'Last',
			'wrapping',
			'End',
			'a😀😀b',
			'cell',
		].map((of) => span(container, of).firstChild!)
		// A line each: a text, a tab (in a box less tall than its line) and a text, a date with the line to itself and
		// another text; then a text on two lines, a short one, one with two emoji of two characters each in it, and one
		// in a table's cell
		boxes.set(first, new DOMRect(0, 0, 90, 16))
		boxes.set(tab, new DOMRect(0, 24, 40, 10)).set(two, new DOMRect(40, 20, 30, 16))
		boxes.set(date, new DOMRect(0, 40, 60, 16)).set(last, new DOMRect(0, 60, 40, 16))
		boxes.set(wrapping, new DOMRect(0, 80, 40, 16)).set(end, new DOMRect(0, 120, 30, 16))
		boxes.set(emoji, new DOMRect(0, 140, 60, 16)).set(cell, new DOMRect(0, 160, 40, 16))
		second.set(wrapping, 4)
		const before = (of: HTMLElement) => [of.parentNode!, childIndex(of)] as const
		const after = (of: HTMLElement) => [of.parentNode!, childIndex(of) + 1] as const
		const selection = document.getSelection()!
		const ends = () => [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]
		const goes = (node: Node, offset: number) => modify.mockImplementationOnce(() => selection.collapse(node, offset))
		// The move is the browser's where it ends on that line
		selection.collapse(first, 2)
		goes(two, 0)
		expect(press('ArrowDown').defaultPrevented).toBe(true)
		expect(modify.mock.lastCall).toEqual(['move', 'forward', 'line'])
		expect(ends()).toEqual([two, 0, two, 0])
		// From before a tab that starts a line, Chrome's caret stays on the line, after the tab: it's put on the line
		// below, at the place nearest to where it was along its own
		selection.collapse(...before(tab))
		goes(two, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(date))
		// From the line above a date with a line to itself it goes to the end of the document, and from the line below to
		// the start
		selection.collapse(two, 3)
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(after(date))
		selection.collapse(last, 1)
		goes(first, 0)
		press('ArrowUp')
		expect(modify.mock.lastCall).toEqual(['move', 'backward', 'line'])
		expect(ends().slice(2)).toEqual(before(date))
		// With Shift the selection's other end stays. The viewer is told of the end that moved alone, to keep that in
		// view whatever else is selected.
		selection.setBaseAndExtent(last, 3, last, 1)
		modify.mockImplementationOnce(() => selection.setBaseAndExtent(last, 3, first, 0))
		press('ArrowUp', {shiftKey: true})
		expect(modify.mock.lastCall).toEqual(['extend', 'backward', 'line'])
		expect(ends()).toEqual([last, 3, ...before(date)])
		expect(onCaret.mock.lastCall![1]).toBe(onCaret.mock.lastCall![0])
		expect(onCaret.mock.lastCall![0].y).toBe(40)
		// Inside an object is no place for the move to end at, as Safari's does with Shift: the end is put beside it
		selection.setBaseAndExtent(last, 3, last, 1)
		modify.mockImplementationOnce(() => selection.setBaseAndExtent(last, 3, date.firstChild!, 2))
		press('ArrowUp', {shiftKey: true})
		expect(ends()).toEqual([last, 3, ...before(date)])
		// A selection the key takes back to a caret is ended before the move, at its end that way, whichever end was put
		// last: the caret goes on from there
		const ended: unknown[][] = []
		const ending = () =>
			modify.mockImplementationOnce(() => {
				ended.push(ends())
				selection.collapse(end, 3)
			})
		selection.setBaseAndExtent(first, 8, first, 1)
		ending()
		press('ArrowDown')
		expect(ends()).toEqual([two, 3, two, 3])
		selection.setBaseAndExtent(two, 0, two, 3)
		ending()
		press('ArrowUp')
		expect(ends()).toEqual([first, 4, first, 4])
		expect(ended).toEqual([
			[first, 8, first, 8],
			[two, 0, two, 0],
		])
		// Where a line wraps at the caret, the caret is at the end of one line or at the start of the next: the browser's
		// move from either is right
		for (const [key, node, offset] of [
			['ArrowDown', wrapping, 6],
			['ArrowDown', end, 0],
			['ArrowUp', wrapping, 2],
			['ArrowUp', last, 2],
		] as const) {
			selection.collapse(wrapping, 4)
			goes(node, offset)
			press(key)
			expect(ends().slice(2)).toEqual([node, offset])
		}
		// In text, where the browser's move ends on that line is where the caret stays: the browser has its own measure of
		// how far along a line a place is
		selection.collapse(first, 6)
		goes(two, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([two, 0])
		// From the end of a line that wraps at the caret, the column is that end's: the browser's move ends where the
		// line above ends, and the caret is put after the date
		selection.collapse(wrapping, 4)
		goes(last, 4)
		press('ArrowUp')
		goes(first, 0)
		press('ArrowUp')
		expect(ends().slice(2)).toEqual(after(date))
		// On a line that starts with a tab the browser's caret ends after the tab: it's put before the tab where that's
		// nearer to where the caret was along its line
		selection.collapse(first, 1)
		goes(two, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(tab))
		// The caret keeps to its column, a character along here, on the lines after: the line of the date has no place
		// that near, and the browser, which counts from where the caret was put, goes to the start of the one after it
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(date))
		goes(last, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([last, 1])
		// Where the browser's move ends is right as long as no place is nearer the column: the end of a line it wraps at
		selection.collapse(first, 8)
		goes(two, 3)
		press('ArrowDown')
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(after(date))
		goes(last, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([last, 4])
		goes(wrapping, 4)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([wrapping, 4])
		// The column is that of the caret where these keys left it: once the caret has been elsewhere, it's wherever
		// the caret is
		selection.collapse(first, 1)
		goes(two, 0)
		press('ArrowDown')
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(date))
		selection.collapse(two, 1)
		document.dispatchEvent(new Event('selectionchange'))
		selection.collapse(...before(date))
		document.dispatchEvent(new Event('selectionchange'))
		goes(last, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([last, 0])
		// Another key lets go of the column as it's pressed, not when the selection is heard to have changed: the left
		// arrow and then the right bring the caret back to where it was before that. Shift lets go of nothing.
		selection.collapse(first, 1)
		goes(two, 0)
		press('ArrowDown')
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(date))
		press('Shift', {shiftKey: true})
		goes(last, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([last, 1])
		selection.collapse(first, 1)
		goes(two, 0)
		press('ArrowDown')
		goes(end, 3)
		press('ArrowDown')
		goes(two, 3)
		press('ArrowLeft')
		goes(...before(date))
		press('ArrowRight')
		expect(ends().slice(2)).toEqual(before(date))
		goes(last, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([last, 0])
		// Inside an emoji is no place for a caret, however near the column: before one and between two of them are
		selection.collapse(end, 2)
		goes(first, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([emoji, 1])
		selection.collapse(end, 3)
		goes(first, 0)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([emoji, 3])
		// Of two places as near the column, the caret is put at the one that comes first in the text, whichever way it
		// comes to the line
		selection.collapse(first, 2)
		goes(end, 3)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual(before(tab))
		selection.collapse(last, 2)
		goes(first, 0)
		press('ArrowUp')
		goes(first, 0)
		press('ArrowUp')
		expect(ends().slice(2)).toEqual(before(tab))
		// Put where a line starts that the text wraps onto, the caret is on that line, and the viewer is told so: by its
		// place in the DOM alone it might as well be at the end of the line above
		selection.collapse(end, 0)
		goes(first, 0)
		press('ArrowUp')
		expect(ends().slice(2)).toEqual([wrapping, 4])
		expect([onCaret.mock.lastCall![0].x, onCaret.mock.lastCall![0].y]).toEqual([0, 100])
		// The line above or below may be in another section: from the first line of the last section the caret is put
		// on the line that ends the section before, and from that line on the one below
		selection.collapse(end, 2)
		goes(first, 0)
		press('ArrowUp')
		expect(ends().slice(2)).toEqual([wrapping, 6])
		selection.collapse(wrapping, 7)
		goes(wrapping, 8)
		press('ArrowDown')
		expect(ends().slice(2)).toEqual([end, 3])
		// A selection that ends where a line starts, a paragraph's first or one its text wraps onto, reaches no further
		// than the line before: the caret is on the line below what was selected already, and stays
		modify.mockClear()
		for (const [node, offset] of [
			[last, 0],
			[wrapping, 4],
		] as const) {
			selection.setBaseAndExtent(two, 1, node, offset)
			expect(press('ArrowDown').defaultPrevented).toBe(true)
			expect(ends()).toEqual([node, offset, node, offset])
		}
		// With no line that way in the text, the key is the browser's: before the first line, before a table, and from
		// the only line of a cell. As it is with another key held. A selection is ended for it all the same.
		selection.collapse(first, 2)
		expect(press('ArrowUp').defaultPrevented).toBe(false)
		expect(press('ArrowDown', {altKey: true}).defaultPrevented).toBe(false)
		selection.collapse(emoji, 1)
		expect(press('ArrowDown').defaultPrevented).toBe(false)
		selection.collapse(cell, 2)
		expect(press('ArrowUp').defaultPrevented).toBe(false)
		expect(press('ArrowDown').defaultPrevented).toBe(false)
		selection.setBaseAndExtent(last, 1, first, 2)
		expect(press('ArrowUp').defaultPrevented).toBe(false)
		expect(ends()).toEqual([first, 2, first, 2])
		expect(modify).not.toHaveBeenCalled()
	})

	test('a press of the mouse on an object puts the caret on the side of the object that was pressed', async () => {
		// Boxes, of which jsdom lays out none: of the objects, and of the text a caret is beside
		const boxes = new Map<Node, DOMRect>()
		const boxOf = (node: Node | undefined) => (node && boxes.has(node) ? [boxes.get(node)!] : [])
		const mocks = [
			vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
				return boxOf(this) as unknown as DOMRectList
			}),
			vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
				return boxOf(this.startContainer) as unknown as DOMRectList
			}),
			vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
				return boxOf(this.startContainer.childNodes[this.startOffset])[0] ?? new DOMRect()
			}),
		]
		onTestFinished(() => mocks.forEach((mock) => mock.mockRestore()))
		const TAB = '<w:r><w:tab/></w:r>'
		const form = `<w:p><w:r><w:t>Name:</w:t></w:r>${TAB}<w:r><w:t>Ada</w:t></w:r></w:p>`
		const figure = `<w:p><w:r><w:t>Wide one:</w:t></w:r>${field('REF figure', 'Figure 1')}</w:p>`
		const mirrored = `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>one</w:t></w:r>${TAB}<w:r><w:t>two</w:t></w:r></w:p>`
		const {container} = await show(docx(form + figure + mirrored), true)
		const [tab, turned] = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const text = (of: string) => span(container, of).firstChild!
		const [name, ada, wide, one, two] = ['Name:', 'Ada', 'Wide one:', 'one', 'two'].map(text)
		const drawn = span(container, 'Figure 1')
		// A tab between two words, in a box less tall than its line; a figure too wide for the line its caption is on, on
		// the next; and a tab in a line that reads from the right
		boxes
			.set(name, new DOMRect(0, 0, 50, 16))
			.set(tab, new DOMRect(50, 4, 100, 10))
			.set(ada, new DOMRect(150, 0, 30, 16))
		boxes.set(wide, new DOMRect(0, 40, 90, 16)).set(drawn, new DOMRect(0, 60, 200, 16))
		boxes.set(one, new DOMRect(250, 100, 30, 16)).set(turned, new DOMRect(150, 104, 100, 10))
		boxes.set(two, new DOMRect(120, 100, 30, 16))
		const selection = document.getSelection()!
		const ends = () => [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]
		const mouse = (type: string, on: Node, x: number, y: number, init: PointerEventInit = {}) =>
			on.dispatchEvent(new PointerEvent(type, {bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', ...init}))
		// The browser places its own caret once the press has been heard: where it's put here first, as Chrome puts it
		const frame = () => new Promise(requestAnimationFrame)
		// After a tab, wherever on the tab the press is: the caret goes before a tab pressed on its first half
		selection.collapse(ada, 0)
		mouse('pointerdown', tab, 70, 9)
		expect(ends()).toEqual([ada, 0, ada, 0])
		await frame()
		expect(ends()).toEqual([name, 5, name, 5])
		mouse('pointerdown', tab, 130, 9)
		await frame()
		expect(ends()).toEqual([ada, 0, ada, 0])
		// A press under the tab's box, on its line, is one on the paragraph, with the caret left beside the tab
		const line = tab.closest('div')!
		mouse('pointerdown', line, 70, 15)
		await frame()
		expect(ends()).toEqual([name, 5, name, 5])
		// Not a press beside the tab, on the text the caret is at the start of
		selection.collapse(ada, 0)
		mouse('pointerdown', line, 152, 9)
		await frame()
		expect(ends()).toEqual([ada, 0, ada, 0])
		// With Shift the end of the selection that the press moved goes there, and a selection made without is left
		selection.setBaseAndExtent(ada, 2, ada, 0)
		mouse('pointerdown', tab, 70, 9)
		await frame()
		expect(ends()).toEqual([ada, 2, ada, 0])
		mouse('pointerdown', tab, 70, 9, {shiftKey: true})
		await frame()
		expect(ends()).toEqual([ada, 2, name, 5])
		// Once the pointer moves, a selection is being made, which is the browser's: the caret is put right when the
		// button is up, if a caret is what's left
		selection.collapse(ada, 0)
		mouse('pointerdown', tab, 70, 9)
		mouse('pointermove', tab, 71, 9)
		await frame()
		expect(ends()).toEqual([ada, 0, ada, 0])
		mouse('click', tab, 71, 9)
		await frame()
		expect(ends()).toEqual([name, 5, name, 5])
		// Pressed inside a selection, a tab leaves Chrome with no selection at all: the caret is put beside it
		selection.removeAllRanges()
		mouse('click', tab, 130, 9)
		await frame()
		expect(ends()).toEqual([ada, 0, ada, 0])
		// A finger's press is the system's
		mouse('pointerdown', tab, 70, 9, {pointerType: 'touch'})
		mouse('click', tab, 70, 9)
		await frame()
		expect(ends()).toEqual([ada, 0, ada, 0])
		// A caret at the end of the caption is beside the figure, on the line above it: a press on that line, over where
		// the figure is below, is not one on the figure
		const below = drawn.closest('div')!
		selection.collapse(wide, 9)
		mouse('pointerdown', below, 150, 48)
		await frame()
		expect(ends()).toEqual([wide, 9, wide, 9])
		mouse('pointerdown', below, 150, 68)
		await frame()
		expect(ends().slice(2)).toEqual([drawn.parentNode, childIndex(drawn) + 1])
		// Where the text reads from the right, a tab's first half is on its right
		selection.collapse(two, 0)
		mouse('pointerdown', turned, 160, 109)
		await frame()
		expect(ends()).toEqual([two, 0, two, 0])
		mouse('pointerdown', turned, 240, 109)
		await frame()
		expect(ends()).toEqual([one, 3, one, 3])
	})

	test('undo and redo take typing back and bring it again, leaving the caret where it was', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'plain', 5)
		// The browser types it: asked first, then told
		expect(input({inputType: 'insertText', data: '!'}).defaultPrevented).toBe(false)
		span(container, 'plain').firstChild!.nodeValue = 'plain!'
		caret(container, 'plain!', 6)
		changed()
		expect(doc.isDirty()).toBe(true)
		expect(doc.history).toEqual({undo: true, redo: false})
		expect(press('z', {ctrlKey: true}).defaultPrevented).toBe(true)
		expect(await body(doc)).toBe(SAMPLE)
		expect(caretAt()).toEqual(['plain', 5])
		expect(doc.isDirty()).toBe(false)
		expect(doc.history).toEqual({undo: false, redo: true})
		press('z', {ctrlKey: true, shiftKey: true})
		expect(await body(doc)).toContain('<w:t>plain!</w:t>')
		expect(caretAt()).toEqual(['plain!', 6])
		// And as a toolbar asks for them
		doc.undo()
		expect(doc.isDirty()).toBe(false)
		doc.redo()
		expect(doc.isDirty()).toBe(true)
	})

	test('text typed where the browser is not left to put it is one step to undo with what is typed after it', async () => {
		const {doc, container} = await show(sample(), true)
		// The rest of a word, typed by the browser in the run its first letter was put in
		const more = (letter: string) => {
			const selection = document.getSelection()!
			expect(input({inputType: 'insertText', data: letter}).defaultPrevented).toBe(false)
			;(selection.anchorNode as Text).insertData(selection.anchorOffset, letter)
			selection.collapse(selection.anchorNode, selection.anchorOffset + 1)
			changed()
		}
		// Over text of more than one run
		select(container, ['Bold ', 2], ['plain', 3])
		expect(input({inputType: 'insertText', data: 'x'}).defaultPrevented).toBe(true)
		more('y')
		expect(await body(doc)).toContain('<w:t>Boxy</w:t></w:r><w:r><w:t>in</w:t>')
		doc.undo()
		expect(await body(doc)).toBe(SAMPLE)
		expect(document.getSelection()!.toString()).toBe('ld pla')
		expect(doc.history).toEqual({undo: false, redo: true})
		doc.redo()
		expect(caretAt()).toEqual(['Boxy', 4])
		doc.undo()
		// In formatting switched at the caret
		caret(container, 'plain', 5)
		doc.format('underline')
		expect(input({inputType: 'insertText', data: 'x'}).defaultPrevented).toBe(true)
		more('y')
		expect(await body(doc)).toContain('<w:rPr><w:u w:val="single"/></w:rPr><w:t>xy</w:t>')
		doc.undo()
		expect(await body(doc)).toBe(SAMPLE)
		// What's pasted there is a step of its own
		select(container, ['Bold ', 2], ['plain', 3])
		input({inputType: 'insertFromPaste'}, 'x')
		more('y')
		doc.undo()
		expect(await body(doc)).toContain('<w:t>Box</w:t>')
		doc.undo()
		expect(await body(doc)).toBe(SAMPLE)
		// A composition given up after it leaves the step to undo, though the paragraph typed in reads as it did before
		const two = '<w:p><w:r><w:t>ab</w:t></w:r></w:p><w:p><w:r><w:t>cd</w:t></w:r></w:p>'
		const joined = await show(docx(two), true)
		select(joined.container, ['ab', 1], ['cd', 2])
		input({inputType: 'insertText', data: 'b'})
		expect(await body(joined.doc)).toBe('<w:p><w:r><w:t>ab</w:t></w:r></w:p>')
		focused().dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}))
		focused().dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}))
		joined.doc.undo()
		expect(await body(joined.doc)).toBe(two)
	})

	test('every edit undoes to the document it was made in', async () => {
		const {doc, container} = await show(sample(), true)
		const steps = [SAMPLE]
		caret(container, 'plain', 2)
		input({inputType: 'insertParagraph'})
		steps.push(await body(doc))
		select(container, ['ain', 1], ['Second paragraph', 6])
		input({inputType: 'insertFromPaste'}, 'one\ntwo')
		steps.push(await body(doc))
		select(container, ['Bold ', 1], ['pl', 1])
		doc.format('underline')
		steps.push(await body(doc))
		caret(container, 'two', 0)
		press('Backspace')
		steps.push(await body(doc))
		expect(new Set(steps).size).toBe(steps.length)
		for (let step = steps.length - 2; step >= 0; step--) {
			doc.undo()
			expect(await body(doc)).toBe(steps[step])
		}
		expect(doc.isDirty()).toBe(false)
		expect(doc.history).toEqual({undo: false, redo: true})
		for (let step = 1; step < steps.length; step++) {
			doc.redo()
			expect(await body(doc)).toBe(steps[step])
		}
		// A new edit leaves nothing to do again
		doc.undo()
		expect(doc.history).toEqual({undo: true, redo: true})
		caret(container, 'aone', 1)
		press('Tab')
		expect(doc.history).toEqual({undo: true, redo: false})
	})

	test('undoing text typed into an empty paragraph leaves nothing to save, and the paragraph its line', async () => {
		const {doc, container} = await show(sample(), true)
		const lines = container.querySelectorAll('br').length
		const mark = emptyMark(container)
		document.getSelection()!.collapse(mark, 0)
		input({inputType: 'insertText', data: 'typed'})
		const typed = document.createTextNode('typed')
		mark.prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		changed(mark)
		expect(doc.isDirty()).toBe(true)
		press('z', {ctrlKey: true})
		expect(textOf(container)).toBe('Bold plainSecond paragraph')
		expect(doc.isDirty()).toBe(false)
		expect(container.querySelectorAll('br')).toHaveLength(lines)
		expect(await body(doc)).toBe(SAMPLE)
	})

	test("undo keeps the tabs inside a run's text where they were", async () => {
		const tabbed = '<w:p><w:r><w:t xml:space="preserve">left\tright</w:t></w:r></w:p>'
		const {doc, container} = await show(docx(tabbed), true)
		caret(container, 'left', 4)
		input({inputType: 'insertText', data: '!'})
		span(container, 'left').firstChild!.nodeValue = 'left!'
		changed()
		expect(await body(doc)).toBe('<w:p><w:r><w:t xml:space="preserve">left!\tright</w:t></w:r></w:p>')
		press('z', {metaKey: true})
		expect(textOf(container)).toBe('left\tright')
		expect(await body(doc)).toBe(tabbed)
		expect(doc.isDirty()).toBe(false)
	})

	test('undo takes away text typed between two objects, and redo brings it back', async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t>A</w:t><w:tab/><w:tab/><w:t>Z</w:t></w:r></w:p>'), true)
		const tabs = [...container.querySelectorAll('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const selection = document.getSelection()!
		selection.collapse(tabs[1].parentNode!, [...tabs[1].parentNode!.childNodes].indexOf(tabs[1]))
		input({inputType: 'insertText', data: 'X'})
		const typed = document.createTextNode('X')
		tabs[1].before(typed)
		selection.collapse(typed, 1)
		changed()
		expect(textOf(container)).toBe('A\tX\tZ')
		press('z', {ctrlKey: true})
		expect(textOf(container)).toBe('A\t\tZ')
		expect(doc.isDirty()).toBe(false)
		press('z', {ctrlKey: true, shiftKey: true})
		expect(textOf(container)).toBe('A\tX\tZ')
		expect(doc.isDirty()).toBe(true)
		expect(await body(doc)).toBe('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>X</w:t><w:tab/><w:t>Z</w:t></w:r></w:p>')
	})

	test('a caret between two objects gets a foothold where the browser has no place for one', async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t>A</w:t><w:tab/><w:tab/><w:t>Z</w:t></w:r></w:p>'), true)
		const tabs = () =>
			[...container.querySelectorAll('[contenteditable="false"]')].filter((element) => element.textContent === '\t')
		const selection = document.getSelection()!
		const ends = () => [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]
		const index = (node: Node) => [...node.parentNode!.childNodes].indexOf(node as ChildNode)
		const foothold = () => container.querySelector('img')
		// The caret as a browser puts it between the two tabs, and its word that the selection changed
		const between = () => {
			const [, second] = tabs()
			selection.collapse(second.parentNode!, index(second))
			document.dispatchEvent(new Event('selectionchange'))
			return second
		}
		// As Safari has it: a caret with only what no caret goes into on either side of it is no caret, and takes no text
		let safari = true
		const takes = vi.fn(() => {
			const {focusNode: node, focusOffset: offset} = selection
			if (!safari || !node || node.nodeType === Node.TEXT_NODE) return true
			return [node.childNodes[offset - 1], node.childNodes[offset]].some((beside) => beside?.nodeName === 'IMG')
		})
		Object.defineProperty(document, 'queryCommandEnabled', {value: takes, configurable: true})
		onTestFinished(() => void Reflect.deleteProperty(document, 'queryCommandEnabled'))

		// The caret is given an image of no size to stand before, in the gap, and nothing else changes
		let second = between()
		expect(takes).toHaveBeenCalledWith('insertText')
		expect(second.previousSibling).toBe(foothold())
		expect(foothold()!.getAttribute('aria-hidden')).toBe('true')
		expect(foothold()!.style.width).toBe('0px')
		expect(foothold()!.style.height).toBe('0px')
		expect(ends()).toEqual([second.parentNode, index(foothold()!), second.parentNode, index(foothold()!)])
		expect(textOf(container)).toBe('A\t\tZ')
		expect(doc.isDirty()).toBe(false)
		// It stays while the caret does, and is asked about no more
		takes.mockClear()
		document.dispatchEvent(new Event('selectionchange'))
		expect(container.querySelectorAll('img')).toHaveLength(1)
		expect(takes).not.toHaveBeenCalled()
		// What's typed there is typed between the tabs, and leaves the caret in its text, with no foothold
		expect(input({inputType: 'insertText', data: 'X'}).defaultPrevented).toBe(false)
		const typed = document.createTextNode('X')
		foothold()!.before(typed)
		selection.collapse(typed, 1)
		changed()
		document.dispatchEvent(new Event('selectionchange'))
		expect(textOf(container)).toBe('A\tX\tZ')
		expect(foothold()).toBeNull()
		expect(await body(doc)).toBe('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>X</w:t><w:tab/><w:t>Z</w:t></w:r></w:p>')
		// A caret put back in the gap, as an undo puts it, has its foothold at once
		doc.undo()
		;[, second] = tabs()
		expect(textOf(container)).toBe('A\t\tZ')
		expect(second.previousSibling).toBe(foothold())
		expect(ends()).toEqual([second.parentNode, index(foothold()!), second.parentNode, index(foothold()!)])
		// The foothold goes when the caret does
		selection.collapse(span(container, 'Z').firstChild!, 1)
		document.dispatchEvent(new Event('selectionchange'))
		expect(foothold()).toBeNull()
		// It stays under an end of a selection: what's selected from the caret, and what's selected up to it
		second = between()
		const at = index(foothold()!)
		selection.setBaseAndExtent(second.parentNode!, at, span(container, 'Z').firstChild!, 1)
		document.dispatchEvent(new Event('selectionchange'))
		expect(second.previousSibling).toBe(foothold())
		expect(selection.toString()).toBe('\tZ')
		selection.setBaseAndExtent(span(container, 'A').firstChild!, 0, second.parentNode!, at + 1)
		document.dispatchEvent(new Event('selectionchange'))
		expect(second.previousSibling).toBe(foothold())
		expect(selection.toString()).toBe('A\t')
		// With nothing but the foothold selected, the caret is back before it
		selection.setBaseAndExtent(second.parentNode!, at + 1, second.parentNode!, at)
		document.dispatchEvent(new Event('selectionchange'))
		expect(second.previousSibling).toBe(foothold())
		expect(ends()).toEqual([second.parentNode, at, second.parentNode, at])
		// And it goes with a selection that has no end there
		selection.setBaseAndExtent(span(container, 'A').firstChild!, 0, span(container, 'Z').firstChild!, 1)
		document.dispatchEvent(new Event('selectionchange'))
		expect(foothold()).toBeNull()
		expect(selection.toString()).toBe('A\t\tZ')
		// Where the caret has no way on from its foothold and the end of a selection has, as Safari has it before a line
		// break, the arrow takes the caret where that end comes to
		second = between()
		const modify = vi.fn(
			(way: string) => void (way === 'extend' && selection.extend(span(container, 'Z').firstChild!, 0)),
		)
		Object.assign(Selection.prototype, {modify})
		onTestFinished(() => void delete (Selection.prototype as Partial<Selection>).modify)
		expect(press('ArrowRight').defaultPrevented).toBe(true)
		expect(modify.mock.calls).toEqual([
			['move', 'right', 'character'],
			['extend', 'right', 'character'],
		])
		expect(ends()).toEqual([span(container, 'Z').firstChild, 0, span(container, 'Z').firstChild, 0])
		expect(foothold()).toBeNull()
		// And when the document is no longer edited
		second = between()
		expect(second.previousSibling).toBe(foothold())
		doc.setEditable(false)
		expect(foothold()).toBeNull()
		doc.setEditable(true)
		// A browser that has a caret there, as Chrome has, is given none
		safari = false
		second = between()
		expect(foothold()).toBeNull()
		expect(ends()).toEqual([second.parentNode, index(second), second.parentNode, index(second)])
	})

	test('composed text is read back when its composition ends, as one step to undo; given up, it leaves none', async () => {
		const {doc, container} = await show(sample(), true)
		const compose = (steps: string[]) => {
			const text = span(container, 'plain').firstChild as Text
			document.getSelection()!.collapse(text, 5)
			focused().dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}))
			for (const step of steps) {
				// Composing can't be stopped, and nothing else is done meanwhile
				expect(input({inputType: 'insertCompositionText', data: step}).defaultPrevented).toBe(false)
				expect(press('z', {metaKey: true, isComposing: true}).defaultPrevented).toBe(false)
				text.replaceData(5, text.length - 5, step)
				document.getSelection()!.collapse(text, text.length)
				changed()
			}
			focused().dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}))
		}
		compose(['k', 'ka', 'か'])
		expect(await body(doc)).toContain('<w:t>plainか</w:t>')
		doc.undo()
		expect(await body(doc)).toBe(SAMPLE)
		expect(doc.history).toEqual({undo: false, redo: true})
		compose(['k', ''])
		expect(doc.isDirty()).toBe(false)
		expect(doc.history.undo).toBe(false)
	})

	test('text being composed when editing is switched off is read back, and its composition is over', async () => {
		const {doc, container} = await show(sample(), true)
		const text = span(container, 'plain').firstChild as Text
		document.getSelection()!.collapse(text, 5)
		focused().dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}))
		input({inputType: 'insertCompositionText', data: 'か'})
		text.appendData('か')
		document.getSelection()!.collapse(text, text.length)
		changed()
		// A browser may end the composition only once nothing listens for it
		doc.setEditable(false)
		focused().dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}))
		doc.setEditable(true)
		expect(await body(doc)).toContain('<w:t>plainか</w:t>')
		// The next edits are made here as ever, not left to the browser as a composition's are
		caret(container, 'Second paragraph', 6)
		expect(input({inputType: 'insertParagraph'}).defaultPrevented).toBe(true)
		expect(press('z', {metaKey: true}).defaultPrevented).toBe(true)
		doc.undo()
		expect(await body(doc)).toBe(SAMPLE)
		expect(doc.history).toEqual({undo: false, redo: true})
	})

	test('a saved document is clean until it differs from what was saved, whichever way it got there', async () => {
		const {doc, container} = await show(sample(), true)
		caret(container, 'plain', 2)
		input({inputType: 'insertParagraph'})
		const saved = await doc.save()
		// Editing carries on while the file is written: what was saved is what counts
		caret(container, 'ain', 3)
		press('Tab')
		doc.markSaved()
		expect(doc.isDirty()).toBe(true)
		doc.undo()
		expect(doc.isDirty()).toBe(false)
		doc.undo()
		expect(doc.isDirty()).toBe(true)
		doc.redo()
		expect(doc.isDirty()).toBe(false)
		// Opened again, the saved file is the document as it was saved
		const reopened = await openDocument(saved)
		const again = document.createElement('div')
		await reopened.render(again)
		expect(textOf(again)).toBe(textOf(container))
		reopened.destroy()
	})

	test('an edit made here says where on screen it left the selection: the caret, and the other end of selected text', async () => {
		// A box for each character, as jsdom has none
		const boxes = vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
			return [new DOMRect(this.startOffset * 10, 0, 10, 20)] as unknown as DOMRectList
		})
		onTestFinished(() => boxes.mockRestore())
		const onCaret = vi.fn<(caret: DOMRect, anchor: DOMRect) => void>()
		const {doc, container} = await show(sample(), true, {onCaret})
		// Typing in a run is the browser's, which keeps its own caret in view
		caret(container, 'plain', 5)
		expect(input({inputType: 'insertText', data: 'x'}).defaultPrevented).toBe(false)
		expect(onCaret).not.toHaveBeenCalled()
		// A paste is made here: after the two characters, in the same text
		expect(input({inputType: 'insertFromPaste'}, 'yz').defaultPrevented).toBe(true)
		expect(onCaret).toHaveBeenCalledTimes(1)
		let [at, other] = onCaret.mock.lastCall!
		expect([at.left, at.width, at.height]).toEqual([70, 0, 20])
		expect(other).toBe(at)
		// A new paragraph, with the caret at its start
		press('Enter')
		input({inputType: 'insertParagraph'})
		expect(onCaret).toHaveBeenCalledTimes(2)
		// Text made bold stays selected, and both of its ends are said
		select(container, ['Second paragraph', 2], ['Second paragraph', 6])
		doc.format('bold')
		;[at, other] = onCaret.mock.lastCall!
		expect(other).not.toBe(at)
		expect(document.getSelection()!.toString()).toBe('cond')
	})

	test('select all takes the text that can be edited, from its first place to its last, and all of it when none can', async () => {
		// A running head and foot are on the pages, but aren't text to edit here
		const story = (root: string, text: string) =>
			`<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${root}>`
		const {doc, container} = await show(
			docx(
				`${SAMPLE}<w:sectPr><w:headerReference w:type="default" r:id="rIdHead"/><w:footerReference w:type="default" r:id="rIdFoot"/></w:sectPr>`,
				{
					parts: {'word/header1.xml': story('hdr', 'Head'), 'word/footer1.xml': story('ftr', 'Foot')},
					rels: [
						{id: 'rIdHead', type: 'header', target: 'header1.xml'},
						{id: 'rIdFoot', type: 'footer', target: 'footer1.xml'},
					],
				},
			),
			true,
		)
		const host = container.firstElementChild!.firstElementChild!
		const selection = document.getSelection()!
		const ends = () => [
			(selection.anchorNode as Text).data,
			selection.anchorOffset,
			(selection.focusNode as Text).data,
			selection.focusOffset,
		]
		const all = ['Bold ', 0, 'Second paragraph', 16]
		// From the keyboard, with the caret in the text
		caret(container, 'plain', 2)
		expect(press('a', {metaKey: true}).defaultPrevented).toBe(true)
		expect(ends()).toEqual(all)
		expect(selection.toString()).toBe('Bold plainSecond paragraph')
		// From a menu, which the browser asks about at the host; a selection begun in the text is the browser's own
		caret(container, 'plain', 2)
		const begun = new Event('selectstart', {bubbles: true, cancelable: true})
		span(container, 'plain').dispatchEvent(begun)
		expect(begun.defaultPrevented).toBe(false)
		expect(ends()).toEqual(['plain', 2, 'plain', 2])
		const asked = new Event('selectstart', {bubbles: true, cancelable: true})
		host.dispatchEvent(asked)
		expect(asked.defaultPrevented).toBe(true)
		expect(ends()).toEqual(all)
		// And as the viewer asks, with the keyboard anywhere: what's typed then replaces it all
		selection.removeAllRanges()
		doc.selectAll()
		expect(ends()).toEqual(all)
		input({inputType: 'insertText', data: 'x'})
		expect(await body(doc)).toMatch(/^<w:p><w:r><w:rPr><w:b\/><\/w:rPr><w:t>x<\/w:t><\/w:r><\/w:p><w:sectPr>/)
		// Not being edited, the pages are selected whole, to copy
		doc.setEditable(false)
		doc.selectAll()
		expect(selection.toString()).toBe('HeadFootx')
	})

	test('not editable, nothing is taken for an edit, and the selection has no formatting to switch', async () => {
		const onChange = vi.fn()
		const {doc, container} = await show(sample(), false, {onChange})
		caret(container, 'plain', 2)
		expect(input({inputType: 'insertFromDrop'}).defaultPrevented).toBe(false)
		expect(doc.formatting()).toBeUndefined()
		// Switching editing says so, for what shows the selection's formatting to read it again
		doc.setEditable(true)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(doc.formatting()).toEqual({bold: false, italic: false, underline: false})
		expect(input({inputType: 'insertFromDrop'}).defaultPrevented).toBe(true)
		doc.setEditable(false)
		expect(onChange).toHaveBeenCalledTimes(2)
		expect(doc.formatting()).toBeUndefined()
		expect(input({inputType: 'insertFromDrop'}).defaultPrevented).toBe(false)
	})
})
