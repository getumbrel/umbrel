import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'vitest'

import {ZipArchive} from '../../../shared/zip'
import {Calculator, type CellChange} from '../formula/calculator'
import {formatNumber} from './number-format'
import {XlsxError} from './package'
import {calculatorBase, type Sheet} from './sheet'
import {FIXTURES} from './test-helpers'
import {openWorkbook} from './workbook'
import {saveWorkbook, type CellEdit} from './writer'

// The corpus (FILES_FIXTURES); every test here skips when its file isn't there
const path = (name: string) => join(FIXTURES, name.includes('/') ? name : `Samples2/Spreadsheets/${name}`)
const read = (name: string) => new Uint8Array(readFileSync(path(name)))
const fixture = (name: string) => test.skipIf(!FIXTURES || !existsSync(path(name)))

// Every cell of a sheet, row by row
function* cells(sheet: Sheet) {
	for (let row = 0; row < sheet.rowCount; row++)
		for (const col of sheet.rowColumns(row)) yield {row, col, ...sheet.cell(row, col)!}
}

async function unchanged(original: Uint8Array, saved: Uint8Array, changed: string[]) {
	const before = ZipArchive.open(original)
	const after = ZipArchive.open(saved)
	expect(after.entries.map((entry) => entry.name).filter((name) => !changed.includes(name))).toEqual(
		before.entries.map((entry) => entry.name).filter((name) => !changed.includes(name)),
	)
	for (const entry of before.entries) {
		if (changed.includes(entry.name)) continue
		expect(
			after.entries.find((e) => e.name === entry.name),
			entry.name,
		).toEqual(entry)
		expect(
			Buffer.from(await after.bytes(entry.name)).equals(Buffer.from(await before.bytes(entry.name))),
			entry.name,
		).toBe(true)
	}
}

describe("Excel's own TEXT() results (Apache POI's oracle workbooks, computed by Excel for Mac 16)", () => {
	for (const name of ['excel-numfmt-oracle-poi.xlsx', 'excel-datefmt-oracle-poi.xlsx']) {
		fixture(name)(name, async () => {
			const book = await openWorkbook(read(name))
			const sheet = await book.loadSheet(1)
			let checked = 0
			for (let row = 1; row < sheet.rowCount; row++) {
				const result = sheet.cell(row, 0)
				const format = sheet.cell(row, 1)?.value
				const value = sheet.cell(row, 2)?.value
				if (!result?.formula?.startsWith('TEXT(') || typeof format !== 'string') continue
				if (typeof value !== 'number' && typeof value !== 'string') continue
				expect(formatNumber(value, format, {date1904: book.date1904}).text, `row ${row + 1}: ${format}`).toBe(
					result.value,
				)
				checked++
			}
			expect(checked).toBe(name.includes('numfmt') ? 325 : 45)
		})
	}
})

