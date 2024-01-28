import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

type Props = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
	viewportRef?: React.RefObject<HTMLDivElement>
}

const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, Props>(
	({className, children, viewportRef, ...props}, ref) => (
		<ScrollAreaPrimitive.Root
			ref={ref}
			className={cn('relative overflow-hidden', className)}
			scrollHideDelay={0}
			{...props}
		>
			{/*
			TODO: figure out child issue
			We need to get a ref to it so we can scroll it programmatically
			https://github.com/radix-ui/primitives/issues/1666
			 */}
			<ScrollAreaPrimitive.Viewport
				ref={viewportRef}
				className='umbrel-fade-scroller-y h-full w-full rounded-[inherit] [&>div]:!block'
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	),
)
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
	React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
	React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({className, orientation = 'vertical', ...props}, ref) => (
	<ScrollAreaPrimitive.ScrollAreaScrollbar
		ref={ref}
		orientation={orientation}
		className={cn(
			'group flex touch-none select-none rounded-tl-4 transition-colors hover:bg-white/10',
			orientation === 'vertical' && 'mt-[38px] h-[calc(100%-38px)] w-[11px] border-l border-l-transparent p-[4px]',
			orientation === 'horizontal' && 'h-[11px] flex-col border-t border-t-transparent p-[4px]',
			className,
		)}
		{...props}
	>
		<ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-full bg-white/20 group-hover:bg-white/50' />
	</ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export {ScrollArea, ScrollBar}
