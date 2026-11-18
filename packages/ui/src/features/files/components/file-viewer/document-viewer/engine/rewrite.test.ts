import {describe, expect, test} from 'vitest'

import {parseXml} from '@/features/files/components/file-viewer/shared/xml'

import {buildModel, type Block, type DocumentModel, type Insertion, type Paragraph, type Slot} from './model'
import {DocxPackage} from './package'
import {Draft} from './rewrite'
import {docx, fixture, WORD_FIXTURES} from './test-helpers'

async function load(bytes: Uint8Array) {
	return buildModel(DocxPackage.open(bytes))
}

const paragraphs = (blocks: Block[]): Paragraph[] =>
	blocks.flatMap((block) =>
		block.kind === 'paragraph'
			? [block]
			: block.rows.flatMap((row) => row.cells.flatMap((cell) => paragraphs(cell.blocks))),
	)

const body = (model: DocumentModel) => model.sections.flatMap((section) => paragraphs(section.blocks))

// A paragraph as the editor counts it: a character for each character of text, one for anything else in the line
function flat(paragraph: Paragraph): string {
	let out = ''
	for (const inline of paragraph.inlines) {
		if (inline.kind === 'text') out += inline.ref ? inline.text : '▪'
		else if (inline.kind === 'tab') out += inline.ref ? '\t' : '→'
		else if (inline.kind === 'break') out += '↵'
		else if (inline.kind === 'graphic') out += '▣'
		else if (inline.kind === 'field') out += '#'
		else if (inline.kind === 'note') out += '^'
		else if (inline.kind === 'rule') out += '―'
	}
	return out
}

// The first paragraph of a body, and a way to read what a draft wrote
async function open(xml: string, options?: Parameters<typeof docx>[1]) {
	const model = await load(docx(xml, options))
	const [paragraph] = body(model)
	const draft = (texts: Array<[Slot, string]> = []) => Draft.read(paragraph, new Map(texts))!
	const read = (written: string) => model.derive(written, paragraph)
	return {model, paragraph, draft, read}
}

const run = (text: string, props = '') =>
	`<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''}>${text}</w:t></w:r>`

describe('reading', () => {
	test('a paragraph nothing was done to is written with the content it had', async () => {
		const xml =
			'<w:p w:rsidR="00A1"><w:pPr><w:jc w:val="center"/></w:pPr>' +
			'<w:bookmarkStart w:id="0" w:name="a"/><w:r w:rsidR="00B2"><w:rPr><w:b/></w:rPr><w:t>one</w:t></w:r>' +
			'<w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve"> two</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="0"/></w:p>'
		const {draft} = await open(xml)
		expect(draft().xml()).toBe(xml)
		expect(draft().length).toBe(7)
	})

	test('what was typed since the file was read is part of it', async () => {
		const {paragraph, draft, model} = await open(
			`<w:p>${run('one')}<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/></wp:inline></w:drawing></w:r></w:p>`,
		)
		const picture = paragraph.inlines[1]
		if (picture.kind !== 'graphic') throw new Error('The second inline is the picture')
		const beside: Insertion = {id: -1, paragraph, at: {run: picture.run!, node: picture.node!, side: 'after'}}
		const written = draft([
			[model.refs[0], 'one & more'],
			[beside, 'after it'],
		]).xml()
		expect(written).toBe(
			'<w:p><w:r><w:t>one &amp; more</w:t></w:r>' +
				'<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/></wp:inline></w:drawing><w:t>after it</w:t></w:r></w:p>',
		)
	})

	test('text typed into an empty paragraph is a run formatted like its mark', async () => {
		const {paragraph, draft} = await open(
			'<w:p><w:pPr><w:rPr><w:b/><w:ins w:id="1" w:author="a"/></w:rPr></w:pPr></w:p>',
		)
		const written = draft([[{id: -1, paragraph}, 'typed']]).xml()
		expect(written).toBe(
			'<w:p><w:pPr><w:rPr><w:b/><w:ins w:id="1" w:author="a"/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>typed</w:t></w:r></w:p>',
		)
	})

	test('text typed inside something carried whole is still written', async () => {
		const {draft, model} = await open(
			'<w:p><w:r><mc:AlternateContent><mc:Choice Requires="w"><w:t>choice</w:t></mc:Choice></mc:AlternateContent></w:r></w:p>',
		)
		const written = draft([[model.refs[0], 'changed']]).xml()
		expect(written).toContain('<mc:Choice Requires="w"><w:t>changed</w:t></mc:Choice>')
		expect(draft([[model.refs[0], 'changed']]).length).toBe(7)
	})

	test('a paragraph a field runs through is not rewritten', async () => {
		const model = await load(
			docx(
				'<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC</w:instrText></w:r>' +
					`<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('entry')}</w:p>` +
					`<w:p>${run('more')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p>${run('after')}</w:p>`,
			),
		)
		const [first, second, third] = body(model)
		expect(Draft.read(first, new Map())).toBeUndefined()
		expect(Draft.read(second, new Map())).toBeUndefined()
		expect(Draft.read(third, new Map())).toBeDefined()
	})
})

