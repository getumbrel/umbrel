// @vitest-environment jsdom

import {afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi} from 'vitest'

import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

import {openDocument, type DocxDocument, type RenderOptions} from '.'
import type {Table} from './model'
import {gridOf} from './render'
import {docx, fixture, hasFixture, PNG, structures, WORD_FIXTURES} from './test-helpers'

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

	test('line heights are measured as laid out, not as a scaled stage shows them', async () => {
		// A probe's line is 244 px, shown at 99% while a viewer's entrance still scales the stage
		const probe = (element: Element) => (element as HTMLElement).style?.fontSize === '200px'
		const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
			this: HTMLElement,
		) {
			return probe(this) ? 244 : 0
		})
		const rect = Element.prototype.getBoundingClientRect
		const onScreen = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			return probe(this) ? new DOMRect(0, 0, 100, 244 * 0.99) : rect.call(this)
		})
		onTestFinished(() => {
			offsetHeight.mockRestore()
			onScreen.mockRestore()
		})
		const {container} = await show(docx('<w:p><w:r><w:t>text</w:t></w:r></w:p>'))
		expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--docx-line-0')).toBe('1.22')
	})

	test('the galley is first laid out with its faces loaded and its line heights set', async () => {
		// Reading layout lays out what's read: before the line heights are set, only their probes may be read
		const probe = (element: Element) => (element as HTMLElement).style?.fontSize === '200px'
		const early: Element[] = []
		const read = (element: Element) => {
			if (!probe(element) && !element.closest('[style*="--docx-line"]')) early.push(element)
		}
		const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
			this: HTMLElement,
		) {
			read(this)
			return probe(this) ? 244 : 0
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
				'<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/></w:rPr><w:t>Bold Привет</w:t></w:r></w:p>',
			),
		)
		expect(early).toEqual([])
		// Each face, with the text that picks which of its subsets to load, and each face the probes measure in
		const stack = '"Calibri", "Carlito", sans-serif'
		expect(loaded).toContainEqual([`normal 700 16px ${stack}`, expect.stringContaining('Привет')])
		expect(loaded).toContainEqual([`200px ${stack}`, 'x'])
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
		const islands = [...container.querySelectorAll<HTMLElement>('[contenteditable="false"]')].map(
			(element) => element.textContent,
		)
		expect(islands).toContain('1.')
		expect(islands).toContain('\t')
		expect(textOf(container)).toContain('1.\titem\tafter tab')
	})
})

