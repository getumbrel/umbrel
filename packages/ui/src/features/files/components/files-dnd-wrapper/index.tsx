import {CollisionDetection, DndContext, PointerSensor, rectIntersection, useSensor, useSensors} from '@dnd-kit/core'
import {createPortal} from 'react-dom'

import {FilesDndOverlay} from '@/features/files/components/files-dnd-wrapper/files-dnd-overlay'
import {useDragAndDrop} from '@/features/files/hooks/use-drag-and-drop'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'

// From: https://github.com/clauderic/dnd-kit/pull/334#issuecomment-1965708784
const fixCursorSnapOffset: CollisionDetection = (args) => {
	// Bail out if keyboard activated
	if (!args.pointerCoordinates) {
		return rectIntersection(args)
	}
	const {x, y} = args.pointerCoordinates
	const {width, height} = args.collisionRect
	const updated = {
		...args,
		// The collision rectangle is broken when using snapCenterToCursor. Reset
		// the collision rectangle based on pointer location and overlay size.
		collisionRect: {
			width,
			height,
			bottom: y + height / 2,
			left: x - width / 2,
			right: x + width / 2,
			top: y - height / 2,
		},
	}
	return rectIntersection(updated)
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
			collisionDetection={fixCursorSnapOffset}
		>
			{children}

			{/* Move the drag overlay to body so the Files app sheet doesn't cover it when dragging */}
			{createPortal(<FilesDndOverlay />, document.body)}
		</DndContext>
	)
}
