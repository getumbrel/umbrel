import {describe, expect, test} from 'vitest'

import {fontStack} from '@/features/files/components/file-viewer/shared/fonts'

import {buildModel, type Block, type DocumentModel, type Inline, type Paragraph, type Table} from './model'
import {DocxError, DocxPackage} from './package'
import {docx, fixture, hasFixture, PNG, structures, WORD_FIXTURES, zip} from './test-helpers'

const open = (bytes: Uint8Array) => buildModel(DocxPackage.open(bytes))

function paragraphs(blocks: Block[]): Paragraph[] {
	return blocks.flatMap((block) =>
		block.kind === 'paragraph'
			? [block]
			: block.rows.flatMap((row) => row.cells.flatMap((cell) => paragraphs(cell.blocks))),
	)
}
const all = (model: DocumentModel) => model.sections.flatMap((section) => paragraphs(section.blocks))
const text = (p: Paragraph) =>
	p.inlines.map((inline) => (inline.kind === 'text' ? inline.text : inline.kind === 'tab' ? '\t' : '')).join('')
const find = (model: DocumentModel, needle: string) => all(model).find((p) => text(p).includes(needle))!
const tables = (blocks: Block[]): Table[] =>
	blocks.flatMap((block) =>
		block.kind === 'table'
			? [block, ...block.rows.flatMap((row) => row.cells.flatMap((cell) => tables(cell.blocks)))]
			: [],
	)
const textRuns = (p: Paragraph) =>
	p.inlines.filter((inline): inline is Extract<Inline, {kind: 'text'}> => inline.kind === 'text')

async function failure(promise: Promise<unknown>): Promise<DocxError> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(DocxError)
		return error as DocxError
	}
	throw new Error('Expected a DocxError')
}

