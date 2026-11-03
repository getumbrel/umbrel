import {describe, expect, test} from 'vitest'

import {fontStack} from './fonts'

describe('font stacks', () => {
	test('Office faces get their stand-ins and a generic family', () => {
		expect(fontStack(['Calibri'])).toBe('"Calibri", "Carlito", sans-serif')
		// Office's default face since 2023
		expect(fontStack(['Aptos'])).toBe('"Aptos", "Carlito", sans-serif')
		expect(fontStack(['Aptos Display'])).toBe('"Aptos Display", "Carlito", sans-serif')
		expect(fontStack(['Cambria'])).toBe('"Cambria", "Caladea", serif')
		expect(fontStack(['Consolas'])).toBe('"Consolas", "Menlo", "Liberation Mono", monospace')
		expect(fontStack(['Verdana'])).toBe('"Verdana", "DejaVu Sans", sans-serif')
		expect(fontStack(['MS Mincho'])).toBe('"MS Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", serif')
		expect(fontStack(['Segoe UI'])).toBe('"Segoe UI", system-ui, sans-serif')
		expect(fontStack([' calibri light '])).toBe('"calibri light", "Carlito", sans-serif')
	})

	test('other faces get the generic family their name suggests', () => {
		expect(fontStack(['Fira Code'])).toBe('"Fira Code", monospace')
		expect(fontStack(['Microsoft Sans Serif'])).toBe('"Microsoft Sans Serif", sans-serif')
		expect(fontStack(['Century Schoolbook'])).toBe('"Century Schoolbook", serif')
		expect(fontStack(['Century Gothic'])).toBe('"Century Gothic", "URW Gothic", "Avant Garde", sans-serif')
		expect(fontStack(['Brand New Face'])).toBe('"Brand New Face", sans-serif')
	})

	test('latin, East Asian and complex-script faces in order, without repeats, generic from the first', () => {
		expect(fontStack(['Helvetica', 'Arial', undefined])).toBe(
			'"Helvetica", "Arial", "Liberation Sans", "Arimo", "Helvetica Neue", sans-serif',
		)
		expect(fontStack(['Times New Roman', 'MS Gothic', 'Arial'])).toBe(
			'"Times New Roman", "Liberation Serif", "Tinos", "Times", "MS Gothic", "Hiragino Sans", ' +
				'"Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Arial", "Liberation Sans", "Arimo", "Helvetica Neue", ' +
				'"Helvetica", serif',
		)
		expect(fontStack([undefined, 'SimSun', ''])).toBe('"SimSun", "Songti SC", "Noto Serif CJK SC", serif')
		expect(fontStack([])).toBe('sans-serif')
	})

	test('names from the document are only ever quoted family names', () => {
		expect(fontStack(['Evil"; } body { color: red'])).toBe('"Evil\\"; } body { color: red", sans-serif')
		expect(fontStack(['back\\slash'])).toBe('"back\\\\slash", sans-serif')
		expect(fontStack(['A\u0000B\nC\u007fD\u0085E'])).toBe('"ABCDE", sans-serif')
		expect(fontStack(['x'.repeat(500)])).toBe(`"${'x'.repeat(128)}", sans-serif`)
		// A name with a control character is looked up as the name it becomes
		expect(fontStack(['Cal\u0001ibri'])).toBe('"Calibri", "Carlito", sans-serif')
		for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty'])
			expect(fontStack([name])).toBe(`"${name}", sans-serif`)
	})

	test('the memo answers the same, whichever faces it was asked about before', () => {
		const first = fontStack(['Georgia', 'Yu Mincho'])
		for (let i = 0; i < 2500; i++) fontStack([`Face ${i}`])
		expect(fontStack(['Georgia', 'Yu Mincho'])).toBe(first)
		// Faces that join into the same text are still told apart
		expect(fontStack(['a\nb'])).toBe('"ab", sans-serif')
		expect(fontStack(['a', 'b'])).toBe('"a", "b", sans-serif')
	})
})
