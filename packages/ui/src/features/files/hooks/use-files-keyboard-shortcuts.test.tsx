// @vitest-environment jsdom

import {act, useRef} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {useFilesKeyboardShortcuts} from '@/features/files/hooks/use-files-keyboard-shortcuts'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('react-router-dom', () => ({useNavigate: () => vi.fn()}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/hooks/use-files-operations', () => ({
	useFilesOperations: () => ({pasteItemsFromClipboard: vi.fn(), trashSelectedItems: vi.fn()}),
}))
vi.mock('@/features/files/hooks/use-navigate', () => ({
	useNavigate: () => ({currentPath: '/Home', navigateToItem: vi.fn(), navigateToDirectory: vi.fn()}),
}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({useIsFilesReadOnly: () => false}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/utils/dialog', () => ({useLinkToDialog: () => vi.fn()}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const file = (name: string, type: string) =>
	({name, path: `/Home/${name}`, type, size: 1, modified: 0, operations: []}) as unknown as FileSystemItem
// A folder of pictures, with documents between them whose viewers keep ←/→ (pages) once opened
const items = [
	file('a.jpg', 'image/jpeg'),
	file('b.pdf', 'application/pdf'),
	file('c.jpg', 'image/jpeg'),
	file('d.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
]

function Listing() {
	const listingRef = useRef<HTMLDivElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	useFilesKeyboardShortcuts({items, listingRef, scrollAreaRef, view: 'list'})
	return <div ref={listingRef} />
}

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
	useFilesStore.setState({viewerItem: null, viewerMode: null, viewerNavigationGuard: null})
	container = document.createElement('div')
	root = createRoot(container)
	await act(async () => root.render(<Listing />))
})
afterEach(async () => {
	await act(async () => root.unmount())
})

const view = async (item: FileSystemItem, mode: 'open' | 'preview') =>
	act(async () => void useFilesStore.getState().setViewerItem(item, mode))
const step = async (direction: 'previous' | 'next') =>
	act(async () => useFilesStore.getState().viewerStepper!.step(direction))
const viewing = () => useFilesStore.getState().viewerItem?.name

test('an opened file steps past files whose viewer would keep the arrows, so the arrows always step back', async () => {
	await view(items[0], 'open')
	await step('next')
	expect(viewing()).toBe('c.jpg')
	expect(useFilesStore.getState().viewerStepper!.canStep('next')).toBe(false)
	await step('previous')
	expect(viewing()).toBe('a.jpg')
})

test('a quick look steps through every file', async () => {
	await view(items[0], 'preview')
	await step('next')
	expect(viewing()).toBe('b.pdf')
	await step('next')
	await step('next')
	expect(viewing()).toBe('d.docx')
})

// Audio plays in its island, with nothing over the listing: the listing hears a quick look's keys
test('Space and Escape close a quick look playing in an island, and leave an opened one be', async () => {
	const song = file('song.mp3', 'audio/mpeg')
	const press = async (key: string) =>
		act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', {key, cancelable: true})))
	for (const key of [' ', 'Escape']) {
		await view(song, 'preview')
		await press(key)
		expect(viewing()).toBeUndefined()
	}
	await view(song, 'open')
	await press('Escape')
	await press(' ')
	expect(viewing()).toBe('song.mp3')
})

// A folder as the app lists it: its rows reach the hook as a new array every
// time the listing renders, which a change of selection makes it do
const rows = [
	...Array.from({length: 12}, (_, index) => file(`Report ${String(index).padStart(2, '0')}.txt`, 'text/plain')),
	file('Zettel 0007.md', 'text/markdown'),
	file('Zettel 4607.md', 'text/markdown'),
]
function Rows() {
	const listingRef = useRef<HTMLDivElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	const selection = useFilesStore((state) => state.selectedItems)
	const items = rows.filter((row) => row !== (selection as unknown))
	useFilesKeyboardShortcuts({items, listingRef, scrollAreaRef, view: 'list'})
	return <div ref={listingRef} />
}
const press = async (key: string, init: KeyboardEventInit = {}) =>
	act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', {key, cancelable: true, ...init})))
const selected = () => useFilesStore.getState().selectedItems.map((item) => item.name)
const select = async (...items: FileSystemItem[]) => act(async () => useFilesStore.getState().setSelectedItems(items))

test('Shift with the arrows extends the selection from where it began, and gives rows back on the way home', async () => {
	await act(async () => root.render(<Rows />))
	await select(rows[2])
	await press('ArrowDown')
	await press('ArrowDown')
	expect(selected()).toEqual(['Report 04.txt'])
	for (let step = 0; step < 3; step++) await press('ArrowDown', {shiftKey: true})
	expect(selected()).toEqual(['Report 04.txt', 'Report 05.txt', 'Report 06.txt', 'Report 07.txt'])
	await press('ArrowUp', {shiftKey: true})
	expect(selected()).toEqual(['Report 04.txt', 'Report 05.txt', 'Report 06.txt'])
	// Past where it began, the range runs the other way
	for (let step = 0; step < 3; step++) await press('ArrowUp', {shiftKey: true})
	expect(selected()).toEqual(['Report 03.txt', 'Report 04.txt'])
	// An arrow alone goes on from the moving end
	await press('ArrowUp')
	expect(selected()).toEqual(['Report 02.txt'])
})

test('after a Shift+click the arrows go on from the end of its range that was clicked', async () => {
	await act(async () => root.render(<Rows />))
	// Row 8 clicked, then row 5 with Shift held: the clicked row stays first (see useItemClick)
	await select(rows[8], rows[5], rows[6], rows[7])
	await press('ArrowUp', {shiftKey: true})
	expect(selected()).toEqual(['Report 04.txt', 'Report 05.txt', 'Report 06.txt', 'Report 07.txt', 'Report 08.txt'])
	await press('ArrowDown', {shiftKey: true})
	await press('ArrowDown', {shiftKey: true})
	expect(selected()).toEqual(['Report 06.txt', 'Report 07.txt', 'Report 08.txt'])
	// Everything selected in the listing's order: the arrows go on from its last item
	await select(...rows.slice(2, 5))
	await press('ArrowDown', {shiftKey: true})
	expect(selected()).toEqual(['Report 02.txt', 'Report 03.txt', 'Report 04.txt', 'Report 05.txt'])
	// A click starts over
	await select(rows[9])
	await press('ArrowDown', {shiftKey: true})
	expect(selected()).toEqual(['Report 09.txt', 'Report 10.txt'])
})

test('typing a name finds it, spaces and all, and Space alone still looks at the selected file', async () => {
	await act(async () => root.render(<Rows />))
	for (const key of 'zettel 46') await press(key)
	expect(selected()).toEqual(['Zettel 4607.md'])
	expect(viewing()).toBeUndefined()
	// Once the typing has gone quiet, Space is a quick look again
	await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 750))))
	await press(' ')
	expect(viewing()).toBe('Zettel 4607.md')
})

