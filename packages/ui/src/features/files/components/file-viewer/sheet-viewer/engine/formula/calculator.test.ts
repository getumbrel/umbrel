import {describe, expect, test} from 'vitest'

import {Calculator, parseInput, type CellAddress} from './calculator'
import {FormulaSyntaxError} from './parser'
import {at, baseOf, workbook} from './test-helpers'
import {Errors, type Value} from './values'

const NA = {error: '#N/A'}
const CALC = {error: '#CALC!'}
const NAME = {error: '#NAME?'}

const refs = (changes: {address: CellAddress; value: Value}[], sheets = ['Sheet1', 'Sheet2']) =>
	changes.map(({address: {sheet, row, col}, value}) => {
		const name = String.fromCharCode(65 + col) + (row + 1)
		return [sheet === 0 ? name : `${sheets[sheet]}!${name}`, value]
	})

describe('parseInput', () => {
	test.each([
		['42', 42],
		['-1.5', -1.5],
		['+7', 7],
		[' 12 ', 12],
		['-0', 0],
		['1,234.5', 1234.5],
		['12,34', '12,34'],
		['1e3', 1000],
		['50%', 0.5],
		['$1,000', 1000],
		['TRUE', true],
		['false', false],
		['#N/A', NA],
		['#div/0!', {error: '#DIV/0!'}],
		["'123", '123'],
		["'=1+1", '=1+1'],
		["'", ''],
		['', null],
		['2026-10-13', 46308],
		['2026-10-13 18:00', 46308.75],
		['2026-10-13T06:00:00', 46308.25],
		['14:30', 14.5 / 24],
		['2:30 PM', 14.5 / 24],
		['12:00 AM', 0],
		// Ambiguous or invalid dates stay text
		['10/13/2026', '10/13/2026'],
		['2026-02-30', '2026-02-30'],
		['1899-12-31', '1899-12-31'],
		['25:00', '25:00'],
		['abc', 'abc'],
		['1 2', '1 2'],
		['.', '.'],
	])('%j', (input, expected) => {
		const {value} = parseInput(input)
		if (typeof expected === 'number' && !Number.isInteger(expected)) expect(value).toBeCloseTo(expected, 12)
		else expect(value).toEqual(expected)
	})

	test('hints the number format to apply', () => {
		expect(parseInput('50%').kind).toBe('percent')
		expect(parseInput('$5').kind).toBe('currency')
		expect(parseInput('2026-10-13').kind).toBe('date')
		expect(parseInput('9:15').kind).toBe('time')
		expect(parseInput('2026-10-13 9:15').kind).toBe('datetime')
		expect(parseInput('5').kind).toBe('number')
		expect(parseInput('x').kind).toBeUndefined()
	})

	test('text stops where a cell holds no more', () => {
		expect(parseInput('x'.repeat(40_000)).value).toHaveLength(32_767)
		expect(parseInput(`'${'7'.repeat(40_000)}`).value).toHaveLength(32_767)
	})

	test('the 1904 date system', () => {
		expect(parseInput('2026-10-13', true).value).toBe(46308 - 1462)
		expect(parseInput('1903-12-31', true).value).toBe('1903-12-31')
	})
})

