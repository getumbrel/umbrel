import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import {cn} from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
	className,
	ref,
	sideOffset = 4,
	...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
	ref?: React.Ref<React.ComponentRef<typeof TooltipPrimitive.Content>>
}) {
	return (
		<TooltipPrimitive.Content
			ref={ref}
			sideOffset={sideOffset}
			className={cn(
				'z-50 animate-in overflow-hidden rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-950 shadow-md fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
				className,
			)}
			{...props}
		/>
	)
}

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider}
