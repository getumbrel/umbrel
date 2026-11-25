import {describe, expect, test} from 'vitest'

import {symbolChar} from './fonts'
import {formatNumber} from './numbering'

describe('number formats', () => {
	test.each([
		[1, 'decimal', '1'],
		[42, 'decimal', '42'],
		[7, 'decimalZero', '07'],
		[12, 'decimalZero', '12'],
		[1, 'upperRoman', 'I'],
		[4, 'upperRoman', 'IV'],
		[9, 'lowerRoman', 'ix'],
		[14, 'lowerRoman', 'xiv'],
		[1994, 'upperRoman', 'MCMXCIV'],
		[3999, 'upperRoman', 'MMMCMXCIX'],
		[1, 'upperLetter', 'A'],
		[26, 'lowerLetter', 'z'],
		// Word repeats the letter rather than counting in base 26
		[27, 'lowerLetter', 'aa'],
		[28, 'upperLetter', 'BB'],
		[53, 'lowerLetter', 'aaa'],
		[1, 'ordinal', '1st'],
		[2, 'ordinal', '2nd'],
		[3, 'ordinal', '3rd'],
		[4, 'ordinal', '4th'],
		[11, 'ordinal', '11th'],
		[12, 'ordinal', '12th'],
		[13, 'ordinal', '13th'],
		[21, 'ordinal', '21st'],
		[102, 'ordinal', '102nd'],
		[1, 'cardinalText', 'One'],
		[21, 'cardinalText', 'Twenty-one'],
		[115, 'cardinalText', 'One hundred fifteen'],
		[1, 'ordinalText', 'First'],
		[12, 'ordinalText', 'Twelfth'],
		[20, 'ordinalText', 'Twentieth'],
		[23, 'ordinalText', 'Twenty-third'],
		[3, 'decimalEnclosedCircle', '③'],
		[25, 'decimalEnclosedCircle', '25'],
		[1, 'chicago', '*'],
		[4, 'chicago', '§'],
		[5, 'chicago', '**'],
		[12, 'decimalFullWidth', '１２'],
		[5, 'none', ''],
		[5, 'bullet', ''],
		[5, 'japaneseCounting', '5'],
	])('%i as %s is %s', (n, format, expected) => {
		expect(formatNumber(n, format)).toBe(expected)
	})
})

describe('symbol fonts', () => {
	test('Symbol characters map to the Unicode characters they draw', () => {
		const map = (code: number) => symbolChar('Symbol', code)
		expect([0xf0b7, 0xf061, 0xf062, 0xf057, 0xf0e5, 0xf0d6, 0xf0a5, 0xf0b1, 0xf0ae, 0xf0b9].map(map)).toEqual([
			'•',
			'α',
			'β',
			'Ω',
			'∑',
			'√',
			'∞',
			'±',
			'→',
			'≠',
		])
		// The byte value works as well as its private-use form
		expect(map(0x61)).toBe('α')
		expect(map(0xf0f0)).toBeUndefined()
	})

	test('Wingdings check boxes, bullets and signs, and private-use characters left to their font', () => {
		const map = (font: string) => (code: number) => symbolChar(font, code)
		expect([0xf0fc, 0xf0fd, 0xf06c, 0xf0d8, 0xf06e].map(map('Wingdings'))).toEqual(['✓', '☒', '●', '➢', '■'])
		// What Word makes of "-->", "<=>" and "==>" as they're typed
		expect([0xf0e0, 0xf0f3, 0xf0e8].map(map('Wingdings'))).toEqual(['→', '⬄', '➔'])
		// A run of glyphs ends where the next code has no character of its own
		expect([0xf080, 0xf08a, 0xf095, 0xf096, 0xf0f8, 0xf0f9].map(map('Wingdings'))).toEqual([
			'⓪',
			'➉',
			'➓',
			undefined,
			'⬂',
			undefined,
		])
		expect([0xf050, 0xf053, 0xf0a3].map(map('Wingdings 2'))).toEqual(['✓', '☒', '☐'])
		expect(symbolChar('Wingdings', 0xf030)).toBeUndefined()
		expect(symbolChar('Wingdings 3', 0xf050)).toBeUndefined()
		expect(symbolChar('Some Font', 0xe001)).toBeUndefined()
		expect(symbolChar('MS Gothic', 0x2612)).toBe('☒')
	})

	test('a glyph whose character has an emoji as well is asked for as text', () => {
		const text = (char: string) => `${char}\ufe0e`
		// The small square of a list, a ticked box, and what Word makes of "<==" and ":)"; a phone and a letter
		expect([0xf0a7, 0xf0fe, 0xf0e7, 0xf04a, 0xf028, 0xf02a].map((code) => symbolChar('Wingdings', code))).toEqual(
			['▪', '☑', '⬅', '☺', '☎', '✉'].map(text),
		)
		expect(symbolChar('Wingdings 2', 0xf052)).toBe(text('☑'))
		expect([0xf0a9, 0xf0d3, 0xf0ab].map((code) => symbolChar('Symbol', code))).toEqual(['♥', '©', '↔'].map(text))
		// Not a digit, which is an emoji only on a key, nor a character of a font that isn't a symbol font
		expect(symbolChar('Symbol', 0xf031)).toBe('1')
		expect(symbolChar('MS Gothic', 0x2611)).toBe('☑')
	})
})
