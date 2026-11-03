// @vitest-environment jsdom
// The grid driven through its DOM. Nothing is drawn here (jsdom has no canvas), so presses are placed by the
// default sizes: a 24px row of column headers, 20px rows and 64px columns after the row headers.
import {act, useState, type ComponentProps} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeAll, describe, expect, test, vi} from 'vitest'

import {Axis} from './axis'
import {Grid, type Editing} from './grid'
import type {Cell, GridSource, Range, Selection} from './model'

vi.mock('react-i18next', () => ({
	useTranslation: () => ({t: (key: string, values?: object) => (values ? `${key} ${JSON.stringify(values)}` : key)}),
}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
// The toasts shown, with their buttons
type ToastOptions = {action?: {label: string; onClick: () => void}; onAutoClose?: () => void}
const toasts = vi.hoisted(() => [] as Array<{message: string; options?: ToastOptions}>)
vi.mock('@/components/ui/toast', () => {
	const show = (message: string, options?: ToastOptions) => void toasts.push({message, options})
	return {toast: Object.assign(show, {info: show, error: show})}
})
const device = vi.hoisted(() => ({touch: false}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => device.touch}))
// What each frame would draw: the selection and the active cell it's given
const painted = vi.hoisted(() => [] as Array<{selection: Range; active: Range}>)
vi.mock('./paint', async (importOriginal) => ({
	...(await importOriginal<typeof import('./paint')>()),
	paint: (_ctx: unknown, _view: unknown, _source: unknown, marks: {selection: Range; active: Range}) =>
		void painted.push(marks),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const ROWS = 100
const COLS = 26
const HEADER_WIDTH = Math.max(36, String(ROWS).length * 7 + 18)

beforeAll(() => {
	// What jsdom lacks: element sizes, pointer capture, media queries, font events and a canvas
	globalThis.ResizeObserver = class {
		constructor(private callback: (entries: unknown[]) => void) {}
		observe(element: Element) {
			Object.defineProperties(element, {clientWidth: {value: 800}, clientHeight: {value: 600}})
			this.callback([])
		}
		disconnect() {}
	} as unknown as typeof ResizeObserver
	Element.prototype.setPointerCapture = () => {}
	Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
	window.matchMedia = () => ({addEventListener() {}, removeEventListener() {}}) as unknown as MediaQueryList
	Object.defineProperty(document, 'fonts', {value: {addEventListener() {}, removeEventListener() {}}})
	HTMLCanvasElement.prototype.getContext = (() => ({
		measureText: (text: string) => ({width: text.length * 7}),
	})) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

let root: Root | undefined
afterEach(() => {
	act(() => root?.unmount())
	root = undefined
	document.body.replaceChildren()
	device.touch = false
	painted.length = 0
	toasts.length = 0
	vi.useRealTimers()
})

type Options = {merges?: Range[]; hiddenRows?: number[]; hiddenCols?: number[]; texts?: Record<string, string>}

function sheet({merges = [], hiddenRows = [], hiddenCols = [], texts = {}}: Options = {}): GridSource {
	return {
		look: 'dark',
		rows: new Axis(
			ROWS,
			20,
			hiddenRows.flatMap((i) => [i, 0]),
		),
		cols: new Axis(
			COLS,
			64,
			hiddenCols.flatMap((i) => [i, 0]),
		),
		frozen: {rows: 0, cols: 0},
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

type Props = ComponentProps<typeof Grid>

// No find: one function for every render, as the viewer's stays while its matches do
const NO_MATCHES = () => 0 as const

// The grid in a host that keeps its selection and edit, as the viewer does, recording what it's asked to do
function mount(source: GridSource, props: Partial<Props> = {}) {
	const asked = {selections: [] as Selection[], cleared: [] as Range[], commits: 0, refused: [] as Cell[]}
	const host = {
		editing: undefined as Editing | undefined,
		setEditing: (() => {}) as (editing: Editing | undefined) => void,
		// Whether what's typed can be written
		writes: true,
		// Props changed after mounting
		set: (() => {}) as (props: Partial<Props>) => void,
	}
	function Host() {
		const [selection, setSelection] = useState<Selection>({anchor: {row: 0, col: 0}, focus: {row: 0, col: 0}})
		const [editing, setEditing] = useState<Editing>()
		const [changed, setChanged] = useState<Partial<Props>>({})
		host.editing = editing
		host.setEditing = setEditing
		host.set = setChanged
		return (
			<>
				<Grid
					source={source}
					label='Sheet1'
					selection={selection}
					onSelect={(next) => {
						asked.selections.push(next)
						setSelection(next)
					}}
					interactive
					editable
					locked={() => false}
					onRefused={(cell) => asked.refused.push(cell)}
					data={{rows: 20, cols: 8}}
					editing={editing}
					onEdit={setEditing}
					onCommit={async () => {
						asked.commits++
						if (host.writes) setEditing(undefined)
						return host.writes
					}}
					match={NO_MATCHES}
					onClear={(range) => asked.cleared.push(range)}
					onUndo={() => {}}
					onRedo={() => {}}
					onEdge={async (cell) => cell}
					texts={() => undefined}
					fetchTexts={async () => []}
					onPaste={() => {}}
					menu={() => null}
					bottomInset={0}
					revealKey={0}
					onPainted={() => {}}
					focusRef={{current: null}}
					{...props}
					{...changed}
				/>
				{/* The formula bar, which shows and takes what's typed as the viewer's does */}
				<textarea
					data-bar
					value={editing?.draft ?? ''}
					onChange={(event) => editing && setEditing({...editing, draft: event.target.value, caret: undefined})}
				/>
			</>
		)
	}
	const container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	act(() => root!.render(<Host />))
	const grid = container.querySelector<HTMLElement>('[role="grid"]')!
	return {asked, host, grid, container}
}

// Where a cell or a header is pressed
const cellPoint = (row: number, col: number) => ({clientX: HEADER_WIDTH + col * 64 + 32, clientY: 24 + row * 20 + 10})
const columnHeader = (col: number) => ({clientX: HEADER_WIDTH + col * 64 + 32, clientY: 10})
const rowHeader = (row: number) => ({clientX: 10, clientY: 24 + row * 20 + 10})
const CORNER = {clientX: 10, clientY: 10}

function press(target: Element, point: {clientX: number; clientY: number}, init: PointerEventInit = {}) {
	act(() => {
		target.dispatchEvent(
			new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse', ...point, ...init}),
		)
		target.dispatchEvent(
			new PointerEvent('pointerup', {bubbles: true, button: 0, pointerType: 'mouse', ...point, ...init}),
		)
	})
}
const key = (target: Element, init: KeyboardEventInit) =>
	act(() => {
		target.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init}))
	})
const last = <T,>(items: T[]) => items[items.length - 1]

describe('selecting', () => {
	test('a press selects the cell under it', () => {
		const {asked, grid} = mount(sheet())
		press(grid, cellPoint(4, 2))
		expect(last(asked.selections)).toEqual({anchor: {row: 4, col: 2}, focus: {row: 4, col: 2}})
	})

	test('a row header selects the whole row', () => {
		const {asked, grid} = mount(sheet())
		press(grid, rowHeader(3))
		expect(last(asked.selections)).toEqual({anchor: {row: 3, col: 0}, focus: {row: 3, col: COLS - 1}})
	})
})

describe('drawing', () => {
	test('typing draws nothing: only the editor follows the text', () => {
		const {host} = mount(sheet())
		act(() => host.setEditing({cell: {row: 0, col: 0}, draft: '1', original: '', replace: true}))
		const drawn = painted.length
		for (const draft of ['12', '123', '1234']) act(() => host.setEditing({...host.editing!, draft}))
		expect(painted.length).toBe(drawn)
		// A find's matches changing draws them
		act(() => host.set({match: () => 1}))
		expect(painted.length).toBe(drawn + 1)
	})

	test('a drag past the edge draws on the frame it scrolls, not as well as it', async () => {
		const {asked, grid} = mount(sheet())
		const init = {bubbles: true, button: 0, pointerType: 'mouse'}
		act(() => void grid.dispatchEvent(new PointerEvent('pointerdown', {...init, ...cellPoint(1, 1)})))
		const drawn = painted.length
		// Below the grid's bottom edge (600px), where it scrolls on by itself
		act(
			() =>
				void grid.dispatchEvent(
					new PointerEvent('pointermove', {...init, clientX: cellPoint(1, 3).clientX, clientY: 700}),
				),
		)
		expect(last(asked.selections).focus.col).toBe(3)
		expect(painted.length).toBe(drawn)
		await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
		expect(painted.length).toBe(drawn + 1)
		act(() => void grid.dispatchEvent(new PointerEvent('pointerup', {...init, clientX: 0, clientY: 700})))
	})

	test('hands the viewer a way to give it the keyboard', () => {
		const focusRef = {current: null as (() => void) | null}
		const {container} = mount(sheet(), {focusRef})
		act(() => focusRef.current!())
		expect(document.activeElement).toBe(container.querySelector('[data-cell-editor]'))
	})
})

describe('the keyboard', () => {
	test('⌥↓ and ⌥↑ go to the next sheet and the one before, in a workbook', () => {
		const steps: number[] = []
		const {asked, grid} = mount(sheet(), {onSheetStep: (by) => steps.push(by)})
		key(grid, {key: 'ArrowDown', altKey: true})
		key(grid, {key: 'ArrowUp', altKey: true})
		expect(steps).toEqual([1, -1])
		expect(asked.selections).toEqual([])
	})
})

describe('a header over a merge', () => {
	// A title merged across A1:G1, as most budgets have
	const title = {top: 0, left: 0, bottom: 0, right: 6}

	test('selects only its own column, and Delete clears only that', () => {
		const {asked, grid} = mount(sheet({merges: [title]}))
		press(grid, columnHeader(3))
		const column = {top: 0, left: 3, bottom: ROWS - 1, right: 3}
		expect(last(asked.selections)).toEqual({anchor: {row: 0, col: 3}, focus: {row: ROWS - 1, col: 3}})
		expect(last(painted).selection).toEqual(column)
		// What's active is the merge's part in the column, not all of A1:G1
		expect(last(painted).active).toEqual({top: 0, left: 3, bottom: 0, right: 3})
		key(grid, {key: 'Delete'})
		expect(asked.cleared).toEqual([column])
	})

	test('a range of cells still grows to the whole merge, as Excel selects', () => {
		const {grid} = mount(sheet({merges: [title]}))
		press(grid, cellPoint(2, 1))
		press(grid, cellPoint(0, 2), {shiftKey: true})
		expect(last(painted).selection).toEqual({top: 0, left: 0, bottom: 2, right: 6})
	})
})

describe('the active cell is never a hidden one', () => {
	// Row 1 and column A hidden: everything shown moves up a row and left a column
	const hidden = {hiddenRows: [0], hiddenCols: [0]}
	const everything = {anchor: {row: 1, col: 1}, focus: {row: ROWS - 1, col: COLS - 1}}

	test('select all starts from the first cell shown', () => {
		const {asked, grid} = mount(sheet(hidden))
		key(grid, {key: 'a', metaKey: true})
		expect(last(asked.selections)).toEqual(everything)
		press(grid, CORNER)
		expect(last(asked.selections)).toEqual(everything)
	})

	test('a header selects from its first cell shown, pressed, tapped or right-clicked', () => {
		const {asked, grid} = mount(sheet(hidden))
		// Column D is now the third column drawn, row 5 the fourth row
		const columnD = {clientX: HEADER_WIDTH + 2 * 64 + 32, clientY: 10}
		const row5 = {clientX: 10, clientY: 24 + 3 * 20 + 10}
		press(grid, columnD)
		expect(last(asked.selections)).toEqual({anchor: {row: 1, col: 3}, focus: {row: ROWS - 1, col: 3}})
		press(grid, row5, {pointerType: 'touch'})
		expect(last(asked.selections)).toEqual({anchor: {row: 4, col: 1}, focus: {row: 4, col: COLS - 1}})
		press(grid, cellPoint(8, 8))
		act(() => {
			grid.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, ...columnD}))
		})
		expect(last(asked.selections)).toEqual({anchor: {row: 1, col: 3}, focus: {row: ROWS - 1, col: 3}})
	})
})

describe('on a touch screen', () => {
	const handleOf = (container: Element) => container.querySelector<HTMLElement>('[aria-hidden="true"].touch-none')

	test('the selection’s corner has a handle that stretches it', () => {
		device.touch = true
		const {asked, grid, container} = mount(sheet())
		press(grid, cellPoint(4, 1), {pointerType: 'touch'})
		const handle = handleOf(container)!
		// On B5's bottom-right corner
		const corner = {clientX: HEADER_WIDTH + 2 * 64, clientY: 24 + 5 * 20}
		expect(handle.style.transform).toBe(`translate(${corner.clientX}px, ${corner.clientY}px)`)
		expect(handle.style.visibility).toBe('visible')
		// Grabbed there and moved two columns right and three rows down, it drags B5 to D8
		act(() => {
			const init = {bubbles: true, button: 0, pointerType: 'touch'}
			handle.dispatchEvent(new PointerEvent('pointerdown', {...init, ...corner}))
			handle.dispatchEvent(
				new PointerEvent('pointermove', {...init, clientX: corner.clientX + 128, clientY: corner.clientY + 60}),
			)
			handle.dispatchEvent(
				new PointerEvent('pointerup', {...init, clientX: corner.clientX + 128, clientY: corner.clientY + 60}),
			)
		})
		expect(last(asked.selections)).toEqual({anchor: {row: 4, col: 1}, focus: {row: 7, col: 3}})
		expect(handle.style.transform).toBe(`translate(${HEADER_WIDTH + 4 * 64}px, ${24 + 8 * 20}px)`)
	})

	test('there is none for a mouse, or while a cell is typed into', () => {
		expect(handleOf(mount(sheet()).container)).toBeNull()
		act(() => root?.unmount())
		device.touch = true
		const {host, container} = mount(sheet())
		act(() => host.setEditing({cell: {row: 0, col: 0}, draft: 'a', original: '', replace: true}))
		expect(handleOf(container)!.style.visibility).toBe('hidden')
	})
})

describe('a link', () => {
	const chipOf = (container: Element) =>
		container.querySelector<HTMLButtonElement>('button[aria-label="https://umbrel.com"]')

	test('is followed from a chip on its cell', () => {
		const open = vi.fn()
		const {grid, container} = mount(sheet(), {link: {label: 'https://umbrel.com', open}})
		press(grid, cellPoint(4, 1))
		const chip = chipOf(container)!
		expect(chip.style.visibility).toBe('visible')
		// Just above B5
		expect(chip.style.transform).toBe(`translate(${HEADER_WIDTH + 64}px, ${24 + 4 * 20 - 4}px)`)
		act(() => chip.click())
		expect(open).toHaveBeenCalledOnce()
		// Below a cell in the first row, which has no room above
		press(grid, cellPoint(0, 1))
		expect(chip.style.transform).toBe(`translate(${HEADER_WIDTH + 64}px, ${24 + 20 + 4}px)`)
	})

	test('hides its chip while the cell is typed into', () => {
		const {host, container} = mount(sheet(), {link: {label: 'https://umbrel.com', open: () => {}}})
		act(() => host.setEditing({cell: {row: 0, col: 0}, draft: 'a', original: '', replace: true}))
		expect(chipOf(container)!.style.visibility).toBe('hidden')
	})
})

describe('what a screen reader is told', () => {
	const said = (container: Element) => container.querySelector('[aria-live]')!.textContent

	test('the cell, or for a range where it runs and how many cells it holds', () => {
		const {grid, container} = mount(
			sheet({merges: [{top: 0, left: 0, bottom: 0, right: 6}], texts: {'4:1': '$13,100.00'}}),
		)
		press(grid, cellPoint(4, 1))
		expect(said(container)).toBe('B5 $13,100.00')
		press(grid, cellPoint(5, 2), {shiftKey: true})
		expect(said(container)).toBe('files-sheet.range {"from":"B5","to":"C6","count":4}')
		// A merge is one cell
		press(grid, cellPoint(0, 0))
		expect(said(container)).toBe('A1')
		// And the field that has the keyboard points at it
		const editor = container.querySelector('[data-cell-editor]')!
		expect(editor.getAttribute('aria-describedby')).toBe(container.querySelector('[aria-live]')!.id)
	})

	test('whether the sheet can be changed', () => {
		expect(mount(sheet()).grid.getAttribute('aria-readonly')).toBe('false')
		act(() => root?.unmount())
		expect(mount(sheet(), {editable: false}).grid.getAttribute('aria-readonly')).toBe('true')
	})
})

describe('the corner', () => {
	const menu = () => document.querySelector('[role="menu"]')

	test('opens no menu when right-clicked', () => {
		const {grid} = mount(sheet())
		const rightClick = (point: {clientX: number; clientY: number}) =>
			act(() => void grid.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, ...point})))
		rightClick(CORNER)
		expect(menu()).toBeNull()
		// As a cell's does
		rightClick(cellPoint(2, 2))
		expect(menu()).not.toBeNull()
	})

	test('opens no menu when long-pressed', () => {
		vi.useFakeTimers()
		device.touch = true
		const {grid} = mount(sheet())
		act(() => {
			grid.dispatchEvent(
				new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, pointerType: 'touch', ...CORNER}),
			)
			vi.advanceTimersByTime(1000)
		})
		expect(menu()).toBeNull()
	})
})

