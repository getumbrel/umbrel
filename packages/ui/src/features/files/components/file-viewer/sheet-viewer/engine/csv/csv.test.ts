import {describe, expect, it} from 'vitest'

import {detectNumeric, indexCsv, MAX_COLUMNS, readRows, sniffCsv, type CsvDialect} from './csv'
import {dialectOf, encode, ENCODINGS, int, pick, random, referenceRows} from './test-helpers'

const utf8 = (text: string) => new TextEncoder().encode(text)
const index = (text: string, dialect = dialectOf()) => indexCsv(utf8(text), dialect)
const rowsOf = (bytes: Uint8Array, dialect: CsvDialect) => {
	const result = indexCsv(bytes, dialect)
	return readRows(bytes, dialect, result, 0, result.rowCount)
}

describe('sniffCsv', () => {
	it('reads the encoding from a BOM', () => {
		expect(sniffCsv(utf8('\ufeffa,b\n'))).toMatchObject({encoding: 'utf-8', bom: true})
		expect(sniffCsv(encode('\ufeffa,b\n', 'utf-16le'))).toMatchObject({encoding: 'utf-16le', bom: true})
		expect(sniffCsv(encode('\ufeffa,b\n', 'utf-16be'))).toMatchObject({encoding: 'utf-16be', bom: true})
	})

	it('recognises UTF-16 without a BOM by where its NUL bytes fall', () => {
		const text = 'name;city\nZoë;Zürich\n李;香港\n'
		expect(sniffCsv(encode(text, 'utf-16le'))).toMatchObject({encoding: 'utf-16le', bom: false, delimiter: ';'})
		expect(sniffCsv(encode(text, 'utf-16be'))).toMatchObject({encoding: 'utf-16be', bom: false, delimiter: ';'})
		// A stray NUL in UTF-8 isn't a pattern
		expect(sniffCsv(utf8('a,b\n' + 'c,d\n'.repeat(20) + '\0')).encoding).toBe('utf-8')
	})

	it('takes text that is not UTF-8 as windows-1252', () => {
		const text = 'Crème,brûlée\n€5,“ok”\n'
		expect(sniffCsv(encode(text, 'windows-1252')).encoding).toBe('windows-1252')
		expect(sniffCsv(utf8(text)).encoding).toBe('utf-8')
	})

	it('judges the encoding by the first text that isn’t ASCII, however far in', () => {
		const ascii = 'id,name\n' + '1,plain\n'.repeat(10_000)
		expect(sniffCsv(encode(ascii + '2,Crème\n', 'windows-1252')).encoding).toBe('windows-1252')
		expect(sniffCsv(utf8(ascii + '2,Crème\n')).encoding).toBe('utf-8')
		expect(sniffCsv(utf8(ascii)).encoding).toBe('utf-8')
		// A lone continuation byte can't start UTF-8
		expect(sniffCsv(Uint8Array.from([...utf8(ascii), 0x80, 0x0a])).encoding).toBe('windows-1252')
	})

	it('still reads UTF-8 that the 64 KB sample cuts mid-character as UTF-8', () => {
		const bytes = utf8('a,b\n'.padEnd(65_535, 'x') + 'é,z\n')
		expect(bytes[65_535]).toBe(0xc3)
		expect(sniffCsv(bytes).encoding).toBe('utf-8')
	})

	it('picks the delimiter that splits rows most consistently', () => {
		expect(sniffCsv(utf8('a;b;c\n1,5;2,5;3\n4,5;5;6,25\n')).delimiter).toBe(';')
		expect(sniffCsv(utf8('a|b|c\n1|2|3\n')).delimiter).toBe('|')
		expect(sniffCsv(utf8('a\tb, c\td\n1\t2\t3\n')).delimiter).toBe('\t')
		expect(sniffCsv(utf8('a,"b;c",d\n1,"2;3",4\n')).delimiter).toBe(',')
	})

	it('breaks ties toward commas, or tabs for a .tsv', () => {
		const tied = utf8('a,b\tc\n1,2\t3\n')
		expect(sniffCsv(tied).delimiter).toBe(',')
		expect(sniffCsv(tied, 'export.TSV').delimiter).toBe('\t')
		const oneColumn = utf8('one column\nof text\n')
		expect(sniffCsv(oneColumn).delimiter).toBe(',')
		expect(sniffCsv(oneColumn, 'notes.tab').delimiter).toBe('\t')
	})

	it('leaves blank lines out of the vote', () => {
		expect(sniffCsv(utf8('a;b\n\n\n\nc;d\n')).delimiter).toBe(';')
	})

	it('follows an Excel sep line', () => {
		expect(sniffCsv(utf8('sep=;\r\na,b;c\r\n'))).toMatchObject({delimiter: ';', sepLine: true, lineEnding: '\r\n'})
		expect(sniffCsv(utf8('\ufeffSEP=|\na|b\n'))).toMatchObject({delimiter: '|', sepLine: true, bom: true})
		expect(sniffCsv(utf8('sep=\t\na\tb\n'))).toMatchObject({delimiter: '\t', sepLine: true})
		expect(sniffCsv(utf8('sep=,'))).toMatchObject({delimiter: ',', sepLine: true})
		expect(sniffCsv(encode('sep=;\r\na;b\r\n', 'utf-16le'))).toMatchObject({delimiter: ';', sepLine: true})
		// Not sep lines: a delimiter we don't read, or more text on the line
		expect(sniffCsv(utf8('sep=:\na,b\n'))).toMatchObject({sepLine: false, delimiter: ','})
		expect(sniffCsv(utf8('sep=;;\na;b\n')).sepLine).toBe(false)
	})

	it('picks the most common line ending, CRLF when there is none', () => {
		expect(sniffCsv(utf8('a,b\r\nc,d\r\ne,f\n')).lineEnding).toBe('\r\n')
		expect(sniffCsv(utf8('a,b\nc,d\r\ne,f\n')).lineEnding).toBe('\n')
		expect(sniffCsv(utf8('a,b\rc,d\r')).lineEnding).toBe('\r')
		expect(sniffCsv(utf8('a,b')).lineEnding).toBe('\r\n')
		expect(sniffCsv(utf8('sep=;\na;b')).lineEnding).toBe('\n')
		// Line breaks inside quotes are text, not line endings
		expect(sniffCsv(utf8('a,"x\r\ny\r\nz"\nb,c\n')).lineEnding).toBe('\n')
	})

	it('reads quotes as plain text when they never close a field cleanly', () => {
		// A TSV export with a stray quote would otherwise swallow every row after it
		const tsv = utf8('name\theight\n"Big" Joe\t6\'2"\nAnn\t5\'4"\n"Unclosed\t1\nBob\t2\n')
		expect(sniffCsv(tsv)).toMatchObject({delimiter: '\t', quote: null})
		// One cleanly quoted field shows quoting is in use, whatever else is broken
		expect(sniffCsv(utf8('a,b\n"x, y",z\n"broken"text,w\n')).quote).toBe('"')
		// A quote still open where the sample ends may close later in the file
		expect(sniffCsv(utf8('a,b\n1,"' + 'x'.repeat(70_000) + '"\n')).quote).toBe('"')
		// One still open at the end of the whole file is text
		expect(sniffCsv(utf8('a,b\n1,"2\n3,4\n')).quote).toBe(null)
		expect(sniffCsv(utf8('a,b\n1,2\n')).quote).toBe('"')
	})

	it('describes an empty file with the defaults', () => {
		expect(sniffCsv(new Uint8Array())).toEqual({
			encoding: 'utf-8',
			bom: false,
			delimiter: ',',
			quote: '"',
			lineEnding: '\r\n',
			sepLine: false,
		})
	})
})