describe('dividing and joining', () => {
	test('a paragraph divides inside a run, and both halves keep its formatting', async () => {
		const {draft, read} = await open(
			`<w:p w:rsidR="00A1" w14:paraId="1"><w:pPr><w:pStyle w:val="Body"/><w:jc w:val="both"/></w:pPr>${run('one two', '<w:i/>')}</w:p>`,
		)
		const first = draft()
		const second = first.split(4)!
		expect(first.xml()).toBe(
			'<w:p w:rsidR="00A1" w14:paraId="1"><w:pPr><w:pStyle w:val="Body"/><w:jc w:val="both"/></w:pPr>' +
				'<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">one </w:t></w:r></w:p>',
		)
		// The new paragraph has no identity of its own to repeat
		expect(second.xml()).toBe(
			'<w:p><w:pPr><w:pStyle w:val="Body"/><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>two</w:t></w:r></w:p>',
		)
		expect([flat(read(first.xml())), flat(read(second.xml()))]).toEqual(['one ', 'two'])
	})

	test('a hyperlink divided continues in the new paragraph; a content control ends in the first', async () => {
		const link = await open(`<w:p><w:hyperlink r:id="rId5" w:history="1">${run('one two')}</w:hyperlink></w:p>`)
		const first = link.draft()
		const second = first.split(3)!
		expect(first.xml()).toBe(
			'<w:p><w:hyperlink r:id="rId5" w:history="1"><w:r><w:t>one</w:t></w:r></w:hyperlink></w:p>',
		)
		expect(second.xml()).toBe(
			'<w:p><w:hyperlink r:id="rId5" w:history="1"><w:r><w:t xml:space="preserve"> two</w:t></w:r></w:hyperlink></w:p>',
		)

		const control = await open(
			`<w:p><w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${run('one two')}</w:sdtContent></w:sdt>${run('!')}</w:p>`,
		)
		const head = control.draft()
		const tail = head.split(3)!
		expect(head.xml()).toBe(
			'<w:p><w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:r><w:t>one</w:t></w:r></w:sdtContent></w:sdt></w:p>',
		)
		expect(tail.xml()).toBe('<w:p><w:r><w:t xml:space="preserve"> two</w:t></w:r><w:r><w:t>!</w:t></w:r></w:p>')
	})

	test('at either end one side is empty, and what marks a place stays with the text', async () => {
		const xml = `<w:p><w:bookmarkStart w:id="1" w:name="_Toc1"/>${run('Heading')}<w:bookmarkEnd w:id="1"/></w:p>`
		const start = (await open(xml)).draft()
		const moved = start.split(0)!
		expect(start.xml()).toBe('<w:p></w:p>')
		expect(moved.xml()).toBe(xml)

		const end = (await open(xml)).draft()
		const empty = end.split(7)!
		expect(end.xml()).toBe(xml)
		expect(empty.xml()).toBe('<w:p></w:p>')
	})

	test('the section break and a forced page break each stay where they belong', async () => {
		const {draft} = await open(
			`<w:p><w:pPr><w:pageBreakBefore/><w:rPr><w:b/></w:rPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>${run('ab')}</w:p>`,
		)
		const first = draft()
		const second = first.split(1)!
		expect(first.xml()).toBe(
			'<w:p><w:pPr><w:pageBreakBefore/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
		)
		expect(second.xml()).toBe(
			'<w:p><w:pPr><w:rPr><w:b/></w:rPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>b</w:t></w:r></w:p>',
		)
	})

	test('after a heading the new paragraph takes the style that follows it, and nothing else', async () => {
		const {draft} = await open(
			`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:rPr><w:b/></w:rPr></w:pPr>${run('Title')}</w:p>`,
		)
		const first = draft()
		const second = first.split(5, 'Body"Text')!
		expect(second.xml()).toBe('<w:p><w:pPr><w:pStyle w:val="Body&quot;Text"/></w:pPr></w:p>')
	})

	test('never inside a field: before it at its start, after it otherwise', async () => {
		const field =
			'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF a</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
			'<w:r><w:t>re</w:t></w:r><w:r><w:t>sult</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
		const {draft, paragraph} = await open(`<w:p>${run('a')}${field}${run('b')}</w:p>`)
		expect(flat(paragraph)).toBe('a▪▪b')
		const before = draft()
		expect(before.split(1)!.xml()).toBe(`<w:p>${field}<w:r><w:t>b</w:t></w:r></w:p>`)
		const between = draft()
		expect(between.split(2)!.xml()).toBe('<w:p><w:r><w:t>b</w:t></w:r></w:p>')
		expect(between.xml()).toBe(`<w:p><w:r><w:t>a</w:t></w:r>${field}</w:p>`)
	})

	test('joined paragraphs keep the first one’s formatting, unless it was empty', async () => {
		const model = await load(
			docx(
				`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('one')}</w:p>` +
					`<w:p><w:pPr><w:jc w:val="right"/><w:sectPr><w:pgSz w:w="1" w:h="1"/></w:sectPr></w:pPr>${run('two')}</w:p>` +
					`<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('four')}</w:p>`,
			),
		)
		const [one, two, three, four] = body(model).map((paragraph) => Draft.read(paragraph, new Map())!)
		one.append(two)
		expect(one.xml()).toBe(
			'<w:p><w:pPr><w:jc w:val="center"/><w:sectPr><w:pgSz w:w="1" w:h="1"/></w:sectPr></w:pPr>' +
				'<w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>',
		)
		three.append(four)
		expect(three.xml()).toBe('<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>four</w:t></w:r></w:p>')
	})
})

