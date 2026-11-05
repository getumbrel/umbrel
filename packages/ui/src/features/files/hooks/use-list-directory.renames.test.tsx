// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

import {useListDirectory} from './use-list-directory'

const mocks = vi.hoisted(() => ({list: vi.fn()}))
vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('@/features/files/hooks/use-network-shares-query', () => ({
	useNetworkSharesQuery: () => ({data: [], isPending: false}),
}))
vi.mock('@/features/files/hooks/use-preferences', () => ({usePreferences: () => ({preferences: undefined})}))
vi.mock('@/features/files/transfers/use-transfers', () => ({useUploadListingItems: () => []}))
vi.mock('@/features/files/transfers/transfers', () => ({
	transfers: {onTransition: () => () => {}, acknowledgeListed: vi.fn()},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type Directory = RouterOutput['files']['list']
const entry = (name: string, type = 'text/plain'): FileSystemItem => ({
	name,
	path: `/Home/${name}`,
	type,
	modified: 1,
	size: 1,
	operations: ['rename', 'move'],
})
const page = (files: FileSystemItem[], hasMore = true): Directory => ({
	path: '/Home',
	name: 'Home',
	type: 'directory',
	modified: 1,
	operations: ['writable'],
	files,
	hasMore,
	totalFiles: hasMore ? 100_000 : files.length,
})
let client: QueryClient
let rpcClient: ReturnType<typeof trpcReact.createClient>
let root: Root
let result: ReturnType<typeof useListDirectory>

function Harness(options: Parameters<typeof useListDirectory>[1]) {
	result = useListDirectory('/Home', options)
	return null
}
async function render(options: Parameters<typeof useListDirectory>[1] = {}) {
	await act(async () =>
		root.render(
			<trpcReact.Provider client={rpcClient} queryClient={client}>
				<QueryClientProvider client={client}>
					<Harness {...options} />
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
}
function rename(source: FileSystemItem, name: string) {
	const renamed = {...source, name, path: `/Home/${name}`, renamedFrom: source.path}
	act(() => {
		const store = useFilesStore.getState()
		store.addPendingPaths([source.path], 'removing')
		store.addIncomingItems([renamed])
		store.setSelectedItems([renamed])
	})
	return renamed
}
const names = () => result.listing?.items.map((item) => item.name)

beforeEach(() => {
	notifyManager.setScheduler(queueMicrotask)
	client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: 60_000}}})
	useFilesStore.setState({pendingPaths: new Map(), incomingItems: [], selectedItems: []})
	rpcClient = trpcReact.createClient({
		links: [
			() =>
				({op}) =>
					observable((observer) => {
						if (op.path !== 'files.list') throw new Error(`Unexpected procedure: ${op.path}`)
						Promise.resolve(mocks.list(op.input)).then(
							(data) => {
								observer.next({result: {data}})
								observer.complete()
							},
							(error) => observer.error(TRPCClientError.from(error)),
						)
						return () => {}
					}),
		],
	})
	root = createRoot(document.createElement('div'))
})
afterEach(async () => {
	await act(async () => root.unmount())
	client.clear()
	vi.resetAllMocks()
	notifyManager.setScheduler((callback) => setTimeout(callback, 0))
})

test('hides an out-of-range rename without fetching or losing selection in a large folder', async () => {
	const loaded = Array.from({length: 250}, (_, index) => entry(`file-${String(index).padStart(4, '0')}`))
	mocks.list.mockResolvedValue(page(loaded))
	await render()
	const renamed = rename(loaded[162], 'zulu')
	await render()
	expect(names()).not.toContain('zulu')
	expect(names()).not.toContain(loaded[162].name)
	expect(result.listing?.items).toHaveLength(249)
	expect(result.listing?.totalFiles).toBe(100_000)
	expect(result.listing?.hiddenRenamedPaths).toEqual([renamed.path])
	expect(useFilesStore.getState().selectedItems).toEqual([renamed])
	expect(useFilesStore.getState().incomingItems).toEqual([renamed])
	expect(mocks.list).toHaveBeenCalledTimes(1)
	expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({limit: 250}))
})

test.each([
	{order: 'ascending' as const, loaded: ['alpha', 'middle', 'tango'], outside: 'zulu'},
	{order: 'descending' as const, loaded: ['tango', 'middle', 'alpha'], outside: 'aardvark'},
])('uses the trailing boundary in $order order', async ({order, loaded: names, outside}) => {
	const loaded = names.map((name) => entry(name))
	mocks.list.mockResolvedValue(page(loaded))
	await render({sortOrder: order})
	const renamed = rename(loaded[1], outside)
	expect(result.listing?.items.map((item) => item.name)).toEqual([names[0], names[2]])
	expect(result.listing?.hiddenRenamedPaths).toEqual([renamed.path])
	expect(useFilesStore.getState().selectedItems).toEqual([renamed])
	expect(mocks.list).toHaveBeenCalledTimes(1)
})

