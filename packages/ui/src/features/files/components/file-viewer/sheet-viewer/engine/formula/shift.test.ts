import {expect, test} from 'vitest'

import {FormulaSyntaxError} from './parser'
import {shiftFormula} from './shift'

test.each([
	['A1', 1, 1, 'B2'],
	['$A$1', 5, 5, '$A$1'],
	['$A1', 2, 3, '$A3'],
	['A$1', 2, 3, 'D$1'],
	['SUM(A1:B2)', 1, 0, 'SUM(A2:B3)'],
	['SUM(A:A)', 5, 1, 'SUM(B:B)'],
	['SUM($A:A)', 0, 2, 'SUM($A:C)'],
	['SUM(1:1)', 2, 3, 'SUM(3:3)'],
	['SUM($1:1)', 2, 0, 'SUM($1:3)'],
	["Sheet2!A1+'My Sheet'!B2", 1, 0, "Sheet2!A2+'My Sheet'!B3"],
	["'ورقة عربية'!D2*2", 3, 0, "'ورقة عربية'!D5*2"],
	// Only reference text changes: strings, names, function names and spacing stay
	['"A1"&A1', 1, 0, '"A1"&A2'],
	['Rates * A1', 1, 0, 'Rates * A2'],
	['LOG10(A1)+LOG10', 1, 1, 'LOG10(B2)+LOH11'],
	['IF( a1 > 0 ,\n"x" , B1 )', 1, 1, 'IF( B2 > 0 ,\n"x" , C2 )'],
	// The running total: the fixed corner stays put
	['SUM(A$1:A1)', 1, 0, 'SUM(A$1:A2)'],
	// A reversed range keeps each corner's own $
	['SUM(A10:A$5)', 1, 0, 'SUM(A11:A$5)'],
	// Pushed off the sheet
	['A1', -1, 0, '#REF!'],
	['Sheet1!A1+1', -1, 0, 'Sheet1!#REF!+1'],
	['SUM(A1:A3)', -1, 0, 'SUM(#REF!)'],
	['XFD1', 0, 1, '#REF!'],
	['A1048576', 1, 0, '#REF!'],
	['A:A', 0, -1, '#REF!'],
	// External and 3D references move like any other; tables don't
	['[1]Sheet1!A1', 1, 0, '[1]Sheet1!A2'],
	['SUM(Sheet1:Sheet3!B2)', 0, 1, 'SUM(Sheet1:Sheet3!C2)'],
	['Table1[Col]+A1', 1, 0, 'Table1[Col]+A2'],
	['A1', 0, 0, 'A1'],
	['a1', 0, 0, 'a1'],
	['$A$1+B$2', 0, 0, '$A$1+B$2'],
])('%j moved %i rows and %i columns is %j', (text, rows, cols, expected) => {
	expect(shiftFormula(text, {rows, cols})).toBe(expected)
})

test('unchanged references keep their exact text', () => {
	const text = "SUM($a$1:$B$2, 'x'!$C$3)"
	expect(shiftFormula(text, {rows: 7, cols: 7})).toBe(text)
})

test('text that does not tokenize throws', () => {
	expect(() => shiftFormula('"open', {rows: 1, cols: 0})).toThrow(FormulaSyntaxError)
})
