// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact, type RouterInput, type RouterOutput} from '@/trpc/trpc'

import {useListDirectory} from './use-list-directory'

const mocks = vi.hoisted(() => ({list: vi.fn(), snapshot: {batches: [], items: new Map(), wake: 0}}))
vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('@/features/files/transfers/transfers', () => ({
	transfers: {
		subscribe: () => () => {},
		snapshot: () => mocks.snapshot,
		onTransition: () => () => {},
		acknowledgeListed: vi.fn(),
	},
}))
vi.mock('@/features/files/hooks/use-network-shares-query', () => ({
	useNetworkSharesQuery: () => ({data: [], isPending: false}),
}))
vi.mock('@/features/files/hooks/use-preferences', () => ({usePreferences: () => ({preferences: undefined})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type ListInput = RouterInput['files']['list']
type Directory = RouterOutput['files']['list']
const entry = (folder: string, index: number, changes: Partial<FileSystemItem> = {}): FileSystemItem => ({
	name: `file-${String(index).padStart(5, '0')}`,
	path: `${folder}/file-${String(index).padStart(5, '0')}`,
	type: 'text/plain',
	size: 1,
	modified: 1,
	operations: ['move', 'rename', 'trash'],
	...changes,
})
// What is on the server: one folder of 12,000 files, and a small one beside it
let files: FileSystemItem[]
let client: QueryClient
let root: Root
let result: ReturnType<typeof useListDirectory>
let utils: ReturnType<typeof trpcReact.useUtils>

function listing({path, lastFile, limit = 250}: ListInput): Directory {
	const entries = files
		.filter((item) => item.path.slice(0, item.path.lastIndexOf('/')) === path)
		.sort((a, b) => a.name.localeCompare(b.name))
	const start = lastFile ? Math.max(0, entries.findIndex((item) => item.name === lastFile) + 1) : 0
	return {
		path,
		name: path.split('/').pop()!,
		type: 'directory',
		modified: 1,
		operations: ['writable'],
		files: entries.slice(start, start + limit),
		totalFiles: entries.length,
		hasMore: start + limit < entries.length,
	}
}
function Harness({path}: {path: string}) {
	result = useListDirectory(path)
	utils = trpcReact.useUtils()
	return null
}
const names = () => result.listing?.items.map((item) => item.name) ?? []
const requests = () => mocks.list.mock.calls.map(([input]) => input as ListInput)
const fetchMore = () =>
	act(async () => {
		await result.fetchMoreItems()
	})
const refresh = () => act(() => utils.files.list.invalidate({path: '/Home'}))
// Let a re-read that a refresh set off land
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))
let rpcClient: ReturnType<typeof trpcReact.createClient>
const render = (path = '/Home') =>
	act(async () =>
		root.render(
			<trpcReact.Provider client={rpcClient} queryClient={client}>
				<QueryClientProvider client={client}>
					<Harness path={path} />
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)

beforeEach(async () => {
	notifyManager.setScheduler(queueMicrotask)
	client = new QueryClient({defaultOptions: {queries: {staleTime: 60_000, retry: false, gcTime: Infinity}}})
	files = [
		...Array.from({length: 12_000}, (_, index) => entry('/Home', index)),
		...Array.from({length: 3}, (_, index) => entry('/Other', index)),
	]
	mocks.list.mockImplementation(async (input: ListInput) => listing(input))
	useFilesStore.setState({pendingPaths: new Map(), incomingItems: [], selectedItems: []})
	rpcClient = trpcReact.createClient({
		links: [
			() =>
				({op}) =>
					observable((observer) => {
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
	await render()
})
afterEach(async () => {
	await act(async () => root.unmount())
	client.clear()
	vi.clearAllMocks()
	notifyManager.setScheduler((callback) => setTimeout(callback, 0))
})

test('each page asked for while scrolling is as long as what is loaded, up to a ceiling', async () => {
	expect(result.listing?.items).toHaveLength(250)
	const loaded: number[] = []
	for (let page = 0; page < 6; page++) {
		await fetchMore()
		loaded.push(result.listing!.items.length)
	}
	expect(loaded).toEqual([500, 1000, 2000, 4000, 6500, 9000])
	expect(
		requests()
			.slice(1)
			.map(({limit, lastFile}) => [limit, lastFile]),
	).toEqual([
		[250, 'file-00249'],
		[500, 'file-00499'],
		[1000, 'file-00999'],
		[2000, 'file-01999'],
		[2500, 'file-03999'],
		[2500, 'file-06499'],
	])
})

test('asked twice while a page is on its way, it is asked of the server once', async () => {
	let both!: Promise<boolean[]>
	await act(async () => {
		both = Promise.all([result.fetchMoreItems(), result.fetchMoreItems()])
		await both
	})
	expect(await both).toEqual([true, true])
	expect(mocks.list).toHaveBeenCalledTimes(2)
	expect(result.listing?.items).toHaveLength(500)
})

test('the rest of a folder loads in a few large steps, after any page already on its way', async () => {
	let done!: boolean
	await act(async () => {
		void result.fetchMoreItems()
		done = await result.fetchAllItems()
	})
	expect(done).toBe(true)
	expect(result.listing?.hasMore).toBe(false)
	expect(result.listing?.items).toHaveLength(12_000)
	expect(new Set(names()).size).toBe(12_000)
	// The page that was on its way, then the rest 5,000 at a time
	expect(
		requests()
			.slice(1)
			.map(({limit}) => limit),
	).toEqual([250, 5000, 5000, 5000])
	// Nothing left to ask for
	await act(async () => expect(await result.fetchAllItems()).toBe(true))
	expect(mocks.list).toHaveBeenCalledTimes(5)
})

test('a folder that fits in its first page has nothing more to load', async () => {
	await render('/Other')
	expect(names()).toHaveLength(3)
	await act(async () => expect(await result.fetchAllItems()).toBe(true))
	await act(async () => expect(await result.fetchMoreItems()).toBe(false))
	expect(requests().filter(({path}) => path === '/Other')).toHaveLength(1)
})

test('a page that lands after Files has moved to another folder is not shown there', async () => {
	let land!: (page: Directory) => void
	mocks.list.mockImplementationOnce(() => new Promise<Directory>((resolve) => (land = resolve)))
	let pending!: Promise<boolean>
	await act(async () => {
		pending = result.fetchMoreItems()
	})
	await render('/Other')
	await act(async () => {
		land(listing({path: '/Home', lastFile: 'file-00249'}))
		expect(await pending).toBe(false)
	})
	expect(names()).toEqual(['file-00000', 'file-00001', 'file-00002'])
	expect(result.listing?.hasMore).toBe(false)
})

test('when the first page is read again, so are the pages after it', async () => {
	await fetchMore()
	await fetchMore()
	expect(result.listing?.items).toHaveLength(1000)
	const before = result.listing!.items
	const calls = mocks.list.mock.calls.length

	// Nothing has changed: the pages are read again, and nothing drawn from them is touched
	await refresh()
	await settle()
	expect(
		requests()
			.slice(calls)
			.map(({limit, lastFile}) => [limit, lastFile]),
	).toEqual([
		[250, undefined],
		[750, 'file-00249'],
	])
	expect(result.listing!.items).toBe(before)

	// A file on a later page is renamed to sort first, from elsewhere. The first
	// page gains it and hands its last file on to the next, which the server
	// would never say again on its own; the old name must go.
	files = files.map((item) =>
		item.name === 'file-00600' ? {...item, name: 'a-first', path: '/Home/a-first', modified: 2} : item,
	)
	await refresh()
	await settle()
	expect(names()[0]).toBe('a-first')
	expect(names()).not.toContain('file-00600')
	expect(names()).toContain('file-00249')
	expect(new Set(names()).size).toBe(names().length)
	expect(result.listing?.items).toHaveLength(1000)
	// The rows that did not change are the objects they were
	expect(result.listing!.items.find((item) => item.name === 'file-00700')).toBe(
		before.find((item) => item.name === 'file-00700'),
	)
})

test('a folder that shrinks into its first page lets go of the pages it had', async () => {
	await fetchMore()
	files = files.filter((item) => !item.path.startsWith('/Home/') || item.name < 'file-00100')
	await refresh()
	await settle()
	expect(result.listing?.items).toHaveLength(100)
	expect(result.listing?.hasMore).toBe(false)
})

test('an item trashed from a later page stays hidden until the server says it is gone, then is forgotten', async () => {
	await fetchMore()
	const trashed = files.find((item) => item.name === 'file-00300')!
	act(() => useFilesStore.getState().addPendingPaths([trashed.path], 'removing'))
	expect(names()).not.toContain('file-00300')

	// A refresh while the request is still on its way: the server still lists
	// it, and so does the page read again, but it stays hidden
	files = files.map((item) => (item.name === 'file-00000' ? {...item, modified: 2} : item))
	await refresh()
	await settle()
	expect(names()).not.toContain('file-00300')
	expect(useFilesStore.getState().pendingPaths.has(trashed.path)).toBe(true)

	// Gone from the server: gone from the pages, and no longer waited on
	files = files.filter((item) => item !== trashed)
	await refresh()
	await settle()
	expect(names()).not.toContain('file-00300')
	expect(useFilesStore.getState().pendingPaths.has(trashed.path)).toBe(false)
	expect(result.listing?.items).toHaveLength(500)
	expect(result.listing?.totalFiles).toBe(11_999)
})