describe('pressing a cell while typing', () => {
	// Typing into A1, the caret at the end
	const type = (host: ReturnType<typeof mount>['host'], draft: string) =>
		act(() => host.setEditing({cell: {row: 0, col: 0}, draft, original: '', replace: true, caret: draft.length}))
	const drag = (target: Element, from: {clientX: number; clientY: number}, to: {clientX: number; clientY: number}) =>
		act(() => {
			const init = {bubbles: true, button: 0, pointerType: 'mouse'}
			target.dispatchEvent(new PointerEvent('pointerdown', {...init, ...from}))
			target.dispatchEvent(new PointerEvent('pointermove', {...init, ...to}))
			target.dispatchEvent(new PointerEvent('pointerup', {...init, ...to}))
		})

	test('a formula takes the reference of the cell pressed, and of the range dragged over', () => {
		const {asked, host, grid, container} = mount(sheet())
		type(host, '=SUM(')
		container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!.focus()
		press(grid, cellPoint(6, 1))
		expect(host.editing?.draft).toBe('=SUM(B7')
		// Pressed again, another takes its place, and a drag makes it a range
		drag(grid, cellPoint(2, 2), cellPoint(4, 2))
		expect(host.editing?.draft).toBe('=SUM(C3:C5')
		// After an operator, the next goes on
		type(host, '=SUM(C3:C5)+')
		press(grid, cellPoint(0, 3))
		expect(host.editing?.draft).toBe('=SUM(C3:C5)+D1')
		// None of it moved the selection or wrote anything
		expect(asked.selections).toEqual([])
		expect(asked.commits).toBe(0)
	})

	test('in the formula bar, at its caret', () => {
		const {host, grid, container} = mount(sheet())
		type(host, '=SUM()')
		const bar = container.querySelector<HTMLTextAreaElement>('[data-bar]')!
		bar.focus()
		bar.setSelectionRange(5, 5)
		press(grid, cellPoint(6, 1))
		expect(host.editing?.draft).toBe('=SUM(B7)')
		expect(bar.selectionStart).toBe(7)
		press(grid, cellPoint(2, 2))
		expect(host.editing?.draft).toBe('=SUM(C3)')
	})

	test('a tap puts it in too, and leaves the keyboard with the field', () => {
		device.touch = true
		const {asked, host, grid, container} = mount(sheet())
		type(host, '=SUM(')
		container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!.focus()
		press(grid, cellPoint(6, 1), {pointerType: 'touch'})
		// What follows the tap: cancelled, it moves no focus
		const end = new TouchEvent('touchend', {bubbles: true, cancelable: true})
		act(() => void grid.dispatchEvent(end))
		expect(host.editing?.draft).toBe('=SUM(B7')
		expect(end.defaultPrevented).toBe(true)
		expect(asked.selections).toEqual([])
	})

	test('a press elsewhere goes there only once what’s typed is written', async () => {
		const {asked, host, grid, container} = mount(sheet())
		const editor = container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!
		// No reference can go after "=SUM": the press writes instead, which fails
		type(host, '=SUM')
		host.writes = false
		press(grid, cellPoint(6, 1))
		await act(async () => {})
		expect(asked.commits).toBe(1)
		expect(asked.selections).toEqual([])
		expect(editor.getAttribute('aria-label')).toBe('files-sheet.cell {"cell":"A1"}')
		host.writes = true
		press(grid, cellPoint(6, 1))
		await act(async () => {})
		expect(last(asked.selections)).toEqual({anchor: {row: 6, col: 1}, focus: {row: 6, col: 1}})
	})
})

