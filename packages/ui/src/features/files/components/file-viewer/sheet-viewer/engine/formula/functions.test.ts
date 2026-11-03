// Expected values are Excel's: most rows are the worked examples from each
// function's page on support.microsoft.com (cited as "docs"), the rest pin the
// documented rules for coercion, errors and edge cases.

import {describe, expect, test} from 'vitest'

import {calc, type CellMap} from './test-helpers'
import type {FormulaError, Value} from './values'

type Case = [formula: string, expected: Value | {stale: true}, cells?: CellMap]

const NA: FormulaError = {error: '#N/A'}
const VALUE: FormulaError = {error: '#VALUE!'}
const NUM: FormulaError = {error: '#NUM!'}
const DIV0: FormulaError = {error: '#DIV/0!'}
const REF: FormulaError = {error: '#REF!'}
const NULL: FormulaError = {error: '#NULL!'}
const NAME: FormulaError = {error: '#NAME?'}
const STALE = {stale: true} as const

function table(name: string, cases: Case[], shared: CellMap = {}) {
	describe(name, () => {
		test.each(cases)('=%s', (formula, expected, cells) => {
			const actual = calc(formula, {...shared, ...cells})
			if (typeof expected === 'number' && !Number.isInteger(expected) && typeof actual === 'number') {
				// Docs examples print about 10 significant digits
				expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(Math.abs(expected) * 1e-9, 5e-10))
			} else expect(actual).toEqual(expected)
		})
	})
}

table('operators and precedence', [
	['1+2*3', 7],
	['(1+2)*3', 9],
	// Negation binds tighter than ^ in Excel
	['-2^2', 4],
	['2^-2', 0.25],
	['-2^-2', 0.25],
	['2-2^2', -2],
	['2*-3^2', 18],
	// ^ is left-associative
	['2^3^2', 64],
	['10%', 0.1],
	['-50%', -0.5],
	['2^50%', Math.SQRT2],
	['200%%', 0.02],
	['"a"&1+2', 'a3'],
	['1&2', '12'],
	['1=1&""', false],
	['1<2<3', false],
	['--"5"', 5],
	['+"a"', 'a'],
	['1/0', DIV0],
	['0^0', NUM],
	['0^-1', DIV0],
	['(-8)^(1/3)', NUM],
	['10^400', NUM],
	['1E+308*10', NUM],
	['#N/A+1', NA],
	['1+#DIV/0!', DIV0],
	['#N/A+#DIV/0!', NA],
	['"a"+#N/A', NA],
])

table('coercion', [
	['TRUE+1', 2],
	['"3"+1', 4],
	['" 3 "*2', 6],
	['"1,000"+1', 1001],
	['"50%"*2', 1],
	['"$1,000"/2', 500],
	['"1e3"+0', 1000],
	['"abc"+1', VALUE],
	['""+1', VALUE],
	['"TRUE"+1', VALUE],
	['"2026-10-13"-DATE(2026,10,12)', 1],
	['"12:00"*2', 1],
	['"1/2/2026"+0', VALUE],
	['A1+1', 1],
	['A1&"x"', 'x'],
	['A1=0', true],
	['A1=""', true],
	['A1=FALSE', true],
	// Typed numbers keep 15 significant digits
	['1234567890123456789', 1234567890123450000],
	['"1234567890123456789"+0', 1234567890123450000],
	['1/3&""', '0.333333333333333'],
	['0.1+0.2&""', '0.3'],
	['1E-5&""', '1E-05'],
	['0.0001&""', '0.0001'],
	['123456789012345&""', '123456789012345'],
	['1E+15&""', '1E+15'],
	['-2.5&""', '-2.5'],
	['TRUE&""', 'TRUE'],
])

table('comparison', [
	['"a"="A"', true],
	['"a"<"B"', true],
	['"é"="e"', false],
	['1<"a"', true],
	['"z"<TRUE', true],
	['FALSE<TRUE', true],
	['0.1+0.2=0.3', true],
	['1=1.0000000000000002', true],
	['2>=2', true],
	['"abc"<>"ABC"', false],
])

// Excel snaps a result of + or - within rounding noise of zero, but only as the last step
test('final-step rounding noise', () => {
	expect(calc('0.5-0.4-0.1')).toBe(0)
	expect(calc('0.1+0.2-0.3')).toBe(0)
	expect(calc('1*(0.5-0.4-0.1)')).toBe(0.5 - 0.4 - 0.1)
	expect(calc('SUM(0.1,0.2,-0.3)')).toBe(0.1 + 0.2 - 0.3)
	expect(calc('A1-A2', {A1: 0.3, A2: 0.1 + 0.2})).toBe(0)
})

table('references', [
	['SUM(A1:B2 B1:C3)', 5, {A1: 1, B1: 2, A2: 4, B2: 3, C3: 100}],
	['SUM(A1:A2 B3:B4)', NULL],
	['SUM((A1,C1))', 4, {A1: 1, B1: 2, C1: 3}],
	['SUM((A1:A2,C1:C2),10)', 20, {A1: 1, A2: 2, C1: 3, C2: 4}],
	['(A1,C1)', VALUE, {A1: 1, C1: 3}],
	// docs (CHOOSE): a range ending in a function
	['SUM(A2:CHOOSE(2,A3,A4,A5))', 80, {A2: 23, A3: 45, A4: 12, A5: 10}],
	// docs (INDEX)
	['SUM(B2:INDEX(A2:C6,5,2))', 15, {B2: 1, B3: 2, B4: 3, B5: 4, B6: 5, B7: 100}],
	['A1:A1', 7, {A1: 7}],
	['A1', 0],
	['Sheet2!A1*2', 10, {'Sheet2!A1': 5}],
	['SUM(Sheet2!A1:A3)', 6, {'Sheet2!A1': 1, 'Sheet2!A2': 2, 'Sheet2!A3': 3}],
	['Nope!A1', REF],
	['Sheet1!#REF!', REF],
	['SUM(A:A)', 6, {A1: 1, A2: 2, A3: 3}],
	['SUM(1:1)', 3, {A1: 1, B1: 2}],
	['SUM(A2:A1048576)', 5, {A1: 1, A2: 2, A3: 3}],
	['UNDEFINED_NAME', NAME],
])

