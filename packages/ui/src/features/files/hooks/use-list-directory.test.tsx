// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useListDirectory} from './use-list-directory'

const mocks = vi.hoisted(() => ({
	shares: {
		data: [] as unknown[] | undefined,
		canManage: true,
		isPending: false,
		isError: false,
		error: null as unknown,
	},
	directory: {
		data: undefined as unknown,
		isLoading: false,
		isError: true,
		error: new Error('does-not-exist'),
		isPlaceholderData: false,
	},
	query: vi.fn(),
	utils: {files: {list: {fetch: vi.fn(), invalidate: vi.fn()}}},
	store: {
		pendingPaths: new Map(),
		selectedItems: [] as unknown[],
		setSelectedItems: vi.fn(),
		incomingItems: [],
		removeIncomingItems: vi.fn(),
		removePendingPaths: vi.fn(),
	},
	uploads: [] as unknown[],
	acknowledgeListed: vi.fn(),
}))

// Mirrors the real hook: members never see owner configuration, even when cached.
vi.mock('@/features/files/hooks/use-network-shares-query', () => ({
	useNetworkSharesQuery: () => ({...mocks.shares, data: mocks.shares.canManage ? mocks.shares.data : undefined}),
}))
vi.mock('@/features/files/hooks/use-preferences', () => ({
	usePreferences: () => ({preferences: {sortBy: 'name', sortOrder: 'ascending'}}),
}))
vi.mock('@/features/files/transfers/use-transfers', () => ({useUploadListingItems: () => mocks.uploads}))
vi.mock('@/features/files/transfers/transfers', () => ({transfers: {acknowledgeListed: mocks.acknowledgeListed}}))
vi.mock('@/features/files/store/use-files-store', () => ({
	useFilesStore: Object.assign((selector: (state: typeof mocks.store) => unknown) => selector(mocks.store), {
		getState: () => mocks.store,
	}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => mocks.utils,
		files: {
			list: {
				useQuery: (...args: unknown[]) => {
					mocks.query(...args)
					return mocks.directory
				},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let result: ReturnType<typeof useListDirectory>

function Harness({path}: {path: string}) {
	result = useListDirectory(path)
	return null
}

const offline = {host: 'nas.local', share: 'Photos', mountPath: '/Network/nas.local/Photos', isMounted: false}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.uploads = []
	mocks.store.selectedItems = []
	mocks.shares.data = [offline]
	mocks.shares.canManage = true
	mocks.shares.isPending = false
	mocks.shares.isError = false
	mocks.shares.error = null
	mocks.directory.data = undefined
	mocks.directory.isError = true
	mocks.directory.isLoading = false
	mocks.directory.isPlaceholderData = false
	container = document.createElement('div')
	root = createRoot(container)
})
afterEach(() => act(() => root.unmount()))

describe('network listings during an outage', () => {
	test('lists configured shares without requesting a missing host directory', async () => {
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(result.isError).toBe(false)
		expect(result.error).toBeNull()
		expect(result.listing?.items).toEqual([
			expect.objectContaining({path: offline.mountPath, isDisconnected: true, operations: []}),
		])
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: false}))
		expect(await result.fetchMoreItems()).toBe(false)
	})

	test('updates the listing after removal even if the filesystem response is stale', async () => {
		await act(() => root.render(<Harness path='/Network' />))
		expect(result.listing?.items).toHaveLength(1)
		mocks.shares.data = []
		await act(() => root.render(<Harness path='/Network' />))
		expect(result.listing?.items).toEqual([])
	})

	test('reconnection restores real capabilities and requests mounted directory metadata', async () => {
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		mocks.shares.data = [{...offline, isMounted: true}]
		mocks.directory.data = {
			path: '/Network/nas.local',
			files: [{path: offline.mountPath, name: 'Photos', type: 'directory', modified: 123, operations: ['writable']}],
		}
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(result.listing?.items[0]).toMatchObject({isDisconnected: false, operations: ['writable']})
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: true}))
		// The reconnected share needs fresh metadata rather than whatever the cache last saw
		expect(mocks.utils.files.list.invalidate).toHaveBeenCalledWith({path: '/Network/nas.local'})
	})

	test('surfaces a filesystem error for a host whose share is still mounted', async () => {
		mocks.shares.data = [{...offline, isMounted: true}]
		mocks.directory.error = new Error('EIO: i/o error')
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: true}))
		expect(result.isError).toBe(true)
		expect(result.error).toBe(mocks.directory.error)
	})

	test('falls back to the filesystem when the configuration cannot be loaded', async () => {
		mocks.shares.data = undefined
		mocks.shares.isError = true
		mocks.shares.error = new Error('store unreadable')
		mocks.directory.isError = false
		mocks.directory.data = {
			path: '/Network',
			files: [{path: '/Network/nas.local', name: 'nas.local', type: 'directory'}],
		}
		await act(() => root.render(<Harness path='/Network' />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: true}))
		expect(result.isError).toBe(false)
		expect(result.listing?.items.map((item) => item.path)).toEqual(['/Network/nas.local'])
	})

	test('reports a host that is not configured as missing rather than offline', async () => {
		await act(() => root.render(<Harness path='/Network/oldnas' />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: true}))
		expect(result.listing).toBeUndefined()
		expect(result.isError).toBe(true)
		expect(result.error).toBe(mocks.directory.error)
	})

	test('waits for the role before listing a network path', async () => {
		mocks.shares.isPending = true
		mocks.shares.data = undefined
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: false}))
		expect(result.isLoading).toBe(true)
		expect(result.isError).toBe(false)
		expect(result.listing).toBeUndefined()
	})

	test('explains a disconnected share instead of listing its missing directory', async () => {
		for (const path of [offline.mountPath, `${offline.mountPath}/2024`]) {
			await act(() => root.render(<Harness path={path} />))
			expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: false}))
			expect(result.isError).toBe(true)
			expect((result.error as Error).message).toBe('[network-share-disconnected]')
		}
		mocks.shares.data = [{...offline, isMounted: true}]
		mocks.directory.isError = false
		await act(() => root.render(<Harness path={offline.mountPath} />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({enabled: true}))
		expect(result.isError).toBe(false)
	})

	test('shows the disconnected explanation over the previous folder held as placeholder data', async () => {
		mocks.directory.data = {path: '/Home', files: [{name: 'private', path: '/Home/private'}]}
		mocks.directory.isPlaceholderData = true
		mocks.directory.isError = false
		await act(() => root.render(<Harness path={offline.mountPath} />))
		expect(result.isLoading).toBe(false)
		expect(result.listing).toBeUndefined()
		expect(result.isError).toBe(true)
	})

	test('a share disconnecting mid-request does not leave the listing loading', async () => {
		mocks.shares.data = [{...offline, isMounted: true}]
		mocks.directory.isError = false
		mocks.directory.isLoading = true
		for (const path of [offline.mountPath, '/Network/nas.local']) {
			await act(() => root.render(<Harness path={path} />))
			expect(result.isLoading).toBe(true)
			mocks.shares.data = [offline]
			await act(() => root.render(<Harness path={path} />))
			expect(result.isLoading).toBe(false)
			mocks.shares.data = [{...offline, isMounted: true}]
		}
		expect(result.listing?.items).toEqual([expect.objectContaining({path: offline.mountPath, isDisconnected: true})])
	})

	test('requests metadata for every configured share rather than one page', async () => {
		mocks.shares.data = [{...offline, isMounted: true}]
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(mocks.query).toHaveBeenLastCalledWith(
			expect.objectContaining({limit: Number.MAX_SAFE_INTEGER}),
			expect.anything(),
		)
		await act(() => root.render(<Harness path='/Home' />))
		expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({limit: 250}), expect.anything())
	})

	test('members keep the authorized filesystem result even with cached owner configuration', async () => {
		mocks.shares.canManage = false
		await act(() => root.render(<Harness path='/Network' />))
		expect(result.listing).toBeUndefined()
		expect(result.isError).toBe(true)
	})

	test('ignores placeholder data from a different directory when opening an offline host', async () => {
		mocks.directory.data = {path: '/Home', files: [{name: 'private', path: '/Home/private'}]}
		mocks.directory.isPlaceholderData = true
		await act(() => root.render(<Harness path='/Network/nas.local' />))
		expect(result.listing?.items.map((item) => item.path)).toEqual([offline.mountPath])
	})
})