describe('set', () => {
	test('returns the edited cell first, then its dependents in dependency order', () => {
		const {calculator} = workbook({A1: 1, B1: '=A1*2', C1: '=B1+A1', D1: '=C1*10'})
		expect(refs(calculator.set(at('A1'), '2'))).toEqual([
			['A1', 2],
			['B1', 4],
			['C1', 6],
			['D1', 60],
		])
	})

	test('only cells whose value changed are reported', () => {
		const {calculator} = workbook({A1: 1, B1: '=A1>0', C1: '=B1'})
		expect(refs(calculator.set(at('A1'), '5'))).toEqual([['A1', 5]])
		expect(calculator.set(at('A1'), '5')).toEqual([])
	})

	test('a formula input is calculated and depends on its precedents', () => {
		const {calculator, value} = workbook({A1: 3})
		expect(refs(calculator.set(at('B1'), '=A1^2'))).toEqual([['B1', 9]])
		expect(calculator.formula(at('B1'))).toBe('A1^2')
		expect(refs(calculator.set(at('A1'), '4'))).toEqual([
			['A1', 4],
			['B1', 16],
		])
		expect(value('B1')).toBe(16)
	})

	test('replacing a formula with a value detaches it from its old precedents', () => {
		const {calculator} = workbook({A1: 1, B1: '=A1'})
		calculator.set(at('B1'), 'text')
		expect(calculator.formula(at('B1'))).toBeUndefined()
		expect(refs(calculator.set(at('A1'), '9'))).toEqual([['A1', 9]])
		expect(calculator.value(at('B1'))).toBe('text')
	})

	test('clearing a cell empties it for its dependents', () => {
		const {calculator} = workbook({A1: 5, B1: '=A1&"!"', C1: '=ISBLANK(A1)'})
		const [edited, ...dependents] = refs(calculator.set(at('A1'), ''))
		expect(edited).toEqual(['A1', null])
		// Independent dependents come in no particular order
		expect(dependents).toEqual(
			expect.arrayContaining([
				['B1', '!'],
				['C1', true],
			]),
		)
		expect(dependents).toHaveLength(2)
	})

	test('input that does not parse as a formula throws and changes nothing', () => {
		const {calculator, value} = workbook({A1: 5, B1: '=A1'})
		expect(() => calculator.set(at('A1'), '=1+')).toThrow(FormulaSyntaxError)
		expect(() => calculator.set(at('A1'), '=')).toThrow(FormulaSyntaxError)
		expect(() => calculator.set(at('A1'), '=ROUND(1)')).toThrow(FormulaSyntaxError)
		expect(() => calculator.set(at('A1'), '=SUM()')).toThrow(FormulaSyntaxError)
		expect(value('A1')).toBe(5)
		expect(refs(calculator.set(at('A1'), '6'))).toEqual([
			['A1', 6],
			['B1', 6],
		])
	})

	test('addresses outside the workbook throw', () => {
		const {calculator} = workbook()
		expect(() => calculator.set({sheet: 2, row: 0, col: 0}, '1')).toThrow(RangeError)
		expect(() => calculator.set({sheet: 0, row: 1048576, col: 0}, '1')).toThrow(RangeError)
		expect(() => calculator.set({sheet: 0, row: 0, col: -1}, '1')).toThrow(RangeError)
		expect(() => calculator.set({sheet: 0, row: 0.5, col: 0}, '1')).toThrow(RangeError)
	})

	test('cells read back as Excel stores them', () => {
		const {calculator, value} = workbook()
		calculator.set(at('A1'), '=A2')
		expect(value('A1')).toBe(0)
		calculator.set(at('A3'), '=""')
		expect(value('A3')).toBe('')
		calculator.set(at('A4'), "'007")
		expect(value('A4')).toBe('007')
		expect(value('Z99')).toBeNull()
		expect(calculator.isStale(at('A1'))).toBe(false)
		expect(calculator.isStale(at('A4'))).toBe(false)
	})
})

