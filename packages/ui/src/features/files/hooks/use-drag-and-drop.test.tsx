// @vitest-environment jsdom

import type {DragEndEvent} from '@dnd-kit/core'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useDragAndDrop} from '@/features/files/hooks/use-drag-and-drop'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

const mocks = vi.hoisted(() => ({
	moveDraggedItems: vi.fn(),
}))

vi.mock('@/features/files/hooks/use-files-operations', () => ({
	useFilesOperations: () => ({
		moveDraggedItems: mocks.moveDraggedItems,
		trashDraggedItems: vi.fn(),
	}),
}))
vi.mock('@/features/files/constants', () => ({
	SYSTEM_MANAGED_ROOT_PATHS: new Set(['/Apps', '/Machines']),
	TRASH_PATH: '/Trash',
}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => false,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const draggedItem: FileSystemItem = {
	name: 'Source',
	path: '/Home/Source',
	type: 'directory',
	size: 0,
	modified: 0,
	operations: ['move'],
}

const dragEndEvent = (activeData: unknown, targetPath: string) =>
	({
		active: {data: {current: activeData}},
		over: {data: {current: {path: targetPath}}},
	}) as unknown as DragEndEvent

let actions!: ReturnType<typeof useDragAndDrop>
let root!: Root

function Harness() {
	actions = useDragAndDrop()
	return null
}

beforeEach(() => {
	mocks.moveDraggedItems.mockResolvedValue(true)
	useFilesStore.setState({selectedItems: [], draggedItems: [draggedItem]})
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

describe('Files drag and drop', () => {
	it.each(['/Home/Destination', '/Home/Destination/Child'])(
		'moves items to %s after hover navigation unmounts the source draggable',
		async (targetPath) => {
			// dnd-kit clears active data when navigation unmounts the source draggable.
			await act(() => actions.handleDragEnd(dragEndEvent({}, targetPath)))

			expect(mocks.moveDraggedItems).toHaveBeenCalledWith({toDirectory: targetPath})
		},
	)

	it('skips a drop when all dragged items are already in the target directory', async () => {
		await act(() => actions.handleDragEnd(dragEndEvent(draggedItem, '/Home')))

		expect(mocks.moveDraggedItems).not.toHaveBeenCalled()
		expect(useFilesStore.getState().draggedItems).toEqual([])
	})
})
