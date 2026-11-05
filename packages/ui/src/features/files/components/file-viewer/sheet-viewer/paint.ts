// Draws a sheet on a canvas, a frame at a time: the cells of each pane (the
// frozen rows and columns, and the scrolling rest), then the headers over
// them. A cell's text is laid out first, so text running into empty
// neighbours, as Excel lets it, hides the gridlines it crosses; then come the
// gridlines, fills, borders, text, and the selection over everything.
//
// Everything is placed in logical coordinates, left to right; a sheet that
// reads right to left (Arabic, Hebrew) is mirrored only as it's drawn, so
// column A sits at the right and text stays readable.

import type {Axis} from '@/features/files/components/file-viewer/sheet-viewer/axis'
import {columnName} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/package'
import type {
	BorderEdge,
	CellStyle,
	Fill,
	PatternType,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/styles'
import {APP_FONT, cellFont, fontMetrics, measure} from '@/features/files/components/file-viewer/sheet-viewer/fonts'
import {
	mergeAt,
	overlaps,
	sameRange,
	type Cell,
	type GridCell,
	type GridSource,
	type Range,
} from '@/features/files/components/file-viewer/sheet-viewer/model'

type Look = {
	background?: string
	grid: string
	frozen: string
	header: string
	headerText: string
	headerLine: string
	text: string
	selectedText: string
	tint: number // the selection's tint, as an opacity of the brand colour
}

const LOOKS: Record<GridSource['look'], Look> = {
	paper: {
		background: '#ffffff',
		grid: '#e4e4e7',
		frozen: '#b8b8c0',
		header: '#f4f4f5',
		headerText: '#71717a',
		headerLine: '#e4e4e7',
		text: '#000000',
		selectedText: '',
		tint: 0.1,
	},
	dark: {
		grid: 'rgba(255, 255, 255, 0.06)',
		frozen: 'rgba(255, 255, 255, 0.18)',
		header: 'rgba(255, 255, 255, 0.03)',
		headerText: 'rgba(255, 255, 255, 0.4)',
		headerLine: 'rgba(255, 255, 255, 0.06)',
		text: 'rgba(255, 255, 255, 0.85)',
		selectedText: 'rgba(255, 255, 255, 0.95)',
		tint: 0.16,
	},
}

const MATCH = 'rgba(255, 214, 10, 0.35)'
const CURRENT_MATCH = 'rgba(255, 149, 0, 0.55)'
// A CSV's cells, in the app's own type
export const DARK_FONT = `13px ${APP_FONT}`
export const DARK_BOLD = `600 13px ${APP_FONT}`
const HEADER_FONT = `11px ${APP_FONT}`
const PADDING = 3
// Excel indents by about three spaces of the default font per level
const INDENT = 9
// Text beyond what a cell could show is never laid out
const MAX_TEXT = 2000
// How far a cell's text may run over its empty neighbours
const OVERFLOW_COLUMNS = 32

export type View = {
	width: number
	height: number
	dpr: number
	headerWidth: number
	headerHeight: number
	// The frozen panes in force: none when they wouldn't leave room to scroll
	frozen: {rows: number; cols: number; width: number; height: number}
	scrollX: number
	scrollY: number
}

type Marks = {
	selection: Range // merges included
	active: Range // the active cell, or the merge it heads
	brand: string // the brand colour's hsl() components
	match: (row: number, col: number) => 0 | 1 | 2 // none, a match, the current match
	editing?: Cell
}

// A run of lines in view: the frozen ones, or those scrolled into view.
// Lines [first, last] show, each at offset + axis.start(i) within [from, to);
// the lane holds lines [min, max], which text can run over.
type Lane = {first: number; last: number; min: number; max: number; offset: number; from: number; to: number}

export function lanes(
	axis: Axis,
	frozen: number,
	frozenSize: number,
	header: number,
	scroll: number,
	extent: number,
): Lane[] {
	const result: Lane[] = []
	if (!axis.count) return result
	if (frozen > 0) {
		result.push({
			first: 0,
			last: frozen - 1,
			min: 0,
			max: frozen - 1,
			offset: header,
			from: header,
			to: header + frozenSize,
		})
	}
	const from = header + frozenSize
	if (frozen < axis.count && extent > from) {
		const start = frozenSize + scroll
		result.push({
			first: Math.max(frozen, axis.at(start)),
			last: axis.at(start + extent - from),
			min: frozen,
			max: axis.count - 1,
			offset: header - scroll,
			from,
			to: extent,
		})
	}
	return result
}

// Where the sheet ends along an axis: inside the stage when it's short (a CSV), where its header bands and frozen
// lines stop too
const sheetEnd = (lanes: Lane[], axis: Axis, header: number, extent: number) =>
	Math.min(extent, Math.max(header, ...lanes.map((lane) => lane.offset + axis.start(lane.max + 1))))

type Line = {i: number; at: number; size: number}

function visible(axis: Axis, lane: Lane): Line[] {
	const lines: Line[] = []
	for (let i = lane.first; i <= lane.last; i++) {
		const size = axis.size(i)
		if (size > 0) lines.push({i, at: lane.offset + axis.start(i), size})
	}
	return lines
}

export function paint(ctx: CanvasRenderingContext2D, view: View, source: GridSource, marks: Marks) {
	const look = LOOKS[source.look]
	ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
	ctx.clearRect(0, 0, view.width, view.height)
	if (look.background) {
		ctx.fillStyle = look.background
		ctx.fillRect(0, 0, view.width, view.height)
	}
	const rowLanes = lanes(
		source.rows,
		view.frozen.rows,
		view.frozen.height,
		view.headerHeight,
		view.scrollY,
		view.height,
	)
	const colLanes = lanes(source.cols, view.frozen.cols, view.frozen.width, view.headerWidth, view.scrollX, view.width)
	const flip = (x: number, w: number) => (source.rightToLeft ? view.width - x - w : x)
	for (const rowLane of rowLanes) {
		for (const colLane of colLanes) new Pane(ctx, view, source, marks, look, rowLane, colLane, flip).paint()
	}
	const sheet = {
		width: sheetEnd(colLanes, source.cols, view.headerWidth, view.width),
		height: sheetEnd(rowLanes, source.rows, view.headerHeight, view.height),
	}
	// The lines a frozen pane ends at, a shade stronger than the grid's
	ctx.fillStyle = look.frozen
	const line = 1 / Math.min(view.dpr, 2)
	if (view.frozen.height) {
		ctx.fillRect(flip(0, sheet.width), view.headerHeight + view.frozen.height - line, sheet.width, line)
	}
	if (view.frozen.width) {
		ctx.fillRect(flip(view.headerWidth + view.frozen.width - line, line), 0, line, sheet.height)
	}
	paintHeaders(ctx, view, source, marks, look, rowLanes, colLanes, flip, sheet)
}

type Box = {x: number; y: number; w: number; h: number}

// What a cell shows and how, resolved from its style (paper) or the CSV look
type Appearance = {
	font: string
	px: number
	color: string
	direction: 'ltr' | 'rtl'
	align: 'start' | 'center' | 'end' | 'fill'
	valign: 'top' | 'center' | 'bottom'
	wrap: boolean
	shrink: boolean
	indent: number
	rotation: number
	underline: CellStyle['font']['underline']
	strike: boolean
}

// Hebrew, Arabic, Syriac, Thaana and N'Ko, and Hebrew and Arabic presentation forms
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/

// The direction text reads in: as the cell says, or else as its first letter
// does (Excel's "context" reading order), or else as the sheet does
function directionOf(text: string | undefined, order: string, sheet: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
	if (order === 'ltr' || order === 'rtl') return order
	const letter = text?.match(/\p{L}/u)?.[0]
	return letter ? (RTL.test(letter) ? 'rtl' : 'ltr') : sheet
}

// How a cell is drawn, and what typing into it looks like
export function appearanceOf(source: GridSource, row: number, col: number, cell?: GridCell): Appearance {
	const sheet = source.rightToLeft ? 'rtl' : 'ltr'
	// The side text reading in a direction starts from, in the sheet's own terms
	const startOf = (direction: 'ltr' | 'rtl') => (direction === sheet ? 'start' : 'end')
	if (source.look === 'dark') {
		const bold = source.headerRow && row === 0
		const direction = directionOf(cell?.text, 'context', sheet)
		return {
			font: bold ? DARK_BOLD : DARK_FONT,
			px: 13,
			color: LOOKS.dark.text,
			direction,
			align: cell?.kind === 'n' && !bold ? 'end' : startOf(direction),
			valign: 'center',
			wrap: false,
			shrink: false,
			indent: 0,
			rotation: 0,
			underline: 'none',
			strike: false,
		}
	}
	const style = styleOf(source, row, col, cell)
	const {alignment, font} = style
	const {horizontal} = alignment
	const direction = directionOf(cell?.text, alignment.readingOrder, sheet)
	// Left and right are the cell's own sides; general puts text where it starts reading, numbers at the end
	const align: Appearance['align'] =
		horizontal === 'general'
			? cell?.kind === 'n'
				? 'end'
				: cell?.kind === 'b' || cell?.kind === 'e'
					? 'center'
					: startOf(direction)
			: horizontal === 'left' || horizontal === 'justify'
				? startOf('ltr')
				: horizontal === 'right'
					? startOf('rtl')
					: horizontal === 'fill'
						? 'fill'
						: 'center'
	return {
		font: cellFont(font),
		px: (font.size * 4) / 3,
		color: cell?.color ?? font.color ?? LOOKS.paper.text,
		direction,
		align,
		valign:
			alignment.vertical === 'top' || alignment.vertical === 'justify'
				? 'top'
				: alignment.vertical === 'bottom'
					? 'bottom'
					: 'center',
		wrap: alignment.wrap || horizontal === 'justify' || horizontal === 'distributed',
		shrink: alignment.shrink,
		indent: alignment.indent * INDENT,
		rotation: alignment.rotation,
		underline: font.underline,
		strike: font.strike,
	}
}

export function styleOf(source: GridSource, row: number, col: number, cell?: GridCell): CellStyle {
	const styles = source.styles!
	return styles[cell?.style ?? source.lineStyle(row, col)] ?? styles[0]
}

// A cell's text placed in its row: the box it belongs to (its own, or its
// merge's) and the span it may draw over
type Placed = {row: number; col: number; cell: GridCell; look: Appearance; box: Box; span: {x: number; w: number}}

class Pane {
	readonly #rows: Line[]
	readonly #cols: Line[]
	readonly #merges: Range[] = []
	readonly #range: Range | undefined
	// The columns looked through for text: those in view, and those either side whose text can run into it
	readonly #scan: {from: number; to: number}

	constructor(
		private ctx: CanvasRenderingContext2D,
		private view: View,
		private source: GridSource,
		private marks: Marks,
		private look: Look,
		private rowLane: Lane,
		private colLane: Lane,
		private flip: (x: number, w: number) => number,
	) {
		this.#rows = visible(source.rows, rowLane)
		this.#cols = visible(source.cols, colLane)
		this.#scan = {
			from: Math.max(colLane.min, colLane.first - OVERFLOW_COLUMNS),
			to: Math.min(colLane.max, colLane.last + OVERFLOW_COLUMNS),
		}
		if (!this.#rows.length || !this.#cols.length) return
		const range = {
			top: this.#rows[0].i,
			bottom: this.#rows.at(-1)!.i,
			left: this.#cols[0].i,
			right: this.#cols.at(-1)!.i,
		}
		this.#range = range
		// Those out of view too, so their cells are never taken for plain ones (the top-left's text running on over
		// the others) or for empty ones that text runs over
		const {from, to} = this.#scan
		const scanned = {top: range.top, bottom: range.bottom, left: from, right: to}
		this.#merges = source.merges.filter((merge) => overlaps(merge, scanned))
	}

	#x = (col: number) => this.colLane.offset + this.source.cols.start(col)
	#y = (row: number) => this.rowLane.offset + this.source.rows.start(row)
	#box = (range: Range): Box => {
		const x = this.#x(range.left)
		const y = this.#y(range.top)
		return {x, y, w: this.#x(range.right + 1) - x, h: this.#y(range.bottom + 1) - y}
	}

	paint() {
		const range = this.#range
		if (!range) return
		const {ctx, flip, colLane, rowLane} = this
		ctx.save()
		ctx.beginPath()
		ctx.rect(
			flip(colLane.from, colLane.to - colLane.from),
			rowLane.from,
			colLane.to - colLane.from,
			rowLane.to - rowLane.from,
		)
		ctx.clip()
		const {placed, covered} = this.#layout()
		this.#gridLines(covered)
		this.#fills()
		this.#borders()
		for (const item of placed) this.#text(item)
		this.#marks()
		ctx.restore()
	}

	// Where each visible row's text goes, and which gridlines between cells it covers
	#layout(): {placed: Placed[]; covered: Set<string>} {
		const {source} = this
		const placed: Placed[] = []
		const covered = new Set<string>()
		const seen = new Set<Range>()
		const lane = this.colLane
		const isEmpty = (row: number, col: number) => !source.cell(row, col)?.text && !mergeAt(this.#merges, row, col)
		// Only text whose span reaches the pane is drawn: the rest would be clipped away
		const reaches = ({x, w}: {x: number; w: number}) => x < lane.to && x + w > lane.from
		// Cells just out of view can run their text into it
		const {from, to} = this.#scan
		for (const {i: row} of this.#rows) {
			for (let col = from; col <= to; col++) {
				const merge = mergeAt(this.#merges, row, col)
				if (merge) {
					if (seen.has(merge) || col !== Math.max(merge.left, this.#cols[0].i)) continue
					seen.add(merge)
					const cell = source.cell(merge.top, merge.left)
					if (!cell?.text) continue
					const box = this.#box(merge)
					if (!reaches(box)) continue
					placed.push({
						row: merge.top,
						col: merge.left,
						cell,
						look: appearanceOf(source, merge.top, merge.left, cell),
						box,
						span: {x: box.x, w: box.w},
					})
					continue
				}
				const cell = source.cell(row, col)
				if (!cell?.text || source.cols.size(col) === 0) continue
				// Text runs over empty neighbours; a workbook's numbers never do (they show #### instead), but a CSV's
				// are text too, in columns the viewer sized and nobody can widen. Out of view, what can't run has
				// nothing to draw.
				const mayRun = cell.kind === 's' || source.look === 'dark'
				if (!mayRun && (col < lane.first || col > lane.last)) continue
				const look = appearanceOf(source, row, col, cell)
				const box = this.#box({top: row, left: col, bottom: row, right: col})
				const item: Placed = {row, col, cell, look, box, span: {x: box.x, w: box.w}}
				const runs = mayRun && !look.wrap && !look.shrink && look.align !== 'fill' && look.rotation === 0
				const width = runs ? textWidth(item) + 2 * PADDING + look.indent : 0
				if (runs && width > box.w) {
					let left = col
					let right = col
					let room = box.w
					const grow = (side: -1 | 1) => {
						const next = side < 0 ? left - 1 : right + 1
						if (next < lane.min || next > lane.max || !isEmpty(row, next)) return false
						if (side < 0) left = next
						else right = next
						room += source.cols.size(next)
						return true
					}
					if (look.align === 'start') while (room < width && grow(1));
					else if (look.align === 'end') while (room < width && grow(-1));
					else {
						let opened = true
						while (room < width && opened) opened = grow(-1) || grow(1)
					}
					const x = this.#x(left)
					item.span = {x, w: this.#x(right + 1) - x}
					for (let c = left; c < right; c++) covered.add(`${row}:${c}`)
				}
				if (reaches(item.span)) placed.push(item)
			}
		}
		return {placed, covered}
	}

	#gridLines(covered: Set<string>) {
		const {ctx, source, look, flip, view} = this
		if (!source.gridLines) return
		const line = 1 / Math.min(view.dpr, 2)
		ctx.fillStyle = look.grid
		const left = this.#cols[0].at
		const right = this.#cols.at(-1)!.at + this.#cols.at(-1)!.size
		for (const {i: row, at, size} of this.#rows) {
			// Under each row, except where a merge carries on below
			const y = at + size - line
			let x = left
			for (const {i: col, at: cx, size: cw} of this.#cols) {
				const merge = mergeAt(this.#merges, row, col)
				if (merge && merge.bottom > row) {
					if (cx > x) ctx.fillRect(flip(x, cx - x), y, cx - x, line)
					x = cx + cw
				}
			}
			if (right > x) ctx.fillRect(flip(x, right - x), y, right - x, line)
			// Between columns, except within a merge or under text running across
			for (const {i: col, at: cx, size: cw} of this.#cols) {
				if (covered.has(`${row}:${col}`)) continue
				const merge = mergeAt(this.#merges, row, col)
				if (merge && merge.right > col) continue
				ctx.fillRect(flip(cx + cw - line, line), at, line, size)
			}
		}
	}

	#fills() {
		const {source} = this
		if (source.look !== 'paper') return
		const seen = new Set<Range>()
		for (const {i: row} of this.#rows) {
			for (const {i: col} of this.#cols) {
				const merge = mergeAt(this.#merges, row, col)
				if (merge && seen.has(merge)) continue
				if (merge) seen.add(merge)
				const anchor = merge ? {row: merge.top, col: merge.left} : {row, col}
				const fill = styleOf(source, anchor.row, anchor.col, source.cell(anchor.row, anchor.col)).fill
				if (!fill) continue
				const box = this.#box(merge ?? {top: row, left: col, bottom: row, right: col})
				// Over the gridlines around it, as Excel fills
				this.#paintFill(fill, {x: box.x - 1, y: box.y - 1, w: box.w + 1, h: box.h + 1})
			}
		}
	}

	#paintFill(fill: Fill, box: Box) {
		const {ctx, flip} = this
		const x = flip(box.x, box.w)
		if (fill.type === 'gradient') {
			const angle = ((fill.gradient === 'path' ? 90 : fill.degree) * Math.PI) / 180
			const [cx, cy] = [x + box.w / 2, box.y + box.h / 2]
			const [dx, dy] = [(Math.cos(angle) * box.w) / 2, (Math.sin(angle) * box.h) / 2]
			const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
			for (const stop of fill.stops) gradient.addColorStop(stop.position, stop.color)
			ctx.fillStyle = gradient
			ctx.fillRect(x, box.y, box.w, box.h)
			return
		}
		// Patterns are drawn as the shade they make from a distance
		if (fill.pattern !== 'solid') {
			ctx.fillStyle = fill.background ?? '#ffffff'
			ctx.fillRect(x, box.y, box.w, box.h)
			ctx.globalAlpha = PATTERN_DENSITY[fill.pattern]
		}
		ctx.fillStyle = fill.color ?? '#000000'
		ctx.fillRect(x, box.y, box.w, box.h)
		ctx.globalAlpha = 1
	}

	#borders() {
		const {source} = this
		if (source.look !== 'paper') return
		for (const {i: row} of this.#rows) {
			for (const {i: col} of this.#cols) {
				const merge = mergeAt(this.#merges, row, col)
				const border = styleOf(source, row, col, source.cell(row, col)).border
				if (!border) continue
				const box = this.#box({top: row, left: col, bottom: row, right: col})
				// Within a merge, only the edges on its outline are drawn
				const edge = (side: 'top' | 'bottom' | 'left' | 'right') =>
					!merge ||
					(side === 'top'
						? row === merge.top
						: side === 'bottom'
							? row === merge.bottom
							: side === 'left'
								? col === merge.left
								: col === merge.right)
				if (border.top && edge('top')) this.#edge(border.top, box.x, box.y, box.w, true)
				if (border.bottom && edge('bottom')) this.#edge(border.bottom, box.x, box.y + box.h, box.w, true)
				if (border.left && edge('left')) this.#edge(border.left, box.x, box.y, box.h, false)
				if (border.right && edge('right')) this.#edge(border.right, box.x + box.w, box.y, box.h, false)
				if (border.diagonal && (border.diagonalDown || border.diagonalUp)) {
					const {ctx, flip} = this
					const x = flip(box.x, box.w)
					ctx.strokeStyle = border.diagonal.color ?? '#000000'
					ctx.lineWidth = BORDER_WIDTH[border.diagonal.style]
					ctx.setLineDash([])
					ctx.beginPath()
					if (border.diagonalDown) {
						ctx.moveTo(x, box.y)
						ctx.lineTo(x + box.w, box.y + box.h)
					}
					if (border.diagonalUp) {
						ctx.moveTo(x, box.y + box.h)
						ctx.lineTo(x + box.w, box.y)
					}
					ctx.stroke()
				}
			}
		}
	}

	// One side of a cell, centred on the line it runs along
	#edge(edge: BorderEdge, x: number, y: number, length: number, horizontal: boolean) {
		const {ctx, flip} = this
		const width = BORDER_WIDTH[edge.style]
		ctx.fillStyle = edge.color ?? '#000000'
		ctx.strokeStyle = ctx.fillStyle
		const offset = Math.ceil(width / 2)
		const dash = BORDER_DASH[edge.style]
		if (edge.style === 'double') {
			for (const shift of [-1, 1]) {
				if (horizontal) ctx.fillRect(flip(x, length), y + shift - 0.5, length, 1)
				else ctx.fillRect(flip(x + shift - 0.5, 1), y, 1, length)
			}
			return
		}
		if (!dash) {
			if (horizontal) ctx.fillRect(flip(x, length), y - offset, length, width)
			else ctx.fillRect(flip(x - offset, width), y, width, length)
			return
		}
		ctx.lineWidth = width
		ctx.setLineDash(dash)
		ctx.beginPath()
		const middle = width / 2 - offset
		if (horizontal) {
			const left = flip(x, length)
			ctx.moveTo(left, y + middle)
			ctx.lineTo(left + length, y + middle)
		} else {
			const at = flip(x + middle, 0)
			ctx.moveTo(at, y)
			ctx.lineTo(at, y + length)
		}
		ctx.stroke()
		ctx.setLineDash([])
	}

	#text(item: Placed) {
		const {ctx, flip, marks} = this
		const {cell, look, box, span} = item
		if (marks.editing && marks.editing.row === item.row && marks.editing.col === item.col) return
		const available = box.w - 2 * PADDING - look.indent
		let text = cell.text.length > MAX_TEXT ? cell.text.slice(0, MAX_TEXT) : cell.text
		let font = look.font
		let px = look.px
		ctx.fillStyle = look.color
		ctx.textBaseline = 'alphabetic'
		ctx.direction = look.direction

		// A workbook's number that doesn't fit: General shows fewer digits, other formats ####
		const width = measure(font, text)
		const paper = this.source.look === 'paper'
		if (paper && cell.kind === 'n' && !look.wrap && !look.shrink && look.rotation === 0 && width > available) {
			const shorter =
				cell.value !== undefined && /^general$/i.test(styleOf(this.source, item.row, item.col, cell).format)
					? fitGeneral(cell.value, font, available)
					: undefined
			if (shorter) text = shorter
			else return this.#repeat('#', box, look)
		}
		if (cell.fill && !look.wrap && look.rotation === 0) {
			if (cell.fill.index === 0 && cell.text === cell.fill.char) return this.#repeat(cell.fill.char, box, look)
			return this.#padded(cell, box, look)
		}
		if (look.align === 'fill') return this.#repeat(text, box, look)
		if (look.shrink && width > available && width > 0) {
			px = Math.max(1, (px * available) / width)
			font = font.replace(/[\d.]+px/, `${px}px`)
		}

		const needsClip = look.wrap || look.rotation !== 0 || measure(font, text) > span.w - 2 * PADDING
		if (needsClip) {
			ctx.save()
			ctx.beginPath()
			ctx.rect(flip(span.x, span.w), box.y, span.w, box.h)
			ctx.clip()
		}
		const {ascent, descent} = fontMetrics(font, px)
		const lineHeight = ascent + descent
		if (look.rotation !== 0) this.#rotated(text, font, box, look, ascent, descent)
		else if (look.wrap) {
			const lines = wrap(text, font, Math.max(available, 1))
			const height = lines.length * lineHeight
			const first =
				look.valign === 'top'
					? box.y + PADDING + ascent
					: look.valign === 'bottom'
						? box.y + box.h - PADDING - height + ascent
						: box.y + (box.h - height) / 2 + ascent
			lines.forEach((line, i) => this.#line(line, font, first + i * lineHeight, box, look))
		} else {
			const baseline =
				look.valign === 'top'
					? box.y + PADDING + ascent
					: look.valign === 'bottom'
						? box.y + box.h - PADDING - descent
						: box.y + (box.h - lineHeight) / 2 + ascent
			const runs = cell.runs && this.source.styles && cell.runs.length > 1 ? cell.runs : undefined
			if (runs) this.#runs(item, runs, baseline)
			else {
				const line = text.replace(/\r\n|\r|\n/g, ' ')
				// A CSV's number with no room to run into starts where text does, so what's cut is its end
				const start = !paper && cell.kind === 'n' && measure(font, line) > span.w - 2 * PADDING
				this.#line(line, font, baseline, {...box, x: span.x, w: span.w}, start ? {...look, align: 'start'} : look, box)
			}
		}
		if (needsClip) ctx.restore()
	}

	// A line of text, aligned within `area` (its overflow span); centred text
	// centres on its own cell, as Excel's does
	#line(text: string, font: string, baseline: number, area: Box, look: Appearance, own: Box = area) {
		const {ctx, flip} = this
		const width = measure(font, text)
		const x =
			look.align === 'end'
				? own.x + own.w - PADDING - look.indent - width
				: look.align === 'center'
					? own.x + (own.w - width) / 2
					: area.x + PADDING + look.indent
		ctx.font = font
		const left = flip(x, width)
		ctx.textAlign = 'left'
		ctx.fillText(text, left, baseline)
		this.#decorate(left, baseline, width, font, look)
	}

	#decorate(
		left: number,
		baseline: number,
		width: number,
		font: string,
		look: Pick<Appearance, 'underline' | 'strike' | 'px'>,
	) {
		const {ctx} = this
		if (look.underline === 'none' && !look.strike) return
		const thickness = Math.max(1, look.px / 14)
		if (look.underline !== 'none') {
			ctx.fillRect(left, baseline + thickness * 1.5, width, thickness)
			if (look.underline.startsWith('double')) ctx.fillRect(left, baseline + thickness * 3.5, width, thickness)
		}
		if (look.strike) ctx.fillRect(left, baseline - fontMetrics(font, look.px).ascent * 0.3, width, thickness)
	}

	// Rich text: each run in its own font, laid out on one line
	#runs(item: Placed, runs: NonNullable<GridCell['runs']>, baseline: number) {
		const {ctx, flip} = this
		const base = styleOf(this.source, item.row, item.col, item.cell).font
		const parts = runs.map((run) => {
			const font = {...base, ...run.font}
			const css = cellFont(font)
			const text = run.text.replace(/\r\n|\r|\n/g, ' ')
			return {text, css, font, width: measure(css, text)}
		})
		const total = parts.reduce((sum, part) => sum + part.width, 0)
		const {look, box, span} = item
		let x =
			look.align === 'end'
				? box.x + box.w - PADDING - look.indent - total
				: look.align === 'center'
					? box.x + (box.w - total) / 2
					: span.x + PADDING + look.indent
		for (const part of parts) {
			const left = flip(x, part.width)
			ctx.font = part.css
			ctx.fillStyle = item.cell.color ?? part.font.color ?? LOOKS.paper.text
			ctx.textAlign = 'left'
			ctx.fillText(part.text, left, baseline)
			this.#decorate(left, baseline, part.width, part.css, {
				underline: part.font.underline,
				strike: part.font.strike,
				px: (part.font.size * 4) / 3,
			})
			x += part.width
		}
	}

	#rotated(text: string, font: string, box: Box, look: Appearance, ascent: number, descent: number) {
		const {ctx, flip} = this
		ctx.font = font
		ctx.textAlign = 'center'
		const cx = flip(box.x, box.w) + box.w / 2
		const cy = box.y + box.h / 2
		if (look.rotation === 255) {
			// Stacked: one character under the next
			const chars = [...text]
			const step = ascent + descent
			chars.forEach((char, i) => ctx.fillText(char, cx, cy - (chars.length * step) / 2 + i * step + ascent))
			return
		}
		const degrees = look.rotation <= 90 ? look.rotation : 90 - look.rotation
		ctx.save()
		ctx.translate(cx, cy)
		ctx.rotate((-degrees * Math.PI) / 180)
		ctx.fillText(text.replace(/\r\n|\r|\n/g, ' '), 0, (ascent - descent) / 2)
		ctx.restore()
	}

	// A character repeated across the cell: #### for a number too wide, or a fill alignment
	#repeat(text: string, box: Box, look: Appearance) {
		const {ctx, flip} = this
		const unit = measure(look.font, text)
		if (unit <= 0) return
		const count = Math.max(1, Math.floor((box.w - 2 * PADDING) / unit))
		const line = text.repeat(count)
		ctx.font = look.font
		ctx.textAlign = 'left'
		const {descent} = fontMetrics(look.font, look.px)
		ctx.save()
		ctx.beginPath()
		ctx.rect(flip(box.x, box.w), box.y, box.w, box.h)
		ctx.clip()
		const width = measure(look.font, line)
		ctx.fillText(line, flip(box.x + (box.w - width) / 2, width), box.y + box.h - PADDING - descent)
		ctx.restore()
	}

	// A number format's fill (`* `): the text split where the fill goes, the
	// character repeated between — accounting's currency sign pinned left
	#padded(cell: GridCell, box: Box, look: Appearance) {
		const {ctx, flip} = this
		const {char, index} = cell.fill!
		const before = cell.text.slice(0, index)
		const after = cell.text.slice(index)
		const font = look.font
		const widths = [measure(font, before), measure(font, after), measure(font, char)]
		const room = box.w - 2 * PADDING - widths[0] - widths[1]
		if (room < 0) return this.#repeat('#', box, look)
		const fill = widths[2] > 0 ? char.repeat(Math.floor(room / widths[2])) : ''
		const {descent} = fontMetrics(font, look.px)
		const baseline = box.y + box.h - PADDING - descent
		ctx.font = font
		ctx.textAlign = 'left'
		ctx.fillText(before + fill, flip(box.x + PADDING, widths[0]), baseline)
		ctx.fillText(after, flip(box.x + box.w - PADDING - widths[1], widths[1]), baseline)
	}

	#marks() {
		const {ctx, marks, look, flip} = this
		// Matches of a find, over their cells
		for (const {i: row, at, size} of this.#rows) {
			for (const {i: col, at: x, size: w} of this.#cols) {
				const match = marks.match(row, col)
				if (!match) continue
				ctx.fillStyle = match === 2 ? CURRENT_MATCH : MATCH
				ctx.fillRect(flip(x, w), at, w, size)
			}
		}
		const clamp = (box: Box): Box => {
			// A selection of a million rows still draws as a rectangle just past the pane
			const top = Math.max(box.y, this.rowLane.from - 4)
			const bottom = Math.min(box.y + box.h, this.rowLane.to + 4)
			const left = Math.max(box.x, this.colLane.from - 4)
			const right = Math.min(box.x + box.w, this.colLane.to + 4)
			return {x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top)}
		}
		const selection = clamp(this.#box(marks.selection))
		const active = clamp(this.#box(marks.active))
		const brand = (alpha = 1) => `hsl(${marks.brand} / ${alpha})`
		if (!sameRange(marks.selection, marks.active)) {
			ctx.fillStyle = brand(look.tint)
			ctx.beginPath()
			ctx.rect(flip(selection.x, selection.w), selection.y, selection.w, selection.h)
			ctx.rect(flip(active.x, active.w), active.y, active.w, active.h)
			ctx.fill('evenodd')
		}
		ctx.strokeStyle = brand()
		ctx.lineWidth = 2
		ctx.setLineDash([])
		ctx.strokeRect(flip(selection.x, selection.w), selection.y, selection.w, selection.h)
	}
}