table('array evaluation', [
	['SUM(A1:A3*B1:B3)', 32, {A1: 1, A2: 2, A3: 3, B1: 4, B2: 5, B3: 6}],
	['SUM(IF(A1:A4>1,1,0))', 3, {A1: 1, A2: 2, A3: 3, A4: 4}],
	['SUM(LEN(A1:A3))', 6, {A1: 'a', A2: 'bb', A3: 'ccc'}],
	['SUM({1,2,3}*{1;2})', 18],
	['SUM({1,2,3}*{1,2})', NA],
	['SUM(-A1:A2)', -3, {A1: 1, A2: 2}],
	['SUM(A1:A2%)', 0.03, {A1: 1, A2: 2}],
	['SUM(ROW(A1:A3))', 6],
	['SUM(LARGE(A1:A5,{1,2}))', 9, {A1: 1, A2: 5, A3: 3, A4: 4, A5: 2}],
	['SUM(COUNTIF(A1:A5,{"a","b"}))', 3, {A1: 'a', A2: 'b', A3: 'c', A4: 'a', A5: 'd'}],
	['MAX(ABS(A1:A3))', 9, {A1: -9, A2: 2, A3: 3}],
	['SUM(INDEX(A1:B2,{1,2},2))', 6, {A1: 1, B1: 2, A2: 3, B2: 4}],
	['{5}', 5],
	// A result of several cells would spill in Excel 365; we keep the cached value
	['A1:A3', STALE],
	['{1,2,3}', STALE],
	['A1:A2*2', STALE],
])

table('SUM, PRODUCT, SUMPRODUCT', [
	['SUM(1,2,3)', 6],
	// Typed values are coerced, the same values in cells are skipped
	['SUM("3",TRUE,1)', 5],
	['SUM(A1:A3)', 1, {A1: '3', A2: true, A3: 1}],
	['SUM({1,"2",TRUE})', 1],
	['SUM("abc")', VALUE],
	['SUM(A1:A2)', NA, {A1: 1, A2: NA}],
	['SUM(,)', 0],
	// docs (PRODUCT)
	['PRODUCT(A2:A4)', 2250, {A2: 5, A3: 15, A4: 30}],
	['PRODUCT(A2:A4,2)', 4500, {A2: 5, A3: 15, A4: 30}],
	['PRODUCT(A1:A3)', 0],
	['SUMPRODUCT(A1:A3,B1:B3)', 32, {A1: 1, A2: 2, A3: 3, B1: 4, B2: 5, B3: 6}],
	['SUMPRODUCT(A1:A3)', 6, {A1: 1, A2: 2, A3: 3}],
	// Entries that aren't numbers count as 0, TRUE included
	['SUMPRODUCT(A1:A3,B1:B3)', 4, {A1: 1, A2: 'x', A3: true, B1: 4, B2: 5, B3: 6}],
	['SUMPRODUCT(A1:A3>1)', 0, {A1: 1, A2: 2, A3: 3}],
	['SUMPRODUCT(--(A1:A3>1))', 2, {A1: 1, A2: 2, A3: 3}],
	['SUMPRODUCT(A1:A3,B1:B2)', VALUE],
	['SUMPRODUCT(A1:A2,B1:B2)', DIV0, {A1: 1, A2: 2, B1: DIV0, B2: 1}],
])

table('rounding', [
	// docs (ROUND)
	['ROUND(2.15,1)', 2.2],
	['ROUND(2.149,1)', 2.1],
	['ROUND(-1.475,2)', -1.48],
	['ROUND(21.5,-1)', 20],
	['ROUND(626.3,-3)', 1000],
	['ROUND(1.98,-1)', 0],
	['ROUND(-50.55,-2)', -100],
	['ROUND(2.675,2)', 2.68],
	['ROUND(1.5,)', 2],
	['ROUND(0.5,0)', 1],
	['ROUND(-0.5,0)', -1],
	['ROUND(1234.5678,1.9)', 1234.6],
	['ROUND(1E+300,2)', 1e300],
	// docs (ROUNDUP)
	['ROUNDUP(3.2,0)', 4],
	['ROUNDUP(76.9,0)', 77],
	['ROUNDUP(3.14159,3)', 3.142],
	['ROUNDUP(-3.14159,1)', -3.2],
	['ROUNDUP(31415.92654,-2)', 31500],
	['ROUNDUP(0.1+0.2,1)', 0.3],
	// docs (ROUNDDOWN)
	['ROUNDDOWN(3.2,0)', 3],
	['ROUNDDOWN(76.9,0)', 76],
	['ROUNDDOWN(3.14159,3)', 3.141],
	['ROUNDDOWN(-3.14159,1)', -3.1],
	['ROUNDDOWN(31415.92654,-2)', 31400],
	// docs (INT, TRUNC)
	['INT(8.9)', 8],
	['INT(-8.9)', -9],
	['19.5-INT(19.5)', 0.5],
	['TRUNC(8.9)', 8],
	['TRUNC(-8.9)', -8],
	['TRUNC(0.45)', 0],
	['TRUNC(3.14159,2)', 3.14],
	// docs (CEILING)
	['CEILING(2.5,1)', 3],
	['CEILING(-2.5,-2)', -4],
	['CEILING(-2.5,2)', -2],
	['CEILING(1.5,0.1)', 1.5],
	['CEILING(0.234,0.01)', 0.24],
	['CEILING(2.5,-1)', NUM],
	['CEILING(2.5,0)', 0],
	// docs (FLOOR)
	['FLOOR(3.7,2)', 2],
	['FLOOR(-2.5,-2)', -2],
	['FLOOR(2.5,-2)', NUM],
	['FLOOR(1.58,0.1)', 1.5],
	['FLOOR(0.234,0.01)', 0.23],
	['FLOOR(-2.5,2)', -4],
	['FLOOR(2.5,0)', DIV0],
	// docs (CEILING.MATH, FLOOR.MATH)
	['CEILING.MATH(24.3,5)', 25],
	['CEILING.MATH(6.7)', 7],
	['CEILING.MATH(-8.1,2)', -8],
	['CEILING.MATH(-5.5,2,-1)', -6],
	['_xlfn.CEILING.MATH(6.2)', 7],
	['FLOOR.MATH(24.3,5)', 20],
	['FLOOR.MATH(6.7)', 6],
	['FLOOR.MATH(-8.1,2)', -10],
	['FLOOR.MATH(-5.5,2,-1)', -4],
])

table('arithmetic functions', [
	// docs (ABS, SIGN, SQRT, POWER, MOD, PI)
	['ABS(-4)', 4],
	['ABS(2)', 2],
	['SIGN(10)', 1],
	['SIGN(4-4)', 0],
	['SIGN(-0.00003)', -1],
	['SQRT(16)', 4],
	['SQRT(-16)', NUM],
	['SQRT(ABS(-16))', 4],
	['POWER(5,2)', 25],
	['POWER(98.6,3.2)', 2401077.222],
	['POWER(4,5/4)', 5.656854249],
	['POWER(0,0)', NUM],
	['MOD(3,2)', 1],
	['MOD(-3,2)', 1],
	['MOD(3,-2)', -1],
	['MOD(-3,-2)', -1],
	['MOD(5,0)', DIV0],
	['PI()', 3.14159265358979],
	['PI()/2', 1.570796327],
	['PI()*(3^2)', 28.27433388],
	['ABS("x")', VALUE],
])