describe('reading', () => {
	fixture('dates-and-formats.xlsx')('dates-and-formats.xlsx shows what Excel shows', async () => {
		const book = await openWorkbook(read('dates-and-formats.xlsx'))
		const formats = await book.loadSheet(0)
		let checked = 0
		for (let row = 1; row < formats.rowCount; row++) {
			const expected = formats.text(row, 5)
			if (!expected) continue
			expect(formats.text(row, 4), `${formats.text(row, 1)}: ${formats.text(row, 2)}`).toBe(expected)
			checked++
		}
		expect(checked).toBeGreaterThanOrEqual(55)
		expect(formats.display(10, 4).color).toBe('#FF0000')
		expect(formats.display(30, 4).fill).toEqual({char: ' ', index: 2})
		const values = await book.loadSheet(1)
		for (let row = 1; row < values.rowCount; row++) {
			if (values.text(row, 0) === 'Multiline') continue
			expect(values.text(row, 1), values.text(row, 0)).toBe(values.text(row, 2))
		}
		expect(values.cell(11, 1)?.value).toBe('')
		expect(values.cell(14, 1)?.value).toBe('Line one\nLine two\nLine three')
	})

	fixture('budget.xlsx')('budget.xlsx: values, formats, layout and what it keeps', async () => {
		const book = await openWorkbook(read('budget.xlsx'))
		expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Expenses', 'Lookup'])
		expect(book.definedNames).toEqual([
			{name: 'Rates', formula: 'Lookup!$A$2:$C$9'},
			{name: '_xlnm.Print_Titles', formula: "'Summary'!$4:$4", sheet: 0},
			{name: '_xlnm._FilterDatabase', formula: "'Expenses'!$A$1:$J$41", sheet: 1},
		])
		const summary = await book.loadSheet(0)
		expect(summary.text(0, 0)).toBe('Household Budget — H2 2026')
		expect(book.styles[summary.cell(0, 0)!.style]).toMatchObject({
			font: {name: 'Arial', size: 18, bold: true, color: '#FFFFFF'},
			fill: {type: 'pattern', pattern: 'solid', color: '#0B3B5C'},
			alignment: {horizontal: 'center', vertical: 'center'},
		})
		expect(summary.merges).toEqual([
			{top: 1, left: 0, bottom: 1, right: 6},
			{top: 0, left: 0, bottom: 0, right: 6},
		])
		expect(summary.frozen).toEqual({rows: 4, cols: 0})
		expect([0, 1, 4, 5, 6].map((col) => summary.colWidthPx(col))).toEqual([210, 98, 91, 105, 77])
		expect([summary.rowHeightPx(0), summary.rowHeightPx(3), summary.rowHeightPx(4)]).toEqual([48, 32, 20])
		expect(summary.text(4, 1)).toBe('$13,100.00')
		expect(summary.cell(4, 2)).toMatchObject({
			value: 13092,
			formula: 'SUMIF(Expenses!$C$2:$C$41,A5,Expenses!$H$2:$H$41)',
		})
		expect(summary.display(9, 3)).toEqual({text: '-$113.70', color: '#FF0000'})
		expect([summary.text(4, 4), summary.text(4, 5), summary.text(12, 1)]).toEqual(['99.9%', 'OK', '$19,730.00'])
		expect([summary.text(17, 1), summary.text(18, 1), summary.text(21, 1)]).toEqual(['1 Jul 2026', '8.25%', '40'])
		expect(summary.hyperlinks).toEqual([
			{
				range: {top: 23, left: 0, bottom: 23, right: 0},
				url: 'https://www.consumerfinance.gov/consumer-tools/budgeting/',
			},
			{range: {top: 24, left: 0, bottom: 24, right: 0}, location: 'Expenses!A1'},
		])
		expect([
			summary.hasDrawings,
			summary.hasCharts,
			summary.hasPivots,
			summary.hasComments,
			summary.hasConditionalFormats,
		]).toEqual([true, true, false, true, true])

		const expenses = await book.loadSheet(1)
		expect(expenses.frozen).toEqual({rows: 1, cols: 1})
		expect([expenses.text(1, 0), expenses.text(1, 8)]).toEqual(['2026-07-01', '2026-07'])
		expect(expenses.cell(1, 8)?.formula).toBe('TEXT(A2,"yyyy-mm")')

		const lookup = await book.loadSheet(2)
		expect(lookup.cell(1, 6)?.value).toBe(true)
		expect([2, 3, 4].map((row) => lookup.text(row, 6))).toEqual(['#DIV/0!', '#N/A', '#N/A'])
		expect(lookup.cell(11, 6)?.runs).toEqual([
			{text: 'Plain, '},
			{text: 'bold, ', font: {bold: true}},
			{text: 'red italic, ', font: {italic: true, color: '#C00000'}},
			{text: 'double underline, ', font: {underline: 'double'}},
			{text: 'struck', font: {strike: true}},
			{text: '2', font: {vertAlign: 'superscript'}},
		])
		const style = (row: number) => book.styles[lookup.cell(row, 6)!.style]
		expect(style(6).alignment).toMatchObject({rotation: 45, horizontal: 'center'})
		expect(style(7).alignment.rotation).toBe(255)
		expect(style(8).alignment.indent).toBe(2)
		expect(style(9).alignment.shrink).toBe(true)
		expect(style(10).alignment).toMatchObject({wrap: true, vertical: 'top'})
		expect(style(12).font).toMatchObject({name: 'Times New Roman', size: 13, italic: true})
		expect(style(14).font).toMatchObject({name: 'Georgia', size: 16, bold: true, color: '#1F4E79'})
		expect(style(15).fill).toEqual({type: 'pattern', pattern: 'lightGrid', color: '#9CA3AF', background: '#FFFFFF'})
		expect([lookup.rowHeightPx(6), lookup.rowHeightPx(7), lookup.colWidthPx(6)]).toEqual([64, 80, 238])

		// Every one of the 220 formulas has the value Excel would have cached
		let formulas = 0
		for (let i = 0; i < 3; i++) {
			for (const cell of cells(await book.loadSheet(i))) {
				if (cell.formula === undefined) continue
				formulas++
				expect(cell.value, `${book.sheets[i].name} ${cell.row},${cell.col}`).not.toBeNull()
			}
		}
		expect(formulas).toBe(220)
	})

	fixture('budget-formulas-no-cache.xlsx')(
		'budget-formulas-no-cache.xlsx: formulas without cached values',
		async () => {
			const book = await openWorkbook(read('budget-formulas-no-cache.xlsx'))
			let formulas = 0
			for (let i = 0; i < 3; i++) {
				for (const cell of cells(await book.loadSheet(i))) {
					if (cell.formula === undefined) continue
					formulas++
					expect(cell.value).toBeNull()
				}
			}
			expect(formulas).toBe(220)
		},
	)

	fixture('unicode.xlsx')('unicode.xlsx: every script, right-to-left sheets and the longest cell', async () => {
		const book = await openWorkbook(read('unicode.xlsx'))
		expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Scripts', 'ورقة عربية', '日本語シート', 'Emoji 😀'])
		const scripts = await book.loadSheet(0)
		expect(scripts.text(2, 1)).toBe(
			'مرحبا بالعالم. هذا نص عربي طويل لاختبار الاتجاه من اليمين إلى اليسار والتفاف الأسطر داخل الخلية.',
		)
		expect(scripts.text(16, 1)).toBe('😀 👍🏽 👨‍👩‍👧‍👦 🇨🇭 🏳️‍🌈 ❤️ 🧑🏿‍💻')
		expect(scripts.text(20, 1)).toBe('𝐀𝐁𝐂 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𠜎𠜱𡃁')
		expect(scripts.text(24, 1)).toHaveLength(32_767)
		expect(scripts.text(25, 1)).toBe('First line\nسطر ثانٍ\n第三行\nLast line')
		expect(book.styles[scripts.cell(2, 1)!.style].alignment).toMatchObject({
			horizontal: 'right',
			readingOrder: 'rtl',
			wrap: true,
		})
		expect([scripts.frozen, scripts.colWidthPx(0), scripts.colWidthPx(1)]).toEqual([{rows: 1, cols: 1}, 182, 420])
		const arabic = await book.loadSheet(1)
		expect(arabic.rightToLeft).toBe(true)
		expect([arabic.text(1, 3), arabic.text(5, 3)]).toEqual(['30.00 ر.س', '73.50 ر.س'])
		expect(arabic.cell(5, 3)?.formula).toBe('SUM(D2:D5)')
		expect((await book.loadSheet(2)).text(1, 3)).toBe('2019年4月1日')
		expect((await book.loadSheet(3)).text(1, 0)).toBe('🍎')
	})

	fixture('wide.xlsx')('wide.xlsx: 60 columns of every type, without a dimension', async () => {
		const sheet = await (await openWorkbook(read('wide.xlsx'))).loadSheet(0)
		expect([sheet.rowCount, sheet.colCount, sheet.frozen]).toEqual([2001, 60, {rows: 1, cols: 1}])
		expect([sheet.colWidthPx(0), sheet.colWidthPx(9), sheet.text(0, 0), sheet.text(1, 0)]).toEqual([
			98,
			252,
			'id_01',
			'1',
		])
		for (let row = 1; row < sheet.rowCount; row += 97) {
			expect(sheet.text(row, 3)).toMatch(/^\$[\d,]+\.\d\d$/)
			expect(sheet.text(row, 4)).toMatch(/^\d+\.\d\d%$/)
			expect(sheet.text(row, 5)).toMatch(/^20\d\d-\d\d-\d\d$/)
			expect(sheet.text(row, 6)).toMatch(/^20\d\d-\d\d-\d\d \d\d:\d\d$/)
			expect(sheet.text(row, 7)).toMatch(/^(TRUE|FALSE)$/)
			const negative = sheet.display(row, 11)
			expect(negative.color).toBe((sheet.cell(row, 11)!.value as number) < 0 ? '#FF0000' : undefined)
		}
	})

	fixture('Samples/Spreadsheets/sheet.xlsx')('sheet.xlsx: 260,000 cells and formulas never calculated', async () => {
		const sheet = await (await openWorkbook(read('Samples/Spreadsheets/sheet.xlsx'))).loadSheet(0)
		expect([sheet.rowCount, sheet.colCount, sheet.text(0, 0), sheet.cell(1, 0)?.value]).toEqual([
			20001,
			13,
			'col0',
			516,
		])
		expect(sheet.cell(1, 12)).toEqual({value: null, formula: 'SUM(A2:L2)', style: 0})
		expect(sheet.cell(20000, 12)?.formula).toBe('SUM(A20001:L20001)')
	})

	fixture('Samples/Spreadsheets/r200k.xlsx')('r200k.xlsx: two million cells', {timeout: 60_000}, async () => {
		const start = performance.now()
		const book = await openWorkbook(read('Samples/Spreadsheets/r200k.xlsx'))
		const sheet = await book.loadSheet(0)
		const elapsed = performance.now() - start
		expect([sheet.rowCount, sheet.colCount]).toEqual([200_001, 10])
		expect([sheet.text(0, 0), sheet.text(1, 0), sheet.cell(2, 1)?.value, sheet.text(200_000, 9)]).toEqual([
			'Header 0',
			'text 0-0',
			1.5,
			'text 199999-9',
		])
		expect(book.styles[0].format).toBe('General')
		console.log(`r200k.xlsx: first sheet ready in ${elapsed.toFixed(0)} ms`)
		expect(elapsed).toBeLessThan(15_000)
	})

	fixture('chartsheet-pivots-poi.xlsx')('chart sheets and pivot tables (Excel 2007)', async () => {
		const book = await openWorkbook(read('chartsheet-pivots-poi.xlsx'))
		expect(book.sheets.map((sheet) => sheet.kind)).toEqual([...new Array(6).fill('worksheet'), 'chartsheet'])
		const sheets = await Promise.all(book.sheets.map((_, i) => book.loadSheet(i)))
		expect(sheets.map((sheet) => sheet.hasPivots)).toEqual([false, true, true, true, true, true, false])
		expect([sheets[6].hasCharts, sheets[6].rowCount]).toEqual([true, 0])
		expect(sheets[0].text(1, 2)).toBe('$889,017 ')
	})

	fixture('strict-ooxml-poi.xlsx')('Strict OOXML namespaces', async () => {
		const book = await openWorkbook(read('strict-ooxml-poi.xlsx'))
		expect(book.sheets.map((sheet) => sheet.name)).toEqual(['First Sheet', 'Sheet Number 2', 'Sheet3'])
		const first = await book.loadSheet(0)
		expect([first.text(0, 0), first.text(1, 1)]).toEqual(['Test spreadsheet', '2nd row 2nd column'])
		expect(book.styles[first.cell(3, 0)!.style].font.color).toBe('#FF0000')
		expect((await book.loadSheet(1)).text(3, 0)).toBe("I'm in bold blue, on a yellow background")
	})

	fixture('theme-colours-cyrillic-poi.xlsx')('theme colours with tints', async () => {
		const book = await openWorkbook(read('theme-colours-cyrillic-poi.xlsx'))
		expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Лист1', 'Лист2', 'Лист3'])
		const sheet = await book.loadSheet(0)
		// "Orange, Accent 6, Darker 25%" in the Office 2007 theme
		expect(book.styles[sheet.cell(0, 0)!.style].font.color).toBe('#E46C0A')
		expect(book.styles[sheet.cell(0, 1)!.style].font.color).toBe('#FF0000')
	})

	fixture('table-listobject-poi.xlsx')('tables and their names', async () => {
		const book = await openWorkbook(read('table-listobject-poi.xlsx'))
		expect(book.definedNames.map((name) => name.formula)).toEqual(['ExcelTable!$A$1:$C$4', 'TableName[#All]'])
		const sheet = await book.loadSheet(0)
		expect([sheet.text(3, 0), sheet.cell(1, 2)?.formula]).toEqual(['Cäsar', 'INT(B2/10)'])
		// TableName spans G1:I4, with a header row and no totals
		expect(sheet.headerAndTotalRows).toEqual([{top: 0, left: 6, bottom: 0, right: 8}])
	})

	fixture('conditional-formatting-x14-poi.xlsx')('Excel 2010 conditional formatting stays out of the way', async () => {
		const sheet = await (await openWorkbook(read('conditional-formatting-x14-poi.xlsx'))).loadSheet(0)
		expect([sheet.rowCount, sheet.colCount, sheet.cell(1, 2)?.formula]).toEqual([17, 21, '$A2'])
		// Not drawn, but said so
		expect(sheet.hasConditionalFormats).toBe(true)
	})

	fixture('hostile-zip-bomb-1gib.xlsx')('a zip bomb is refused before it inflates', async () => {
		const book = await openWorkbook(read('hostile-zip-bomb-1gib.xlsx'))
		const start = performance.now()
		const error = await book.loadSheet(0).catch((error: unknown) => error)
		expect(error).toBeInstanceOf(XlsxError)
		expect((error as XlsxError).code).toBe('limits')
		expect(performance.now() - start).toBeLessThan(1000)
	})

	fixture('not-a-zip.xlsx')('a text file named .xlsx', async () => {
		const error = await openWorkbook(read('not-a-zip.xlsx')).catch((error: unknown) => error)
		expect((error as XlsxError).code).toBe('corrupt')
	})
})

