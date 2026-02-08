import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import {mergeRefs} from 'react-merge-refs'

import {useFadeScroller} from '@/components/fade-scroller'
import {cn} from '@/shadcn-lib/utils'

type Props = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
	dialogInset?: boolean
	scrollbarClass?: string
	orientation?: 'horizontal' | 'vertical'
	viewportRef?: React.RefObject<HTMLDivElement | null>
	ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.Root>>
}

function ScrollArea({
	className,
	children,
	viewportRef,
	dialogInset,
	scrollbarClass,
	orientation = 'vertical',
	ref,
	...props
}: Props) {
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
}

function ScrollBar({
	className,
	ref,
	dialogInset,
	scrollbarClass,
	orientation = 'vertical',
	...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
	dialogInset?: boolean
	scrollbarClass?: string
	ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>
}) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			ref={ref}
			orientation={orientation}
			className={cn(
				'group flex touch-none rounded-l transition-colors hover:bg-white/6',
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
	)
}

export {ScrollArea, ScrollBar}