const breakingStrength = {
	A2: 1345,
	A3: 1301,
	A4: 1368,
	A5: 1322,
	A6: 1310,
	A7: 1370,
	A8: 1318,
	A9: 1350,
	A10: 1303,
	A11: 1299,
}

table('statistics', [
	// docs (AVERAGE)
	['AVERAGE(A2:A6)', 11, {A2: 10, A3: 7, A4: 9, A5: 27, A6: 2}],
	['AVERAGE(A2:A6,5)', 10, {A2: 10, A3: 7, A4: 9, A5: 27, A6: 2}],
	['AVERAGE(A1:A3)', 2, {A1: 1, A2: 'x', A3: 3}],
	['AVERAGE(A1:A3)', DIV0],
	// docs (MIN, MAX)
	['MIN(A2:A6)', 2, {A2: 10, A3: 7, A4: 9, A5: 27, A6: 2}],
	['MAX(A2:A6)', 27, {A2: 10, A3: 7, A4: 9, A5: 27, A6: 2}],
	['MAX(A2:A6,30)', 30, {A2: 10, A3: 7, A4: 9, A5: 27, A6: 2}],
	['MIN(A1:A3)', 0],
	['MAX(A1:A2,"7")', 7, {A1: 1, A2: '9'}],
	// docs (MEDIAN)
	['MEDIAN(A2:A6)', 3, {A2: 1, A3: 2, A4: 3, A5: 4, A6: 5, A7: 6}],
	['MEDIAN(A2:A7)', 3.5, {A2: 1, A3: 2, A4: 3, A5: 4, A6: 5, A7: 6}],
	['MEDIAN(A1:A2)', NUM],
	// docs (STDEV, STDEV.S, STDEV.P, VAR, VAR.S, VAR.P), the breaking-strength sample
	['STDEV.S(A2:A11)', 27.46391572, breakingStrength],
	['STDEV(A2:A11)', 27.46391572, breakingStrength],
	['STDEV.P(A2:A11)', 26.05455814, breakingStrength],
	['VAR.S(A2:A11)', 754.2666667, breakingStrength],
	['VAR(A2:A11)', 754.2666667, breakingStrength],
	['VAR.P(A2:A11)', 678.84, breakingStrength],
	['_xlfn.STDEV.S(1)', DIV0],
	['VAR.P(A1:A2)', DIV0],
	// docs (LARGE, SMALL)
	['LARGE(A2:B6,3)', 5, {A2: 3, B2: 4, A3: 5, B3: 2, A4: 3, B4: 4, A5: 5, B5: 6, A6: 4, B6: 7}],
	['LARGE(A2:B6,7)', 4, {A2: 3, B2: 4, A3: 5, B3: 2, A4: 3, B4: 4, A5: 5, B5: 6, A6: 4, B6: 7}],
	['SMALL(A2:A10,4)', 4, {A2: 3, A3: 4, A4: 5, A5: 2, A6: 3, A7: 4, A8: 6, A9: 4, A10: 7}],
	['SMALL(B2:B10,2)', 3, {B2: 1, B3: 4, B4: 8, B5: 3, B6: 7, B7: 12, B8: 54, B9: 8, B10: 23}],
	['LARGE(A1:A3,0)', NUM, {A1: 1}],
	['LARGE(A1:A3,4)', NUM, {A1: 1, A2: 2, A3: 3}],
	// docs (RANK, RANK.EQ)
	['RANK(A3,A2:A6,1)', 3, {A2: 7, A3: 3.5, A4: 3.5, A5: 1, A6: 2}],
	['RANK(A2,A2:A6,1)', 5, {A2: 7, A3: 3.5, A4: 3.5, A5: 1, A6: 2}],
	['RANK.EQ(A2,A2:A6)', 1, {A2: 7, A3: 3.5, A4: 3.5, A5: 1, A6: 2}],
	['RANK.EQ(3.5,A2:A6)', 2, {A2: 7, A3: 3.5, A4: 3.5, A5: 1, A6: 2}],
	['RANK(99,A2:A6)', NA, {A2: 7, A3: 3.5}],
])

const counted = {A2: 'Sales', A3: 39790, A5: 19, A6: 22.24, A7: true, A8: DIV0}

table('counting', [
	// docs (COUNT): numbers and dates count, text, logicals and errors in cells don't
	['COUNT(A2:A8)', 3, counted],
	['COUNT(A5:A8)', 2, counted],
	['COUNT(A2:A8,2)', 4, counted],
	// Typed logicals and numeric text count
	['COUNT(1,"2",TRUE,"x",NA())', 3],
	['COUNTA(A2:A8)', 6, counted],
	['COUNTA(1,"","x")', 3],
	// docs (COUNTBLANK): empty text counts, zero doesn't
	['COUNTBLANK(A1:A4)', 2, {A1: 5, A3: '', A4: 0}],
	['COUNTBLANK(A1:A3)', 2, {A1: 5, A2: '=""'}],
	['COUNTBLANK(A:A)', 1048575, {A1: 5}],
	['COUNTBLANK(5)', VALUE],
])

const fruit = {A2: 'apples', B2: 32, A3: 'oranges', B3: 54, A4: 'peaches', B4: 75, A5: 'apples', B5: 86}

