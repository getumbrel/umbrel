import {describe, expect, test} from 'vitest'

import {
	columnName,
	FormulaSyntaxError,
	MAX_COLS,
	MAX_FORMULA_LENGTH,
	MAX_ROWS,
	parseFormula,
	tokenize,
	type Ast,
} from './parser'

const ref = (top: number, left: number, bottom = top, right = left, sheet?: string): Ast =>
	sheet === undefined
		? {type: 'ref', area: {top, left, bottom, right}}
		: {type: 'ref', sheet, area: {top, left, bottom, right}}
const num = (value: number): Ast => ({type: 'number', value})

describe('parseFormula', () => {
	test('literals', () => {
		expect(parseFormula('1.5E+3')).toEqual(num(1500))
		expect(parseFormula('.5')).toEqual(num(0.5))
		expect(parseFormula('5.')).toEqual(num(5))
		expect(parseFormula('1e-2')).toEqual(num(0.01))
		// Excel keeps 15 significant digits of a typed number
		expect(parseFormula('12345678901234567890')).toEqual(num(12345678901234500000))
		expect(parseFormula('0.12345678901234567')).toEqual(num(0.123456789012345))
		expect(parseFormula('"say ""hi"""')).toEqual({type: 'string', value: 'say "hi"'})
		expect(parseFormula('""')).toEqual({type: 'string', value: ''})
		expect(parseFormula('true')).toEqual({type: 'boolean', value: true})
		expect(parseFormula('FALSE')).toEqual({type: 'boolean', value: false})
		expect(parseFormula('#n/a')).toEqual({type: 'error', value: '#N/A'})
		expect(parseFormula('#DIV/0!')).toEqual({type: 'error', value: '#DIV/0!'})
	})

	test('references', () => {
		expect(parseFormula('A1')).toEqual(ref(0, 0))
		expect(parseFormula('$B$2')).toEqual(ref(1, 1))
		expect(parseFormula('b$2')).toEqual(ref(1, 1))
		expect(parseFormula('A1:C3')).toEqual(ref(0, 0, 2, 2))
		// Reversed corners describe the same area
		expect(parseFormula('C3:A1')).toEqual(ref(0, 0, 2, 2))
		expect(parseFormula('A:C')).toEqual(ref(0, 0, MAX_ROWS - 1, 2))
		expect(parseFormula('$B:$B')).toEqual(ref(0, 1, MAX_ROWS - 1, 1))
		expect(parseFormula('2:3')).toEqual(ref(1, 0, 2, MAX_COLS - 1))
		expect(parseFormula('XFD1048576')).toEqual(ref(MAX_ROWS - 1, MAX_COLS - 1))
		expect(parseFormula('Sheet2!A1')).toEqual(ref(0, 0, 0, 0, 'Sheet2'))
		expect(parseFormula("'Q1 Sales'!B2:B9")).toEqual(ref(1, 1, 8, 1, 'Q1 Sales'))
		expect(parseFormula("'Bob''s'!A1")).toEqual(ref(0, 0, 0, 0, "Bob's"))
		expect(parseFormula('日本語シート!A1')).toEqual(ref(0, 0, 0, 0, '日本語シート'))
		expect(parseFormula("'ورقة عربية'!D2")).toEqual(ref(1, 3, 1, 3, 'ورقة عربية'))
		expect(parseFormula('2024!A1')).toEqual(ref(0, 0, 0, 0, '2024'))
	})

	test('words that only look like references are names', () => {
		expect(parseFormula('XFE1')).toEqual({type: 'name', name: 'XFE1'})
		expect(parseFormula('A1048577')).toEqual({type: 'name', name: 'A1048577'})
		expect(parseFormula('A0')).toEqual({type: 'name', name: 'A0'})
		expect(parseFormula('Tax_Rate')).toEqual({type: 'name', name: 'Tax_Rate'})
		expect(parseFormula('A1B2')).toEqual({type: 'name', name: 'A1B2'})
		// LOG10 is a cell unless it's called
		expect(parseFormula('LOG10')).toEqual(ref(9, 8508))
		expect(parseFormula('LOG10(1)')).toEqual({type: 'call', name: 'LOG10', args: [num(1)]})
	})

	test('function names are upper-cased without the prefixes files use', () => {
		expect(parseFormula('sum(1)')).toEqual({type: 'call', name: 'SUM', args: [num(1)]})
		expect(parseFormula('_xlfn.STDEV.S(1)')).toEqual({type: 'call', name: 'STDEV.S', args: [num(1)]})
		expect(parseFormula('_xlfn._xlws.SORT(A1)')).toEqual({type: 'call', name: 'SORT', args: [ref(0, 0)]})
	})

	test('precedence follows Excel', () => {
		// Negation binds tighter than ^
		expect(parseFormula('-2^2')).toEqual({
			type: 'binary',
			operator: '^',
			left: {type: 'unary', operator: '-', operand: num(2)},
			right: num(2),
		})
		expect(parseFormula('1+2*3')).toEqual({
			type: 'binary',
			operator: '+',
			left: num(1),
			right: {type: 'binary', operator: '*', left: num(2), right: num(3)},
		})
		// Left-associative, ^ included
		expect(parseFormula('2^3^2')).toEqual({
			type: 'binary',
			operator: '^',
			left: {type: 'binary', operator: '^', left: num(2), right: num(3)},
			right: num(2),
		})
		expect(parseFormula('-5%')).toEqual({
			type: 'unary',
			operator: '-',
			operand: {type: 'unary', operator: '%', operand: num(5)},
		})
		expect(parseFormula('"a"&1+2')).toEqual({
			type: 'binary',
			operator: '&',
			left: {type: 'string', value: 'a'},
			right: {type: 'binary', operator: '+', left: num(1), right: num(2)},
		})
		expect(parseFormula('1<>2')).toEqual({type: 'binary', operator: '<>', left: num(1), right: num(2)})
		expect(parseFormula('1 >= 2')).toEqual({type: 'binary', operator: '>=', left: num(1), right: num(2)})
	})

	test('a space between references intersects them; elsewhere it is ignored', () => {
		expect(parseFormula('A1:B2 B1:C3')).toEqual({
			type: 'binary',
			operator: ' ',
			left: ref(0, 0, 1, 1),
			right: ref(0, 1, 2, 2),
		})
		expect(parseFormula(' SUM( A1 , B1 ) ')).toEqual({type: 'call', name: 'SUM', args: [ref(0, 0), ref(0, 1)]})
		expect(parseFormula('A1 +\n1')).toEqual({type: 'binary', operator: '+', left: ref(0, 0), right: num(1)})
	})

	test('unions, ranges between expressions and empty arguments', () => {
		expect(parseFormula('SUM((A1,B2),C3)')).toEqual({
			type: 'call',
			name: 'SUM',
			args: [{type: 'union', areas: [ref(0, 0), ref(1, 1)]}, ref(2, 2)],
		})
		expect(parseFormula('A1:INDEX(B1:B9,3)')).toMatchObject({type: 'binary', operator: ':'})
		expect(parseFormula('NOW()')).toEqual({type: 'call', name: 'NOW', args: []})
		expect(parseFormula('IF(A1,,)')).toEqual({
			type: 'call',
			name: 'IF',
			args: [ref(0, 0), {type: 'missing'}, {type: 'missing'}],
		})
		expect(parseFormula('ROUND(1.5,)')).toEqual({type: 'call', name: 'ROUND', args: [num(1.5), {type: 'missing'}]})
	})

	test('array constants', () => {
		expect(parseFormula('{1,-2;"a",TRUE}')).toEqual({
			type: 'array',
			rows: [
				[1, -2],
				['a', true],
			],
		})
		expect(parseFormula('{#N/A}')).toEqual({type: 'array', rows: [[{error: '#N/A'}]]})
		expect(() => parseFormula('{1,2;3}')).toThrow(FormulaSyntaxError)
		expect(() => parseFormula('{A1}')).toThrow(FormulaSyntaxError)
		expect(() => parseFormula('{}')).toThrow(FormulaSyntaxError)
		expect(() => parseFormula('{1+1}')).toThrow(FormulaSyntaxError)
	})

	test('what we parse but cannot calculate', () => {
		const reason = (text: string) => {
			const ast = parseFormula(text)
			return ast.type === 'unsupported' ? ast.reason : ast
		}
		expect(reason('Table1[Amount]')).toBe('structured')
		expect(reason('Table1[[#This Row],[Amount]]')).toBe('structured')
		expect(reason('[@Amount]')).toBe('structured')
		expect(reason('[1]Sheet1!A1')).toBe('external')
		expect(reason("'C:\\Data\\[Book.xlsx]Sheet1'!A1")).toBe('external')
		expect(reason('Sheet1:Sheet3!A1')).toBe('3d')
		expect(reason("'Jan:Mar'!B2")).toBe('3d')
		expect(reason('A1#')).toBe('spill')
		expect(reason('@A1:A10')).toBe('implicit')
		expect(reason('Sheet1!TaxRate')).toBe('scoped-name')
		expect(reason('#GETTING_DATA')).toBe('error')
		expect(parseFormula('SUM(Table1[Amount])')).toEqual({
			type: 'call',
			name: 'SUM',
			args: [{type: 'unsupported', reason: 'structured'}],
		})
	})

	test.each([
		['', 'empty'],
		['   ', 'empty'],
		['1+', 'ends'],
		['(1', 'Expected ")"'],
		['1)', 'Unexpected'],
		['"abc', 'quote'],
		["'Sheet1", 'quote'],
		["'Sheet1'A1", '"!"'],
		['SUM(1', 'Expected ")"'],
		['1 2', 'Unexpected'],
		['#FOO!', 'Unknown error'],
		['A1!', 'Expected a reference'],
		['$', 'Invalid reference'],
		['1+*2', 'Unexpected'],
		['=1', 'Unexpected'],
		['1e999', 'too large'],
		['SUM(1,2]', 'Unexpected'],
		['Table1[Amount', 'bracket'],
	])('%j is a syntax error', (text, message) => {
		expect(() => parseFormula(text)).toThrow(FormulaSyntaxError)
		expect(() => parseFormula(text)).toThrow(new RegExp(message.replace(/[()[\]]/g, '\\$&')))
	})

	test('hostile sizes fail fast instead of overflowing the stack', () => {
		expect(() => parseFormula('1'.repeat(MAX_FORMULA_LENGTH + 1))).toThrow('too long')
		expect(() => parseFormula(`${'('.repeat(300)}1${')'.repeat(300)}`)).toThrow('nested too deeply')
		expect(() => parseFormula(`${'-'.repeat(300)}1`)).toThrow('nested too deeply')
		expect(() => parseFormula(`${'ABS('.repeat(300)}1${')'.repeat(300)}`)).toThrow('nested too deeply')
		expect(() => parseFormula(`SUM(${'1,'.repeat(300)}1)`)).toThrow('Too many arguments')
		// A long chain is flat work for the parser, and left-deep
		const chain = parseFormula(Array(4000).fill('1').join('+'))
		let depth = 0
		for (let node = chain; node.type === 'binary'; node = node.left) depth++
		expect(depth).toBe(3999)
	})
})

describe('tokenize', () => {
	test('reference tokens keep where they are and how they were written', () => {
		const tokens = tokenize("SUM( a1 , 'My Sheet'!$B$2:C3 )")
		const refs = tokens.filter((token) => token.kind === 'ref')
		expect(refs).toMatchObject([
			{form: 'cell', start: 5, end: 7, refStart: 5, area: {top: 0, left: 0}},
			{
				form: 'range',
				sheet: 'My Sheet',
				start: 10,
				refStart: 21,
				end: 28,
				fixed: {top: true, left: true, bottom: false, right: false},
			},
		])
	})

	test('a reversed range keeps its corners in writing order', () => {
		const [token] = tokenize('A10:A$5')
		expect(token).toMatchObject({kind: 'ref', area: {top: 9, bottom: 4}, fixed: {top: false, bottom: true}})
	})
})

test('columnName', () => {
	expect(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA', 'XFD']).toEqual([0, 25, 26, 51, 52, 701, 702, 16383].map(columnName))
})