const PATTERN_DENSITY: Record<Exclude<PatternType, 'solid'>, number> = {
	gray125: 0.125,
	gray0625: 0.0625,
	lightGray: 0.25,
	mediumGray: 0.5,
	darkGray: 0.75,
	lightHorizontal: 0.25,
	lightVertical: 0.25,
	lightDown: 0.25,
	lightUp: 0.25,
	lightGrid: 0.4,
	lightTrellis: 0.4,
	darkHorizontal: 0.5,
	darkVertical: 0.5,
	darkDown: 0.5,
	darkUp: 0.5,
	darkGrid: 0.6,
	darkTrellis: 0.6,
}

const BORDER_WIDTH: Record<BorderEdge['style'], number> = {
	hair: 1,
	thin: 1,
	dotted: 1,
	dashed: 1,
	dashDot: 1,
	dashDotDot: 1,
	medium: 2,
	mediumDashed: 2,
	mediumDashDot: 2,
	mediumDashDotDot: 2,
	slantDashDot: 2,
	thick: 3,
	double: 3,
}

const BORDER_DASH: Partial<Record<BorderEdge['style'], number[]>> = {
	hair: [1, 1],
	dotted: [1, 1],
	dashed: [3, 1],
	dashDot: [5, 1, 1, 1],
	dashDotDot: [5, 1, 1, 1, 1, 1],
	mediumDashed: [6, 2],
	mediumDashDot: [6, 2, 2, 2],
	mediumDashDotDot: [6, 2, 2, 2, 2, 2],
	slantDashDot: [6, 2, 2, 2],
}