// The corpus takes seconds to open on a busy machine (the 12 MB document's own limit is its assertion)
describe('fixtures', {timeout: 60000}, () => {
	const failing: Record<string, string> = {
		'Samples2/Word/encrypted-password-pass-poi.docx': 'encrypted',
		'Samples2/Word/hostile-xxe-doctype-poi.docx': 'corrupt',
	}

	test.skipIf(!WORD_FIXTURES.length)(
		'every Word fixture opens, or fails with the error it should',
		{timeout: 60000},
		async () => {
			for (const path of WORD_FIXTURES) {
				if (failing[path]) {
					const error = await failure((async () => open(fixture(path)))())
					expect(error.code, path).toBe(failing[path])
					continue
				}
				const model = await open(fixture(path))
				expect(model.sections.length, path).toBeGreaterThan(0)
				expect(all(model).length, path).toBeGreaterThan(0)
			}
		},
	)

	test.skipIf(!hasFixture('Samples2/Word/features.docx'))(
		'features.docx: styles, lists, tables, images, notes, sections',
		async () => {
			const model = await open(fixture('Samples2/Word/features.docx'))
			const theme = model.theme

			// Title and headings come from styles with theme fonts and colours
			const title = find(model, 'Feature tour')
			expect(title.styleId).toBe('Title')
			expect(textRuns(title)[0].style.size).toBe(52)
			expect(textRuns(title)[0].style.fontAscii).toEqual({theme: 'majorHAnsi'})
			expect(theme?.major.latin).toBe('Calibri')
			expect(theme?.minor.latin).toBe('Cambria')
			expect(title.props.borders?.bottom).toMatchObject({style: 'solid', color: '#4f81bd'})
			const heading = find(model, '1. Text formatting')
			expect(heading.styleId).toBe('Heading1')
			expect(textRuns(heading)[0].style).toMatchObject({bold: true, color: '#365f91', size: 28})
			expect(heading.props).toMatchObject({keepNext: true, keepLines: true})
			expect(heading.props.spacing?.before).toBeCloseTo(32)

			// Run formatting
			const formats = find(model, 'Runs can be')
			const run = (needle: string) => textRuns(formats).find((inline) => inline.text === needle)!.style
			expect(run('bold').bold).toBe(true)
			expect(run('italic').italic).toBe(true)
			expect(run('double underlined').underline).toBe('double')
			expect(run('wavy').underline).toBe('wave')
			expect(run('struck through').strike).toBe(true)
			expect(run('double struck').dstrike).toBe(true)
			expect(run('Small Caps').smallCaps).toBe(true)
			expect(run('all caps').caps).toBe(true)
			expect(run('red').color).toBe('#c00000')
			expect(run('highlighted').highlight).toBe('#ffff00')
			expect(run('larger').size).toBe(32)
			expect(
				textRuns(formats)
					.filter((inline) => inline.text === '2')
					.map((inline) => inline.style.vertAlign),
			).toEqual(['subscript', 'superscript'])
			expect(formats.inlines.find((inline) => inline.kind === 'note')).toMatchObject({label: '1', footnote: '1'})

			// Paragraph formatting
			expect(find(model, 'Centered.').props.align).toBe('center')
			expect(find(model, 'Justified:').props.align).toBe('both')
			expect(find(model, 'First-line indent').props.indent).toMatchObject({firstLine: 48})
			expect(find(model, 'First-line indent').props.spacing).toMatchObject({line: 360, lineRule: 'auto'})
			expect(find(model, 'Hanging indent').props.indent).toEqual({left: 96, hanging: 48})
			expect(find(model, 'Chapter one').props.tabs).toEqual([{pos: 576, align: 'right', leader: 'dot'}])
			expect(find(model, 'مرحبا').props.bidi).toBe(true)

			// Lists: bullets mapped out of the Symbol font, separate lists counting on their own
			const labels = (needle: string) =>
				all(model)
					.filter((p) => text(p).includes(needle))
					.map((p) => p.numbering?.label)
			expect(labels('Bulleted item')).toEqual(['•', '•'])
			expect(labels('Numbered step')).toEqual(['1.', '2.', '3.'])
			expect(labels('Sub-step')).toEqual(['1.', '2.'])
			expect(find(model, 'Nested deeper').numbering?.label).toBe('•')
			expect(find(model, 'Bulleted item one').props.indent).toEqual({left: 24, hanging: 24})

			// Tables: grid, merges, shading, styles
			const [grid, outer, inner, wide] = tables(model.sections.flatMap((section) => section.blocks))
			expect(grid.grid).toEqual([144, 144, 144, 144])
			expect(grid.props.align).toBe('center')
			expect(grid.rows[0].cells[0].props.shading).toBe('#1f4e79')
			const header = paragraphs(grid.rows[0].cells[0].blocks)[0]
			expect(textRuns(header)[0].style).toMatchObject({bold: true, color: '#ffffff'})
			expect(grid.rows[2].cells[3].rowSpan).toBe(3)
			expect(grid.rows[4].cells[1].span).toBe(2)
			expect(grid.rows[0].cells[0].borders.top).toMatchObject({style: 'solid'})
			// Light Grid Accent 1: the header row is bold through the table style's conditional formatting
			expect(textRuns(paragraphs(outer.rows[0].cells[0].blocks)[0])[0].style.bold).toBe(true)
			expect(textRuns(paragraphs(outer.rows[1].cells[0].blocks)[0])[0].style.bold).toBe(true)
			expect(outer.rows[1].cells[1].props.shading).toBe('#d3dfee')
			expect(inner.rows).toHaveLength(2)
			expect(wide.grid).toHaveLength(9)

			// Images: three, inline, at their extents
			expect(model.images.size).toBe(3)
			const graphics = all(model).flatMap((p) => p.inlines.filter((inline) => inline.kind === 'graphic'))
			expect(graphics.map((inline) => inline.kind === 'graphic' && inline.content.kind)).toEqual([
				'image',
				'image',
				'image',
			])
			expect(graphics[0].kind === 'graphic' && graphics[0].content.width).toBeCloseTo(480)

			// Hyperlinks: http kept, javascript: dropped
			const links = textRuns(find(model, 'External link')).filter((inline) => inline.link)
			expect(links.map((inline) => [inline.text, inline.link?.href])).toEqual([
				['umbrel.com', 'https://umbrel.com/'],
				['hostile link', undefined],
			])

			// Footnotes, headers, footers, sections
			expect([...model.footnotes.keys()]).toEqual(['1', '2'])
			expect(model.separator?.length).toBe(1)
			expect(model.sections).toHaveLength(3)
			const [first, landscape, columns] = model.sections
			expect(first.titlePage).toBe(true)
			expect(first.headers.first && first.headers.default).toBeTruthy()
			const footer = paragraphs(first.footers.default!.blocks)[0]
			expect(
				footer.inlines
					.filter((inline) => inline.kind === 'field')
					.map((inline) => inline.kind === 'field' && inline.field),
			).toEqual(['page', 'numpages'])
			expect([landscape.pageWidth, landscape.pageHeight]).toEqual([1056, 816])
			expect(landscape.headers).toEqual(first.headers)
			expect(columns.columns).toMatchObject({count: 2, space: 48})
			expect(first.margins).toMatchObject({top: 96, left: 120, header: 48})
		},
	)

	test.skipIf(!hasFixture('Samples2/Word/numbered-lists-complex-poi.docx'))(
		'numbered-lists-complex-poi.docx: restarts, levels and continued lists',
		async () => {
			const model = await open(fixture('Samples2/Word/numbered-lists-complex-poi.docx'))
			const numbered = all(model)
				.filter((p) => p.numbering)
				.map((p) => [p.numbering!.label, text(p)])
			expect(numbered).toEqual([
				['1.', 'Entry #1'],
				['2.', 'Entry #2, with children'],
				['a.', '2-a'],
				['b.', '2-b'],
				['c.', '2-c'],
				['3.', 'Entry #3'],
				['4.', 'Entry #4'],
				['1.', 'Restarted to 1 from 5'],
				['2.', 'Restarted @ 2'],
				['3.', 'Restarted @ 3'],
				['10.', 'Jump to new list at 10'],
				['11.', 'Now 11'],
				['12.', 'Carrying on @ 12'],
				['13.', 'Carrying on @ 13'],
			])
		},
	)

	test.skipIf(!hasFixture('Samples2/Word/tracked-changes-generated.docx'))(
		'tracked-changes-generated.docx: the final view',
		async () => {
			const model = await open(fixture('Samples2/Word/tracked-changes-generated.docx'))
			const shown = all(model)
				.filter((p) => !p.hidden)
				.map(text)
			// Each paragraph states its accepted text in brackets
			const stated = shown.filter((t) => t.includes('[after: '))
			expect(stated).toHaveLength(3)
			for (const line of stated) expect(line.slice(0, line.indexOf(' [after:'))).toBe(/\[after: (.*)\]/.exec(line)![1])
			expect(shown).toContain('This entire paragraph was inserted.')
			expect(all(model).find((p) => text(p) === '' && p.hidden)).toBeTruthy()
			expect(shown.some((t) => t.includes('deleted.'))).toBe(false)
			expect(shown).toContain('Budget: $14,500 (changed by a second author).')
			expect(textRuns(find(model, 'made bold')).find((inline) => inline.text === 'made bold')?.style.bold).toBe(true)
			expect(model.settings.protection).toBe('tracked')
		},
	)

	test.skipIf(!hasFixture('Samples/Word/comprehensive-word.docx'))(
		'comprehensive-word.docx: fields, notes, literal tabs, symbols, sections',
		async () => {
			const model = await open(fixture('Samples/Word/comprehensive-word.docx'))
			expect(model.sections.map((section) => section.columns.count)).toEqual([1, 1, 2, 1, 1])
			expect(model.sections[3].pageWidth).toBeGreaterThan(model.sections[3].pageHeight)
			// A tab character inside a w:t is a tab, and keeps its w:t
			const header = paragraphs(model.sections[1].headers.default!.blocks)[0]
			expect(text(header)).toBe('Comprehensive Word Element Test v2\tCONFIDENTIAL')
			// Fields: computed page numbers, and the cached result of anything else
			const pageField = find(model, 'PAGE:')
			expect(pageField.inlines.some((inline) => inline.kind === 'field' && inline.field === 'page')).toBe(true)
			expect(
				find(model, 'NUMPAGES:').inlines.some((inline) => inline.kind === 'field' && inline.field === 'numpages'),
			).toBe(true)
			// Footnotes are numbered in reference order; endnotes collect at the end in lower Roman
			expect(model.footnotes.size).toBe(3)
			expect(model.endnotes.length).toBeGreaterThan(0)
			const endnoteMarks = all(model).flatMap((p) =>
				p.inlines.filter((inline) => inline.kind === 'note' && !inline.footnote),
			)
			expect(endnoteMarks.map((inline) => inline.kind === 'note' && inline.label)).toEqual(['i', 'ii'])
			// Checkbox symbols drawn from MS Gothic code points render as the characters themselves
			expect(text(find(model, 'Task completed'))).toContain('☒')
			// Equations show their text
			expect(text(find(model, 'Quadratic formula'))).toContain('x = -b ± b² - 4ac2a')
		},
	)

	test.skipIf(!hasFixture('Samples2/Word/hostile-external-image-link.docx'))(
		'hostile-external-image-link.docx: a linked picture is never fetched',
		async () => {
			const model = await open(fixture('Samples2/Word/hostile-external-image-link.docx'))
			expect(model.images.size).toBe(0)
			const graphics = all(model).flatMap((p) => p.inlines.filter((inline) => inline.kind === 'graphic'))
			expect(graphics.map((inline) => inline.kind === 'graphic' && inline.content.kind)).toEqual(['placeholder'])
		},
	)

	test.skipIf(!hasFixture('Samples/Word/zz-css-injection.docx'))(
		'zz-css-injection.docx: a hostile font name stays one quoted family',
		async () => {
			const model = await open(fixture('Samples/Word/zz-css-injection.docx'))
			const names = new Set(all(model).flatMap((p) => textRuns(p).map((inline) => inline.style.fontAscii)))
			const hostile = [...names].find((name) => typeof name === 'string' && name.includes('}'))
			expect(hostile).toBe(
				'Arial;}body{background-image:url(https://css-beacon.example.invalid/opened.png)}.x{color:red',
			)
			expect(fontStack([hostile as string])).toBe(
				'"Arial;}body{background-image:url(https://css-beacon.example.invalid/opened.png)}.x{color:red", sans-serif',
			)
		},
	)

	test.skipIf(!hasFixture('Samples/Word/bug65649.docx'))('bug65649.docx: a 12 MB document builds quickly', async () => {
		const started = performance.now()
		const model = await open(fixture('Samples/Word/bug65649.docx'))
		const elapsed = performance.now() - started
		console.log(
			`bug65649.docx model: ${elapsed.toFixed(0)} ms, ${all(model).length} paragraphs, ${model.refs.length} editable runs`,
		)
		expect(all(model).length).toBeGreaterThan(14000)
		expect(elapsed).toBeLessThan(5000)
	})
})

