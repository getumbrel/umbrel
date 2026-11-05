// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {TransferItem, TransferState} from '@/features/files/transfers/types'
import {useTransfersEffects} from '@/features/files/transfers/use-transfers'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact, type RouterInput, type RouterOutput} from '@/trpc/trpc'

import {useListDirectory} from './use-list-directory'

type Listener = (item: TransferItem, previous: TransferState) => void | Promise<void>
const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	listeners: new Set<Listener>(),
	snapshot: {batches: [], items: new Map(), wake: 0},
}))
vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('@/features/files/transfers/transfers', () => ({
	transfers: {
		subscribe: () => () => {},
		snapshot: () => mocks.snapshot,
		onTransition: (listener: Listener) => {
			mocks.listeners.add(listener)
			return () => mocks.listeners.delete(listener)
		},
		acknowledgeListed: vi.fn(),
		reset: vi.fn(),
	},
}))
vi.mock('@/features/files/hooks/use-network-shares-query', () => ({
	useNetworkSharesQuery: () => ({data: [], isPending: false}),
}))
vi.mock('@/features/files/hooks/use-preferences', () => ({usePreferences: () => ({preferences: undefined})}))
vi.mock('@/modules/auth/token-renewal', () => ({AUTH_TOKEN_LOCAL_STORAGE_KEY: 'test-auth-token'}))
vi.mock('@/providers/confirmation', async () => {
	const {createContext} = await import('react')
	return {ConfirmationContext: createContext(null), useConfirmation: () => vi.fn()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type ListInput = RouterInput['files']['list']
type Directory = RouterOutput['files']['list']
const entry = (index: number): FileSystemItem => ({
	name: `file-${String(index).padStart(4, '0')}`,
	path: `/Home/file-${String(index).padStart(4, '0')}`,
	type: 'text/plain',
	size: 1,
	modified: 1,
	operations: ['move', 'rename', 'trash'],
})
let files: FileSystemItem[]
let client: QueryClient
let root: Root
let result: ReturnType<typeof useListDirectory>
let utils: ReturnType<typeof trpcReact.useUtils>

function listing({path, lastFile, limit = 250}: ListInput): Directory {
	const entries = files.filter((item) => item.path.slice(0, item.path.lastIndexOf('/')) === path)
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
function Harness() {
	result = useListDirectory('/Home')
	utils = trpcReact.useUtils()
	useTransfersEffects()
	return null
}
const paths = () => result.listing?.items.map((item) => item.path)
const fetchMore = () =>
	act(async () => {
		await result.fetchMoreItems()
	})
function transfer(source: FileSystemItem, changes: Partial<TransferItem> = {}): TransferItem {
	return {
		id: source.path,
		batchId: 'batch',
		kind: 'move',
		lane: 'instant',
		name: source.name,
		type: source.type,
		sourcePath: source.path,
		path: `/Other/${source.name}`,
		resultPath: `/Other/${source.name}`,
		destinationDirectory: '/Other',
		state: 'completed',
		progress: 100,
		transferredBytes: 1,
		bytesPerSecond: 0,
		attempts: 1,
		...changes,
	}
}
async function transition(item: TransferItem, previous: TransferState = 'running') {
	await act(async () => {
		await Promise.all([...mocks.listeners].map((listener) => listener(item, previous)))
	})
}

beforeEach(async () => {
	notifyManager.setScheduler(queueMicrotask)
	client = new QueryClient({defaultOptions: {queries: {staleTime: 60_000, retry: false, gcTime: Infinity}}})
	files = Array.from({length: 600}, (_, index) => entry(index))
	mocks.list.mockImplementation(async (input: ListInput) => listing(input))
	useFilesStore.setState({pendingPaths: new Map(), incomingItems: [], selectedItems: []})
	const rpcClient = trpcReact.createClient({
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
	await act(async () =>
		root.render(
			<trpcReact.Provider client={rpcClient} queryClient={client}>
				<QueryClientProvider client={client}>
					<Harness />
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
})
afterEach(async () => {
	await act(async () => root.unmount())
	client.clear()
	mocks.listeners.clear()
	vi.clearAllMocks()
	notifyManager.setScheduler((callback) => setTimeout(callback, 0))
})

test('removes a moved second-page row without losing other loaded rows after refresh', async () => {
	expect(result.listing?.items).toHaveLength(250)
	expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({limit: 250}))
	await fetchMore()
	expect(result.listing?.items).toHaveLength(500)
	expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({limit: 250, lastFile: 'file-0249'}))
	const source = files[300]
	files = files.filter((item) => item.path !== source.path)
	// Another first-page change makes its refreshed array differ too.
	files[0] = {...files[0], modified: 2}
	await transition(transfer(source))
	await act(() => utils.files.list.invalidate({path: '/Home'}))
	expect(paths()).not.toContain(source.path)
	expect(result.listing?.items).toHaveLength(499)
	expect(paths()).toContain('/Home/file-0499')
	expect(useFilesStore.getState().pendingPaths.has(source.path)).toBe(false)
})

test('discards an old page and fetches the same page key afresh after a completed move', async () => {
	await fetchMore()
	const source = files[300]
	const oldPage = listing({path: '/Home', lastFile: 'file-0499'})
	let resolveOld!: (page: Directory) => void
	mocks.list.mockImplementationOnce(
		() =>
			new Promise<Directory>((resolve) => {
				resolveOld = resolve
			}),
	)
	let pending!: Promise<boolean>
	await act(async () => {
		pending = result.fetchMoreItems()
	})
	files = files
		.filter((item) => item.path !== source.path)
		.map((item) => (item.name === 'file-0550' ? {...item, modified: 2} : item))
	await transition(transfer(source))
	await act(async () => {
		resolveOld(oldPage)
		await pending
	})
	expect(result.listing?.items).toHaveLength(499)
	const calls = mocks.list.mock.calls.length
	await fetchMore()
	expect(mocks.list).toHaveBeenCalledTimes(calls + 1)
	expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({lastFile: 'file-0499'}))
	expect(result.listing?.items.find((item) => item.name === 'file-0550')?.modified).toBe(2)
	expect(result.listing?.items).toHaveLength(599)
	expect(paths()).not.toContain(source.path)
})

test('preserves second-page sources for failed, cancelled, copied, and no-op moves', async () => {
	await fetchMore()
	const source = files[300]
	for (const changes of [
		{state: 'failed'},
		{state: 'cancelled'},
		{kind: 'copy'},
		{resultPath: source.path, path: source.path, destinationDirectory: '/Home'},
	] satisfies Partial<TransferItem>[]) {
		await transition(transfer(source, {...changes, state: 'running'}), 'queued')
		await transition(transfer(source, changes))
		expect(paths()).toContain(source.path)
		expect(result.listing?.items).toHaveLength(500)
		expect(useFilesStore.getState().pendingPaths.has(source.path)).toBe(false)
	}
})

test('recovers a second-page row after an optimistic removal fails', async () => {
	await fetchMore()
	const source = files[300]
	act(() => useFilesStore.getState().addPendingPaths([source.path], 'removing'))
	files[0] = {...files[0], modified: 2}
	await act(() => utils.files.list.invalidate({path: '/Home'}))
	// A failed rename/trash removes its optimistic mask; it must recover the cached row.
	act(() => useFilesStore.getState().removePendingPaths([source.path]))
	expect(paths()).toContain(source.path)
	expect(result.listing?.items).toHaveLength(500)
})

test('retires an incoming source only after a successful move', async () => {
	const source = {...entry(900), name: 'renamed', path: '/Home/renamed'}
	act(() => useFilesStore.getState().addIncomingItems([source]))
	await transition(transfer(source, {state: 'failed'}))
	expect(paths()).toContain(source.path)
	expect(useFilesStore.getState().incomingItems).toEqual([source])
	await transition(transfer(source))
	expect(paths()).not.toContain(source.path)
	expect(useFilesStore.getState().incomingItems).toEqual([])
})

test('keeps a later-page file visible when it is renamed back to its original name', async () => {
	await fetchMore()
	const source = files[300]
	const renamed = {...source, name: 'z-renamed', path: '/Home/z-renamed'}
	// Match renameItem's optimistic state changes and successful invalidation.
	act(() => {
		const store = useFilesStore.getState()
		store.addPendingPaths([source.path], 'removing')
		store.addIncomingItems([renamed])
		store.setSelectedItems([renamed])
	})
	files = [...files.filter((item) => item.path !== source.path), renamed]
	await act(() => utils.files.list.invalidate())
	act(() => {
		const store = useFilesStore.getState()
		store.addPendingPaths([renamed.path], 'removing')
		store.addIncomingItems([source])
		store.setSelectedItems([source])
	})
	files = [...files.filter((item) => item.path !== renamed.path), source].sort((a, b) => a.name.localeCompare(b.name))
	await act(() => utils.files.list.invalidate())
	expect(paths()).toContain(source.path)
	expect(useFilesStore.getState().selectedItems).toEqual([source])
})

test('keeps an unrelated pending removal masked when another later-page move finishes', async () => {
	await fetchMore()
	const pendingTrash = files[300]
	const moved = files[350]
	act(() => useFilesStore.getState().addPendingPaths([pendingTrash.path], 'removing'))
	files = files.filter((item) => item.path !== moved.path)
	await transition(transfer(moved))
	expect(paths()).not.toContain(moved.path)
	expect(paths()).not.toContain(pendingTrash.path)
	expect(useFilesStore.getState().pendingPaths.has(pendingTrash.path)).toBe(true)
	// If the independent trash request fails, its original row remains recoverable.
	act(() => useFilesStore.getState().removePendingPaths([pendingTrash.path]))
	expect(paths()).toContain(pendingTrash.path)
	expect(paths()).not.toContain(moved.path)
})