table('COUNTIF and criteria', [
	// docs (COUNTIF)
	['COUNTIF(A2:A5,"apples")', 2, fruit],
	['COUNTIF(A2:A5,A4)', 1, fruit],
	['COUNTIF(A2:A5,A2)+COUNTIF(A2:A5,A3)', 3, fruit],
	['COUNTIF(B2:B5,">55")', 2, fruit],
	['COUNTIF(B2:B5,"<>"&B4)', 3, fruit],
	['COUNTIF(B2:B5,">=32")-COUNTIF(B2:B5,">85")', 3, fruit],
	['COUNTIF(A2:A5,"*")', 4, fruit],
	['COUNTIF(A2:A5,"?????es")', 2, fruit],
	['COUNTIF(A2:A5,"APPLES")', 2, fruit],
	// "" matches blanks and empty text, "=" only blanks, "<>" anything not blank
	['COUNTIF(A1:A4,"")', 2, {A1: 'x', A3: '', A4: 0}],
	['COUNTIF(A1:A4,"=")', 1, {A1: 'x', A3: '', A4: 0}],
	['COUNTIF(A1:A4,"<>")', 3, {A1: 'x', A3: '', A4: 0}],
	// A number matches numbers and text that reads as one, but only for equality
	['COUNTIF(A1:A3,1)', 2, {A1: 1, A2: '1', A3: true}],
	['COUNTIF(A1:A3,">5")', 1, {A1: 10, A2: '10', A3: 3}],
	['COUNTIF(A1:A3,"<>5")', 2, {A1: 5, A2: 'x'}],
	['COUNTIF(A1:A3,TRUE)', 1, {A1: true, A2: 'TRUE', A3: 1}],
	['COUNTIF(A1:A3,"#N/A")', 1, {A1: NA, A2: '#N/A'}],
	['COUNTIF(A1:A3,"~*")', 1, {A1: '*', A2: 'a*', A3: 'x'}],
	['COUNTIF(A1:A3,"a~?")', 1, {A1: 'a?', A2: 'ab'}],
	['COUNTIF(A1:A3,">b")', 2, {A1: 'a', A2: 'C', A3: 'd'}],
	// An empty criteria cell means 0, per the COUNTIFS docs
	['COUNTIF(A1:A3,C1)', 1, {A1: 0, A2: 'x'}],
	['COUNTIF(A1:A3,">="&DATE(2026,1,1))', 1, {A1: 46023, A2: 46022}],
	['COUNTIF(A:A,"")', 1048575, {A1: 5}],
	['COUNTIF({1,2},1)', VALUE],
	// docs (COUNTIFS)
	['COUNTIFS(B2:D2,"=Yes")', 1, {B2: 'Yes', C2: 'No', D2: 'No'}],
	[
		'COUNTIFS(B2:B5,"=Yes",C2:C5,"=Yes")',
		2,
		{B2: 'Yes', C2: 'No', B3: 'Yes', C3: 'Yes', B4: 'Yes', C4: 'Yes', B5: 'No', C5: 'Yes'},
	],
	['COUNTIFS(B5:D5,"=Yes",B3:D3,"=Yes")', 1, {B3: 'Yes', C3: 'Yes', D3: 'No', B5: 'No', C5: 'Yes', D5: 'Yes'}],
	['COUNTIFS(A1:A3,">0",B1:B2,">0")', VALUE],
])

const commissions = {
	A2: 100000,
	B2: 7000,
	A3: 200000,
	B3: 14000,
	A4: 300000,
	B4: 21000,
	A5: 400000,
	B5: 28000,
	C2: 250000,
}
const produce = {
	A2: 'Vegetables',
	B2: 'Tomatoes',
	C2: 2300,
	A3: 'Vegetables',
	B3: 'Celery',
	C3: 5500,
	A4: 'Fruits',
	B4: 'Oranges',
	C4: 800,
	B5: 'Butter',
	C5: 400,
	A6: 'Vegetables',
	B6: 'Carrots',
	C6: 4200,
	A7: 'Fruits',
	B7: 'Apples',
	C7: 1200,
}
const quotas = {
	A2: 5,
	B2: 'Apples',
	C2: 'Tom',
	A3: 4,
	B3: 'Apples',
	C3: 'Sarah',
	A4: 15,
	B4: 'Artichokes',
	C4: 'Tom',
	A5: 3,
	B5: 'Artichokes',
	C5: 'Sarah',
	A6: 22,
	B6: 'Bananas',
	C6: 'Tom',
	A7: 12,
	B7: 'Bananas',
	C7: 'Sarah',
	A8: 10,
	B8: 'Carrots',
	C8: 'Tom',
	A9: 33,
	B9: 'Carrots',
	C9: 'Sarah',
}
const regions = {
	A2: 'East',
	B2: 45678,
	A3: 'West',
	B3: 23789,
	A4: 'North',
	B4: -4789,
	A5: 'South (New Office)',
	B5: 0,
	A6: 'MidWest',
	B6: 9678,
}

table('conditional aggregates', [
	// docs (SUMIF)
	['SUMIF(A2:A5,">160000",B2:B5)', 63000, commissions],
	['SUMIF(A2:A5,">160000")', 900000, commissions],
	['SUMIF(A2:A5,300000,B2:B5)', 21000, commissions],
	['SUMIF(A2:A5,">"&C2,B2:B5)', 49000, commissions],
	['SUMIF(A2:A7,"Fruits",C2:C7)', 2000, produce],
	['SUMIF(A2:A7,"Vegetables",C2:C7)', 12000, produce],
	['SUMIF(B2:B7,"*es",C2:C7)', 4300, produce],
	['SUMIF(A2:A7,"",C2:C7)', 400, produce],
	// The sum range takes the criteria range's shape from its top-left cell
	['SUMIF(A2:A7,"Fruits",C2)', 2000, produce],
	['SUMIF(A1:A2,"x",B1:B2)', NA, {A1: 'x', B1: NA}],
	// docs (SUMIFS)
	['SUMIFS(A2:A9,B2:B9,"=A*",C2:C9,"Tom")', 20, quotas],
	['SUMIFS(A2:A9,B2:B9,"<>Bananas",C2:C9,"Tom")', 30, quotas],
	['SUMIFS(A2:A9,B2:B8,"Tom")', VALUE, quotas],
	// docs (AVERAGEIF)
	['AVERAGEIF(B2:B5,"<23000")', 14000, commissions],
	['AVERAGEIF(A2:A5,"<250000")', 150000, commissions],
	['AVERAGEIF(A2:A5,"<95000")', DIV0, commissions],
	['AVERAGEIF(A2:A5,">250000",B2:B5)', 24500, commissions],
	['AVERAGEIF(A2:A6,"=*West",B2:B6)', 16733.5, regions],
	['AVERAGEIF(A2:A6,"<>*(New Office)",B2:B6)', 18589, regions],
	['AVERAGEIFS(A2:A9,C2:C9,"Sarah",A2:A9,">4")', 22.5, quotas],
	['AVERAGEIFS(A2:A9,C2:C9,"Nobody")', DIV0, quotas],
	// docs (MINIFS, MAXIFS)
	[
		'MINIFS(A2:A7,B2:B7,1)',
		88,
		{A2: 89, B2: 1, A3: 93, B3: 2, A4: 96, B4: 2, A5: 85, B5: 3, A6: 91, B6: 1, A7: 88, B7: 1},
	],
	[
		'MAXIFS(A2:A7,B2:B7,1)',
		91,
		{A2: 89, B2: 1, A3: 93, B3: 2, A4: 96, B4: 2, A5: 85, B5: 3, A6: 91, B6: 1, A7: 88, B7: 1},
	],
	['MAXIFS(A2:A3,B2:B3,"none")', 0, {A2: 5, B2: 'x'}],
	['_xlfn.MINIFS(A1:A3,B1:B3,">1")', 20, {A1: 10, B1: 1, A2: 30, B2: 2, A3: 20, B3: 3}],
	// Blank cells past the used range still meet a blank criterion
	['SUMIF(A2000:A2003,"",B1:B4)', 10, {B1: 1, B2: 2, B3: 3, B4: 4}],
])