describe('copying what isn’t loaded yet', () => {
	// The copy event a browser fires, with what it's given to put on the clipboard
	const copyEvent = (clipboard: Array<[string, string]>) => {
		const event = new Event('copy', {bubbles: true, cancelable: true})
		Object.defineProperty(event, 'clipboardData', {
			value: {setData: (type: string, data: string) => clipboard.push([type, data])},
		})
		return event
	}

	test('when the browser no longer takes it as the user’s, waits for the toast’s button', async () => {
		const clipboard: Array<[string, string]> = []
		const {grid, container} = mount(sheet(), {texts: () => undefined, fetchTexts: async () => [['a', 'b']]})
		press(grid, cellPoint(0, 0))
		press(grid, cellPoint(0, 1), {shiftKey: true})
		container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!.focus()
		// Safari past a second: the copy run again from the fetch is refused
		let honoured = false
		document.execCommand = () => {
			if (honoured) window.dispatchEvent(copyEvent(clipboard))
			return honoured
		}
		window.dispatchEvent(copyEvent(clipboard))
		await act(async () => {})
		expect(clipboard).toEqual([])
		expect(toasts.map(({message, options}) => [message, options?.action?.label])).toEqual([
			['files-sheet.copy-ready', 'files-sheet.copy'],
		])
		// Its button is a gesture of its own, which copies what was fetched
		honoured = true
		act(() => toasts[0].options!.action!.onClick())
		expect(clipboard).toContainEqual(['text/plain', 'a\tb'])
	})

	test('what was fetched goes when the toast does', async () => {
		const fetchTexts = vi.fn(async () => [['a', 'b']])
		const {grid, container} = mount(sheet(), {texts: () => undefined, fetchTexts})
		press(grid, cellPoint(0, 0))
		press(grid, cellPoint(0, 1), {shiftKey: true})
		container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!.focus()
		document.execCommand = () => false
		window.dispatchEvent(copyEvent([]))
		await act(async () => {})
		act(() => toasts[0].options!.onAutoClose!())
		// So copying again fetches anew
		window.dispatchEvent(copyEvent([]))
		await act(async () => {})
		expect(fetchTexts).toHaveBeenCalledTimes(2)
	})
})

describe('a locked cell', () => {
	test('turns typing, Enter, F2 and a double click away, for the viewer to say why', () => {
		const {asked, host, grid, container} = mount(sheet(), {locked: (row, col) => row === 0 && col === 0})
		key(grid, {key: 'Enter'})
		key(grid, {key: 'F2'})
		const editor = container.querySelector<HTMLTextAreaElement>('[data-cell-editor]')!
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'x')
			editor.dispatchEvent(new Event('input', {bubbles: true}))
		})
		act(() => void grid.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, ...cellPoint(0, 0)})))
		expect(asked.refused).toEqual(new Array(4).fill({row: 0, col: 0}))
		expect(host.editing).toBeUndefined()
		// Another is typed into as ever
		press(grid, cellPoint(1, 1))
		key(grid, {key: 'F2'})
		expect([host.editing?.cell, asked.refused.length]).toEqual([{row: 1, col: 1}, 4])
	})
})
