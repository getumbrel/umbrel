import {describe, expect, test} from 'vitest'

import {DocxError} from './package'
import {
	changes,
	MAX_PAGES,
	plan,
	type Box,
	type FlowItem,
	type Measurer,
	type PlannedPage,
	type PlanSection,
} from './plan'

type Fake = {
	item: FlowItem
	lines?: Box[]
	rows?: Array<Box & {header: boolean}>
	notes?: Array<{y: number; id: string}>
}

// A paragraph of `count` lines of `height`, with its spacing
function paragraph(count: number, options: Partial<FlowItem> & {line?: number} = {}): Fake {
	const {line = 20, before = 0, after = 0, ...rest} = options
	const lines = Array.from({length: count}, (_, i) => ({top: before + i * line, bottom: before + (i + 1) * line}))
	return {item: {kind: 'paragraph', height: before + count * line + after, before, after, ...rest}, lines}
}

function table(rows: number, options: {header?: number; row?: number} = {}): Fake {
	const {header = 0, row = 20} = options
	return {
		item: {kind: 'table', height: rows * row, before: 0, after: 0},
		rows: Array.from({length: rows}, (_, i) => ({top: i * row, bottom: (i + 1) * row, header: i < header})),
	}
}

function measurer(fakes: Fake[], notes: Record<string, number> = {}): Measurer {
	return {
		lines: (i) => fakes[i].lines ?? [],
		rows: (i) => fakes[i].rows ?? [],
		notes: (i) => fakes[i].notes ?? [],
		noteHeight: (id) => notes[id] ?? 0,
		separatorHeight: () => 10,
	}
}

function section(fakes: Fake[], options: Partial<PlanSection> & {height?: number} = {}): PlanSection {
	const {height = 100, ...rest} = options
	return {
		items: fakes.map((fake) => fake.item),
		columns: [{left: 0, width: 100}],
		start: 'nextPage',
		bodyHeight: () => height,
		pageKey: 'A4',
		...rest,
	}
}

const run = (
	fakes: Fake[],
	options: Partial<PlanSection> & {height?: number} = {},
	notes: Record<string, number> = {},
) => plan([section(fakes, options)], [measurer(fakes, notes)])

// What each page holds, as item:from-to
const layout = (pages: PlannedPage[]) =>
	pages.map((page) =>
		page.bands
			.map((band) =>
				band.columns
					.map((column) => column.map((piece) => `${piece.item}:${piece.from}-${piece.to ?? 'end'}`).join(' '))
					.join(' | '),
			)
			.join(' || '),
	)