table('logical', [
	['IF(A1>B1,"Over Budget","OK")', 'Over Budget', {A1: 1500, B1: 900}],
	['IF(1>2,"yes")', false],
	['IF(1<2,"yes")', 'yes'],
	['IF(TRUE,,1)', 0],
	['IF("TRUE",1,2)', 1],
	['IF("abc",1,2)', VALUE],
	['IF(NA(),1,2)', NA],
	// Only the branch taken is evaluated
	['IF(TRUE,1,1/0)', 1],
	['IF(A1,"x","y")', 'y'],
	['IF({TRUE,FALSE},1,2)', STALE],
	['SUM(IF({TRUE,FALSE,TRUE},{1,2,3},10))', 14],
	// docs (IFS)
	['IFS(A2>89,"A",A2>79,"B",A2>69,"C",A2>59,"D",TRUE,"F")', 'C', {A2: 73}],
	['IFS(1>2,1)', NA],
	['IFS(1,2,3)', 2],
	// docs (IFERROR, IFNA)
	['IFERROR(A2/B2,"Error in calculation")', 6, {A2: 210, B2: 35}],
	['IFERROR(A3/B3,"Error in calculation")', 'Error in calculation', {A3: 55, B3: 0}],
	['IFERROR(A4/B4,"Error in calculation")', 0, {B4: 23}],
	['IFERROR(NA(),)', 0],
	['IFNA(NA(),"Not found")', 'Not found'],
	['IFNA(1/0,"Not found")', DIV0],
	['SUM(IFERROR(1/{1,0,2},0))', 1.5],
	// docs (AND, OR, XOR, NOT)
	['AND(A2>1,A2<100)', true, {A2: 50}],
	['AND(A3<A2,A3<100)', false, {A2: 50, A3: 100}],
	['OR(A2>1,A2<100)', true, {A2: 50}],
	['XOR(3>0,2<9)', false],
	['XOR(3>12,4>6)', false],
	['XOR(TRUE,FALSE)', true],
	['NOT(A2>100)', true, {A2: 50}],
	// Text in cells is skipped; with nothing logical left it's #VALUE!
	['AND(A1:A3)', true, {A1: true, A2: 'x', A3: 1}],
	['AND(A1:A2)', VALUE, {A1: 'x'}],
	['OR("x")', VALUE],
	['AND(1,NA())', NA],
	['TRUE()', true],
	['FALSE()', false],
	// docs (SWITCH)
	['SWITCH(WEEKDAY(A2),1,"Sunday",2,"Monday",3,"Tuesday","No match")', 'Monday', {A2: 2}],
	['SWITCH(A3,1,"Sunday",2,"Monday",3,"Tuesday")', NA, {A3: 99}],
	['SWITCH(A4,1,"Sunday",7,"Saturday","weekday")', 'weekday', {A4: 99}],
	['SWITCH(A5,1,"Sunday",2,"Monday",3,"Tuesday","No match")', 'Tuesday', {A5: 3}],
	['SWITCH("b","A",1,"B",2)', 2],
	// docs (CHOOSE)
	['CHOOSE(2,A2,A3,A4,A5)', '2nd', {A2: '1st', A3: '2nd', A4: '3rd', A5: 'Finished'}],
	['CHOOSE(4,B2,B3,B4,B5)', 'Bolts', {B2: 'Nails', B3: 'Screws', B4: 'Nuts', B5: 'Bolts'}],
	['CHOOSE(3,"Wide",115,"world",8)', 'world'],
	['CHOOSE(2.9,"a","b","c")', 'b'],
	['CHOOSE(0,"a")', VALUE],
	['CHOOSE(3,"a","b")', VALUE],
])

table('information', [
	['ISBLANK(A1)', true],
	['ISBLANK("")', false],
	['ISBLANK(A1)', false, {A1: '=""'}],
	['ISNUMBER(5)', true],
	['ISNUMBER("5")', false],
	['ISTEXT("a")', true],
	['ISLOGICAL(FALSE)', true],
	['ISERROR(NA())', true],
	['ISERR(NA())', false],
	['ISERR(1/0)', true],
	['ISNA(NA())', true],
	['ISNA(1/0)', false],
	['SUM(--ISNUMBER(A1:A3))', 2, {A1: 1, A2: 'x', A3: 3}],
	// docs (N, T)
	['N(7)', 7],
	['N("Even")', 0],
	['N(TRUE)', 1],
	['N(DATE(2011,4,17))', 40650],
	['N("7")', 0],
	['T("Rainfall")', 'Rainfall'],
	['T(19)', ''],
	['T(TRUE)', ''],
	['NA()', NA],
])

