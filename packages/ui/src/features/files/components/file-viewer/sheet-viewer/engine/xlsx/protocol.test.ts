import {afterEach, describe, expect, test} from 'vitest'

import {ZipArchive} from '../../../shared/zip'
import {FormulaSyntaxError} from '../formula/parser'
import {XlsxError} from './package'
import {
	createXlsxClient,
	createXlsxHandler,
	heldKey,
	inputOf,
	type CellData,
	type HeldBlocks,
	type XlsxCall,
	type XlsxCells,
	type XlsxEdited,
	type XlsxReply,
	type XlsxRequest,
	type XlsxSheet,
} from './protocol'
import {relationships, styleSheet, workbook, worksheet} from './test-helpers'
import {openWorkbook} from './workbook'

const STYLES = styleSheet(
	'<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
		'<cellXfs count="7"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/><xf numFmtId="49"/>' +
		'<xf numFmtId="0" quotePrefix="1"/><xf numFmtId="164"/><xf numFmtId="46"/></cellXfs>',
)

const book = () =>
	workbook({
		styles: STYLES,
		sheets: [
			worksheet(
				'<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f>A1*2</f><v>4</v></c><c r="C1" s="1"><v>46308</v></c>' +
					'<c r="D1" s="2"><v>0.25</v></c><c r="E1" s="4" t="inlineStr"><is><t>hi</t></is></c>' +
					'<c r="F1" t="b"><v>1</v></c><c r="G1" t="e"><v>#DIV/0!</v></c></row>' +
					'<row r="2"><c r="A2" s="3"/><c r="B2" s="5"><v>46308.5</v></c><c r="C2" s="6"><v>1.5</v></c></row>' +
					'<row r="3" s="2" customFormat="1"/>' +
					'<row r="4"><c r="A4"><f t="array" ref="A4:A5">A1:A2*2</f><v>4</v></c></row>' +
					'<row r="5"><c r="A5"><v>0</v></c></row>',
				{
					before:
						'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>' +
						'<cols><col min="2" max="2" width="20" customWidth="1" style="1"/></cols>',
				},
			),
			{name: 'Other', xml: worksheet('<row r="1"><c r="A1"><f>Sheet1!B1+1</f><v>5</v></c></row>')},
		],
	})

// Every cell an edit changes on its sheet comes back: one block the size of the sheet, held
const WHOLE: HeldBlocks = {rows: 1_048_576, cols: 16_384, keys: [0]}
type Request = XlsxRequest extends infer R
	? R extends {held: HeldBlocks}
		? Omit<R, 'held'> & {held?: HeldBlocks}
		: R
	: never

// The handler, called the way the worker calls it
async function open(bytes: Uint8Array, maxCells = 1_000_000) {
	const handle = createXlsxHandler()
	let id = 0
	const ask = async <T>(request: Request): Promise<T> => {
		const {reply} = await handle({id: id++, request: {held: WHOLE, ...request} as XlsxRequest})
		if ('error' in reply) throw Object.assign(new Error(reply.error.message), reply.error)
		return reply.result as T
	}
	await ask({type: 'open', bytes: bytes.slice().buffer, maxCells})
	return ask
}

const cellsOf = (cells: CellData[]) => Object.fromEntries(cells.map((cell) => [`${cell.row}:${cell.col}`, cell]))
const texts = (edited: XlsxEdited) => edited.cells.map(({row, col, text}) => [row, col, text])
// A cell's text as drawn, on any sheet
const textAt = async (ask: Awaited<ReturnType<typeof open>>, sheet: number, row: number, col: number) =>
	(await ask<XlsxCells>({type: 'cells', sheet, range: {top: row, left: col, bottom: row, right: col}})).cells[0]
		?.text ?? ''

