import {describe, expect, it} from 'vitest'

import {indexCsv, readRows, sniffCsv, type CsvDialect, type CsvEncoding} from './csv'
import {
	createEdits,
	deleteColumns,
	deleteRows,
	editedSize,
	insertColumns,
	insertRows,
	keysOf,
	setCells,
	type CsvEdits,
} from './edits'
import {CsvEncodeError, serializeCsv} from './serialize'
import {decodeUtf8, dialectOf, encode, ENCODINGS, int, pick, random, setCell} from './test-helpers'

const utf8 = (text: string) => new TextEncoder().encode(text)

// Applies `change` to a UTF-8 file and returns the saved text
function edit(source: string, change: (edits: CsvEdits) => CsvEdits, dialect?: CsvDialect): string {
	const bytes = utf8(source)
	const resolved = dialect ?? sniffCsv(bytes)
	const index = indexCsv(bytes, resolved)
	return decodeUtf8(serializeCsv(bytes, resolved, index, change(createEdits(index))))
}

function thrown(run: () => unknown): unknown {
	try {
		run()
	} catch (error) {
		return error
	}
	throw new Error('Expected an error')
}

describe('CsvEdits', () => {
	it('keys inserted rows apart from the original ones, and cells follow their rows', () => {
		let edits = setCell(createEdits({rowCount: 5}), 3, 1, 'x')
		edits = insertRows(edits, 1, 2)
		expect(keysOf(edits.rows, 0, 7)).toEqual([0, -1, -2, 1, 2, 3, 4])
		expect(edits.cells.get(3)?.get(1)).toBe('x')
		edits = setCell(edits, 2, 0, 'new')
		expect(edits.cells.get(-2)?.get(0)).toBe('new')
		edits = deleteRows(edits, 1, 3)
		expect(keysOf(edits.rows, 0, 4)).toEqual([0, 2, 3, 4])
		expect([...edits.cells.keys()]).toEqual([3])
	})

	it('keys columns the same way, past the last one too', () => {
		const edits = insertColumns(deleteColumns(createEdits({rowCount: 1}), 1), 0, 2)
		expect(keysOf(edits.columns, 0, 6)).toEqual([-1, -2, 0, 2, 3, 4])
	})

	it('merges runs back together once a split heals', () => {
		const edits = createEdits({rowCount: 4})
		expect(deleteRows(insertRows(edits, 2), 2).rows).toEqual(edits.rows)
		expect(deleteColumns(insertColumns(edits, 3), 3).columns).toEqual(edits.columns)
		expect(deleteRows(insertRows(insertRows(edits, 1), 2), 1, 2).rows).toEqual(edits.rows)
	})

	it('never changes the edits it was given', () => {
		const before = setCell(createEdits({rowCount: 2}), 0, 0, 'a')
		const snapshot = structuredClone(before)
		setCell(before, 0, 0, 'b')
		setCells(before, [{row: 1, column: 1, value: 'c'}])
		insertRows(before, 0)
		deleteRows(before, 0)
		insertColumns(before, 0)
		deleteColumns(before, 0)
		expect(before).toEqual(snapshot)
	})

	it('drops cells along with their deleted columns', () => {
		let edits = setCells(createEdits({rowCount: 2}), [
			{row: 0, column: 0, value: 'keep'},
			{row: 0, column: 1, value: 'drop'},
			{row: 1, column: 1, value: 'drop'},
		])
		edits = deleteColumns(edits, 1)
		expect([...edits.cells]).toEqual([[0, new Map([[0, 'keep']])]])
	})

	it('sizes the edited grid', () => {
		let edits = createEdits({rowCount: 3})
		expect(editedSize(edits, {columnCount: 4})).toEqual({rowCount: 3, columnCount: 4})
		edits = insertColumns(deleteColumns(edits, 0, 2), 1)
		expect(editedSize(edits, {columnCount: 4})).toEqual({rowCount: 3, columnCount: 3})
		edits = setCell(insertRows(edits, 3), 3, 9, 'far')
		expect(editedSize(edits, {columnCount: 4})).toEqual({rowCount: 4, columnCount: 10})
		expect(editedSize(createEdits({rowCount: 0}), {columnCount: 0})).toEqual({rowCount: 0, columnCount: 0})
	})

	it('rejects positions outside the grid', () => {
		const edits = createEdits({rowCount: 2})
		expect(() => setCell(edits, 2, 0, 'x')).toThrow(RangeError)
		expect(() => setCell(edits, 0, -1, 'x')).toThrow(RangeError)
		expect(() => insertRows(edits, 3)).toThrow(RangeError)
		expect(() => insertRows(edits, 1.5)).toThrow(RangeError)
		expect(() => deleteRows(edits, 2)).toThrow(RangeError)
		expect(() => deleteColumns(edits, -1)).toThrow(RangeError)
	})
})