describe('flow', () => {
	test('blocks fill pages in order, numbered from the section start', () => {
		const pages = run([paragraph(2), paragraph(2), paragraph(2)], {firstNumber: 5})
		expect(layout(pages)).toEqual(['0:0-end 1:0-end 2:0-1', '2:1-end'])
		expect(pages.map((page) => page.number)).toEqual([5, 6])
	})

	test('the space before a block is dropped at the top of a page that began because the last one was full', () => {
		const pages = run([
			paragraph(4),
			paragraph(1, {before: 30}),
			paragraph(1, {before: 30}),
			paragraph(1, {breakBefore: 'page'}),
			paragraph(1, {before: 30}),
		])
		expect(layout(pages)).toEqual(['0:0-end', '1:0-end 2:0-end', '3:0-end 4:0-end'])
		const second = pages[1].bands[0].columns[0]
		expect(second.map((piece) => [piece.drop, piece.height])).toEqual([
			[30, 20],
			[0, 50],
		])
	})

	test('space after may hang below the bottom of the page', () => {
		expect(layout(run([paragraph(4), paragraph(1, {after: 40})]))).toEqual(['0:0-end 1:0-end'])
	})

	test('paragraphs break between lines', () => {
		const pages = run([paragraph(3), paragraph(4)])
		expect(layout(pages)).toEqual(['0:0-end 1:0-2', '1:2-end'])
		expect(pages[1].bands[0].columns[0][0]).toMatchObject({from: 2, height: 40})
	})

	test('widow and orphan control keep two lines on either side of a break', () => {
		// One line would be left alone at the bottom: the whole paragraph moves
		expect(layout(run([paragraph(4), paragraph(3, {widowControl: true})]))).toEqual(['0:0-end', '1:0-end'])
		// One line would be left alone at the top of the next page: one more line goes with it
		expect(layout(run([paragraph(2), paragraph(4, {widowControl: true})]))).toEqual(['0:0-end 1:0-2', '1:2-end'])
		expect(layout(run([paragraph(1), paragraph(5, {widowControl: true})]))).toEqual(['0:0-end 1:0-3', '1:3-end'])
		// Without it, a single line stays
		expect(layout(run([paragraph(4), paragraph(3)]))).toEqual(['0:0-end 1:0-1', '1:1-end'])
	})

	test('keep lines together moves a paragraph whole, unless even a page is too short for it', () => {
		expect(layout(run([paragraph(3), paragraph(3, {keepLines: true})]))).toEqual(['0:0-end', '1:0-end'])
		expect(layout(run([paragraph(7, {keepLines: true})]))).toEqual(['0:0-5', '0:5-end'])
	})

	test('keep with next takes a heading to the page its paragraph starts on', () => {
		expect(layout(run([paragraph(3), paragraph(1, {keepNext: true}), paragraph(3, {keepLines: true})]))).toEqual([
			'0:0-end',
			'1:0-end 2:0-end',
		])
		// A chain of them moves together
		expect(
			layout(
				run([
					paragraph(2),
					paragraph(1, {keepNext: true}),
					paragraph(1, {keepNext: true}),
					paragraph(3, {keepLines: true}),
				]),
			),
		).toEqual(['0:0-end', '1:0-end 2:0-end 3:0-end'])
		// Kept with the first line is enough
		expect(layout(run([paragraph(3), paragraph(1, {keepNext: true}), paragraph(3)]))).toEqual([
			'0:0-end 1:0-end 2:0-1',
			'2:1-end',
		])
		// A chain that fills its page breaks after all
		expect(layout(run([paragraph(5, {keepNext: true}), paragraph(2)]))).toEqual(['0:0-end', '1:0-end'])
	})

	test('page breaks, column breaks and page break before', () => {
		expect(
			layout(
				run([paragraph(1), paragraph(1, {breakBefore: 'page'}), paragraph(1, {pageBreakBefore: true}), paragraph(1)]),
			),
		).toEqual(['0:0-end', '1:0-end', '2:0-end 3:0-end'])
		// Page break before at the top of a page doesn't add another
		expect(layout(run([paragraph(1, {pageBreakBefore: true})]))).toEqual(['0:0-end'])
		const columns = [
			{left: 0, width: 45},
			{left: 55, width: 45},
		]
		expect(
			layout(
				run([paragraph(1), paragraph(1, {breakBefore: 'column'}), paragraph(1, {breakBefore: 'column'})], {columns}),
			),
		).toEqual(['0:0-end | 1:0-end', '2:0-end | '])
	})

	test('a line taller than the page still goes in, cut off', () => {
		const tall = {item: {kind: 'paragraph' as const, height: 300, before: 0, after: 0}, lines: [{top: 0, bottom: 300}]}
		expect(layout(run([paragraph(1), tall, paragraph(1)]))).toEqual(['0:0-end', '1:0-end', '2:0-end'])
	})
})

describe('tables', () => {
	test('break between rows and repeat their header rows', () => {
		const pages = run([paragraph(2), table(9, {header: 1})])
		expect(layout(pages)).toEqual(['0:0-end 1:0-3', '1:3-7', '1:7-end'])
		// Four rows, under a repeat of the 20 px header row
		expect(pages[1].bands[0].columns[0][0]).toMatchObject({from: 3, to: 7, height: 100})
	})

	test('never leave their header rows alone at the bottom of a page', () => {
		expect(layout(run([paragraph(4), table(3, {header: 1})]))).toEqual(['0:0-end', '1:0-end'])
	})

	test('a row taller than the page goes in alone', () => {
		const tall = {
			item: {kind: 'table' as const, height: 340, before: 0, after: 0},
			rows: [
				{top: 0, bottom: 20, header: false},
				{top: 20, bottom: 320, header: false},
				{top: 320, bottom: 340, header: false},
			],
		}
		expect(layout(run([tall]))).toEqual(['0:0-1', '0:1-2', '0:2-end'])
	})
})

