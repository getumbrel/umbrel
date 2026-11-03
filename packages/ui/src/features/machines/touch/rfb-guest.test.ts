// @vitest-environment jsdom

import {expect, it, vi} from 'vitest'

import {classifyCursor, classifyDrawnCursor} from './rfb-guest'

vi.mock('@novnc/novnc', () => ({default: class {}}))
vi.mock('@/trpc/trpc', () => ({trpcClient: {}}))

// Cursor images as RGBA, from a little picture: # is opaque
function cursorImage(rows: string[]) {
	const width = rows[0].length
	const rgba = new Uint8Array(width * rows.length * 4)
	rows.forEach((row, y) => [...row].forEach((pixel, x) => (rgba[(y * width + x) * 4 + 3] = pixel === '#' ? 255 : 0)))
	return {rgba, width, height: rows.length}
}

const IBEAM = [
	'#####',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'..#..',
	'#####',
]
const ARROW = [
	'#.......',
	'##......',
	'###.....',
	'####....',
	'#####...',
	'######..',
	'#######.',
	'########',
	'###.....',
]

it('reads a tall, narrow cursor centred on its hotspot as an I-beam', () => {
	const {rgba, width, height} = cursorImage(IBEAM)
	expect(classifyCursor(rgba, 2, 6, width, height)).toBe('ibeam')
})

it('reads a cursor pointing from its tip as an arrow', () => {
	const {rgba, width, height} = cursorImage(ARROW)
	expect(classifyCursor(rgba, 0, 0, width, height)).toBe('arrow')
})

// Regions the way a guest that draws its own cursor changes them: `changed` marks
// pixels around the centre that differ between two frames
function drawnFrames(size: number, changed: (column: number, row: number) => boolean) {
	const before = {width: size, height: size, data: new Uint8ClampedArray(size * size * 4)} as unknown as ImageData
	const after = {width: size, height: size, data: new Uint8ClampedArray(size * size * 4)} as unknown as ImageData
	for (let row = 0; row < size; row++) {
		for (let column = 0; column < size; column++) {
			if (changed(column, row)) after.data.fill(255, (row * size + column) * 4, (row * size + column) * 4 + 3)
		}
	}
	return [before, after] as const
}

it('tells a drawn I-beam by reaching above and below the pointer', () => {
	const [before, after] = drawnFrames(
		29,
		(column, row) =>
			(column === 14 && row >= 6 && row <= 22) || (Math.abs(column - 14) <= 2 && (row === 6 || row === 22)),
	)
	expect(classifyDrawnCursor(before, after).kind).toBe('ibeam')
})

it('tells a drawn arrow by painting only right of and below its tip', () => {
	const [before, after] = drawnFrames(
		29,
		(column, row) => column >= 14 && row >= 14 && column - 14 <= row - 14 && row <= 26,
	)
	expect(classifyDrawnCursor(before, after).kind).toBe('arrow')
})

it('ignores a region nothing happened in', () => {
	const [before, after] = drawnFrames(29, () => false)
	expect(classifyDrawnCursor(before, after).kind).toBe('unchanged')
})
