import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {indexCsv, readRows, sniffCsv, type CsvDialect} from './csv'
import {createEdits, deleteColumns, deleteRows, insertColumns, insertRows, setCells} from './edits'
import {serializeCsv} from './serialize'
import {FIXTURES, setCell} from './test-helpers'

type Fixture = {
	path: string
	dialect: Partial<CsvDialect>
	rowCount: number
	columnCount: number
	rows: Record<number, string[]>
}

const CSV: CsvDialect = {encoding: 'utf-8', bom: false, delimiter: ',', quote: '"', lineEnding: '\n', sepLine: false}

// Expected text straight from the generator's source rows (fixtures-gen/scripts/gen_csv.py)
const FIXTURE_LIST: Fixture[] = [
	{
		path: 'Samples2/CSV/utf8-bom-quoted.csv',
		dialect: {bom: true, lineEnding: '\r\n'},
		rowCount: 11,
		columnCount: 6,
		rows: {
			0: ['id', 'name', 'city', 'notes', 'amount', 'date'],
			1: ['1', 'Müller, Anna', 'Zürich', 'Says "hello" to everyone', '1234.50', '2026-03-14'],
			2: ['2', 'Søren Kierkegaard', 'København', 'Multi-line note:\r\nline two\r\nline three', '-17.25', '2026-03-15'],
			3: ['3', "O'Brien, Pat", 'Dublin', 'Comma, inside, quotes', '0', '2026-03-16'],
			4: ['4', '李小龙', '香港', 'Chinese name and city', '42', '2026-03-17'],
			5: ['5', 'Emoji 😀', 'São Paulo', 'Trailing spaces   ', '3.14159', '2026-03-18'],
			6: ['6', '', 'Empty name', '', '', ''],
			7: ['7', 'Quote at end"', 'Oslo', '"Starts with a quote', '1e3', '2026-03-20'],
			8: ['8', 'Tab\there', 'Bern', 'literal tab inside an unquoted field', '99', '2026-03-21'],
			9: ['9', 'Line feed only\nLF', 'Lisbon', 'LF inside quotes while the file uses CRLF', '5', '2026-03-22'],
			10: ['10', '=SUM(A1:A2)', 'Formula', 'Starts with = (CSV injection test, must not be evaluated)', '+1', '@cmd'],
		},
	},
	{
		path: 'Samples2/CSV/semicolon-european.csv',
		dialect: {delimiter: ';', lineEnding: '\r\n'},
		rowCount: 7,
		columnCount: 6,
		rows: {
			0: ['Artikel', 'Menge', 'Einzelpreis', 'Gesamt', 'Datum', 'Bemerkung'],
			2: ['Brot', '2', '3,20', '6,40', '14.03.2026', 'Vollkorn; groß'],
			4: ['Kaffee', '3', '1.234,56', '3.703,68', '16.03.2026', 'Tausendertrennzeichen mit Punkt'],
			6: ['Summe', '', '', '3.723,43', '', ''],
		},
	},
	{
		path: 'Samples2/CSV/tab-separated.tsv',
		dialect: {delimiter: '\t'},
		rowCount: 7,
		columnCount: 5,
		rows: {
			1: ['Switzerland', 'Bern', '8960000', '41285', 'German, French, Italian, Romansh'],
			3: ['Brazil', 'Brasília', '203100000', '8515767', 'Portuguese'],
			6: ['Quoted\tTab', 'Value', '1', '2', 'Tabs inside quotes'],
		},
	},
	{
		path: 'Samples2/CSV/windows-1252.csv',
		dialect: {encoding: 'windows-1252', lineEnding: '\r\n'},
		rowCount: 5,
		columnCount: 4,
		rows: {
			0: ['Name', 'Ville', 'Prix', 'Remarque'],
			1: ['Crème brûlée', 'Paris', '€4.50', '“Délicieux” – très sucré'],
			2: ['Smørrebrød', 'København', '€7.20', 'Øl anbefales'],
			3: ['Jalapeño', 'México', '€1.10', 'Señor García’s favourite'],
			4: ['Größe', 'Köln', '€0.99', 'Straße • Maß'],
		},
	},
	{
		path: 'Samples2/CSV/utf16le-bom.csv',
		dialect: {encoding: 'utf-16le', bom: true, lineEnding: '\r\n'},
		rowCount: 7,
		columnCount: 3,
		rows: {
			0: ['id', 'greeting', 'language'],
			2: ['2', 'Grüß Gott', 'German'],
			3: ['3', 'こんにちは', 'Japanese'],
			4: ['4', 'مرحبا', 'Arabic'],
			5: ['5', 'שלום', 'Hebrew'],
			6: ['6', '👋 Hi', 'Emoji (surrogate pair)'],
		},
	},
	{
		path: 'Samples2/CSV/big-500k-rows.csv',
		dialect: {},
		rowCount: 500_001,
		columnCount: 10,
		rows: {
			0: [
				'id',
				'timestamp',
				'iso_time',
				'sensor',
				'temperature_c',
				'humidity_pct',
				'pressure_hpa',
				'voltage',
				'count',
				'delta',
			],
			1: ['1', '1767225602', '2026-01-01T00:00:02Z', '5', '41.446', '60.52', '1018.91', '3.2520', '23754', '-1.973717'],
			250_000: [
				'250000',
				'1782346398',
				'2026-06-25T00:13:18Z',
				'20',
				'-17.015',
				'29.77',
				'965.72',
				'4.4800',
				'68190',
				'1.826740',
			],
			500_000: [
				'500000',
				'1797494136',
				'2026-12-17T07:55:36Z',
				'38',
				'19.337',
				'43.27',
				'989.43',
				'3.5465',
				'92171',
				'1.229779',
			],
		},
	},
	{path: 'Samples2/CSV/empty.csv', dialect: {lineEnding: '\r\n'}, rowCount: 0, columnCount: 0, rows: {}},
	{
		path: 'Samples2/CSV/single-column.csv',
		dialect: {},
		rowCount: 51,
		columnCount: 1,
		rows: {0: ['email'], 1: ['user1@example.com'], 50: ['user50@example.com']},
	},
	{
		path: 'Samples2/CSV/ragged-rows.csv',
		dialect: {},
		rowCount: 8,
		columnCount: 5,
		rows: {
			0: ['a', 'b', 'c'],
			1: ['1', '2', '3'],
			2: ['4', '5'],
			3: ['6'],
			4: ['7', '8', '9', '10', '11'],
			5: [''],
			6: ['', '', '', ''],
			7: ['12', '13', '14'],
		},
	},
	{
		path: 'Samples2/CSV/excel-sep-line.csv',
		dialect: {delimiter: ';', lineEnding: '\r\n', sepLine: true},
		rowCount: 4,
		columnCount: 3,
		rows: {
			0: ['Product', 'Price', 'Stock'],
			1: ['Widget', '9,99', '120'],
			3: ['Doohickey', '1,25', '3400'],
		},
	},
	{
		path: 'Samples/Spreadsheets/sample.csv',
		dialect: {},
		rowCount: 2,
		columnCount: 3,
		rows: {0: ['A', 'B', 'C'], 1: ['X', 'Y', 'Z']},
	},
	{
		path: 'Samples/Spreadsheets/utf-8-bom-sample.csv',
		dialect: {bom: true},
		rowCount: 2,
		columnCount: 3,
		rows: {0: ['A', 'B', 'C'], 1: ['X', 'Y', 'Z']},
	},
	{
		path: 'Samples/Spreadsheets/long-sample.csv',
		dialect: {},
		rowCount: 8,
		columnCount: 7,
		rows: {
			0: [
				'Grant',
				'Dyer',
				'Donec.elementum@orciluctuset.example',
				'2013-11-23T02:30:31-08:00',
				'2014-05-31T01:06:56-07:00',
				'Magna Ut Associates',
				'ljenkins',
			],
			7: [
				'Talon',
				'Salinas',
				'posuere.vulputate.lacus@Donecsollicitudin.example',
				'2015-01-31T09:19:02-08:00',
				'2014-12-17T04:59:18-08:00',
				'Aliquam Iaculis Incorporate',
				'Phasellus@Quisquetincidunt.example',
			],
		},
	},
	{
		path: 'Samples/Spreadsheets/r200k.csv',
		dialect: {},
		rowCount: 200_001,
		columnCount: 10,
		rows: {
			0: Array.from({length: 10}, (_, i) => `Header ${i}`),
			1: ['text 0-0', '0.5', '0.5', 'text 0-3', '0.5', '0.5', 'text 0-6', '0.5', '0.5', 'text 0-9'],
			200_000: [
				'text 199999-0',
				'199999.5',
				'399998.5',
				'text 199999-3',
				'799996.5',
				'999995.5',
				'text 199999-6',
				'1399993.5',
				'1599992.5',
				'text 199999-9',
			],
		},
	},
]