table('text', [
	// docs (LEFT, RIGHT, MID, LEN)
	['LEFT(A2,4)', 'Sale', {A2: 'Sale Price'}],
	['LEFT(A3)', 'S', {A3: 'Sweden'}],
	['RIGHT(A2,5)', 'Price', {A2: 'Sale Price'}],
	['RIGHT(A3)', 'r', {A3: 'Stock Number'}],
	['MID(A2,1,5)', 'Fluid', {A2: 'Fluid Flow'}],
	['MID(A2,7,20)', 'Flow', {A2: 'Fluid Flow'}],
	['MID(A2,20,5)', '', {A2: 'Fluid Flow'}],
	['LEN(A2)', 11, {A2: 'Phoenix, AZ'}],
	['LEN(A3)', 0],
	['LEN(A4)', 11, {A4: '     One   '}],
	['LEFT("abc",-1)', VALUE],
	['LEFT("abc",10)', 'abc'],
	['LEFT("abc",)', ''],
	['RIGHT("abc",0)', ''],
	['MID("abc",0,1)', VALUE],
	['MID("abc",1,-1)', VALUE],
	['LEN(123.5)', 5],
	['LEN(1/3)', 17],
	['LEN(TRUE)', 4],
	['LEN("😀")', 2],
	// docs (UPPER, LOWER, PROPER, TRIM, CLEAN)
	['UPPER("total")', 'TOTAL'],
	['UPPER(1.5)', '1.5'],
	['LOWER("E. E. Cummings")', 'e. e. cummings'],
	['LOWER("Apt. 2B")', 'apt. 2b'],
	['PROPER("this is a TITLE")', 'This Is A Title'],
	['PROPER("2-way street")', '2-Way Street'],
	['PROPER("76BudGet")', '76Budget'],
	['PROPER("élan VITAL")', 'Élan Vital'],
	['TRIM(" First Quarter   Earnings ")', 'First Quarter Earnings'],
	['TRIM(A1)', '\tx', {A1: '\tx  '}],
	['CLEAN(A1)', 'Monthly report', {A1: '\tMonthly report\n'}],
	// docs (SUBSTITUTE, REPLACE)
	['SUBSTITUTE(A2,"Sales","Cost")', 'Cost Data', {A2: 'Sales Data'}],
	['SUBSTITUTE(A3,"1","2",1)', 'Quarter 2, 2008', {A3: 'Quarter 1, 2008'}],
	['SUBSTITUTE(A4,"1","2",3)', 'Quarter 1, 2012', {A4: 'Quarter 1, 2011'}],
	['SUBSTITUTE("aaa","a","b",2)', 'aba'],
	['SUBSTITUTE("aaa","a","b",4)', 'aaa'],
	['SUBSTITUTE("abc","","x")', 'abc'],
	['SUBSTITUTE("abc","b","x",0)', VALUE],
	['REPLACE(A2,6,5,"*")', 'abcde*k', {A2: 'abcdefghijk'}],
	['REPLACE(A3,3,2,"10")', '2010', {A3: 2009}],
	['REPLACE(A4,1,3,"@")', '@456', {A4: '123456'}],
	['REPLACE("abc",0,1,"x")', VALUE],
	// docs (FIND, SEARCH)
	['FIND("M",A2)', 1, {A2: 'Miriam McGovern'}],
	['FIND("m",A2)', 6, {A2: 'Miriam McGovern'}],
	['FIND("M",A2,3)', 8, {A2: 'Miriam McGovern'}],
	['FIND("",A2)', 1, {A2: 'abc'}],
	['FIND("z","abc")', VALUE],
	['FIND("a","abc",0)', VALUE],
	['FIND("a","abc",4)', VALUE],
	['SEARCH("e",A2,6)', 7, {A2: 'Statements'}],
	['SEARCH(A4,A3)', 8, {A3: 'Profit Margin', A4: 'margin'}],
	['REPLACE(A3,SEARCH(A4,A3),6,"Amount")', 'Profit Amount', {A3: 'Profit Margin', A4: 'margin'}],
	['MID(A3,SEARCH(" ",A3)+1,4)', 'Marg', {A3: 'Profit Margin'}],
	['SEARCH("""",A5)', 5, {A5: 'The "boss" is here.'}],
	[
		'MID(A5,SEARCH("""",A5)+1,SEARCH("""",A5,SEARCH("""",A5)+1)-SEARCH("""",A5)-1)',
		'boss',
		{A5: 'The "boss" is here.'},
	],
	['SEARCH("B?D","abcde")', 2],
	['SEARCH("*c","abcde")', 1],
	['SEARCH("c*e","abcde")', 3],
	['SEARCH("~*","a*b")', 2],
	['SEARCH("x*","abc")', VALUE],
	// docs (REPT, EXACT)
	['REPT("*-",3)', '*-*-*-'],
	['REPT("-",10)', '----------'],
	['REPT("ab",20000)', VALUE],
	['REPT("a",-1)', VALUE],
	['EXACT("Word","word")', false],
	['EXACT("Word","Word")', true],
	['EXACT("w ord","word")', false],
	// docs (CONCATENATE, CONCAT, TEXTJOIN)
	[
		'CONCATENATE("Stream population for ",A2," ",A3," is ",A4,"/mile.")',
		'Stream population for brook trout species is 32/mile.',
		{A2: 'brook trout', A3: 'species', A4: 32},
	],
	['CONCATENATE(1/4,TRUE)', '0.25TRUE'],
	['CONCAT(A1:B2)', 'abcd', {A1: 'a', B1: 'b', A2: 'c', B2: 'd'}],
	['CONCAT(A1:A3,"!")', 'ac!', {A1: 'a', A3: 'c'}],
	[
		'TEXTJOIN(", ",TRUE,A2:A8)',
		'US Dollar, Australian Dollar, Chinese Yuan, Hong Kong Dollar, Israeli Shekel, South Korean Won, Russian Ruble',
		{
			A2: 'US Dollar',
			A3: 'Australian Dollar',
			A4: 'Chinese Yuan',
			A5: 'Hong Kong Dollar',
			A6: 'Israeli Shekel',
			A7: 'South Korean Won',
			A8: 'Russian Ruble',
		},
	],
	['TEXTJOIN(",",FALSE,A1:A3)', 'a,,c', {A1: 'a', A3: 'c'}],
	['TEXTJOIN(",",TRUE,A1:A3)', 'a,c', {A1: 'a', A3: 'c'}],
	['TEXTJOIN({"-","+"},TRUE,1,2,3)', '1-2+3'],
	['TEXTJOIN(",",TRUE,A1:A2)', NA, {A1: NA}],
	// docs (VALUE)
	['VALUE("$1,000")', 1000],
	['VALUE("16:48:00")-VALUE("12:00:00")', 0.2],
	['VALUE("1e3")', 1000],
	['VALUE(" 12 ")', 12],
	['VALUE("abc")', VALUE],
	['VALUE(TRUE)', VALUE],
	['VALUE(A1)', 0],
	['LEN(REPT("a",30000)&REPT("b",3000))', VALUE],
	// docs (TEXT), through the grid's number formatter
	['TEXT(1234.567,"$#,##0.00")', '$1,234.57'],
	['TEXT(0.285,"0.0%")', '28.5%'],
	['TEXT(1234,"0000000")', '0001234'],
	['TEXT(12200000,"0.00E+00")', '1.22E+07'],
	['TEXT(4.34,"# ?/?")', '4 1/3'],
	['TEXT(DATE(2026,10,13),"yyyy-mm-dd")', '2026-10-13'],
	['TEXT(DATE(2026,10,13),"dddd")', 'Tuesday'],
	['TEXT(0.75,"h:mm AM/PM")', '6:00 PM'],
	// Text that reads as a number is formatted; other text and logicals pass through
	['TEXT("3.5","0.00")', '3.50'],
	['TEXT("abc","0.00")', 'abc'],
	['TEXT(TRUE,"0")', 'TRUE'],
	['TEXT(A1,"0.00")', '0.00'],
	['TEXT(-1,"yyyy")', VALUE],
	['TEXT(NA(),"0")', NA],
])

const table1 = {
	A1: 'Axles',
	B1: 'Bearings',
	C1: 'Bolts',
	A2: 4,
	B2: 4,
	C2: 9,
	A3: 5,
	B3: 7,
	C3: 10,
	A4: 6,
	B4: 8,
	C4: 11,
}
const people = {A1: 'ID', B1: 'Name', A2: 101, B2: 'Ann', A3: 102, B3: 'bob', A4: 103, B4: 'Cy', A5: 104, B5: 'Dee'}

