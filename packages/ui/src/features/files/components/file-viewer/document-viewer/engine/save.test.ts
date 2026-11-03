import {describe, expect, test} from 'vitest'

import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'

import {buildModel, type DocumentModel, type Insertion, type Paragraph, type Slot} from './model'
import {DocxError, DocxPackage} from './package'
import {applySplices, save} from './save'
import {docx, fixture, PNG, WORD_FIXTURES, zip} from './test-helpers'

async function load(bytes: Uint8Array) {
	const pkg = DocxPackage.open(bytes)
	return {pkg, model: await buildModel(pkg)}
}

const write = (pkg: DocxPackage, model: DocumentModel, texts: Array<[Slot, string]>) =>
	save(pkg, model.parts, new Map(texts))

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b))

async function part(bytes: Uint8Array, name: string) {
	return ZipArchive.open(bytes).text(name)
}

const paragraphs = (model: DocumentModel) =>
	model.sections.flatMap((section) => section.blocks.filter((block): block is Paragraph => block.kind === 'paragraph'))

const insertion = (paragraph: Paragraph, at?: Insertion['at'], id = -1): Insertion => ({id, paragraph, at})

describe('fixtures', () => {
	const openable = WORD_FIXTURES.filter((path) => !/encrypted|doctype/.test(path))

	test.skipIf(!openable.length)('without edits, a save is the file as it was', {timeout: 60000}, async () => {
		for (const path of openable) {
			const original = fixture(path)
			const {pkg, model} = await load(original)
			expect(same(await write(pkg, model, []), original), path).toBe(true)
		}
	})

	test.skipIf(!openable.length)('an edit changes that w:t and nothing else', {timeout: 60000}, async () => {
		for (const path of openable) {
			const original = fixture(path)
			const {pkg, model} = await load(original)
			const editable = model.refs.filter((ref) => ref.part === model.main)
			if (!editable.length) continue
			const [first, last] = [editable[0], editable[editable.length - 1]]
			const edits: Array<[Slot, string]> = [
				[first, 'Edited <first> & "quoted"'],
				[last, `${last.text} — appended`],
			]
			const saved = await write(pkg, model, first === last ? edits.slice(0, 1) : edits)

			// The part is the original with exactly those contents replaced
			const source = model.parts.get(model.main)!.text
			const expected = applySplices(source, [
				{start: first.element.contentStart, end: first.element.contentEnd, text: 'Edited &lt;first&gt; &amp; "quoted"'},
				...(first === last
					? []
					: [
							{
								start: last.element.contentStart,
								end: last.element.contentEnd,
								text: `${last.text} — appended`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
							},
						]),
			])
			const savedText = await part(saved, model.main)
			// A w:t that trimmed its whitespace may need xml:space added, which is the only other change allowed
			expect(savedText.replace(/ xml:space="preserve"/g, ''), path).toBe(expected.replace(/ xml:space="preserve"/g, ''))

			// Every other entry is byte for byte the same, in the same order
			const before = ZipArchive.open(original)
			const after = ZipArchive.open(saved)
			expect(
				after.entries.map((entry) => entry.name),
				path,
			).toEqual(before.entries.map((entry) => entry.name))
			for (const entry of before.entries) {
				if (entry.name === model.main) continue
				expect(same(await before.bytes(entry.name), await after.bytes(entry.name)), `${path} ${entry.name}`).toBe(true)
			}

			// Opening the saved file shows the edits
			const reopened = await buildModel(DocxPackage.open(saved))
			const texts = reopened.refs.map((ref) => ref.text)
			expect(texts, path).toContain('Edited <first> & "quoted"')
			if (first !== last) expect(texts, path).toContain(`${last.text} — appended`)
		}
	})
})

