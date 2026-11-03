import {describe, expect, test} from 'vitest'

import {ZipArchive} from '../../../shared/zip'
import type {Value} from '../formula/values'
import {XlsxError} from './package'
import {relationships, styleSheet, workbook, worksheet, zip, type WorkbookSpec} from './test-helpers'
import {openWorkbook} from './workbook'
import {saveWorkbook, type CellEdit} from './writer'

const SHEET = 'xl/worksheets/sheet1.xml'
const STYLES = styleSheet('<cellXfs count="4"><xf/><xf/><xf/><xf/></cellXfs>')

const edit = (row: number, col: number, value: Value, formula?: string, sheet = 0): CellEdit => ({
	sheet,
	row,
	col,
	value,
	...(formula !== undefined && {formula}),
})

async function save(spec: WorkbookSpec, edits: CellEdit[]) {
	const original = await workbook({styles: STYLES, ...spec})
	const saved = await saveWorkbook(original, edits)
	const archive = ZipArchive.open(saved)
	const text = (part: string) => (archive.has(part) ? archive.text(part) : Promise.resolve(undefined))
	const book = await openWorkbook(saved)
	return {original, saved, archive, xml: (await text(SHEET))!, text, book, sheet: await book.loadSheet(0)}
}

// Everything between <sheetData> and </sheetData>
const data = (xml: string) => xml.slice(xml.indexOf('<sheetData>') + 11, xml.indexOf('</sheetData>'))

async function unchanged(original: Uint8Array, saved: Uint8Array, changed: string[]) {
	const before = ZipArchive.open(original)
	const after = ZipArchive.open(saved)
	for (const entry of before.entries) {
		if (changed.includes(entry.name)) continue
		expect(
			after.entries.find((e) => e.name === entry.name),
			entry.name,
		).toEqual(entry)
		expect(Buffer.from(await after.bytes(entry.name)).equals(Buffer.from(await before.bytes(entry.name)))).toBe(true)
	}
}

const rejects = async (promise: Promise<unknown>, type: abstract new (...args: never[]) => Error, code?: string) => {
	const error = await promise.then(
		() => undefined,
		(error: unknown) => error,
	)
	expect(error).toBeInstanceOf(type)
	if (code) expect((error as XlsxError).code).toBe(code)
}