describe('footnotes', () => {
	test('take space at the bottom of the page their reference is on', () => {
		const withNote = {...paragraph(2), notes: [{y: 25, id: 'a'}]}
		const pages = run([paragraph(2), withNote, paragraph(1)], {}, {a: 10})
		// 40 + 40 + the note's 10 + the separator's 10 leave no room for the last paragraph
		expect(layout(pages)).toEqual(['0:0-end 1:0-end', '2:0-end'])
		expect(pages.map((page) => page.notes)).toEqual([['a'], []])
	})

	test('a reference that no longer fits moves to the next page with its note', () => {
		const withNote = {...paragraph(2), notes: [{y: 25, id: 'a'}]}
		const pages = run([paragraph(3), withNote], {}, {a: 30})
		expect(layout(pages)).toEqual(['0:0-end 1:0-1', '1:1-end'])
		expect(pages.map((page) => page.notes)).toEqual([[], ['a']])
	})
})

describe('sections and columns', () => {
	const columns = [
		{left: 0, width: 45},
		{left: 55, width: 45},
	]

	test('columns fill in turn before the next page', () => {
		expect(layout(run([paragraph(5), paragraph(5), paragraph(5)], {columns}))).toEqual([
			'0:0-end | 1:0-end',
			'2:0-end | ',
		])
	})

	test('a continuous section follows on the same page, under the evened-out columns before it', () => {
		const first = [paragraph(1), paragraph(1), paragraph(1), paragraph(1)]
		const second = [paragraph(1)]
		const pages = plan(
			[section(first, {columns}), section(second, {start: 'continuous'})],
			[measurer(first), measurer(second)],
		)
		expect(layout(pages)).toEqual(['0:0-end 1:0-end | 2:0-end 3:0-end || 0:0-end'])
		expect(pages[0].bands[1]).toMatchObject({section: 1, top: 40, height: 60})
	})

	test('next page, odd and even page starts, and pages of another size', () => {
		const one = () => [paragraph(1)]
		const sections = [
			section(one()),
			section(one(), {start: 'oddPage'}),
			section(one(), {start: 'evenPage'}),
			section(one(), {start: 'continuous', pageKey: 'A3'}),
		]
		const pages = plan(
			sections,
			sections.map((s) => measurer(s.items.map((item) => ({item, lines: [{top: 0, bottom: 20}]})))),
		)
		expect(pages.map((page) => [page.section, page.number, Boolean(page.blank)])).toEqual([
			[0, 1, false],
			[1, 2, true],
			[1, 3, false],
			[2, 4, false],
			[3, 5, false],
		])
	})

	test('a section starting in the next column shares the band, and its pieces say whose items they are', () => {
		const first = [paragraph(1, {keepNext: true})]
		const second = [paragraph(1), paragraph(6, {keepLines: true})]
		const pages = plan(
			[section(first, {columns}), section(second, {columns, start: 'nextColumn'})],
			[measurer(first), measurer(second)],
		)
		expect(pages[0].bands).toHaveLength(1)
		// The second section's tall paragraph moves on without taking the first section's item along
		expect(
			pages.map((page) =>
				page.bands[0].columns.map((column) => column.map((piece) => `${piece.section}.${piece.item}`).join(' ')),
			),
		).toEqual([
			['0.0', '1.0'],
			['1.1', '1.1'],
		])
	})

	test('a section restarting its page numbers', () => {
		const sections = [section([paragraph(1)]), section([paragraph(1)], {firstNumber: 1})]
		expect(
			plan(
				sections,
				sections.map((s) => measurer([{item: s.items[0], lines: [{top: 0, bottom: 20}]}])),
			).map((page) => page.number),
		).toEqual([1, 1])
	})

	test('refuses to lay out an absurd number of pages', {timeout: 60000}, () => {
		const fakes = Array.from({length: MAX_PAGES + 1}, () => paragraph(1, {breakBefore: 'page'}))
		expect(() => run(fakes)).toThrow(DocxError)
	})
})

