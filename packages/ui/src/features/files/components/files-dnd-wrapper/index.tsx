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
// under the pointer itself
const collisionDetection: CollisionDetection = (args) =>
	args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)

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