// A long folder, of which the listing has only loaded the start
function PartlyLoaded({loaded, onLoadAll}: {loaded: FileSystemItem[]; onLoadAll: () => Promise<boolean>}) {
	const listingRef = useRef<HTMLDivElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	useFilesKeyboardShortcuts({
		items: loaded,
		hasMore: loaded.length < rows.length,
		onLoadAll,
		listingRef,
		scrollAreaRef,
		view: 'list',
	})
	return <div ref={listingRef} />
}

test('a typed name that is not loaded yet has the rest of the folder loaded, and is found when it lands', async () => {
	const onLoadAll = vi.fn(async () => true)
	const start = rows.slice(0, 5)
	await act(async () => root.render(<PartlyLoaded loaded={start} onLoadAll={onLoadAll} />))
	await select(start[1])
	for (const key of 'zettel 46') await press(key)
	expect(onLoadAll).toHaveBeenCalled()
	expect(selected()).toEqual(['Report 01.txt'])
	await act(async () => root.render(<PartlyLoaded loaded={rows} onLoadAll={onLoadAll} />))
	expect(selected()).toEqual(['Zettel 4607.md'])
})

test('…unless something else has been selected by then', async () => {
	const onLoadAll = vi.fn(async () => true)
	const start = rows.slice(0, 5)
	await act(async () => root.render(<PartlyLoaded loaded={start} onLoadAll={onLoadAll} />))
	for (const key of 'zettel') await press(key)
	await select(start[3])
	await act(async () => root.render(<PartlyLoaded loaded={rows} onLoadAll={onLoadAll} />))
	expect(selected()).toEqual(['Report 03.txt'])
})

