// @vitest-environment jsdom

import {TooltipProvider} from '@radix-ui/react-tooltip'
import {act, type ComponentProps} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import SheetViewer from '@/features/files/components/file-viewer/sheet-viewer'
import {createCsvHandler} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/protocol'
import {createXlsxHandler} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/protocol'
import {
	relationships,
	styleSheet,
	workbook,
	worksheet,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/test-helpers'
import type {FormulaBar} from '@/features/files/components/file-viewer/sheet-viewer/formula-bar'
import type {Grid} from '@/features/files/components/file-viewer/sheet-viewer/grid'
import type {SheetTabs} from '@/features/files/components/file-viewer/sheet-viewer/sheet-tabs'
import type {FileSystemItem} from '@/features/files/types'

// The viewer around its canvas: the grid, formula bar and tabs are stand-ins that hand the test their props, and
// the document's worker runs in place
const ui = vi.hoisted(() => ({
	bytes: new ArrayBuffer(0),
	save: undefined as undefined | {handler: unknown; dirty: boolean},
	grid: undefined as undefined | ComponentProps<typeof Grid>,
	tabs: undefined as undefined | ComponentProps<typeof SheetTabs>,
	bar: undefined as undefined | ComponentProps<typeof FormulaBar>,
	toasts: [] as string[],
	short: false,
	// What's been asked of the documents' workers, by request type
	asked: [] as string[],
}))
vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, options?: {list?: string}) => (options?.list ? `${key}: ${options.list}` : key),
		i18n: {language: 'en'},
	}),
}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/components/ui/toast', () => {
	const show = (message: string) => void ui.toasts.push(message)
	return {toast: {error: show, info: show}}
})
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({useIsFilesReadOnly: () => false}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/features/files/components/file-viewer/shell/use-file-bytes', () => ({
	useFileBytes: () => ({status: 'ready', bytes: ui.bytes, revision: '"r1"'}),
}))
vi.mock('@/features/files/components/file-viewer/shell/context', () => ({
	useViewerSave: (handler: unknown, dirty: boolean) => void (ui.save = {handler, dirty}),
	useViewerDetail: () => {},
	useViewerEscape: () => {},
	ViewerTools: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock('@/features/files/components/file-viewer/sheet-viewer/grid', async () => {
	const {useEffect} = await import('react')
	return {
		Grid: (props: ComponentProps<typeof Grid>) => {
			ui.grid = props
			useEffect(() => props.onPainted?.(), [])
			return <div data-grid />
		},
	}
})
vi.mock('@/features/files/components/file-viewer/sheet-viewer/formula-bar', () => ({
	FormulaBar: (props: ComponentProps<typeof FormulaBar>) => {
		ui.bar = props
		return null
	},
}))
vi.mock('@/features/files/components/file-viewer/sheet-viewer/sheet-tabs', () => ({
	SheetTabs: (props: ComponentProps<typeof SheetTabs>) => {
		ui.tabs = props
		return null
	},
}))
vi.mock('@/features/files/components/file-viewer/sheet-viewer/fonts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadFonts: async () => {},
	measure: (_font: string, text: string) => text.length * 7,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class InPlaceWorker extends EventTarget {
	readonly #handle: (call: never) => {reply: unknown} | Promise<{reply: unknown}>
	constructor(url: URL) {
		super()
		this.#handle = url.pathname.endsWith('csv.worker.ts') ? createCsvHandler() : createXlsxHandler()
	}
	async postMessage(call: never) {
		ui.asked.push((call as {request: {type: string}}).request.type)
		this.dispatchEvent(new MessageEvent('message', {data: (await this.#handle(call)).reply}))
	}
	terminate() {}
}
vi.stubGlobal('Worker', InPlaceWorker)
// A phone on its side is a short screen
vi.stubGlobal('matchMedia', (query: string) => ({
	matches: ui.short && query === '(max-height: 500px)',
	addEventListener: () => {},
	removeEventListener: () => {},
}))

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CHARTSHEET = '<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'

let root: Root | undefined
afterEach(async () => {
	await act(async () => root?.unmount())
	root = undefined
	document.body.replaceChildren()
	ui.save = ui.grid = ui.tabs = ui.bar = undefined
	ui.toasts = []
	ui.short = false
	ui.asked = []
})

async function show(name: string, type: string, bytes: Uint8Array, mode: 'open' | 'preview' = 'open') {
	ui.bytes = bytes.slice().buffer
	const item = {name, path: `/Home/${name}`, type, size: bytes.length, operations: ['writable']}
	const container = document.body.appendChild(document.createElement('div'))
	root = createRoot(container)
	await act(async () =>
		root!.render(
			<TooltipProvider>
				<SheetViewer item={item as unknown as FileSystemItem} mode={mode} />
			</TooltipProvider>,
		),
	)
	await until(() => !!ui.grid)
	return container
}

// The worker answers in its own time: the viewer is let run until it's there
async function until(check: () => boolean) {
	for (let i = 0; i < 400 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
	expect(check()).toBe(true)
}

async function type(row: number, col: number, draft: string) {
	await act(async () => ui.grid!.onEdit({cell: {row, col}, draft, original: '', replace: true}))
	await act(async () => void ui.grid!.onCommit({rows: 1, cols: 0}))
}

test('a workbook’s edits stay savable while a chart sheet is shown', async () => {
	const stage = await show(
		'book.xlsx',
		XLSX,
		await workbook({sheets: [worksheet(''), {xml: CHARTSHEET, name: 'Chart', chartsheet: true}]}),
	)
	await type(0, 0, 'x')
	await until(() => !!ui.save?.dirty)
	await act(async () => ui.tabs!.onSelect(1))
	await until(() => !!stage.textContent?.includes('files-sheet.chart-sheet-title'))
	expect(ui.save).toEqual({handler: expect.anything(), dirty: true})
})

test('an edit the worker turns away says why, rather than vanishing', async () => {
	// The second sheet can't be read, so the workbook can't be calculated, which every edit needs
	const damaged = '<!DOCTYPE x><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
	await show('book.xlsx', XLSX, await workbook({sheets: [worksheet(''), damaged]}))
	await type(0, 0, '999')
	await until(() => ui.toasts.length === 1)
	expect(ui.toasts).toEqual(['files-sheet.edit-damaged'])

	// A formula stays open, saying so
	await type(1, 0, '=1+1')
	await until(() => !!ui.grid!.editing?.error)
	expect(ui.grid!.editing).toMatchObject({draft: '=1+1', error: 'files-sheet.edit-damaged'})
	await act(async () => ui.grid!.onEdit(undefined))

	await act(async () => ui.grid!.onPaste([['pasted']]))
	await act(async () => ui.grid!.onClear({top: 0, left: 0, bottom: 1, right: 1}))
	await until(() => ui.toasts.length === 3)
})

test('a paste on a protected sheet reaches its unlocked cells past the blocks drawn so far', async () => {
	const unlocked = Array.from({length: 400}, (_, i) => `<row r="${i + 1}"><c r="B${i + 1}" s="1"/></row>`).join('')
	const sheet = worksheet(unlocked, {after: '<sheetProtection sheet="1"/>'})
	const styles = styleSheet('<cellXfs count="2"><xf/><xf><protection locked="0"/></xf></cellXfs>')
	await show('book.xlsx', XLSX, await workbook({styles, sheets: [sheet]}))
	await act(async () => ui.grid!.onSelect({anchor: {row: 0, col: 1}, focus: {row: 0, col: 1}}))
	const lines = Array.from({length: 400}, (_, i) => [`v${i + 1}`])
	await act(async () => ui.grid!.onPaste(lines))
	await until(() => ui.grid!.selection.focus.row === 399)
	expect(await ui.grid!.fetchTexts({top: 0, left: 1, bottom: 399, right: 1})).toEqual(lines)
})

test('a CSV takes a paste past the last row a workbook can have', async () => {
	await show('long.csv', 'text/csv', new TextEncoder().encode('x\n'.repeat(1_048_580)))
	const below = {row: 1_048_576, col: 0}
	await act(async () => ui.grid!.onSelect({anchor: below, focus: below}))
	await act(async () =>
		ui.grid!.onPaste([
			['a', 'b'],
			['c', 'd'],
		]),
	)
	await until(() => ui.grid!.selection.focus.row === 1_048_577)
	expect(await ui.grid!.fetchTexts({top: 1_048_576, left: 0, bottom: 1_048_577, right: 1})).toEqual([
		['a', 'b'],
		['c', 'd'],
	])
})

test('cancelling “Save as UTF-8?” lets the next Enter ask again', async () => {
	// "Crème" in Windows-1252, which has no "→"
	await show(
		'old.csv',
		'text/csv',
		new Uint8Array([...new TextEncoder().encode('name\nCr'), 0xe8, ...new TextEncoder().encode('me\n')]),
	)
	const asked = () => !!document.body.textContent?.includes('files-sheet.utf8-title')
	await type(1, 0, 'Crème → brûlée')
	await until(asked)
	const cancel = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'cancel')!
	await act(async () => cancel.click())
	await until(() => !asked())
	await act(async () => void ui.grid!.onCommit({rows: 1, cols: 0}))
	await until(asked)
})

test('the grid starts below the notice and the find pill, and a phone on its side leaves the notice out', async () => {
	const formatted =
		'<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>'
	const bytes = await workbook({sheets: [worksheet('', {after: formatted})]})
	const stage = await show('book.xlsx', XLSX, bytes)
	const padding = () => {
		const classes = stage.querySelector('[data-grid]')!.parentElement!.classList
		return ['pt-20', 'group-has-[[role=status]]/area:pt-24'].filter((name) => classes.contains(name))
	}
	await until(() => !!stage.querySelector('[role="status"]'))
	expect(padding()).toEqual(['group-has-[[role=status]]/area:pt-24'])
	await act(async () => stage.querySelector<HTMLButtonElement>('button[aria-label="files-viewer.find"]')!.click())
	expect(padding()).toEqual(['pt-20'])

	await act(async () => root!.unmount())
	ui.short = true
	const short = await show('book.xlsx', XLSX, bytes)
	await until(() => !!short.querySelector('[role="status"]'))
	expect(short.querySelector('[role="status"]')!.closest('.hidden')).not.toBeNull()
	expect(
		short.querySelector('[data-grid]')!.parentElement!.classList.contains('group-has-[[role=status]]/area:pt-24'),
	).toBe(false)
})

test('a link finds its sheet whatever the case of its name, and never opens a hidden one', async () => {
	const links =
		'<hyperlinks><hyperlink ref="A1" location="\'Lookup\'!B2"/><hyperlink ref="A2" location="other!B3"/></hyperlinks>'
	const main = worksheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Hidden</t></is></c></row>', {after: links})
	await show(
		'book.xlsx',
		XLSX,
		await workbook({
			sheets: [
				{xml: main, name: 'Main'},
				{xml: worksheet(''), name: 'Other'},
				{xml: worksheet(''), name: 'Lookup', state: 'hidden'},
			],
		}),
	)
	await act(async () => ui.bar!.link!.open())
	await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
	expect(ui.grid!.label).toBe('Main')
	await act(async () => ui.grid!.onSelect({anchor: {row: 1, col: 0}, focus: {row: 1, col: 0}}))
	await act(async () => ui.bar!.link!.open())
	await until(() => ui.grid!.label === 'Other')
	expect(ui.grid!.selection.anchor).toEqual({row: 2, col: 1})
})

test('a burst of edits searches again once, after they’ve landed', async () => {
	const stage = await show(
		'book.xlsx',
		XLSX,
		await workbook({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}),
	)
	await act(async () => stage.querySelector<HTMLButtonElement>('button[aria-label="files-viewer.find"]')!.click())
	const field = stage.querySelector<HTMLInputElement>('input[aria-label="files-viewer.find"]')!
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '1')
		field.dispatchEvent(new Event('input', {bubbles: true}))
	})
	await until(() => ui.asked.includes('find'))
	const searches = () => ui.asked.filter((type) => type === 'find').length
	const before = searches()
	for (const row of [1, 2, 3]) await type(row, 0, '1')
	await until(() => searches() > before)
	await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
	expect(searches() - before).toBe(1)
})

test('a column picked by its header stays that column, under a merged title', async () => {
	const title =
		'<row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row r="2"><c r="D2"><v>1</v></c></row>'
	await show(
		'book.xlsx',
		XLSX,
		await workbook({
			sheets: [worksheet(title, {after: '<mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>'})],
		}),
	)
	const last = ui.grid!.source.rows.count - 1
	await act(async () => ui.grid!.onSelect({anchor: {row: 0, col: 3}, focus: {row: last, col: 3}}))
	expect([ui.grid!.selection.anchor, ui.bar!.reference]).toEqual([{row: 0, col: 3}, `D1:D${last + 1}`])
	// A cell in the merge still selects the merge, from its top-left
	await act(async () => ui.grid!.onSelect({anchor: {row: 0, col: 3}, focus: {row: 0, col: 3}}))
	expect([ui.grid!.selection.anchor, ui.bar!.reference]).toEqual([{row: 0, col: 0}, 'A1'])
})

test('the name box goes elsewhere only once what’s typed is written', async () => {
	await show('book.xlsx', XLSX, await workbook({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}))
	await act(async () => ui.grid!.onSelect({anchor: {row: 4, col: 1}, focus: {row: 4, col: 1}}))
	await act(async () => ui.grid!.onEdit({cell: {row: 4, col: 1}, draft: '=1+1)', original: '', replace: true}))
	await act(async () => void ui.bar!.onGo('H3'))
	await until(() => !!ui.grid!.editing?.error)
	expect([ui.grid!.selection.anchor, ui.grid!.editing?.cell]).toEqual([
		{row: 4, col: 1},
		{row: 4, col: 1},
	])
	// The grid waits for the write too
	await act(async () => ui.grid!.onEdit({cell: {row: 4, col: 1}, draft: '=1+1', original: '', replace: true}))
	let written: boolean | undefined
	await act(async () => void (written = await ui.grid!.onCommit({rows: 0, cols: 0})))
	expect(written).toBe(true)
	await act(async () => void ui.bar!.onGo('H3'))
	await until(() => ui.grid!.selection.anchor.col === 7)
	expect(ui.grid!.selection.anchor).toEqual({row: 2, col: 7})
})

test('⌥↓ and ⌥↑ step through the sheets that are shown, and stop at either end', async () => {
	await show(
		'book.xlsx',
		XLSX,
		await workbook({
			sheets: [
				{xml: worksheet(''), name: 'First'},
				{xml: worksheet(''), name: 'Hidden', state: 'hidden'},
				{xml: worksheet(''), name: 'Last'},
			],
		}),
	)
	const step = async (by: 1 | -1) => {
		await act(async () => ui.grid!.onSheetStep!(by))
		await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
		return ui.grid!.label
	}
	expect(await step(-1)).toBe('First')
	expect(await step(1)).toBe('Last')
	expect(await step(1)).toBe('Last')
	expect(await step(-1)).toBe('First')
})

test('a workbook of one sheet leaves ⌥↓ to the grid', async () => {
	await show('book.xlsx', XLSX, await workbook({sheets: [worksheet('')]}))
	expect(ui.grid!.onSheetStep).toBeUndefined()
})

// The items of a right-click menu, from the elements the viewer gives the grid for it
function menuItems(node: React.ReactNode): Array<{label: string; select: () => void}> {
	if (!node || typeof node !== 'object') return []
	if (Array.isArray(node)) return node.flatMap(menuItems)
	const {props} = node as React.ReactElement<{children?: React.ReactNode; onSelect?: () => void}>
	if (props.onSelect) return [{label: String(props.children), select: props.onSelect}]
	return menuItems(props.children)
}

test('a link is followed from a chip on its cell and from the cell’s menu, in quick look too', async () => {
	const opened = vi.spyOn(window, 'open').mockReturnValue(null)
	const cells = '<row r="1"><c r="A1" t="inlineStr"><is><t>Site</t></is></c><c r="B1"><v>2</v></c></row>'
	const rels = relationships(['rId1', 'hyperlink', 'https://umbrel.com/', true])
	const sheet = worksheet(cells, {after: '<hyperlinks><hyperlink ref="A1" r:id="rId1"/></hyperlinks>'})
	const bytes = await workbook({sheets: [{xml: sheet, rels}]})
	for (const mode of ['open', 'preview'] as const) {
		await show('book.xlsx', XLSX, bytes, mode)
		expect(ui.grid!.link?.label).toBe('https://umbrel.com/')
		const onCell = menuItems(ui.grid!.menu({zone: 'cell', selection: {top: 0, left: 0, bottom: 0, right: 0}}))
		expect(onCell[0].label).toBe('files-sheet.open-link')
		await act(async () => onCell[0].select())
		expect(opened).toHaveBeenLastCalledWith('https://umbrel.com/', '_blank', 'noopener,noreferrer')
		// A cell without one, or a header, has no such item
		const elsewhere = [
			ui.grid!.menu({zone: 'cell', selection: {top: 0, left: 1, bottom: 0, right: 1}}),
			ui.grid!.menu({zone: 'row', selection: {top: 0, left: 0, bottom: 0, right: 16383}}),
		]
		for (const menu of elsewhere)
			expect(menuItems(menu).map((item) => item.label)).not.toContain('files-sheet.open-link')
		await act(async () => root?.unmount())
		ui.grid = undefined
	}
	opened.mockRestore()
})

test('a locked cell says why it can’t be changed, when it’s typed into or its lock is pressed', async () => {
	const styles = styleSheet('<cellXfs count="2"><xf/><xf applyProtection="1"><protection locked="0"/></xf></cellXfs>')
	const cells = '<row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c></row>'
	const sheet = worksheet(cells, {after: '<sheetProtection sheet="1"/>'})
	await show('book.xlsx', XLSX, await workbook({styles, sheets: [sheet]}))
	await act(async () => ui.grid!.onRefused({row: 0, col: 0}))
	expect(ui.toasts).toEqual(['files-sheet.protected-cell'])
	expect(ui.bar!.lockedReason).toBe('files-sheet.protected-cell')
	await act(async () => ui.bar!.onExplain(ui.bar!.lockedReason!))
	expect(ui.toasts).toEqual(['files-sheet.protected-cell', 'files-sheet.protected-cell'])
	// B1 isn't locked
	await act(async () => ui.grid!.onSelect({anchor: {row: 0, col: 1}, focus: {row: 0, col: 1}}))
	expect(ui.bar!.lockedReason).toBeUndefined()
})

test('a paste or clear that passes over locked cells says how many it left', async () => {
	const styles = styleSheet('<cellXfs count="2"><xf/><xf applyProtection="1"><protection locked="0"/></xf></cellXfs>')
	const cells = '<row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c></row>'
	const sheet = worksheet(cells, {after: '<sheetProtection sheet="1"/>'})
	await show('book.xlsx', XLSX, await workbook({styles, sheets: [sheet]}))
	await act(async () => ui.grid!.onPaste([['x', 'y']]))
	await until(() => ui.toasts.length > 0)
	expect(ui.toasts).toEqual(['files-sheet.locked-skipped'])
	expect(ui.grid!.source.cell(0, 1)?.input).toBe('y')
	await act(async () => ui.grid!.onClear({top: 0, left: 0, bottom: 0, right: 1}))
	await until(() => ui.toasts.length > 1)
	expect(ui.grid!.source.cell(0, 0)?.input).toBe('1')
	// Pasted over unlocked cells only, it says nothing
	await act(async () => ui.grid!.onSelect({anchor: {row: 0, col: 1}, focus: {row: 0, col: 1}}))
	await act(async () => ui.grid!.onPaste([['z']]))
	await until(() => ui.grid!.source.cell(0, 1)?.input === 'z')
	expect(ui.toasts).toHaveLength(2)
})

test('a protected sheet says only its unlocked cells can be changed, while it can be changed at all', async () => {
	const bytes = await workbook({sheets: [worksheet('', {after: '<sheetProtection sheet="1"/>'})]})
	const opened = await show('book.xlsx', XLSX, bytes)
	await until(() => !!opened.querySelector('[role="status"]'))
	expect(opened.querySelector('[role="status"]')!.textContent).toBe('files-sheet.notice-protected')
	await act(async () => root!.unmount())
	const looked = await show('book.xlsx', XLSX, bytes, 'preview')
	await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
	expect(looked.querySelector('[role="status"]')).toBeNull()
})

test('the notice names what the sheet holds, and leaves saving out where nothing can be saved', async () => {
	const formatted =
		'<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>'
	const sheet = {
		xml: worksheet('', {after: formatted}),
		rels: relationships(['rId1', 'comments', '../comments1.xml']),
	}
	const notice = async (spec: Parameters<typeof workbook>[0], mode: 'open' | 'preview') => {
		const stage = await show('book.xlsx', XLSX, await workbook(spec), mode)
		await until(() => !!stage.querySelector('[role="status"]'))
		const text = stage.querySelector('[role="status"]')!.textContent
		await act(async () => root!.unmount())
		return text
	}
	const both = 'Files-viewer.notice-comments and files-viewer.notice-formatting'
	expect(await notice({sheets: [sheet]}, 'open')).toBe(`files-viewer.notice: ${both}`)
	expect(await notice({sheets: [sheet]}, 'preview')).toBe(`files-viewer.notice-read-only: ${both}`)
	// Macros have a sentence of their own, before what isn't shown, whose sentence says what a save does
	const macros = {rels: [['vbaProject', 'vbaProject.bin']] as Array<[string, string]>, extra: {'xl/vbaProject.bin': ''}}
	expect(await notice({sheets: [sheet], ...macros}, 'open')).toBe(
		`files-sheet.notice-macros-read-only files-viewer.notice: ${both}`,
	)
	expect(await notice({sheets: [worksheet('')], ...macros}, 'open')).toBe('files-sheet.notice-macros')
	expect(await notice({sheets: [worksheet('')], ...macros}, 'preview')).toBe('files-sheet.notice-macros-read-only')
})

test('a workbook that can’t be read offers it to download', async () => {
	ui.bytes = new TextEncoder().encode('not a workbook').buffer
	const item = {name: 'book.xlsx', path: '/Home/book.xlsx', type: XLSX, size: 14, operations: ['writable']}
	const container = document.body.appendChild(document.createElement('div'))
	root = createRoot(container)
	await act(async () =>
		root!.render(
			<TooltipProvider>
				<SheetViewer item={item as unknown as FileSystemItem} mode='open' />
			</TooltipProvider>,
		),
	)
	await until(() => !!container.querySelector('a[download]'))
	const link = container.querySelector<HTMLAnchorElement>('a[download]')!
	expect([link.getAttribute('href'), link.getAttribute('download'), link.textContent]).toEqual([
		'/api/files/download?path=%2FHome%2Fbook.xlsx',
		'book.xlsx',
		'files-viewer.download',
	])
})

test('undo and redo are named as in the other viewers', async () => {
	const stage = await show('book.xlsx', XLSX, await workbook({sheets: [worksheet('')]}))
	await type(0, 0, '1')
	await until(() => !!stage.querySelector('button[aria-label="files-viewer.undo"]'))
	expect(stage.querySelector('button[aria-label="files-viewer.redo"]')).not.toBeNull()
})