// Laying documents out in jsdom, again and again, takes seconds on a busy machine
describe('laying out again after an edit', {timeout: 60000}, () => {
	// jsdom has no layout, so these tests give it one: a paragraph's text runs 40 characters to a 20 px line between its
	// space before and after, a table's rows stack, each as tall as its tallest cell, other boxes stack what they hold,
	// and an inline box sits on the line of its first character. Enough for pages to fill, paragraphs and tables to break
	// across them, footnotes to take room, and edits to move lines.
	const LINE = 20
	const CHARS = 40
	// Characters to a line, which the face sets: a test of a face that arrives late changes it
	let chars = CHARS
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
		paragraph(element)
			? before(element as HTMLElement) + LINE * lines(element as HTMLElement) + after(element as HTMLElement)
			: element instanceof HTMLTableElement
				? [...element.rows].reduce((sum, row) => sum + heightOf(row), 0)
				: element instanceof HTMLTableRowElement
					? Math.max(0, ...[...element.cells].map((cell) => heightOf(cell)))
					: element instanceof HTMLDivElement || element instanceof HTMLTableCellElement
						? [...element.children].reduce((sum, child) => sum + heightOf(child), 0)
						: 0
	const line = (block: HTMLElement, k: number) => new DOMRect(0, before(block) + k * LINE, 100, LINE)
	const rectOf = function (this: Element) {
		const block = blockOf(this)
		if (block && block !== this) {
			// The paragraph's mark ends its last line; anything else sits where its text starts
			const offset = Math.min(offsetOf(block, this), (lines(block) - 1) * chars)
			return line(block, Math.floor(offset / chars))
		}
		if (this instanceof HTMLTableRowElement) {
			const rows = [...this.closest('table')!.rows]
			const top = rows.slice(0, rows.indexOf(this)).reduce((sum, row) => sum + heightOf(row), 0)
			return new DOMRect(0, top, 100, heightOf(this))
		}
		return new DOMRect(0, 0, parseFloat((this as HTMLElement).style?.width) || 100, heightOf(this))
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
	// footnote), tables (some with a header row, some with a cell merged down), a second section, edited at random: text
	// added, deleted, replaced
	function generated(seed: number) {
		let state = seed
		const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
		const text = (n: number) =>
			Array.from({length: n}, (_, i) => String.fromCharCode(97 + ((i * 7 + seed) % 26))).join('')
		const cell = (content: string, merge = '') =>
			`<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/>${merge}</w:tcPr><w:p>${content && `<w:r><w:t>${content}</w:t></w:r>`}</w:p></w:tc>`
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
				random() < 0.3 ? '<w:spacing w:before="120" w:after="240"/>' : '',
				random() < 0.2 ? '<w:jc w:val="both"/>' : '',
				i === 30 ? '<w:sectPr><w:type w:val="continuous"/></w:sectPr>' : '',
			].join('')
			const note = random() < 0.08 ? `<w:r><w:footnoteReference w:id="${++notes}"/></w:r>` : ''
			const brk = random() < 0.04 ? '<w:r><w:br w:type="page"/></w:r>' : ''
			return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${brk}<w:r><w:t>${text(5 + Math.floor(random() * 400))}</w:t></w:r>${note}</w:p>`
		}).join('')
		const footnotes = Array.from(
			{length: notes},
			(_, i) => `<w:footnote w:id="${i + 1}"><w:p><w:r><w:t>${text(20 + i * 30)}</w:t></w:r></w:p></w:footnote>`,
		).join('')
		return {bytes: docx(body, {footnotes}), random}
	}

	test(
		'the pages equal the edited document laid out afresh, edit after edit, and the rest stay',
		{timeout: 60000},
		async () => {
			let kept = 0
			let rebuilt = 0
			for (let seed = 1; seed <= 4; seed++) {
				const {bytes, random} = generated(seed)
				const {doc, container} = await show(bytes, true)
				for (let n = 0; n < 10; n++) {
					const spans = [...container.querySelectorAll<HTMLElement>('span')].filter(
						(span) => !span.closest('[contenteditable="false"]') && span.firstChild?.nodeType === Node.TEXT_NODE,
					)
					const span = spans[Math.floor(random() * spans.length)]
					const node = span.firstChild as Text
					const cut = Math.floor(random() * node.length)
					node.nodeValue =
						random() < 0.5
							? node.nodeValue!.slice(0, cut) + 'x'.repeat(10 + Math.floor(random() * 120)) + node.nodeValue!.slice(cut)
							: node.nodeValue!.slice(0, cut) + node.nodeValue!.slice(cut + Math.floor(random() * 150))
					document.getSelection()!.collapse(node, 0)
					span.dispatchEvent(new InputEvent('input', {bubbles: true}))
					const slots = [...container.firstElementChild!.firstElementChild!.children]
					// Leaving edit mode lays out what's pending, as a pause in typing does
					doc.setEditable(false)
					doc.setEditable(true)
					const fresh = document.createElement('div')
					document.body.append(fresh)
					const reopened = await openDocument(await doc.save())
					await reopened.render(fresh)
					expect(shapesOf(container), `seed ${seed} edit ${n}`).toEqual(shapesOf(fresh))
					for (const slot of container.firstElementChild!.firstElementChild!.children)
						if (slots.includes(slot)) kept++
						else rebuilt++
					reopened.destroy()
					fresh.remove()
				}
				doc.destroy()
				container.remove()
				current = undefined
			}
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

describe('editing', () => {
	const sample = () =>
		docx(
			'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold </w:t></w:r><w:r><w:t>plain</w:t></w:r></w:p>' +
				'<w:p/>' +
				'<w:p><w:r><w:t xml:space="preserve">Second paragraph</w:t></w:r></w:p>',
		)
	const span = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll('span')].find((element) => element.textContent === text)!
	const input = (target: Element, init: InputEventInit) => {
		const event = new InputEvent('beforeinput', {bubbles: true, cancelable: true, ...init})
		target.dispatchEvent(event)
		return event
	}
	// The mark of the one empty paragraph, which typing there goes into
	const emptyMark = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLElement>('span')].find(
			(element) => element.contentEditable !== 'false' && element.querySelector('br'),
		)!

	test('edits made in the DOM are read back into their w:t and saved there alone', async () => {
		const {doc, container} = await show(sample(), true)
		expect(doc.isDirty()).toBe(false)
		const plain = span(container, 'plain')
		plain.firstChild!.nodeValue = 'plainly edited'
		document.getSelection()!.collapse(plain.firstChild!, 3)
		plain.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: 'x'}))
		expect(doc.isDirty()).toBe(true)
		const saved = await doc.save()
		const xml = await ZipArchive.open(saved).text('word/document.xml')
		expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>Bold </w:t></w:r><w:r><w:t>plainly edited</w:t></w:r>')
		// Saved, the edit is the new baseline; typing again makes the document dirty again
		doc.markSaved()
		expect(doc.isDirty()).toBe(false)
		plain.firstChild!.nodeValue = 'again'
		plain.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(doc.isDirty()).toBe(true)
	})

	test('paragraph breaks, formatting and drops are refused, each saying so; typing in a run is not', async () => {
		let refused = 0
		const {container} = await show(sample(), true, {onRefuse: () => refused++})
		const plain = span(container, 'plain')
		document.getSelection()!.collapse(plain.firstChild!, 2)
		const types = [
			'insertParagraph',
			'insertLineBreak',
			'formatBold',
			'formatItalic',
			'insertFromDrop',
			'insertOrderedList',
			'insertLink',
		]
		for (const inputType of types) expect(input(plain, {inputType}).defaultPrevented, inputType).toBe(true)
		// Bold, italic and underline from the keyboard, which plain-text editing never sends as input events
		for (const key of ['b', 'i', 'u']) {
			const event = new KeyboardEvent('keydown', {key, metaKey: true, bubbles: true, cancelable: true})
			plain.dispatchEvent(event)
			expect(event.defaultPrevented, key).toBe(true)
		}
		const drop = new Event('drop', {bubbles: true, cancelable: true})
		plain.dispatchEvent(drop)
		expect(drop.defaultPrevented).toBe(true)
		// Deleting back from the start of a paragraph would join it to the one before
		const second = span(container, 'Second paragraph')
		document.getSelection()!.collapse(second.firstChild!, 0)
		expect(input(second, {inputType: 'deleteContentBackward'}).defaultPrevented).toBe(true)
		expect(refused).toBe(types.length + 5)

		refused = 0
		document.getSelection()!.collapse(plain.firstChild!, 2)
		expect(input(plain, {inputType: 'insertText', data: 'y'}).defaultPrevented).toBe(false)
		const save = new KeyboardEvent('keydown', {key: 's', metaKey: true, bubbles: true, cancelable: true})
		plain.dispatchEvent(save)
		expect(save.defaultPrevented).toBe(false)
		expect(refused).toBe(0)
	})

	test('a selection reaching into the next paragraph is cut back to this one', async () => {
		const {doc, container} = await show(sample(), true)
		const plain = span(container, 'plain')
		const second = span(container, 'Second paragraph')
		const selection = document.getSelection()!
		selection.setBaseAndExtent(plain.firstChild!, 2, second.firstChild!, 6)
		const event = input(plain, {inputType: 'insertText', data: 'Z'})
		expect(event.defaultPrevented).toBe(true)
		expect(plain.textContent).toBe('plZ')
		expect(second.textContent).toBe('Second paragraph')
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:t>plZ</w:t>')
		expect(xml).toContain('<w:t xml:space="preserve">Second paragraph</w:t>')
	})

	test('pasted text arrives as plain text on one line', async () => {
		const {doc, container} = await show(sample(), true)
		const plain = span(container, 'plain')
		document.getSelection()!.collapse(plain.firstChild!, 5)
		const data = {
			getData: (type: string) => (type === 'text/plain' ? ' one\r\ntwo\tthree' : ''),
		} as unknown as DataTransfer
		const event = new InputEvent('beforeinput', {bubbles: true, cancelable: true, inputType: 'insertFromPaste'})
		Object.defineProperty(event, 'dataTransfer', {value: data})
		plain.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
		expect(plain.textContent).toBe('plain one two three')
		expect(doc.isDirty()).toBe(true)
	})

	test('typing into an empty paragraph makes a run there', async () => {
		const {doc, container} = await show(sample(), true)
		const marks = [...container.querySelectorAll<HTMLElement>('span')].filter(
			(element) => element.contentEditable !== 'false' && element.querySelector('br'),
		)
		expect(marks).toHaveLength(1)
		const typed = document.createTextNode('typed')
		marks[0].prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		marks[0].dispatchEvent(new InputEvent('input', {bubbles: true}))
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:p><w:r><w:t xml:space="preserve">typed</w:t></w:r></w:p>')
	})

	test('text typed into an empty paragraph and deleted again leaves nothing to save', async () => {
		const {doc, container} = await show(sample(), true)
		const mark = emptyMark(container)
		const typed = document.createTextNode('typed')
		mark.prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		mark.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(doc.isDirty()).toBe(true)
		// Deleting the last character, the browser takes the text node away with it
		typed.remove()
		document.getSelection()!.collapse(mark, 0)
		mark.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(doc.isDirty()).toBe(false)
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:p/>')
	})

	test('undoing text typed into an empty paragraph leaves nothing to save, and the paragraph its line', async () => {
		const {doc, container} = await show(sample(), true)
		const lines = container.querySelectorAll('br').length
		const mark = emptyMark(container)
		document.getSelection()!.collapse(mark, 0)
		input(mark, {inputType: 'insertText', data: 'typed'})
		const typed = document.createTextNode('typed')
		mark.prepend(typed)
		document.getSelection()!.collapse(typed, 5)
		mark.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(doc.isDirty()).toBe(true)
		mark.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true, cancelable: true}))
		expect(mark.textContent).toBe('')
		expect(doc.isDirty()).toBe(false)
		expect(container.querySelectorAll('br')).toHaveLength(lines)
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:p/>')
	})

	test('a paragraph whose text is all deleted keeps its line, saved and opened again', async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p/>'), true)
		const text = span(container, 'one').firstChild as Text
		text.nodeValue = ''
		document.getSelection()!.collapse(text, 0)
		text.parentElement!.dispatchEvent(new InputEvent('input', {bubbles: true}))
		// Each paragraph's line is a line break in its mark, where no text holds one
		expect(container.querySelectorAll('br')).toHaveLength(2)
		const reopened = await openDocument(await doc.save())
		const again = document.createElement('div')
		await reopened.render(again)
		expect(again.querySelectorAll('br')).toHaveLength(2)
		reopened.destroy()
	})

	test('typing in a paragraph that ends at a page break adds no line after the break', async () => {
		const {container} = await show(docx('<w:p><w:r><w:t>one</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>'), true)
		const breaks = container.querySelectorAll('br').length
		const text = span(container, 'one').firstChild as Text
		text.nodeValue = 'once'
		document.getSelection()!.collapse(text, 4)
		text.parentElement!.dispatchEvent(new InputEvent('input', {bubbles: true}))
		// The paragraph's block after the break is empty, but the paragraph isn't
		expect(container.querySelectorAll('br')).toHaveLength(breaks)
	})

	test('text the browser puts outside any run joins the run beside it', async () => {
		const {doc, container} = await show(sample(), true)
		const plain = span(container, 'plain')
		const stray = document.createTextNode(' stray')
		plain.after(stray)
		document.getSelection()!.collapse(stray, 6)
		plain.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(plain.textContent).toBe('plain stray')
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		// One space between words needs no xml:space
		expect(xml).toContain('<w:r><w:t>plain stray</w:t></w:r>')
	})

	test('undo and redo restore the paragraph as it was', async () => {
		const {doc, container} = await show(sample(), true)
		const plain = span(container, 'plain')
		document.getSelection()!.collapse(plain.firstChild!, 5)
		input(plain, {inputType: 'insertText', data: '!'})
		plain.firstChild!.nodeValue = 'plain!'
		plain.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(doc.isDirty()).toBe(true)
		const undo = new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true, cancelable: true})
		plain.dispatchEvent(undo)
		expect(undo.defaultPrevented).toBe(true)
		expect(plain.textContent).toBe('plain')
		expect(doc.isDirty()).toBe(false)
		plain.dispatchEvent(
			new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}),
		)
		expect(plain.textContent).toBe('plain!')
		expect(doc.isDirty()).toBe(true)
	})

	test("undo keeps the tabs inside a run's text where they were", async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t xml:space="preserve">left\tright</w:t></w:r></w:p>'), true)
		const left = span(container, 'left')
		document.getSelection()!.collapse(left.firstChild!, 4)
		input(left, {inputType: 'insertText', data: '!'})
		left.firstChild!.nodeValue = 'left!'
		left.dispatchEvent(new InputEvent('input', {bubbles: true}))
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:t xml:space="preserve">left!\tright</w:t>')
		left.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', metaKey: true, bubbles: true, cancelable: true}))
		expect([left.textContent, span(container, 'right').textContent]).toEqual(['left', 'right'])
		expect(container.querySelector('[contenteditable="false"]')?.textContent).toBe('\t')
		expect(doc.isDirty()).toBe(false)
	})

	test('undo takes away text typed between two objects, and redo brings it back', async () => {
		const {doc, container} = await show(docx('<w:p><w:r><w:t>A</w:t><w:tab/><w:tab/><w:t>Z</w:t></w:r></w:p>'), true)
		const tabs = [...container.querySelectorAll('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const selection = document.getSelection()!
		selection.collapse(tabs[1].parentNode!, [...tabs[1].parentNode!.childNodes].indexOf(tabs[1]))
		input(tabs[1], {inputType: 'insertText', data: 'X'})
		const typed = document.createTextNode('X')
		tabs[1].before(typed)
		selection.collapse(typed, 1)
		tabs[1].dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(textOf(container)).toBe('A\tX\tZ')
		const key = (shiftKey: boolean) =>
			tabs[1].dispatchEvent(
				new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey, bubbles: true, cancelable: true}),
			)
		key(false)
		expect(textOf(container)).toBe('A\t\tZ')
		expect(doc.isDirty()).toBe(false)
		key(true)
		expect(textOf(container)).toBe('A\tX\tZ')
		expect(doc.isDirty()).toBe(true)
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:r><w:t>A</w:t><w:tab/><w:t xml:space="preserve">X</w:t><w:tab/><w:t>Z</w:t></w:r>')
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
		anchor.dispatchEvent(new InputEvent('input', {bubbles: true}))
		expect(anchor.textContent).toBe('linked')

		const tabs = [...container.querySelectorAll('[contenteditable="false"]')].filter(
			(element) => element.textContent === '\t',
		)
		const between = document.createTextNode('mid')
		tabs[2].before(between)
		document.getSelection()!.collapse(between, 3)
		tabs[2].dispatchEvent(new InputEvent('input', {bubbles: true}))
		const xml = await ZipArchive.open(await doc.save()).text('word/document.xml')
		expect(xml).toContain('<w:hyperlink r:id="rIdLink"><w:r><w:t>linked</w:t></w:r></w:hyperlink>')
		expect(xml).toContain(
			'<w:r><w:tab/><w:t xml:space="preserve">mid</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:tab/></w:r>',
		)
	})

	test('not editable, nothing listens', async () => {
		const {doc, container} = await show(sample())
		const plain = span(container, 'plain')
		expect(input(plain, {inputType: 'insertParagraph'}).defaultPrevented).toBe(false)
		doc.setEditable(true)
		expect(input(plain, {inputType: 'insertParagraph'}).defaultPrevented).toBe(true)
		doc.setEditable(false)
		expect(input(plain, {inputType: 'insertParagraph'}).defaultPrevented).toBe(false)
	})
})