table('lookup', [
	['VLOOKUP(102,A2:B5,2,FALSE)', 'bob', people],
	['VLOOKUP(102,A2:B5,2,)', 'bob', people],
	['VLOOKUP("BOB",B2:B5,1,FALSE)', 'bob', people],
	['VLOOKUP("d*",B2:B5,1,FALSE)', 'Dee', people],
	['VLOOKUP(105,A2:B5,2,FALSE)', NA, people],
	['VLOOKUP(102.5,A2:B5,2)', 'bob', people],
	['VLOOKUP(100,A2:B5,2,TRUE)', NA, people],
	['VLOOKUP(999,A2:B5,2,TRUE)', 'Dee', people],
	['VLOOKUP(102,A2:B5,0,FALSE)', VALUE, people],
	['VLOOKUP(102,A2:B5,3,FALSE)', REF, people],
	['VLOOKUP("102",A2:B5,2,FALSE)', NA, people],
	['VLOOKUP(NA(),A2:B5,2,FALSE)', NA, people],
	['VLOOKUP(1,Nope!A1:B2,2,FALSE)', REF],
	['MATCH(1,1/0)', DIV0],
	['VLOOKUP(103,A:B,2,FALSE)', 'Cy', people],
	// Blank cells in an approximate lookup column are stepped over
	['VLOOKUP(5,A1:B6,2)', 'e', {A1: 1, B1: 'a', A2: 3, B2: 'c', A4: 4, B4: 'd', A5: 5, B5: 'e', A6: 9, B6: 'i'}],
	// docs (HLOOKUP)
	['HLOOKUP("Axles",A1:C4,2,TRUE)', 4, table1],
	['HLOOKUP("Bearings",A1:C4,3,FALSE)', 7, table1],
	['HLOOKUP("B",A1:C4,3,TRUE)', 5, table1],
	['HLOOKUP("Bolts",A1:C4,4)', 11, table1],
	['HLOOKUP(3,{1,2,3;"a","b","c";"d","e","f"},2,TRUE)', 'c'],
	// docs (MATCH)
	['MATCH(39,B2:B5,1)', 2, {B2: 25, B3: 38, B4: 40, B5: 41}],
	['MATCH(41,B2:B5,0)', 4, {B2: 25, B3: 38, B4: 40, B5: 41}],
	['MATCH(40,B2:B5,-1)', NA, {B2: 25, B3: 38, B4: 40, B5: 41}],
	['MATCH(40,{50,40,30},-1)', 2],
	['MATCH(45,{50,40,30},-1)', 1],
	['MATCH("b?b",B2:B5,0)', 2, people],
	['MATCH(2,{1,2,2,2,3})', 4],
	['MATCH(2,{1,2,2,2,3},0)', 2],
	['MATCH(1,A1:B2,0)', NA],
	['MATCH(5,{1;3;5;7})', 3],
	// INDEX (docs)
	['INDEX(A2:B3,2,2)', 'Pears', {A2: 'Apples', B2: 'Lemons', A3: 'Bananas', B3: 'Pears'}],
	['INDEX(A2:B3,2,1)', 'Bananas', {A2: 'Apples', B2: 'Lemons', A3: 'Bananas', B3: 'Pears'}],
	['INDEX({1,2;3,4},0,2)', STALE],
	['SUM(INDEX({1,2;3,4},0,2))', 6],
	['INDEX((A1:B2,D1:E2),2,2,2)', 'e2', {E2: 'e2'}],
	['INDEX((A1:B2,D1:E2),1,1,3)', REF],
	['SUM(INDEX(A1:C3,0,3))', 12, {C1: 3, C2: 4, C3: 5}],
	['SUM(INDEX(A1:C3,2,0))', 9, {A2: 2, B2: 3, C2: 4}],
	['INDEX(A1:E1,3)', 'c', {C1: 'c'}],
	['INDEX(A1:A5,4)', 'd', {A4: 'd'}],
	['INDEX(A1:B2,3,1)', REF],
	['INDEX(A1:B2,-1,1)', VALUE],
	['INDEX({1,2,3},2)', 2],
	['INDEX(A1:A3,2)', 0],
	// docs (ROW, COLUMN, ROWS, COLUMNS)
	['ROW()', 999],
	['COLUMN()', 26],
	['ROW(C10)', 10],
	['COLUMN(D10)', 4],
	['ROWS(C1:E4)', 4],
	['COLUMNS(C1:E4)', 3],
	['ROWS({1,2,3;4,5,6})', 2],
	['COLUMNS({1,2,3;4,5,6})', 3],
	['ROWS(A:A)', 1048576],
	['COLUMNS(1:1)', 16384],
	['ROWS(5)', 1],
	['ROWS((A1,B2))', REF],
	['ROW(5)', VALUE],
])

const codes = {A2: 'China', B2: 'CN', A3: 'India', B3: 'IN', A4: 'USA', B4: 'US', A5: 'Brazil', B5: 'BR'}
const grades = {A1: 10, B1: 'F', A2: 20, B2: 'D', A3: 30, B3: 'C', A4: 30, B4: 'C2', A5: 40, B5: 'B', A6: 50, B6: 'A'}

table('XLOOKUP and XMATCH', [
	['XLOOKUP("India",A2:A5,B2:B5)', 'IN', codes],
	['_xlfn.XLOOKUP("usa",A2:A5,B2:B5)', 'US', codes],
	['XLOOKUP("Peru",A2:A5,B2:B5)', NA, codes],
	['XLOOKUP("Peru",A2:A5,B2:B5,"none")', 'none', codes],
	['XLOOKUP("Peru",A2:A5,B2:B5,)', NA, codes],
	['XLOOKUP("B*",A2:A5,B2:B5,,2)', 'BR', codes],
	['XLOOKUP("B*",A2:A5,B2:B5)', NA, codes],
	// Next smaller, next larger, and searching from the end
	['XLOOKUP(35,A1:A6,B1:B6,,-1)', 'C', grades],
	['XLOOKUP(35,A1:A6,B1:B6,,1)', 'B', grades],
	['XLOOKUP(30,A1:A6,B1:B6,,0,-1)', 'C2', grades],
	['XLOOKUP(30,A1:A6,B1:B6,,0,1)', 'C', grades],
	['XLOOKUP(35,A1:A6,B1:B6,,-1,2)', 'C2', grades],
	['XLOOKUP(35,A1:A6,B1:B6,,1,2)', 'B', grades],
	['XLOOKUP(45,A1:A6,B1:B6,,0,2)', NA, grades],
	['XLOOKUP(5,A1:A6,B1:B6,,-1)', NA, grades],
	// Horizontal, and returning a reference
	['XLOOKUP("b",A1:C1,A2:C2)', 2, {A1: 'a', B1: 'b', C1: 'c', A2: 1, B2: 2, C2: 3}],
	['SUM(XLOOKUP("b",A1:A3,B1:B3):B3)', 5, {A1: 'a', A2: 'b', A3: 'c', B1: 1, B2: 2, B3: 3}],
	['XLOOKUP("b",A1:A3,B1:C3)', STALE, {A2: 'b'}],
	['XLOOKUP("b",A1:A3,B1:B2)', VALUE],
	['XLOOKUP("b",A1:A3,B1:B3,,3)', VALUE],
	['XMATCH("Brazil",A2:A5)', 4, codes],
	['XMATCH(35,A1:A6,1)', 5, grades],
	['XMATCH(35,A1:A6,-1)', 3, grades],
	['XMATCH(30,A1:A6,0,-1)', 4, grades],
	['XMATCH(4.5,{5,4,3,2,1},1,-2)', 1],
	['XMATCH(4.5,{5,4,3,2,1},-1,-2)', 2],
	['XMATCH("c?ina",A2:A5,2)', 1, codes],
	['XMATCH(1,A1:B2)', VALUE],
])

