// @vitest-environment jsdom
// Drawing into the DOM, and editing through it: every save is checked by reopening the bytes it produced.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {afterEach, describe, expect, onTestFinished, test} from 'vitest'

import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'
import {
	loadPresentation,
	openPresentation,
	type Presentation,
} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {Images, rendered, type RenderedSlide} from '@/features/files/components/file-viewer/slides-viewer/engine/render'
import {
	buildDeck,
	DECKS,
	flatten,
	placeholder,
	shape,
	shownText,
	slide,
	textOf,
	xfrm,
} from '@/features/files/components/file-viewer/slides-viewer/engine/test-pptx'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''
const fixture = (path: string) => new Uint8Array(readFileSync(join(FIXTURES, path)))
const hasFixtures = Boolean(FIXTURES) && existsSync(join(FIXTURES, 'Samples/PowerPoint/deck.pptx'))

afterEach(() => document.body.replaceChildren())

// Renders a slide into the document, makes it editable, applies `change` to its DOM and fires input
function edit(deck: Presentation, index: number, change: (slide: RenderedSlide) => void) {
	const element = deck.renderSlide(index)
	document.body.append(element)
	deck.setEditable(index, element, true)
	const slide = rendered.get(element)!
	change(slide)
	for (const body of slide.bodies) body.element.dispatchEvent(new Event('input', {bubbles: true}))
	return element
}
const setText = (node: HTMLElement, text: string) => ((node.firstChild as Text).data = text)

// Every entry but `changed` must come through a save exactly as it was
function expectUntouched(before: Uint8Array, after: Uint8Array, changed: string[]) {
	const a = ZipArchive.open(before)
	const b = ZipArchive.open(after)
	expect(b.entries.map((entry) => entry.name)).toEqual(a.entries.map((entry) => entry.name))
	for (const entry of a.entries) {
		if (changed.includes(entry.name)) continue
		expect(b.entries.find((other) => other.name === entry.name)).toEqual(entry)
	}
}

const partText = async (bytes: Uint8Array, part: string) => ZipArchive.open(bytes).text(part)

describe.skipIf(!hasFixtures)('rendering the fixtures', () => {
	test.each(DECKS)('%s draws every slide with all its text', async (path) => {
		const bytes = fixture(path)
		const deck = await openPresentation(bytes)
		const models = await loadPresentation(bytes)
		for (let i = 0; i < deck.slideCount; i++) {
			const element = deck.renderSlide(i)
			expect(element.style.width).toBe(`${deck.slideSize.width}px`)
			// The DOM carries exactly the model's text: nothing lost, nothing invented
			expect(element.textContent).toBe(shownText(models.model(i).elements))
			for (const node of element.querySelectorAll('*')) {
				for (const attribute of node.getAttributeNames()) expect(attribute.startsWith('on'), attribute).toBe(false)
				if (node.tagName === 'A') {
					expect(node.getAttribute('href')).toMatch(/^(https?:|mailto:)/)
					expect(node.getAttribute('rel')).toBe('noopener noreferrer')
					expect(node.getAttribute('target')).toBe('_blank')
				}
			}
		}
		deck.destroy()
		expect(() => deck.renderSlide(0)).toThrow()
	})

	test('saving with no edits gives back the identical file', async () => {
		for (const path of DECKS) {
			const bytes = fixture(path)
			const deck = await openPresentation(bytes)
			expect(deck.isDirty()).toBe(false)
			expect(Buffer.from(await deck.save()).equals(Buffer.from(bytes)), path).toBe(true)
		}
	}, 60000)
})

test('an SVG picture never becomes a blob: URL', async () => {
	const bytes = await buildDeck({
		slides: [slide('')],
		parts: {
			'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
			'ppt/media/image2.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
		},
	})
	const types: string[] = []
	const createObjectURL = URL.createObjectURL
	URL.createObjectURL = (blob) => `blob:test/${types.push((blob as Blob).type)}`
	onTestFinished(() => void (URL.createObjectURL = createObjectURL))
	const images = new Images((await loadPresentation(bytes)).pkg)
	expect(await images.load('ppt/media/image2.svg')).toBeUndefined()
	expect(await images.load('ppt/media/image1.png')).toBe('blob:test/1')
	expect(types).toEqual(['image/png'])
})

