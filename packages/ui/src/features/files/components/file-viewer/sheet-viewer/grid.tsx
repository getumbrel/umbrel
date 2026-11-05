import {ExternalLink} from 'lucide-react'
import {
	useEffect,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from 'react'
import {useTranslation} from 'react-i18next'

import {ContextMenu, ContextMenuContent, ContextMenuTrigger} from '@/components/ui/context-menu'
import {toast} from '@/components/ui/toast'
import {fromTsv, toHtml, toTsv} from '@/features/files/components/file-viewer/sheet-viewer/clipboard'
import {rangeName, refName} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/package'
import {measure} from '@/features/files/components/file-viewer/sheet-viewer/fonts'
import {
	areaAt,
	mergeAt,
	overlaps,
	rangeOf,
	sameRange,
	selectionRange,
	step,
	visibleLine,
	withMerges,
	type Cell,
	type Edge,
	type GridSource,
	type Range,
	type Selection,
} from '@/features/files/components/file-viewer/sheet-viewer/model'
import {
	appearanceOf,
	lanes,
	paint,
	styleOf,
	wrap,
	type View,
} from '@/features/files/components/file-viewer/sheet-viewer/paint'
import {floatingGlassClass, floatingMenuClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {cn} from '@/lib/utils'

const HEADER_HEIGHT = 24
// Browsers cap how tall an element can be: a taller sheet scrolls a scaled spacer
const MAX_SPACER = 8_000_000
// Frozen panes that would fill most of the stage are let go, leaving room to scroll
const MAX_FROZEN = 0.6
const EDITOR_PADDING = 3
// The editor's ring (ring-2), drawn outside it
const EDITOR_RING = 2
// Between the active cell and its link's chip
const CHIP_GAP = 4
// Cells a copy may take: the text is held two or three times over as it's put together
const MAX_COPY_CELLS = {desktop: 10_000_000, touch: 1_000_000}

// A cell being typed into. `replace` when typing over it started it: the
// arrows then commit and move, as in Excel. `caret` places the caret once.
export type Editing = {cell: Cell; draft: string; original: string; replace: boolean; error?: string; caret?: number}

// What a right-click or a long press landed on
export type MenuTarget = {zone: 'row' | 'col' | 'cell'; selection: Range}

type GridProps = {
	source: GridSource
	label: string
	selection: Selection
	// The viewer moves an anchor in a merge to the merge's top-left, which names it and takes what's typed
	onSelect: (selection: Selection) => void
	interactive: boolean // opened, not quick-looked: the grid takes the keyboard
	editable: boolean
	locked: (row: number, col: number) => boolean
	// A locked cell turned away from typing, Enter, F2, a double click or a double tap, for the viewer to say why
	onRefused: (cell: Cell) => void
	// The data's own extent, which End and copying whole rows stop at
	data: {rows: number; cols: number}
	editing: Editing | undefined
	onEdit: (editing: Editing | undefined) => void
	// Writes what's being typed, and resolves to whether it was: a formula that doesn't parse stays open
	onCommit: (move: {rows: number; cols: number}) => Promise<boolean>
	match: (row: number, col: number) => 0 | 1 | 2
	onClear: (range: Range) => void
	onUndo: () => void
	onRedo: () => void
	onEdge: (from: Cell, direction: Edge) => Promise<Cell>
	texts: (range: Range) => string[][] | undefined
	fetchTexts: (range: Range) => Promise<string[][]>
	onPaste: (rows: string[][]) => void
	menu: (target: MenuTarget) => ReactNode
	// Room under the last row for what floats over the grid's bottom
	bottomInset: number
	// The view moves to the active cell whenever this changes
	revealKey: number
	onPainted: () => void
	// Set to a function that gives the grid the keyboard
	focusRef: {current: (() => void) | null}
	// ⌥↓ and ⌥↑ (Alt in Windows), as in Google Sheets: the next sheet or the one before, in a workbook
	onSheetStep?: (by: 1 | -1) => void
	// The active cell's link, followed from a chip that rides on the cell
	link?: {label: string; open: () => void}
}

export function Grid(props: GridProps) {
	const {source, selection, editing, interactive, editable, bottomInset} = props
	const {t} = useTranslation()
	const isTouch = useIsTouchDevice()
	const containerRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<HTMLTextAreaElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const handleRef = useRef<HTMLDivElement>(null)
	const chipRef = useRef<HTMLButtonElement>(null)
	const [size, setSize] = useState({width: 0, height: 0})
	// Device pixels per pixel, which change when the window moves to another display
	const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
	const [menuTarget, setMenuTarget] = useState<MenuTarget>()
	// Event handlers and frames read the props they were last rendered with
	const latest = useRef(props)
	const frame = useRef(0)
	const painted = useRef(false)
	// What the last frame drew, as keyOf gives it
	const drawn = useRef<unknown[]>([])
	// A press being dragged: `offset` moves the pointer to the point that's dragged (the handle's cell, not its corner)
	const drag = useRef<{
		zone: 'cell' | 'row' | 'col'
		pointing: boolean
		pointer: {x: number; y: number}
		offset: {x: number; y: number}
		timer: number
	}>(undefined)
	// The reference a press put into the formula being typed, and the text around it: a drag stretches it into a
	// range, and another press puts another in its place, until anything else is typed or the edit ends
	const reference = useRef<{before: string; text: string; after: string; from: Cell}>(undefined)
	// Set by a tap that put a reference in, so the touch it ends doesn't take the keyboard from the field
	const keepTyping = useRef(false)
	const press = useRef<{x: number; y: number; time: number}>(undefined)
	const lastTap = useRef<{time: number; cell: Cell}>(undefined)
	const fetchedCopy = useRef<{key: string; rows: string[][]}>(undefined)
	const editStarted = useRef(0)
	// Where the last press was: a long press opens the menu there
	const pressedAt = useRef<{clientX: number; clientY: number}>(undefined)

	const rtl = source.rightToLeft
	const headerWidth = Math.max(36, String(source.rows.count).length * 7 + 18)
	const contentHeight = HEADER_HEIGHT + source.rows.total + bottomInset
	const spacerHeight = Math.min(contentHeight, MAX_SPACER)
	// Logical pixels per pixel scrolled, once the spacer is capped
	const ratio =
		spacerHeight < contentHeight && size.height > 0
			? (contentHeight - size.height) / Math.max(1, spacerHeight - size.height)
			: 1

	const view = (): View => {
		const scroller = scrollerRef.current
		const {frozen, rows, cols} = latest.current.source
		const frozenWidth = cols.start(frozen.cols)
		const frozenHeight = rows.start(frozen.rows)
		const keepCols = frozenWidth <= (size.width - headerWidth) * MAX_FROZEN
		const keepRows = frozenHeight <= (size.height - HEADER_HEIGHT) * MAX_FROZEN
		const snap = (n: number) => Math.round(n * dpr) / dpr
		return {
			width: size.width,
			height: size.height,
			dpr,
			headerWidth,
			headerHeight: HEADER_HEIGHT,
			frozen: {
				rows: keepRows ? frozen.rows : 0,
				cols: keepCols ? frozen.cols : 0,
				width: keepCols ? frozenWidth : 0,
				height: keepRows ? frozenHeight : 0,
			},
			scrollX: snap(scroller ? Math.abs(scroller.scrollLeft) : 0),
			scrollY: snap(scroller ? scroller.scrollTop * ratio : 0),
		}
	}

	// What's under a point: a cell, or a header
	const hit = (clientX: number, clientY: number) => {
		const bounds = containerRef.current!.getBoundingClientRect()
		const v = view()
		const x = rtl ? bounds.right - clientX : clientX - bounds.left
		const y = clientY - bounds.top
		const {rows, cols} = latest.current.source
		const along = (
			at: number,
			header: number,
			frozenSize: number,
			frozenCount: number,
			scroll: number,
			axis: typeof rows,
		) =>
			at - header < frozenSize
				? axis.at(Math.max(0, at - header))
				: Math.max(frozenCount, axis.at(at - header + scroll))
		const cell = {
			row: along(y, v.headerHeight, v.frozen.height, v.frozen.rows, v.scrollY, rows),
			col: along(x, v.headerWidth, v.frozen.width, v.frozen.cols, v.scrollX, cols),
		}
		const zone = y < v.headerHeight ? (x < v.headerWidth ? 'corner' : 'col') : x < v.headerWidth ? 'row' : 'cell'
		return {zone, cell} as const
	}

	// Where a range is drawn, in the grid's box (mirrored for right to left)
	const boxOf = (range: Range, v: View) => {
		const {rows, cols} = latest.current.source
		const place = (
			start: number,
			end: number,
			frozenCount: number,
			header: number,
			scroll: number,
			axis: typeof rows,
		) => ({
			at: (start < frozenCount ? header : header - scroll) + axis.start(start),
			size: axis.start(end + 1) - axis.start(start),
		})
		const x = place(range.left, range.right, v.frozen.cols, v.headerWidth, v.scrollX, cols)
		const y = place(range.top, range.bottom, v.frozen.rows, v.headerHeight, v.scrollY, rows)
		return {x: rtl ? v.width - x.at - x.size : x.at, y: y.at, w: x.size, h: y.size}
	}

	// Everything a render can change that a frame draws (cells arriving, a scroll and a face loading ask for a frame
	// of their own): typing changes none of it, and moves only the editor
	const keyOf = (): unknown[] => {
		const {source, selection, editing, match} = latest.current
		const {anchor, focus} = selection
		return [
			source,
			anchor.row,
			anchor.col,
			focus.row,
			focus.col,
			editing?.cell.row,
			editing?.cell.col,
			match,
			size.width,
			size.height,
			dpr,
		]
	}

	function draw() {
		const canvas = canvasRef.current
		const ctx = canvas?.getContext('2d')
		if (!canvas || !ctx || !size.width || !size.height) return
		drawn.current = keyOf()
		const {source, selection, editing, match, onPainted} = latest.current
		const v = view()
		const width = Math.round(size.width * v.dpr)
		const height = Math.round(size.height * v.dpr)
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width
			canvas.height = height
		}
		const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
		const range = selectionRange(selection, source)
		const area = areaAt(source.merges, selection.anchor.row, selection.anchor.col)
		paint(ctx, v, source, {
			selection: range,
			// Only what's selected of the active cell's merge: a whole column can cross a merge
			active: {
				top: Math.max(area.top, range.top),
				left: Math.max(area.left, range.left),
				bottom: Math.min(area.bottom, range.bottom),
				right: Math.min(area.right, range.right),
			},
			brand,
			match,
			editing: editing?.cell,
		})
		// What's in view is asked for, with what's around it
		const rowLanes = lanes(source.rows, v.frozen.rows, v.frozen.height, v.headerHeight, v.scrollY, v.height)
		const colLanes = lanes(source.cols, v.frozen.cols, v.frozen.width, v.headerWidth, v.scrollX, v.width)
		for (const r of rowLanes) {
			for (const c of colLanes) {
				const range = {top: r.first, bottom: r.last, left: c.first, right: c.last}
				source.load(range)
				// A merge in view draws its top-left cell's content, wherever that cell is
				for (const merge of source.merges) {
					if (overlaps(merge, range))
						source.load({top: merge.top, bottom: merge.top, left: merge.left, right: merge.left})
				}
			}
		}
		place(v)
		if (!painted.current) {
			painted.current = true
			onPainted()
		}
	}

	const schedule = () => {
		cancelAnimationFrame(frame.current)
		frame.current = requestAnimationFrame(draw)
	}

	// The editor waits over the active cell, invisible, so whatever is typed
	// (through an input method too) lands in it; while typing it takes the
	// cell's font, colour and fill, and grows with the text
	const placeEditor = (v: View) => {
		const editor = editorRef.current
		if (!editor) return
		const {source, editing, selection} = latest.current
		const cell = editing?.cell ?? selection.anchor
		const box = boxOf(areaAt(source.merges, cell.row, cell.col), v)
		const look = appearanceOf(source, cell.row, cell.col, source.cell(cell.row, cell.col))
		const style = editor.style
		style.font = look.font
		style.direction = look.direction
		style.left = `${Math.min(Math.max(box.x, 0), Math.max(0, v.width - 40))}px`
		style.top = `${Math.min(Math.max(box.y, 0), Math.max(0, v.height - 20))}px`
		if (!editing) {
			style.width = `${Math.max(1, box.w)}px`
			style.height = `${Math.max(1, box.h)}px`
			return
		}
		const lineHeight = Math.ceil(look.px * 1.25)
		const lines = editing.draft.split('\n')
		const widest = Math.max(...lines.map((line) => measure(look.font, line))) + 2 * EDITOR_PADDING + 8
		// It grows from the cell the way the sheet reads, slides back over the
		// cells before it at the stage's edge (grown, its ring kept in view), and
		// wraps only past the whole width
		const width = Math.max(box.w, Math.min(widest, v.width - v.headerWidth - EDITOR_RING))
		const ring = width > box.w ? EDITOR_RING : 0
		const start = rtl ? box.x + box.w - width : box.x
		const left = Math.max(rtl ? ring : v.headerWidth, Math.min(start, v.width - (rtl ? v.headerWidth : ring) - width))
		const wrapped = look.wrap || widest > width ? wrap(editing.draft, look.font, width - 2 * EDITOR_PADDING) : lines
		const top = Math.max(0, box.y)
		// The text sits where the cell draws it, until there's more than the cell holds: then it grows down
		const textHeight = wrapped.length * lineHeight
		const room = box.h - textHeight
		const inset = Math.min(Math.max(room, 0), EDITOR_PADDING)
		style.left = `${left}px`
		style.width = `${width}px`
		style.height = `${Math.min(Math.max(box.h, textHeight + 2), v.height - top)}px`
		style.lineHeight = `${lineHeight}px`
		style.paddingTop = `${room <= 0 ? 0 : look.valign === 'top' ? inset : look.valign === 'bottom' ? room - inset : room / 2}px`
		style.textAlign =
			look.align === 'center' ? 'center' : look.align === 'end' && !editing.draft.startsWith('=') ? 'end' : 'start'
		style.color = look.color
		const fill =
			source.look === 'paper' ? styleOf(source, cell.row, cell.col, source.cell(cell.row, cell.col)).fill : undefined
		style.background =
			source.look === 'dark'
				? '#1c1c20'
				: fill?.type === 'pattern' && fill.pattern === 'solid' && fill.color
					? fill.color
					: '#ffffff'
	}

	// On a touch screen, where a drag scrolls, a handle on the selection's moving corner stretches it instead
	const placeHandle = (v: View) => {
		const handle = handleRef.current
		if (!handle) return
		const {selection, source} = latest.current
		const {anchor, focus} = selection
		const box = boxOf(selectionRange(selection, source), v)
		const x = focus.col >= anchor.col !== rtl ? box.x + box.w : box.x
		const y = focus.row >= anchor.row ? box.y + box.h : box.y
		const cells = rtl ? x >= 0 && x <= v.width - v.headerWidth : x >= v.headerWidth && x <= v.width
		const shown = cells && y >= v.headerHeight && y <= v.height && !latest.current.editing
		handle.style.visibility = shown ? 'visible' : 'hidden'
		handle.style.transform = `translate(${x}px, ${y}px)`
	}

	// The link chip sits just above the active cell (below it at the top, where there's no room), while the cell is
	// in view and not being typed into
	const placeChip = (v: View) => {
		const chip = chipRef.current
		if (!chip) return
		const {source, selection, editing} = latest.current
		const box = boxOf(areaAt(source.merges, selection.anchor.row, selection.anchor.col), v)
		const height = chip.offsetHeight
		const width = chip.offsetWidth
		const above = box.y - CHIP_GAP - height
		const y = above >= v.headerHeight ? above : box.y + box.h + CHIP_GAP
		const [from, to] = rtl ? [0, v.width - v.headerWidth] : [v.headerWidth, v.width]
		const x = Math.max(from, Math.min(rtl ? box.x + box.w - width : box.x, to - width))
		const shown = !editing && box.x < to && box.x + box.w > from && box.y < v.height && box.y + box.h > v.headerHeight
		chip.style.visibility = shown ? 'visible' : 'hidden'
		chip.style.transform = `translate(${x}px, ${y}px)`
	}

	// What floats over the canvas, following the cells it belongs to
	const place = (v: View) => {
		placeEditor(v)
		placeHandle(v)
		placeChip(v)
	}

	// Grabbing the handle drags the moving corner's cell, from wherever on the handle the finger lands
	const grabHandle = (event: React.PointerEvent) => {
		event.currentTarget.setPointerCapture(event.pointerId)
		const {selection, source} = latest.current
		const box = boxOf(areaAt(source.merges, selection.focus.row, selection.focus.col), view())
		const bounds = containerRef.current!.getBoundingClientRect()
		drag.current = {
			zone: 'cell',
			pointing: false,
			pointer: {x: event.clientX, y: event.clientY},
			offset: {x: bounds.left + box.x + box.w / 2 - event.clientX, y: bounds.top + box.y + box.h / 2 - event.clientY},
			timer: 0,
		}
	}

	// Scrolls the least that brings a cell into view, clear of the frozen panes, headers and what floats below
	const reveal = (cell: Cell) => {
		const scroller = scrollerRef.current
		if (!scroller) return
		const v = view()
		const {rows, cols, merges} = latest.current.source
		const range = areaAt(merges, cell.row, cell.col)
		const along = (start: number, end: number, scroll: number, pane: number) =>
			start < scroll ? start : end > scroll + pane ? Math.min(start, end - pane) : scroll
		if (cell.col >= v.frozen.cols) {
			const x = along(
				cols.start(range.left) - v.frozen.width,
				cols.start(range.right + 1) - v.frozen.width,
				v.scrollX,
				v.width - v.headerWidth - v.frozen.width,
			)
			if (x !== v.scrollX) scroller.scrollLeft = rtl ? -x : x
		}
		if (cell.row >= v.frozen.rows) {
			const y = along(
				rows.start(range.top) - v.frozen.height,
				rows.start(range.bottom + 1) - v.frozen.height,
				v.scrollY,
				v.height - v.headerHeight - v.frozen.height - latest.current.bottomInset,
			)
			if (y !== v.scrollY) scroller.scrollTop = y / ratio
		}
	}

	// The editor holds the keyboard where a cell can be typed into; elsewhere
	// (read-only, or a touch screen, where it would raise the keyboard) the grid does
	const focusGrid = () => {
		if (latest.current.editable && !isTouch) editorRef.current?.focus({preventScroll: true})
		else scrollerRef.current?.focus({preventScroll: true})
	}

	// The field what's typed is in: the formula bar while it has the keyboard, else the cell's editor
	const typingField = () =>
		document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : editorRef.current

	useLayoutEffect(() => {
		latest.current = props
	})
	useImperativeHandle(props.focusRef, () => focusGrid)

	useLayoutEffect(() => {
		const container = containerRef.current!
		const observer = new ResizeObserver(() => setSize({width: container.clientWidth, height: container.clientHeight}))
		observer.observe(container)
		return () => observer.disconnect()
	}, [])
	useEffect(() => {
		const display = matchMedia(`(resolution: ${dpr}dppx)`)
		const moved = () => setDpr(window.devicePixelRatio || 1)
		display.addEventListener('change', moved)
		return () => display.removeEventListener('change', moved)
	}, [dpr])

	const ready = size.width > 0
	useLayoutEffect(() => {
		if (ready) reveal(latest.current.selection.anchor)
	}, [ready, props.revealKey])

	// Redrawn as it renders when anything drawn changes (the sheet, the selection, the cell typed into, a find, the
	// stage's size), so the canvas is never a frame behind or stretched; cells arriving draw on the next frame. A drag
	// past the edge changes the selection as it scrolls, so it draws on the frame the scroll does.
	useLayoutEffect(() => {
		const changed = keyOf().some((value, i) => value !== drawn.current[i])
		if (changed && drag.current?.timer) schedule()
		else if (changed) draw()
		else place(view())
		const unsubscribe = source.subscribe(schedule)
		// A face arriving late (a script's subset) redraws what it's in
		document.fonts.addEventListener('loadingdone', schedule)
		return () => {
			unsubscribe()
			document.fonts.removeEventListener('loadingdone', schedule)
		}
	})
	useEffect(() => () => cancelAnimationFrame(frame.current), [])

	// An opened file's grid takes the keyboard as it appears
	useEffect(() => {
		if (interactive && ready) focusGrid()
	}, [interactive, ready])

	// A caret placed by the viewer (a formula's error, a line break, a reference pressed in), in the field typed into
	useLayoutEffect(() => {
		const field = typingField()
		if (field && editing?.caret !== undefined) field.setSelectionRange(editing.caret, editing.caret)
	}, [editing?.caret, editing?.draft])
	useLayoutEffect(() => {
		if (!editing) reference.current = undefined
	}, [editing])

	// Copy, cut and paste go through the page's clipboard events: the async
	// clipboard API needs a secure context, which Umbrel on plain HTTP isn't.
	// Safari offers Copy without a text selection once beforecopy is handled.
	useEffect(() => {
		const container = containerRef.current!
		// The grid's, or its menu's, which holds the keyboard while its Copy and Cut run
		const ours = () => {
			const active = document.activeElement
			return !!active && (container.contains(active) || !!menuRef.current?.contains(active)) && !latest.current.editing
		}
		const enable = (event: Event) => ours() && event.preventDefault()
		const tooLarge = () => toast.error(t('files-sheet.copy-too-large'), {area: 'files'})
		const copy = (event: ClipboardEvent, cut: boolean) => {
			if (!ours()) return
			const {selection, source, texts, fetchTexts, onClear, data} = latest.current
			const range = clamp(selectionRange(selection, source), data)
			event.preventDefault()
			// More than the clipboard (or a phone's memory) would take isn't read at all
			const cells = (range.bottom - range.top + 1) * (range.right - range.left + 1)
			if (cells > MAX_COPY_CELLS[isTouch ? 'touch' : 'desktop']) return tooLarge()
			const key = JSON.stringify(range)
			const fetched = fetchedCopy.current?.key === key ? fetchedCopy.current.rows : undefined
			const rows = texts(range) ?? fetched
			if (!rows) {
				// Not all of it has been drawn yet: fetched, then copied again while the gesture that asked still counts,
				// about a second in Safari and five in Chrome. Past that, what was fetched waits for the toast's button,
				// a gesture of its own.
				void fetchTexts(range).then(
					(fetched) => {
						fetchedCopy.current = {key, rows: fetched}
						if (document.execCommand(cut ? 'cut' : 'copy')) return
						// Kept only as long as the toast offers them
						const forget = () => {
							if (fetchedCopy.current?.key === key) fetchedCopy.current = undefined
						}
						toast.info(t('files-sheet.copy-ready'), {
							area: 'files',
							action: {
								label: t(cut ? 'files-sheet.cut' : 'files-sheet.copy'),
								onClick: () => {
									focusGrid()
									document.execCommand(cut ? 'cut' : 'copy')
								},
							},
							onDismiss: forget,
							onAutoClose: forget,
						})
					},
					() => {},
				)
				return
			}
			// What was fetched for this range goes once it's copied
			if (fetched) fetchedCopy.current = undefined
			event.clipboardData?.setData('text/plain', toTsv(rows))
			if (rows.length * (rows[0]?.length ?? 0) <= 20_000) event.clipboardData?.setData('text/html', toHtml(rows))
			if (cut && latest.current.editable) onClear(range)
		}
		const paste = (event: ClipboardEvent) => {
			if (!ours() || !latest.current.editable) return
			const text = event.clipboardData?.getData('text/plain')
			event.preventDefault()
			if (text) latest.current.onPaste(fromTsv(text))
		}
		const abort = new AbortController()
		const options = {signal: abort.signal}
		window.addEventListener('beforecopy', enable, options)
		window.addEventListener('beforecut', enable, options)
		window.addEventListener('beforepaste', enable, options)
		window.addEventListener('copy', (event) => copy(event, false), options)
		window.addEventListener('cut', (event) => copy(event, true), options)
		window.addEventListener('paste', paste, options)
		return () => abort.abort()
	}, [t, isTouch])

	const select = (anchor: Cell, focus: Cell = anchor) => latest.current.onSelect({anchor, focus})
	const go = (to: Cell, extend: boolean) => {
		if (extend) select(latest.current.selection.anchor, to)
		else select(to)
		reveal(to)
	}

	const move = (from: Cell, dRow: number, dCol: number) => step(latest.current.source, from, dRow, dCol)

	// A merge is typed into through its top-left cell, wherever it was pressed
	const startEditing = (at: Cell, draft?: string) => {
		const {source, locked, onEdit, onRefused} = latest.current
		const merge = mergeAt(source.merges, at.row, at.col)
		const cell = merge ? {row: merge.top, col: merge.left} : at
		if (!latest.current.editable) return
		if (locked(cell.row, cell.col)) return onRefused(cell)
		editStarted.current = performance.now()
		const original = source.cell(cell.row, cell.col)?.input ?? ''
		const text = draft ?? original
		reveal(cell)
		onEdit({cell, draft: text, original, replace: draft !== undefined, caret: text.length})
		editorRef.current?.focus({preventScroll: true})
	}

	const onKeyDown = (event: React.KeyboardEvent) => {
		// Keys pressed in the right-click menu bubble here through React's tree: they're the menu's
		if (!event.currentTarget.contains(event.target as Node)) return
		const {selection, data, onCommit, onUndo, onRedo, onClear, onEdge} = latest.current
		const mod = event.metaKey || event.ctrlKey
		const {key} = event
		// Tab moves between cells: the dialog's focus trap mustn't take it to its first button
		if (key === 'Tab' && interactive) event.stopPropagation()
		// A sheet that reads right to left moves the way its columns are laid out: ← to the next one
		const flipped = rtl && (key === 'ArrowLeft' || key === 'ArrowRight')
		const arrow = flipped ? ARROWS[key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'] : ARROWS[key]
		const edge = flipped ? EDGES[key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'] : EDGES[key]
		const typing = latest.current.editing
		if (typing) {
			if (event.nativeEvent.isComposing) return
			if (key === 'Enter' && event.altKey) {
				// Option-Enter breaks the line within the cell
				event.preventDefault()
				const {selectionStart: start, selectionEnd: end, value} = editorRef.current!
				latest.current.onEdit({...typing, draft: value.slice(0, start) + '\n' + value.slice(end), caret: start + 1})
			} else if (key === 'Enter') {
				event.preventDefault()
				void onCommit({rows: event.shiftKey ? -1 : 1, cols: 0})
			} else if (key === 'Tab') {
				event.preventDefault()
				void onCommit({rows: 0, cols: event.shiftKey ? -1 : 1})
			} else if (arrow && typing.replace && !typing.draft.startsWith('=') && !mod && !event.shiftKey) {
				event.preventDefault()
				void onCommit({rows: arrow[0], cols: arrow[1]})
			}
			return
		}
		if (!interactive) return
		const {anchor, focus} = selection
		const {onSheetStep} = latest.current
		if (onSheetStep && event.altKey && !mod && (key === 'ArrowDown' || key === 'ArrowUp')) {
			event.preventDefault()
			onSheetStep(key === 'ArrowDown' ? 1 : -1)
		} else if (arrow) {
			event.preventDefault()
			const from = event.shiftKey ? focus : anchor
			if (mod) void onEdge(from, edge).then((to) => go(to, event.shiftKey))
			else go(move(from, arrow[0], arrow[1]), event.shiftKey)
		} else if (key === 'Tab' || (key === 'Enter' && !editable)) {
			event.preventDefault()
			go(key === 'Tab' ? move(anchor, 0, event.shiftKey ? -1 : 1) : move(anchor, event.shiftKey ? -1 : 1, 0), false)
		} else if (key === 'Enter' || key === 'F2') {
			event.preventDefault()
			startEditing(anchor)
		} else if (key === 'Home' || key === 'End') {
			event.preventDefault()
			const {rows, cols} = latest.current.source
			const home = key === 'Home'
			const row = mod
				? home
					? visibleLine(rows, 0, 1)
					: visibleLine(rows, Math.max(0, data.rows - 1), -1)
				: (event.shiftKey ? focus : anchor).row
			go({row, col: home ? visibleLine(cols, 0, 1) : visibleLine(cols, Math.max(0, data.cols - 1), -1)}, event.shiftKey)
		} else if (key === 'PageDown' || key === 'PageUp') {
			event.preventDefault()
			const v = view()
			const {rows} = latest.current.source
			const page = Math.max(
				1,
				Math.floor((v.height - v.headerHeight - v.frozen.height - bottomInset) / rows.defaultSize) - 1,
			)
			const from = event.shiftKey ? focus : anchor
			const down = key === 'PageDown'
			const row = Math.min(rows.count - 1, Math.max(0, from.row + (down ? page : -page)))
			go({row: visibleLine(rows, row, down ? 1 : -1), col: from.col}, event.shiftKey)
		} else if (mod && key.toLowerCase() === 'a') {
			event.preventDefault()
			latest.current.onSelect(selectionAt('corner', anchor, latest.current.source))
		} else if (mod && editable && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
			event.preventDefault()
			if (event.shiftKey || key.toLowerCase() === 'y') onRedo()
			else onUndo()
		} else if ((key === 'Delete' || key === 'Backspace') && editable && !mod) {
			event.preventDefault()
			onClear(selectionRange(selection, latest.current.source))
		}
	}

	const onPointerDown = (event: React.PointerEvent) => {
		if (event.button !== 0) return
		// A finger scrolls; it selects on lifting without having moved (see onPointerUp)
		if (event.pointerType === 'touch') {
			press.current = {x: event.clientX, y: event.clientY, time: event.timeStamp}
			// The corner has no menu: cancelled, a long press there opens none
			if (hit(event.clientX, event.clientY).zone === 'corner') event.preventDefault()
			return
		}
		event.preventDefault()
		const {zone, cell} = hit(event.clientX, event.clientY)
		const {selection, editing, source} = latest.current
		if (editing && zone === 'cell' && refer(editing, cell)) return startDrag(event, zone, true)
		focusGrid()
		const target = selectionAt(zone, cell, source, event.shiftKey ? selection.anchor : undefined)
		if (editing) return goOnceWritten(target)
		latest.current.onSelect(target)
		if (zone !== 'corner') startDrag(event, zone, false)
	}

	const startDrag = (event: React.PointerEvent, zone: 'cell' | 'row' | 'col', pointing: boolean) => {
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = {zone, pointing, pointer: {x: event.clientX, y: event.clientY}, offset: {x: 0, y: 0}, timer: 0}
	}

	// Pressing away from a cell being typed into writes what's typed, and goes there once it's written: a formula that
	// doesn't parse stays open where it was, saying why
	const goOnceWritten = (target: Selection) =>
		void latest.current.onCommit({rows: 0, cols: 0}).then((written) => written && latest.current.onSelect(target))

	// While a formula is typed with the caret where a reference can go, a press puts the cell's reference there, or in
	// place of the one it put there last, as every spreadsheet does. Whether it did.
	const refer = (typing: Editing, cell: Cell) => {
		const field = typingField()
		const {draft} = typing
		if (!field || !draft.startsWith('=')) return false
		const {selectionStart: start, selectionEnd: end} = field
		const last = reference.current
		if (
			last &&
			draft === last.before + last.text + last.after &&
			start === end &&
			end === draft.length - last.after.length
		) {
			reference.current = {...last, from: cell}
		} else if (REFERABLE.test(draft.slice(0, start))) {
			reference.current = {before: draft.slice(0, start), text: '', after: draft.slice(end), from: cell}
		} else return false
		stretchTo(cell)
		return true
	}

	// The reference put last, now from the cell it was pressed on to this one
	const stretchTo = (cell: Cell) => {
		const last = reference.current
		const {editing, source, onEdit} = latest.current
		if (!last || !editing) return
		const range = withMerges(rangeOf({anchor: last.from, focus: cell}), source.merges)
		// A merge is referred to by its top-left cell
		const text = sameRange(range, areaAt(source.merges, last.from.row, last.from.col))
			? refName(range.top, range.left)
			: rangeName(range)
		if (text === last.text) return
		reference.current = {...last, text}
		const draft = last.before + text + last.after
		onEdit({...editing, draft, error: undefined, caret: draft.length - last.after.length})
	}

	// Dragging selects, and past the grid's edge keeps scrolling while it does
	const onPointerMove = (event: React.PointerEvent) => {
		const current = drag.current
		if (!current) return
		current.pointer = {x: event.clientX, y: event.clientY}
		extendTo(current.pointer)
		if (current.timer) return
		const tick = () => {
			const now = drag.current
			if (!now) return
			const bounds = containerRef.current!.getBoundingClientRect()
			const {x, y} = now.pointer
			const dy =
				y < bounds.top + HEADER_HEIGHT ? y - bounds.top - HEADER_HEIGHT : y > bounds.bottom ? y - bounds.bottom : 0
			const inside = rtl ? bounds.right - x : x - bounds.left
			const dx = inside < headerWidth ? inside - headerWidth : inside > bounds.width ? inside - bounds.width : 0
			if (!dx && !dy) {
				now.timer = 0
				return
			}
			const scroller = scrollerRef.current!
			scroller.scrollTop += dy / 2
			scroller.scrollLeft += (rtl ? -dx : dx) / 2
			extendTo(now.pointer)
			now.timer = requestAnimationFrame(tick)
		}
		tick()
	}

	const extendTo = (pointer: {x: number; y: number}) => {
		const current = drag.current
		if (!current) return
		const {cell} = hit(pointer.x + current.offset.x, pointer.y + current.offset.y)
		if (current.pointing) return stretchTo(cell)
		const {selection, source} = latest.current
		const {focus} = selectionAt(current.zone, cell, source)
		if (focus.row !== selection.focus.row || focus.col !== selection.focus.col) {
			latest.current.onSelect({anchor: selection.anchor, focus})
		}
	}

	const endDrag = () => {
		if (drag.current) cancelAnimationFrame(drag.current.timer)
		drag.current = undefined
	}

	const onPointerUp = (event: React.PointerEvent) => {
		endDrag()
		// A tap selects, and a second tap on the same cell edits it
		const pressed = press.current
		press.current = undefined
		if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 8) return
		if (event.timeStamp - pressed.time > 500) return
		const {zone, cell} = hit(event.clientX, event.clientY)
		const {source, editing} = latest.current
		if (editing) {
			if (zone === 'cell' && refer(editing, cell)) keepTyping.current = true
			else goOnceWritten(selectionAt(zone, cell, source))
			return
		}
		if (zone !== 'cell') return latest.current.onSelect(selectionAt(zone, cell, source))
		const previous = lastTap.current
		lastTap.current = {time: event.timeStamp, cell}
		if (
			previous &&
			event.timeStamp - previous.time < 400 &&
			previous.cell.row === cell.row &&
			previous.cell.col === cell.col
		) {
			lastTap.current = undefined
			return startEditing(cell)
		}
		select(cell)
	}

	// A right-click or a long press: what's under it is selected first, unless the selection holds it already
	const openMenu = (point: {clientX: number; clientY: number}) => {
		const {zone, cell} = hit(point.clientX, point.clientY)
		// Never the corner, whose right-click and long press are cancelled
		if (zone === 'corner') return
		const {selection, source} = latest.current
		let range = selectionRange(selection, source)
		const target = selectionAt(zone, cell, source)
		const own = selectionRange(target, source)
		if (own.top < range.top || own.bottom > range.bottom || own.left < range.left || own.right > range.right) {
			latest.current.onSelect(target)
			range = own
		}
		setMenuTarget({zone, selection: range})
	}

	const active = selection.anchor
	const edited = editing?.cell ?? active
	// The active cell's text, kept as its block arrives, said for screen readers as it changes, or for a range, where
	// it runs and how many cells it holds
	const activeText = useSyncExternalStore(source.subscribe, () => source.cell(active.row, active.col)?.text ?? '')
	const range = selectionRange(selection, source)
	const said = sameRange(range, areaAt(source.merges, active.row, active.col))
		? `${refName(active.row, active.col)} ${activeText}`.trim()
		: t('files-sheet.range', {
				from: refName(range.top, range.left),
				to: refName(range.bottom, range.right),
				count: (range.bottom - range.top + 1) * (range.right - range.left + 1),
			})
	const saidId = useId()
	const scroller = (
		<div
			ref={scrollerRef}
			tabIndex={-1}
			dir={rtl ? 'rtl' : 'ltr'}
			role='grid'
			aria-label={props.label}
			aria-readonly={!editable}
			aria-rowcount={source.rows.count}
			aria-colcount={source.cols.count}
			onScroll={schedule}
			onPointerDown={(event) => {
				pressedAt.current = {clientX: event.clientX, clientY: event.clientY}
				onPointerDown(event)
			}}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			// A double click edits: caught here because a pointerdown doesn't count
			// clicks (a finger's double tap is counted in onPointerUp)
			onDoubleClick={(event) => {
				const {zone, cell} = hit(event.clientX, event.clientY)
				if (zone === 'cell' && !event.shiftKey && !latest.current.editing) startEditing(cell)
			}}
			onPointerCancel={() => {
				press.current = undefined
				endDrag()
			}}
			// Cancelled, the touch makes no mousedown, which would move the keyboard off the field typed into
			onTouchEnd={(event) => {
				if (keepTyping.current) event.preventDefault()
				keepTyping.current = false
			}}
			onContextMenu={(event) => {
				if (hit(event.clientX, event.clientY).zone === 'corner') return event.preventDefault()
				if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === 'touch') return
				openMenu(event)
			}}
			className='absolute inset-0 overflow-auto overscroll-contain outline-none select-none'
		>
			<div style={{width: headerWidth + source.cols.total, height: spacerHeight}} />
		</div>
	)

	return (
		<div
			ref={containerRef}
			onKeyDown={onKeyDown}
			className={cn(
				'relative size-full overflow-clip rounded-xl',
				source.look === 'paper'
					? 'bg-white shadow-[0_8px_30px_rgb(0_0_0/0.35)] ring-1 ring-white/5'
					: 'settings-edge-material bg-black/50',
			)}
		>
			{/* Sized as drawn, so a resize crops or uncovers it until it's redrawn, never stretches it */}
			<canvas
				ref={canvasRef}
				style={{width: size.width, height: size.height}}
				className='pointer-events-none absolute top-0 left-0'
			/>
			<ContextMenu
				onOpenChange={(open) => {
					// A long press opens the menu without a contextmenu event of its own
					if (open && isTouch && pressedAt.current) openMenu(pressedAt.current)
				}}
			>
				<ContextMenuTrigger asChild>{scroller}</ContextMenuTrigger>
				<ContextMenuContent
					ref={menuRef}
					className={cn(floatingMenuClass, 'min-w-48')}
					// Back to the grid, which the keyboard was in
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						focusGrid()
					}}
				>
					{menuTarget && props.menu(menuTarget)}
				</ContextMenuContent>
			</ContextMenu>
			{props.link && (
				<button
					ref={chipRef}
					type='button'
					aria-label={props.link.label}
					onClick={props.link.open}
					// The keyboard stays with the grid
					onPointerDown={(event) => event.preventDefault()}
					// Placed and shown as it's drawn (see placeChip)
					style={{visibility: 'hidden'}}
					className={cn(
						floatingGlassClass,
						'absolute top-0 left-0 z-[2] flex h-7 max-w-64 items-center gap-1.5 rounded-full px-2.5 text-12 text-white/85 transition-colors hover:text-white',
					)}
				>
					<ExternalLink className='size-3.5 shrink-0' />
					<span className='truncate'>{props.link.label}</span>
				</button>
			)}
			{isTouch && (
				<div
					ref={handleRef}
					aria-hidden='true'
					onPointerDown={grabHandle}
					onPointerMove={onPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					// Placed and shown as it's drawn (see placeHandle); a finger-sized target around a small dot
					style={{visibility: 'hidden'}}
					className='absolute top-0 left-0 z-[1] -mt-5 -ml-5 flex size-10 touch-none items-center justify-center'
				>
					<div className='size-3 rounded-full bg-brand shadow-[0_1px_4px_rgb(0_0_0/0.4)] ring-2 ring-white' />
				</div>
			)}
			{editable && (
				<textarea
					ref={editorRef}
					data-cell-editor
					aria-label={t('files-sheet.cell', {cell: refName(edited.row, edited.col)})}
					// What's in it, or the range: the field's own value is only what's typed
					aria-describedby={saidId}
					value={editing?.draft ?? ''}
					// Typing over a cell starts editing it with what's typed
					onChange={(event) => {
						const draft = event.target.value
						const current = latest.current.editing
						if (current) latest.current.onEdit({...current, draft, error: undefined, caret: undefined})
						else if (draft) startEditing(latest.current.selection.anchor, draft)
					}}
					onCompositionStart={() => {
						if (!latest.current.editing) startEditing(latest.current.selection.anchor, '')
					}}
					// The double click or tap that opened the editor doesn't go on to select a word in it
					onMouseDown={(event) => {
						if (event.detail > 1 && performance.now() - editStarted.current < 600) event.preventDefault()
					}}
					spellCheck={false}
					autoCapitalize='off'
					autoComplete='off'
					autoCorrect='off'
					rows={1}
					className={cn(
						'absolute z-[1] m-0 resize-none overflow-hidden rounded-[1px] border-0 px-[3px] py-0 outline-none',
						editing
							? cn('shadow-[0_2px_12px_rgb(0_0_0/0.25)] ring-2', editing.error ? 'ring-red-500' : 'ring-brand')
							: 'pointer-events-none bg-transparent text-transparent caret-transparent opacity-0',
					)}
				/>
			)}
			{/* The active cell, said as it changes */}
			<div id={saidId} aria-live='polite' className='sr-only'>
				{said}
			</div>
		</div>
	)
}

