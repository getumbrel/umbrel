// @vitest-environment jsdom

import {act, createRef} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

import {VirtualizedList} from './virtualized-list'

vi.mock('@/features/files/components/listing/file-item', () => ({
	FileItem: ({item}: {item: FileSystemItem}) => <span>{item.name}</span>,
}))
vi.mock('@/features/files/components/listing/file-item/file-item-context', () => ({
	FileItemProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock('@/hooks/use-container-size', () => ({useContainerSize: () => ({width: 600, height: 300})}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const entry = (name: string): FileSystemItem => ({
	path: `/Home/${name}`,
	name,
	type: 'text/plain',
	modified: 1,
	size: 1,
	operations: ['rename'],
})
const renamed = entry('renamed')
const others = Array.from({length: 80}, (_, index) => entry(`file-${index}`))
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
let root: Root
let container: HTMLDivElement
let scrollAreaRef: React.RefObject<HTMLDivElement | null>
let scrollTo: ReturnType<typeof vi.fn>
let onLoadMore: ReturnType<typeof vi.fn<() => Promise<boolean>>>

beforeEach(() => {
	useFilesStore.setState({selectedItems: [], incomingItems: [], pendingPaths: new Map()})
	scrollAreaRef = createRef<HTMLDivElement>()
	container = document.createElement('div')
	root = createRoot(container)
	onLoadMore = vi.fn().mockResolvedValue(false)
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
		return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '') || 300
	})
	// Keep react-window and InfiniteLoader real, including the native scroll
	// event and browser bounds that can clamp the last row under the fade.
	scrollTo = vi.fn(function (this: HTMLElement, {top}: {top: number}) {
		this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight))
		this.dispatchEvent(new Event('scroll'))
	})
	Object.defineProperty(HTMLElement.prototype, 'scrollTo', {configurable: true, value: scrollTo})
})
afterEach(() => {
	act(() => root.unmount())
	vi.restoreAllMocks()
	if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
	else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
})

async function render(
	items: FileSystemItem[],
	view: 'list' | 'icons',
	{hasMore = false, hiddenRenamedPaths = []}: {hasMore?: boolean; hiddenRenamedPaths?: string[]} = {},
) {
	await act(async () => {
		root.render(
			<VirtualizedList
				items={items}
				view={view}
				isLoading={false}
				hasMore={hasMore}
				hiddenRenamedPaths={hiddenRenamedPaths}
				onLoadMore={onLoadMore}
				scrollAreaRef={scrollAreaRef}
			/>,
		)
	})
}
function scroll(top: number) {
	act(() => scrollAreaRef.current!.scrollTo({top}))
}
const rowFor = (path: string) => container.querySelector<HTMLElement>(`[data-marquee-selection-item-path="${path}"]`)
const firstPage = Array.from({length: 250}, (_, index) => entry(`file-${String(index).padStart(4, '0')}`))