describe('formatting cascade', () => {
	const styles =
		'<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>' +
		'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:line="259" w:lineRule="auto"/></w:pPr></w:style>' +
		'<w:style w:type="paragraph" w:styleId="Quote"><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="864"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>' +
		'<w:style w:type="paragraph" w:styleId="Loud"><w:basedOn w:val="Quote"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
		'<w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:i/></w:rPr></w:style>' +
		'<w:style w:type="paragraph" w:styleId="LoopA"><w:basedOn w:val="LoopB"/><w:rPr><w:b/></w:rPr></w:style>' +
		'<w:style w:type="paragraph" w:styleId="LoopB"><w:basedOn w:val="LoopA"/><w:rPr><w:i/></w:rPr></w:style>' +
		'<w:style w:type="table" w:styleId="Grid"><w:pPr><w:spacing w:after="0"/></w:pPr><w:tblPr><w:tblBorders><w:insideH w:val="single" w:sz="4" w:color="FF0000"/></w:tblBorders></w:tblPr>' +
		'<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:val="clear" w:fill="00FF00"/></w:tcPr></w:tblStylePr></w:style>'

	test('defaults, basedOn chains and direct formatting apply in order', async () => {
		const model = await open(
			docx(
				'<w:p><w:pPr><w:pStyle w:val="Loud"/><w:ind w:firstLine="240"/></w:pPr><w:r><w:t>loud</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:sz w:val="20"/></w:rPr><w:t>quiet</w:t></w:r></w:p>',
				{styles},
			),
		)
		const p = find(model, 'loud')
		expect(p.props.indent).toEqual({left: 57.6, firstLine: 16})
		expect(p.props.spacing).toMatchObject({after: 160 / 15, line: 259})
		expect(textRuns(p).map((run) => [run.style.bold, run.style.italic, run.style.size, run.style.color])).toEqual([
			[true, true, 28, '#404040'],
			[false, true, 20, '#404040'],
		])
	})

	test("theme colours are the theme's, through the document's colour mapping, lighter or darker as Word makes them", async () => {
		const theme =
			'<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="t">' +
			'<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
			'<a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'
		const run = (color: string, text: string) =>
			`<w:r><w:rPr><w:color w:val="auto" ${color}/></w:rPr><w:t xml:space="preserve">${text} </w:t></w:r>`
		const model = await open(
			docx(
				`<w:p>${run('w:themeColor="accent1" w:themeShade="BF"', 'darker')}${run('w:themeColor="accent1" w:themeTint="66"', 'lighter')}` +
					`${run('w:themeColor="text1"', 'text')}${run('w:themeColor="background1"', 'background')}</w:p>` +
					'<w:p><w:pPr><w:shd w:val="clear" w:fill="auto" w:themeFill="accent1" w:themeFillTint="33"/></w:pPr><w:r><w:t>shaded</w:t></w:r></w:p>',
				{
					// Light text on dark: text1 is light1 and background1 dark1
					settings: '<w:clrSchemeMapping w:bg1="dark1" w:t1="light1" w:bg2="light2" w:t2="dark2"/>',
					parts: {'word/theme/theme1.xml': theme},
					rels: [{id: 'rIdTheme', type: 'theme', target: 'theme/theme1.xml'}],
				},
			),
		)
		// Accent 1, darker 25% and lighter 60%, as Word's colour picker writes them
		expect(textRuns(find(model, 'darker')).map((run) => run.style.color)).toEqual([
			'#2f5496',
			'#b4c7e7',
			'#ffffff',
			'#000000',
		])
		expect(find(model, 'shaded').props.shading).toBe('#dae3f3')
	})

	test('a character style toggles what the paragraph style turns on, direct formatting sets it outright', async () => {
		const model = await open(
			docx(
				'<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>' +
					'<w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>upright</w:t></w:r>' +
					'<w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>' +
					'<w:p><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>emphasised</w:t></w:r></w:p>',
				{styles},
			),
		)
		expect(textRuns(find(model, 'upright')).map((run) => run.style.italic)).toEqual([false, true])
		expect(textRuns(find(model, 'emphasised'))[0].style.italic).toBe(true)
	})

	test('basedOn cycles end instead of looping', async () => {
		const model = await open(
			docx('<w:p><w:pPr><w:pStyle w:val="LoopA"/></w:pPr><w:r><w:t>loop</w:t></w:r></w:p>', {styles}),
		)
		expect(textRuns(find(model, 'loop'))[0].style).toMatchObject({bold: true, italic: true})
	})

	test('table styles: whole-table and conditional formatting, and the default paragraph style quirk', async () => {
		const row = (text: string) => `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`
		const model = await open(
			docx(
				`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${row('head')}${row('body')}</w:tbl>`,
				{styles},
			),
		)
		const [table] = tables(model.sections[0].blocks)
		const [head, body] = table.rows.map((r) => paragraphs(r.cells[0].blocks)[0])
		expect(textRuns(head)[0].style.bold).toBe(true)
		expect(textRuns(body)[0].style.bold).toBeUndefined()
		expect(table.rows[0].cells[0].props.shading).toBe('#00ff00')
		expect(table.rows[0].cells[0].borders.bottom).toMatchObject({color: '#ff0000'})
		// The table style's spacing outranks the default paragraph style
		expect(body.props.spacing?.after).toBe(0)
	})

	test('on/off values: "0", "false" and "off" all mean off', async () => {
		const model = await open(
			docx(
				'<w:p><w:r><w:rPr><w:b w:val="false"/><w:i w:val="off"/><w:strike w:val="0"/><w:caps w:val="1"/><w:smallCaps w:val="true"/></w:rPr><w:t>flags</w:t></w:r></w:p>',
			),
		)
		expect(textRuns(find(model, 'flags'))[0].style).toMatchObject({
			bold: false,
			italic: false,
			strike: false,
			caps: true,
			smallCaps: true,
		})
	})
})