const ARROWS: Partial<Record<string, [number, number]>> = {
	ArrowUp: [-1, 0],
	ArrowDown: [1, 0],
	ArrowLeft: [0, -1],
	ArrowRight: [0, 1],
}
const EDGES: Record<string, Edge> = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'}

// Where a reference can go in a formula: after =, an operator, a bracket or a separator
const REFERABLE = /[=(,;+\-*/^&<>:]\s*$/

// What a press selects: a cell, whole rows or columns, or (the corner) everything, from the first cell that's shown,
// which becomes active, so it can be seen and typed into. `from` is the anchor a shift-press extends.
function selectionAt(
	zone: 'corner' | 'row' | 'col' | 'cell',
	cell: Cell,
	{rows, cols}: Pick<GridSource, 'rows' | 'cols'>,
	from?: Cell,
): Selection {
	const first = {row: visibleLine(rows, 0, 1), col: visibleLine(cols, 0, 1)}
	const last = {row: rows.count - 1, col: cols.count - 1}
	if (zone === 'corner') return {anchor: first, focus: last}
	if (zone === 'row')
		return {anchor: {row: from?.row ?? cell.row, col: first.col}, focus: {row: cell.row, col: last.col}}
	if (zone === 'col')
		return {anchor: {row: first.row, col: from?.col ?? cell.col}, focus: {row: last.row, col: cell.col}}
	return {anchor: from ?? cell, focus: cell}
}

// Copying whole rows or columns takes only the data in them
const clamp = (range: Range, data: {rows: number; cols: number}): Range => ({
	...range,
	bottom: Math.max(range.top, Math.min(range.bottom, data.rows - 1)),
	right: Math.max(range.left, Math.min(range.right, data.cols - 1)),
})
