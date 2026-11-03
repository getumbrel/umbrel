import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import {cn} from '@/lib/utils'
import {allowsNativeContextMenu} from '@/utils/native-context-menu'

import {floatingContentAnimationClass, materialSurfaceClasses} from './shared/material'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverClose = PopoverPrimitive.Close

function PopoverContent({
	className,
	ref,
	align = 'center',
	sideOffset = 4,
	// Radix lets a popover shift right up to the screen edge; keep it a margin away
	collisionPadding = 8,
	...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof PopoverPrimitive.Content>>
}) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					materialSurfaceClasses.popover,
					floatingContentAnimationClass,
					'z-50 min-w-[8rem] p-1 text-white outline-hidden',
					className,
				)}
				{...props}
				// Keep right-clicks inside from opening an ancestor's context menu, while text fields keep the browser's own
				onContextMenu={(e) => {
					if (!allowsNativeContextMenu(e.target)) e.preventDefault()
					e.stopPropagation()
				}}
			/>
		</PopoverPrimitive.Portal>
	)
}

export {Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose}