describe('numbering', () => {
	const level = (ilvl: number, format: string, text: string, extra = '') =>
		`<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/>${extra}<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
	const numbering =
		`<w:abstractNum w:abstractNumId="0">${level(0, 'decimal', '%1.')}${level(1, 'lowerLetter', '%1.%2)')}${level(2, 'upperRoman', '%1.%2.%3', '<w:isLgl/>')}</w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="1"><w:numStyleLink w:val="Linked"/></w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="2"><w:styleLink w:val="Linked"/>${level(0, 'upperLetter', '(%1)')}</w:abstractNum>` +
		'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
		'<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>' +
		'<w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num>' +
		'<w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>' +
		'<w:num w:numId="5"><w:abstractNumId w:val="2"/></w:num>'
	const styles =
		'<w:style w:type="numbering" w:styleId="Linked"><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>'
	const item = (numId: number, ilvl: number, text: string) =>
		`<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

	test('levels, restarts, overrides, shared and linked definitions', async () => {
		const model = await open(
			docx(
				[
					item(1, 0, 'one'),
					item(1, 1, 'one-a'),
					item(1, 2, 'one-a-i'),
					item(1, 1, 'one-b'),
					item(1, 0, 'two'),
					item(1, 1, 'two-a'),
					// Another instance of the same definition carries on counting…
					item(3, 0, 'three'),
					// …unless it overrides the start, which restarts it where it's first used
					item(2, 0, 'seven'),
					item(2, 0, 'eight'),
					// A definition linked through a numbering style uses the linked levels
					item(4, 0, 'linked'),
					item(4, 0, 'linked again'),
					'<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>none</w:t></w:r></w:p>',
				].join(''),
				{numbering, styles},
			),
		)
		const labels = all(model).map((p) => [text(p), p.numbering?.label])
		expect(labels).toEqual([
			['one', '1.'],
			['one-a', '1.a)'],
			// Legal numbering shows every level in decimal
			['one-a-i', '1.1.1'],
			['one-b', '1.b)'],
			['two', '2.'],
			['two-a', '2.a)'],
			['three', '3.'],
			['seven', '7.'],
			['eight', '8.'],
			['linked', '(A)'],
			['linked again', '(B)'],
			['none', undefined],
		])
		expect(find(model, 'one-a').props.indent).toEqual({left: 96, hanging: 24})
	})
})

