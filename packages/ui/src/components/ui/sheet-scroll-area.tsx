import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import {mergeRefs} from 'react-merge-refs'

import {useFadeScroller} from '@/components/fade-scroller'
import {cn} from '@/lib/utils'

type Props = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
	viewportRef?: React.RefObject<HTMLDivElement | null>
	ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.Root>>
}

function ScrollArea({className, children, viewportRef, ref, ...props}: Props) {
	const {scrollerClass, ref: scrollerRef} = useFadeScroller('y')
	return (
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
				ref={mergeRefs([viewportRef, scrollerRef])}
				className={cn(scrollerClass, 'h-full w-full rounded-[inherit] [&>div]:!block')}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	)
}

function ScrollBar({
	className,
	ref,
	orientation = 'vertical',
	...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
	ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>
}) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			ref={ref}
			orientation={orientation}
			className={cn(
				'group flex touch-none rounded-tl-4 transition-colors hover:bg-white/10',
				orientation === 'vertical' && 'mt-[38px] h-[calc(100%-38px)] w-[11px] border-l border-l-transparent p-[4px]',
				orientation === 'horizontal' && 'h-[11px] flex-col border-t border-t-transparent p-[4px]',
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-full bg-white/20 group-hover:bg-white/50' />
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	)
}

export {ScrollArea, ScrollBar}