describe('indexCsv', () => {
	it('records where each row starts, plus where the last one ends', () => {
		expect(index('a,b\ncd,e\n')).toEqual({
			rowStarts: Float64Array.from([0, 4, 9]),
			rowCount: 2,
			columnCount: 2,
			truncated: false,
		})
	})

	it('counts no row after a final line break', () => {
		const count = (text: string) => index(text).rowCount
		expect(count('')).toBe(0)
		expect(count('a')).toBe(1)
		expect(count('a\n')).toBe(1)
		expect(count('a\r\n')).toBe(1)
		expect(count('a\r')).toBe(1)
		expect(count('\n')).toBe(1)
		expect(count('a\n\n')).toBe(2)
		expect(count('a\n\nb')).toBe(3)
		expect(index('').columnCount).toBe(0)
	})

	it('ends rows at CR, LF and CRLF alike', () => {
		expect(index('a\rb\nc\r\nd').rowStarts).toEqual(Float64Array.from([0, 2, 4, 7, 8]))
	})

	it('keeps line breaks and doubled quotes inside quotes in the row', () => {
		expect(index('a,"multi\nline\r\nfield",c\n"x""y",z\n')).toMatchObject({rowCount: 2, columnCount: 3})
		expect(index('"a\rb"\n').rowCount).toBe(1)
	})

	it('reads a quote as an opening only at the start of a field', () => {
		expect(index('a"b,c\nd\n').rowCount).toBe(2)
		expect(index('"a"b"c\nd\n').rowCount).toBe(2)
		expect(index(' "a\nb",c\n').rowCount).toBe(2)
	})

	it('runs a quote that never closes to the end of the file', () => {
		expect(index('a,b\n"c\nd,e\n')).toMatchObject({rowCount: 2, columnCount: 2})
		expect(index('a,"b""').rowCount).toBe(1)
	})

	it('reads quotes as text when the dialect has none', () => {
		expect(index('a,"b\nc",d\n', dialectOf({quote: null}))).toMatchObject({rowCount: 2, columnCount: 2})
	})

	it('starts after a BOM and sep line the bytes really have', () => {
		const dialect = dialectOf({bom: true, sepLine: true, delimiter: ';'})
		expect(index('\ufeffsep=;\r\na;b\r\n', dialect).rowStarts).toEqual(Float64Array.from([10, 15]))
		expect(index('a;b\n', dialect).rowStarts).toEqual(Float64Array.from([0, 4]))
		expect(index('\ufeff', dialect).rowCount).toBe(0)
		expect(index('sep=;', dialect).rowCount).toBe(0)
	})

	it('indexes UTF-16 in 16-bit units, in either byte order', () => {
		for (const encoding of ['utf-16le', 'utf-16be'] as const) {
			const bytes = encode('\ufeffa,b\r\n"c\nd",e\n', encoding)
			expect(indexCsv(bytes, dialectOf({encoding, bom: true}))).toEqual({
				rowStarts: Float64Array.from([2, 12, 28]),
				rowCount: 2,
				columnCount: 2,
				truncated: false,
			})
		}
	})

	it('leaves the odd last byte of a UTF-16 file outside the rows', () => {
		const bytes = Uint8Array.from([...encode('a,b\n', 'utf-16le'), 0x41])
		expect(indexCsv(bytes, dialectOf({encoding: 'utf-16le'}))).toMatchObject({
			rowCount: 1,
			rowStarts: Float64Array.from([0, 8]),
		})
	})

	it('stops at maxRows and says the file is truncated', () => {
		expect(indexCsv(utf8('a\nb\nc\n'), dialectOf(), 2)).toEqual({
			rowStarts: Float64Array.from([0, 2, 4]),
			rowCount: 2,
			columnCount: 1,
			truncated: true,
		})
		expect(indexCsv(utf8('a\nb\n'), dialectOf(), 2).truncated).toBe(false)
		expect(indexCsv(utf8('a\nb'), dialectOf(), 2).truncated).toBe(false)
	})

	it('caps the column count at MAX_COLUMNS', () => {
		const bytes = utf8('a,b\n' + ','.repeat(MAX_COLUMNS + 5) + '\n')
		const result = indexCsv(bytes, dialectOf())
		expect(result).toMatchObject({rowCount: 2, columnCount: MAX_COLUMNS, truncated: true})
		expect(readRows(bytes, dialectOf(), result, 1, 2)[0]).toHaveLength(MAX_COLUMNS)
	})

	it('agrees with a reference reader on random input, in every encoding', () => {
		const next = random(1)
		for (let round = 0; round < 4000; round++) {
			const encoding = pick(next, ENCODINGS)
			const alphabet = [
				'a',
				'b',
				',',
				';',
				'"',
				'"',
				'\r',
				'\n',
				' ',
				'é',
				'€',
				...(encoding === 'windows-1252' ? [] : ['😀']),
			]
			let text = ''
			for (let length = int(next, 40); length > 0; length--) text += pick(next, alphabet)
			const delimiter = pick(next, [',', ';'] as const)
			const quote = pick(next, ['"', '"', null] as const)
			const dialect = dialectOf({encoding, delimiter, quote})
			const bytes = encode(text, encoding)
			const result = indexCsv(bytes, dialect)
			const expected = referenceRows(text, delimiter, quote)
			const context = JSON.stringify({text, encoding, delimiter, quote})
			expect(result.rowCount, context).toBe(expected.length)
			expect(result.columnCount, context).toBe(Math.max(0, ...expected.map((row) => row.length)))
			expect(readRows(bytes, dialect, result, 0, result.rowCount), context).toEqual(expected)
		}
	})
})