test('refreshes selected share capabilities when a mounted share disconnects', async () => {
	mocks.store.selectedItems = [
		{path: offline.mountPath, name: 'Photos', type: 'directory', modified: 0, operations: ['writable', 'copy']},
	]
	await act(() => root.render(<Harness path='/Network/nas.local' />))
	expect(mocks.store.setSelectedItems).toHaveBeenCalledWith([
		expect.objectContaining({path: offline.mountPath, isDisconnected: true, operations: []}),
	])
})

test('leaves the selection alone when the listing refreshes without changes', async () => {
	mocks.store.selectedItems = [
		{path: offline.mountPath, name: 'Photos', type: 'directory', modified: 0, operations: [], isDisconnected: true},
	]
	await act(() => root.render(<Harness path='/Network/nas.local' />))
	expect(mocks.store.setSelectedItems).not.toHaveBeenCalled()
})

describe('landed uploads', () => {
	const entry = (name: string) => ({path: `/Home/${name}`, name, type: 'file', modified: 1, operations: []})

	test('a held row is acknowledged once the server lists it, on any loaded page', async () => {
		mocks.uploads = [{...entry('b.txt'), tempId: 'upload-b', isUploading: false, capabilitiesPending: true}]
		mocks.directory.isError = false
		mocks.directory.data = {path: '/Home', files: [entry('a.txt')], hasMore: true}
		mocks.utils.files.list.fetch.mockResolvedValue({files: [entry('b.txt')], hasMore: false})

		await act(() => root.render(<Harness path='/Home' />))
		// Page one does not have it: the row is held, nothing acknowledged
		expect(result.listing?.items.map((item) => item.path)).toEqual(['/Home/a.txt', '/Home/b.txt'])
		expect(mocks.acknowledgeListed).not.toHaveBeenCalled()

		// Page two lists it: the server's entry takes over and the row is let go
		await act(() => result.fetchMoreItems())
		expect(mocks.acknowledgeListed).toHaveBeenCalledWith(['upload-b'])
		expect(result.listing?.items.filter((item) => item.path === '/Home/b.txt')).toHaveLength(1)
	})
})