describe('createXlsxHandler', () => {
	test('lists the sheets, sizes their lines and draws a window of cells', async () => {
		const ask = await open(await book())
		const sheet = await ask<XlsxSheet>({type: 'sheet', sheet: 0})
		expect(sheet).toMatchObject({
			rowCount: 5,
			colCount: 7,
			rows: {defaultPx: 20, sizes: []},
			// trunc(((256 × 20 + trunc(128 / 7)) / 256) × 7) = 140
			cols: {defaultPx: 64, sizes: [1, 140]},
			colStyles: [1, 1],
			arrays: [{top: 3, left: 0, bottom: 4, right: 0}],
			frozen: {rows: 1, cols: 0},
		})
		const {cells, rowStyles} = await ask<XlsxCells>({
			type: 'cells',
			sheet: 0,
			range: {top: 0, left: 0, bottom: 4, right: 9},
		})
		expect(rowStyles).toEqual([2, 2])
		const at = cellsOf(cells)
		expect(at['0:0']).toEqual({row: 0, col: 0, text: '2', kind: 'n', style: 0, input: '2', value: 2})
		expect(at['0:1']).toMatchObject({text: '4', input: '=A1*2'})
		expect(at['0:2']).toMatchObject({text: '10/13/2026', input: '2026-10-13'})
		expect(at['0:3']).toMatchObject({text: '25.00%', input: '25%'})
		expect(at['0:4']).toMatchObject({text: 'hi', kind: 's', input: "'hi"})
		expect(at['0:5']).toMatchObject({text: 'TRUE', kind: 'b', input: 'TRUE'})
		expect(at['0:6']).toMatchObject({text: '#DIV/0!', kind: 'e', input: '#DIV/0!'})
		// A cell with only a style still draws its style
		expect(at['1:0']).toMatchObject({text: '', kind: '', style: 3, input: ''})
		expect(at['1:1']).toMatchObject({input: '2026-10-13 12:00:00'})
		expect(at['1:2']).toMatchObject({text: '36:00:00', input: '1.5'})
		expect(at['3:0']).toMatchObject({input: '=A1:A2*2'})
	})

	test('edits recalculate their dependents on every sheet, and undo puts back exactly what was there', async () => {
		const ask = await open(await book())
		const edited = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 0, col: 0, input: '5'}], strict: true})
		// The edited sheet's cells come back; the other sheet's are read afresh
		expect(texts(edited)).toEqual([
			[0, 0, '5'],
			[0, 1, '10'],
		])
		expect(await textAt(ask, 1, 0, 0)).toBe('11')
		const undone = await ask<XlsxEdited>({type: 'restore', step: edited.step!, to: 'before'})
		expect(texts(undone)).toEqual([
			[0, 0, '2'],
			[0, 1, '4'],
		])
		expect(await textAt(ask, 1, 0, 0)).toBe('5')
		// Nothing differs from the file any more, so nothing is written
		const saved = new Uint8Array(await ask<ArrayBuffer>({type: 'save'}))
		const reopened = await (await openWorkbook(saved)).loadSheet(0)
		expect(reopened.cell(0, 1)).toMatchObject({value: 4, formula: 'A1*2'})
	})

	test('a formula that doesn’t parse is refused when typed, and kept as text when pasted', async () => {
		const ask = await open(await book())
		const error = await ask({type: 'edit', sheet: 0, cells: [{row: 2, col: 2, input: '=SUM('}], strict: true}).catch(
			(error: unknown) => error,
		)
		expect(error).toMatchObject({name: 'FormulaSyntaxError', position: expect.any(Number)})
		const pasted = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [
				{row: 2, col: 2, input: '=SUM('},
				{row: 2, col: 3, input: '7'},
			],
			strict: false,
		})
		// A new cell in a styled row takes the row's style: 7 as a percentage
		expect(cellsOf(pasted.cells)).toMatchObject({'2:2': {text: '=SUM(', kind: 's'}, '2:3': {text: '700.00%', style: 2}})
	})

	test('clears every cell with content in a range, keeping their styles', async () => {
		const ask = await open(await book())
		const cleared = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [],
			strict: true,
			clear: {top: 0, left: 0, bottom: 1_048_575, right: 2},
		})
		// A1:C5's cells with content (A2 has only a style), and the other sheet's formula reading B1
		expect(texts(cleared).sort()).toEqual([
			[0, 0, ''],
			[0, 1, ''],
			[0, 2, ''],
			[1, 1, ''],
			[1, 2, ''],
			[3, 0, ''],
			[4, 0, ''],
		])
		expect(await textAt(ask, 1, 0, 0)).toBe('1')
		expect(cleared.cells.find((cell) => cell.row === 0 && cell.col === 2)).toMatchObject({style: 1})
	})

	test('a value typed into a General cell takes the format its form asks for, which undo takes back', async () => {
		const ask = await open(await book())
		const typed = [
			['2026-10-13', '10/13/2026'],
			['2026-10-13 12:30', '10/13/2026 12:30'],
			['12:30', '12:30'],
			['12:30:15', '12:30:15'],
			['3:30 PM', '3:30 PM'],
			['50%', '50%'],
			['12.5%', '12.50%'],
			['$5', '$5 '],
			['$1,234.5', '$1,234.50 '],
			['2026-01-02', '1/2/2026'],
		]
		const cells = typed.map(([input], i) => ({row: 10 + i, col: 0, input}))
		const edited = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells, strict: true})
		expect(edited.cells.map(({text}) => text)).toEqual(typed.map(([, text]) => text))
		// Copies of the General format with Excel's own number formats, each made once: the second date reuses the first's
		expect(edited.cells.map(({style}) => style)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 7])
		expect(edited.styles?.map(({format}) => format)).toEqual([
			'm/d/yyyy',
			'm/d/yyyy h:mm',
			'h:mm',
			'h:mm:ss',
			'h:mm AM/PM',
			'0%',
			'0.00%',
			'"$"#,##0_);("$"#,##0)',
			'"$"#,##0.00_);("$"#,##0.00)',
		])
		// A cell with a format of its own keeps it, and plain numbers and text keep General
		const kept = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [
				{row: 0, col: 3, input: '$5'},
				{row: 0, col: 0, input: '1,234'},
				{row: 20, col: 0, input: 'Total'},
			],
			strict: true,
		})
		expect(cellsOf(kept.cells)).toMatchObject({
			'0:3': {text: '500.00%', style: 2},
			'0:0': {text: '1234', style: 0},
			'20:0': {text: 'Total', style: 0},
		})
		expect(kept.styles).toBeUndefined()
		const undone = await ask<XlsxEdited>({type: 'restore', step: edited.step!, to: 'before'})
		expect(undone.cells.find((cell) => cell.row === 10)).toMatchObject({text: '', style: 0})
		const redone = await ask<XlsxEdited>({type: 'restore', step: edited.step!, to: 'after'})
		expect(redone.cells.find((cell) => cell.row === 10)).toMatchObject({text: '10/13/2026', style: 7})
	})

	test('saving keeps the formats typed values took, and only those', async () => {
		const ask = await open(await book())
		await ask({type: 'edit', sheet: 0, cells: [{row: 10, col: 0, input: '50%'}], strict: true})
		await ask({type: 'edit', sheet: 0, cells: [{row: 11, col: 0, input: '2026-10-13'}], strict: true})
		await ask({type: 'edit', sheet: 0, cells: [{row: 11, col: 0, input: ''}], strict: true})
		const saved = new Uint8Array(await ask<ArrayBuffer>({type: 'save'}))
		const reopened = await openWorkbook(saved)
		expect(reopened.styles.map(({format}) => format).slice(7)).toEqual(['0%', 'm/d/yyyy'])
		expect((await reopened.loadSheet(0)).display(10, 0).text).toBe('50%')

		// Undone, the percentage leaves nothing to save, and no format either
		const again = await open(await book())
		const edited = await again<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [{row: 10, col: 0, input: '50%'}],
			strict: true,
		})
		await again({type: 'restore', step: edited.step!, to: 'before'})
		const untouched = await openWorkbook(new Uint8Array(await again<ArrayBuffer>({type: 'save'})))
		expect(untouched.styles).toHaveLength(7)
	})

	test('a range’s text, as it’s drawn, for a copy', async () => {
		const ask = await open(await book())
		expect(await ask<string[][]>({type: 'texts', sheet: 0, range: {top: 0, left: 0, bottom: 1, right: 3}})).toEqual([
			['2', '4', '10/13/2026', '25.00%'],
			['', '2026-10-13 12:00', '36:00:00', ''],
		])
	})

	test('the sheets read and the calculator’s formula cells keep to the workbook’s budget together', async () => {
		const six = worksheet(
			'<row r="1">' + [...'ABCDEF'].map((c, i) => `<c r="${c}1"><v>${i}</v></c>`).join('') + '</row>',
		)
		const bytes = await workbook({sheets: [six, six]})
		const limits = expect.objectContaining({code: 'limits'})
		// Each sheet fits on its own, not both at once: the first is let go for the second
		const small = await open(bytes, 10)
		await small({type: 'sheet', sheet: 0})
		await expect(small({type: 'sheet', sheet: 1})).rejects.toEqual(limits)
		await small({type: 'release', sheet: 0})
		await small({type: 'sheet', sheet: 1})
		// An edit calculates the workbook, which needs both
		await expect(small({type: 'edit', sheet: 1, cells: [{row: 1, col: 0, input: '1'}], strict: true})).rejects.toEqual(
			limits,
		)
		// The calculator reads values through the sheets: both fitting is enough
		const enough = await open(bytes, 12)
		await enough({type: 'edit', sheet: 0, cells: [{row: 1, col: 0, input: '1'}], strict: true})
		// With a calculator, which reads every sheet, none is let go, and an edit stays
		await enough({type: 'edit', sheet: 1, cells: [{row: 0, col: 0, input: '9'}], strict: true})
		await enough({type: 'release', sheet: 1})
		expect(await textAt(enough, 1, 0, 0)).toBe('9')
		// Formula cells are its own, and count
		const sums = worksheet(
			'<row r="1">' + [...'ABCDEF'].map((c, i) => `<c r="${c}1"><f>${i}+1</f><v>${i + 1}</v></c>`).join('') + '</row>',
		)
		const formulas = await workbook({sheets: [sums, sums]})
		const edit = {type: 'edit' as const, sheet: 0, cells: [{row: 1, col: 0, input: '1'}], strict: true}
		await expect((await open(formulas, 20))(edit)).rejects.toEqual(limits)
		await (
			await open(formulas, 24)
		)(edit)
	})

	test('an edit reads the other cells through the sheets: formulas over them, cleared ones, and put back', async () => {
		const ask = await open(
			await workbook({
				sheets: [
					worksheet(
						'<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><f>SUM(A1:B1)</f><v>3</v></c></row>' +
							'<row r="5"><c r="A5"><v>10</v></c><c r="C5"><f>SUM(A:A)</f><v>11</v></c></row>',
					),
				],
			}),
		)
		const typed = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 0, col: 1, input: '5'}], strict: true})
		expect(texts(typed).sort()).toEqual([
			[0, 1, '5'],
			[0, 2, '6'],
		])
		const cleared = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [],
			strict: true,
			clear: {top: 0, left: 0, bottom: 0, right: 0},
		})
		expect(texts(cleared).sort()).toEqual([
			[0, 0, ''],
			[0, 2, '5'],
			[4, 2, '10'],
		])
		const undone = await ask<XlsxEdited>({type: 'restore', step: cleared.step!, to: 'before'})
		expect(texts(undone).sort()).toEqual([
			[0, 0, '1'],
			[0, 2, '6'],
			[4, 2, '11'],
		])
	})

	test('an edit’s reply brings only the cells in the blocks the UI holds, and how far the sheet now reaches', async () => {
		const ask = await open(await book())
		const held = {rows: 128, cols: 256, keys: [heldKey(0, 0)]}
		const cells = [
			{row: 100, col: 0, input: 'a'},
			{row: 300, col: 0, input: 'b'},
		]
		const pasted = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells, strict: false, held})
		expect([texts(pasted), pasted.reach, pasted.step]).toEqual([[[100, 0, 'a']], {rows: 301, cols: 1}, 0])
		// Undone from what the worker kept of it; a step forgotten is gone
		await ask({type: 'restore', step: 0, to: 'before', held})
		expect(await textAt(ask, 0, 300, 0)).toBe('')
		await ask({type: 'forget', steps: [0]})
		await expect(ask({type: 'restore', step: 0, to: 'after', held})).rejects.toThrow('No step 0')
	})

	test('a cell formatted as text keeps a typed number as text', async () => {
		const ask = await open(await book())
		const edited = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [{row: 1, col: 0, input: '0123'}],
			strict: true,
		})
		expect(edited.cells[0]).toMatchObject({text: '0123', kind: 's', style: 3})
	})

	test('an array formula changes only with its top-left cell, which clears the rest of it', async () => {
		const ask = await open(await book())
		const member = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 4, col: 0, input: '1'}], strict: true})
		expect([member.cells, member.skipped]).toEqual([[], 1])
		const anchor = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 3, col: 0, input: '9'}], strict: true})
		expect(texts(anchor)).toEqual([
			[3, 0, '9'],
			[4, 0, ''],
		])
		expect(anchor.arrays).toEqual([])
		const undone = await ask<XlsxEdited>({type: 'restore', step: anchor.step!, to: 'before'})
		expect(texts(undone)).toEqual([
			[3, 0, '4'],
			[4, 0, '0'],
		])
		expect(undone.arrays).toEqual([{top: 3, left: 0, bottom: 4, right: 0}])
		const redone = await ask<XlsxEdited>({type: 'restore', step: anchor.step!, to: 'after'})
		expect(texts(redone)).toEqual(texts(anchor))
	})

	test('an array formula recalculated stays one, and is saved as one with its new value', async () => {
		const ask = await open(
			await workbook({
				sheets: [
					worksheet(
						'<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="array" ref="B1">SUM(A1:A2*C1:C2)</f><v>23</v></c>' +
							'<c r="C1"><v>4</v></c><c r="D1" cm="1"><f t="array" ref="D1:D2">A1*2</f><v>4</v></c></row>' +
							'<row r="2"><c r="A2"><v>3</v></c><c r="C2"><v>5</v></c><c r="D2"><v>4</v></c></row>',
					),
				],
			}),
		)
		const saved = async () =>
			ZipArchive.open(new Uint8Array(await ask<ArrayBuffer>({type: 'save'}))).text('xl/worksheets/sheet1.xml')
		const arrays = [
			{top: 0, left: 1, bottom: 0, right: 1},
			{top: 0, left: 3, bottom: 1, right: 3},
		]
		// Its own formula typed back leaves an array as it is, recalculated or not
		const typeItsOwn = async () => {
			const typed = await ask<XlsxEdited>({
				type: 'edit',
				sheet: 0,
				cells: [{row: 0, col: 3, input: '=A1*2'}],
				strict: true,
			})
			expect([typed.cells.map(({row, col}) => [row, col]), typed.arrays]).toEqual([[[0, 3]], arrays])
		}
		await typeItsOwn()
		await expect(saved()).resolves.toContain('<c r="D2"><v>4</v></c>')
		const edited = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 0, col: 0, input: '10'}], strict: true})
		expect(texts(edited).sort()).toEqual([
			[0, 0, '10'],
			[0, 1, '55'],
			[0, 3, '20'],
		])
		expect(edited.arrays).toEqual(arrays)
		await typeItsOwn()
		// The rest of an array is still its formula's
		const member = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 1, col: 3, input: '1'}], strict: true})
		expect(member.skipped).toBe(1)
		const xml = await saved()
		expect(xml).toContain('<c r="B1"><f t="array" ref="B1">SUM(A1:A2*C1:C2)</f><v>55</v></c>')
		expect(xml).toContain('<c r="D1" cm="1"><f t="array" ref="D1:D2">A1*2</f><v>20</v></c>')
		expect(xml).toContain('<c r="D2"><v>4</v></c>')
		// Retyped, it's an array no more
		const retyped = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [{row: 0, col: 3, input: '=A1*3'}],
			strict: true,
		})
		expect(retyped.arrays).toEqual([{top: 0, left: 1, bottom: 0, right: 1}])
		const again = await saved()
		expect(again).toContain('<c r="D1"><f>A1*3</f><v>30</v></c>')
		expect(again).toContain('<c r="D2"/>')
	})

	test('a sheet’s own defined names stand in for the workbook’s on it', async () => {
		const ask = await open(
			await workbook({
				sheets: [
					{
						name: 'Jan',
						xml: worksheet(
							'<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*TaxRate</f><v>0.2</v></c>' +
								'<c r="C1"><f>A1*LocalOnly</f><v>5</v></c><c r="D1"><v>5</v></c></row>',
						),
					},
					{name: 'Feb', xml: worksheet('<row r="1"><c r="A1"><f>Jan!A1*TaxRate</f><v>0.1</v></c></row>')},
				],
				after:
					'<definedNames><definedName name="LocalOnly" localSheetId="0">Jan!$D$1</definedName>' +
					'<definedName name="TaxRate">0.1</definedName><definedName name="TaxRate" localSheetId="0">0.2</definedName>' +
					'</definedNames>',
			}),
		)
		const edited = await ask<XlsxEdited>({type: 'edit', sheet: 0, cells: [{row: 0, col: 0, input: '3'}], strict: true})
		expect(texts(edited).sort()).toEqual([
			[0, 0, '3'],
			[0, 1, '0.6'],
			[0, 2, '15'],
		])
		expect(await textAt(ask, 1, 0, 0)).toBe('0.3')
	})

	test('a table’s header and totals rows stay as its table part names them', async () => {
		const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
		const people =
			`<table ${main} id="1" name="People" displayName="People" ref="A1:B4" totalsRowCount="1"><tableColumns count="2">` +
			'<tableColumn id="1" name="Name" totalsRowLabel="Total"/><tableColumn id="2" name="Age" totalsRowFunction="sum"/></tableColumns></table>'
		const s = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
		const bytes = await workbook({
			sheets: [
				{
					xml: worksheet(
						`<row r="1">${s('A1', 'Name')}${s('B1', 'Age')}<c r="D1"><v>1</v></c></row>` +
							`<row r="2">${s('A2', 'Ann')}<c r="B2"><v>40</v></c><c r="D2"><v>2</v></c></row>` +
							`<row r="3">${s('A3', 'Bo')}<c r="B3"><v>30</v></c></row>` +
							`<row r="4">${s('A4', 'Total')}<c r="B4"><f>SUM(B2:B3)</f><v>70</v></c></row>`,
						{after: '<tableParts count="2"><tablePart r:id="rId1"/><tablePart r:id="rId2"/></tableParts>'},
					),
					rels: relationships(['rId1', 'table', '../tables/table1.xml'], ['rId2', 'table', '../tables/table2.xml']),
				},
			],
			extra: {
				'xl/tables/table1.xml': people,
				'xl/tables/table2.xml': `<table ${main} id="2" name="Plain" displayName="Plain" ref="D1:D2" headerRowCount="0"/>`,
			},
		})
		const ask = await open(bytes)
		expect((await ask<XlsxSheet>({type: 'sheet', sheet: 0})).headerAndTotalRows).toEqual([
			{top: 0, left: 0, bottom: 0, right: 1},
			{top: 3, left: 0, bottom: 3, right: 1},
		])
		const typed = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [
				{row: 0, col: 0, input: 'Full name'},
				{row: 3, col: 1, input: '1'},
				{row: 0, col: 3, input: '5'},
			],
			strict: true,
		})
		// A table without a header row starts with data
		expect(texts(typed)).toEqual([[0, 3, '5']])
		const cleared = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [],
			strict: true,
			clear: {top: 0, left: 0, bottom: 3, right: 1},
		})
		// The totals formula recalculates, as Excel's would
		expect(texts(cleared).sort()).toEqual([
			[1, 0, ''],
			[1, 1, ''],
			[2, 0, ''],
			[2, 1, ''],
			[3, 1, '0'],
		])
		const saved = new Uint8Array(await ask<ArrayBuffer>({type: 'save'}))
		expect(await ZipArchive.open(saved).text('xl/tables/table1.xml')).toBe(people)
		const sheet = await (await openWorkbook(saved)).loadSheet(0)
		expect([sheet.cell(0, 0)?.value, sheet.cell(3, 0)?.value, sheet.cell(3, 1)?.formula]).toEqual([
			'Name',
			'Total',
			'SUM(B2:B3)',
		])
	})

	test('a protected sheet keeps its locked cells, and its hidden formulas out of view', async () => {
		const ask = await open(
			await workbook({
				styles: styleSheet(
					'<cellXfs count="3"><xf/><xf><protection locked="0"/></xf><xf><protection locked="0" hidden="1"/></xf></cellXfs>',
				),
				sheets: [
					worksheet(
						'<row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c><c r="C1" s="2"><f>A1+B1</f><v>3</v></c></row>',
						{
							before: '<cols><col min="5" max="5" width="9" style="1"/></cols>',
							after: '<sheetProtection sheet="1"/>',
						},
					),
				],
			}),
		)
		expect(await ask<XlsxSheet>({type: 'sheet', sheet: 0})).toMatchObject({protected: true})
		const {cells} = await ask<XlsxCells>({type: 'cells', sheet: 0, range: {top: 0, left: 0, bottom: 0, right: 5}})
		expect(cellsOf(cells)['0:2']).toMatchObject({text: '3', input: '3'})
		// A1 and D1 are locked, as cells are unless their format (or their column's) unlocks them
		const typed = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [
				{row: 0, col: 0, input: '9'},
				{row: 0, col: 1, input: '5'},
				{row: 0, col: 3, input: 'x'},
				{row: 0, col: 4, input: 'y'},
			],
			strict: true,
		})
		expect(texts(typed)).toEqual([
			[0, 1, '5'],
			[0, 2, '6'],
			[0, 4, 'y'],
		])
		expect(typed.cells[1].input).toBe('6')
		// A1 and D1, left as they were
		expect(typed.skipped).toBe(2)
		const cleared = await ask<XlsxEdited>({
			type: 'edit',
			sheet: 0,
			cells: [],
			strict: false,
			clear: {top: 0, left: 0, bottom: 0, right: 4},
		})
		expect(texts(cleared).sort()).toEqual([
			[0, 1, ''],
			[0, 2, ''],
			[0, 4, ''],
		])
		// A1: D1 is empty, so there was nothing to clear
		expect(cleared.skipped).toBe(1)
	})

	test('saves the original patched with every cell that differs from it, however many saves came before', async () => {
		const ask = await open(await book())
		await ask({type: 'edit', sheet: 0, cells: [{row: 0, col: 0, input: '5'}], strict: true})
		await ask({type: 'save'})
		await ask({type: 'edit', sheet: 0, cells: [{row: 5, col: 1, input: 'new'}], strict: true})
		const saved = new Uint8Array(await ask<ArrayBuffer>({type: 'save'}))
		const reopened = await openWorkbook(saved)
		const [first, other] = await Promise.all([reopened.loadSheet(0), reopened.loadSheet(1)])
		expect(first.cell(0, 0)?.value).toBe(5)
		expect(first.cell(0, 1)).toMatchObject({value: 10, formula: 'A1*2'})
		expect(first.cell(5, 1)?.value).toBe('new')
		expect(other.cell(0, 0)).toMatchObject({value: 11, formula: 'Sheet1!B1+1'})
	})

	test('finds text as it’s shown, edits included', async () => {
		const ask = await open(await book())
		expect(await ask({type: 'find', sheet: 0, query: 'HI', start: 0, end: 100})).toEqual([0, 4])
		expect(await ask({type: 'find', sheet: 0, query: '2026', start: 0, end: 100})).toEqual([0, 2, 1, 1])
		await ask({type: 'edit', sheet: 0, cells: [{row: 9, col: 3, input: 'Hide'}], strict: true})
		expect(await ask({type: 'find', sheet: 0, query: 'hi', start: 0, end: 100})).toEqual([0, 4, 9, 3])
		expect(await ask({type: 'find', sheet: 0, query: 'hi', start: 1, end: 5})).toEqual([])
	})

	test('Ctrl+arrow lands on the edges of the data', async () => {
		const ask = await open(await book())
		const edge = (row: number, col: number, direction: string) =>
			ask({type: 'edge', sheet: 0, row, col, direction, rows: 100, cols: 30} as XlsxRequest)
		expect(await edge(0, 0, 'right')).toEqual({row: 0, col: 6})
		expect(await edge(0, 6, 'right')).toEqual({row: 0, col: 29})
		// A2 holds only a style: from A1 the next data down is A4
		expect(await edge(0, 0, 'down')).toEqual({row: 3, col: 0})
		expect(await edge(3, 0, 'down')).toEqual({row: 4, col: 0})
		expect(await edge(4, 0, 'down')).toEqual({row: 99, col: 0})
		expect(await edge(0, 3, 'left')).toEqual({row: 0, col: 0})
		expect(await edge(0, 0, 'up')).toEqual({row: 0, col: 0})
	})

	test('a workbook saved without its formulas’ values is calculated as it’s first drawn', async () => {
		const ask = await open(
			await workbook({
				sheets: [worksheet('<row r="1"><c r="A1"><v>3</v></c><c r="B1"><f>A1*2</f><v></v></c></row>')],
			}),
		)
		const {cells, recalculated} = await ask<XlsxCells>({
			type: 'cells',
			sheet: 0,
			range: {top: 0, left: 0, bottom: 0, right: 5},
		})
		expect(recalculated).toBe(true)
		expect(cellsOf(cells)['0:1']).toMatchObject({text: '6', input: '=A1*2'})
	})
})