const fixtures = FIXTURE_LIST.filter(({path}) => FIXTURES && existsSync(join(FIXTURES, path)))
const read = (path: string) => new Uint8Array(readFileSync(join(FIXTURES, path)))
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])
const trimEnd = (row: string[]) => {
	let end = row.length
	while (end > 0 && row[end - 1] === '') end--
	return row.slice(0, end)
}

describe.skipIf(fixtures.length === 0)('CSV fixtures', () => {
	it.each(fixtures)('$path: sniffs, indexes and reads exactly', ({path, dialect, rowCount, columnCount, rows}) => {
		const bytes = read(path)
		const sniffed = sniffCsv(bytes, path)
		expect(sniffed).toEqual({...CSV, ...dialect})
		const index = indexCsv(bytes, sniffed)
		expect(index).toMatchObject({rowCount, columnCount, truncated: false})
		expect(index.rowStarts[rowCount]).toBe(bytes.length)
		for (const [row, cells] of Object.entries(rows)) {
			expect(readRows(bytes, sniffed, index, Number(row), Number(row) + 1)).toEqual([cells])
		}
	})

	it.each(fixtures)('$path: saves byte for byte, and an edit changes only its row', ({path}) => {
		const bytes = read(path)
		const dialect = sniffCsv(bytes, path)
		const index = indexCsv(bytes, dialect)
		const edits = createEdits(index)
		expect(same(serializeCsv(bytes, dialect, index, edits), bytes)).toBe(true)
		if (!index.rowCount) return
		const row = Math.floor(index.rowCount / 2)
		const column = Math.min(1, index.columnCount - 1)
		const value = 'Edited "x"; y, z'
		const saved = serializeCsv(bytes, dialect, index, setCell(edits, row, column, value))
		const before = index.rowStarts[row]
		const after = bytes.length - index.rowStarts[row + 1]
		expect(same(saved.subarray(0, before), bytes.subarray(0, before))).toBe(true)
		expect(same(saved.subarray(saved.length - after), bytes.subarray(bytes.length - after))).toBe(true)
		const reopened = indexCsv(saved, dialect)
		expect(reopened.rowCount).toBe(index.rowCount)
		const [original] = readRows(bytes, dialect, index, row, row + 1)
		const [edited] = readRows(saved, dialect, reopened, row, row + 1)
		expect(edited[column]).toBe(value)
		expect(edited.toSpliced(column, 1)).toEqual(original.toSpliced(column, 1))
	})

	const small = fixtures.filter(({rowCount}) => rowCount > 0 && rowCount < 1000)
	it.each(small)('$path: row and column edits read back as made', ({path}) => {
		const bytes = read(path)
		const dialect = sniffCsv(bytes, path)
		const index = indexCsv(bytes, dialect)
		let edits = createEdits(index)
		edits = setCell(insertColumns(edits, 1), 0, 1, 'Added')
		edits = setCells(insertRows(edits, 1), [{row: 1, column: 0, value: 'New, row'}])
		edits = deleteColumns(deleteRows(edits, index.rowCount), 0)
		const expected = readRows(bytes, dialect, index, 0, index.rowCount)
			.map((row) => (row.length > 1 ? row.toSpliced(1, 0, '') : row))
			.toSpliced(1, 0, ['New, row'])
			.slice(0, -1)
			.map((row) => row.slice(1))
		expected[0][0] = 'Added'
		const saved = serializeCsv(bytes, dialect, index, edits)
		const reopened = indexCsv(saved, dialect)
		expect(readRows(saved, dialect, reopened, 0, reopened.rowCount).map(trimEnd)).toEqual(expected.map(trimEnd))
	})
})

