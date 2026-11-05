import {afterEach, expect, test, vi} from 'vitest'

import type {Font} from './engine/xlsx/styles'
import {cellFont, fontMetrics, loadFonts} from './fonts'

afterEach(() => void vi.unstubAllGlobals())

const calibri: Font = {
	name: 'Calibri',
	size: 11,
	bold: false,
	italic: false,
	underline: 'none',
	strike: false,
	vertAlign: 'baseline',
}

test('a cell font is a canvas font with Office’s stand-ins for its face', () => {
	expect(cellFont(calibri)).toBe('14.67px "Calibri", "Carlito", sans-serif')
	expect(cellFont({name: 'Cambria', size: 12, bold: true, italic: true})).toBe(
		'italic bold 16px "Cambria", "Caladea", serif',
	)
	expect(cellFont({name: 'Aptos Display', size: 9})).toBe('12px "Aptos Display", "Carlito", sans-serif')
	expect(cellFont({name: 'Lucida Sans Typewriter', size: 7.5})).toBe('10px "Lucida Sans Typewriter", monospace')
})

test('a face named after what every object inherits is just a name', () => {
	for (const name of ['constructor', '__proto__']) expect(cellFont({name, size: 12})).toBe(`16px "${name}", sans-serif`)
})

test('text metrics forget faces once more than ten thousand have been measured', () => {
	const measureText = vi.fn(() => ({fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3}))
	vi.stubGlobal('document', {
		createElement: () => ({setAttribute() {}, style: {}, getContext: () => ({font: '', measureText})}),
		body: {append() {}},
	})
	expect(fontMetrics('16px "Face 0"', 16)).toEqual({ascent: 12, descent: 3})
	fontMetrics('16px "Face 0"', 16)
	expect(measureText).toHaveBeenCalledTimes(1)
	for (let i = 1; i <= 10_000; i++) fontMetrics(`16px "Face ${i}"`, 16)
	fontMetrics('16px "Face 0"', 16)
	expect(measureText).toHaveBeenCalledTimes(10_002)
})

test('a workbook’s faces load as the stacks the canvas draws with, once each', async () => {
	const load = vi.fn<(face: string) => Promise<FontFace[]>>(async () => [])
	vi.stubGlobal('document', {fonts: {load}})
	await loadFonts([calibri, {...calibri, size: 20}, {...calibri, bold: true}, {...calibri, name: 'constructor'}])
	expect(load.mock.calls.map(([face]) => face)).toEqual([
		'16px "Calibri", "Carlito", sans-serif',
		'bold 16px "Calibri", "Carlito", sans-serif',
		'16px "constructor", sans-serif',
	])
})