describe('inputOf', () => {
	const style = (format: string, quotePrefix = false) => ({format, quotePrefix}) as Parameters<typeof inputOf>[2]
	test.each([
		[46308, 'm/d/yyyy', '2026-10-13'],
		[46308.75, 'm/d/yyyy h:mm', '2026-10-13 18:00:00'],
		[0.6041666666666666, 'h:mm', '14:30:00'],
		[0, 'm/d/yyyy', '0'],
		[60, 'm/d/yyyy', '1900-02-29'],
		[-1, 'm/d/yyyy', '-1'],
		[2.5, '[h]:mm', '2.5'],
		[0.07, '0%', '7%'],
		[0.07, '"%"0', '0.07'],
		[1234.5, '"$"#,##0.00', '1234.5'],
		[0.1 + 0.2, 'General', '0.3'],
	])('%d as %s', (value, format, input) => {
		expect(inputOf(value, undefined, style(format), false)).toBe(input)
	})

	test('other values', () => {
		expect(inputOf(1, 'A1+B1', style('General'), false)).toBe('=A1+B1')
		expect(inputOf(null, undefined, style('General'), false)).toBe('')
		expect(inputOf(false, undefined, style('General'), false)).toBe('FALSE')
		expect(inputOf({error: '#N/A'}, undefined, style('General'), false)).toBe('#N/A')
		expect(inputOf('007', undefined, style('General', true), false)).toBe("'007")
		expect(inputOf(46308 - 1462, undefined, style('m/d/yyyy'), true)).toBe('2026-10-13')
	})
})

