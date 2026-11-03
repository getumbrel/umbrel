// The engine against real workbooks: every formula in the corpus parses, shared
// formulas expand through shiftFormula, and recalculating reproduces the values
// the files cached (by real Excel in the *-poi.xlsx files). Skipped when the
// corpus isn't there.

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {inflateRawSync} from 'node:zlib'
import {describe, expect, test} from 'vitest'

import {Calculator, type CellAddress} from './calculator'
import {parseFormula} from './parser'
import {shiftFormula} from './shift'
import {baseOf} from './test-helpers'
import {errorFromCode, isError, type Value} from './values'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''
const spreadsheet = (name: string) =>
	FIXTURES
		? [join(FIXTURES, 'Samples2/Spreadsheets', name), join(FIXTURES, 'Samples/Spreadsheets', name)].find(existsSync)
		: undefined

// Just enough ZIP for trusted fixtures: the central directory and deflated entries, inflated on demand
function unzip(path: string): (name: string) => string | undefined {
	const bytes = readFileSync(path)
	let end = bytes.length - 22
	while (end > 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--
	const entries = new Map<string, {method: number; start: number; size: number}>()
	let p = bytes.readUInt32LE(end + 16)
	for (let i = bytes.readUInt16LE(end + 10); i > 0; i--) {
		const nameLength = bytes.readUInt16LE(p + 28)
		const local = bytes.readUInt32LE(p + 42)
		entries.set(bytes.toString('utf8', p + 46, p + 46 + nameLength), {
			method: bytes.readUInt16LE(p + 10),
			start: local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28),
			size: bytes.readUInt32LE(p + 20),
		})
		p += 46 + nameLength + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32)
	}
	return (name) => {
		const entry = entries.get(name)
		if (!entry) return undefined
		const data = bytes.subarray(entry.start, entry.start + entry.size)
		return (entry.method === 8 ? inflateRawSync(data) : data).toString('utf8')
	}
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}
const decode = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) =>
		entity[0] === '#'
			? String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
			: ENTITIES[entity],
	)
const attribute = (attributes: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1]
const textOf = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decode(t)).join('')

function address(ref: string, sheet: number): CellAddress {
	const [, letters, digits] = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref)!
	let col = 0
	for (const letter of letters) col = col * 26 + letter.charCodeAt(0) - 64
	return {sheet, row: Number(digits) - 1, col: col - 1}
}

type FixtureCell = {address: CellAddress; value: Value; formula?: string}

// Workbook parts by regex; fine for trusted fixtures, never for user files
function readWorkbook(path: string) {
	const entry = unzip(path)
	const workbook = entry('xl/workbook.xml')!
	const rels = entry('xl/_rels/workbook.xml.rels')!
	const targets = new Map(
		[...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(([, a]) => [attribute(a, 'Id'), attribute(a, 'Target')!]),
	)
	const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map(([, a]) => ({
		name: decode(attribute(a, 'name')!),
		part: `xl/${targets.get(attribute(a, 'r:id'))!.replace(/^\/?(xl\/)?/, '')}`,
	}))
	const names = new Map<string, string>()
	for (const [, a, text] of workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
		const name = decode(attribute(a, 'name')!)
		if (attribute(a, 'localSheetId') === undefined && !name.startsWith('_xlnm.')) names.set(name, decode(text))
	}
	const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook)
	const sharedStrings = entry('xl/sharedStrings.xml') ?? ''
	const strings = [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
		textOf(si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')),
	)

	function* cells(sheet: number): Generator<FixtureCell> {
		const xml = entry(sheets[sheet].part) ?? ''
		const masters = new Map<string, {formula: string; at: CellAddress}>()
		for (const [, attributes, body = ''] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const at = address(attribute(attributes, 'r')!, sheet)
			const type = attribute(attributes, 't')
			const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
			let value: Value
			if (type === 's') value = strings[Number(raw)]
			else if (type === 'str') value = decode(raw ?? '')
			else if (type === 'inlineStr') value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '')
			else if (type === 'b') value = raw === '1'
			else if (type === 'e') value = errorFromCode(raw ?? '') ?? {error: '#N/A'}
			else value = raw === undefined || raw === '' ? null : Number(raw)
			const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body)
			if (!f) {
				if (value !== null) yield {address: at, value}
				continue
			}
			let formula = f[2] === undefined ? undefined : decode(f[2])
			const si = attribute(f[1], 'si')
			if (attribute(f[1], 't') === 'shared' && si !== undefined) {
				if (formula !== undefined) masters.set(si, {formula, at})
				else {
					const master = masters.get(si)!
					formula = shiftFormula(master.formula, {rows: at.row - master.at.row, cols: at.col - master.at.col})
				}
			}
			yield formula === undefined ? {address: at, value} : {address: at, value, formula}
		}
	}

	const all = sheets.flatMap((_, index) => [...cells(index)])
	return {sheetNames: sheets.map(({name}) => name), names, date1904, cells: all, cellsOf: cells}
}