table('dates', [
	// docs (DATE)
	['DATE(2008,1,1)', 39448],
	['DATE(2008,14,2)', 39846],
	['DATE(2008,1,35)', 39482],
	['DATE(2008,-3,2)', 39327],
	['DATE(2008,1,-15)', 39432],
	['DATE(108,1,2)', 39449],
	// The Lotus 1-2-3 leap day of 1900
	['DATE(1900,1,1)', 1],
	['DATE(1900,1,0)', 0],
	['DATE(1900,2,28)', 59],
	['DATE(1900,2,29)', 60],
	['DATE(1900,3,1)', 61],
	['DATE(1900,3,0)', 60],
	['DATE(1900,0,1)', NUM],
	['DATE(9999,12,31)', 2958465],
	['DATE(9999,12,32)', NUM],
	['DATE(-1,1,1)', NUM],
	['DATE(10000,1,1)', NUM],
	// docs (TIME)
	['TIME(12,0,0)', 0.5],
	['TIME(16,48,10)', 0.700115741],
	['TIME(0,750,0)', 0.520833333],
	['TIME(0,0,2000)', 0.023148148],
	['TIME(27,0,0)', 0.125],
	['TIME(0,0,-1)', NUM],
	// YEAR, MONTH, DAY, HOUR, MINUTE, SECOND
	['YEAR(39448)', 2008],
	['MONTH(39492)', 2],
	['DAY(39492)', 14],
	['MONTH(60)', 2],
	['DAY(60)', 29],
	['DAY(61)', 1],
	['YEAR(0)', 1900],
	['DAY(0)', 0],
	['YEAR(-1)', NUM],
	['YEAR(2958466)', NUM],
	['YEAR("2026-10-13")', 2026],
	['YEAR("x")', VALUE],
	['HOUR(0.75)', 18],
	['HOUR(39448.75)', 18],
	['MINUTE("12:45:00 PM")', 45],
	['SECOND("4:48:18 PM")', 18],
	['SECOND("4:48 PM")', 0],
	['MINUTE(TIME(1,59,59.6))', 59],
	['SECOND(0.999999)', 0],
	['HOUR(-1)', NUM],
	// docs (EDATE, EOMONTH)
	['EDATE(40558,1)', 40589],
	['EDATE(40558,-1)', 40527],
	['EDATE(40558,2)', 40617],
	['EDATE(DATE(2011,1,31),1)', 40602],
	['EDATE(DATE(2012,1,31),1)', 40968],
	['EOMONTH(40544,1)', 40602],
	['EOMONTH(40544,-3)', 40482],
	['EOMONTH(DATE(2024,1,15),1)', 45351],
	// docs (WEEKDAY, WEEKNUM)
	['WEEKDAY(39492)', 5],
	['WEEKDAY(39492,2)', 4],
	['WEEKDAY(39492,3)', 3],
	['WEEKDAY(39492,11)', 4],
	['WEEKDAY(39492,17)', 5],
	['WEEKDAY(39492,4)', NUM],
	['WEEKDAY(1)', 1],
	['WEEKNUM(40977)', 10],
	['WEEKNUM(40977,2)', 11],
	['WEEKNUM(DATE(2021,1,1),21)', 53],
	['WEEKNUM(DATE(2012,3,9),21)', 10],
	['WEEKNUM(DATE(2021,1,4),21)', 1],
	['WEEKNUM(40977,3)', NUM],
	// docs (DAYS, DATEDIF)
	['DAYS(DATE(2021,12,31),DATE(2021,1,1))', 364],
	['DAYS("2021-03-15","2021-02-01")', 42],
	['DATEDIF(DATE(2001,1,1),DATE(2003,1,1),"Y")', 2],
	['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"D")', 440],
	['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"YD")', 75],
	['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"MD")', 14],
	['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"M")', 14],
	['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"YM")', 2],
	['DATEDIF(DATE(2001,6,15),DATE(2002,8,1),"m")', 13],
	['DATEDIF(DATE(2002,1,1),DATE(2001,1,1),"D")', NUM],
	['DATEDIF(DATE(2001,1,1),DATE(2002,1,1),"W")', NUM],
	// docs (NETWORKDAYS)
	['NETWORKDAYS(DATE(2012,10,1),DATE(2013,3,1))', 110],
	['NETWORKDAYS(A2,A3,A4)', 109, {A2: '=DATE(2012,10,1)', A3: '=DATE(2013,3,1)', A4: '=DATE(2012,11,22)'}],
	[
		'NETWORKDAYS(A2,A3,A4:A6)',
		107,
		{
			A2: '=DATE(2012,10,1)',
			A3: '=DATE(2013,3,1)',
			A4: '=DATE(2012,11,22)',
			A5: '=DATE(2012,12,4)',
			A6: '=DATE(2013,1,21)',
		},
	],
	['NETWORKDAYS(DATE(2013,3,1),DATE(2012,10,1))', -110],
	['NETWORKDAYS(DATE(2024,1,6),DATE(2024,1,7))', 0],
	['NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,1),{45292,45292})', 0],
])

describe('date systems and the clock', () => {
	const now = () => new Date(2026, 9, 13, 18, 0, 0)

	test('TODAY and NOW read the injected clock', () => {
		expect(calc('TODAY()', {}, {now})).toBe(46308)
		expect(calc('NOW()', {}, {now})).toBeCloseTo(46308.75, 9)
	})

	test('the 1904 system counts from 1904-01-01', () => {
		expect(calc('DATE(1904,1,1)', {}, {date1904: true})).toBe(0)
		expect(calc('DATE(2008,1,1)', {}, {date1904: true})).toBe(37986)
		expect(calc('YEAR(0)', {}, {date1904: true})).toBe(1904)
		expect(calc('WEEKDAY(0)', {}, {date1904: true})).toBe(6)
		expect(calc('DATE(1903,12,31)', {}, {date1904: true})).toEqual(NUM)
		expect(calc('TODAY()', {}, {date1904: true, now})).toBe(46308 - 1462)
		expect(calc('"2026-10-13"+0', {}, {date1904: true})).toBe(46308 - 1462)
	})
})

describe('functions we deliberately leave to Excel', () => {
	test.each(['RAND()', 'RANDBETWEEN(1,2)', 'OFFSET(A1,1,1)', 'INDIRECT("A1")', 'LET(x,1,x)', 'FILTER(A1:A3,A1:A3>1)'])(
		'%s is stale',
		(formula) => expect(calc(formula)).toEqual(STALE),
	)
})
