// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

const mocks = vi.hoisted(() => ({
	returnedItem: {
		name: 'Main Folder',
		path: '/Home/Videos/Main Folder',
		type: 'directory',
		size: 0,
		modified: 0,
		operations: ['move'],
	} as FileSystemItem,
}))

vi.mock('@/features/files/hooks/use-preferences', () => ({
	usePreferences: () => ({preferences: {sortBy: 'name', sortOrder: 'ascending'}}),
}))
vi.mock('@/providers/global-files', () => ({
	useGlobalFiles: () => ({uploadingItems: []}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({files: {list: {fetch: vi.fn()}}}),
		files: {
			list: {
				useQuery: () => ({
					data: {files: [mocks.returnedItem], hasMore: false},
					isLoading: false,
					isError: false,
					error: null,
					isPlaceholderData: false,
				}),
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let result!: ReturnType<typeof useListDirectory>
let root!: Root

function Harness() {
	result = useListDirectory('/Home/Videos')
	return null
}

beforeEach(() => {
	useFilesStore.setState({
		pendingPaths: new Map([[mocks.returnedItem.path, 'removing']]),
		incomingItems: [mocks.returnedItem],
	})
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.clearAllMocks()
})

describe('Directory listing optimistic state', () => {
	it('shows an item that returns to a path with a stale removal marker', () => {
		act(() => root.render(<Harness />))

		expect(result.listing?.items).toEqual([mocks.returnedItem])
		expect(useFilesStore.getState().pendingPaths.has(mocks.returnedItem.path)).toBe(false)
		expect(useFilesStore.getState().incomingItems).toEqual([])
	})
})