describe('removing', () => {
	test('within a run, across runs, and whole runs', async () => {
		const xml = `<w:p>${run('one', '<w:b/>')}${run('two')}${run('three', '<w:i/>')}</w:p>`
		const within = (await open(xml)).draft()
		expect(within.remove(1, 2)).toBe(true)
		expect(within.xml()).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>oe</w:t></w:r>')

		const across = (await open(xml)).draft()
		expect(across.remove(2, 8)).toBe(true)
		expect(across.xml()).toBe(
			'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>on</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ree</w:t></w:r></w:p>',
		)

		const all = (await open(xml)).draft()
		expect(all.remove(0, 11)).toBe(true)
		expect(all.xml()).toBe('<w:p></w:p>')
	})

	test('a bookmark outlives the text around it, and goes when both its ends do', async () => {
		const xml =
			`<w:p>${run('a')}<w:bookmarkStart w:id="1" w:name="kept"/>${run('b')}<w:bookmarkStart w:id="2" w:name="gone"/>` +
			`${run('c')}<w:bookmarkEnd w:id="2"/>${run('d')}<w:bookmarkEnd w:id="1"/>${run('e')}</w:p>`
		const {draft} = await open(xml)
		const removed = draft()
		expect(removed.remove(1, 4)).toBe(true)
		expect(removed.xml()).toBe(
			'<w:p><w:r><w:t>a</w:t></w:r><w:bookmarkStart w:id="1" w:name="kept"/><w:bookmarkEnd w:id="1"/><w:r><w:t>e</w:t></w:r></w:p>',
		)
	})

	test('objects go with the range; a footnote reference stops it', async () => {
		const objects = await open(`<w:p>${run('a')}<w:r><w:tab/><w:br/></w:r>${run('b')}</w:p>`)
		expect(flat(objects.paragraph)).toBe('a→↵b')
		const removed = objects.draft()
		expect(removed.remove(1, 2)).toBe(true)
		expect(flat(objects.read(removed.xml()))).toBe('a↵b')

		const note = await open(`<w:p>${run('a')}<w:r><w:footnoteReference w:id="2"/></w:r>${run('b')}</w:p>`, {
			footnotes: '<w:footnote w:id="2"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:footnote>',
		})
		expect(flat(note.paragraph)).toBe('a^b')
		expect(note.draft().remove(0, 3)).toBe(false)
		expect(note.draft().remove(0, 1)).toBe(true)
	})

	test('any part of a field takes the whole field', async () => {
		const field =
			'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF a</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
			'<w:r><w:t>re</w:t></w:r><w:r><w:t>sult</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
		const {draft} = await open(`<w:p>${run('a')}${field}${run('b')}</w:p>`)
		const last = draft()
		expect(last.remove(2, 3)).toBe(true)
		expect(last.xml()).toBe('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>')
		// The text on either side of a field is not part of it
		const beside = draft()
		expect(beside.remove(0, 1)).toBe(true)
		expect(beside.remove(2, 3)).toBe(true)
		expect(beside.xml()).toBe(`<w:p>${field}</w:p>`)
	})

	test('a page number goes as the one thing it shows as', async () => {
		const page =
			'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
			'<w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
		const {draft, paragraph} = await open(
			`<w:p>${run('Page ')}${page}<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p>`,
		)
		expect(flat(paragraph)).toBe('Page ##')
		const removed = draft()
		expect(removed.remove(5, 6)).toBe(true)
		expect(removed.xml()).toBe(
			'<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p>',
		)
		expect(removed.remove(5, 6)).toBe(true)
		expect(removed.xml()).toBe('<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r></w:p>')
	})
})