// A worker stand-in: the handler at the far end of a real MessageChannel, so
// messages are structured-cloned and transferred buffers detach
function connect() {
	const {port1, port2} = new MessageChannel()
	const handle = createXlsxHandler()
	port2.onmessage = async ({data}: MessageEvent<XlsxCall>) => {
		const {reply, transfer} = await handle(data)
		port2.postMessage(reply, transfer)
	}
	const worker = new EventTarget() as unknown as Worker
	port1.onmessage = ({data}: MessageEvent<XlsxReply>) => worker.dispatchEvent(new MessageEvent('message', {data}))
	Object.assign(worker, {
		postMessage: (message: XlsxCall, transfer: Transferable[]) => port1.postMessage(message, transfer),
		terminate: () => {},
	})
	return {worker, close: () => (port1.close(), port2.close())}
}

describe('createXlsxClient', () => {
	const open: Array<() => void> = []
	afterEach(() => open.splice(0).forEach((close) => close()))

	test('transfers the file in and the saved bytes out, and brings errors back as themselves', async () => {
		const connection = connect()
		open.push(connection.close)
		const xlsx = createXlsxClient(connection.worker)
		const bytes = (await book()).slice().buffer
		expect(await xlsx.open(bytes, 1_000_000)).toMatchObject({
			activeSheet: 0,
			sheets: [{name: 'Sheet1'}, {name: 'Other'}],
		})
		expect(bytes.byteLength).toBe(0)
		const syntax = await xlsx.edit(0, [{row: 0, col: 0, input: '=1+'}], true, WHOLE).catch((error: unknown) => error)
		expect(syntax).toBeInstanceOf(FormulaSyntaxError)
		const saved = await xlsx.save()
		expect(saved.byteLength).toBeGreaterThan(0)
		const corrupt = await xlsx.open(new TextEncoder().encode('a,b\n').buffer, 1000).catch((error: unknown) => error)
		expect(corrupt).toBeInstanceOf(XlsxError)
		expect((corrupt as XlsxError).code).toBe('corrupt')
	})
})
