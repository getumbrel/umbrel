// Pagination as arithmetic: given each block's measured height (and, on demand, its line or row boxes), decide what
// goes on which page and column. It never touches the DOM, so the rules (widow and orphan control, keep with next,
// repeated table headers, footnote space, column balancing) are tested without a browser.

import {DocxError} from './package'

export type Box = {top: number; bottom: number}

export type FlowItem = {
	kind: 'paragraph' | 'table'
	// Border-box height, including the space before and after
	height: number
	// The space before, dropped at the top of a page or column that began because the previous one was full
	before: number
	// The space after, which may hang below the bottom of the page
	after: number
	breakBefore?: 'page' | 'column'
	pageBreakBefore?: boolean
	keepNext?: boolean
	keepLines?: boolean
	widowControl?: boolean
}

export interface Measurer {
	// Line boxes of a paragraph from its border-box top
	lines(index: number): Box[]
	// Rows of a table from its border-box top, and whether each repeats as a header
	rows(index: number): Array<Box & {header: boolean}>
	// Footnotes an item references, at their position from its top
	notes(index: number): Array<{y: number; id: string}>
	noteHeight(id: string): number
	separatorHeight(): number
}

export type PlanSection = {
	items: FlowItem[]
	columns: Array<{left: number; width: number}>
	start: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn'
	firstNumber?: number
	// The body's height on a page of this section, by the page's index in the section and its number
	bodyHeight: (index: number, number: number) => number
	// Pages of different sizes can't share a page
	pageKey: string
}

// Part of an item placed in a column: lines (or rows) [from, to), `to` undefined meaning to the end, and `drop` the
// space before left out at the top of a page. A section starting in the next column shares its band with the one
// before, so each piece says which section's item it is.
export type Piece = {
	section: number
	item: number
	from: number
	to?: number
	drop: number
	height: number
	notes: string[]
}

export type PlannedBand = {section: number; top: number; height: number; columns: Piece[][]}

export type PlannedPage = {
	section: number
	number: number
	index: number
	bands: PlannedBand[]
	notes: string[]
	// Left empty so the next section starts on an odd or even page
	blank?: boolean
}

// A safety net against documents that would lay out to absurd lengths
export const MAX_PAGES = 20000
const EPSILON = 0.5