describe('serializeCsv', () => {
	it('writes back the original bytes when nothing changed', () => {
		const sources = [
			'',
			'a',
			'a\n',
			'a,b\r\nc,d',
			'\ufeffsep=;\r\na;b\r\n',
			'"a\nb",c\n"open',
			'a\n\n\n',
			'\r\n\r\n',
			'x\ry\r',
		]
		for (const source of sources) {
			const bytes = utf8(source)
			const dialect = sniffCsv(bytes)
			const index = indexCsv(bytes, dialect)
			expect(serializeCsv(bytes, dialect, index, createEdits(index))).toEqual(bytes)
		}
	})

	it('rewrites only the field that changed', () => {
		const source = 'id,"name",note\r\n1,"Ann","x, y"\r\n2,Bob,z\r\n'
		expect(edit(source, (e) => setCell(e, 1, 2, 'new'))).toBe('id,"name",note\r\n1,"Ann","new"\r\n2,Bob,z\r\n')
		expect(edit(source, (e) => setCell(e, 2, 0, '3'))).toBe('id,"name",note\r\n1,"Ann","x, y"\r\n3,Bob,z\r\n')
		expect(edit(source, (e) => setCell(e, 1, 1, ''))).toBe('id,"name",note\r\n1,"","x, y"\r\n2,Bob,z\r\n')
	})

	it('leaves the bytes alone when a cell gets the text it already had', () => {
		const source = 'a,"b",c\n"x"y,2,3\n'
		const same = (e: CsvEdits) =>
			setCells(e, [
				{row: 0, column: 1, value: 'b'},
				{row: 1, column: 0, value: 'xy'},
			])
		expect(edit(source, same)).toBe(source)
	})

	it('quotes new text only where the format needs it', () => {
		const cases = [
			['plain', 'plain'],
			['a,b', '"a,b"'],
			['say "hi"', '"say ""hi"""'],
			['two\nlines', '"two\nlines"'],
			['cr\r', '"cr\r"'],
			[' lead', '" lead"'],
			['trail\t', '"trail\t"'],
			['in side', 'in side'],
			['a;b', 'a;b'],
			['=1+2', '=1+2'],
			['', ''],
		]
		for (const [value, written] of cases) expect(edit('a,b\n', (e) => setCell(e, 0, 1, value))).toBe(`a,${written}\n`)
		expect(edit('a;b\n', (e) => setCell(e, 0, 1, 'x;y'))).toBe('a;"x;y"\n')
		expect(edit('a\tb\n', (e) => setCell(e, 0, 1, 'x\ty'))).toBe('a\t"x\ty"\n')
	})

	it('pads a row only as far as a cell set past its end', () => {
		expect(edit('a,b,c\n1\n', (e) => setCell(e, 1, 2, 'x'))).toBe('a,b,c\n1,,x\n')
		expect(edit('a,b,c\n1\n', (e) => setCell(e, 0, 4, 'x'))).toBe('a,b,c,,x\n1\n')
	})

	it('inserts rows as wide as the file, with its line ending', () => {
		expect(edit('a,b\r\nc,d\r\n', (e) => insertRows(e, 1))).toBe('a,b\r\n,\r\nc,d\r\n')
		expect(edit('a,b\r\nc,d\r\n', (e) => setCell(insertRows(e, 2), 2, 0, 'x'))).toBe('a,b\r\nc,d\r\nx,\r\n')
		expect(edit('a,b\nc,d\n', (e) => setCell(insertRows(e, 0, 2), 1, 1, 'y'))).toBe(',\n,y\na,b\nc,d\n')
		expect(edit('', (e) => setCell(insertRows(e, 0), 0, 1, 'b'))).toBe(',b\r\n')
	})

	it('keeps the file’s final line break, or its absence, on whichever row ends up last', () => {
		expect(edit('a\nb', (e) => setCell(insertRows(e, 2), 2, 0, 'c'))).toBe('a\nb\nc')
		expect(edit('a\nb', (e) => deleteRows(e, 1))).toBe('a')
		expect(edit('a\nb\n', (e) => deleteRows(e, 1))).toBe('a\n')
		expect(edit('a\nb', (e) => setCell(e, 1, 0, 'x'))).toBe('a\nx')
		expect(edit('a\r\nb\n', (e) => setCell(e, 0, 0, 'x'))).toBe('x\r\nb\n')
	})

	it('ends an empty last row with a line break, so it survives', () => {
		expect(edit('a\nb', (e) => insertRows(e, 2))).toBe('a\nb\n\n')
		expect(edit('a\nb', (e) => setCell(e, 1, 0, ''))).toBe('a\n\n')
		expect(edit('a\n\nb', (e) => deleteRows(e, 2))).toBe('a\n\n')
	})

	it('keeps an empty row starting with LF apart from a lone CR before it', () => {
		// Each would otherwise write CR LF, which reads back as one line break
		expect(edit('a\rb\n\n', (e) => deleteRows(e, 1))).toBe('a\r\r\n')
		expect(edit('a\rb\n', (e) => setCell(e, 1, 0, ''))).toBe('a\r\r\n')
		expect(edit('a\rb\r', (e) => insertRows(e, 1), dialectOf())).toBe('a\r\r\nb\r')
		expect(edit('sep=;\ra\n\n', (e) => deleteRows(e, 0))).toBe('sep=;\r\r\n')
		const bytes = utf8('a\rb\n\nc\n')
		const index = indexCsv(bytes, dialectOf(), 2)
		expect(decodeUtf8(serializeCsv(bytes, dialectOf(), index, deleteRows(createEdits(index), 1)))).toBe('a\r\r\nc\n')
	})

	it('deletes rows, down to none', () => {
		expect(edit('h\n1\n2\n3\n', (e) => deleteRows(e, 1, 2))).toBe('h\n3\n')
		expect(edit('\ufeffsep=,\r\nh\r\n1\r\n', (e) => deleteRows(e, 0, 2))).toBe('\ufeffsep=,\r\n')
	})

	it('inserts and deletes columns, copying untouched fields verbatim', () => {
		const source = '"id",name,"note"\r\n1,"Ann",x\r\n2,Bob\r\n'
		expect(edit(source, (e) => insertColumns(e, 1))).toBe('"id",,name,"note"\r\n1,,"Ann",x\r\n2,,Bob\r\n')
		expect(edit(source, (e) => deleteColumns(e, 1))).toBe('"id","note"\r\n1,x\r\n2\r\n')
		expect(edit(source, (e) => deleteColumns(e, 0, 3))).toBe('\r\n\r\n\r\n')
		// A column added after the last one reaches the rows as wide as the file, not the short ones
		expect(edit(source, (e) => setCell(insertColumns(e, 3), 0, 3, 'new'))).toBe(
			'"id",name,"note",new\r\n1,"Ann",x,\r\n2,Bob\r\n',
		)
	})

	it('closes a quote left open at the end of the file before writing after it', () => {
		expect(edit('a,b\n1,"open', (e) => setCell(insertRows(e, 2), 2, 0, 'x'), dialectOf())).toBe('a,b\n1,"open"\nx,')
		expect(edit('a,b\n1,"open', (e) => setCell(e, 1, 0, 'x'), dialectOf())).toBe('a,b\nx,"open"')
		expect(edit('a,b\n1,"open', (e) => insertColumns(e, 2), dialectOf())).toBe('a,b,\n1,"open",')
	})

	it('keeps the BOM and sep line, and breaks a sep line that ends the file', () => {
		expect(edit('\ufeffsep=;\r\na;b\r\n', (e) => setCell(e, 0, 1, 'c'))).toBe('\ufeffsep=;\r\na;c\r\n')
		expect(edit('sep=;', (e) => setCell(insertRows(e, 0), 0, 0, 'a'))).toBe('sep=;\r\na\r\n')
	})

	it('rewrites a row far wider than the sheet, keeping every field', () => {
		const fields = Array.from({length: 100_000}, (_, i) => `f${i}`)
		const source = `${fields.join(',')}\n${fields.join(',')}\n`
		const edited = fields.with(5000, 'a').with(99_999, 'z').join(',')
		const cells = (e: CsvEdits) =>
			setCells(e, [
				{row: 0, column: 5000, value: 'a'},
				{row: 0, column: 99_999, value: 'z'},
			])
		expect(edit(source, cells, dialectOf())).toBe(`${edited}\n${fields.join(',')}\n`)
		const deleted = fields.toSpliced(4096, 1).join(',')
		expect(edit(source, (e) => deleteColumns(e, 4096), dialectOf())).toBe(`${deleted}\n${deleted}\n`)
	})

	it('keeps rows past a truncated index as they are', () => {
		const bytes = utf8('a\nb\nc\nd')
		const dialect = dialectOf()
		const index = indexCsv(bytes, dialect, 2)
		const save = (change: (edits: CsvEdits) => CsvEdits) =>
			decodeUtf8(serializeCsv(bytes, dialect, index, change(createEdits(index))))
		expect(save((e) => e)).toBe('a\nb\nc\nd')
		expect(save((e) => setCell(insertRows(e, 2), 2, 0, 'new'))).toBe('a\nb\nnew\nc\nd')
		expect(save((e) => deleteRows(e, 1))).toBe('a\nc\nd')
	})

	it('saves windows-1252, or names the character it has no byte for', () => {
		const bytes = encode('Name,Prix\r\nCrème,€4.50\r\n', 'windows-1252')
		const dialect = sniffCsv(bytes)
		expect(dialect.encoding).toBe('windows-1252')
		const index = indexCsv(bytes, dialect)
		const edits = createEdits(index)
		expect(serializeCsv(bytes, dialect, index, setCell(edits, 1, 0, 'Größe “x”'))).toEqual(
			encode('Name,Prix\r\nGröße “x”,€4.50\r\n', 'windows-1252'),
		)
		const error = thrown(() => serializeCsv(bytes, dialect, index, setCell(edits, 1, 1, '日本')))
		expect(error).toBeInstanceOf(CsvEncodeError)
		expect(error).toMatchObject({code: 'unrepresentable', char: '日', row: 1, column: 1})
		expect(thrown(() => serializeCsv(bytes, dialect, index, setCell(edits, 0, 0, '👋')))).toMatchObject({char: '👋'})
	})

	it('converts to UTF-8 on request, untouched text included', () => {
		const bytes = encode('Name,Prix\r\nCrème,€4.50\r\n', 'windows-1252')
		const dialect = sniffCsv(bytes)
		const index = indexCsv(bytes, dialect)
		const saved = serializeCsv(bytes, dialect, index, setCell(createEdits(index), 1, 1, '日本 😀'), {
			encoding: 'utf-8',
			bom: true,
		})
		expect(decodeUtf8(saved)).toBe('\ufeffName,Prix\r\nCrème,日本 😀\r\n')
		expect(sniffCsv(saved)).toEqual({...dialect, encoding: 'utf-8', bom: true})
	})

	it('writes UTF-16 in the file’s own byte order, and converts it', () => {
		for (const encoding of ['utf-16le', 'utf-16be'] as const) {
			const bytes = encode('\ufeffa,b\r\n1,2\r\n', encoding)
			const dialect = sniffCsv(bytes)
			const index = indexCsv(bytes, dialect)
			const edits = setCell(insertColumns(createEdits(index), 2), 1, 2, 'x, 😀')
			expect(serializeCsv(bytes, dialect, index, edits)).toEqual(encode('\ufeffa,b,\r\n1,2,"x, 😀"\r\n', encoding))
			const converted = serializeCsv(bytes, dialect, index, edits, {encoding: 'utf-8', bom: false})
			expect(decodeUtf8(converted)).toBe('a,b,\r\n1,2,"x, 😀"\r\n')
		}
	})

	it('writes quotes as text in a file without quoting, and refuses what it can’t hold', () => {
		const dialect = dialectOf({delimiter: '\t', quote: null})
		const source = 'a\t"b\n'
		expect(edit(source, (e) => setCell(e, 0, 0, 'say "hi"'), dialect)).toBe('say "hi"\t"b\n')
		expect(edit(source, (e) => setCell(e, 0, 0, ' padded '), dialect)).toBe(' padded \t"b\n')
		const error = thrown(() => edit(source, (e) => setCell(e, 0, 1, 'tab\there'), dialect))
		expect(error).toBeInstanceOf(CsvEncodeError)
		expect(error).toMatchObject({code: 'unquotable', row: 0, column: 1})
		expect(thrown(() => edit(source, (e) => setCell(e, 0, 0, 'two\nlines'), dialect))).toBeInstanceOf(CsvEncodeError)
	})

	it('refuses edits made for another file', () => {
		const bytes = utf8('a\n')
		const index = indexCsv(bytes, dialectOf())
		expect(() => serializeCsv(bytes, dialectOf(), index, createEdits({rowCount: 3}))).toThrow(RangeError)
	})
})

