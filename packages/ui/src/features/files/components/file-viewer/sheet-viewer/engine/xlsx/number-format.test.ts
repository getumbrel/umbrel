import {describe, expect, test} from 'vitest'

import {builtinFormat, formatGeneral, formatNumber, INDEXED_COLORS, isDateFormat} from './number-format'
import {FIXTURES} from './test-helpers'

const text = (value: number | string, code: string, date1904 = false) => formatNumber(value, code, {date1904}).text
// Serial number of a date (and time) in the 1900 system
const serial = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
	(Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000 + (h * 3600 + min * 60 + s) / 86400

describe('General', () => {
	test.each([
		[0, '0'],
		[-0, '0'],
		[1, '1'],
		[-1, '-1'],
		[1234.5678, '1234.5678'],
		[0.1 + 0.2, '0.3'],
		[1 / 3, '0.333333333'],
		[-1 / 3, '-0.333333333'],
		[2 / 3, '0.666666667'],
		[1234.56789012, '1234.56789'],
		[12345.6789012345, '12345.6789'],
		[1234567.891, '1234567.891'],
		[12345678901, '12345678901'],
		[12345678901.6, '12345678902'],
		[99999999999.6, '1E+11'],
		[123456789012, '1.23457E+11'],
		[123456789012345, '1.23457E+14'],
		[1e21, '1E+21'],
		[0.0001, '0.0001'],
		[0.000123456789, '0.000123457'],
		[0.0999999999999, '0.1'],
		[0.00001, '1E-05'],
		[0.000000123, '1.23E-07'],
		[1.7976931348623157e308, '1.79769E+308'],
		[2.2250738585072014e-308, '2.22507E-308'],
		[5e-324, '4.94066E-324'],
	])('%s → %s', (value, expected) => {
		expect(formatGeneral(value)).toBe(expected)
		expect(text(value, 'General')).toBe(expected)
	})

	test('an empty code is General, and text passes through', () => {
		expect(text(1234.5, '')).toBe('1234.5')
		expect(text('abc', 'General')).toBe('abc')
	})
})

// Examples from Microsoft's "Number format codes" and "Review guidelines for customizing a number format" articles
describe('Excel documentation examples', () => {
	test.each([
		['####.#', 1234.59, '1234.6'],
		['#.000', 8.9, '8.900'],
		['0.#', 0.631, '0.6'],
		['#.0#', 12, '12.0'],
		['#.0#', 1234.568, '1234.57'],
		['???.???', 44.398, ' 44.398'],
		['???.???', 102.65, '102.65 '],
		['???.???', 2.8, '  2.8  '],
		['# ???/???', 5.25, '5   1/4  '],
		['# ???/???', 5.3, '5   3/10 '],
		['#,###', 12000, '12,000'],
		['#,', 12000, '12'],
		['0.0,,', 12200000, '12.2'],
		['0.00', 1234.567, '1234.57'],
		['#,##0.00', 1234.567, '1,234.57'],
		['00000', 1234, '01234'],
		['[<=9999999]###-####;(###) ###-####', 5551234, '555-1234'],
		['[<=9999999]###-####;(###) ###-####', 5551234567, '(555) 123-4567'],
	])('%s on %s → "%s"', (code, value, expected) => {
		expect(text(value, code)).toBe(expected)
	})

	const date = serial(2026, 1, 4) // a Sunday
	test.each([
		['m', '1'],
		['mm', '01'],
		['mmm', 'Jan'],
		['mmmm', 'January'],
		['mmmmm', 'J'],
		['d', '4'],
		['dd', '04'],
		['ddd', 'Sun'],
		['dddd', 'Sunday'],
		['yy', '26'],
		['yyyy', '2026'],
	])('dates: %s → %s', (code, expected) => {
		expect(text(date, code)).toBe(expected)
	})

	const time = (16 * 3600 + 36 * 60 + 3.75) / 86400
	test.each([
		['h', time, '16'],
		['hh', 4 / 24, '04'],
		['h:m', 9 / 24 + 5 / 1440, '9:5'],
		['h:mm', 9 / 24 + 5 / 1440, '9:05'],
		['h:mm:s', 9 / 24 + 7 / 86400, '9:00:7'],
		['h:mm:ss', 9 / 24 + 7 / 86400, '9:00:07'],
		['h AM/PM', 4 / 24, '4 AM'],
		['h:mm AM/PM', time, '4:36 PM'],
		['h:mm:ss A/P', time, '4:36:04 P'],
		['h:mm:ss.00', time, '16:36:03.75'],
		['[h]:mm', (1 * 60 + 2) / 1440, '1:02'],
		['[h]:mm', 25.02 / 24, '25:01'],
		['[mm]:ss', (62 * 60 + 16) / 86400, '62:16'],
		['[ss].00', 3735.8 / 86400, '3735.80'],
	])('times: %s on %s → %s', (code, value, expected) => {
		expect(text(value, code)).toBe(expected)
	})
})

// The cases in the corpus's dates-and-formats.xlsx, with the display Excel (en-US) gives
describe('dates-and-formats cases', () => {
	const d = serial(2026, 3, 14)
	const t = serial(2026, 3, 14, 15, 30)
	const accounting = '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'
	test.each([
		['0', 1234.5678, '1235'],
		['0.00', 1234.5678, '1234.57'],
		['#,##0', 1234567.891, '1,234,568'],
		['#,##0.00', 1234567.891, '1,234,567.89'],
		['#,##0.00', -1234.5, '-1,234.50'],
		['#,##0.00;[Red]-#,##0.00', -1234.5, '-1,234.50'],
		['#,##0.00_);[Red](#,##0.00)', -1234.5, '(1,234.50)'],
		['#,##0.00_);[Red](#,##0.00)', 1234.5, '1,234.50 '],
		['#,##0,', 1234567, '1,235'],
		['0.0,,"M"', 2500000, '2.5M'],
		['00000', 123, '00123'],
		['(###) ###-####', 5551234567, '(555) 123-4567'],
		['0.0 "kg"', 72.456, '72.5 kg'],
		['[Blue]0;[Red]-0;"zero";"text: "@', 5, '5'],
		['[Blue]0;[Red]-0;"zero";"text: "@', -5, '-5'],
		['[Blue]0;[Red]-0;"zero";"text: "@', 0, 'zero'],
		['[Blue]0;[Red]-0;"zero";"text: "@', 'abc', 'text: abc'],
		['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 2500000, '2.5M'],
		['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 12345, '12.3K'],
		['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 999, '999'],
		['"$"#,##0.00', 1234.5, '$1,234.50'],
		['"$"#,##0.00_);[Red]("$"#,##0.00)', -99.99, '($99.99)'],
		['[$€-2]\\ #,##0.00', 1234.5, '€ 1,234.50'],
		['#,##0.00\\ "€"', 1234.5, '1,234.50 €'],
		['"£"#,##0.00', 1234.5, '£1,234.50'],
		['[$¥-411]#,##0', 1234.5, '¥1,235'],
		[accounting, 1234.5, ' $1,234.50 '],
		[accounting, 0, ' $-   '],
		[accounting, -12, ' $(12.00)'],
		['0%', 0.256, '26%'],
		['0.00%', 0.25678, '25.68%'],
		['0.00%', -0.05, '-5.00%'],
		['# ?/?', 1.25, '1 1/4'],
		['# ??/??', 3.14159265, '3 14/99'],
		// ? pads a numerator to its placeholders so the slashes line up
		['# ???/???', 3.14159265, '3  16/113'],
		['# ?/8', 2.3, '2 2/8'],
		['0.00E+00', 123456, '1.23E+05'],
		['0.00E+00', 0.000123, '1.23E-04'],
		['##0.0E+0', 12345, '12.3E+3'],
		['@', '00123', '00123'],
		['@', 123, '123'],
		[builtinFormat(14)!, d, '3/14/2026'],
		['d-mmm-yy', d, '14-Mar-26'],
		['d-mmm', d, '14-Mar'],
		['mmm-yy', d, 'Mar-26'],
		['dd/mm/yyyy', d, '14/03/2026'],
		['yyyy-mm-dd', d, '2026-03-14'],
		['mmmm d, yyyy', d, 'March 14, 2026'],
		['dddd, mmmm dd, yyyy', d, 'Saturday, March 14, 2026'],
		['ddd d mmm', d, 'Sat 14 Mar'],
		['yyyy-mm-dd', 60, '1900-02-29'],
		['yyyy-mm-dd', 61, '1900-03-01'],
		['yyyy-mm-dd', 1, '1900-01-01'],
		['h:mm AM/PM', 15.5 / 24, '3:30 PM'],
		['h:mm:ss', 15.5 / 24, '15:30:00'],
		['[h]:mm:ss', 1.5, '36:00:00'],
		['mm:ss.0', 65.3 / 86400, '01:05.3'],
		[builtinFormat(22)!, t, '3/14/2026 15:30'],
		['yyyy-mm-dd"T"hh:mm:ss', t, '2026-03-14T15:30:00'],
		['yyyy-mm-dd h:mm:ss AM/PM', t, '2026-03-14 3:30:00 PM'],
	])('%s on %s → "%s"', (code, value, expected) => {
		expect(text(value, code)).toBe(expected)
	})

	test('colours and fills come back for the renderer', () => {
		expect(formatNumber(-1234.5, '#,##0.00;[Red]-#,##0.00')).toEqual({text: '-1,234.50', color: '#FF0000'})
		expect(formatNumber(5, '[Blue]0;[Red]-0')).toEqual({text: '5', color: '#0000FF'})
		expect(formatNumber(5, '[Color10]0').color).toBe('#008000')
		expect(formatNumber(5, '[color 3]0').color).toBe('#FF0000')
		expect(formatNumber(1234.5, accounting)).toEqual({text: ' $1,234.50 ', fill: {char: ' ', index: 2}})
		expect(formatNumber(-5, '0*-')).toEqual({text: '-5', fill: {char: '-', index: 2}})
		expect(formatNumber('abc', '@*.')).toEqual({text: 'abc', fill: {char: '.', index: 3}})
	})
})

// A sample of Apache POI's oracle workbooks, whose results Excel for Mac 16 computed with TEXT(); the full set runs
// against the corpus in fixtures.test.ts
describe("Excel's own TEXT() results", () => {
	test.each([
		['?,?????????', 1234567, '    1,234,567'],
		['?,????????', 1234567, '  1,234,567'],
		['0,000000000', 1234567, '0,001,234,567'],
		[',#', 1234567, ',1234567'],
		['#,##.#', 1234567, '1,234,567.'],
		['\\a $#.00" profit"', -12.3, '-a $12.30 profit'],
		['|#\\:#/#|', 23.75, '|23:3/4|'],
		['|#\\:#/#|', 0.75, '|3/4|'],
		['|#\\:#/#|', 0, '|0|'],
		['|#-#-#\\:#/#|', 23.75, '|-2-3:3/4|'],
		['|#-#-#\\:#/#|', 0.75, '|--3/4|'],
		['|#-#-#\\:#/#|', 0, '|--0|'],
		['|#\\:#=/=?|', 0, '|0      |'],
		['|#\\:?=/=#|', 0.75, '| 3=/=4|'],
		['|?\\:#=/=#|', 0.75, '|  3=/=4|'],
		['|0\\:#=/=#|', 0.75, '|0:3=/=4|'],
		['|#\\:0=/=#|', 0, '|0=/=1|'],
		['|?\\:0=/=#|', 0, '|0:0=/=1|'],
		['|#\\:0=/=#|', 1, '|1:0=/=1|'],
		['|#\\:? ?=/=#|', 23.75, '|2:3 3=/=4|'],
		['|#\\:? ?=/=#|', 0, '|:0      |'],
		['|#\\:? ?0#/000', 23.75, '|2:3  03/004'],
		['|?\\:?0=/=#|', 0.75, '|   3=/=4|'],
		['|#_#/#|', 3.75, '|15 /4|'],
		['|#_#/#|', 0, '|0 /1|'],
		['|#_?=/=#|', -3.75, '-|15 =/=4|'],
	])('%s on %s → "%s"', (code, value, expected) => {
		expect(text(value, code)).toBe(expected)
	})

	test('dates and times, in the 1904 system the oracle workbook uses', () => {
		expect(text(36191.1702084375, 'hh:mm:ss.000 am/pm', true)).toBe('04:05:06.009 AM')
		expect(text(17816.607951388887, 'dddd-mmmm-yyyy H:M:S am/pm', true)).toBe('Saturday-October-1952 2:35:27 PM')
		expect(text(17816.607951388887, 'd "days" h am/pm', true)).toBe('11 days 2 PM')
	})
})

describe('numbers', () => {
	test.each([
		// Rounding is half away from zero on the 15-digit value, not the binary one
		['0.00', 1.005, '1.01'],
		['0.00', 2.675, '2.68'],
		['0.00', -2.675, '-2.68'],
		['0', 2.5, '3'],
		['0', -2.5, '-3'],
		['0', 0.5, '1'],
		['0.0', 9.96, '10.0'],
		['#,##0', 999999.5, '1,000,000'],
		['0%', 0.07, '7%'],
		['0.0%', 0.0005, '0.1%'],
		['0%%', 0.5, '5000%%'],
		// The sign comes from the value before rounding, as in Excel
		['0', -0.4, '-0'],
		['#,##0.00', -0.001, '-0.00'],
		['0.##', 1, '1.'],
		['0.##', 1.5, '1.5'],
		['#.00', 0.5, '.50'],
		['.00', 12.5, '12.50'],
		['###', 0, ''],
		['#,##0.00', 0, '0.00'],
		['0,000', 5, '0,005'],
		['#,##0', 1e21, '1,000,000,000,000,000,000,000'],
		['0', 1e20, '100000000000000000000'],
		['0', 1.2345678901234568e17, '123456789012346000'],
		['0.00', 1e-20, '0.00'],
		['#,##0,,', 1234567890, '1,235'],
		['0.0?', 1.5, '1.5 '],
		['$#,##0', -5, '-$5'],
		['"Total: "0', -5, '-Total: 5'],
		['0;0', -5, '5'],
		['000-00-0000', 123456789, '123-45-6789'],
		['0" items"', 3, '3 items'],
		['\\0\\x0', 7, '0x7'],
	])('%s on %s → "%s"', (code, value, expected) => {
		expect(text(value, code)).toBe(expected)
	})

	test('sections', () => {
		const code = '0.00;(0.00);"zero";"Text: "@'
		expect(text(1.5, code)).toBe('1.50')
		expect(text(-1.5, code)).toBe('(1.50)')
		expect(text(0, code)).toBe('zero')
		expect(text('x', code)).toBe('Text: x')
		// Two sections: zero belongs to the first
		expect(text(0, '0.0;-0.0')).toBe('0.0')
		// Empty sections hide what they'd format
		expect(text(0, '0;-0;;@')).toBe('')
		expect(text(5, ';;;')).toBe('')
		expect(text('x', ';;;')).toBe('')
		// A last section with @ is the text section, whatever the count
		expect(text('x', '0.00;@')).toBe('x')
		expect(text(-1, '0.00;@')).toBe('-1.00')
		expect(text('x', '"Name: "@')).toBe('Name: x')
		expect(text(5, '"Name: "@')).toBe('5')
		// Without a text section text is shown as it is
		expect(text('abc', '0.00')).toBe('abc')
		// More than four sections: the extras are ignored
		expect(text('t', '0;0;0;@;0')).toBe('t')
	})

	test('conditions', () => {
		// Sections whose condition isn't "below zero" keep the minus sign
		expect(text(-500, '[>100]0;[<-100]0;0')).toBe('-500')
		expect(text(-5, '[>100]0;[<-100]0;0')).toBe('-5')
		expect(text(-5, '[<0]"neg "0;0')).toBe('neg 5')
		expect(text(5, '[<0]"neg "0;0')).toBe('5')
		expect(text(1, '[=1]"one";[=2]"two";0')).toBe('one')
		expect(text(2, '[=1]"one";[=2]"two";0')).toBe('two')
		expect(text(3, '[=1]"one";[=2]"two";0')).toBe('3')
		expect(text(3, '[<>3]"not three";"three"')).toBe('three')
		// No section matching falls back to General
		expect(text(5, '[>100]"big";[<-100]"small"')).toBe('5')
	})

	test('scientific', () => {
		expect(text(0, '0.00E+00')).toBe('0.00E+00')
		expect(text(9.999, '0.00E+00')).toBe('1.00E+01')
		expect(text(-123456, '0.00E+00')).toBe('-1.23E+05')
		expect(text(12345, '0.0E-0')).toBe('1.2E4')
		expect(text(0.00012, '0.0E-0')).toBe('1.2E-4')
		expect(text(12345, '0.0e+00')).toBe('1.2e+04')
		expect(text(0.0005, '##0.0E+0')).toBe('500.0E-6')
		expect(text(999.96, '##0.0E+0')).toBe('1.0E+3')
		expect(text(123456, '##0.0E+0')).toBe('123.5E+3')
		expect(text(12345, '00.00E+00')).toBe('12.35E+03')
		expect(text(1e300, '0.0E+00')).toBe('1.0E+300')
		expect(text(12345, '#.##E+00')).toBe('1.23E+04')
	})

	test('fractions', () => {
		expect(text(1.25, '?/?')).toBe('5/4')
		expect(text(2, '?/?')).toBe('2/1')
		expect(text(0, '?/?')).toBe('0/1')
		// Whole numbers leave the fraction's place blank
		expect(text(2, '# ?/?')).toBe('2    ')
		expect(text(0, '# ?/?')).toBe('0    ')
		expect(text(2.999, '# ?/?')).toBe('3    ')
		expect(text(0.25, '# ?/?')).toBe(' 1/4')
		expect(text(0.25, '0 ?/?')).toBe('0 1/4')
		expect(text(-1.25, '# ?/?')).toBe('-1 1/4')
		expect(text(0.5, '# ??/??')).toBe('  1/2 ')
		expect(text(1.25, '# ?/100')).toBe('1 25/100')
		expect(text(1 / 3, '# ?/?')).toBe(' 1/3')
		expect(text(0.999, '# ??/??')).toBe('1      ')
		expect(text(1e15 + 0.5, '# ?/?')).toBe('1000000000000000 1/2')
	})

	test('non-finite numbers', () => {
		expect(text(Infinity, '0.00')).toBe('#NUM!')
		expect(text(NaN, 'General')).toBe('#NUM!')
	})
})

describe('dates and times', () => {
	test('the 1900 system, with its fictitious 29 February', () => {
		expect(text(0, 'yyyy-mm-dd')).toBe('1900-01-00')
		expect(text(0, 'dddd')).toBe('Saturday')
		expect(text(1, 'dddd')).toBe('Sunday')
		expect(text(59, 'yyyy-mm-dd')).toBe('1900-02-28')
		expect(text(60, 'dddd d mmmm')).toBe('Wednesday 29 February')
		expect(text(serial(9999, 12, 31), 'yyyy-mm-dd')).toBe('9999-12-31')
	})

	test('the 1904 system', () => {
		expect(text(0, 'yyyy-mm-dd', true)).toBe('1904-01-01')
		expect(text(0, 'dddd', true)).toBe('Friday')
		expect(text(serial(2026, 3, 14) - 1462, 'yyyy-mm-dd', true)).toBe('2026-03-14')
	})

	test('dates Excel shows as ####', () => {
		expect(formatNumber(-1, 'yyyy-mm-dd')).toEqual({text: '#', fill: {char: '#', index: 0}})
		expect(formatNumber(serial(9999, 12, 31) + 1, 'yyyy-mm-dd').text).toBe('#')
		expect(formatNumber(-0.5, '[h]:mm').text).toBe('#')
		// A negative section that's a date formats the magnitude
		expect(text(-1, '0;yyyy-mm-dd')).toBe('1900-01-01')
	})

	test('times round to the finest unit shown, carrying into the date', () => {
		expect(text(15 / 24 + 30 / 1440 + 45 / 86400, 'h:mm')).toBe('15:30')
		expect(text(15 / 24 + 30 / 1440 + 59.6 / 86400, 'h:mm')).toBe('15:31')
		expect(text(0.9999999, 'h:mm:ss')).toBe('0:00:00')
		expect(text(serial(2026, 3, 14, 23, 59, 59.7), 'yyyy-mm-dd hh:mm:ss')).toBe('2026-03-15 00:00:00')
		expect(text(serial(2026, 3, 14, 23, 59, 59.7), 'yyyy-mm-dd hh:mm:ss.0')).toBe('2026-03-14 23:59:59.7')
		expect(text(1.5 / 86400, 'ss.000')).toBe('01.500')
	})

	test('12-hour clock and AM/PM spellings', () => {
		expect(text(0, 'h:mm AM/PM')).toBe('12:00 AM')
		expect(text(0.5, 'h:mm AM/PM')).toBe('12:00 PM')
		// Excel capitalises AM/PM however it's written, but keeps A/P as written
		expect(text(13 / 24, 'h am/pm')).toBe('1 PM')
		expect(text(1 / 24, 'h a/p')).toBe('1 a')
		expect(text(13 / 24, 'hh A/p')).toBe('01 p')
	})

	test('m means minutes beside hours or seconds, else months', () => {
		const t = serial(2026, 3, 14, 9, 7, 5)
		expect(text(t, 'yyyy-mm-dd hh:mm')).toBe('2026-03-14 09:07')
		expect(text(t, 'mm:ss')).toBe('07:05')
		expect(text(t, 'm/d h:m')).toBe('3/14 9:7')
		expect(text(t, '[h]:mm')).toBe(`${Math.floor(t * 24)}:07`)
		expect(text(t, 'h "h" mm "min"')).toBe('9 h 07 min')
		expect(text(t, 'mmm')).toBe('Mar')
	})

	test('literal characters in date formats', () => {
		const t = serial(2026, 3, 14, 9, 7, 5)
		expect(text(t, 'dd.mm.yyyy')).toBe('14.03.2026')
		expect(text(t, 'yyyy"年"m"月"d"日"')).toBe('2026年3月14日')
		expect(text(t, '[$-409]mmmm d, yyyy;@')).toBe('March 14, 2026')
		expect(text(t, '[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy')).toBe('Saturday, March 14, 2026')
		expect(text(t, '"上午/下午 "hh"時"mm"分"ss"秒 "')).toBe('上午/下午 09時07分05秒 ')
		expect(text('note', 'yyyy-mm-dd;@')).toBe('note')
	})
})

test('built-in formats', () => {
	expect(builtinFormat(0)).toBe('General')
	expect(builtinFormat(9)).toBe('0%')
	expect(builtinFormat(14)).toBe('m/d/yyyy')
	expect(builtinFormat(49)).toBe('@')
	// Locale-specific ids fall back to their nearest neutral format
	expect(builtinFormat(27)).toBe('m/d/yyyy')
	expect(builtinFormat(33)).toBe('h:mm:ss')
	expect(builtinFormat(81)).toBe('mm:ss.0')
	expect(builtinFormat(23)).toBeUndefined()
	expect(builtinFormat(200)).toBeUndefined()
	expect(text(1234.5, builtinFormat(44)!)).toBe(' $1,234.50 ')
	expect(text(-1234.5, builtinFormat(8)!)).toBe('($1,234.50)')
	expect(text(0.5, builtinFormat(18)!)).toBe('12:00 PM')
})

test('isDateFormat', () => {
	for (const code of ['yyyy-mm-dd', 'm/d/yyyy', 'h:mm', '[h]:mm:ss', 'mm:ss.0', '[$-409]mmmm d, yyyy;@', 'h AM/PM']) {
		expect(isDateFormat(code), code).toBe(true)
	}
	for (const code of ['General', '0.00', '"yyyy"0', '[Red]0', '0;[Red]mm', '@', '#,##0.00 "d"', '']) {
		expect(isDateFormat(code), code).toBe(false)
	}
})

test('the default palette matches what Office writes out', () => {
	expect(INDEXED_COLORS).toHaveLength(64)
	expect(INDEXED_COLORS.slice(0, 8)).toEqual([
		'#000000',
		'#FFFFFF',
		'#FF0000',
		'#00FF00',
		'#0000FF',
		'#FFFF00',
		'#FF00FF',
		'#00FFFF',
	])
	expect(INDEXED_COLORS[63]).toBe('#333333')
})

test('hostile codes stay cheap and safe', () => {
	expect(text(5, '[constructor]0')).toBe('5')
	expect(formatNumber(5, '[__proto__]0').color).toBeUndefined()
	const start = performance.now()
	expect(text(1, '0'.repeat(100_000))).toHaveLength(100_000)
	expect(text(1, `0.${'0'.repeat(50_000)}`)).toHaveLength(50_002)
	expect(text(1, ';'.repeat(100_000))).toBe('')
	expect(text(1, `[h${'h'.repeat(1000)}]`)).toHaveLength(1001)
	expect(text(0.5, `# ${'?'.repeat(50)}/${'?'.repeat(50)}`)).toContain('1/2')
	expect(text(1, '"unterminated')).toBe('unterminated')
	expect(text(1, '[Red')).toBe('[Red')
	expect(performance.now() - start).toBeLessThan(1000)
})

// Timed, so it runs with the corpus (FILES_FIXTURES) rather than in every npm test
test.skipIf(!FIXTURES)('formatting is fast', () => {
	const codes = ['#,##0.00', 'yyyy-mm-dd hh:mm', '0.00%', 'General', '# ?/?', '0.00E+00']
	const start = performance.now()
	let length = 0
	for (let i = 0; i < 100_000; i++) length += text(i * 1.37, codes[i % codes.length]).length
	const elapsed = performance.now() - start
	expect(length).toBeGreaterThan(0)
	expect(elapsed).toBeLessThan(1000)
	console.log(`formatNumber: ${(elapsed / 100).toFixed(2)} µs per value`)
})
