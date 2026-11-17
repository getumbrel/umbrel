import {
	CollisionDetection,
	DndContext,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import {createPortal} from 'react-dom'

import {FilesDndOverlay} from '@/features/files/components/files-dnd-wrapper/files-dnd-overlay'
import {useDragAndDrop} from '@/features/files/hooks/use-drag-and-drop'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'

// The ghost trails the pointer like a badge, so the drop target is whatever is
// under the pointer itself. Under it to the eye, that is: the listing runs on
// beneath the dock, and a folder hidden there (or under an island, or a
// window opened over Files) must not catch what is let go above it. A target
// only counts while it is the thing the pointer is actually on.
const collisionDetection: CollisionDetection = (args) => {
	const pointer = args.pointerCoordinates
	if (!pointer) return rectIntersection(args)
	const top = document.elementFromPoint(pointer.x, pointer.y)
	return pointerWithin(args).filter(({id}) => {
		const node = args.droppableContainers.find((container) => container.id === id)?.node.current
		return !node || !top || node.contains(top)
	})
}

export function FilesDndWrapper({children}: {children: React.ReactNode}) {
	const isReadOnly = useIsFilesReadOnly()
	// By adding a 8px distance, we disable the drag and drop registeration
	// on single/double clicks.
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8,
			},
		}),
	)

	const {handleDragStart, handleDragEnd} = useDragAndDrop()

	return isReadOnly ? (
		<>{children}</>
	) : (
		<DndContext
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			collisionDetection={collisionDetection}
		>
			{children}

			{/* Move the drag overlay to body so the Files app sheet doesn't cover it when dragging */}
			{createPortal(<FilesDndOverlay />, document.body)}
		</DndContext>
	)
}