const BIG = 'Samples2/CSV/big-500k-rows.csv'

describe.skipIf(!FIXTURES || !existsSync(join(FIXTURES, BIG)))('CSV performance', () => {
	const median = (times: number[]) => times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)]
	const time = (run: () => unknown, repeat = 5) => {
		const times: number[] = []
		for (let i = 0; i < repeat; i++) {
			const start = performance.now()
			run()
			times.push(performance.now() - start)
		}
		return median(times)
	}

	it.each([BIG, 'Samples/Spreadsheets/r200k.csv'].filter((path) => existsSync(join(FIXTURES, path))))(
		'%s: opens, reads and saves fast',
		(path) => {
			const bytes = read(path)
			const dialect = sniffCsv(bytes, path)
			const sniffMs = time(() => sniffCsv(bytes, path))
			const index = indexCsv(bytes, dialect)
			const indexMs = time(() => indexCsv(bytes, dialect))
			const next = (seed: number) => Math.floor((((seed * 2654435761) % 2 ** 32) / 2 ** 32) * (index.rowCount - 100))
			const readMs =
				time(() => {
					for (let i = 1; i <= 200; i++) readRows(bytes, dialect, index, next(i), next(i) + 100)
				}) / 200
			const edits = createEdits(index)
			const saveMs = time(() => serializeCsv(bytes, dialect, index, edits))
			const editMs = time(() => serializeCsv(bytes, dialect, index, setCell(edits, index.rowCount >> 1, 2, 'x')))
			const columnMs = time(() => serializeCsv(bytes, dialect, index, insertColumns(edits, 1)), 3)
			console.info(
				`${path}: ${(bytes.length / 1e6).toFixed(1)} MB, ${index.rowCount} rows; sniff ${sniffMs.toFixed(2)} ms, ` +
					`index ${indexMs.toFixed(0)} ms (${(bytes.length / 1e3 / indexMs).toFixed(0)} MB/s, ` +
					`${(index.rowStarts.byteLength / 1e6).toFixed(1)} MB), ` +
					`100 rows ${readMs.toFixed(3)} ms, save unchanged ${saveMs.toFixed(0)} ms, one edit ${editMs.toFixed(0)} ms, ` +
					`insert column ${columnMs.toFixed(0)} ms`,
			)
			// Generous ceilings: they catch a pathological regression, not a slow machine
			expect(indexMs).toBeLessThan(1500)
			expect(readMs).toBeLessThan(10)
			expect(editMs).toBeLessThan(1000)
			expect(index.rowStarts.byteLength).toBe((index.rowCount + 1) * 8)
		},
	)
})
