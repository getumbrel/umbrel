// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

const mocks = vi.hoisted(() => ({
	isReadOnly: false,
	pathOperations: vi.fn(),
	rename: vi.fn(),
	move: vi.fn(),
	copy: vi.fn(),
	unarchive: vi.fn(),
	archive: vi.fn(),
	trash: vi.fn(),
	restore: vi.fn(),
	deleteMany: vi.fn(),
	emptyTrash: vi.fn(),
	toastError: vi.fn(),
	enqueueServer: vi.fn(),
}))

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: mocks.toastError}}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => mocks.isReadOnly,
}))
vi.mock('@/features/files/utils/error-messages', () => ({getFilesErrorMessage: (message: string) => message}))
vi.mock('@/modules/auth/http-auth', () => ({authorizedHttpUrl: vi.fn()}))
vi.mock('@/providers/confirmation', () => ({useConfirmation: () => vi.fn()}))
// Copies and moves are batches in the transfer queue, not direct mutations
vi.mock('@/features/files/transfers/transfers', () => ({transfers: {enqueueServer: mocks.enqueueServer}}))
vi.mock('@/trpc/trpc', () => {
	const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({useMutation: () => ({mutateAsync})})
	const invalidate = vi.fn()
	return {
		trpcReact: {
			useUtils: () => ({
				files: {
					pathOperations: {fetch: mocks.pathOperations},
					list: {fetch: vi.fn(), invalidate},
					recents: {invalidate},
					favorites: {invalidate},
					shares: {invalidate},
					search: {invalidate},
				},
			}),
			files: {
				rename: mutation(mocks.rename),
				move: mutation(mocks.move),
				copy: mutation(mocks.copy),
				unarchive: mutation(mocks.unarchive),
				archive: mutation(mocks.archive),
				trash: mutation(mocks.trash),
				restore: mutation(mocks.restore),
				deleteMany: mutation(mocks.deleteMany),
				emptyTrash: mutation(mocks.emptyTrash),
			},
		},
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const item = (operations: FileSystemItem['operations']): FileSystemItem => ({
	name: 'report.txt',
	path: '/Home/report.txt',
	type: 'text/plain',
	size: 1,
	modified: 0,
	operations,
})

let actions!: ReturnType<typeof useFilesOperations>
let root!: Root

function Harness() {
	actions = useFilesOperations()
	return null
}

beforeEach(() => {
	mocks.isReadOnly = false
	mocks.pathOperations.mockResolvedValue(['writable'])
	mocks.deleteMany.mockResolvedValue([])
	useFilesStore.setState({
		selectedItems: [],
		draggedItems: [],
		clipboardItems: [],
		clipboardMode: null,
	})
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root.render(<Harness />))
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.clearAllMocks()
})

describe('Files command capabilities', () => {
	it('does not paste into a destination without writable capability', async () => {
		act(() => useFilesStore.setState({clipboardItems: [item(['copy'])], clipboardMode: 'copy'}))
		mocks.pathOperations.mockResolvedValue(['copy'])

		await act(() => actions.pasteItemsFromClipboard({toDirectory: '/Home/Cloud'}))

		expect(mocks.pathOperations).toHaveBeenCalledWith({path: '/Home/Cloud'})
		expect(mocks.enqueueServer).not.toHaveBeenCalled()
	})

	it('rejects dragged items that lack the move capability explicitly', async () => {
		act(() => useFilesStore.setState({draggedItems: [item(['copy'])]}))

		await act(() => actions.moveDraggedItems({toDirectory: '/Home/Documents'}))

		expect(mocks.pathOperations).not.toHaveBeenCalled()
		expect(mocks.enqueueServer).not.toHaveBeenCalled()
		expect(mocks.toastError).toHaveBeenCalledWith('files-error.move', {area: 'files'})
		expect(useFilesStore.getState().draggedItems).toEqual([])
	})

	it('holds dragged items until destination writability resolves', async () => {
		let resolveOperations!: (operations: string[]) => void
		mocks.pathOperations.mockReturnValue(
			new Promise((resolve) => {
				resolveOperations = resolve
			}),
		)
		act(() => useFilesStore.setState({draggedItems: [item(['move'])]}))

		let movePromise!: ReturnType<typeof actions.moveDraggedItems>
		act(() => {
			movePromise = actions.moveDraggedItems({toDirectory: '/Home/Documents'})
		})
		expect(useFilesStore.getState().draggedItems).toHaveLength(1)
		expect(mocks.enqueueServer).not.toHaveBeenCalled()

		resolveOperations(['writable'])
		await act(() => movePromise)

		expect(mocks.enqueueServer).toHaveBeenCalledWith('move', [item(['move'])], '/Home/Documents')
		expect(useFilesStore.getState().draggedItems).toEqual([])
	})

	it('blocks mutations centrally in embedded read-only mode', async () => {
		mocks.isReadOnly = true
		act(() => root.render(<Harness />))
		const source = item(['rename', 'copy', 'move'])

		await act(async () => {
			await actions.renameItem({item: source, newName: 'renamed.txt'})
			await actions.copyItems({sourceItems: [source], toDirectory: '/Home/Documents'})
			await actions.emptyTrash()
		})

		expect(mocks.pathOperations).not.toHaveBeenCalled()
		expect(mocks.rename).not.toHaveBeenCalled()
		expect(mocks.enqueueServer).not.toHaveBeenCalled()
		expect(mocks.emptyTrash).not.toHaveBeenCalled()
	})

	it('moves only items outside the destination in a mixed-directory drag', async () => {
		const alreadyThere = item(['move'])
		const otherSource = {...alreadyThere, name: 'other.txt', path: '/Home/Other/other.txt'}
		act(() => useFilesStore.setState({draggedItems: [alreadyThere, otherSource]}))

		await act(() => actions.moveDraggedItems({toDirectory: '/Home'}))

		expect(mocks.enqueueServer).toHaveBeenCalledWith('move', [otherSource], '/Home')
		expect(mocks.toastError).not.toHaveBeenCalled()
		expect(useFilesStore.getState().draggedItems).toEqual([])
	})

	it('permanently deletes the selection in one batch', async () => {
		const secondItem = {...item(['delete']), name: 'notes.txt', path: '/Trash/notes.txt'}
		act(() =>
			useFilesStore.setState({
				selectedItems: [{...item(['delete']), path: '/Trash/report.txt'}, secondItem],
			}),
		)

		await act(() => actions.deleteSelectedItems())

		expect(mocks.deleteMany).toHaveBeenCalledOnce()
		expect(mocks.deleteMany).toHaveBeenCalledWith({
			paths: ['/Trash/report.txt', '/Trash/notes.txt'],
		})
	})
})