function textWidth({cell, look}: Placed): number {
	const text = cell.text.length > MAX_TEXT ? cell.text.slice(0, MAX_TEXT) : cell.text
	return measure(look.font, text.replace(/\r\n|\r|\n/g, ' '))
}

// Lines of text that fit a width: at spaces where possible, else mid-word
export function wrap(text: string, font: string, width: number): string[] {
	const lines: string[] = []
	for (const paragraph of text.split(/\r\n|\r|\n/)) {
		let line = ''
		for (const word of paragraph.split(/(?<=\s)/)) {
			if (measure(font, line + word) <= width || !line) {
				line += word
			} else {
				lines.push(line.trimEnd())
				line = word
			}
			// A word longer than the line is broken where it must be
			while (measure(font, line) > width && line.length > 1) {
				let fit = line.length - 1
				while (fit > 1 && measure(font, line.slice(0, fit)) > width) fit--
				lines.push(line.slice(0, fit))
				line = line.slice(fit)
			}
		}
		lines.push(line.trimEnd())
	}
	return lines
}

// General in a column too narrow for it, as Excel shows it: fewer decimals,
// then scientific notation, then nothing (####)
function fitGeneral(value: number, font: string, available: number): string | undefined {
	const key = `${font}|${value}|${available}`
	if (fitted.has(key)) return fitted.get(key)
	// Past what a screen of numbers needs (scrolling through a big file), it starts again
	if (fitted.size >= 10_000) fitted.clear()
	const text = shortestGeneral(value, font, available)
	fitted.set(key, text)
	return text
}

