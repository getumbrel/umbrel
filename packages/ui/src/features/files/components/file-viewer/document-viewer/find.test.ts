// @vitest-environment jsdom
// Find reads the pages the engine draws, so documents drawn by the engine are what these run against
import {afterEach, beforeAll, describe, expect, test} from 'vitest'

import {openDocument, type DocxDocument} from '@/features/files/components/file-viewer/document-viewer/engine'
import {docx, NAMESPACES} from '@/features/files/components/file-viewer/document-viewer/engine/test-helpers'
import {linesOf} from '@/features/files/components/file-viewer/document-viewer/find'
import {pattern, rangeIn} from '@/features/files/components/file-viewer/shell/find'

// jsdom lays nothing out: ranges measure nothing, and a page's parts sit where their styles put them (a footer from
// the page's bottom), which is all reading order goes by
beforeAll(() => {
	Range.prototype.getClientRects = () => Object.assign([], {item: () => null}) as unknown as DOMRectList
	Range.prototype.getBoundingClientRect = () => new DOMRect()
	Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
		configurable: true,
		get(this: HTMLElement) {
			const {top, bottom} = this.style
			return top ? parseFloat(top) : bottom ? 1056 - parseFloat(bottom) : 0
		},
	})
})

let doc: DocxDocument | undefined
afterEach(() => {
	doc?.destroy()
	doc = undefined
	document.body.replaceChildren()
})

async function pages(bytes: Uint8Array) {
	const container = document.createElement('div')
	document.body.append(container)
	doc = await openDocument(bytes)
	return (await doc.render(container)).pages
}

const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`
const story = (root: string, text: string) =>
	`<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}><w:p>${run(text)}</w:p></w:${root}>`

describe('reading the pages', () => {
	test('a paragraph is one line across its runs; paragraphs, cells and line breaks part lines', async () => {
		const lines = linesOf(
			await pages(
				docx(
					`<w:p>${run('Hello ')}${run('wor', '<w:rPr><w:b/></w:rPr>')}${run('ld')}</w:p>` +
						`<w:p><w:r><w:t>Second</w:t><w:br/><w:t>line</w:t></w:r></w:p>` +
						`<w:tbl><w:tr><w:tc><w:p>${run('one')}</w:p></w:tc><w:tc><w:p>${run('two')}</w:p></w:tc></w:tr></w:tbl>`,
				),
			),
		)
		expect(lines.map((line) => line.text)).toEqual(['Hello world', 'Second', 'line', 'one', 'two'])
		expect(lines.every((line) => line.page === 0)).toBe(true)
	})

	test('a page is read top to bottom: header, text, footer', async () => {
		const lines = linesOf(
			await pages(
				docx(
					`<w:p>${run('Body')}</w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>` +
						'<w:footerReference w:type="default" r:id="rIdF"/></w:sectPr>',
					{
						parts: {'word/header1.xml': story('hdr', 'Header'), 'word/footer1.xml': story('ftr', 'Footer')},
						rels: [
							{id: 'rIdH', type: 'header', target: 'header1.xml'},
							{id: 'rIdF', type: 'footer', target: 'footer1.xml'},
						],
					},
				),
			),
		)
		expect(lines.map((line) => line.text)).toEqual(['Header', 'Body', 'Footer'])
	})

	test('a match across runs is one range over exactly its text', async () => {
		const [line] = linesOf(
			await pages(docx(`<w:p>${run('Hello ')}${run('wor', '<w:rPr><w:b/></w:rPr>')}${run('ld')}</w:p>`)),
		)
		const match = line.text.matchAll(pattern('o wo')!).next().value!
		const range = rangeIn(line, match.index, match.index + match[0].length)
		expect(range.toString()).toBe('o wo')
		expect([range.startContainer.textContent, range.endContainer.textContent]).toEqual(['Hello ', 'wor'])
	})
})
