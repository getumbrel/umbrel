import {describe, expect, test} from 'vitest'

import {fromTsv, toHtml, toTsv} from './clipboard'

describe('clipboard', () => {
	const rows = [
		['Name', 'Note', ''],
		['Ann', 'said "hi"\tthen\nleft', '42'],
	]

	test('writes tab-separated text that quotes what needs it', () => {
		expect(toTsv(rows)).toBe('Name\tNote\t\r\nAnn\t"said ""hi""\tthen\nleft"\t42')
	})

	test('reads back what it writes, and what other apps write', () => {
		expect(fromTsv(toTsv(rows))).toEqual(rows)
		expect(fromTsv('a\tb\nc\td\n')).toEqual([
			['a', 'b'],
			['c', 'd'],
		])
		expect(fromTsv('a\rb\r\n\r\nc')).toEqual([['a'], ['b'], [''], ['c']])
		expect(fromTsv('just text')).toEqual([['just text']])
		// A quote that never closes, or one inside a field, is just a character
		expect(fromTsv('"open\tx\nsay so')).toEqual([['"open', 'x'], ['say so']])
		expect(fromTsv('say "so"\tx')).toEqual([['say "so"', 'x']])
		expect(fromTsv('"a"b\t"c""d"')).toEqual([['ab', 'c"d']])
	})

	test('writes an HTML table with its text escaped', () => {
		expect(toHtml([['<b>&', 'line\nbreak']])).toBe(
			'<table><tr><td>&lt;b&gt;&amp;</td><td>line<br>break</td></tr></table>',
		)
	})
})