describe('recalculation', () => {
	test('a diamond evaluates its join once, after both sides', () => {
		const {calculator} = workbook({A1: 1, B1: '=A1+1', C1: '=A1*10', D1: '=B1+C1'})
		const changes = refs(calculator.set(at('A1'), '2'))
		expect(changes.map(([ref]) => ref).sort()).toEqual(['A1', 'B1', 'C1', 'D1'])
		expect(changes.at(-1)).toEqual(['D1', 23])
	})

	test('long chains recalculate without recursion', () => {
		const cells: Record<string, Value> = {A1: 0}
		for (let row = 2; row <= 20000; row++) cells[`A${row}`] = `=A${row - 1}+1`
		const {calculator, value} = workbook(cells)
		expect(value('A20000')).toBe(19999)
		const changes = calculator.set(at('A1'), '1')
		expect(changes).toHaveLength(20000)
		expect(value('A20000')).toBe(20000)
	})

	test('ranges, whole columns, rows and other sheets recalculate', () => {
		const {calculator, value} = workbook({
			A1: 1,
			A2: 2,
			E10: '=SUM(A1:A3)',
			E11: '=SUM(A:A)',
			E12: '=SUM(2:2)',
			E13: '=Sheet2!A1*2',
			E14: "=SUM('Sheet2'!A1:B2)",
			'Sheet2!A1': 5,
		})
		calculator.set(at('A3'), '10')
		expect([value('E10'), value('E11')]).toEqual([13, 13])
		calculator.set(at('C2'), '7')
		expect(value('E12')).toBe(9)
		calculator.set(at('Sheet2!A1', ['Sheet1', 'Sheet2']), '6')
		expect([value('E13'), value('E14')]).toEqual([12, 6])
		calculator.set(at('Sheet2!B2', ['Sheet1', 'Sheet2']), '1')
		expect(value('E14')).toBe(7)
	})

	test('a whole-column formula sees cells set past the old used range', () => {
		const {calculator, value} = workbook({A1: 1, B1: '=SUM(A:A)', C1: '=COUNTBLANK(A:A)'})
		calculator.set(at('A500000'), '2')
		expect(value('B1')).toBe(3)
		expect(value('C1')).toBe(1048574)
	})

	test('a range ending in a function depends on the whole box it can span', () => {
		const {calculator, value} = workbook({A1: 1, B2: 2, C1: 1, C2: 2, C3: 3, D1: '=SUM(A1:INDEX(C1:C3,2))'})
		expect(value('D1')).toBe(6)
		calculator.set(at('B1'), '10')
		expect(value('D1')).toBe(16)
	})

	test('INDEX and lookups depend on their whole tables', () => {
		const {calculator, value} = workbook({A1: 'x', B1: 1, A2: 'y', B2: 2, C1: '=VLOOKUP("y",A1:B2,2,FALSE)'})
		calculator.set(at('B2'), '20')
		expect(value('C1')).toBe(20)
	})

	test('volatile functions recalculate on every edit', () => {
		let now = new Date(2026, 9, 13, 12, 0, 0)
		const {calculator, value} = workbook({A1: '=NOW()', B1: '=A1+1'}, {now: () => now})
		expect(value('A1')).toBeCloseTo(46308.5, 9)
		now = new Date(2026, 9, 14, 12, 0, 0)
		const changes = refs(calculator.set(at('C1'), '1'))
		expect(changes[0]).toEqual(['C1', 1])
		expect(changes.slice(1).map(([ref]) => ref)).toEqual(['A1', 'B1'])
		expect(value('B1')).toBeCloseTo(46310.5, 9)
	})

	test('recalculate() fills formulas saved without cached values', () => {
		const calculator = new Calculator(
			['S'],
			[
				{address: at('A1'), value: 2},
				{address: at('A2'), value: null, formula: 'A1*3'},
				{address: at('A3'), value: null, formula: 'A2+A1'},
			],
		)
		expect(calculator.value(at('A2'))).toBeNull()
		expect(refs(calculator.recalculate(), ['S'])).toEqual([
			['A2', 6],
			['A3', 8],
		])
	})

	test('loading trusts cached values until something changes', () => {
		const calculator = new Calculator(
			['S'],
			[
				{address: at('A1'), value: 1},
				{address: at('B1'), value: 999, formula: 'A1*2'},
			],
		)
		expect(calculator.value(at('B1'))).toBe(999)
		calculator.set(at('A1'), '5')
		expect(calculator.value(at('B1'))).toBe(10)
	})
})

describe('circular references', () => {
	test('members of a cycle become #CALC!, and what reads them sees it', () => {
		const {calculator, value} = workbook({A1: 1, B1: '=A1', C1: '=B1+1', D1: '=C1*2'})
		const changes = refs(calculator.set(at('A1'), '=C1'))
		expect(changes).toEqual(
			expect.arrayContaining([
				['A1', CALC],
				['B1', CALC],
				['C1', CALC],
				['D1', CALC],
			]),
		)
		expect(value('D1')).toEqual(CALC)
	})

	test('a formula reading itself, directly or through a range, is a cycle', () => {
		const {calculator, value} = workbook({A1: 1, A2: 2})
		calculator.set(at('B1'), '=B1+1')
		calculator.set(at('A3'), '=SUM(A1:A3)')
		expect([value('B1'), value('A3')]).toEqual([CALC, CALC])
	})

	test('an error handler does not hide a cycle from its members', () => {
		const {calculator, value} = workbook({A1: '=IFERROR(B1,0)', B1: 1})
		calculator.set(at('B1'), '=A1')
		expect([value('A1'), value('B1')]).toEqual([CALC, CALC])
		calculator.set(at('C1'), '=IFERROR(A1,"caught")')
		expect(value('C1')).toBe('caught')
	})

	test('breaking the cycle recovers every member', () => {
		const {calculator, value} = workbook({A1: '=B1+1', B1: 1})
		calculator.set(at('B1'), '=A1')
		expect(value('A1')).toEqual(CALC)
		calculator.set(at('B1'), '5')
		expect([value('A1'), value('B1')]).toEqual([6, 5])
	})
})

