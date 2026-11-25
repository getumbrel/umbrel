import {useLayoutEffect, useRef} from 'react'

import {FadeScroller} from '@/components/fade-scroller'
import {DestinationBreadcrumbs} from '@/features/files/components/dialogs/cloud-add-dialog/destination-step'

// Keep the current folder in view when the path first appears (and when the
// viewer steps to an item in another folder). The rest of the path remains
// available by scrolling back through the faded leading edge. A path that
// fits is left at its start: its width is rarely a whole number of pixels, and
// the fraction it could be scrolled by would fade its first folder out. The
// fade is a shallow one, so a path only a little too long keeps its first
// name readable.
export function FolderBreadcrumbScroller({path, homePath}: {path: string; homePath: string}) {
	const scrollerRef = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return
		const overflows = scroller.scrollWidth - scroller.clientWidth > 1
		scroller.scrollLeft = overflows ? scroller.scrollWidth : 0
	}, [path])

	return (
		<FadeScroller
			direction='x'
			fadeSize={16}
			ref={scrollerRef}
			className='umbrel-hide-scrollbar min-w-0 overflow-x-auto whitespace-nowrap'
		>
			{/* File badges protrude past their folder icon. Keep that intentional
			    overhang inside the scroller so shared roots are not clipped. */}
			<div className='w-max min-w-full p-1'>
				<DestinationBreadcrumbs path={path} homePath={homePath} />
			</div>
		</FadeScroller>
	)
}