test.each([
	{order: 'ascending' as const, loaded: ['alpha', 'middle', 'tango'], inside: 'sierra'},
	{order: 'descending' as const, loaded: ['tango', 'middle', 'alpha'], inside: 'bravo'},
])('keeps an inward rename of the boundary row visible in $order order', async ({order, loaded: names, inside}) => {
	const loaded = names.map((name) => entry(name))
	mocks.list.mockResolvedValue(page(loaded))
	await render({sortOrder: order})
	const renamed = rename(loaded[2], inside)
	// Hiding the old boundary before deciding the range would incorrectly hide this row.
	expect(result.listing?.items.map((item) => item.name)).toEqual([names[0], names[1], inside])
	expect(result.listing?.hiddenRenamedPaths).toEqual([])
	expect(useFilesStore.getState().selectedItems).toEqual([renamed])
	expect(mocks.list).toHaveBeenCalledTimes(1)
})

test.each([
	{source: 1, name: 'photo20.jpg', visible: false},
	{source: 2, name: 'photo3.jpg', visible: true},
])('uses type then natural filename order for rename $name', async ({source, name, visible}) => {
	const loaded = [
		entry('zulu.pdf', 'application/pdf'),
		entry('photo2.jpg', 'image/jpeg'),
		entry('photo10.jpg', 'image/jpeg'),
	]
	mocks.list.mockResolvedValue(page(loaded))
	await render({sortBy: 'type'})
	const renamed = rename(loaded[source], name)
	expect(names()?.includes(name)).toBe(visible)
	expect(result.listing?.hiddenRenamedPaths).toEqual(visible ? [] : [renamed.path])
	expect(mocks.list).toHaveBeenCalledTimes(1)
})

test('keeps a rename visible beyond the old boundary when the folder is fully loaded', async () => {
	const loaded = ['alpha', 'middle', 'tango'].map((name) => entry(name))
	mocks.list.mockResolvedValue(page(loaded, false))
	await render()
	rename(loaded[1], 'zulu')
	expect(names()).toEqual(['alpha', 'tango', 'zulu'])
	expect(result.listing?.hiddenRenamedPaths).toEqual([])
})

test('does not apply rename hiding to a newly created folder in a partially loaded directory', async () => {
	mocks.list.mockResolvedValue(page(['alpha', 'middle', 'tango'].map((name) => entry(name))))
	await render()
	const folder = {...entry('zulu-folder', 'directory'), operations: [], capabilitiesPending: true}
	act(() => useFilesStore.getState().addIncomingItems([folder]))
	expect(names()).toEqual(['alpha', 'middle', 'tango', 'zulu-folder'])
	expect(result.listing?.hiddenRenamedPaths).toEqual([])
	expect(mocks.list).toHaveBeenCalledTimes(1)
})

test('allows a hidden rename into the range only after an explicit page request extends it', async () => {
	const loaded = ['alpha', 'middle', 'tango'].map((name) => entry(name))
	mocks.list.mockResolvedValueOnce(page(loaded)).mockResolvedValueOnce(page([entry('victor'), entry('zz-end')]))
	await render()
	const renamed = rename(loaded[1], 'zulu')
	expect(names()).not.toContain('zulu')
	expect(mocks.list).toHaveBeenCalledTimes(1)
	await act(async () => {
		await result.fetchMoreItems()
	})
	expect(names()).toEqual(['alpha', 'tango', 'victor', 'zulu', 'zz-end'])
	expect(result.listing?.hiddenRenamedPaths).toEqual([])
	expect(useFilesStore.getState().selectedItems).toEqual([renamed])
	expect(mocks.list).toHaveBeenCalledTimes(2)
	expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({lastFile: 'tango', limit: 250}))
})

test('does not request more pages when a 398-item directory already has a page in flight during rename', async () => {
	const photos = Array.from({length: 398}, (_, index) =>
		entry(`IMG_${String(index).padStart(4, '0')}.jpg`, 'image/jpeg'),
	)
	let finishPage!: (value: Directory) => void
	mocks.list.mockResolvedValueOnce({...page(photos.slice(0, 250)), totalFiles: 398}).mockImplementationOnce(
		() =>
			new Promise<Directory>((resolve) => {
				finishPage = resolve
			}),
	)
	await render()
	let pending!: Promise<boolean>
	await act(async () => {
		pending = result.fetchMoreItems()
	})
	const sunset = rename(photos[162], 'sunset.jpg')
	expect(names()).not.toContain(sunset.name)
	expect(result.listing?.hiddenRenamedPaths).toEqual([sunset.path])
	expect(mocks.list).toHaveBeenCalledTimes(2)
	// This response was read before the rename and contains no authoritative sunset row.
	await act(async () => {
		finishPage({...page(photos.slice(250), false), totalFiles: 398})
		await pending
	})
	await render()
	expect(names()?.at(-1)).toBe(sunset.name)
	expect(result.listing?.items).toHaveLength(398)
	expect(result.listing?.hasMore).toBe(false)
	expect(useFilesStore.getState().selectedItems).toEqual([sunset])
	expect(mocks.list).toHaveBeenCalledTimes(2)
})