describe('text and fields', () => {
	test('whitespace is trimmed unless preserved, and tab characters become tabs of the same w:t', async () => {
		const model = await open(
			docx(
				'<w:p><w:r><w:t>  trimmed  </w:t><w:t xml:space="preserve"> kept </w:t><w:t xml:space="preserve">a\tb</w:t></w:r></w:p>',
			),
		)
		const p = all(model)[0]
		expect(text(p)).toBe('trimmed kept a\tb')
		const tab = p.inlines.find((inline) => inline.kind === 'tab')
		expect(tab && tab.kind === 'tab' && tab.ref).toBe(model.refs[2])
		expect(model.refs.map((ref) => ref.text)).toEqual(['trimmed', ' kept ', 'a\tb'])
	})

	test('complex and simple fields: page numbers computed, other results kept, instructions hidden', async () => {
		const field = (instruction: string, result: string) =>
			`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
		const model = await open(
			docx(
				`<w:p>${field('PAGE \\* ROMAN', '9')}<w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>99</w:t></w:r></w:fldSimple></w:p>` +
					`<w:p>${field('DATE \\@ "d MMMM yyyy"', '1 October 2026')}</w:p>` +
					`<w:p>${field('HYPERLINK "https://example.com/a" \\o "tip"', 'linked')}${field('HYPERLINK "javascript:alert(1)"', 'unsafe')}</w:p>` +
					// A field whose instruction holds another field, and one never closed
					`<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>IF </w:instrText></w:r>${field('PAGE', '1')}<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>outer</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>` +
					'<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>stray end</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:t>unclosed</w:t></w:r></w:p>',
			),
		)
		const [pages, date, links, nested, broken] = all(model)
		expect(
			pages.inlines.map((inline) =>
				inline.kind === 'field' ? `[${inline.field}:${inline.format}]` : inline.kind === 'text' ? inline.text : '',
			),
		).toEqual(['[page:upperRoman]', ' of ', '[numpages:]'])
		expect(text(date)).toBe('1 October 2026')
		// Field results are Word's to regenerate, not ours to edit
		expect(textRuns(date)[0].ref).toBeUndefined()
		expect(textRuns(links).map((run) => [run.text, run.link?.href, run.link?.tooltip])).toEqual([
			['linked', 'https://example.com/a', 'tip'],
			['unsafe', undefined, undefined],
		])
		expect(text(nested)).toBe('outer after')
		expect(text(broken)).toBe('stray end')
	})

	test('symbols, hyphens, breaks, and text in revisions and content controls', async () => {
		const model = await open(
			docx(
				'<w:p><w:r><w:sym w:font="Symbol" w:char="F061"/><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t><w:softHyphen/><w:br/><w:t>c</w:t></w:r>' +
					'<w:ins><w:r><w:t>+in</w:t></w:r></w:ins><w:del><w:r><w:delText>-out</w:delText></w:r></w:del><w:moveFrom><w:r><w:t>moved</w:t></w:r></w:moveFrom>' +
					'<w:sdt><w:sdtContent><w:r><w:t>+sdt</w:t></w:r></w:sdtContent></w:sdt><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r></w:p>',
			),
		)
		const p = all(model)[0]
		expect(text(p)).toBe('α✓a\u2011b\u00adc+in+sdt')
		expect(p.inlines.filter((inline) => inline.kind === 'break')).toHaveLength(1)
		expect(model.refs.map((ref) => ref.text)).toEqual(['a', 'b', 'c', '+in', '+sdt'])
	})

	test('a paragraph whose mark is deleted or hidden, with nothing showing, is laid out as nothing', async () => {
		const model = await open(
			docx(
				'<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
					'<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p><w:p/>',
			),
		)
		expect(all(model).map((p) => p.hidden)).toEqual([true, true, false])
	})
})

describe('drawings', () => {
	const inline = (embed: string, extra = '') =>
		`<w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="p" descr="A chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip ${embed}/>${extra}</pic:blipFill><pic:spPr><a:xfrm rot="5400000"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`

	test('inline pictures, crops, linked pictures, anchors and shapes', async () => {
		const model = await open(
			docx(
				`<w:p><w:r>${inline('r:embed="rIdImg"', '<a:srcRect l="10000" t="0" r="10000" b="20000"/>')}</w:r><w:r>${inline('r:link="rIdOut"')}</w:r></w:p>` +
					'<w:p><w:r><w:drawing><wp:anchor behindDoc="1" distL="114300"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>95250</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="s"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="FF0000"><a:lumMod val="50000"/></a:srgbClr></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>' +
					'<w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hr="t" fillcolor="#aca899"/></w:pict></w:r></w:p>',
				{
					parts: {'word/media/image1.png': PNG},
					rels: [
						{id: 'rIdImg', type: 'image', target: 'media/image1.png'},
						{id: 'rIdOut', type: 'image', target: 'https://example.com/pixel.png', external: true},
					],
				},
			),
		)
		const [pictures, anchored, rule] = all(model)
		const [picture, linked] = pictures.inlines
		expect(picture.kind === 'graphic' && picture.content).toEqual({
			kind: 'image',
			part: 'word/media/image1.png',
			width: 100,
			height: 50,
			alt: 'A chart',
			crop: {left: 0.1, top: 0, right: 0.1, bottom: 0.2},
			rotation: 90,
			flipH: undefined,
			flipV: undefined,
		})
		expect(linked.kind === 'graphic' && linked.content.kind).toBe('placeholder')
		expect([...model.images]).toEqual(['word/media/image1.png'])
		const anchor = anchored.inlines[0]
		expect(anchor.kind).toBe('anchor')
		if (anchor.kind !== 'anchor') return
		expect(anchor.object).toMatchObject({
			wrap: 'square',
			behind: true,
			x: {from: 'page', align: 'center'},
			y: {from: 'paragraph', offset: 10},
		})
		expect(anchor.object.distance.left).toBeCloseTo(12)
		const shape = anchor.object.content
		expect(shape).toMatchObject({kind: 'shape', geometry: 'ellipse', fill: '#800000', line: {color: '#0000ff'}})
		expect(shape.kind === 'shape' && shape.blocks && text(paragraphs(shape.blocks)[0])).toBe('boxed')
		// Text box content isn't editable: Word keeps another copy of it in the VML fallback
		expect(model.refs.map((ref) => ref.text)).toEqual([])
		expect(rule.inlines[0]).toMatchObject({kind: 'rule', height: 2, color: '#aca899', align: 'center', width: 1})
	})

	test("a picture's target with a fragment still names its part", async () => {
		const model = await open(
			docx(`<w:p><w:r>${inline('r:embed="rIdImg"')}</w:r></w:p>`, {
				parts: {'word/media/image1.png': PNG},
				rels: [{id: 'rIdImg', type: 'image', target: 'media/image1.png#frame'}],
			}),
		)
		expect([...model.images]).toEqual(['word/media/image1.png'])
	})

	test("a shape's colours come out as Office's palette has them", async () => {
		const shape = (spPr: string, style = '') =>
			`<w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/><wp:wrapNone/><wp:docPr id="2" name="s"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:prstGeom prst="rect"/>${spPr}</wps:spPr>${style}</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`
		const theme =
			'<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'
		const model = await open(
			docx(
				// Accent 1, darker 25%; the theme's fill style from a reference, Accent 1 lighter 40% at half opacity; a
				// preset colour by its DrawingML name
				shape('<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>') +
					shape(
						'',
						'<wps:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/><a:alpha val="50000"/></a:schemeClr></a:fillRef></wps:style>',
					) +
					shape('<a:solidFill><a:prstClr val="dkBlue"/></a:solidFill>'),
				{parts: {'word/theme/theme1.xml': theme}, rels: [{id: 'rIdTheme', type: 'theme', target: 'theme/theme1.xml'}]},
			),
		)
		const fills = all(model).map((p) => {
			const anchor = p.inlines[0]
			const content = anchor.kind === 'anchor' ? anchor.object.content : undefined
			return content?.kind === 'shape' ? [content.fill, content.opacity] : undefined
		})
		expect(fills).toEqual([
			['#2f5597', undefined],
			['#8faadc', 0.5],
			['#00008b', undefined],
		])
	})

	test('a VML colour can be any CSS name', async () => {
		const model = await open(
			docx(
				'<w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hr="t" fillcolor="navy"/></w:pict></w:r></w:p>',
			),
		)
		expect(all(model)[0].inlines[0]).toMatchObject({kind: 'rule', color: '#000080'})
	})

	test('alternate content: the choice we understand, else the fallback', async () => {
		const model = await open(
			docx(
				'<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>choice</w:t></mc:Choice><mc:Fallback><w:t>fallback</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>' +
					'<w:p xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><w:r><mc:AlternateContent><mc:Choice Requires="cx"><w:t>chartex</w:t></mc:Choice><mc:Fallback><w:t>picture</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>',
			),
		)
		expect(all(model).map(text)).toEqual(['choice', 'picture'])
	})
})

describe('protection', () => {
	test('Track Changes, or editing restricted and enforced, ask for the text to be left as it is', async () => {
		const protection = async (settings?: string) => (await open(docx('<w:p/>', {settings}))).settings.protection
		const restricted = (edit: string, enforcement?: string) =>
			protection(
				`<w:documentProtection w:edit="${edit}"${enforcement === undefined ? '' : ` w:enforcement="${enforcement}"`}/>`,
			)
		expect(await protection()).toBeUndefined()
		expect(await protection('<w:trackRevisions/>')).toBe('tracked')
		expect(await protection('<w:trackRevisions w:val="false"/>')).toBeUndefined()
		for (const edit of ['readOnly', 'comments', 'forms']) expect(await restricted(edit, '1'), edit).toBe('protected')
		expect(await restricted('trackedChanges', 'true')).toBe('tracked')
		// Not enforced, or restricting nothing, it's only a setting
		expect(await restricted('readOnly', '0')).toBeUndefined()
		expect(await restricted('readOnly')).toBeUndefined()
		expect(await restricted('none', 'on')).toBeUndefined()
		// Restricted is what it says, with or without tracking
		expect(await protection('<w:trackRevisions/><w:documentProtection w:edit="readOnly" w:enforcement="1"/>')).toBe(
			'protected',
		)
	})
})

describe('hostile and broken files', {timeout: 60000}, () => {
	test('not a zip, a legacy .doc, a password-protected file', async () => {
		expect((await failure((async () => open(new TextEncoder().encode('just text')))())).code).toBe('corrupt')
		const cfb = new Uint8Array(1024)
		cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
		expect((await failure((async () => open(cfb))())).code).toBe('unsupported')
		// Only a directory entry named EncryptedPackage makes it an encrypted document: the name in UTF-16, and its
		// size (terminator included) at byte 64. The name in a legacy document's text doesn't.
		const name = 'EncryptedPackage'
		for (let i = 0; i < name.length; i++) cfb[512 + i * 2] = name.charCodeAt(i)
		expect((await failure((async () => open(cfb))())).code).toBe('unsupported')
		cfb[512 + 64] = name.length * 2 + 2
		expect((await failure((async () => open(cfb))())).code).toBe('encrypted')
	})

	test('a DOCTYPE is refused, whatever it declares', async () => {
		const bytes = zip({
			'word/document.xml':
				'<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x SYSTEM "http://example.com/">]><w:document><w:body/></w:document>',
		})
		expect((await failure(open(bytes))).code).toBe('corrupt')
	})

	test('a package without its main part, or whose main part is something else', async () => {
		expect((await failure(open(zip({'[Content_Types].xml': '<Types/>'})))).code).toBe('corrupt')
		expect((await failure(open(zip({'word/document.xml': '<html><body/></html>'})))).code).toBe('corrupt')
	})

	test('a document with no relationships, styles, numbering or section still opens', async () => {
		const model = await open(
			zip({
				'word/document.xml':
					'<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>bare</w:t></w:r></w:p></w:body></w:document>',
			}),
		)
		expect(text(all(model)[0])).toBe('bare')
		expect(model.sections[0]).toMatchObject({pageWidth: 816, pageHeight: 1056, margins: {top: 96, left: 96}})
	})

	test('nesting deeper than the parser allows is refused, not recursed into', async () => {
		const deep = '<w:tbl><w:tr><w:tc>'.repeat(90) + '<w:p/>' + '</w:tc></w:tr></w:tbl>'.repeat(90)
		expect((await failure(open(docx(deep)))).code).toBe('limits')
	})

	test('absurd numbers are clamped', async () => {
		const model = await open(
			docx(
				'<w:p><w:pPr><w:ind w:left="99999999999" w:hanging="-5"/><w:spacing w:before="-200" w:line="999999999"/></w:pPr><w:r><w:rPr><w:sz w:val="99999999"/><w:spacing w:val="9999999"/></w:rPr><w:t>big</w:t></w:r></w:p>' +
					'<w:sectPr><w:pgSz w:w="999999999" w:h="1"/><w:cols w:num="999"/></w:sectPr>',
			),
		)
		const p = all(model)[0]
		expect(p.props.indent?.left).toBe(2112)
		expect(p.props.indent?.hanging).toBe(0)
		expect(p.props.spacing?.before).toBe(0)
		expect(p.props.spacing?.line).toBe(31680)
		expect(textRuns(p)[0].style.size).toBe(3276)
		expect(textRuns(p)[0].style.spacing).toBe(100)
		expect(model.sections[0]).toMatchObject({pageWidth: 2112, pageHeight: 96, columns: {count: 45}})
	})

	test('random structures: every one builds, or fails as a DocxError', async () => {
		const random = structures(7)
		for (let i = 0; i < 400; i++) {
			const body = random()
			try {
				const model = await open(docx(body))
				expect(model.sections.length).toBeGreaterThan(0)
			} catch (error) {
				expect(error, body).toBeInstanceOf(DocxError)
			}
		}
	})
})