describe('calculating', () => {
	// The worker's calculator holds a workbook's formula cells and reads its values through the sheets: it must
	// calculate as one holding every cell does
	test
		.skipIf(!FIXTURES)
		.each([
			'budget.xlsx',
			'budget-formulas-no-cache.xlsx',
			'unicode.xlsx',
			'dates-and-formats.xlsx',
			'wide.xlsx',
			'conditional-formatting-x14-poi.xlsx',
			'excel-datefmt-oracle-poi.xlsx',
			'excel-numfmt-oracle-poi.xlsx',
			'table-listobject-poi.xlsx',
			'strict-ooxml-poi.xlsx',
			'chartsheet-pivots-poi.xlsx',
			'theme-colours-cyrillic-poi.xlsx',
			'Samples/Spreadsheets/sheet.xlsx',
		])('%s calculates the same with its values read through the sheets', async (name) => {
		if (!existsSync(path(name))) return
		const workbook = await openWorkbook(read(name))
		const sheets = await Promise.all(workbook.sheets.map((_, i) => workbook.loadSheet(i)))
		const names = workbook.sheets.map((sheet) => sheet.name)
		const all = sheets.flatMap((sheet, i) =>
			[...cells(sheet)]
				.filter((cell) => cell.value !== null || cell.formula !== undefined)
				.map(({row, col, value, formula}) => ({address: {sheet: i, row, col}, value, formula})),
		)
		const formulas = sheets.flatMap((sheet, i) =>
			[...sheet.formulaCells()].map(({row, col, value, formula}) => ({
				address: {sheet: i, row, col},
				value,
				formula,
			})),
		)
		expect(all.length).toBeGreaterThan(0)
		expect(formulas).toEqual(all.filter((cell) => cell.formula !== undefined))
		const holding = new Calculator(names, all)
		const through = new Calculator(names, formulas, {base: calculatorBase(sheets)})
		const said = (changes: CellChange[]) => changes.map(({address, value}) => [address, value])
		expect(said(through.recalculate())).toEqual(said(holding.recalculate()))
		const values = all.filter((cell) => cell.formula === undefined)
		for (const {address, value} of values.filter((_, i) => i % Math.max(1, Math.floor(values.length / 40)) === 0)) {
			expect(said(through.set(address, '7'))).toEqual(said(holding.set(address, '7')))
			expect(said(through.set(address, ''))).toEqual(said(holding.set(address, '')))
			expect(said(through.restore([{address, value}]))).toEqual(said(holding.restore([{address, value}])))
		}
	})
})

