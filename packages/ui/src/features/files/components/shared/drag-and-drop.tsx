import {useDraggable, useDroppable} from '@dnd-kit/core'
import React, {ElementType, useEffect, useState} from 'react'
import {useTimeoutFn} from 'react-use'

import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem, PolymorphicPropsWithoutRef} from '@/features/files/types'
import {cn} from '@/shadcn-lib/utils'

interface DraggableProps {
	id: string
	children: React.ReactNode
	item: FileSystemItem
	className?: string
	disabled?: boolean
}

interface DroppableProps {
	id: string
	children: React.ReactNode | ((isOver: boolean) => React.ReactNode)
	path: string
	navigateToPath?: boolean
	className?: string
	dropOverClassName?: string
	disabled?: boolean
}

export const Draggable = ({id, children, className, item, disabled = false, ...props}: DraggableProps) => {
	const isReadOnly = useIsFilesReadOnly()
	const {attributes, listeners, setNodeRef} = useDraggable({
		id: id,
		data: item,
	})

	const isTouchDevice = useIsTouchDevice()

	if (disabled || isTouchDevice || isReadOnly) return <div className={className}>{children}</div>

	return (
		<div
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			{...props}
			className={cn('touch-none outline-none', className)}
		>
			{children}
		</div>
	)
}

export const Droppable = <T extends ElementType = 'div'>({
	id,
	children,
	className,
	path,
	navigateToPath = true,
	dropOverClassName = 'bg-brand text-white',
	disabled = false,
	as,
	...props
}: PolymorphicPropsWithoutRef<T, DroppableProps>) => {
	const Component = as || 'div'
	const isReadOnly = useIsFilesReadOnly()
	const {setNodeRef, isOver, over} = useDroppable({
		id: id,
		data: {
			path: path,
		},
	})

	const isTouchDevice = useIsTouchDevice()
	const {currentPath, navigateToDirectory} = useNavigate()
	const [isReadyToNavigate, setIsReadyToNavigate] = useState(false)
	const draggedItems = useFilesStore((s) => s.draggedItems)
	const [isOverValidDropTarget, setIsOverValidDropTarget] = useState(false)

	// Start blinking animation after hover
	const [, cancelBlinkTimer, resetBlinkTimer] = useTimeoutFn(() => {
		setIsReadyToNavigate(true)
	}, 1000) // 1s

	// Navigate after animation completes
	const [, cancelNavigateTimer, resetNavigateTimer] = useTimeoutFn(() => {
		setIsReadyToNavigate(false)
		navigateToDirectory(path)
	}, 1500) // 1.5s

	useEffect(() => {
		if (isOver && currentPath !== path && isOverValidDropTarget && navigateToPath) {
			// Start both timers
			resetBlinkTimer()
			resetNavigateTimer()
		} else {
			// Cancel both timers and reset blinking state
			cancelBlinkTimer()
			cancelNavigateTimer()
			setIsReadyToNavigate(false)
		}
	}, [
		isOver,
		path,
		currentPath,
		resetBlinkTimer,
		resetNavigateTimer,
		cancelBlinkTimer,
		cancelNavigateTimer,
		isOverValidDropTarget,
		navigateToPath,
	])

	useEffect(() => {
		if (over?.data?.current?.path) {
			// check if the user isn't trying to drop inside a folder that's a part of the dragged items
			const isDroppingInsideDraggedItems = draggedItems.some((item) => item.path === over?.data.current?.path)
			setIsOverValidDropTarget(!isDroppingInsideDraggedItems)
		}
	}, [over, draggedItems])

	const isReadyToDrop = isOver && isOverValidDropTarget
	const renderedChildren = typeof children === 'function' ? children(isReadyToDrop) : children

	if (disabled || isTouchDevice || isReadOnly)
		return (
			<div className={className} {...props}>
				{renderedChildren}
			</div>
		)

	return (
		<Component
			ref={setNodeRef}
			className={cn(
				className,
				isReadyToDrop && dropOverClassName,
				isReadyToNavigate && 'animate-files-folder-blink-on-drag-hover',
			)}
			{...props}
		>
			{renderedChildren}
		</Component>
	)
}