describe('inserting', () => {
	test('text goes into the run before the place, and tabs and line breaks become their elements', async () => {
		const {draft, read} = await open(`<w:p>${run('one', '<w:b/>')}${run('two')}</w:p>`)
		const typed = draft()
		expect(typed.insert(3, ' and\tmore\n')).toBe(3)
		expect(typed.xml()).toBe(
			'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>one and</w:t><w:tab/><w:t>more</w:t><w:br/></w:r><w:r><w:t>two</w:t></w:r></w:p>',
		)
		expect(flat(read(typed.xml()))).toBe('one and→more↵two')
	})

	test('where no run encloses the place, the new run takes after its neighbour, else the paragraph mark', async () => {
		const {draft} = await open(
			`<w:p><w:hyperlink r:id="rId1">${run('link', '<w:u w:val="single"/>')}</w:hyperlink>${run('text', '<w:i/>')}</w:p>`,
		)
		const start = draft()
		expect(start.insert(0, 'x')).toBe(0)
		expect(start.xml()).toContain('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>x</w:t></w:r><w:hyperlink')

		const empty = await open('<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p>')
		const filled = empty.draft()
		expect(filled.insert(0, 'x')).toBe(0)
		expect(filled.xml()).toBe(
			'<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>',
		)
	})

	test('formatted differently, it is a run of its own in the middle of the one it divides', async () => {
		const {draft} = await open(`<w:p>${run('onetwo', '<w:i/>')}</w:p>`)
		const typed = draft()
		expect(typed.insert(3, 'X')).toBe(3)
		expect(typed.format(3, 4, {bold: true})).toBe(true)
		expect(typed.xml()).toBe(
			'<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>one</w:t></w:r><w:r><w:rPr><w:b/><w:bCs/><w:i/></w:rPr><w:t>X</w:t></w:r>' +
				'<w:r><w:rPr><w:i/></w:rPr><w:t>two</w:t></w:r></w:p>',
		)
	})
})