describe('readRows', () => {
	it('strips quotes, undoes doubled ones and keeps text after a closing quote', () => {
		const text = 'name,note,n\r\n"Doe, Jane","She said ""hi""",1\r\n"multi\nline",  spaced  ,\r\n"a"b,c"d,""""\r\n'
		expect(rowsOf(utf8(text), dialectOf())).toEqual([
			['name', 'note', 'n'],
			['Doe, Jane', 'She said "hi"', '1'],
			['multi\nline', '  spaced  ', ''],
			['ab', 'c"d', '"'],
		])
	})

	it('returns rows ragged, as the file has them', () => {
		expect(rowsOf(utf8('a,b,c\n1\n\n2,3,4,5\n'), dialectOf())).toEqual([
			['a', 'b', 'c'],
			['1'],
			[''],
			['2', '3', '4', '5'],
		])
	})

	it('decodes only the rows and columns asked for', () => {
		const bytes = utf8('a,b,c\n1,2,3\n4,5\n')
		const dialect = dialectOf()
		const result = indexCsv(bytes, dialect)
		expect(readRows(bytes, dialect, result, 1, 3)).toEqual([
			['1', '2', '3'],
			['4', '5'],
		])
		expect(readRows(bytes, dialect, result, -5, 99)).toHaveLength(3)
		expect(readRows(bytes, dialect, result, 2, 1)).toEqual([])
		expect(readRows(bytes, dialect, result, 0, 3, {start: 1, end: 2})).toEqual([['b'], ['2'], ['5']])
		expect(readRows(bytes, dialect, result, 0, 3, {start: 2, end: 9})).toEqual([['c'], ['3'], []])
	})

	it('keeps a BOM character inside the data as text', () => {
		expect(rowsOf(utf8('a,\ufeffb\n\ufeffc,d\n'), dialectOf())).toEqual([
			['a', '\ufeffb'],
			['\ufeffc', 'd'],
		])
	})

	it('never interprets what a cell says', () => {
		expect(rowsOf(utf8('=1+2,+cmd,@SUM(A1),-3\n'), dialectOf())).toEqual([['=1+2', '+cmd', '@SUM(A1)', '-3']])
	})

	it('decodes windows-1252 the way browsers do', () => {
		const bytes = Uint8Array.from([0x80, 0x2c, 0x93, 0x94, 0x2c, 0x81, 0x9f, 0xe9, 0x0a])
		expect(rowsOf(bytes, dialectOf({encoding: 'windows-1252'}))).toEqual([['€', '“”', '\x81Ÿé']])
	})

	it('shows broken UTF-8 as replacement characters', () => {
		expect(rowsOf(Uint8Array.from([0x61, 0xff, 0x2c, 0xc3, 0x0a]), dialectOf())).toEqual([['a\ufffd', '\ufffd']])
	})
})

describe('detectNumeric', () => {
	it.each([
		'0',
		'42',
		'-17.25',
		'+1',
		'1e3',
		'-2.5E-7',
		'.5',
		'1,234',
		'1,234.50',
		'1.234,56',
		'0,45',
		'1 234 567',
		"1'234.50",
		'12%',
		'$5',
		'-$1,000.00',
		'€4.50',
		'4,50 €',
		'(1,234.56)',
		' 7 ',
		'00123',
	])('reads %j as a number', (text) => {
		expect(detectNumeric(text)).toBe(true)
	})

	it.each([
		'',
		' ',
		'abc',
		'1.2.3',
		'2026-03-14',
		'14.03.2026',
		'12:30',
		'1,2,3',
		'1,23,4',
		'0x1F',
		'NaN',
		'Infinity',
		'=1+2',
		'1e',
		'--1',
		'$',
		'%',
		'v1',
		'1 2',
		'1'.repeat(65),
	])('does not read %j as a number', (text) => {
		expect(detectNumeric(text)).toBe(false)
	})
})