// What fitGeneral found, by font, value and room: a frame asks again for every cell the last one drew. Measured in a
// face that arrived since, they'd be wrong, so they go when fonts.ts' measurements do.
const fitted = new Map<string, string | undefined>()
if (typeof document !== 'undefined' && 'fonts' in document) {
	document.fonts.addEventListener('loadingdone', () => fitted.clear())
}

// The value with as many digits as fit, fixed then in exponent form, each measured until one does
function shortestGeneral(value: number, font: string, available: number): string | undefined {
	const fits = (text: string) => measure(font, text) <= available
	if (Math.abs(value) < 1e11) {
		for (let decimals = 9; decimals >= 0; decimals--) {
			const fixed = value
				.toFixed(decimals)
				.replace(/(\.\d*?)0+$/, '$1')
				.replace(/\.$/, '')
			const text = fixed !== '0' && fixed !== '-0' ? fixed : value === 0 ? '0' : undefined
			if (text !== undefined && fits(text)) return text
		}
	}
	for (let digits = 5; digits >= 0; digits--) {
		const [mantissa, exponent] = value.toExponential(digits).split('e')
		const sign = exponent.startsWith('-') ? '-' : '+'
		const text = `${mantissa.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}E${sign}${exponent.replace(/^[+-]/, '').padStart(2, '0')}`
		if (fits(text)) return text
	}
	return undefined
}

