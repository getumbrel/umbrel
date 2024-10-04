import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import {mergeRefs} from 'react-merge-refs'

import {useFadeScroller} from '@/components/fade-scroller'
import {cn} from '@/shadcn-lib/utils'

type Props = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
	dialogInset?: boolean
	scrollbarClass?: string
	orientation?: 'horizontal' | 'vertical'
	viewportRef?: React.RefObject<HTMLDivElement>
}

const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, Props>(
	({className, children, viewportRef, dialogInset, scrollbarClass, orientation = 'vertical', ...props}, ref) => {
		const {scrollerClass, ref: scrollerRef} = useFadeScroller('y')
		return (
			<ScrollAreaPrimitive.Root
				ref={ref}
				className={cn('relative overflow-hidden', className)}
				scrollHideDelay={0}
				{...props}
			>
				<ScrollAreaPrimitive.Viewport
					ref={mergeRefs([viewportRef, scrollerRef])}
					className={cn(
						// Setting `block` to fix issues with radix `ScrollArea` component
						// https://github.com/radix-ui/primitives/issues/926#issuecomment-1015279283
						'flex h-full w-full rounded-[inherit] *:!block *:flex-grow',
						orientation === 'vertical' && 'flex-col',
						scrollerClass,
					)}
				>
					{children}
				</ScrollAreaPrimitive.Viewport>
				<ScrollBar dialogInset={dialogInset} scrollbarClass={scrollbarClass} orientation={orientation} />
				<ScrollAreaPrimitive.Corner />
			</ScrollAreaPrimitive.Root>
		)
	},
)
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
	React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
	React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
		dialogInset?: boolean
		scrollbarClass?: string
	}
>(({className, dialogInset, scrollbarClass, orientation = 'vertical', ...props}, ref) => (
	<ScrollAreaPrimitive.ScrollAreaScrollbar
		ref={ref}
		orientation={orientation}
		className={cn(
			'group flex touch-none select-none rounded-l transition-colors hover:bg-white/6',
			orientation === 'vertical' && 'w-2.5 border-l border-l-transparent p-[3px]',
			orientation === 'vertical' && dialogInset && 'my-5',
			orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[3px]',
			orientation === 'horizontal' && dialogInset && 'mx-5',
			scrollbarClass,
			className,
		)}
		{...props}
	>
		<ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-full bg-white/10 group-hover:bg-white/50' />
	</ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export {ScrollArea, ScrollBar}