function sameAsCached(actual: Value, cached: Value) {
	if (typeof actual === 'number' && typeof cached === 'number') {
		return Math.abs(actual - cached) <= 1e-12 * Math.max(1, Math.abs(cached))
	}
	if (isError(actual) && isError(cached)) return actual.error === cached.error
	return actual === cached
}

const label = ({address: {sheet, row, col}}: FixtureCell, sheetNames: string[]) =>
	`${sheetNames[sheet]}!${String.fromCharCode(65 + col)}${row + 1}`

// Recalculates everything and lists the formula cells whose values differ from `expected`
function recalculate(file: string, expected?: (cell: FixtureCell) => Value) {
	const {sheetNames, names, date1904, cells} = readWorkbook(spreadsheet(file)!)
	const calculator = new Calculator(sheetNames, cells, {names, date1904})
	calculator.recalculate()
	const formulas = cells.filter((cell) => cell.formula !== undefined)
	const stale = formulas.filter((cell) => calculator.isStale(cell.address))
	const mismatches = formulas
		.filter((cell) => !calculator.isStale(cell.address))
		.filter((cell) => !sameAsCached(calculator.value(cell.address), expected ? expected(cell) : cell.value))
		.map((cell) => [label(cell, sheetNames), cell.formula, calculator.value(cell.address), cell.value])
	return {calculator, sheetNames, cells, formulas, stale, mismatches}
}

const CORPUS = [
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
	'sheet.xlsx',
].filter(spreadsheet)