function paintHeaders(
	ctx: CanvasRenderingContext2D,
	view: View,
	source: GridSource,
	marks: Marks,
	look: Look,
	rowLanes: Lane[],
	colLanes: Lane[],
	flip: (x: number, w: number) => number,
	// Where the sheet ends, which the bands do too
	{width, height}: {width: number; height: number},
) {
	const {headerWidth: hw, headerHeight: hh} = view
	const line = 1 / Math.min(view.dpr, 2)
	const brand = (alpha = 1) => `hsl(${marks.brand} / ${alpha})`
	const {selection} = marks
	ctx.fillStyle = look.header
	ctx.fillRect(flip(0, width), 0, width, hh)
	ctx.fillRect(flip(0, hw), hh, hw, height - hh)
	ctx.font = HEADER_FONT
	ctx.textBaseline = 'middle'
	ctx.textAlign = 'center'

	for (const lane of colLanes) {
		ctx.save()
		ctx.beginPath()
		ctx.rect(flip(lane.from, lane.to - lane.from), 0, lane.to - lane.from, hh)
		ctx.clip()
		for (const {i, at, size} of visible(source.cols, lane)) {
			const selected = i >= selection.left && i <= selection.right
			const x = flip(at, size)
			if (selected) {
				ctx.fillStyle = brand(look.tint * 1.2)
				ctx.fillRect(x, 0, size, hh)
				ctx.fillStyle = brand()
				ctx.fillRect(x, hh - 2, size, 2)
			}
			ctx.fillStyle = selected ? look.selectedText || brand() : look.headerText
			ctx.fillText(columnName(i), x + size / 2, hh / 2 + 0.5)
			ctx.fillStyle = look.headerLine
			ctx.fillRect(flip(at + size - line, line), 0, line, hh)
		}
		ctx.restore()
	}
	for (const lane of rowLanes) {
		ctx.save()
		ctx.beginPath()
		ctx.rect(flip(0, hw), lane.from, hw, lane.to - lane.from)
		ctx.clip()
		for (const {i, at, size} of visible(source.rows, lane)) {
			const selected = i >= selection.top && i <= selection.bottom
			if (selected) {
				ctx.fillStyle = brand(look.tint * 1.2)
				ctx.fillRect(flip(0, hw), at, hw, size)
				ctx.fillStyle = brand()
				ctx.fillRect(flip(hw - 2, 2), at, 2, size)
			}
			ctx.fillStyle = selected ? look.selectedText || brand() : look.headerText
			ctx.fillText(String(i + 1), flip(0, hw) + hw / 2, at + size / 2 + 0.5)
			ctx.fillStyle = look.headerLine
			ctx.fillRect(flip(0, hw), at + size - line, hw, line)
		}
		ctx.restore()
	}
	// The bands' edges, and the corner they meet in
	ctx.fillStyle = look.headerLine
	ctx.fillRect(flip(0, width), hh - line, width, line)
	ctx.fillRect(flip(hw - line, line), 0, line, height)
}