describe('saving', () => {
	fixture('budget.xlsx')('budget.xlsx keeps its charts, comments, validation and formatting', async () => {
		const original = read('budget.xlsx')
		const edits: CellEdit[] = [
			{sheet: 0, row: 4, col: 1, value: 14000},
			{sheet: 0, row: 4, col: 3, value: 908, formula: 'B5-C5'},
			{sheet: 0, row: 29, col: 8, value: 'Reviewed ✓'},
			{sheet: 2, row: 1, col: 6, value: false},
		]
		const saved = await saveWorkbook(original, edits)
		await unchanged(original, saved, ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml'])
		const xml = await ZipArchive.open(saved).text('xl/worksheets/sheet1.xml')
		for (const kept of [
			'<mergeCells',
			'<conditionalFormatting',
			'<dataValidations',
			'<hyperlinks',
			'<drawing ',
			'<legacyDrawing ',
			'<headerFooter',
		]) {
			expect(xml).toContain(kept)
		}
		expect(xml).toContain('<dimension ref="A1:I30"/>')
		const book = await openWorkbook(saved)
		const summary = await book.loadSheet(0)
		expect([summary.text(4, 1), summary.cell(4, 3)?.formula, summary.text(4, 3), summary.text(29, 8)]).toEqual([
			'$14,000.00',
			'B5-C5',
			'$908.00',
			'Reviewed ✓',
		])
		// The edited cells keep their style
		expect(summary.cell(4, 1)?.style).toBe((await (await openWorkbook(original)).loadSheet(0)).cell(4, 1)?.style)
		expect((await book.loadSheet(2)).cell(1, 6)?.value).toBe(false)
	})

	fixture('excel-numfmt-oracle-poi.xlsx')('a workbook saved by Excel loses its calculation chain', async () => {
		const original = read('excel-numfmt-oracle-poi.xlsx')
		const saved = await saveWorkbook(original, [{sheet: 1, row: 1, col: 2, value: 99.5}])
		const changed = [
			'xl/worksheets/sheet2.xml',
			'xl/calcChain.xml',
			'[Content_Types].xml',
			'xl/_rels/workbook.xml.rels',
			'xl/workbook.xml',
		]
		await unchanged(original, saved, changed)
		const archive = ZipArchive.open(saved)
		expect(archive.has('xl/calcChain.xml')).toBe(false)
		expect(await archive.text('[Content_Types].xml')).not.toContain('calcChain')
		expect(await archive.text('xl/_rels/workbook.xml.rels')).not.toContain('calcChain')
		expect(await archive.text('xl/workbook.xml')).toMatch(/<calcPr [^>]*fullCalcOnLoad="1"/)
		const sheet = await (await openWorkbook(saved)).loadSheet(1)
		expect(sheet.cell(1, 2)?.value).toBe(99.5)
		// The formula reading it keeps its old cached value until Excel recalculates
		expect(sheet.cell(1, 0)).toMatchObject({value: '12.34', formula: 'TEXT(C2, B2)'})
	})

	fixture('unicode.xlsx')('right-to-left and shared-string sheets take edits in any script', async () => {
		const saved = await saveWorkbook(read('unicode.xlsx'), [
			{sheet: 1, row: 1, col: 0, value: 'تفاح أحمر'},
			{sheet: 1, row: 1, col: 1, value: 20},
			{sheet: 1, row: 1, col: 3, value: 50, formula: 'B2*C2'},
			{sheet: 2, row: 4, col: 0, value: '高橋 一郎'},
		])
		const book = await openWorkbook(saved)
		const arabic = await book.loadSheet(1)
		expect([arabic.text(1, 0), arabic.text(1, 1), arabic.text(1, 3), arabic.rightToLeft]).toEqual([
			'تفاح أحمر',
			'20',
			'50.00 ر.س',
			true,
		])
		expect((await book.loadSheet(2)).text(4, 0)).toBe('高橋 一郎')
	})

	fixture('strict-ooxml-poi.xlsx')('Strict OOXML', async () => {
		const original = read('strict-ooxml-poi.xlsx')
		const saved = await saveWorkbook(original, [{sheet: 0, row: 5, col: 0, value: 'added'}])
		const sheet = await (await openWorkbook(saved)).loadSheet(0)
		expect([sheet.text(0, 0), sheet.text(5, 0)]).toEqual(['Test spreadsheet', 'added'])
	})

	fixture('Samples/Spreadsheets/r200k.xlsx')(
		'r200k.xlsx: edits at both ends of 81 MB of XML',
		{timeout: 60_000},
		async () => {
			const original = read('Samples/Spreadsheets/r200k.xlsx')
			const start = performance.now()
			const saved = await saveWorkbook(original, [
				{sheet: 0, row: 1, col: 0, value: 'first'},
				{sheet: 0, row: 200_000, col: 9, value: 'last'},
				{sheet: 0, row: 200_001, col: 0, value: 'appended'},
			])
			console.log(`r200k.xlsx: saved in ${(performance.now() - start).toFixed(0)} ms`)
			await unchanged(original, saved, ['xl/worksheets/sheet1.xml', 'xl/workbook.xml'])
			const sheet = await (await openWorkbook(saved)).loadSheet(0)
			expect([sheet.text(1, 0), sheet.text(200_000, 9), sheet.text(200_001, 0), sheet.text(100_000, 3)]).toEqual([
				'first',
				'last',
				'appended',
				'text 99999-3',
			])
			expect(sheet.rowCount).toBe(200_002)
		},
	)
})
