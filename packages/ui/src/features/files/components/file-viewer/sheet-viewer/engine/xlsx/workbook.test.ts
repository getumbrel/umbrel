import {describe, expect, test} from 'vitest'

import {XlsxError} from './package'
import {relationships, sharedStrings, styleSheet, workbook, worksheet, zip, type WorkbookSpec} from './test-helpers'
import {openWorkbook} from './workbook'

const open = async (spec: WorkbookSpec, maxCells?: number) => openWorkbook(await workbook(spec), {maxCells})
const sheetOf = async (spec: WorkbookSpec) => (await open(spec)).loadSheet(0)
const rejects = async (promise: Promise<unknown>, code: XlsxError['code']) => {
	const error = await promise.then(
		() => undefined,
		(error: unknown) => error,
	)
	expect(error).toBeInstanceOf(XlsxError)
	expect((error as XlsxError).code).toBe(code)
}
const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test"><a:themeElements>
<a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FEFEFE"/></a:lt1>
<a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Test"><a:majorFont><a:latin typeface="Major Font"/></a:majorFont><a:minorFont><a:latin typeface="Minor Font"/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`

describe('cells', () => {
	test('values of every type', async () => {
		const sheet = await sheetOf({
			sharedStrings: sharedStrings('first', 'second'),
			sheets: [
				worksheet(
					'<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>42.5</v></c><c r="C1" t="b"><v>1</v></c>' +
						'<c r="D1" t="b"><v>0</v></c><c r="E1" t="e"><v>#DIV/0!</v></c><c r="F1" t="inlineStr"><is><t>inline</t></is></c>' +
						'<c r="G1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="H1" t="d"><v>2026-03-14T12:00:00Z</v></c>' +
						'<c r="I1" s="0"/><c r="J1"><f>SUM(B1:B2)</f></c><c r="K1" t="e"><v>#GETTING_DATA</v></c>' +
						'<c r="L1" t="s"><v>99</v></c><c r="M1"><v></v></c><c r="N1" t="str"><f>""</f><v></v></c>' +
						'<c r="O1"><v>1e3</v></c><c r="P1"><v> </v></c><c r="Q1" t="d"><v>not a date</v></c>' +
						'<c r="R1" t="n"><v>-0.5</v></c><c r="S1" t="b"><v>true</v></c><c r="T1" t="inlineStr"/>' +
						'<c r="U1"><v>1.797693134862316e+308</v></c><c r="V1"><v>-1e999</v></c><c r="W1"><v>Infinity</v></c></row>',
				),
			],
		})
		const value = (col: number) => sheet.cell(0, col)?.value
		expect(sheet.cell(0, 0)).toEqual({value: 'second', style: 0})
		expect([1, 2, 3].map(value)).toEqual([42.5, true, false])
		expect(value(4)).toEqual({error: '#DIV/0!'})
		expect(value(5)).toBe('inline')
		expect(sheet.cell(0, 6)).toEqual({value: 'ab', formula: '"a"&"b"', style: 0})
		expect(value(7)).toBe(serial(2026, 3, 14) + 0.5)
		expect(sheet.cell(0, 8)).toEqual({value: null, style: 0})
		expect(sheet.cell(0, 9)).toEqual({value: null, formula: 'SUM(B1:B2)', style: 0})
		// An error Excel has that we don't model still shows as written
		expect(value(10)).toEqual({error: '#VALUE!'})
		expect(sheet.text(0, 10)).toBe('#GETTING_DATA')
		expect([11, 12].map(value)).toEqual([null, null])
		expect(sheet.cell(0, 13)).toEqual({value: '', formula: '""', style: 0})
		expect([14, 15, 16, 17, 18].map(value)).toEqual([1000, null, 'not a date', -0.5, true])
		// An inline string with no content is "", and a largest double written with 16 digits stays the largest double
		expect([19, 20, 21, 22].map(value)).toEqual(['', Number.MAX_VALUE, -Number.MAX_VALUE, null])
		expect(sheet.text(0, 20)).toBe('1.79769E+308')
		expect([0, 1, 2, 3, 4, 7, 8, 13].map((col) => sheet.text(0, col))).toEqual([
			'second',
			'42.5',
			'TRUE',
			'FALSE',
			'#DIV/0!',
			'46095.5',
			'',
			'',
		])
		expect(sheet.cell(0, 23)).toBeUndefined()
		expect(sheet.cell(1, 0)).toBeUndefined()
		expect(sheet.cell(-1, 0)).toBeUndefined()
		expect(sheet.cell(0.5, 0)).toBeUndefined()
		expect([sheet.rowCount, sheet.colCount]).toEqual([1, 23])
	})

	test('shared strings: rich text, phonetic guides and escapes', async () => {
		const sheet = await sheetOf({
			sharedStrings: sharedStrings(
				'<t xml:space="preserve"> padded </t>',
				'<r><rPr><b/><sz val="14"/><color theme="1"/><rFont val="Arial"/></rPr><t>Bold</t></r><r><t xml:space="preserve"> plain</t></r>',
				'<t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh><phoneticPr fontId="1"/>',
				'<t>Line_x000D_\nnext _x005F_x0041_ &amp; &lt;tag&gt; <![CDATA[<raw>]]></t>',
				'<t/>',
				'<t>lead</t><r><t>run</t></r>',
			),
			sheets: [
				worksheet(
					[0, 1, 2, 3, 4, 5].map((i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${i}</v></c></row>`).join(''),
				),
			],
		})
		expect(sheet.cell(0, 0)?.value).toBe(' padded ')
		expect(sheet.cell(1, 0)).toEqual({
			value: 'Bold plain',
			style: 0,
			runs: [{text: 'Bold', font: {bold: true, size: 14, color: '#000000', name: 'Arial'}}, {text: ' plain'}],
		})
		expect(sheet.cell(2, 0)?.value).toBe('漢字')
		expect(sheet.cell(3, 0)?.value).toBe('Line\r\nnext _x0041_ & <tag> <raw>')
		expect(sheet.cell(4, 0)?.value).toBe('')
		expect(sheet.cell(5, 0)?.runs).toEqual([{text: 'lead'}, {text: 'run'}])
	})

	test('inline strings, with their runs and phonetic guides flattened', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row r="1"><c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>Rich</t></r><r><t xml:space="preserve"> text</t></r>' +
						'<rPh><t>ignored</t></rPh></is></c><c r="B1" t="inlineStr"><is/></c><c r="C1" t="inlineStr"><v>from v</v></c>' +
						`<c r="D1" t="inlineStr"><is><t>${'x'.repeat(40_000)}</t></is></c></row>`,
				),
			],
		})
		expect(sheet.cell(0, 0)).toEqual({
			value: 'Rich text',
			style: 0,
			runs: [{text: 'Rich', font: {bold: true}}, {text: ' text'}],
		})
		expect(sheet.cell(0, 1)?.value).toBe('')
		expect(sheet.cell(0, 2)?.value).toBe('from v')
		// Past Excel's 32,767-character limit text is cut
		expect(sheet.cell(0, 3)?.value).toHaveLength(32_767)
	})

	test('shared formulas expand to each member', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row r="2"><c r="A2"><v>1</v></c><c r="B2"><f t="shared" ref="B2:C4" si="0">A2*2+$A$1</f><v>2</v></c>' +
						'<c r="C2"><f t="shared" si="0"/><v>4</v></c></row><row r="3"><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>' +
						'<row r="4"><c r="C4"><f t="shared" si="0"/><v>8</v></c><c r="D4"><f t="shared" si="7"/><v>0</v></c></row>',
				),
			],
		})
		expect(sheet.cell(1, 1)?.formula).toBe('A2*2+$A$1')
		expect(sheet.cell(1, 2)?.formula).toBe('B2*2+$A$1')
		expect(sheet.cell(2, 1)?.formula).toBe('A3*2+$A$1')
		expect(sheet.cell(3, 2)).toEqual({value: 8, formula: 'B4*2+$A$1', style: 0})
		// A member whose master is missing keeps its cached value without a formula
		expect(sheet.cell(3, 3)).toEqual({value: 0, style: 0})
	})

	test('formulas show without the prefixes files store newer functions with', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row r="1"><c r="A1"><f>_xlfn.XLOOKUP(B1,C:C,D:D)&amp;_xlfn._xlws.FILTER(C:C,D:D)</f><v>0</v></c>' +
						'<c r="B1" t="str"><f>"_xlfn.kept"&amp;_xlfn.CONCAT(\'_xlfn. sheet\'!A1)</f><v>x</v></c>' +
						'<c r="C1"><f t="shared" ref="C1:C2" si="0">_xlfn.IFNA(A1,0)</f><v>0</v></c></row>' +
						'<row r="2"><c r="C2"><f t="shared" si="0"/><v>0</v></c></row>',
				),
			],
		})
		expect(sheet.cell(0, 0)?.formula).toBe('XLOOKUP(B1,C:C,D:D)&FILTER(C:C,D:D)')
		expect(sheet.cell(0, 1)?.formula).toBe('"_xlfn.kept"&CONCAT(\'_xlfn. sheet\'!A1)')
		expect(sheet.cell(1, 2)?.formula).toBe('IFNA(A2,0)')
	})

	test('array formulas and data tables', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row r="1"><c r="C1"><f t="array" ref="C1:C3">A1:A3*2</f><v>2</v></c>' +
						'<c r="D1"><f t="dataTable" ref="D1:D2" dt2D="0" dtr="0" r1="A1"/><v>5</v></c>' +
						'<c r="E1" cm="1"><f t="array" ref="E1:F2">_xlfn.SEQUENCE(2,2)</f><v>1</v></c></row>' +
						'<row r="2"><c r="C2"><v>4</v></c></row>',
				),
			],
		})
		expect(sheet.arrays).toEqual([
			{top: 0, left: 2, bottom: 2, right: 2},
			{top: 0, left: 4, bottom: 1, right: 5},
		])
		expect(sheet.cell(0, 2)?.formula).toBe('A1:A3*2')
		expect(sheet.cell(1, 2)).toEqual({value: 4, style: 0})
		expect(sheet.cell(0, 3)).toEqual({value: 5, style: 0})
		expect(sheet.cell(0, 4)?.formula).toBe('SEQUENCE(2,2)')
	})

	test('rows and cells without references, out of order or repeated', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row><c><v>1</v></c><c><v>2</v></c><c r="E1"><v>5</v></c><c><v>6</v></c></row><row><c><v>7</v></c></row>' +
						'<row r="5"><c r="B5"><v>1</v></c><c r="A5"><v>2</v></c><c r="C5"><f>A5</f><v>2</v></c></row>' +
						'<row r="4"><c r="A4"><v>3</v></c></row><row r="5"><c r="A5"><v>9</v></c></row>',
				),
			],
		})
		const values = [
			[0, 0],
			[0, 1],
			[0, 4],
			[0, 5],
			[1, 0],
			[3, 0],
			[4, 0],
			[4, 1],
		].map(([r, c]) => sheet.cell(r, c)?.value)
		expect(values).toEqual([1, 2, 5, 6, 7, 3, 9, 1])
		// Formulas move with their cells when sorting
		expect(sheet.cell(4, 2)?.formula).toBe('A5')
		expect([...sheet.rowColumns(0)]).toEqual([0, 1, 4, 5])
		expect([...sheet.rowColumns(4)]).toEqual([0, 1, 2])
		expect([...sheet.rowColumns(2)]).toEqual([])
		expect([...sheet.rowColumns(99)]).toEqual([])
		expect([sheet.rowCount, sheet.colCount]).toEqual([5, 6])
	})

	test('prefixed SpreadsheetML elements', async () => {
		const xml =
			'<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1">' +
			'<x:c r="A1" t="inlineStr"><x:is><x:t>prefixed</x:t></x:is></x:c><x:c r="B1"><x:f>A1</x:f><x:v>3</x:v></x:c></x:row>' +
			'</x:sheetData><x:mergeCells><x:mergeCell ref="A2:B2"/></x:mergeCells></x:worksheet>'
		const sheet = await sheetOf({sheets: [xml]})
		expect(sheet.cell(0, 0)?.value).toBe('prefixed')
		expect(sheet.cell(0, 1)).toEqual({value: 3, formula: 'A1', style: 0})
		expect(sheet.merges).toEqual([{top: 1, left: 0, bottom: 1, right: 1}])
	})

	test('references off the sheet are skipped', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet(
					'<row r="1"><c r="XFE1"><v>1</v></c><c r="A0"><v>1</v></c><c r="AAAA1"><v>1</v></c><c r="1A"><v>1</v></c>' +
						'<c r="A1048577"><v>1</v></c><c r="XFD1048576"><v>2</v></c></row>',
				),
			],
		})
		expect([sheet.rowCount, sheet.colCount]).toEqual([1_048_576, 16_384])
		expect(sheet.cell(1_048_575, 16_383)?.value).toBe(2)
		expect([...sheet.rowColumns(0)]).toEqual([])
	})

	test('styled cells format through their number format', async () => {
		const sheet = await sheetOf({
			styles: styleSheet(
				'<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00;&quot;zero&quot;;&quot;Note: &quot;@"/></numFmts>' +
					'<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs>',
			),
			sheets: [
				worksheet(
					'<row r="1"><c r="A1" s="1"><v>-1234.5</v></c><c r="B1" s="1"><v>0</v></c><c r="C1" s="1" t="inlineStr"><is><t>x</t></is></c>' +
						`<c r="D1" s="2"><v>${serial(2026, 3, 14)}</v></c><c r="E1" s="9"><v>1.5</v></c><c r="F1" s="1" t="b"><v>1</v></c></row>`,
				),
			],
		})
		expect(sheet.display(0, 0)).toEqual({text: '-1,234.50', color: '#FF0000'})
		expect(sheet.text(0, 1)).toBe('zero')
		expect(sheet.text(0, 2)).toBe('Note: x')
		expect(sheet.text(0, 3)).toBe('3/14/2026')
		// A style index past the end falls back to the default
		expect(sheet.cell(0, 4)?.style).toBe(0)
		expect(sheet.text(0, 4)).toBe('1.5')
		expect(sheet.text(0, 5)).toBe('TRUE')
		expect(sheet.display(5, 5)).toEqual({text: ''})
	})
})

describe('sheet layout', () => {
	const twoStyles = styleSheet('<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="10"/></cellXfs>')

	test('column widths, row heights, hidden lines and line styles', async () => {
		const sheet = await sheetOf({
			styles: twoStyles,
			sheets: [
				worksheet(
					'<row r="1" ht="36" customHeight="1"><c r="A1"><v>1</v></c></row><row r="2" hidden="1"/>' +
						'<row r="3" s="1" customFormat="1"/><row r="4" ht="5000"/>',
					{
						before:
							'<sheetFormatPr baseColWidth="10" defaultRowHeight="18"/><cols><col min="1" max="1" width="30" customWidth="1"/>' +
							'<col min="2" max="3" width="0" hidden="1"/><col min="4" max="4" style="1"/><col min="5" max="99999" width="5"/>' +
							'<col min="7" max="6" width="9"/><col min="0" max="2" width="9"/></cols>',
					},
				),
			],
		})
		// trunc(((256 × 30 + trunc(128 / 7)) / 256) × 7) = 210
		expect(sheet.colWidthPx(0)).toBe(210)
		expect([sheet.colWidthPx(1), sheet.isColHidden(1), sheet.isColHidden(0)]).toEqual([0, true, false])
		// baseColWidth 10 makes 10 × 7 + 5 = 75 px, which Excel rounds up to 80
		expect(sheet.colWidthPx(3)).toBe(80)
		expect([sheet.colWidthPx(4), sheet.colWidthPx(16_383), sheet.colWidthPx(20_000)]).toEqual([35, 35, 80])
		expect(sheet.rowHeightPx(0)).toBe(48)
		expect([sheet.rowHeightPx(1), sheet.isRowHidden(1), sheet.isRowHidden(0)]).toEqual([0, true, false])
		expect([sheet.rowHeightPx(2), sheet.rowHeightPx(99)]).toEqual([24, 24])
		// Excel's ceiling of 409 points
		expect(sheet.rowHeightPx(3)).toBe(545)
		expect(sheet.styleAt(2, 0)).toBe(1)
		expect(sheet.styleAt(9, 3)).toBe(1)
		expect(sheet.styleAt(9, 0)).toBe(0)
		expect(sheet.styleAt(0, 0)).toBe(0)
		// The lines' own styles, for drawing the cells they have none of
		expect([sheet.rowStyle(2), sheet.rowStyle(0), sheet.rowStyle(5000)]).toEqual([1, undefined, undefined])
		expect([sheet.colStyle(3), sheet.colStyle(0), sheet.colStyle(20_000)]).toEqual([1, undefined, undefined])
		expect([sheet.defaultRowHeightPx, sheet.defaultColWidthPx]).toEqual([24, 80])
	})

	test('default sizes', async () => {
		const explicit = await sheetOf({
			sheets: [worksheet('', {before: '<sheetFormatPr defaultColWidth="12" defaultRowHeight="15"/>'})],
		})
		expect([explicit.colWidthPx(0), explicit.rowHeightPx(0)]).toEqual([84, 20])
		// Calibri 11's 8.43 characters
		const none = await sheetOf({sheets: [worksheet('')]})
		expect([none.colWidthPx(0), none.rowHeightPx(0)]).toEqual([64, 20])
	})

	test('rows hidden by default show only when listed', async () => {
		const sheet = await sheetOf({
			sheets: [
				worksheet('<row r="1"><c r="A1"><v>1</v></c></row><row r="3" hidden="1"/>', {
					before: '<sheetFormatPr defaultRowHeight="15" zeroHeight="1"/>',
				}),
			],
		})
		expect([0, 1, 2, 10].map((row) => sheet.isRowHidden(row))).toEqual([false, true, true, true])
		expect([0, 1].map((row) => sheet.rowHeightPx(row))).toEqual([20, 0])
		expect(sheet.defaultRowHeightPx).toBe(0)
	})

	test('views, merges and hyperlinks', async () => {
		const sheet = await sheetOf({
			sheets: [
				{
					xml: worksheet('<row r="1"><c r="A1"><v>1</v></c></row>', {
						before:
							'<sheetViews><sheetView showGridLines="0" zoomScale="85" rightToLeft="1" workbookViewId="0"><pane xSplit="2" ySplit="3" ' +
							'topLeftCell="C4" activePane="bottomRight" state="frozen"/></sheetView><sheetView workbookViewId="1" zoomScale="200">' +
							'<pane xSplit="5" ySplit="5" state="frozen"/></sheetView></sheetViews>',
						after:
							'<mergeCells count="3"><mergeCell ref="A1:C1"/><mergeCell ref="B3"/><mergeCell ref="E5:D4"/><mergeCell ref="bad"/></mergeCells>' +
							'<hyperlinks><hyperlink ref="A1" r:id="rId1"/><hyperlink ref="A2" location="\'Sheet 2\'!B5" display="x"/>' +
							'<hyperlink ref="A3" r:id="rId2"/><hyperlink ref="A4:B4" r:id="rId3" tooltip="Write"/>' +
							'<hyperlink ref="A5" r:id="rId4" location="part"/><hyperlink ref="A6" r:id="rId5"/><hyperlink ref="A7" r:id="rId9"/>' +
							'<hyperlink ref="A8" r:id="rId6"/></hyperlinks>',
					}),
					rels: relationships(
						['rId1', 'hyperlink', 'https://umbrel.com', true],
						['rId2', 'hyperlink', ' javascript:alert(1)', true],
						['rId3', 'hyperlink', 'mailto:hi@example.com', true],
						['rId4', 'hyperlink', 'https://example.com/page', true],
						['rId5', 'hyperlink', '#Sheet2!A1', true],
						['rId6', 'hyperlink', 'https://', true],
					),
				},
			],
		})
		expect([sheet.showGridLines, sheet.zoomScale, sheet.rightToLeft]).toEqual([false, 85, true])
		expect(sheet.frozen).toEqual({rows: 3, cols: 2})
		expect(sheet.merges).toEqual([
			{top: 0, left: 0, bottom: 0, right: 2},
			{top: 3, left: 3, bottom: 4, right: 4},
		])
		const range = (top: number, left: number, right = left) => ({top, left, bottom: top, right})
		// javascript:, a missing relationship and a web-shaped target that isn't a URL leave nothing to open
		expect(sheet.hyperlinks).toEqual([
			// As the browser opens it
			{range: range(0, 0), url: 'https://umbrel.com/'},
			{range: range(1, 0), location: "'Sheet 2'!B5"},
			{range: range(3, 0, 1), url: 'mailto:hi@example.com', tooltip: 'Write'},
			{range: range(4, 0), url: 'https://example.com/page#part'},
			{range: range(5, 0), location: 'Sheet2!A1'},
		])
		// Merges belong to the used range
		expect([sheet.rowCount, sheet.colCount]).toEqual([5, 5])
	})

	test("split panes that aren't frozen, and default views", async () => {
		const split = await sheetOf({
			sheets: [
				worksheet('', {
					before:
						'<sheetViews><sheetView workbookViewId="0"><pane xSplit="2000" ySplit="1000" state="split"/></sheetView></sheetViews>',
				}),
			],
		})
		expect(split.frozen).toEqual({rows: 0, cols: 0})
		expect([split.showGridLines, split.zoomScale, split.rightToLeft]).toEqual([true, 100, false])
		const odd = await sheetOf({
			sheets: [
				worksheet('', {
					before:
						'<sheetViews><sheetView zoomScale="9000"><pane xSplit="-4" ySplit="2.7" state="frozenSplit"/></sheetView></sheetViews>',
				}),
			],
		})
		expect(odd.zoomScale).toBe(400)
		expect(odd.frozen).toEqual({rows: 2, cols: 0})
	})
})

describe('workbook', () => {
	test('sheets, states, the active tab, the date system and defined names', async () => {
		const book = await open({
			before: '<workbookPr date1904="1"/><bookViews><workbookView activeTab="1"/></bookViews>',
			after:
				'<definedNames><definedName name="Rates">Lookup!$A$2:$C$9</definedName><definedName name="_xlnm.Print_Area" localSheetId="0" ' +
				'hidden="1">Visible!$A$1:$B$2</definedName><definedName name="Next">_xlfn.XLOOKUP(1,A:A,B:B)</definedName></definedNames>',
			styles: styleSheet(
				'<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>',
			),
			sheets: [
				{xml: worksheet('<row r="1"><c r="A1" s="1"><v>0</v></c></row>'), name: 'Visible'},
				{xml: worksheet(''), name: 'Hidden', state: 'hidden'},
				{xml: worksheet(''), name: 'Very &amp; hidden', state: 'veryHidden'},
			],
			rels: [['vbaProject', 'vbaProject.bin']],
		})
		expect(book.sheets).toEqual([
			{name: 'Visible', state: 'visible', kind: 'worksheet'},
			{name: 'Hidden', state: 'hidden', kind: 'worksheet'},
			{name: 'Very & hidden', state: 'veryHidden', kind: 'worksheet'},
		])
		// The file's active tab is hidden, so the first visible one opens
		expect(book.activeSheet).toBe(0)
		expect(book.date1904).toBe(true)
		expect(book.hasMacros).toBe(true)
		expect(book.definedNames).toEqual([
			{name: 'Rates', formula: 'Lookup!$A$2:$C$9'},
			{name: '_xlnm.Print_Area', formula: 'Visible!$A$1:$B$2', sheet: 0},
			{name: 'Next', formula: 'XLOOKUP(1,A:A,B:B)'},
		])
		const sheet = await book.loadSheet(0)
		expect(sheet.text(0, 0)).toBe('1904-01-01')
		expect(sheet.name).toBe('Visible')
		await expect(book.loadSheet(3)).rejects.toThrow('no sheet 3')
	})

	test('the active tab', async () => {
		const book = await open({
			before: '<bookViews><workbookView activeTab="1"/></bookViews>',
			sheets: [worksheet(''), worksheet('')],
		})
		expect([book.activeSheet, book.date1904, book.hasMacros, book.definedNames]).toEqual([1, false, false, []])
		const hidden = await open({sheets: [{xml: worksheet(''), state: 'hidden'}, worksheet('')]})
		expect(hidden.activeSheet).toBe(1)
	})

	test("chart sheets and the parts a sheet keeps but we don't show", async () => {
		const drawingRels = relationships(['rId1', 'chart', '../charts/chart1.xml'])
		const book = await open({
			sheets: [
				{
					xml: worksheet('<row r="1"><c r="A1"><v>1</v></c></row>', {
						after:
							'<conditionalFormatting sqref="A1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting><drawing r:id="rId1"/><legacyDrawing r:id="rId3"/>',
					}),
					rels: relationships(
						['rId1', 'drawing', '../drawings/drawing1.xml'],
						['rId2', 'comments', '../comments1.xml'],
						['rId3', 'vmlDrawing', '../drawings/vmlDrawing1.vml'],
						['rId4', 'pivotTable', '../pivotTables/pivotTable1.xml'],
					),
				},
				{
					xml: '<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></chartsheet>',
					chartsheet: true,
					name: 'Chart',
					rels: relationships(['rId1', 'drawing', '../drawings/drawing2.xml']),
				},
				worksheet(''),
			],
			extra: {
				'xl/drawings/_rels/drawing1.xml.rels': drawingRels,
				'xl/drawings/_rels/drawing2.xml.rels': drawingRels,
			},
		})
		expect(book.sheets[1]).toEqual({name: 'Chart', state: 'visible', kind: 'chartsheet'})
		const sheet = await book.loadSheet(0)
		expect([
			sheet.hasDrawings,
			sheet.hasCharts,
			sheet.hasPivots,
			sheet.hasComments,
			sheet.hasConditionalFormats,
		]).toEqual([true, true, true, true, true])
		const chart = await book.loadSheet(1)
		expect([chart.rowCount, chart.colCount, chart.hasCharts, chart.name]).toEqual([0, 0, true, 'Chart'])
		const plain = await book.loadSheet(2)
		expect([
			plain.hasDrawings,
			plain.hasCharts,
			plain.hasPivots,
			plain.hasComments,
			plain.hasConditionalFormats,
		]).toEqual([false, false, false, false, false])
	})

	test("tables' header and totals rows", async () => {
		const table = (ref: string, attributes = '') =>
			`<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="T" displayName="T" ref="${ref}"${attributes}/>`
		const sheet = await sheetOf({
			sheets: [
				{
					xml: worksheet(''),
					rels: relationships(
						['rId1', 'table', '../tables/table1.xml'],
						['rId2', 'table', '../tables/table2.xml'],
						['rId3', 'table', '../tables/table3.xml'],
						['rId4', 'table', '../tables/missing.xml'],
						['rId5', 'table', 'https://example.com/table.xml', true],
					),
				},
			],
			extra: {
				'xl/tables/table1.xml': table('B2:D5'),
				'xl/tables/table2.xml': table('F1:G9', ' headerRowCount="1" totalsRowCount="1"'),
				// Without a header row, and a totals row that was shown once but isn't now
				'xl/tables/table3.xml': table('A10:C12', ' headerRowCount="0" totalsRowShown="1"'),
			},
		})
		expect(sheet.headerAndTotalRows).toEqual([
			{top: 1, left: 1, bottom: 1, right: 3},
			{top: 0, left: 5, bottom: 0, right: 6},
			{top: 8, left: 5, bottom: 8, right: 6},
		])
	})

	test('relationship targets written with backslashes or a fragment still find their parts', async () => {
		const sheet = await sheetOf({
			sheets: [
				{
					xml: worksheet(''),
					rels: relationships(
						['rId1', 'table', '..\\tables\\table1.xml#t'],
						['rId2', 'drawing', '..\\drawings\\drawing1.xml'],
					),
				},
			],
			extra: {
				'xl/tables/table1.xml':
					'<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="T" displayName="T" ref="A1:B2"/>',
				'xl/drawings/_rels/drawing1.xml.rels': relationships(['rId1', 'chart', '..\\charts\\chart1.xml']),
			},
		})
		expect([sheet.headerAndTotalRows, sheet.hasCharts]).toEqual([[{top: 0, left: 0, bottom: 0, right: 1}], true])
	})

	test('parts are found however their names are cased or slashed', async () => {
		const bytes = await zip({
			'_rels/.rels': relationships(['rId1', 'officeDocument', '/xl/Workbook.xml']),
			'xl/workbook.xml':
				'<workbook xmlns:r="r"><sheets><sheet name="One" sheetId="1" r:id="rId1"/><sheet name="Gone" sheetId="2" r:id="rId9"/></sheets></workbook>',
			'xl/_rels/workbook.xml.rels': relationships(['rId1', 'worksheet', 'worksheets/My%20Sheet.xml']),
			'xl\\worksheets\\my sheet.xml': worksheet('<row r="1"><c r="A1"><v>7</v></c></row>'),
		})
		const book = await openWorkbook(bytes)
		expect((await book.loadSheet(0)).cell(0, 0)?.value).toBe(7)
		// A sheet whose part is missing opens empty
		expect((await book.loadSheet(1)).rowCount).toBe(0)
		// No styles.xml: everything gets the default style
		expect(book.styles).toHaveLength(1)
		expect(book.styles[0].font).toEqual({
			name: 'Calibri',
			size: 11,
			bold: false,
			italic: false,
			underline: 'none',
			strike: false,
			vertAlign: 'baseline',
		})
	})
})

describe('styles', () => {
	const styles = styleSheet(
		'<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
			'<fonts count="3"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><scheme val="minor"/></font>' +
			'<font><b/><i/><u val="double"/><strike/><vertAlign val="superscript"/><sz val="14.5"/><color rgb="FF1F4E79"/><name val="Georgia"/></font>' +
			'<font><b val="0"/><u/><sz val="abc"/><color indexed="10"/><name val="Arial"/></font></fonts>' +
			'<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
			'<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.3999755851924192"/><bgColor indexed="64"/></patternFill></fill>' +
			'<fill><patternFill patternType="lightGrid"><fgColor rgb="FF9CA3AF"/><bgColor rgb="FFFFFFFF"/></patternFill></fill>' +
			'<fill><gradientFill degree="90"><stop position="0"><color rgb="FFFF0000"/></stop><stop position="1"><color theme="0"/></stop>' +
			'</gradientFill></fill></fills>' +
			'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border diagonalUp="1"><left style="thin">' +
			'<color auto="1"/></left><right style="medium"><color rgb="FF000000"/></right><top style="bogus"/><bottom style="double">' +
			'<color indexed="8"/></bottom><diagonal style="dashed"/></border></borders>' +
			'<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="10" fontId="1" fillId="0" borderId="0">' +
			'<alignment horizontal="center"/></xf></cellStyleXfs>' +
			'<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
			'<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" quotePrefix="1"><alignment horizontal="right" vertical="top" ' +
			'wrapText="1" indent="2" textRotation="45" shrinkToFit="1" readingOrder="2"/></xf><xf xfId="1"/>' +
			'<xf numFmtId="14" fontId="2" fillId="3" borderId="0" xfId="0"><alignment textRotation="255" horizontal="bogus"/></xf>' +
			'<xf numFmtId="999" fontId="99" fillId="4" borderId="99" xfId="99"/></cellXfs>' +
			`<colors><indexedColors>${'<rgbColor rgb="FF000000"/>'.repeat(8)}<rgbColor rgb="00ABCDEF"/><rgbColor rgb="FFFFFFFF"/>` +
			'<rgbColor rgb="FF123456"/></indexedColors></colors>',
	)

	test('every cell format resolves to plain values', async () => {
		const book = await open({styles, theme: THEME, sheets: [worksheet('')]})
		const [first, second, third, fourth, fifth] = book.styles
		expect(first.font).toMatchObject({name: 'Minor Font', size: 11, color: '#111111', bold: false})
		expect(first.fill).toBeUndefined()
		expect(first.border).toBeUndefined()
		expect(second).toMatchObject({
			format: '0.0%',
			font: {
				name: 'Georgia',
				size: 14.5,
				bold: true,
				italic: true,
				underline: 'double',
				strike: true,
				vertAlign: 'superscript',
				color: '#1F4E79',
			},
			fill: {type: 'pattern', pattern: 'solid', background: undefined},
			border: {
				left: {style: 'thin', color: undefined},
				right: {style: 'medium', color: '#000000'},
				top: undefined,
				bottom: {style: 'double', color: '#ABCDEF'},
				diagonal: {style: 'dashed', color: undefined},
				diagonalUp: true,
				diagonalDown: false,
			},
			alignment: {
				horizontal: 'right',
				vertical: 'top',
				wrap: true,
				shrink: true,
				indent: 2,
				rotation: 45,
				readingOrder: 'rtl',
			},
			quotePrefix: true,
		})
		// What a cell format leaves out comes from its named style
		expect(third).toMatchObject({format: '0.00%', font: second.font, alignment: {horizontal: 'center'}})
		expect(fourth.font).toMatchObject({name: 'Arial', size: 11, bold: false, underline: 'single', color: '#123456'})
		expect(fourth.fill).toEqual({type: 'pattern', pattern: 'lightGrid', color: '#9CA3AF', background: '#FFFFFF'})
		expect(fourth.alignment).toMatchObject({horizontal: 'general', rotation: 255})
		expect(fourth.format).toBe('m/d/yyyy')
		expect(fifth.format).toBe('General')
		expect(fifth.font).toBe(first.font)
		expect(fifth.border).toBeUndefined()
		expect(fifth.fill).toEqual({
			type: 'gradient',
			gradient: 'linear',
			degree: 90,
			stops: [
				{position: 0, color: '#FF0000'},
				{position: 1, color: '#FEFEFE'},
			],
		})
	})

	test('protected sheets, and the cells their formats unlock or hide', async () => {
		const book = await open({
			styles: styleSheet(
				'<cellXfs count="4"><xf/><xf applyProtection="1"><protection locked="0"/></xf><xf><protection hidden="1"/></xf>' +
					'<xf><protection locked="false" hidden="true"/></xf></cellXfs>',
			),
			sheets: [
				worksheet('', {after: '<sheetProtection sheet="1" objects="1" scenarios="1"/>'}),
				worksheet('', {after: '<sheetProtection objects="1"/>'}),
				worksheet(''),
			],
		})
		expect(book.styles.map(({locked, hidden}) => [locked, hidden])).toEqual([
			[true, false],
			[false, false],
			[true, true],
			[false, true],
		])
		const sheets = await Promise.all([0, 1, 2].map((i) => book.loadSheet(i)))
		expect(sheets.map((sheet) => sheet.protected)).toEqual([true, false, false])
	})

	test('theme colours in any DrawingML colour model, and Office’s for those the theme leaves out', async () => {
		const scheme =
			'<a:dk1><a:sysClr val="windowText"/></a:dk1><a:accent1><a:prstClr val="red"/></a:accent1>' +
			'<a:accent2><a:hslClr hue="7200000" sat="100000" lum="50000"/></a:accent2>' +
			'<a:accent3><a:srgbClr val="4472C4"><a:lumMod val="75000"/></a:srgbClr></a:accent3>'
		const book = await open({
			theme: `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="T">${scheme}</a:clrScheme></a:themeElements></a:theme>`,
			styles: styleSheet(
				`<fonts>${[1, 4, 5, 6, 9].map((i) => `<font><color theme="${i}"/></font>`).join('')}</fonts>` +
					`<cellXfs>${[0, 1, 2, 3, 4].map((i) => `<xf fontId="${i}"/>`).join('')}</cellXfs>`,
			),
			sheets: [worksheet('')],
		})
		// accent3 is Excel's "Blue, Accent 1, Darker 25%"; accent6 is Office's own green
		expect(book.styles.map((style) => style.font.color)).toEqual([
			'#000000',
			'#FF0000',
			'#00FF00',
			'#2F5597',
			'#70AD47',
		])
	})

	test("theme tints match Excel's swatches", async () => {
		// Excel's "Blue, Accent 1" column: lighter 80/60/40%, darker 25/50% of #4472C4
		const swatches: Array<[number, string]> = [
			[0.7999816888943144, '#D9E1F2'],
			[0.5999938962981048, '#B4C6E7'],
			[0.3999755851924192, '#8EA9DB'],
			[-0.249977111117893, '#2F5597'],
			[-0.499984740745262, '#203864'],
		]
		const fills = swatches.map(
			([tint]) => `<fill><patternFill patternType="solid"><fgColor theme="4" tint="${tint}"/></patternFill></fill>`,
		)
		const book = await open({
			theme: THEME,
			styles: styleSheet(
				`<fills>${fills.join('')}</fills><cellXfs>${swatches.map((_, i) => `<xf fillId="${i}"/>`).join('')}</cellXfs>`,
			),
			sheets: [worksheet('')],
		})
		swatches.forEach(([, expected], i) => {
			const fill = book.styles[i].fill
			const actual = fill?.type === 'pattern' ? fill.color! : ''
			// Excel's own rounding isn't documented (integer HLS variants match no better), so allow 2 per channel
			for (const channel of [1, 3, 5]) {
				const difference =
					parseInt(actual.slice(channel, channel + 2), 16) - parseInt(expected.slice(channel, channel + 2), 16)
				expect(Math.abs(difference), `${actual} vs ${expected}`).toBeLessThanOrEqual(2)
			}
		})
	})
})

describe('hostile and broken files', () => {
	test("files that aren't workbooks, or that we can't read", async () => {
		await rejects(openWorkbook(new Uint8Array(0)), 'corrupt')
		await rejects(openWorkbook(new TextEncoder().encode('just text')), 'corrupt')
		const utf16 = (text: string) => [...text].flatMap((c) => [c.charCodeAt(0), 0])
		// An OLE compound file whose first directory entry, after its 512-byte header, names a stream
		const ole = (stream: string) => {
			const bytes = new Uint8Array(1024)
			bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
			bytes.set(utf16(stream), 512)
			bytes[512 + 64] = stream.length * 2 + 2
			return bytes
		}
		await rejects(openWorkbook(ole('EncryptedPackage')), 'encrypted')
		await rejects(openWorkbook(ole('Workbook')), 'unsupported')
		// A legacy workbook that only mentions the stream, in a cell say, isn't taken for an encrypted one
		const legacy = ole('Workbook')
		legacy.set(utf16('EncryptedPackage'), 800)
		await rejects(openWorkbook(legacy), 'unsupported')
		const xlsb = await zip({
			'_rels/.rels': relationships(['rId1', 'officeDocument', 'xl/workbook.bin']),
			'xl/workbook.bin': 'binary',
		})
		await rejects(openWorkbook(xlsb), 'unsupported')
		await rejects(openWorkbook(await zip({'docProps/app.xml': '<Properties/>'})), 'corrupt')
		const truncated = (await workbook({sheets: [worksheet('')]})).slice(0, 200)
		await rejects(openWorkbook(truncated), 'corrupt')
	})

	test('DOCTYPE and malformed XML', async () => {
		const doctype = await open({
			sheets: [worksheet('<row r="1"/>').replace('<worksheet', '<!DOCTYPE x [<!ENTITY e "boom">]><worksheet')],
		})
		await rejects(doctype.loadSheet(0), 'corrupt')
		await rejects(
			openWorkbook(await workbook({sheets: [worksheet('')], before: '<workbookPr date1904="1">'})),
			'corrupt',
		)
		const malformed = await open({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></row>')]})
		await rejects(malformed.loadSheet(0), 'corrupt')
		const styles = await workbook({
			sheets: [worksheet('')],
			styles: styleSheet(`${'<a>'.repeat(300)}${'</a>'.repeat(300)}`),
		})
		await rejects(openWorkbook(styles), 'limits')
	})

	test('the cell budget covers cells, merges, hyperlinks and strings', async () => {
		const cells = Array.from({length: 11}, (_, i) => `<c r="A${i + 1}"><v>${i}</v></c>`).join('')
		await rejects((await open({sheets: [worksheet(`<row r="1">${cells}</row>`)]}, 10)).loadSheet(0), 'limits')
		expect((await (await open({sheets: [worksheet(`<row r="1">${cells}</row>`)]}, 11)).loadSheet(0)).rowCount).toBe(11)
		const merges = Array.from({length: 20}, (_, i) => `<mergeCell ref="A${i * 2 + 1}:B${i * 2 + 1}"/>`).join('')
		const merged = await open({sheets: [worksheet('', {after: `<mergeCells>${merges}</mergeCells>`})]}, 10)
		await rejects(merged.loadSheet(0), 'limits')
		const strings = await open(
			{sharedStrings: sharedStrings(...Array.from({length: 20}, (_, i) => `s${i}`)), sheets: [worksheet('')]},
			10,
		)
		await rejects(strings.loadSheet(0), 'limits')
		await rejects(
			(await open({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}, 0)).loadSheet(0),
			'limits',
		)
	})

	test('pathological structure stays cheap', async () => {
		const start = performance.now()
		const columns = '<col min="1" max="16384" width="5"/>'.repeat(5000)
		const nested = `<c r="B1">${'<x>'.repeat(50_000)}${'</x>'.repeat(50_000)}<v>2</v></c>`
		const sheet = await sheetOf({
			sheets: [
				worksheet(`<row r="1"><c r="A1"><v>1</v></c>${nested}</row>`, {
					before: `<dimension ref="A1:XFD1048576"/><cols>${columns}</cols>`,
				}),
			],
		})
		expect(sheet.cell(0, 1)?.value).toBe(2)
		expect(sheet.colWidthPx(100)).toBe(35)
		expect(performance.now() - start).toBeLessThan(2000)
	})
})

test('rows the file leaves unsized fit their wrapped and multi-line text, and their largest font', async () => {
	const styles = styleSheet(
		'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="22"/><name val="Calibri"/></font></fonts>' +
			'<cellXfs count="4"><xf/><xf applyAlignment="1"><alignment wrapText="1"/></xf><xf fontId="1"/>' +
			'<xf applyAlignment="1"><alignment horizontal="justify"/></xf></cellXfs>',
	)
	const text = (ref: string, value: string, style = 1) =>
		`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`
	const sheet = await sheetOf({
		styles,
		sheets: [
			worksheet(
				`<row r="1">${text('A1', 'one\ntwo\nthree')}</row>` +
					// 64 px less 6 of padding holds "word " but not "word word": two lines
					`<row r="2">${text('A2', 'word word')}</row>` +
					`<row r="3" ht="15">${text('A3', 'one\ntwo\nthree')}</row>` +
					`<row r="4">${text('A4', 'one\ntwo\nthree', 0)}</row>` +
					`<row r="5">${text('A5', 'one\ntwo\nthree')}</row>` +
					`<row r="6"><c r="B6" s="2"><v>1</v></c></row>` +
					`<row r="7" hidden="1">${text('A7', 'one\ntwo')}</row>` +
					`<row r="8">${text('A8', '一二三四五六七八九')}</row>` +
					`<row r="9">${text('B9', 'word word', 3)}</row>`,
				{after: '<mergeCells count="1"><mergeCell ref="A5:B5"/></mergeCells>'},
			),
		],
	})
	// Lines of 20 px, as Excel's 15-point rows for 11-point text; 22 points take 40
	expect([0, 1, 2, 3, 4, 5, 6].map((row) => sheet.rowHeightPx(row))).toEqual([60, 40, 20, 20, 20, 40, 0])
	// Wide characters at twice the width, four to a line of 58 px; justified text wraps too
	expect([sheet.rowHeightPx(7), sheet.rowHeightPx(8)]).toEqual([60, 40])
})

test('a row is fitted no taller than Excel allows, and long text is counted only that far', async () => {
	const styles = styleSheet('<cellXfs count="2"><xf/><xf applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs>')
	const long = 'word '.repeat(200_000)
	const start = performance.now()
	const sheet = await sheetOf({
		styles,
		sheets: [worksheet(`<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>${long}</t></is></c></row>`)],
	})
	expect(sheet.rowHeightPx(0)).toBe(545)
	expect(performance.now() - start).toBeLessThan(2000)
})

test('a workbook whose own font is larger keeps its one-line rows at the default height', async () => {
	const styles = styleSheet(
		'<fonts count="1"><font><sz val="12"/><name val="Calibri"/></font></fonts>' +
			'<cellXfs count="2"><xf/><xf applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs>',
	)
	const sheet = await sheetOf({
		styles,
		sheets: [
			worksheet(
				'<row r="1"><c r="A1"><v>1</v></c></row>' +
					'<row r="2"><c r="A2" s="1" t="inlineStr"><is><t xml:space="preserve">one\ntwo</t></is></c></row>',
			),
		],
	})
	// Two lines of 12 points: 2 × 21.8 px
	expect([sheet.rowHeightPx(0), sheet.rowHeightPx(1)]).toEqual([20, 44])
})