describe('the engine never builds DOM from markup', () => {
	test('no innerHTML, outerHTML, insertAdjacentHTML, document.write or style strings', () => {
		const dir = join(__dirname)
		for (const name of readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.includes('test'))) {
			const source = readFileSync(join(dir, name), 'utf8')
			expect(source, name).not.toMatch(
				/innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\('style'|cssText|new Function|eval\(/,
			)
		}
	})
})

describe.skipIf(!hasFixtures)('editing real decks', () => {
	test('one changed run changes only its <a:t>; everything else survives byte for byte', async () => {
		const bytes = fixture('Samples2/PowerPoint/features-16x9.pptx')
		const deck = await openPresentation(bytes)
		edit(deck, 1, (slide) => {
			const paragraph = slide.bodies[1].paragraphs[5]
			setText(paragraph.runs[1], 'heavy & <bold>')
		})
		expect(deck.isDirty()).toBe(true)
		const saved = await deck.save()
		expect(deck.isDirty()).toBe(false)
		expectUntouched(bytes, saved, ['ppt/slides/slide2.xml'])
		const before = await partText(bytes, 'ppt/slides/slide2.xml')
		const after = await partText(saved, 'ppt/slides/slide2.xml')
		expect(after).toBe(before.replace('<a:t>bold</a:t>', '<a:t>heavy &amp; &lt;bold&gt;</a:t>'))
		// Reopened, the text reads back as typed, formatting intact
		const reopened = await loadPresentation(saved)
		const runs = flatten(reopened.model(1).elements).map(textOf)
		expect(runs.some((text) => text.includes('Mixed runs: heavy & <bold>, italic'))).toBe(true)
	})

	test('edits survive re-rendering before they are saved, and a second save builds on the first', async () => {
		const bytes = fixture('Samples2/PowerPoint/long-40-slides.pptx')
		const deck = await openPresentation(bytes)
		edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'Forty-one slides'))
		expect(deck.renderSlide(0).textContent).toContain('Forty-one slides')
		const first = await deck.save()
		// The saved bytes are the new baseline: the same edit isn't pending any more, a new one is
		edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'Forty-two slides'))
		edit(deck, 2, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'Changed title'))
		const second = await deck.save()
		expectUntouched(first, second, ['ppt/slides/slide1.xml', 'ppt/slides/slide3.xml'])
		const reopened = await loadPresentation(second)
		expect(textOf(reopened.model(0).elements[0])).toBe('Forty-two slides')
		expect(flatten(reopened.model(2).elements).map(textOf)).toContain('Changed title')
	}, 30000)

	test('typing back the original text leaves nothing to save', async () => {
		const deck = await openPresentation(fixture('Samples2/PowerPoint/deck-4x3.pptx'))
		const element = edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'Changed'))
		expect(deck.isDirty()).toBe(true)
		const slideDom = rendered.get(element)!
		setText(slideDom.bodies[0].paragraphs[0].runs[0], 'A classic 4:3 deck')
		slideDom.bodies[0].element.dispatchEvent(new Event('input'))
		expect(deck.isDirty()).toBe(false)
	})

	test('table cells are editable', async () => {
		const bytes = fixture('Samples2/PowerPoint/features-16x9.pptx')
		const deck = await openPresentation(bytes)
		edit(deck, 5, (slide) => {
			const cell = slide.bodies.find((body) => body.element.textContent === 'Photos')!
			setText(cell.paragraphs[0].runs[0], 'Pictures')
		})
		const saved = await deck.save()
		expectUntouched(bytes, saved, ['ppt/slides/slide6.xml'])
		expect(await partText(saved, 'ppt/slides/slide6.xml')).toContain('<a:t>Pictures</a:t>')
	})
})