describe.each(['list', 'icons'] as const)('selection reveal in %s view', (view) => {
	test('renders an offscreen selection and clears the bottom fade', async () => {
		useFilesStore.setState({selectedItems: [renamed]})
		await render([...others, renamed], view)
		const row = rowFor(renamed.path)
		expect(row).not.toBeNull()
		const bottom =
			Number.parseFloat(row!.style.top) + Number.parseFloat(row!.style.height) - scrollAreaRef.current!.scrollTop
		expect(bottom).toBeLessThanOrEqual(300 - 48)
	})

	test('reveals a visible rename once without following later metadata or page reorders', async () => {
		const source = entry('original')
		const incoming = {...renamed, renamedFrom: source.path}
		useFilesStore.setState({selectedItems: [source]})
		await render([source, ...others], view)
		await act(async () => {
			useFilesStore.getState().addIncomingItems([incoming])
			useFilesStore.getState().setSelectedItems([incoming])
		})
		scrollTo.mockClear()
		await render([...others, incoming], view)
		expect(scrollTo).toHaveBeenCalledTimes(1)
		expect(rowFor(incoming.path)).not.toBeNull()
		scroll(500)
		const manualTop = scrollAreaRef.current!.scrollTop
		scrollTo.mockClear()
		await render([{...renamed, type: 'image/png'}, ...others, entry('another-file')], view)
		await act(async () => useFilesStore.getState().removeIncomingItems([incoming.path]))
		expect(scrollTo).not.toHaveBeenCalled()
		expect(scrollAreaRef.current!.scrollTop).toBe(manualTop)
	})

	test('waits for delayed rename props without paging, and reveals the result if it is visible', async () => {
		const incoming = {...renamed, renamedFrom: firstPage[0].path}
		useFilesStore.setState({selectedItems: [firstPage[0]]})
		await render(firstPage, view, {hasMore: true})
		scrollTo.mockClear()
		await act(async () => {
			useFilesStore.getState().addIncomingItems([incoming])
			useFilesStore.getState().setSelectedItems([incoming])
		})
		await render([...firstPage], view, {hasMore: true})
		expect(onLoadMore).not.toHaveBeenCalled()
		expect(scrollTo).not.toHaveBeenCalled()
		await render([...firstPage.slice(1), incoming], view)
		expect(scrollTo).toHaveBeenCalledTimes(1)
		expect(rowFor(incoming.path)).not.toBeNull()
	})

	test('consumes a hidden rename without paging or a later jump, but allows a new selection to reveal it', async () => {
		const incoming = {...renamed, renamedFrom: firstPage[0].path}
		useFilesStore.setState({selectedItems: [incoming], incomingItems: [incoming]})
		await render(firstPage, view, {hasMore: true, hiddenRenamedPaths: [incoming.path]})
		expect(onLoadMore).not.toHaveBeenCalled()
		expect(scrollTo).not.toHaveBeenCalled()
		await render([...firstPage, renamed], view)
		expect(scrollTo).not.toHaveBeenCalled()
		expect(scrollAreaRef.current!.scrollTop).toBe(0)

		await act(async () => useFilesStore.getState().clearSelectedItems())
		await act(async () => useFilesStore.getState().setSelectedItems([renamed]))
		expect(scrollTo).toHaveBeenCalledTimes(1)
		expect(rowFor(renamed.path)).not.toBeNull()
	})

	test.each(['deep link', 'new folder', 'stale incoming rename'] as const)(
		'keeps ordinary paging for a %s selection',
		async (kind) => {
			const incoming =
				kind === 'stale incoming rename' ? {...renamed, renamedFrom: '/Home/old-name'} : {...renamed, type: 'directory'}
			useFilesStore.setState({
				selectedItems: [kind === 'new folder' ? incoming : renamed],
				incomingItems: kind === 'deep link' ? [] : [incoming],
			})
			await render(firstPage, view, {
				hasMore: true,
				// A stale hidden path must not swallow a fresh same-path deep link.
				hiddenRenamedPaths: kind === 'stale incoming rename' ? [renamed.path] : [],
			})
			expect(onLoadMore).toHaveBeenCalledTimes(1)
			expect(scrollTo).not.toHaveBeenCalled()
			await render([...firstPage, renamed], view)
			expect(rowFor(renamed.path)).not.toBeNull()
			expect(scrollTo).toHaveBeenCalledTimes(1)
		},
	)

	test('does not jump to a hidden rename when an old second page finishes before rename invalidation', async () => {
		// Browser scroll events are deferred, independently of React updates.
		const pendingScrollEvents = new Set<HTMLElement>()
		scrollTo.mockImplementation(function (this: HTMLElement, {top}: {top: number}) {
			this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight))
			pendingScrollEvents.add(this)
		})
		const flushScrollEvents = () =>
			act(() => {
				const elements = [...pendingScrollEvents]
				pendingScrollEvents.clear()
				elements.forEach((element) => element.dispatchEvent(new Event('scroll')))
			})
		let finishPage!: (value: boolean) => void
		onLoadMore.mockReturnValue(
			new Promise<boolean>((resolve) => {
				finishPage = resolve
			}),
		)
		const photos = Array.from({length: 398}, (_, index) => entry(`IMG_${String(index).padStart(4, '0')}.jpg`))
		const source = photos[162]
		const sunset = {...source, name: 'sunset.jpg', path: '/Home/sunset.jpg', renamedFrom: source.path}
		useFilesStore.getState().setSelectedItems([source])
		await render(photos.slice(0, 250), view, {hasMore: true})
		flushScrollEvents()
		const previousTop = scrollAreaRef.current!.scrollTop
		scrollTo.mockClear()
		onLoadMore.mockClear()

		// The selection store updates before the parent's listing props.
		await act(async () => {
			useFilesStore.getState().addPendingPaths([source.path], 'removing')
			useFilesStore.getState().addIncomingItems([sunset])
			useFilesStore.getState().setSelectedItems([sunset])
		})
		expect(onLoadMore).not.toHaveBeenCalled()
		await render(
			photos.slice(0, 250).filter((item) => item !== source),
			view,
			{
				hasMore: true,
				hiddenRenamedPaths: [sunset.path],
			},
		)
		// The old second page makes the whole folder known. The rename becomes
		// visible, but its hidden selection has already been handled.
		const loaded = [...photos.filter((item) => item !== source), sunset]
		await render(loaded, view)
		await act(async () => finishPage(true))
		flushScrollEvents()
		await render(
			loaded.map((item) => ({...item})),
			view,
		)
		await act(async () => useFilesStore.getState().removeIncomingItems([sunset.path]))
		flushScrollEvents()
		expect(useFilesStore.getState().selectedItems[0].path).toBe(sunset.path)
		expect(scrollTo).not.toHaveBeenCalled()
		expect(scrollAreaRef.current!.scrollTop).toBe(previousTop)
	})
})