describe('cells', () => {
	test('each kind of value replaces a cell, keeping its style', async () => {
		const {xml, sheet} = await save(
			{
				sheets: [
					worksheet(
						'<row r="1"><c r="A1" s="3"><v>1</v></c><c r="B1" s="2" t="s"><v>0</v></c><c r="C1" cm="1" vm="2" t="e"><v>#N/A</v></c>' +
							'<c r="D1"><f>A1*2</f><v>2</v></c><c r="E1" s="1"><v>5</v></c><c r="G1"><v>7</v></c></row>',
					),
				],
			},
			[
				edit(0, 0, 2.5),
				edit(0, 1, 'text & <tag>'),
				edit(0, 2, true),
				edit(0, 3, {error: '#DIV/0!'}),
				edit(0, 4, null),
				edit(0, 5, 'new'),
				edit(0, 6, Infinity),
			],
		)
		expect(data(xml)).toBe(
			'<row r="1"><c r="A1" s="3"><v>2.5</v></c><c r="B1" s="2" t="inlineStr"><is><t xml:space="preserve">text &amp; &lt;tag&gt;</t></is></c>' +
				'<c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#DIV/0!</v></c><c r="E1" s="1"/>' +
				'<c r="F1" t="inlineStr"><is><t xml:space="preserve">new</t></is></c><c r="G1" t="e"><v>#NUM!</v></c></row>',
		)
		expect([0, 1, 2, 3, 4, 5, 6].map((col) => sheet.cell(0, col))).toEqual([
			{value: 2.5, style: 3},
			{value: 'text & <tag>', style: 2},
			{value: true, style: 0},
			{value: {error: '#DIV/0!'}, style: 0},
			{value: null, style: 1},
			{value: 'new', style: 0},
			{value: {error: '#NUM!'}, style: 0},
		])
	})

	test('formulas with their cached values', async () => {
		const {xml, sheet} = await save({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}, [
			edit(1, 0, 3, 'SUM(A1:B1)'),
			edit(1, 1, '1x', 'A1&"x"'),
			edit(1, 2, true, 'A1>0'),
			edit(1, 3, {error: '#DIV/0!'}, '1/0'),
			edit(1, 4, null, 'XLOOKUP(1,A:A,B:B)'),
			edit(1, 5, 'ab1', 'CONCAT("a","b")&_xlfn.IFS(TRUE,1)&"XLOOKUP(x)"'),
			edit(1, 6, 0, 'filter(A:A,B:B)+SUM(A1)'),
			edit(1, 7, '', '""'),
		])
		expect(data(xml)).toContain(
			'<row r="2"><c r="A2"><f>SUM(A1:B1)</f><v>3</v></c><c r="B2" t="str"><f>A1&amp;"x"</f><v>1x</v></c>' +
				'<c r="C2" t="b"><f>A1&gt;0</f><v>1</v></c><c r="D2" t="e"><f>1/0</f><v>#DIV/0!</v></c>' +
				'<c r="E2"><f>_xlfn.XLOOKUP(1,A:A,B:B)</f></c>' +
				'<c r="F2" t="str"><f>_xlfn.CONCAT("a","b")&amp;_xlfn.IFS(TRUE,1)&amp;"XLOOKUP(x)"</f><v>ab1</v></c>' +
				'<c r="G2"><f>_xlfn._xlws.filter(A:A,B:B)+SUM(A1)</f><v>0</v></c><c r="H2" t="str"><f>""</f><v></v></c></row>',
		)
		// Read back, the prefixes are gone again
		expect(sheet.cell(1, 4)).toEqual({value: null, formula: 'XLOOKUP(1,A:A,B:B)', style: 0})
		expect(sheet.cell(1, 5)?.formula).toBe('CONCAT("a","b")&IFS(TRUE,1)&"XLOOKUP(x)"')
		expect(sheet.cell(1, 7)).toEqual({value: '', formula: '""', style: 0})
	})

	test('new cells and rows go in at their place in order', async () => {
		const {xml} = await save(
			{
				sheets: [
					worksheet(
						'<row r="2"><c r="B2"><v>2</v></c><c r="D2"><v>4</v></c></row><row r="5"><c r="B5"><v>5</v></c></row>',
					),
				],
			},
			[
				edit(1, 4, 'e'),
				edit(1, 0, 'a'),
				edit(1, 2, 'c'),
				edit(0, 0, 1),
				edit(2, 2, 3),
				edit(6, 0, 7),
				edit(8, 6, null),
				edit(4, 1, 50),
				edit(4, 1, 55),
			],
		)
		const s = (ref: string, text: string) =>
			`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
		expect(data(xml)).toBe(
			'<row r="1"><c r="A1"><v>1</v></c></row>' +
				`<row r="2">${s('A2', 'a')}<c r="B2"><v>2</v></c>${s('C2', 'c')}<c r="D2"><v>4</v></c>${s('E2', 'e')}</row>` +
				'<row r="3"><c r="C3"><v>3</v></c></row><row r="5"><c r="B5"><v>55</v></c></row><row r="7"><c r="A7"><v>7</v></c></row>',
		)
	})

	test('rows and sheets without content yet', async () => {
		const row = await save({sheets: [worksheet('<row r="2" ht="30" customHeight="1"/><row r="3"/>')]}, [
			edit(1, 1, 1),
			edit(2, 0, null),
		])
		expect(data(row.xml)).toBe('<row r="2" ht="30" customHeight="1"><c r="B2"><v>1</v></c></row><row r="3"/>')
		expect(row.sheet.rowHeightPx(1)).toBe(40)
		const empty = await save({sheets: [worksheet('').replace('<sheetData></sheetData>', '<sheetData />')]}, [
			edit(0, 0, 1),
		])
		expect(empty.xml).toContain('<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>')
		const cleared = await save({sheets: [worksheet('').replace('<sheetData></sheetData>', '<sheetData/>')]}, [
			edit(0, 0, null),
		])
		expect(cleared.xml).toContain('<sheetData/>')
	})

	test('rows out of order and repeated cells still take their edits', async () => {
		const {xml, sheet} = await save(
			{
				sheets: [
					worksheet(
						'<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row><row r="10"><c r="A10"><v>10</v></c></row>' +
							'<row r="3"><c r="A3"><v>3</v></c></row>',
					),
				],
			},
			[edit(0, 0, 9), edit(2, 0, 30), edit(2, 1, 31), edit(4, 0, 5)],
		)
		expect(data(xml)).toBe(
			'<row r="1"><c r="A1"><v>9</v></c></row><row r="5"><c r="A5"><v>5</v></c></row><row r="10"><c r="A10"><v>10</v></c></row>' +
				'<row r="3"><c r="A3"><v>30</v></c><c r="B3"><v>31</v></c></row>',
		)
		expect([
			sheet.cell(0, 0)?.value,
			sheet.cell(2, 0)?.value,
			sheet.cell(2, 1)?.value,
			sheet.cell(4, 0)?.value,
		]).toEqual([9, 30, 31, 5])
	})

	test('cells without references keep their place', async () => {
		const {xml, sheet} = await save({sheets: [worksheet('<row><c><v>1</v></c><c><v>2</v></c><c><v>3</v></c></row>')]}, [
			edit(0, 1, 9),
			edit(0, 4, 5),
		])
		expect(data(xml)).toBe('<row><c><v>1</v></c><c r="B1"><v>9</v></c><c><v>3</v></c><c r="E1"><v>5</v></c></row>')
		expect([0, 1, 2, 4].map((col) => sheet.cell(0, col)?.value)).toEqual([1, 9, 3, 5])
	})

	test("new cells take their row's or column's style, as Excel gives them", async () => {
		const {xml} = await save(
			{
				sheets: [
					worksheet('<row r="1" s="1" customFormat="1"><c r="A1"><v>1</v></c></row>', {
						before: '<cols><col min="3" max="3" width="9" style="2"/></cols>',
					}),
				],
			},
			[edit(0, 1, 2), edit(0, 2, 3), edit(4, 2, 4), edit(4, 3, 5)],
		)
		expect(data(xml)).toBe(
			'<row r="1" s="1" customFormat="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c><c r="C1" s="1"><v>3</v></c></row>' +
				'<row r="5"><c r="C5" s="2"><v>4</v></c><c r="D5"><v>5</v></c></row>',
		)
	})

	test('text is escaped so it reads back exactly', async () => {
		const texts = ['_x0041_ stays literal', 'control\u0001char', 'line\r\nbreak', '  spaces  ', '😀 データ', '<&>"\'']
		const {xml, sheet} = await save(
			{sheets: [worksheet('')]},
			texts.map((text, i) => edit(i, 0, text)),
		)
		expect(xml).toContain('_x005F_x0041_ stays literal')
		expect(xml).toContain('control_x0001_char')
		expect(xml).toContain('line&#13;\nbreak')
		expect(texts.map((_, i) => sheet.cell(i, 0)?.value)).toEqual(texts)
	})

	test('cells holding more than they should still splice cleanly', async () => {
		const {sheet} = await save(
			{
				sheets: [
					worksheet(
						'<row r="1"><c r="A1"><extLst><ext><c/><f>nope</f></ext></extLst><v>1</v></c><c r="B1"><v>2</v></c></row>',
					),
				],
			},
			[edit(0, 0, 'replaced')],
		)
		expect([sheet.cell(0, 0)?.value, sheet.cell(0, 1)?.value]).toEqual(['replaced', 2])
	})
})

describe('shared and array formulas', () => {
	const shared = worksheet(
		'<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c>' +
			'<c r="C1"><f t="shared" ref="C1:C2" si="2">_xlfn.IFNA(A1,0)</f><v>1</v></c></row>' +
			'<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c><c r="C2"><f t="shared" si="2"/><v>2</v></c></row>' +
			'<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>' +
			'<row r="4"><c r="B4"><f t="shared" ref="B4:B5" si="1">A4+1</f><v>1</v></c></row>' +
			'<row r="5"><c r="B5"><f t="shared" si="1"/><v>1</v></c></row>',
	)
	const rows4and5 =
		'<row r="4"><c r="B4"><f t="shared" ref="B4:B5" si="1">A4+1</f><v>1</v></c></row><row r="5"><c r="B5"><f t="shared" si="1"/><v>1</v></c></row>'

	test("editing a group's master gives each other member its own formula", async () => {
		const {xml, sheet} = await save({sheets: [shared]}, [edit(0, 1, 100), edit(0, 2, null)])
		expect(data(xml)).toBe(
			'<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>100</v></c><c r="C1"/></row>' +
				'<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f>A2*2</f><v>4</v></c><c r="C2"><f>_xlfn.IFNA(A2,0)</f><v>2</v></c></row>' +
				`<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f>A3*2</f><v>6</v></c></row>${rows4and5}`,
		)
		expect(sheet.cell(2, 1)).toEqual({value: 6, formula: 'A3*2', style: 0})
		expect(sheet.cell(1, 2)?.formula).toBe('IFNA(A2,0)')
	})

	test("editing a member leaves the group's other cells as they were", async () => {
		const {xml, sheet} = await save({sheets: [shared]}, [edit(1, 1, 7)])
		expect(data(xml)).toContain('<c r="B2"><v>7</v></c>')
		expect(data(xml)).toContain('<c r="B3"><f t="shared" si="0"/><v>6</v></c>')
		expect(sheet.cell(2, 1)?.formula).toBe('A3*2')
		const both = await save({sheets: [shared]}, [edit(0, 1, 1), edit(2, 1, 9, 'A3*3')])
		expect(data(both.xml)).toContain('<c r="B2"><f>A2*2</f><v>4</v></c>')
		expect(data(both.xml)).toContain('<c r="B3"><f>A3*3</f><v>9</v></c>')
	})

	test("a master whose formula we can't rewrite is refused rather than broken", async () => {
		const broken = worksheet(
			'<row r="1"><c r="B1"><f t="shared" ref="B1:B2" si="0">A1&amp;"open</f><v>2</v></c></row><row r="2"><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>',
		)
		await rejects(saveWorkbook(await workbook({sheets: [broken]}), [edit(0, 1, 5)]), XlsxError, 'unsupported')
	})

	const array = worksheet(
		'<row r="1"><c r="C1"><f t="array" ref="C1:D2">A1:B2*2</f><v>2</v></c><c r="D1" s="1"><v>4</v></c></row>' +
			'<row r="2"><c r="C2"><v>6</v></c><c r="D2"><v>8</v></c></row><row r="3"><c r="D3"><v>9</v></c></row>',
	)

	test('an array formula changes as a whole', async () => {
		await rejects(saveWorkbook(await workbook({sheets: [array]}), [edit(1, 3, 1)]), XlsxError, 'unsupported')
		const {xml} = await save({sheets: [array]}, [edit(0, 2, 5)])
		expect(data(xml)).toBe(
			'<row r="1"><c r="C1"><v>5</v></c><c r="D1" s="1"/></row><row r="2"><c r="C2"/><c r="D2"/></row><row r="3"><c r="D3"><v>9</v></c></row>',
		)
		const together = await save({sheets: [array]}, [edit(0, 2, 5), edit(1, 3, 'kept')])
		expect(data(together.xml)).toContain('<row r="2"><c r="C2"/><c r="D2" t="inlineStr">')
	})

	test('an array formula only recalculated stays as it was, with its new value; retyped, it goes', async () => {
		const dynamic = worksheet(
			'<row r="1"><c r="A1"><v>1</v></c><c r="B1" cm="1"><f t="array" ref="B1:B2" aca="1">_xlfn.SEQUENCE(2,1,A1)</f><v>1</v></c>' +
				'<c r="C1"><f t="array" ref="C1:D2">A1:B2*2</f><v>2</v></c><c r="D1" s="1"><v>4</v></c></row>' +
				'<row r="2"><c r="B2"><v>2</v></c><c r="C2"><v>6</v></c><c r="D2"><v>8</v></c></row>',
		)
		const {xml} = await save({sheets: [dynamic]}, [
			edit(0, 0, 5),
			edit(0, 1, 5, 'SEQUENCE(2,1,A1)'),
			edit(0, 2, 10, 'A1:B2*2'),
		])
		expect(data(xml)).toBe(
			'<row r="1"><c r="A1"><v>5</v></c><c r="B1" cm="1"><f t="array" ref="B1:B2" aca="1">_xlfn.SEQUENCE(2,1,A1)</f><v>5</v></c>' +
				'<c r="C1"><f t="array" ref="C1:D2">A1:B2*2</f><v>10</v></c><c r="D1" s="1"><v>4</v></c></row>' +
				'<row r="2"><c r="B2"><v>2</v></c><c r="C2"><v>6</v></c><c r="D2"><v>8</v></c></row>',
		)
		const retyped = await save({sheets: [dynamic]}, [edit(0, 2, 3, 'A1:B2*3')])
		expect(data(retyped.xml)).toContain(
			'<c r="C1"><f>A1:B2*3</f><v>3</v></c><c r="D1" s="1"/></row><row r="2"><c r="B2"><v>2</v></c><c r="C2"/><c r="D2"/></row>',
		)
	})
})

describe('the rest of the package', () => {
	test('the used range grows to take in new content', async () => {
		const grown = await save(
			{sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>', {before: '<dimension ref="A1:B2"/>'})]},
			[edit(4, 3, 1)],
		)
		expect(grown.xml).toContain('<dimension ref="A1:D5"/>')
		const same = await save({sheets: [worksheet('', {before: '<dimension ref="A1:B2"/>'})]}, [
			edit(0, 0, 1),
			edit(9, 9, null),
		])
		expect(same.xml).toContain('<dimension ref="A1:B2"/>')
		const single = await save({sheets: [worksheet('', {before: '<dimension ref="B2"></dimension>'})]}, [edit(0, 2, 1)])
		expect(single.xml).toContain('<dimension ref="B1:C2"/><sheetData>')
	})

	test('Excel recalculates on open, without the stale calculation chain', async () => {
		const {archive, text, original, saved} = await save(
			{
				sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')],
				calcChain:
					'<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A1" i="1"/></calcChain>',
				after: '<calcPr calcId="191029"/>',
			},
			[edit(0, 0, 2)],
		)
		expect(archive.has('xl/calcChain.xml')).toBe(false)
		expect(await text('[Content_Types].xml')).not.toContain('calcChain')
		expect(await text('xl/_rels/workbook.xml.rels')).not.toContain('calcChain')
		expect(await text('xl/workbook.xml')).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>')
		await unchanged(original, saved, [
			SHEET,
			'xl/calcChain.xml',
			'[Content_Types].xml',
			'xl/_rels/workbook.xml.rels',
			'xl/workbook.xml',
		])
	})

	test('fullCalcOnLoad is set wherever calcPr is, or added in its place', async () => {
		const workbookXml = async (spec: Partial<WorkbookSpec>) =>
			(await save({sheets: [worksheet('')], ...spec}, [edit(0, 0, 1)])).text('xl/workbook.xml')
		expect(await workbookXml({after: '<calcPr fullCalcOnLoad="0" calcId="1"/>'})).toContain(
			'<calcPr fullCalcOnLoad="1" calcId="1"/>',
		)
		expect(await workbookXml({after: "<calcPr calcId='1' fullCalcOnLoad = 'false'/>"})).toContain(
			`<calcPr calcId='1' fullCalcOnLoad = "1"/>`,
		)
		expect(await workbookXml({after: '<calcPr calcId="1"></calcPr>'})).toContain(
			'<calcPr calcId="1" fullCalcOnLoad="1"></calcPr>',
		)
		expect(
			await workbookXml({after: '<definedNames><definedName name="x">1</definedName></definedNames><extLst/>'}),
		).toContain('</definedNames><calcPr fullCalcOnLoad="1"/><extLst/>')
		expect(await workbookXml({})).toContain('</sheets><calcPr fullCalcOnLoad="1"/></workbook>')
		const done = await save({sheets: [worksheet('')], after: '<calcPr fullCalcOnLoad="1"/>'}, [edit(0, 0, 1)])
		await unchanged(done.original, done.saved, [SHEET])
	})

	test('untouched parts are copied byte for byte, and no edits change nothing', async () => {
		const png = Uint8Array.from({length: 4096}, (_, i) => (i * 7919) % 256)
		const spec: WorkbookSpec = {
			sheets: [
				worksheet('<row r="1"><c r="A1"><v>1</v></c></row>'),
				worksheet('<row r="1"><c r="A1"><v>2</v></c></row>'),
			],
			extra: {
				'xl/media/image1.png': png,
				'customXml/item1.xml': '<root>kept</root>',
				'xl/vbaProject.bin': png.slice(0, 100),
			},
		}
		const original = await workbook(spec)
		expect(Buffer.from(await saveWorkbook(original, [])).equals(Buffer.from(original))).toBe(true)
		const {original: base, saved, sheet, book} = await save(spec, [edit(0, 0, 9, undefined, 1)])
		await unchanged(base, saved, ['xl/worksheets/sheet2.xml', 'xl/workbook.xml'])
		expect(sheet.cell(0, 0)?.value).toBe(1)
		expect((await book.loadSheet(1)).cell(0, 0)?.value).toBe(9)
	})

	test('a cell can take a format added after the file’s own: a copy of one, with another number format', async () => {
		const styles = styleSheet(
			'<cellXfs count="2"><xf numFmtId="0" fontId="0"/>' +
				'<xf numFmtId="3" fontId="0" applyNumberFormat="1"><alignment horizontal="center"/></xf></cellXfs>',
		)
		const original = await workbook({styles, sheets: [worksheet('<row r="1"><c r="A1" s="1"><v>1</v></c></row>')]})
		const formats = [
			{base: 1, numFmtId: 14},
			{base: 0, numFmtId: 9},
		]
		const saved = await saveWorkbook(
			original,
			[
				{...edit(0, 0, 46308), style: 2},
				{...edit(0, 1, 0.5), style: 3},
			],
			formats,
		)
		expect(await ZipArchive.open(saved).text('xl/styles.xml')).toContain(
			'<cellXfs count="4"><xf numFmtId="0" fontId="0"/>' +
				'<xf numFmtId="3" fontId="0" applyNumberFormat="1"><alignment horizontal="center"/></xf>' +
				'<xf fontId="0" numFmtId="14" applyNumberFormat="1"><alignment horizontal="center"/></xf>' +
				'<xf fontId="0" numFmtId="9" applyNumberFormat="1"/></cellXfs>',
		)
		const sheet = await (await openWorkbook(saved)).loadSheet(0)
		expect([sheet.display(0, 0).text, sheet.display(0, 1).text]).toEqual(['10/13/2026', '50%'])
		await unchanged(original, saved, [SHEET, 'xl/styles.xml', 'xl/workbook.xml'])
	})

	test('prefixed SpreadsheetML gets prefixed elements', async () => {
		const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
		const bytes = await zip({
			'_rels/.rels': relationships(['rId1', 'officeDocument', 'xl/workbook.xml']),
			'xl/workbook.xml': `<x:workbook xmlns:x="${main}" xmlns:r="r"><x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
			'xl/_rels/workbook.xml.rels': relationships(['rId1', 'worksheet', 'worksheets/sheet1.xml']),
			[SHEET]: `<x:worksheet xmlns:x="${main}"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
		})
		const saved = await saveWorkbook(bytes, [edit(0, 1, 2), edit(1, 0, 'x'), edit(0, 0, 3, 'B1+1')])
		const archive = ZipArchive.open(saved)
		expect(await archive.text(SHEET)).toBe(
			`<x:worksheet xmlns:x="${main}"><x:sheetData><x:row r="1"><x:c r="A1"><x:f>B1+1</x:f><x:v>3</x:v></x:c><x:c r="B1"><x:v>2</x:v></x:c>` +
				'</x:row><x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t xml:space="preserve">x</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
		)
		expect(await archive.text('xl/workbook.xml')).toContain('</x:sheets><x:calcPr fullCalcOnLoad="1"/>')
		const sheet = await (await openWorkbook(saved)).loadSheet(0)
		expect([sheet.cell(0, 0)?.formula, sheet.cell(1, 0)?.value]).toEqual(['B1+1', 'x'])
	})

	test('a part that declared UTF-16 is written, and declared, as UTF-8', async () => {
		const xml = worksheet('<row r="1"><c r="A1" t="inlineStr"><is><t>ü</t></is></c></row>').replace('UTF-8', 'UTF-16')
		const utf16 = new Uint8Array(2 + xml.length * 2)
		utf16.set([0xff, 0xfe])
		for (let i = 0; i < xml.length; i++) utf16.set([xml.charCodeAt(i) & 0xff, xml.charCodeAt(i) >> 8], 2 + i * 2)
		const {xml: saved, sheet, archive} = await save({sheets: [''], extra: {[SHEET]: utf16}}, [edit(0, 1, 'ß')])
		expect(saved.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true)
		expect((await archive.bytes(SHEET))[0]).toBe(0x3c)
		expect([sheet.cell(0, 0)?.value, sheet.cell(0, 1)?.value]).toEqual(['ü', 'ß'])
	})

	test('edits that make no sense are refused', async () => {
		const original = await workbook({
			sheets: [
				worksheet(''),
				{
					xml: '<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
					chartsheet: true,
				},
			],
		})
		for (const bad of [
			edit(-1, 0, 1),
			edit(0, 16_384, 1),
			edit(1_048_576, 0, 1),
			edit(0.5, 0, 1),
			edit(0, 0, 1, undefined, 5),
		]) {
			await rejects(saveWorkbook(original, [bad]), TypeError)
		}
		await rejects(saveWorkbook(original, [edit(0, 0, 1, undefined, 1)]), XlsxError, 'unsupported')
		await rejects(saveWorkbook(new Uint8Array([1, 2, 3]), [edit(0, 0, 1)]), XlsxError, 'corrupt')
		const noData = await workbook({
			sheets: ['<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'],
		})
		await rejects(saveWorkbook(noData, [edit(0, 0, 1)]), XlsxError, 'corrupt')
	})
})
