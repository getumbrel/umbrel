// @vitest-environment jsdom
// What paint draws, recorded from a canvas that keeps only the calls made to it
import {beforeAll, describe, expect, test, vi} from 'vitest'

import {Axis} from './axis'
import type {CellStyle} from './engine/xlsx/styles'
import type {GridSource, Range} from './model'
import {paint, type View} from './paint'

// Every text measured, in order
const measured = vi.hoisted(() => [] as string[])
vi.mock('./fonts', async (importOriginal) => {
	const fonts = await importOriginal<typeof import('./fonts')>()
	return {...fonts, measure: (font: string, text: string) => (measured.push(text), fonts.measure(font, text))}
})

beforeAll(() => {
	// jsdom has no canvas: text then measures 7px a character (see fonts.ts)
	HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

type Call = {op: string; args: unknown[]; fillStyle: unknown}

function recorder() {
	const calls: Call[] = []
	const state: Record<string | symbol, unknown> = {}
	const ctx = new Proxy(state, {
		get: (target, name) =>
			name in target
				? target[name]
				: (...args: unknown[]) => void calls.push({op: String(name), args, fillStyle: target.fillStyle}),
		set: (target, name, value) => {
			target[name] = value
			return true
		},
	})
	return {ctx: ctx as unknown as CanvasRenderingContext2D, calls}
}

type Options = {
	rows?: number
	cols?: number
	frozen?: {rows: number; cols: number}
	merges?: Range[]
	texts?: Record<string, string>
}

// A CSV's look (no styles to resolve), 20px rows and 64px columns
function sheet({rows = 3, cols = 5, frozen = {rows: 0, cols: 0}, merges = [], texts = {}}: Options): GridSource {
	return {
		look: 'dark',
		rows: new Axis(rows, 20, []),
		cols: new Axis(cols, 64, []),
		frozen,
		merges,
		gridLines: true,
		rightToLeft: false,
		headerRow: false,
		cell: (row, col) => {
			const text = texts[`${row}:${col}`]
			return text === undefined ? undefined : {text, input: text, kind: 's'}
		},
		lineStyle: () => 0,
		load: () => {},
		subscribe: () => () => {},
	}
}

function draw(source: GridSource, {scrollX = 0, width = 800, height = 600} = {}) {
	const frozenWidth = source.cols.start(source.frozen.cols)
	const frozenHeight = source.rows.start(source.frozen.rows)
	const view: View = {
		width,
		height,
		dpr: 2,
		headerWidth: 36,
		headerHeight: 24,
		frozen: {...source.frozen, width: frozenWidth, height: frozenHeight},
		scrollX,
		scrollY: 0,
	}
	const {ctx, calls} = recorder()
	paint(ctx, view, source, {
		selection: {top: 0, left: 0, bottom: 0, right: 0},
		active: {top: 0, left: 0, bottom: 0, right: 0},
		brand: '0 0% 50%',
		match: () => 0,
	})
	return calls
}

describe('a short sheet', () => {
	// The dark look's frozen line
	const frozenLines = (calls: Call[]) =>
		calls.filter(({op, fillStyle}) => op === 'fillRect' && fillStyle === 'rgba(255, 255, 255, 0.18)')

	test('ends its frozen lines where it ends, as its header bands do', () => {
		// 5 columns and 3 rows: the sheet ends at x = 36 + 320 and y = 24 + 60, well inside 800×600
		const [across] = frozenLines(draw(sheet({frozen: {rows: 1, cols: 0}})))
		expect(across.args).toEqual([0, 24 + 20 - 0.5, 36 + 5 * 64, 0.5])
		const [down] = frozenLines(draw(sheet({frozen: {rows: 0, cols: 1}})))
		expect(down.args).toEqual([36 + 64 - 0.5, 0, 0.5, 24 + 3 * 20])
	})

	test('a sheet past the stage still draws them across it', () => {
		const [across] = frozenLines(draw(sheet({rows: 100, cols: 50, frozen: {rows: 1, cols: 0}})))
		expect(across.args).toEqual([0, 24 + 20 - 0.5, 800, 0.5])
	})
})

describe('a merge just out of view', () => {
	const title = 'MERGED TITLE THAT IS FAR LONGER THAN ITS TWO MERGED COLUMNS CAN HOLD'
	const drawn = (calls: Call[]) => calls.filter(({op, args}) => op === 'fillText' && args[0] === title)

	test('keeps its text inside it, never running it over the cells after it', () => {
		const source = sheet({rows: 10, cols: 40, merges: [{top: 0, left: 0, bottom: 0, right: 1}], texts: {'0:0': title}})
		// In view, it's drawn, clipped to A1:B1
		expect(drawn(draw(source))).toHaveLength(1)
		expect(drawn(draw(source, {scrollX: 66}))).toHaveLength(1)
		// Scrolled just past it, none of it is: C1 to G1 are empty
		expect(drawn(draw(source, {scrollX: 130}))).toHaveLength(0)
	})
})

describe('text out of view', () => {
	const run = 'UNMERGED TEXT THAT RUNS ACROSS EMPTY NEIGHBOURS AS EXCEL ALLOWS'
	const drawn = (calls: Call[]) => calls.filter(({op}) => op === 'fillText').map(({args}) => args[0])

	test('is drawn only when it runs into view', () => {
		// Scrolled past A and B, so C1 is the first cell shown; AE1 is far past the right edge
		const source = sheet({rows: 10, cols: 40, texts: {'2:0': run, '0:30': 'far', '0:3': 'shown'}})
		const texts = drawn(draw(source, {scrollX: 130}))
		expect(texts).toContain('shown')
		expect(texts).toContain(run)
		expect(texts).not.toContain('far')
	})
})

describe('a General number too wide for its column', () => {
	const GENERAL: CellStyle = {
		format: 'General',
		font: {
			name: 'Calibri',
			size: 11,
			bold: false,
			italic: false,
			underline: 'none',
			strike: false,
			vertAlign: 'baseline',
		},
		alignment: {
			horizontal: 'general',
			vertical: 'bottom',
			wrap: false,
			shrink: false,
			indent: 0,
			rotation: 0,
			readingOrder: 'context',
		},
		quotePrefix: false,
		locked: true,
		hidden: false,
	}

	test('is fitted on the first frame, and remembered on the next', () => {
		const value = 0.123456789012
		const source: GridSource = {
			...sheet({}),
			look: 'paper',
			styles: [GENERAL],
			cell: (row, col) =>
				row === 0 && col === 0 ? {text: String(value), input: String(value), kind: 'n', value} : undefined,
		}
		const shown = (calls: Call[]) => calls.filter(({op}) => op === 'fillText').map(({args}) => args[0])
		// At 7px a character, 58px holds six decimals
		expect(shown(draw(source))).toContain('0.123457')
		measured.length = 0
		expect(shown(draw(source))).toContain('0.123457')
		// The forms with more decimals, which don't fit, aren't measured again
		expect(measured.filter((text) => ['0.123456789', '0.12345679', '0.1234568'].includes(text))).toEqual([])
	})
})