describe('stale cells', () => {
	const file = (cells: {ref: string; value: Value; formula?: string}[]) =>
		new Calculator(
			['S'],
			cells.map(({ref, value, formula}) => ({address: at(ref), value, formula})),
		)

	test('formulas we cannot calculate keep their cached value', () => {
		const calculator = file([
			{ref: 'A1', value: 5},
			{ref: 'B1', value: 0.42, formula: 'RAND()*A1'},
			{ref: 'C1', value: 'x', formula: 'OFFSET(A1,0,1)'},
			{ref: 'D1', value: 7, formula: 'SUM(Table1[Amount])'},
			{ref: 'E1', value: 3, formula: '[1]Sheet1!A1'},
			{ref: 'F1', value: 'kept', formula: 'SUM('},
		])
		for (const ref of ['B1', 'C1', 'D1', 'E1', 'F1']) expect(calculator.isStale(at(ref))).toBe(true)
		expect(calculator.set(at('A1'), '6')).toEqual([{address: at('A1'), value: 6}])
		expect([calculator.value(at('B1')), calculator.value(at('F1'))]).toEqual([0.42, 'kept'])
	})

	test('what reads an outdated cell is stale too, until it no longer does', () => {
		const calculator = file([
			{ref: 'A1', value: 1},
			{ref: 'B1', value: 10, formula: 'OFFSET(A1,0,0)*10'},
			{ref: 'C1', value: 11, formula: 'B1+1'},
			{ref: 'D1', value: 2, formula: 'A1*2'},
		])
		expect(calculator.isStale(at('C1'))).toBe(false)
		calculator.set(at('A1'), '2')
		expect([calculator.isStale(at('B1')), calculator.isStale(at('C1')), calculator.isStale(at('D1'))]).toEqual([
			true,
			true,
			false,
		])
		expect(calculator.value(at('D1'))).toBe(4)
		calculator.set(at('C1'), '=D1+1')
		expect(calculator.isStale(at('C1'))).toBe(false)
	})

	test('a result of several cells keeps the cached value until it is one value again', () => {
		const calculator = file([
			{ref: 'A1', value: 1},
			{ref: 'B1', value: 1, formula: 'IF(A1>0,A1,A1:A2)'},
		])
		calculator.set(at('A1'), '-1')
		expect(calculator.isStale(at('B1'))).toBe(true)
		expect(calculator.value(at('B1'))).toBe(1)
		calculator.set(at('A1'), '3')
		expect(calculator.isStale(at('B1'))).toBe(false)
		expect(calculator.value(at('B1'))).toBe(3)
	})

	test('an unsupported formula typed in has no value of ours', () => {
		const calculator = file([{ref: 'A1', value: 5}])
		expect(calculator.set(at('A1'), '=INDIRECT("B1")')).toEqual([{address: at('A1'), value: null}])
		expect(calculator.isStale(at('A1'))).toBe(true)
	})
})

describe('restore', () => {
	const file = () =>
		new Calculator(
			['S'],
			[
				{address: at('A1'), value: 2},
				{address: at('B1'), value: 4, formula: 'A1*2'},
				{address: at('C1'), value: 'from Excel', formula: 'INDIRECT("A1")'},
				{address: at('D1'), value: 0.1 + 0.2},
			],
		)

	test('undoes an edit exactly, cached values included, and recalculates what reads the cells', () => {
		const calculator = file()
		calculator.set(at('A1'), '5')
		calculator.set(at('C1'), '=A1')
		calculator.set(at('D1'), '0.3')
		expect(
			refs(
				calculator.restore([
					{address: at('A1'), value: 2},
					{address: at('C1'), value: 'from Excel', formula: 'INDIRECT("A1")'},
					{address: at('D1'), value: 0.1 + 0.2},
				]),
			),
		).toEqual([
			['A1', 2],
			['C1', 'from Excel'],
			['D1', 0.30000000000000004],
			['B1', 4],
		])
		expect(calculator.formula(at('C1'))).toBe('INDIRECT("A1")')
		expect(calculator.isStale(at('C1'))).toBe(true)
		// The restored formula is live again
		expect(refs(calculator.set(at('A1'), '3'))).toEqual([
			['A1', 3],
			['B1', 6],
		])
	})

	test('restores formulas over values and empties over both, reporting only what changed', () => {
		const calculator = file()
		expect(refs(calculator.restore([{address: at('B1'), value: 4, formula: 'A1*2'}]))).toEqual([])
		expect(
			refs(
				calculator.restore([
					{address: at('A1'), value: null},
					{address: at('E1'), value: 9, formula: 'B1+5'},
				]),
			),
		).toEqual([
			['A1', null],
			['E1', 9],
			['B1', 0],
			['E1', 5],
		])
		expect(() => calculator.restore([{address: {sheet: 1, row: 0, col: 0}, value: 1}])).toThrow(RangeError)
	})
})