describe('formatting', () => {
	test('only the runs in the range change, divided where it starts and ends', async () => {
		const {draft} = await open(`<w:p>${run('one', '<w:rStyle w:val="Strong"/><w:sz w:val="28"/>')}${run('two')}</w:p>`)
		const bold = draft()
		expect(bold.format(1, 4, {bold: true, underline: true})).toBe(true)
		expect(bold.xml()).toBe(
			'<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/><w:sz w:val="28"/></w:rPr><w:t>o</w:t></w:r>' +
				'<w:r><w:rPr><w:rStyle w:val="Strong"/><w:b/><w:bCs/><w:sz w:val="28"/><w:u w:val="single"/></w:rPr><w:t>ne</w:t></w:r>' +
				'<w:r><w:rPr><w:b/><w:bCs/><w:u w:val="single"/></w:rPr><w:t>t</w:t></w:r><w:r><w:t>wo</w:t></w:r></w:p>',
		)
	})

	test('switching off says so, since a style may switch it on', async () => {
		const {draft} = await open(`<w:p>${run('one', '<w:b/><w:u w:val="double"/>')}</w:p>`)
		const plain = draft()
		expect(plain.format(0, 3, {bold: false, underline: false, italic: false})).toBe(true)
		expect(plain.xml()).toBe(
			'<w:p><w:r><w:rPr><w:b w:val="0"/><w:bCs w:val="0"/><w:i w:val="0"/><w:iCs w:val="0"/><w:u w:val="none"/></w:rPr><w:t>one</w:t></w:r></w:p>',
		)
	})

	test('formatting can also just go, leaving the text as its style has it', async () => {
		const {draft} = await open(
			`<w:p>${run('one', '<w:b/><w:bCs/><w:color w:val="FF0000"/><w:u w:val="double"/>')}</w:p>`,
		)
		const plain = draft()
		expect(plain.format(0, 2, {bold: null, underline: null, italic: null})).toBe(true)
		expect(plain.xml()).toBe(
			'<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>on</w:t></w:r>' +
				'<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="FF0000"/><w:u w:val="double"/></w:rPr><w:t>e</w:t></w:r></w:p>',
		)
	})

	test('formatting and then undoing it by hand leaves the runs as one again', async () => {
		const xml = `<w:p>${run('one two')}</w:p>`
		const {draft, read, model} = await open(xml)
		const first = draft()
		first.format(2, 5, {italic: true})
		const again = Draft.read(read(first.xml()), new Map())!
		again.format(2, 5, {italic: false})
		expect(flat(model.derive(again.xml(), body(model)[0]))).toBe('one two')
	})
})

describe('paragraph formatting', () => {
	test('leaving a list the paragraph names itself removes it, with its indent and Word’s list style', async () => {
		const numbering =
			'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
			'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
		const styles =
			'<w:style w:type="paragraph" w:styleId="Listenabsatz"><w:name w:val="List Paragraph"/></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Bullets"><w:name w:val="My Bullets"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>'
		const direct = await open(
			`<w:p><w:pPr><w:pStyle w:val="Listenabsatz"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720"/><w:jc w:val="both"/></w:pPr></w:p>`,
			{numbering, styles},
		)
		expect(direct.paragraph.list).toEqual({numId: 1, ilvl: 0, direct: true, styled: true})
		const left = direct.draft()
		left.unlist(direct.paragraph.list!)
		expect(left.xml()).toBe('<w:p><w:pPr><w:jc w:val="both"/></w:pPr></w:p>')
		expect(direct.read(left.xml()).numbering).toBeUndefined()

		const styled = await open('<w:p><w:pPr><w:pStyle w:val="Bullets"/></w:pPr></w:p>', {numbering, styles})
		expect(styled.paragraph.list).toEqual({numId: 1, ilvl: 0, direct: false, styled: false})
		const off = styled.draft()
		off.unlist(styled.paragraph.list!)
		expect(off.xml()).toBe(
			'<w:p><w:pPr><w:pStyle w:val="Bullets"/><w:numPr><w:numId w:val="0"/></w:numPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:p>',
		)
		expect(styled.read(off.xml()).numbering).toBeUndefined()
	})

	test('properties go in the order the schema wants', async () => {
		const {draft} = await open(
			'<w:p><w:pPr><w:pStyle w:val="a"/><w:spacing w:after="0"/><w:rPr><w:b/></w:rPr></w:pPr></w:p>',
		)
		const centred = draft()
		centred.align('center')
		centred.relevel({numId: 4, ilvl: 0, direct: true, styled: false}, 2)
		expect(centred.xml()).toBe(
			'<w:p><w:pPr><w:pStyle w:val="a"/><w:numPr><w:ilvl w:val="2"/><w:numId w:val="4"/></w:numPr><w:spacing w:after="0"/>' +
				'<w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr></w:p>',
		)
	})
})