describe('splicing', () => {
	test('xml:space is added when the new text needs it, and escapes are applied', async () => {
		const {pkg, model} = await load(
			docx(
				'<w:p><w:r><w:t>plain</w:t><w:t/><w:t xml:space="default">defaulted</w:t><w:t xml:space="preserve"> kept </w:t></w:r></w:p>',
			),
		)
		const [plain, empty, defaulted, kept] = model.refs
		const saved = await write(pkg, model, [
			[plain, ' leading and trailing '],
			[empty, 'a < b & c > d'],
			[defaulted, 'two  spaces'],
			[kept, 'still'],
		])
		const body = (await part(saved, 'word/document.xml')).match(/<w:r>.*<\/w:r>/)![0]
		expect(body).toBe(
			'<w:r><w:t xml:space="preserve"> leading and trailing </w:t><w:t>a &lt; b &amp; c &gt; d</w:t><w:t xml:space="preserve">two  spaces</w:t><w:t xml:space="preserve">still</w:t></w:r>',
		)
	})

	test("characters XML can't carry are dropped, carriage returns kept as references", async () => {
		const {pkg, model} = await load(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'))
		const saved = await write(pkg, model, [[model.refs[0], 'a\u0001b\rc\uffffd']])
		expect(await part(saved, 'word/document.xml')).toContain('<w:t>ab&#13;cd</w:t>')
	})

	test('text typed into an empty paragraph becomes a run formatted like its mark, without its revision marks', async () => {
		const {pkg, model} = await load(
			docx(
				'<w:p/><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:ins w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/><w:b/><w:color w:val="FF0000"/></w:rPr></w:pPr><w:bookmarkStart w:id="0" w:name="x"/></w:p>',
			),
		)
		const [empty, formatted] = paragraphs(model)
		const saved = await write(pkg, model, [
			[insertion(empty, undefined, -1), 'first'],
			[insertion(formatted, undefined, -2), 'second'],
		])
		const xml = await part(saved, 'word/document.xml')
		expect(xml).toContain('<w:body><w:p><w:r><w:t xml:space="preserve">first</w:t></w:r></w:p>')
		expect(xml).toContain(
			'<w:bookmarkStart w:id="0" w:name="x"/><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">second</w:t></w:r></w:p>',
		)
		const reopened = await buildModel(DocxPackage.open(saved))
		expect(reopened.refs.map((ref) => ref.text)).toEqual(['first', 'second'])
	})

	test('text typed beside an object goes into its run, next to it', async () => {
		const drawing =
			'<w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
		const {pkg, model} = await load(
			docx(
				`<w:p><w:r><w:rPr><w:i/></w:rPr>${drawing}</w:r></w:p><w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback/></mc:AlternateContent></w:r></w:p>`,
				{
					parts: {'word/media/image1.png': PNG},
					rels: [{id: 'rIdImg', type: 'image', target: 'media/image1.png'}],
				},
			),
		)
		const [plain, alternate] = paragraphs(model)
		const at = (paragraph: Paragraph, side: 'before' | 'after') => {
			const inline = paragraph.inlines[0]
			if (inline.kind !== 'graphic') throw new Error('expected a picture')
			return {run: inline.run!, node: inline.node!, side}
		}
		const saved = await write(pkg, model, [
			[insertion(plain, at(plain, 'before'), -1), 'before'],
			[insertion(plain, at(plain, 'after'), -2), 'after'],
			[insertion(alternate, at(alternate, 'after'), -3), 'outside the choice'],
		])
		const xml = await part(saved, 'word/document.xml')
		expect(xml).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">before</w:t><w:drawing>')
		expect(xml).toContain('</w:drawing><w:t xml:space="preserve">after</w:t></w:r>')
		expect(xml).toContain('</mc:AlternateContent><w:t xml:space="preserve">outside the choice</w:t></w:r>')
		const reopened = await buildModel(DocxPackage.open(saved))
		expect(reopened.refs.map((ref) => ref.text)).toEqual(['before', 'after', 'outside the choice'])
	})

	test('parts stored as UTF-16 or with a byte order mark are written back as UTF-8, and say so', async () => {
		const xml = (text: string, encoding = 'UTF-16') =>
			`<?xml version="1.0" encoding="${encoding}"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
		const utf16 = (text: string) => {
			const out = new Uint8Array(text.length * 2 + 2)
			out.set([0xff, 0xfe])
			for (let i = 0; i < text.length; i++) out[2 + i * 2] = text.charCodeAt(i)
			return out
		}
		// The bytes as written, a byte order mark included
		const written = (bytes: Uint8Array) => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
		const {pkg, model} = await load(zip({'word/document.xml': utf16(xml('old'))}))
		const saved = await write(pkg, model, [[model.refs[0], 'new']])
		expect(written(await ZipArchive.open(saved).bytes('word/document.xml'))).toBe(xml('new', 'UTF-8'))

		const bom = new TextEncoder().encode(`\ufeff${xml('old', 'UTF-8')}`)
		const withBom = await load(zip({'word/document.xml': bom}))
		const savedBom = await ZipArchive.open(
			await write(withBom.pkg, withBom.model, [[withBom.model.refs[0], 'new']]),
		).bytes('word/document.xml')
		expect(written(savedBom)).toBe(xml('new', 'UTF-8'))
	})

	test('overlapping splices are refused rather than written', () => {
		expect(() =>
			applySplices('abcdef', [
				{start: 1, end: 4, text: 'x'},
				{start: 3, end: 5, text: 'y'},
			]),
		).toThrow(DocxError)
		expect(
			applySplices('abcdef', [
				{start: 4, end: 6, text: 'Y'},
				{start: 0, end: 1, text: 'X'},
				{start: 2, end: 2, text: '+'},
			]),
		).toBe('Xb+cdY')
	})
})