// Random files written the way real tools do: quoting when needed and sometimes
// regardless, mixed line endings, with or without a final line break
function randomFile(next: () => number, encoding: CsvEncoding, delimiter: string) {
	const alphabet = ['a', 'b', 'é', ' ', ',', ';', '\t', '"', '\n', '\r', ...(encoding === 'windows-1252' ? [] : ['😀'])]
	const cell = () => Array.from({length: int(next, 4)}, () => pick(next, alphabet)).join('')
	const quote = (text: string) => (/[,;\t"\r\n]/.test(text) || next() < 0.2 ? `"${text.replaceAll('"', '""')}"` : text)
	const rows = Array.from({length: int(next, 6)}, () => Array.from({length: 1 + int(next, 4)}, () => quote(cell())))
	const breaks = () => pick(next, ['\n', '\r\n', '\r'])
	const text = rows.map((row) => row.join(delimiter)).join(breaks()) + (rows.length && next() < 0.5 ? breaks() : '')
	return {text, cell}
}

const hasBom = (bytes: Uint8Array, encoding: CsvEncoding) =>
	encoding === 'utf-8'
		? bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
		: encoding !== 'windows-1252' &&
			bytes[0] === (encoding === 'utf-16le' ? 0xff : 0xfe) &&
			bytes[1] === (encoding === 'utf-16le' ? 0xfe : 0xff)

const trimEnd = (row: string[]) => {
	let end = row.length
	while (end > 0 && row[end - 1] === '') end--
	return row.slice(0, end)
}

describe('serializeCsv on random files', () => {
	it('reads back exactly the grid the edits describe', () => {
		const next = random(7)
		for (let round = 0; round < 1500; round++) {
			const encoding = pick(next, ENCODINGS)
			const delimiter = pick(next, [',', ';', '\t'] as const)
			const quote = next() < 0.15 ? null : '"'
			const bom = encoding !== 'windows-1252' && next() < 0.3
			const sepLine = next() < 0.2
			const dialect = dialectOf({
				encoding,
				bom,
				delimiter,
				quote,
				sepLine,
				lineEnding: pick(next, ['\n', '\r\n', '\r'] as const),
			})
			const {text, cell} = randomFile(next, encoding, delimiter)
			// A file without quoting can't hold a delimiter or line break in a cell
			const value = quote ? cell : () => cell().replace(/[,;\t\r\n]/g, '')
			const preamble = (bom ? '\ufeff' : '') + (sepLine ? `sep=${delimiter}${pick(next, ['\n', '\r\n', '\r'])}` : '')
			const bytes = encode(preamble + text, encoding)
			const full = indexCsv(bytes, dialect)
			// Sometimes only the first rows are indexed, as past MAX_ROWS
			const truncate = full.rowCount > 1 && next() < 0.2
			const index = truncate ? indexCsv(bytes, dialect, 1 + int(next, full.rowCount - 1)) : full
			const tail = readRows(bytes, dialect, full, index.rowCount, full.rowCount)
			// The model: the grid as read, edited with plain array operations
			let model = readRows(bytes, dialect, index, 0, index.rowCount)
			let edits = createEdits(index)
			const log: string[] = []
			for (let step = 1 + int(next, 6); step > 0; step--) {
				const width = Math.max(1, ...model.map((row) => row.length))
				const operation = pick(next, [
					'set',
					'set',
					'set',
					'insertRows',
					'deleteRows',
					'insertColumns',
					'deleteColumns',
				])
				if (operation === 'set' && model.length) {
					const row = int(next, model.length)
					const column = int(next, width + 2)
					const text = value()
					edits = setCell(edits, row, column, text)
					model[row] = [...model[row], ...Array<string>(Math.max(0, column + 1 - model[row].length)).fill('')]
					model[row][column] = text
					log.push(`set ${row} ${column} ${JSON.stringify(text)}`)
				} else if (operation === 'insertRows') {
					const at = int(next, model.length + 1)
					const count = 1 + int(next, 2)
					edits = insertRows(edits, at, count)
					model.splice(at, 0, ...Array.from({length: count}, () => []))
					log.push(`insertRows ${at} ${count}`)
				} else if (operation === 'deleteRows' && model.length) {
					const at = int(next, model.length)
					const count = 1 + int(next, 2)
					edits = deleteRows(edits, at, count)
					model.splice(at, count)
					log.push(`deleteRows ${at} ${count}`)
				} else if (operation === 'insertColumns') {
					const at = int(next, width + 1)
					edits = insertColumns(edits, at)
					model = model.map((row) => (at < row.length ? row.toSpliced(at, 0, '') : row))
					log.push(`insertColumns ${at}`)
				} else if (operation === 'deleteColumns') {
					const at = int(next, width)
					edits = deleteColumns(edits, at)
					model = model.map((row) => (at < row.length ? row.toSpliced(at, 1) : row))
					log.push(`deleteColumns ${at}`)
				}
			}
			const target = pick(next, [dialect, {encoding: 'utf-8', bom: false}, {encoding: 'utf-8', bom: true}] as const)
			const saved = serializeCsv(bytes, dialect, index, edits, target)
			const savedDialect = {...dialect, encoding: target.encoding, bom: target.bom}
			const reopened = indexCsv(saved, savedDialect)
			const context = JSON.stringify({preamble, text, dialect, truncated: index.rowCount, target, log})
			expect(readRows(saved, savedDialect, reopened, 0, reopened.rowCount).map(trimEnd), context).toEqual(
				[...model, ...tail].map(trimEnd),
			)
			expect(hasBom(saved, target.encoding), context).toBe(target.bom)
			expect(editedSize(edits, index).rowCount, context).toBe(model.length)
		}
	})

	it('changes nothing outside the row of a single edited cell', () => {
		const next = random(11)
		for (let round = 0; round < 1500; round++) {
			const encoding = pick(next, ENCODINGS)
			const delimiter = pick(next, [',', ';'] as const)
			const {text, cell} = randomFile(next, encoding, delimiter)
			const dialect = dialectOf({encoding, delimiter})
			const bytes = encode(text, encoding)
			const index = indexCsv(bytes, dialect)
			if (!index.rowCount) continue
			const row = int(next, index.rowCount)
			const saved = serializeCsv(bytes, dialect, index, setCell(createEdits(index), row, int(next, 5), cell()))
			const context = JSON.stringify({text, encoding, row})
			const before = index.rowStarts[row]
			const after = bytes.length - index.rowStarts[row + 1]
			expect(saved.subarray(0, before), context).toEqual(bytes.subarray(0, before))
			expect(saved.subarray(saved.length - after), context).toEqual(bytes.subarray(bytes.length - after))
		}
	})
})