describe('defined names', () => {
	const names = new Map([
		['Rate', '0.2'],
		['Negative', '-3'],
		['Label', '"total"'],
		['Lookup', "'Sheet2'!$A$1:$B$2"],
		['Here', '$C$1'],
		['Relative', 'Sheet1!A1'],
		['Computed', 'Sheet1!$A$1*2'],
		['Table', 'Table1[#All]'],
		['Broken', '#REF!'],
		['Gone', 'Missing!$A$1'],
	])

	test('constants and absolute references', () => {
		const {calculator, value} = workbook(
			{
				A1: '=100*rate',
				A2: '=Negative',
				A3: '=LABEL',
				A4: '=VLOOKUP("b",Lookup,2,FALSE)',
				A5: '=Here*2',
				C1: 21,
				'Sheet2!A1': 'a',
				'Sheet2!B1': 1,
				'Sheet2!A2': 'b',
				'Sheet2!B2': 2,
				'Sheet2!C1': 'c',
				'Sheet2!D1': '=Here',
			},
			{names},
		)
		expect([value('A1'), value('A2'), value('A3'), value('A4'), value('A5')]).toEqual([20, -3, 'total', 2, 42])
		// A reference without a sheet name is to the sheet using it
		expect(value('Sheet2!D1')).toBe('c')
		calculator.set(at('Sheet2!B2', ['Sheet1', 'Sheet2']), '5')
		expect(value('A4')).toBe(5)
		calculator.set(at('C1'), '1')
		expect(value('A5')).toBe(2)
	})

	test('relative and computed definitions are stale; missing ones are #NAME? like Excel', () => {
		const {calculator, value} = workbook(
			{A1: '=Relative', A2: '=Computed', A3: '=SUM(Table)', A4: '=Nope', A5: '=Broken', A6: '=Gone'},
			{names},
		)
		expect([calculator.isStale(at('A1')), calculator.isStale(at('A2')), calculator.isStale(at('A3'))]).toEqual([
			true,
			true,
			true,
		])
		expect([value('A4'), value('A5'), value('A6')]).toEqual([NAME, {error: '#REF!'}, {error: '#REF!'}])
	})

	test("a sheet's own names stand in for the workbook's on that sheet, and only there", () => {
		const {calculator, value} = workbook(
			{
				A1: '=10*Rate',
				A2: '=LocalOnly',
				A3: '=Here',
				C1: 21,
				D1: 5,
				'Sheet2!A1': '=10*rate',
				'Sheet2!A2': '=LocalOnly',
				'Sheet2!A3': '=Here',
				'Sheet2!D1': 15,
			},
			{
				names,
				localNames: new Map([
					[
						1,
						new Map([
							['RATE', '0.5'],
							['LocalOnly', '$D$1'],
							['Here', 'Sheet1!$D$1'],
						]),
					],
				]),
			},
		)
		expect([value('A1'), value('A2'), value('A3')]).toEqual([2, NAME, 21])
		expect([value('Sheet2!A1'), value('Sheet2!A2'), value('Sheet2!A3')]).toEqual([5, 15, 5])
		// What reads a name recalculates with what the name means on its own sheet
		expect(refs(calculator.set(at('D1'), '6'))).toEqual([
			['D1', 6],
			['Sheet2!A3', 6],
		])
		expect(refs(calculator.set(at('C1'), '1'))).toEqual([
			['C1', 1],
			['A3', 1],
		])
		expect(refs(calculator.set(at('Sheet2!D1', ['Sheet1', 'Sheet2']), '7'))).toEqual([
			['Sheet2!D1', 7],
			['Sheet2!A2', 7],
		])
	})
})