describe('the model after a rewrite', () => {
	test('lists count again once paragraphs come and go', async () => {
		const numbering =
			'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
			'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
		const item = (text: string) =>
			`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`
		const model = await load(docx(item('one two') + item('three'), {numbering}))
		const blocks = model.sections[0].blocks
		const [first, second] = body(model)
		expect([first.numbering?.label, second.numbering?.label]).toEqual(['1.', '2.'])

		const head = Draft.read(first, new Map())!
		const tail = head.split(4)!
		const derived = [model.derive(head.xml(), first), model.derive(tail.xml(), first)]
		expect(derived.map((paragraph) => paragraph.origin)).toEqual([first, first])
		blocks.splice(0, 1, ...derived)
		// The paragraphs that were read again have their labels now, and the one after them a new one
		expect(model.renumber()).toEqual([derived[0], derived[1], second])
		expect(body(model).map((paragraph) => paragraph.numbering?.label)).toEqual(['1.', '2.', '3.'])
		expect(model.renumber()).toEqual([])
		// What was read again can be read again in turn
		expect(model.derive(tail.xml(), derived[1]).origin).toBe(first)
	})

	test('a heading names the style that follows it', async () => {
		const styles =
			'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:next w:val="Normal"/></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:next w:val="Quote"/></w:style>'
		const model = await load(
			docx(
				'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr></w:p><w:p/>',
				{styles},
			),
		)
		expect(body(model).map((paragraph) => paragraph.next)).toEqual(['Normal', undefined, undefined])
	})
})

describe('fixtures', () => {
	const openable = WORD_FIXTURES.filter((path) => !/encrypted|doctype/.test(path))

	// Taking a paragraph apart and writing it again must not change what it is, and each edit must change only what it
	// says: the flat text before and after tells
	test.skipIf(!openable.length)('every paragraph survives being rewritten', {timeout: 900000}, async () => {
		let rewritten = 0
		let skipped = 0
		let refused = 0
		for (const path of openable) {
			const model = await load(fixture(path))
			for (const paragraph of body(model)) {
				const fresh = () => Draft.read(paragraph, new Map())
				const reread = (draft: Draft) => {
					const xml = draft.xml()
					parseXml(xml)
					return model.derive(xml, paragraph)
				}
				const draft = fresh()
				if (!draft) {
					skipped++
					continue
				}
				rewritten++
				const before = flat(paragraph)
				const length = before.length
				expect(draft.length, path).toBe(length)
				expect(flat(reread(draft)), path).toBe(before)

				const places = [...new Set([0, 1, length >> 1, length - 1, length])].filter((at) => at >= 0 && at <= length)
				for (const at of places) {
					// Divided and joined again, it reads the same
					const head = fresh()!
					const tail = head.split(at)
					if (!tail) {
						refused++
						continue
					}
					const parts = [reread(head), reread(tail)]
					expect(parts.map(flat).join(''), `${path} split ${at}`).toBe(before)
					const joined = Draft.read(parts[0], new Map())!
					joined.append(Draft.read(parts[1], new Map())!)
					expect(flat(reread(joined)), `${path} join ${at}`).toBe(before)

					// Text goes in where it's put, or just outside the field it was put in (and shows, unless the paragraph's
					// style hides its text)
					const typed = fresh()!
					if (paragraph.mark.vanish) continue
					const where = typed.insert(at, 'Zz\tq')
					if (where !== undefined) {
						const after = flat(reread(typed))
						expect(after.slice(where, where + 4), `${path} insert ${at}`).toBe('Zz→q')
						expect(after.slice(0, where) + after.slice(where + 4), `${path} insert ${at}`).toBe(before)
					} else refused++
				}
				for (const from of places) {
					for (const to of places) {
						if (from >= to) continue
						// What's removed is the range, widened at most to whole fields
						const removed = fresh()!
						if (removed.remove(from, to)) {
							const after = flat(reread(removed))
							let fits = false
							for (let start = Math.min(from, after.length); start >= 0 && !fits; start--) {
								const rest = after.length - start
								fits =
									after.slice(0, start) === before.slice(0, start) &&
									rest <= length - to &&
									before.endsWith(after.slice(start))
							}
							expect(fits, `${path} remove ${from}-${to}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toBe(
								true,
							)
						} else refused++
						// Formatting moves nothing
						const bold = fresh()!
						if (bold.format(from, to, {bold: true, underline: false}))
							expect(flat(reread(bold)), `${path} format ${from}-${to}`).toBe(before)
						else refused++
					}
				}
			}
		}
		console.info(`rewrote ${rewritten} paragraphs, left ${skipped} alone, refused ${refused} edits`)
	})
})