describe('editing, read back from whatever the browser leaves', () => {
	const runs = (texts: string[], rPr = '') => texts.map((text) => `<a:r>${rPr}<a:t>${text}</a:t></a:r>`).join('')

	async function deckWith(body: string) {
		const bytes = await buildDeck({slides: [slide(shape(xfrm(0, 0, 3000000, 1000000), body))]})
		return {bytes, deck: await openPresentation(bytes)}
	}

	test('text the browser moved out of a deleted run joins its neighbour', async () => {
		const {deck} = await deckWith(`<a:p>${runs(['One ', 'two ', 'three'])}</a:p>`)
		edit(deck, 0, (slide) => {
			const [, two, three] = slide.bodies[0].paragraphs[0].runs
			// The browser removed the middle run's element and typed into the paragraph itself
			two.replaceWith(document.createTextNode('TWO '))
			setText(three, 'three!')
		})
		const saved = await deck.save()
		const xml = await partText(saved, 'ppt/slides/slide1.xml')
		expect(xml).toContain(runs(['One TWO ', '', 'three!']))
	})

	test('a run typed into an empty paragraph copies the paragraph mark’s properties', async () => {
		const {deck} = await deckWith('<a:p><a:endParaRPr lang="en-US" sz="2400" b="1"/></a:p><a:p/>')
		edit(deck, 0, (slide) => {
			const [first, second] = slide.bodies[0].paragraphs
			first.element.append(document.createTextNode('Typed'))
			second.element.append(document.createTextNode('Also'))
		})
		const saved = await deck.save()
		const xml = await partText(saved, 'ppt/slides/slide1.xml')
		expect(xml).toContain(
			'<a:p><a:r><a:rPr lang="en-US" sz="2400" b="1"/><a:t>Typed</a:t></a:r><a:endParaRPr lang="en-US" sz="2400" b="1"/></a:p>',
		)
		expect(xml).toContain('<a:p><a:r><a:t>Also</a:t></a:r></a:p>')
		const reopened = await loadPresentation(saved)
		const typed = reopened.model(0).elements[0]
		expect(typed.kind === 'shape' && typed.text!.paragraphs[0].runs[0]).toMatchObject({
			text: 'Typed',
			style: {bold: true, size: 32},
		})
		// Further edits after that save land in the new run
		edit(deck, 0, (slide) => slide.bodies[0].paragraphs[0].element.append(document.createTextNode('!')))
		const again = await loadPresentation(await deck.save())
		expect(textOf(again.model(0).elements[0])).toBe('Typed!\nAlso')
	})

	test('fields and line breaks stay put; text beside them goes to the right run', async () => {
		const {deck} = await deckWith(
			`<a:p>${runs(['Slide '])}<a:fld id="{1}" type="slidenum"><a:t>9</a:t></a:fld>${runs([' of ten'])}<a:br/>${runs(['next'])}</a:p>`,
		)
		const element = edit(deck, 0, (slide) => {
			const paragraph = slide.bodies[0].paragraphs[0]
			// The field shows this slide's number, and is fixed
			expect(paragraph.element.textContent).toBe('Slide 1 of tennext')
			paragraph.runs[2].before(document.createTextNode('the '))
			paragraph.runs[2].remove()
		})
		void element
		const xml = await partText(await deck.save(), 'ppt/slides/slide1.xml')
		expect(xml).toContain(
			`${runs(['Slide '])}<a:fld id="{1}" type="slidenum"><a:t>9</a:t></a:fld>${runs([' of ten'])}<a:br/>${runs(['the '])}</a:p>`,
		)
	})

	test('text typed beside a field or break where there’s no run goes in a new run right there', async () => {
		const {deck} = await deckWith(
			'<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US" b="1"/><a:t>9</a:t></a:fld></a:p>' +
				`<a:p>${runs(['Title'])}<a:br/><a:br/>${runs(['Subtitle'])}</a:p>` +
				`<a:p>${runs(['Ends'])}<a:br/></a:p>` +
				`<a:p><a:pPr><a:buChar char="•"/></a:pPr>${runs(['Point'])}</a:p>`,
		)
		edit(deck, 0, (slide) => {
			const [field, lines, ending, bullet] = slide.bodies[0].paragraphs
			field.element.prepend(document.createTextNode('Page '))
			field.element.append(document.createTextNode(' of 3'))
			lines.element.querySelectorAll('br')[1].before(document.createTextNode('mid'))
			// Before the spacer that gives the empty last line its height
			ending.element.querySelectorAll('br')[1].before(document.createTextNode('more'))
			// Before the bullet is still the paragraph's own text
			bullet.element.prepend(document.createTextNode('A '))
		})
		const shown = (element: HTMLElement) =>
			rendered
				.get(element)!
				.bodies[0].paragraphs.map((paragraph) =>
					[...paragraph.element.childNodes].map((node) => (node.nodeName === 'BR' ? '\n' : node.textContent)).join(''),
				)
		const expected = ['Page 1 of 3', 'Title\nmid\nSubtitle', 'Ends\nmore', '•A Point']
		// Drawn again before saving, as a thumbnail or a return to the slide would
		expect(shown(deck.renderSlide(0))).toEqual(expected)
		const saved = await deck.save()
		const xml = await partText(saved, 'ppt/slides/slide1.xml')
		expect(xml).toContain(
			'<a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>Page </a:t></a:r><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US" b="1"/><a:t>9</a:t></a:fld>' +
				`${runs([' of 3'])}</a:p>` +
				`<a:p>${runs(['Title'])}<a:br/>${runs(['mid'])}<a:br/>${runs(['Subtitle'])}</a:p>` +
				`<a:p>${runs(['Ends'])}<a:br/>${runs(['more'])}</a:p>` +
				`<a:p><a:pPr><a:buChar char="•"/></a:pPr>${runs(['A Point'])}</a:p>`,
		)
		const reopened = await openPresentation(saved)
		expect(shown(reopened.renderSlide(0))).toEqual(expected)
	})

	// A React UI destroys the deck before its slides' cleanups let go of them
	test('letting go of a slide after the deck is destroyed is harmless', async () => {
		const {deck} = await deckWith(`<a:p>${runs(['text'])}</a:p>`)
		const element = edit(deck, 0, () => {})
		deck.destroy()
		expect(() => deck.setEditable(0, element, false)).not.toThrow()
		expect(() => deck.setEditable(0, element, true)).toThrow()
	})

	test('self-closing text and unsafe characters', async () => {
		const {deck} = await deckWith('<a:p><a:r><a:rPr/><a:t/></a:r></a:p>')
		edit(deck, 0, (slide) => slide.bodies[0].paragraphs[0].runs[0].append(document.createTextNode('a\u0001b\r\nc')))
		const xml = await partText(await deck.save(), 'ppt/slides/slide1.xml')
		// Control characters XML can't carry are dropped; a line break can't live in a run and reads as a space
		expect(xml).toContain('<a:r><a:rPr/><a:t>ab c</a:t></a:r>')
	})

	test('a UTF-16 slide is saved as UTF-8 that says so', async () => {
		const xml =
			'<?xml version="1.0" encoding="UTF-16" standalone="yes"?>' +
			slide(shape(xfrm(0, 0, 3000000, 1000000), `<a:p>${runs(['Grüße ', 'old'])}</a:p>`))
		const utf16 = new Uint8Array(2 + 2 * xml.length)
		const view = new DataView(utf16.buffer)
		view.setUint16(0, 0xfeff, true)
		for (let i = 0; i < xml.length; i++) view.setUint16(2 + 2 * i, xml.charCodeAt(i), true)
		const bytes = await buildDeck({slides: [''], parts: {'ppt/slides/slide1.xml': utf16}})
		const deck = await openPresentation(bytes)
		edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[1], 'new'))
		const saved = await deck.save()
		expectUntouched(bytes, saved, ['ppt/slides/slide1.xml'])
		const part = await ZipArchive.open(saved).bytes('ppt/slides/slide1.xml')
		expect(new TextDecoder('utf-8', {fatal: true}).decode(part)).toBe(
			xml.replace('UTF-16', 'UTF-8').replace('<a:t>old</a:t>', '<a:t>new</a:t>'),
		)
	})

	test('a save’s bytes are the caller’s: later saves patch the package as it was opened', async () => {
		const box = (text: string) => slide(shape(xfrm(0, 0, 3000000, 1000000), `<a:p>${runs([text])}</a:p>`))
		const bytes = await buildDeck({slides: [box('one'), box('two')]})
		const deck = await openPresentation(bytes)
		edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'first'))
		const first = await deck.save()
		// The engine never reads these again, so nothing the caller does with them reaches the next save
		first.fill(0)
		edit(deck, 1, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'second'))
		const second = await deck.save()
		expectUntouched(bytes, second, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'])
		const reopened = await loadPresentation(second)
		expect([0, 1].map((index) => textOf(reopened.model(index).elements[0]))).toEqual(['first', 'second'])
	})

	test('text typed while a save is in flight stays unsaved, and saves next time', async () => {
		const {deck} = await deckWith(`<a:p>${runs(['first'])}</a:p>`)
		const element = edit(deck, 0, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'second'))
		// save() takes what's there when it's called
		const saving = deck.save()
		const dom = rendered.get(element)!
		setText(dom.bodies[0].paragraphs[0].runs[0], 'third')
		dom.bodies[0].element.dispatchEvent(new Event('input'))
		const saved = await saving
		expect(await partText(saved, 'ppt/slides/slide1.xml')).toContain('<a:t>second</a:t>')
		expect(deck.isDirty()).toBe(true)
		expect(await partText(await deck.save(), 'ppt/slides/slide1.xml')).toContain('<a:t>third</a:t>')
		expect(deck.isDirty()).toBe(false)
	})

	test('a slide part used twice is edited once', async () => {
		const parts = await buildDeck({slides: [slide(shape(xfrm(0, 0, 100, 100), `<a:p>${runs(['shared'])}</a:p>`))]})
		const {ZipArchive: Archive, patchZip} = await import('@/features/files/components/file-viewer/shared/zip')
		const archive = Archive.open(parts)
		const presentation = (await archive.text('ppt/presentation.xml')).replace(
			'</p:sldIdLst>',
			'<p:sldId id="300" r:id="rId10"/></p:sldIdLst>',
		)
		const bytes = await patchZip(archive, new Map([['ppt/presentation.xml', presentation]]))
		const deck = await openPresentation(bytes)
		expect(deck.slideCount).toBe(2)
		edit(deck, 1, (slide) => setText(slide.bodies[0].paragraphs[0].runs[0], 'once'))
		const xml = await partText(await deck.save(), 'ppt/slides/slide1.xml')
		expect(xml.match(/<a:t>once<\/a:t>/g)).toHaveLength(1)
	})

	test('placeholders inherited text is drawn but only the slide’s own text is editable', async () => {
		const bytes = await buildDeck({
			master: placeholder('title', undefined, xfrm(0, 0, 100, 100), '<a:p><a:r><a:t>Master prompt</a:t></a:r></a:p>'),
			layout: shape(xfrm(0, 500, 100, 100), '<a:p><a:r><a:t>Layout text</a:t></a:r></a:p>'),
			slides: [slide(placeholder('title', undefined, '', '<a:p><a:r><a:t>Slide title</a:t></a:r></a:p>'))],
		})
		const deck = await openPresentation(bytes)
		const element = deck.renderSlide(0)
		expect(element.textContent).toBe('Layout textSlide title')
		deck.setEditable(0, element, true)
		const editable = element.querySelectorAll('[contenteditable="plaintext-only"], [contenteditable="true"]')
		expect([...editable].map((node) => node.textContent)).toEqual(['Slide title'])
		deck.setEditable(0, element, false)
		expect(element.querySelectorAll('[contenteditable="plaintext-only"], [contenteditable="true"]')).toHaveLength(0)
	})
})