export function plan(sections: PlanSection[], measures: Measurer[]): PlannedPage[] {
	const pages: PlannedPage[] = []
	let page!: PlannedPage
	let band!: PlannedBand
	let column = 0
	let y = 0
	// Whether the current column began because the previous one filled up, which drops the next item's space before
	let natural = false
	let sectionIndex = 0
	let indexInSection = 0
	let section = sections[0]
	let measure = measures[0]
	let notesHeight = 0

	const newPage = (number?: number) => {
		if (pages.length >= MAX_PAGES) throw new DocxError('limits', 'The document is too long to display')
		const next = number ?? (page ? page.number + 1 : 1)
		page = {section: sectionIndex, number: next, index: indexInSection++, bands: [], notes: []}
		pages.push(page)
		band = {
			section: sectionIndex,
			top: 0,
			height: section.bodyHeight(page.index, page.number),
			columns: section.columns.map(() => []),
		}
		page.bands.push(band)
		column = 0
		y = 0
		notesHeight = 0
	}

	const nextColumn = () => {
		if (column + 1 < band.columns.length) {
			column++
			y = 0
		} else newPage()
		natural = true
	}

	const capacity = () => band.height - notesHeight

	// The footnotes a part [from, to) of an item references that aren't on this page yet, and the height they add
	const pendingNotes = (index: number, item: FlowItem, from: number, to: number | undefined) => {
		const notes = measure.notes(index)
		if (!notes.length) return {ids: [] as string[], height: 0}
		const boxes = item.kind === 'paragraph' ? measure.lines(index) : measure.rows(index)
		const position = (at: number) => {
			const found = boxes.findIndex((box) => at < box.bottom)
			return found < 0 ? boxes.length - 1 : found
		}
		const ids = notes
			.filter(
				(note) =>
					position(note.y) >= from && (to === undefined || position(note.y) < to) && !page.notes.includes(note.id),
			)
			.map((note) => note.id)
		const height = ids.reduce((sum, id) => sum + measure.noteHeight(id), 0)
		return {ids, height: height && !page.notes.length ? height + measure.separatorHeight() : height}
	}

	const commit = (piece: Omit<Piece, 'notes' | 'section'>, notes: {ids: string[]; height: number}) => {
		band.columns[column].push({...piece, section: sectionIndex, notes: notes.ids})
		y += piece.height
		page.notes.push(...notes.ids)
		notesHeight += notes.height
	}

	// Pieces at the end of the column that must move with an item that no longer fits: its keep-with-next chain,
	// unless that chain fills the whole column (then Word lets it break)
	const withdrawKept = (): Piece[] => {
		const pieces = band.columns[column]
		let start = pieces.length
		while (start > 0) {
			const piece = pieces[start - 1]
			const kept = piece.section === sectionIndex && section.items[piece.item].keepNext
			if (!kept || piece.from !== 0 || piece.to !== undefined) break
			start--
		}
		if (start === 0 || start === pieces.length) return []
		const kept = pieces.splice(start)
		for (const piece of kept) y -= piece.height
		const withdrawn = new Set(kept.flatMap((piece) => piece.notes))
		if (withdrawn.size) {
			page.notes = page.notes.filter((id) => !withdrawn.has(id))
			notesHeight = page.notes.reduce((sum, id) => sum + measure.noteHeight(id), 0)
			if (notesHeight) notesHeight += measure.separatorHeight()
		}
		return kept
	}

	const placeItem = (index: number) => {
		const item = section.items[index]
		if (item.breakBefore === 'page' || (item.pageBreakBefore && (y > 0 || column > 0))) {
			newPage()
			natural = false
		} else if (item.breakBefore === 'column') {
			nextColumn()
			natural = false
		}
		// The line (or row) the part to place starts at, and where that is in the item
		let from = 0
		let offset = 0
		for (;;) {
			const atTop = y === 0
			const drop = from === 0 && atTop && natural ? item.before : 0
			const top = offset + drop
			const header = item.kind === 'table' && from > 0 ? headerHeight(measure.rows(index)) : 0
			const remaining = capacity() - y
			const whole = pendingNotes(index, item, from, undefined)
			if (item.height - item.after - top + header <= remaining - whole.height + EPSILON) {
				commit({item: index, from, drop, height: item.height - top + header}, whole)
				natural = false
				return
			}
			const split =
				item.kind === 'paragraph'
					? splitLines(index, item, from, top, remaining, atTop)
					: splitRows(index, item, from, top, header, remaining)
			if (split) {
				commit(
					{item: index, from, to: split.to, drop, height: split.end - top + header},
					pendingNotes(index, item, from, split.to),
				)
				from = split.to
				offset = split.end
				nextColumn()
				continue
			}
			if (!atTop) {
				// Nothing of it fits here: it moves to the next column, taking along what must stay with it
				const kept = from === 0 ? withdrawKept() : []
				nextColumn()
				for (const piece of kept) placeItem(piece.item)
				continue
			}
			// Not even an empty column takes its first line or row: it goes in anyway, cut off at the bottom
			const boxes = item.kind === 'paragraph' ? measure.lines(index) : measure.rows(index)
			if (from + 1 >= boxes.length) {
				commit({item: index, from, drop, height: item.height - top + header}, whole)
				natural = false
				return
			}
			const end = boundary(boxes, from + 1, item.height)
			commit(
				{item: index, from, to: from + 1, drop, height: end - top + header},
				pendingNotes(index, item, from, from + 1),
			)
			from += 1
			offset = end
			nextColumn()
		}
	}

	// Where a part [from, …) of a paragraph can end and still fit: at a line's bottom, keeping its lines together
	// when asked, and with widow and orphan control (never a single line left alone on either side of the break)
	const splitLines = (index: number, item: FlowItem, from: number, top: number, remaining: number, atTop: boolean) => {
		if (item.keepLines && !atTop) return undefined
		const lines = measure.lines(index)
		let fit = from
		for (let k = from + 1; k < lines.length; k++) {
			if (boundary(lines, k, item.height) - top + pendingNotes(index, item, from, k).height > remaining + EPSILON) break
			fit = k
		}
		if (item.widowControl) {
			if (lines.length - fit === 1) fit--
			if (!atTop && fit - from < 2) return undefined
		}
		return fit > from ? {to: fit, end: boundary(lines, fit, item.height)} : undefined
	}

	// Tables break between rows, and a part that continues one repeats its header rows
	const splitRows = (index: number, item: FlowItem, from: number, top: number, header: number, remaining: number) => {
		const rows = measure.rows(index)
		let fit = from
		for (let k = from + 1; k < rows.length; k++) {
			if (
				boundary(rows, k, item.height) - top + header + pendingNotes(index, item, from, k).height >
				remaining + EPSILON
			)
				break
			fit = k
		}
		// Header rows alone at the bottom of a page help nobody
		if (fit === from || (from === 0 && rows.slice(0, fit).every((row) => row.header))) return undefined
		return {to: fit, end: boundary(rows, fit, item.height)}
	}

	// Before a continuous section break Word evens out the columns of what's above it
	const balance = () => {
		const pieces = band.columns.flat()
		if (band.columns.length < 2 || !pieces.length) return
		const total = pieces.reduce((sum, piece) => sum + piece.height, 0)
		const tallest = Math.max(...pieces.map((piece) => piece.height))
		for (let height = Math.max(total / band.columns.length, tallest); height <= band.height + EPSILON; height += 1) {
			const columns = distribute(pieces, band.columns.length, height)
			if (columns) {
				band.columns = columns
				return
			}
		}
	}

	for (; sectionIndex < sections.length; sectionIndex++) {
		const previous = section
		section = sections[sectionIndex]
		measure = measures[sectionIndex]
		indexInSection = 0
		if (!page) newPage(section.firstNumber ?? 1)
		else if (section.start === 'continuous' && section.pageKey === previous.pageKey) {
			balance()
			const used = Math.max(0, ...band.columns.map((pieces) => pieces.reduce((sum, piece) => sum + piece.height, 0)))
			const top = band.top + used
			const height = section.bodyHeight(page.index, page.number)
			if (top < height - 1) {
				band = {section: sectionIndex, top, height: height - top, columns: section.columns.map(() => [])}
				page.bands.push(band)
				column = 0
				y = 0
				// The page carries on, and counts as this section's first
				indexInSection = 1
			} else newPage(section.firstNumber)
		} else if (
			section.start === 'nextColumn' &&
			section.pageKey === previous.pageKey &&
			section.columns.length === band.columns.length
		) {
			nextColumn()
		} else {
			newPage(section.firstNumber)
			const parity = section.start === 'evenPage' ? 0 : section.start === 'oddPage' ? 1 : undefined
			if (parity !== undefined && page.number % 2 !== parity) {
				page.blank = true
				newPage()
			}
		}
		natural = false
		for (let index = 0; index < section.items.length; index++) placeItem(index)
	}
	return pages
}

