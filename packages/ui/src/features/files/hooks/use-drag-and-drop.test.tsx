// @vitest-environment jsdom

import {
	DndContext,
	DragOverlay,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core'
import {act, useEffect} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {Draggable, Droppable} from '@/features/files/components/shared/drag-and-drop'
import {useDragAndDrop} from '@/features/files/hooks/use-drag-and-drop'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

const mocks = vi.hoisted(() => ({
	move: vi.fn(),
	trash: vi.fn(),
}))

vi.mock('@/features/files/hooks/use-files-operations', () => ({
	useFilesOperations: () => ({moveDraggedItems: mocks.move, trashDraggedItems: mocks.trash}),
}))
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({
	useIsFilesReadOnly: () => false,
	useFilesCapabilities: () => ({}),
}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/features/files/hooks/use-home-path', () => ({
	useHomePath: () => '/Home',
	useTrashPath: () => '/Trash',
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const source: FileSystemItem = {
	name: 'source.txt',
	path: '/Home/source.txt',
	type: 'text/plain',
	size: 1,
	modified: 0,
	operations: ['move'],
}
let root: Root
let container: HTMLDivElement
let dropEvent: DragEndEvent | undefined
let dropError: unknown
let dropPromise: Promise<void> | undefined

function Harness() {
	const {currentPath: path} = useNavigate()
	// FilesLayout clears the visible selection when navigating to a new directory.
	useEffect(() => useFilesStore.getState().clearSelectedItems(), [path])
	const {handleDragStart, handleDragEnd} = useDragAndDrop()
	const sensors = useSensors(useSensor(PointerSensor, {activationConstraint: {distance: 8}}))
	const childPath = `${path}/Target`
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			autoScroll={false}
			onDragStart={handleDragStart}
			onDragEnd={(event) => {
				dropEvent = event
				dropPromise = handleDragEnd(event).catch((error) => {
					dropError = error
				})
			}}
		>
			<output>{path}</output>
			{path === '/Home' && (
				<Draggable id={source.path} item={source}>
					<span>source</span>
				</Draggable>
			)}
			<Droppable id={childPath} path={childPath} data-rect='folder'>
				folder
			</Droppable>
			<Droppable id={`listing-${path}`} path={path} data-rect='background'>
				background
			</Droppable>
			<DragOverlay dropAnimation={null}>
				<span>preview</span>
			</DragOverlay>
		</DndContext>
	)
}

async function pointer(target: EventTarget, type: string, x: number, y: number) {
	await act(async () => {
		target.dispatchEvent(
			new PointerEvent(type, {bubbles: true, clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: 'mouse'}),
		)
	})
}

async function startDrag(expectedItems = [source]) {
	await pointer(container.querySelector('[role="button"]')!, 'pointerdown', 20, 20)
	await pointer(document, 'pointermove', 40, 20)
	await pointer(document, 'pointermove', 240, 40)
	expect(useFilesStore.getState().draggedItems).toEqual(expectedItems)
}

async function openFolder(path = '/Home/Target', expectedItems = [source]) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1500)
	})
	expect(container.querySelector('output')?.textContent).toBe(path)
	expect(container.querySelector('[role="button"]')).toBeNull()
	expect(useFilesStore.getState().selectedItems).toEqual([])
	expect(useFilesStore.getState().draggedItems).toEqual(expectedItems)
}

async function drop(x: number, y: number) {
	await pointer(document, 'pointermove', x, y)
	await pointer(document, 'pointerup', x, y)
	await act(async () => {
		await dropPromise
	})
	expect(dropEvent).toBeDefined()
}

beforeEach(async () => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	dropEvent = undefined
	dropError = undefined
	dropPromise = undefined
	useFilesStore.setState({selectedItems: [], draggedItems: []})
	// jsdom has no layout; give the real sensor distinct source, folder, and background targets.
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		const kind = this.getAttribute('data-rect')
		return kind === 'folder'
			? new DOMRect(200, 0, 100, 80)
			: kind === 'background'
				? new DOMRect(0, 100, 500, 300)
				: new DOMRect(10, 10, 100, 40)
	})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () =>
		root.render(
			<MemoryRouter initialEntries={['/files/Home']} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
				<Harness />
			</MemoryRouter>,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

describe('Files drag and drop across navigation', () => {
	it('immediate drop keeps source metadata and requests the move', async () => {
		await startDrag()
		await drop(240, 40)
		expect(dropEvent?.active.data.current).toEqual(source)
		expect(dropError).toBeUndefined()
		expect(mocks.move).toHaveBeenCalledWith({toDirectory: '/Home/Target'})
	})

	it.each([
		['opened folder background', 400, 200, '/Home/Target'],
		['another folder', 240, 40, '/Home/Target/Target'],
	] as const)('drop on %s after hover-opening', async (_, x, y, expectedPath) => {
		await startDrag()
		await openFolder()
		await drop(x, y)
		expect(dropEvent?.over?.data.current?.path).toBe(expectedPath)
		expect(dropError).toBeUndefined()
		expect(mocks.move).toHaveBeenCalledWith({toDirectory: expectedPath})
	})

	it('a drop onto the source directory background is ignored', async () => {
		await startDrag()
		await drop(400, 200)
		expect(dropEvent?.over?.data.current?.path).toBe('/Home')
		expect(dropError).toBeUndefined()
		expect(mocks.move).not.toHaveBeenCalled()
		expect(useFilesStore.getState().draggedItems).toEqual([])
	})

	it('keeps the dragged selection through multiple hover-opened folders', async () => {
		const secondSource = {...source, name: 'second.txt', path: '/Home/second.txt'}
		const items = [source, secondSource]
		act(() => useFilesStore.getState().setSelectedItems(items))
		await startDrag(items)
		await openFolder('/Home/Target', items)
		await openFolder('/Home/Target/Target', items)
		await drop(400, 200)

		expect(dropError).toBeUndefined()
		expect(mocks.move).toHaveBeenCalledWith({toDirectory: '/Home/Target/Target'})
	})

	it('does not skip a mixed-directory selection when the active item is already at the destination', async () => {
		const otherSource = {...source, name: 'other.txt', path: '/Home/Other/other.txt'}
		const items = [source, otherSource]
		act(() => useFilesStore.getState().setSelectedItems(items))
		await startDrag(items)
		await drop(400, 200)

		expect(dropError).toBeUndefined()
		expect(mocks.move).toHaveBeenCalledWith({toDirectory: '/Home'})
	})
})