describe('hostile input', () => {
	test('arrays too large to build leave the cell stale instead of exhausting memory', () => {
		const {calculator, value} = workbook({A1: 1, XFD1048576: 1})
		calculator.set(at('B2'), '=SUMPRODUCT(A:A*1:1)')
		expect(calculator.isStale(at('B2'))).toBe(true)
		calculator.set(at('B3'), '=SUM(A:A)')
		expect(value('B3')).toBe(1)
	})

	test('a sheet with one far-away cell still scans fast', () => {
		const cells: Record<string, Value> = {A1048576: 1}
		for (let row = 1; row <= 100; row++) cells[`A${row}`] = row
		for (let row = 1; row <= 2000; row++) cells[`B${row}`] = '=SUM(A:A)'
		const started = performance.now()
		const {value} = workbook(cells)
		expect(value('B2000')).toBe(5051)
		expect(performance.now() - started).toBeLessThan(2000)
	})

	test('wildcards do not backtrack', () => {
		const started = performance.now()
		const {calculator, value} = workbook({A1: 'a'.repeat(30000)})
		calculator.set(at('B1'), `=COUNTIF(A1,"${'*a'.repeat(100)}*b")`)
		calculator.set(at('B2'), `=SEARCH("${'*a'.repeat(100)}*b",A1)`)
		expect(value('B1')).toBe(0)
		expect(value('B2')).toEqual({error: '#VALUE!'})
		expect(performance.now() - started).toBeLessThan(2000)
	})

	test('text cannot grow past the cell limit', () => {
		const {calculator, value} = workbook({A1: 'x'.repeat(20000)})
		calculator.set(at('B1'), '=A1&A1')
		calculator.set(at('B2'), '=REPT(A1,1E+300)')
		calculator.set(at('B3'), '=CONCAT(A1,A1)')
		calculator.set(at('B4'), '=TEXTJOIN(",",TRUE,A1,A1)')
		calculator.set(at('B5'), '=SUBSTITUTE(A1,"x","yy")')
		for (const ref of ['B1', 'B2', 'B3', 'B4', 'B5']) expect(value(ref)).toEqual({error: '#VALUE!'})
	})

	test('a recalculation that runs out of time leaves the rest stale with their cached values', () => {
		const cells = [{address: at('A1'), value: 1 as Value, formula: undefined as string | undefined}]
		for (let row = 1; row <= 1000; row++) cells.push({address: at(`B${row}`), value: 1 + row, formula: `A1+${row}`})
		const calculator = new Calculator(['S'], cells, {timeLimit: 0})
		calculator.set(at('A1'), '2')
		const stale = Array.from({length: 1000}, (_, i) => calculator.isStale(at(`B${i + 1}`)))
		expect(stale.filter(Boolean).length).toBeGreaterThan(900)
		const calculated = stale.indexOf(false) + 1
		const kept = stale.indexOf(true) + 1
		expect(calculator.value(at(`B${calculated}`))).toBe(2 + calculated)
		expect(calculator.value(at(`B${kept}`))).toBe(1 + kept)
	})

	test('criteria and text functions refuse areas too big to walk', () => {
		const {calculator, sheets} = workbook({A1: 'x', XFD1048576: 1})
		calculator.set(at('Sheet2!B2', sheets), '=COUNTIF(Sheet1!A1:XFD1048576,"x")')
		calculator.set(at('Sheet2!B3', sheets), '=TEXTJOIN(",",TRUE,Sheet1!A1:XFD1048576)')
		calculator.set(at('Sheet2!B4', sheets), '=COUNTIF(Sheet1!A:A,"x")')
		expect([calculator.isStale(at('Sheet2!B2', sheets)), calculator.isStale(at('Sheet2!B3', sheets))]).toEqual([
			true,
			true,
		])
		expect(calculator.value(at('Sheet2!B4', sheets))).toBe(1)
	})

	test('random formulas parse or fail as syntax errors, and never throw while calculating', () => {
		// A seeded generator, so a failure reproduces
		let seed = 42
		const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
		const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]
		const pieces = [
			...['A1', 'B2:C3', 'A:A', '1:1', "'Sheet2'!A1", 'Sheet2!B1:B3', '$A$1', 'XFD1048576', 'Name', '#REF!', '#N/A'],
			...['1', '0', '-1', '1E+308', '0.5', '"x"', '""', 'TRUE', '{1,2;3,4}', '{"a"}'],
			...['+', '-', '*', '/', '^', '&', '=', '<>', '<', '>=', '%', ':', ' ', ',', '(', ')', '(', ')'],
			...['SUM(', 'IF(', 'VLOOKUP(', 'INDEX(', 'MATCH(', 'XLOOKUP(', 'CHOOSE(', 'IFERROR(', 'TEXT(', 'DATE('],
			...['COUNTIF(', 'SUMIFS(', 'LARGE(', 'MID(', 'SUBSTITUTE(', 'ROW(', 'OFFSET(', 'NETWORKDAYS(', 'TEXTJOIN('],
		]
		const {calculator} = workbook({A1: 1, B2: 'b', C3: 3, 'Sheet2!A1': 2, 'Sheet2!B2': 'x'})
		let parsed = 0
		for (let i = 0; i < 3000; i++) {
			const formula = Array.from({length: 1 + Math.floor(random() * 12)}, () => pick(pieces)).join('')
			try {
				calculator.set(at('E5'), `=${formula}`)
				parsed++
			} catch (error) {
				if (!(error instanceof FormulaSyntaxError)) throw new Error(`${formula}: ${error}`)
			}
		}
		expect(parsed).toBeGreaterThan(100)
	})

	test('a long chain in one formula evaluates', () => {
		const cells: Record<string, Value> = {}
		for (let row = 1; row <= 1500; row++) cells[`A${row}`] = 1
		const {calculator, value} = workbook(cells)
		calculator.set(at('B1'), `=${Array.from({length: 1500}, (_, i) => `A${i + 1}`).join('+')}`)
		expect(value('B1')).toBe(1500)
	})

	test('bad and duplicate cells from a file are ignored', () => {
		const calculator = new Calculator(
			['S'],
			[
				{address: {sheet: 1, row: 0, col: 0}, value: 1},
				{address: {sheet: 0, row: -1, col: 0}, value: 1},
				{address: {sheet: 0, row: 0, col: 99999}, value: 1},
				{address: {sheet: 0, row: Number.NaN, col: 0}, value: 1},
				{address: at('A1'), value: 1, formula: 'B1'},
				{address: at('A1'), value: 2},
				{address: at('C1'), value: 3, formula: ''},
			],
		)
		expect(calculator.value(at('A1'))).toBe(2)
		expect(calculator.formula(at('A1'))).toBeUndefined()
		expect(calculator.set(at('B1'), '5')).toEqual([{address: at('B1'), value: 5}])
		expect(calculator.isStale(at('C1'))).toBe(true)
	})
})