describe.skipIf(CORPUS.length === 0)('fixture workbooks', () => {
	test.each(CORPUS)('every formula in %s parses', (file) => {
		const {cells} = readWorkbook(spreadsheet(file)!)
		for (const {formula} of cells) if (formula !== undefined) expect(() => parseFormula(formula)).not.toThrow()
	})

	// Cached by real Excel (unicode.xlsx by the generator), so these are Excel's own answers
	test.each(
		[
			'conditional-formatting-x14-poi.xlsx',
			'table-listobject-poi.xlsx',
			'strict-ooxml-poi.xlsx',
			'unicode.xlsx',
		].filter(spreadsheet),
	)('recalculating %s reproduces every cached value', (file) => {
		const {formulas, stale, mismatches} = recalculate(file)
		expect(formulas.length).toBeGreaterThan(0)
		expect(stale).toEqual([])
		expect(mismatches).toEqual([])
	})

	const oracles = ['excel-numfmt-oracle-poi.xlsx', 'excel-datefmt-oracle-poi.xlsx'].filter(spreadsheet)

	test.skipIf(!spreadsheet('conditional-formatting-x14-poi.xlsx') || oracles.length < 2)(
		'shared formulas expand to each member cell',
		() => {
			const {cells} = readWorkbook(spreadsheet('conditional-formatting-x14-poi.xlsx')!)
			const formula = (ref: string) => cells.find((cell) => label(cell, ['CF']) === `CF!${ref}`)?.formula
			expect([formula('D2'), formula('E2'), formula('U17')]).toEqual(['$A2', '$A2', '$A17'])
			const oracle = readWorkbook(spreadsheet('excel-numfmt-oracle-poi.xlsx')!)
			const a4 = oracle.cells.find(({address}) => address.sheet === 1 && address.row === 3 && address.col === 0)
			expect(a4?.formula).toBe('TEXT(C4, B4)')
		},
	)

	// The worker's calculator holds only the formulas, and reads every other value through the sheets
	test.each(CORPUS)('%s calculates the same with its values read through the sheets', (file) => {
		const {sheetNames, names, date1904, cells} = readWorkbook(spreadsheet(file)!)
		const values = cells.filter((cell) => cell.formula === undefined)
		const formulas = cells.filter((cell) => cell.formula !== undefined)
		const holding = new Calculator(sheetNames, cells, {names, date1904})
		const through = new Calculator(sheetNames, formulas, {names, date1904, base: baseOf(sheetNames.length, values)})
		const changes = (calculator: Calculator, run: (calculator: Calculator) => ReturnType<Calculator['set']>) =>
			run(calculator).map(({address, value}) => [label({address, value}, sheetNames), value])
		expect(changes(through, (c) => c.recalculate())).toEqual(changes(holding, (c) => c.recalculate()))
		for (const {address} of formulas) {
			expect([through.value(address), through.isStale(address)]).toEqual([
				holding.value(address),
				holding.isStale(address),
			])
		}
		// Edits over values the file holds, then emptied, then put back
		const edited = values.filter((_, i) => i % Math.max(1, Math.floor(values.length / 40)) === 0).slice(0, 40)
		for (const {address, value} of edited) {
			for (const run of [
				(c: Calculator) => c.set(address, '7'),
				(c: Calculator) => c.set(address, ''),
				(c: Calculator) => c.restore([{address, value}]),
			])
				expect(changes(through, run)).toEqual(changes(holding, run))
		}
	})

	test.skipIf(!spreadsheet('budget.xlsx'))('recalculating budget.xlsx reproduces every cached value', () => {
		const {formulas, stale, mismatches} = recalculate('budget.xlsx')
		expect(formulas).toHaveLength(220)
		expect(stale).toEqual([])
		expect(mismatches).toEqual([])
	})

	test.skipIf(!spreadsheet('budget.xlsx') || !spreadsheet('budget-formulas-no-cache.xlsx'))(
		'budget-formulas-no-cache.xlsx calculates the values budget.xlsx caches',
		() => {
			const cached = new Map(
				readWorkbook(spreadsheet('budget.xlsx')!).cells.map(({address: {sheet, row, col}, value}) => [
					`${sheet}:${row}:${col}`,
					value,
				]),
			)
			const {stale, mismatches} = recalculate(
				'budget-formulas-no-cache.xlsx',
				({address: {sheet, row, col}}) => cached.get(`${sheet}:${row}:${col}`)!,
			)
			expect(stale).toEqual([])
			expect(mismatches).toEqual([])
		},
	)

	// TEXT formats through the grid's number formatter (engine D's number-format.ts), so these grade that
	// formatter more than TEXT itself: every cell must calculate, and agreement with Excel is reported
	test.skipIf(oracles.length < 2)('TEXT against values cached by real Excel', () => {
		for (const [file, count] of [
			['excel-datefmt-oracle-poi.xlsx', 45],
			['excel-numfmt-oracle-poi.xlsx', 325],
		] as const) {
			const {formulas, stale, mismatches} = recalculate(file)
			expect(formulas).toHaveLength(count)
			expect(stale).toEqual([])
			console.log(
				`TEXT vs Excel, ${file}: ${count - mismatches.length}/${count} agree; ` +
					`e.g. ${JSON.stringify(mismatches.slice(0, 2).map(([cell, , ours, excel]) => ({cell, ours, excel})))}`,
			)
		}
	})

	test.skipIf(!spreadsheet('budget.xlsx'))('an edit in budget.xlsx flows through lookups, SUMIF and totals', () => {
		const {sheetNames, names, cells} = readWorkbook(spreadsheet('budget.xlsx')!)
		const calculator = new Calculator(sheetNames, cells, {names})
		const at = (ref: string) => {
			const [sheet, cell] = ref.split('!')
			return address(cell, sheetNames.indexOf(sheet))
		}
		const read = (ref: string) => calculator.value(at(ref)) as number
		const category = calculator.value(at('Expenses!C5'))
		const summaryRow = [5, 6, 7, 8, 9, 10, 11, 12].find((row) => calculator.value(at(`Summary!A${row}`)) === category)!
		const before = {total: read('Expenses!H5'), actual: read(`Summary!C${summaryRow}`), sum: read('Summary!C13')}
		const rate = read('Expenses!F5')
		const amount = read('Expenses!E5')

		const changes = calculator.set(at('Expenses!E5'), String(amount + 100))
		const changed = new Set(
			changes.map(({address: {sheet, row, col}}) => `${sheetNames[sheet]}!${String.fromCharCode(65 + col)}${row + 1}`),
		)
		const delta = read('Expenses!H5') - before.total
		const tax = Math.round((amount + 100) * rate * 100 + 1e-9) / 100
		expect(read('Expenses!H5')).toBeCloseTo(amount + 100 + tax, 9)
		expect(read(`Summary!C${summaryRow}`) - before.actual).toBeCloseTo(delta, 9)
		expect(read('Summary!C13') - before.sum).toBeCloseTo(delta, 9)
		for (const ref of [
			'Expenses!E5',
			'Expenses!G5',
			'Expenses!H5',
			`Summary!C${summaryRow}`,
			`Summary!D${summaryRow}`,
			'Summary!C13',
			'Summary!D13',
		]) {
			expect(changed).toContain(ref)
		}
		// Other categories don't move
		expect(changed.has(`Summary!C${summaryRow === 5 ? 6 : 5}`)).toBe(false)
	})
})