describe('structure is protected while editing', () => {
	async function editable() {
		const bytes = await buildDeck({
			slides: [
				slide(
					shape(
						xfrm(0, 0, 3000000, 1000000),
						'<a:p><a:r><a:t>First</a:t></a:r></a:p><a:p><a:r><a:t>Second</a:t></a:r></a:p>',
					),
				),
			],
		})
		const deck = await openPresentation(bytes)
		const element = deck.renderSlide(0)
		document.body.append(element)
		deck.setEditable(0, element, true)
		return {deck, slide: rendered.get(element)!}
	}
	const beforeInput = (target: HTMLElement, inputType: string) => {
		const event = new InputEvent('beforeinput', {inputType, bubbles: true, cancelable: true})
		target.dispatchEvent(event)
		return event.defaultPrevented
	}
	const select = (start: Node, startOffset: number, end: Node, endOffset: number) => {
		const range = document.createRange()
		range.setStart(start, startOffset)
		range.setEnd(end, endOffset)
		document.getSelection()!.removeAllRanges()
		document.getSelection()!.addRange(range)
	}

	test('new paragraphs, line breaks and formatting are refused', async () => {
		const {slide} = await editable()
		const body = slide.bodies[0].element
		for (const type of ['insertParagraph', 'insertLineBreak', 'formatBold', 'insertFromDrop'])
			expect(beforeInput(body, type)).toBe(true)
	})

	test('a collapsed deletion may take text, never a bullet, field, break or the paragraph edge', async () => {
		const bytes = await buildDeck({
			slides: [
				slide(
					shape(
						xfrm(0, 0, 3000000, 1000000),
						'<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Bullet</a:t></a:r></a:p>' +
							'<a:p><a:r><a:t>Page </a:t></a:r><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld><a:r><a:t> end</a:t></a:r></a:p>',
					),
				),
			],
		})
		const deck = await openPresentation(bytes)
		const element = deck.renderSlide(0)
		document.body.append(element)
		deck.setEditable(0, element, true)
		const {bodies} = rendered.get(element)!
		const [bullet, field] = bodies[0].paragraphs
		const body = bodies[0].element
		const caret = (node: Node, offset: number) => select(node, offset, node, offset)
		caret(bullet.runs[0].firstChild!, 0)
		expect(beforeInput(body, 'deleteContentBackward')).toBe(true)
		expect(beforeInput(body, 'deleteContentForward')).toBe(false)
		caret(bullet.runs[0].firstChild!, 6)
		expect(beforeInput(body, 'deleteContentForward')).toBe(true)
		expect(beforeInput(body, 'deleteContentBackward')).toBe(false)
		expect(beforeInput(body, 'deleteSoftLineBackward')).toBe(true)
		caret(field.runs[1].firstChild!, 0)
		expect(beforeInput(body, 'deleteContentBackward')).toBe(true)
		caret(field.runs[0].firstChild!, 5)
		expect(beforeInput(body, 'deleteContentForward')).toBe(true)
		expect(beforeInput(body, 'deleteWordBackward')).toBe(false)
	})

	test('edits inside one paragraph go through; across paragraphs they don’t', async () => {
		const {slide} = await editable()
		const [first, second] = slide.bodies[0].paragraphs
		const body = slide.bodies[0].element
		select(first.runs[0].firstChild!, 1, first.runs[0].firstChild!, 3)
		expect(beforeInput(body, 'insertText')).toBe(false)
		expect(beforeInput(body, 'deleteContentBackward')).toBe(false)
		select(first.runs[0].firstChild!, 3, second.runs[0].firstChild!, 2)
		expect(beforeInput(body, 'insertText')).toBe(true)
		expect(beforeInput(body, 'deleteContentForward')).toBe(true)
	})
})
