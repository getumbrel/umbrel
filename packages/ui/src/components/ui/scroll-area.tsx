import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import {mergeRefs} from 'react-merge-refs'

import {useFadeScroller} from '@/components/fade-scroller'
import {cn} from '@/lib/utils'

type Props = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
	dialogInset?: boolean
	fade?: boolean
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
	fade = true,
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
					'flex h-full w-full rounded-[inherit] outline-hidden *:!block *:flex-grow',
					orientation === 'vertical' && 'flex-col',
					fade && scrollerClass,
				)}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar
				dialogInset={dialogInset}
				scrollbarClass={scrollbarClass}
				orientation={orientation}
				// A scrollbar that stays up for as long as there is more to scroll to keeps quiet about it
				quiet={props.type === 'auto' || props.type === 'always'}
			/>
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	)
}

function ScrollBar({
	className,
	ref,
	dialogInset,
	scrollbarClass,
	quiet,
	orientation = 'vertical',
	...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
	dialogInset?: boolean
	scrollbarClass?: string
	quiet?: boolean
	ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>
}) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			ref={ref}
			orientation={orientation}
			className={cn(
				// The thumb of every scrollbar in umbrelOS (see modules/scrollbars and index.css)
				'umbrel-scrollbar-track flex touch-none',
				quiet && 'umbrel-scrollbar-track-quiet',
				orientation === 'vertical' && 'w-[11px] px-[3.5px] py-0.5',
				orientation === 'vertical' && dialogInset && 'my-5',
				orientation === 'horizontal' && 'h-[11px] flex-col px-0.5 py-[3.5px]',
				orientation === 'horizontal' && dialogInset && 'mx-5',
				scrollbarClass,
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb className='umbrel-scrollbar-thumb relative' />
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	)
}

export {ScrollArea, ScrollBar}
