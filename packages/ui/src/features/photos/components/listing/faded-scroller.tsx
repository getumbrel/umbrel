import type {ComponentPropsWithoutRef, Ref} from 'react'

import type {Frame} from '@/features/photos/components/listing/surface'
import {cn} from '@/lib/utils'

// A listing's scroller: fills its surface, and what scrolls up under the
// actions bar floating over it dissolves into the window (the mask in
// .umbrel-photos-scroller, fed the frame). Its scrollbar takes no room (see
// modules/scrollbars), so the grid keeps one width whatever is at its edge,
// and the thumb starts where the fade ends rather than under the bar.
//
// `hideScrollbar` takes the scrollbar away for something that replaces it at
// the edge (the time rail).
export function FadedScroller({
	frame,
	hideScrollbar = false,
	ref,
	className,
	style,
	children,
	...props
}: ComponentPropsWithoutRef<'div'> & {frame: Frame; hideScrollbar?: boolean; ref?: Ref<HTMLDivElement>}) {
	return (
		<div
			ref={ref}
			className={cn(
				'umbrel-photos-scroller h-full w-full overflow-x-hidden overflow-y-auto overscroll-contain',
				className,
			)}
			// Our own thumb and the WebKit rule in index.css ride this; scrollbar-width covers the rest
			data-scrollbar-hidden={hideScrollbar ? '' : undefined}
			style={{
				['--umbrel-photos-fade-from' as string]: `${frame.fadeFrom}px`,
				['--umbrel-photos-fade-to' as string]: `${frame.fadeTo}px`,
				['--scrollbar-top' as string]: `${frame.fadeTo}px`,
				// Focus and scrollIntoView bring things out from under the (pinned) bar
				scrollPaddingTop: frame.fadeTo,
				...(hideScrollbar ? {scrollbarWidth: 'none'} : null),
				...style,
			}}
			{...props}
		>
			{children}
		</div>
	)
}