describe('performance', () => {
	// Ten formulas of a typical mix per row of data. Every run counts what edits change; the corpus run
	// (FILES_FIXTURES) also times 100,000 of them, which every npm test shouldn't wait for or depend on.
	const timed = !!process.env.FILES_FIXTURES
	const rows = timed ? 10_000 : 1_000
	function* cells() {
		for (let r = 1; r <= rows; r++) {
			yield {address: at(`A${r}`), value: r}
			const formulas = [
				`A${r}*2`,
				`B${r}+A${r}`,
				`IF(C${r}>10,C${r},0)`,
				`SUM(A${r}:D${r})`,
				`ROUND(E${r}/3,2)`,
				`B${r}+C${r}+D${r}`,
				`MAX(B${r}:G${r})`,
				`F${r}*G${r}`,
				`H${r}-I${r}`,
				`$M$1+J${r}`,
			]
			for (let k = 0; k < formulas.length; k++) {
				yield {address: {sheet: 0, row: r - 1, col: k + 1}, value: 0, formula: formulas[k]}
			}
		}
		yield {address: at('M1'), value: 1}
		// A chain of dependents as long as the data, hanging off one cell
		yield {address: at('N1'), value: 0, formula: 'M2+1'}
		for (let r = 2; r <= rows; r++) yield {address: at(`N${r}`), value: 0, formula: `N${r - 1}+1`}
		yield {address: at('M2'), value: 0}
	}

	test('formulas load, and edits recalculate their dependents', () => {
		let started = performance.now()
		const calculator = new Calculator(['Sheet1'], cells())
		const load = performance.now() - started

		started = performance.now()
		calculator.recalculate()
		const full = performance.now() - started
		// The last row's formulas work out to 2r, 3r, 3r, 9r, 3r, 8r, 9r, 24r², 9r - 24r² and 1 + 9r - 24r²
		expect(calculator.value(at(`K${rows}`))).toBe(1 + 9 * rows - 24 * rows ** 2)

		// M1 feeds column K: a direct dependent in every row. The first edit also pays for compiling the
		// evaluator's hot paths, so it's timed apart from a warm one.
		const edit = (ref: string, input: string) => {
			const started = performance.now()
			const changes = calculator.set(at(ref), input)
			return {changes, time: performance.now() - started}
		}
		const fanOut = edit('M1', '2')
		expect(fanOut.changes).toHaveLength(rows + 1)
		const fanOutWarm = edit('M1', '3')
		// M2 heads the chain
		const chain = edit('M2', '5')
		expect(chain.changes).toHaveLength(rows + 1)
		expect(calculator.value(at(`N${rows}`))).toBe(rows + 5)
		const chainWarm = edit('M2', '6')
		// One input row: the cell and its ten formulas
		const row = edit(`A${rows / 2}`, '7')
		expect(row.changes).toHaveLength(11)
		if (!timed) return

		console.log(
			`formula perf: load 100k formulas ${load.toFixed(0)} ms, full recalculation ${full.toFixed(0)} ms, ` +
				`10k fan-out edit ${fanOut.time.toFixed(1)} ms cold / ${fanOutWarm.time.toFixed(1)} ms warm, ` +
				`10k chain edit ${chain.time.toFixed(1)} ms cold / ${chainWarm.time.toFixed(1)} ms warm, ` +
				`one-row edit ${row.time.toFixed(2)} ms`,
		)
		// About ten times what a dev laptop takes (a 400 ms load, edits under 35 ms), so a loaded machine running
		// the suite in parallel passes, while a slip to quadratic work, which costs seconds here, still fails
		expect(load).toBeLessThan(4000)
		for (const {time} of [fanOut, fanOutWarm, chain, chainWarm]) expect(time).toBeLessThan(350)
	})
})

