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
