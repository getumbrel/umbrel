import {useEffect, useRef, useState, type ComponentPropsWithoutRef, type Ref} from 'react'
import {mergeRefs} from 'react-merge-refs'

import type {Frame} from '@/features/photos/components/listing/surface'
import {cn} from '@/lib/utils'

// How wide a scrollbar that takes layout space is here (Windows, Linux, a
// Mac set to always show them), 0 where scrollbars are overlays. Only a
// classic one is worth reserving a gutter for: WebKit reserves one for its
// overlay scrollbars too, which take no space, and the strip sat blank down
// the right of every phone. Probed once.
let classicScrollbar: number | undefined
function classicScrollbarWidth() {
	if (classicScrollbar === undefined) {
		const probe = document.createElement('div')
		probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
		document.body.append(probe)
		classicScrollbar = probe.offsetWidth - probe.clientWidth
		probe.remove()
	}
	return classicScrollbar
}

// A listing's scroller: fills its surface, and what scrolls up under the
// actions bar floating over it dissolves into the window (the mask in
// .umbrel-photos-scroller, fed the frame). A classic scrollbar is measured
// so the mask can leave it alone, and the content already keeps clear of it
// — its gutter is reserved so it can't come and go with the content and
// resize the grid (see .umbrel-photos-scroller); with overlay scrollbars
// there is nothing to reserve.
//
// `hideScrollbar` takes the scrollbar off the edge for something that
// replaces it there (the time rail) without giving its strip back to the
// content: `scrollbar-width: none` releases the gutter as well as the
// scrollbar, so the strip is kept as padding instead — the same px the
// scrollbar took, and none with overlay scrollbars. Whatever occupies the
// edge, the content keeps one width.
export function FadedScroller({
	frame,
	hideScrollbar = false,
	ref,
	className,
	style,
	children,
	...props
}: ComponentPropsWithoutRef<'div'> & {frame: Frame; hideScrollbar?: boolean; ref?: Ref<HTMLDivElement>}) {
	const ownRef = useRef<HTMLDivElement>(null)
	const [scrollbar, setScrollbar] = useState(0)
	// Settled in the first render, so the grid never lays out for a gutter it won't have
	const [classic] = useState(classicScrollbarWidth)
	// Re-measured when the scrollbar is hidden or shown: its strip stays the
	// same size either way (padding takes over), so no resize fires for it
	useEffect(() => {
		const el = ownRef.current
		if (!el) return
		const measure = () => setScrollbar(el.offsetWidth - el.clientWidth)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [hideScrollbar])

	return (
		<div
			ref={mergeRefs([ref, ownRef])}
			className={cn(
				'umbrel-photos-scroller h-full w-full overflow-x-hidden overflow-y-auto overscroll-contain',
				className,
			)}
			data-scrollbar={scrollbar > 0 ? '' : undefined}
			// The WebKit rule in index.css rides this; scrollbar-width covers the rest
			data-scrollbar-hidden={hideScrollbar ? '' : undefined}
			style={{
				['--umbrel-photos-fade-from' as string]: `${frame.fadeFrom}px`,
				['--umbrel-photos-fade-to' as string]: `${frame.fadeTo}px`,
				['--umbrel-photos-scrollbar' as string]: `${scrollbar}px`,
				// Focus and scrollIntoView bring things out from under the (pinned) bar
				scrollPaddingTop: frame.fadeTo,
				scrollbarGutter: classic > 0 ? 'stable' : 'auto',
				...(hideScrollbar ? {scrollbarWidth: 'none', paddingRight: classic > 0 ? classic : undefined} : null),
				...style,
			}}
			{...props}
		>
			{children}
		</div>
	)
}