// The pages a new plan changes, as [from, to) in it, and the items whose parts must be cut again: those measured again
// since the old plan (`whole`, as section:item) and those whose parts moved. Pages before `from`, and from `to` on
// (the old plan's from `to` plus however many pages it had more), are the same in both plans and hold none of them.
export function changes(
	old: PlannedPage[],
	next: PlannedPage[],
	whole: ReadonlySet<string>,
): {from: number; to: number; cut: Set<string>} {
	const partsOf = (pages: PlannedPage[]) => {
		const parts = new Map<string, Array<{page: number; lines: string}>>()
		pages.forEach((page, index) => {
			for (const piece of page.bands.flatMap((band) => band.columns.flat())) {
				const key = `${piece.section}:${piece.item}`
				parts.set(key, [...(parts.get(key) ?? []), {page: index, lines: `${piece.from}-${piece.to}-${piece.drop}`}])
			}
		})
		return parts
	}
	const before = partsOf(old)
	const after = partsOf(next)
	const lines = (parts: Array<{lines: string}> | undefined) => parts?.map((part) => part.lines).join(' ')
	const cut = new Set(whole)
	for (const key of new Set([...before.keys(), ...after.keys()]))
		if (lines(before.get(key)) !== lines(after.get(key))) cut.add(key)
	// A page that's the same in both plans (its number too) shows the same, wherever it ends up
	const same = (a: PlannedPage | undefined, b: PlannedPage) =>
		a !== undefined && JSON.stringify(a) === JSON.stringify(b)
	const shift = old.length - next.length
	let from = 0
	while (from < next.length && same(old[from], next[from])) from++
	let to = next.length
	while (to > from && to - 1 + shift >= from && same(old[to - 1 + shift], next[to - 1])) to--
	for (const key of cut) {
		for (const {page} of before.get(key) ?? []) [from, to] = [Math.min(from, page), Math.max(to, page - shift + 1)]
		for (const {page} of after.get(key) ?? []) [from, to] = [Math.min(from, page), Math.max(to, page + 1)]
	}
	return {from, to, cut}
}

// Where a part ending before line (or row) k stops: midway between it and the one before, since line boxes touch
// but their measured glyph boxes don't
export function boundary(boxes: Box[], k: number, height: number): number {
	if (k >= boxes.length) return height
	if (k <= 0) return 0
	return (boxes[k - 1].bottom + boxes[k].top) / 2
}

function headerHeight(rows: Array<Box & {header: boolean}>): number {
	let end = 0
	while (end < rows.length && rows[end].header) end++
	return end ? boundary(rows, end, rows[end - 1].bottom) - rows[0].top : 0
}

// Fills `count` columns no taller than `height` with whole pieces in order, or says it can't
function distribute(pieces: Piece[], count: number, height: number): Piece[][] | undefined {
	const columns: Piece[][] = [[]]
	let y = 0
	for (const piece of pieces) {
		if (y + piece.height > height + EPSILON && columns[columns.length - 1].length) {
			if (columns.length === count) return undefined
			columns.push([])
			y = 0
		}
		columns[columns.length - 1].push(piece)
		y += piece.height
	}
	while (columns.length < count) columns.push([])
	return columns
}