test('⌘A leaves selecting everything to the listing, which knows what it has yet to load', async () => {
	const selectAll = vi.fn()
	await act(async () => root.render(<Rows />))
	await press('a', {metaKey: true})
	expect(selected()).toHaveLength(rows.length)
	await act(async () => useFilesStore.getState().setSelectAllHandler(selectAll))
	await select()
	await press('a', {metaKey: true})
	expect(selectAll).toHaveBeenCalledTimes(1)
	expect(selected()).toEqual([])
	await act(async () => useFilesStore.getState().setSelectAllHandler(null))
})

test('nothing is copied, cut or trashed while Select all is still loading the rest of the folder', async () => {
	await act(async () => root.render(<Rows />))
	const copyable = (item: FileSystemItem) => ({...item, operations: ['copy', 'move']}) as FileSystemItem
	await select(copyable(rows[0]), copyable(rows[1]))
	await act(async () => useFilesStore.getState().setIsSelectingAll(true))
	await press('c', {metaKey: true})
	await press('x', {metaKey: true})
	expect(useFilesStore.getState().clipboardItems).toEqual([])
	await act(async () => useFilesStore.getState().setIsSelectingAll(false))
	await press('c', {metaKey: true})
	expect(useFilesStore.getState().clipboardItems.map((item) => item.name)).toEqual(['Report 00.txt', 'Report 01.txt'])
	await act(async () => useFilesStore.getState().clearClipboard())
})

test('Escape lets go of the selection, and leaves a name being typed and an open viewer their own Escape', async () => {
	await act(async () => root.render(<Rows />))
	await select(rows[1], rows[2], rows[3])
	await press('Escape')
	expect(selected()).toEqual([])

	// In a field, Escape is the field's
	await select(rows[1])
	const field = document.createElement('input')
	document.body.append(field)
	await act(async () => void field.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
	expect(selected()).toEqual(['Report 01.txt'])
	field.remove()

	// With a file open over the listing, Escape is the viewer's
	await view(rows[1], 'open')
	await press('Escape')
	expect(selected()).toEqual(['Report 01.txt'])
	await act(async () => void useFilesStore.getState().setViewerItem(null))

	// A drag is called off by Escape without losing what was being dragged
	await act(async () => useFilesStore.setState({draggedItems: [rows[1]]}))
	await press('Escape')
	expect(selected()).toEqual(['Report 01.txt'])
	await act(async () => useFilesStore.setState({draggedItems: []}))
})

test('on a touch screen that is selecting, Escape clears the selection, then leaves selecting', async () => {
	await act(async () => root.render(<Rows />))
	await act(async () => useFilesStore.getState().setIsSelectingOnMobile(true))
	await select(rows[1], rows[2])
	await press('Escape')
	expect(selected()).toEqual([])
	expect(useFilesStore.getState().isSelectingOnMobile).toBe(true)
	await press('Escape')
	expect(useFilesStore.getState().isSelectingOnMobile).toBe(false)
})