describe('re-planning after an edit', () => {
	type Spec = {
		item: FlowItem
		lines?: Box[]
		rows?: Array<Box & {header: boolean}>
		notes?: Array<{y: number; id: string}>
	}
	type Doc = {sections: Array<Omit<PlanSection, 'items'> & {specs: Spec[]}>; noteHeights: Record<string, number>}

	const random = (seed: number) => {
		let state = seed
		const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
		return {
			next,
			int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
			chance: (p: number) => next() < p,
		}
	}

	const paragraphSpec = (heights: number[], before: number, after: number, flags: Partial<FlowItem>): Spec => {
		const lines = heights.map((_, i) => {
			const top = before + heights.slice(0, i).reduce((sum, h) => sum + h, 0)
			return {top, bottom: top + heights[i]}
		})
		const height = before + heights.reduce((sum, h) => sum + h, 0) + after
		return {item: {kind: 'paragraph', height, before, after, ...flags}, lines}
	}
	const tableSpec = (heights: number[], headers: number): Spec => {
		const rows = heights.map((_, i) => {
			const top = heights.slice(0, i).reduce((sum, h) => sum + h, 0)
			return {top, bottom: top + heights[i], header: i < headers}
		})
		return {item: {kind: 'table', height: heights.reduce((sum, h) => sum + h, 0), before: 0, after: 0}, rows}
	}

	function generate(seed: number): Doc {
		const r = random(seed)
		const noteHeights: Record<string, number> = {}
		const starts = ['nextPage', 'continuous', 'nextColumn', 'oddPage', 'evenPage'] as const
		const sections = Array.from({length: r.int(1, 3)}, (_, s) => {
			const base = r.int(120, 260)
			// Page heights that depend on the page, as a first page or even pages with taller headers do
			const parity = r.chance(0.4)
			const specs = Array.from({length: r.int(3, 30)}, (): Spec => {
				if (r.chance(0.2))
					return tableSpec(
						Array.from({length: r.int(1, 12)}, () => r.int(12, 40)),
						r.int(0, 2),
					)
				const heights = Array.from({length: r.int(1, 12)}, () => r.int(10, 24))
				const spec = paragraphSpec(heights, r.int(0, 12), r.int(0, 12), {
					keepNext: r.chance(0.15),
					keepLines: r.chance(0.1),
					widowControl: r.chance(0.5),
					breakBefore: r.chance(0.05) ? 'page' : r.chance(0.03) ? 'column' : undefined,
					pageBreakBefore: r.chance(0.04),
				})
				if (r.chance(0.12)) {
					spec.notes = Array.from({length: r.int(1, 2)}, () => {
						const id = `n${Object.keys(noteHeights).length}`
						noteHeights[id] = r.int(8, 40)
						const line = spec.lines![r.int(0, spec.lines!.length - 1)]
						return {y: (line.top + line.bottom) / 2, id}
					})
				}
				return spec
			})
			const columns = r.chance(0.25)
				? [
						{left: 0, width: 45},
						{left: 55, width: 45},
					]
				: [{left: 0, width: 100}]
			return {
				specs,
				columns,
				start: s === 0 ? 'nextPage' : starts[r.int(0, starts.length - 1)],
				firstNumber: r.chance(0.1) ? r.int(1, 4) : undefined,
				bodyHeight: (index: number, number: number) =>
					parity ? base - (index === 0 ? 30 : 0) - (number % 2 === 0 ? 20 : 0) : base,
				pageKey: r.chance(0.9) ? 'A4' : 'A3',
			}
		})
		return {sections, noteHeights}
	}

	// A wrap, a deleted line, a line taller or shorter, a row more or fewer, on one to three items
	function edit(doc: Doc, seed: number): {doc: Doc; edited: Set<string>} {
		const r = random(seed)
		const sections = doc.sections.map((section) => ({...section, specs: [...section.specs]}))
		const edited = new Set<string>()
		for (let n = r.int(1, 3); n > 0; n--) {
			const s = r.int(0, sections.length - 1)
			const i = r.int(0, sections[s].specs.length - 1)
			const spec = sections[s].specs[i]
			if (spec.rows) {
				const heights = spec.rows.map((row) => row.bottom - row.top)
				if (r.chance(0.5) || heights.length === 1) heights.push(r.int(12, 40))
				else heights.pop()
				sections[s].specs[i] = tableSpec(heights, spec.rows.filter((row) => row.header).length)
			} else {
				const heights = spec.lines!.map((line) => line.bottom - line.top)
				const choice = r.int(0, 2)
				if (choice === 0 || heights.length === 1) heights.push(heights.at(-1)!)
				else if (choice === 1) heights.pop()
				else heights[r.int(0, heights.length - 1)] += r.chance(0.5) ? 6 : -4
				const {before, after, keepNext, keepLines, widowControl, breakBefore, pageBreakBefore} = spec.item
				const next = paragraphSpec(heights, before, after, {
					keepNext,
					keepLines,
					widowControl,
					breakBefore,
					pageBreakBefore,
				})
				// Its notes stay on lines it still has
				next.notes = spec.notes?.map((note) => {
					const line =
						next.lines![
							Math.min(
								next.lines!.length - 1,
								spec.lines!.findIndex((old) => note.y < old.bottom),
							)
						]
					return {...note, y: (line.top + line.bottom) / 2}
				})
				sections[s].specs[i] = next
			}
			edited.add(`${s}:${i}`)
		}
		return {doc: {...doc, sections}, edited}
	}

	// Plans a document, noting which items' lines or rows the planner asked for (what a layout measures and keeps)
	function planOf(doc: Doc) {
		const asked = new Set<string>()
		const measurers: Measurer[] = doc.sections.map((section, s) => ({
			lines: (i) => (asked.add(`${s}:${i}`), section.specs[i].lines ?? []),
			rows: (i) => (asked.add(`${s}:${i}`), section.specs[i].rows ?? []),
			notes: (i) => section.specs[i].notes ?? [],
			noteHeight: (id) => doc.noteHeights[id] ?? 0,
			separatorHeight: () => 10,
		}))
		const pages = plan(
			doc.sections.map(({specs, ...section}) => ({...section, items: specs.map((spec) => spec.item)})),
			measurers,
		)
		return {pages, asked}
	}

	test('the pages it keeps and the pages it rebuilds make the whole new plan', {timeout: 60000}, () => {
		let rebuilt = 0
		let kept = 0
		for (let seed = 1; seed <= 400; seed++) {
			const doc = generate(seed)
			const before = planOf(doc)
			for (let round = 0; round < 3; round++) {
				const {doc: changed, edited} = edit(doc, seed * 7 + round)
				const after = planOf(changed)
				// Measured again: what was edited, and what the new plan asked about that the old one never did
				const whole = new Set([...edited, ...[...after.asked].filter((key) => !before.asked.has(key))])
				const {from, to, cut} = changes(before.pages, after.pages, whole)
				const shift = before.pages.length - after.pages.length
				const assembled = [
					...before.pages.slice(0, from),
					...after.pages.slice(from, to),
					...before.pages.slice(to + shift),
				]
				expect(JSON.stringify(assembled), `seed ${seed} round ${round}`).toBe(JSON.stringify(after.pages))
				// What's kept holds nothing that's cut again
				const keptPages = [...before.pages.slice(0, from), ...before.pages.slice(to + shift)]
				for (const page of keptPages)
					for (const piece of page.bands.flatMap((band) => band.columns.flat()))
						expect(cut.has(`${piece.section}:${piece.item}`), `seed ${seed} round ${round}`).toBe(false)
				for (const key of whole) expect(cut.has(key)).toBe(true)
				// …and everything whose parts moved is cut again
				const [old, next] = [before.pages, after.pages].map((pages) => {
					const parts = new Map<string, string>()
					for (const piece of pages.flatMap((page) => page.bands.flatMap((band) => band.columns.flat()))) {
						const key = `${piece.section}:${piece.item}`
						parts.set(key, `${parts.get(key) ?? ''} ${piece.from}-${piece.to}-${piece.drop}`)
					}
					return parts
				})
				for (const [key, parts] of next)
					if (old.get(key) !== parts) expect(cut.has(key), `seed ${seed} round ${round}`).toBe(true)
				rebuilt += to - from
				kept += keptPages.length
			}
		}
		// The point of it: most pages are kept
		expect(kept).toBeGreaterThan(rebuilt)
	})
})