describe.skipIf(!spreadsheet('sheet.xlsx'))('sheet.xlsx: 240k values and 20k uncached SUMs', () => {
	test('loads and calculates every row sum', () => {
		const {sheetNames, cells} = readWorkbook(spreadsheet('sheet.xlsx')!)
		let started = performance.now()
		const calculator = new Calculator(sheetNames, cells)
		const load = performance.now() - started
		started = performance.now()
		const changes = calculator.recalculate()
		const full = performance.now() - started
		expect(changes).toHaveLength(20000)
		const values = new Map(cells.map(({address: {row, col}, value}) => [row * 16384 + col, value]))
		for (const row of [1, 2, 9999, 20000]) {
			let sum = 0
			for (let col = 0; col < 12; col++) {
				const value = values.get(row * 16384 + col)
				if (typeof value === 'number') sum += value
			}
			expect(calculator.value({sheet: 0, row, col: 12})).toBe(sum)
		}
		started = performance.now()
		calculator.set({sheet: 0, row: 5000, col: 3}, '1000')
		const edit = performance.now() - started
		console.log(
			`sheet.xlsx: load ${load.toFixed(0)} ms, calculate 20k SUMs ${full.toFixed(0)} ms, edit ${edit.toFixed(2)} ms`,
		)
	})
})

describe.skipIf(!spreadsheet('r200k.xlsx'))('r200k.xlsx: 2M cells', () => {
	test('loads into the calculator and sums a whole column', {timeout: 120_000}, () => {
		const {sheetNames, cellsOf} = readWorkbook(spreadsheet('r200k.xlsx')!)
		let started = performance.now()
		const cells = [...cellsOf(0)]
		const parse = performance.now() - started
		started = performance.now()
		const calculator = new Calculator(sheetNames, cells)
		const load = performance.now() - started
		expect(cells).toHaveLength(2000010)
		started = performance.now()
		calculator.set({sheet: 0, row: 0, col: 11}, '=SUM(B:B)')
		const sum = performance.now() - started
		const total = calculator.value({sheet: 0, row: 0, col: 11}) as number
		started = performance.now()
		calculator.set({sheet: 0, row: 100, col: 1}, String((calculator.value({sheet: 0, row: 100, col: 1}) as number) + 1))
		const edit = performance.now() - started
		expect(calculator.value({sheet: 0, row: 0, col: 11})).toBe(total + 1)
		console.log(
			`r200k.xlsx: test-side XML parse ${parse.toFixed(0)} ms, Calculator load of 2M cells ${load.toFixed(0)} ms, ` +
				`=SUM(B:B) over 200k rows ${sum.toFixed(1)} ms, edit recalculating it ${edit.toFixed(1)} ms`,
		)
	})
})