describe('over a base', () => {
	// Values as the file's sheets hold them; the calculator holds only its formulas and what edits change
	const over = (cells: Record<string, Value>, formulas: Record<string, string>) =>
		new Calculator(
			['Sheet1', 'Sheet2'],
			Object.entries(formulas).map(([ref, formula]) => ({address: at(ref), value: null, formula})),
			{
				base: baseOf(
					2,
					Object.entries(cells).map(([ref, value]) => ({address: at(ref), value})),
				),
			},
		)

	test('reads the values it doesn’t hold through it, and holds what edits change', () => {
		const calculator = over({A1: 1, A2: 2}, {B1: 'SUM(A1:A2)'})
		calculator.recalculate()
		expect(calculator.value(at('B1'))).toBe(3)
		expect(refs(calculator.set(at('A1'), '5'))).toEqual([
			['A1', 5],
			['B1', 7],
		])
		// Emptied, a cell's value in the base isn't read through it
		expect(refs(calculator.set(at('A2'), ''))).toEqual([
			['A2', null],
			['B1', 5],
		])
		expect(calculator.value(at('A2'))).toBeNull()
		expect(refs(calculator.restore([{address: at('A2'), value: 2}]))).toEqual([
			['A2', 2],
			['B1', 7],
		])
		// Typed again as the base has it, nothing changed
		expect(calculator.set(at('A2'), '2')).toEqual([])
	})

	test('a range sees its cells and the base’s in order, so the first error is the first in it', () => {
		const calculator = over({A1: 1, A2: Errors.na, C1: Errors.na}, {})
		const sum = (range: string) => {
			calculator.set(at('Z1'), `=SUM(${range})`)
			return calculator.value(at('Z1'))
		}
		expect(sum('A1:A3')).toEqual(NA)
		calculator.set(at('A1'), '#REF!')
		expect(sum('A1:A3')).toEqual({error: '#REF!'})
		// Left of the base's C1 in a row, after it, and over it
		calculator.set(at('B1'), '#NULL!')
		expect(sum('B1:C1')).toEqual({error: '#NULL!'})
		calculator.set(at('D1'), '#DIV/0!')
		expect(sum('C1:D1')).toEqual(NA)
		calculator.set(at('C1'), '')
		expect(sum('C1:D1')).toEqual({error: '#DIV/0!'})
	})

	test('whole columns stop where its values do, and walk only the rows that hold some', () => {
		const calculator = over({A1: 1, A5: 5, A1048576: 7}, {B1: 'SUM(A:A)', B2: 'COUNTBLANK(A1:A5)'})
		calculator.recalculate()
		expect([calculator.value(at('B1')), calculator.value(at('B2'))]).toEqual([13, 3])
		calculator.set(at('A3'), '3')
		expect([calculator.value(at('B1')), calculator.value(at('B2'))]).toEqual([16, 2])
	})
})
