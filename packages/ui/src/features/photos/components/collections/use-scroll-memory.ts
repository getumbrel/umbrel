import {useLayoutEffect, useRef} from 'react'

// A collection page unmounts whenever one of its collections is opened (the
// routes swap the whole view), so its scroll position is kept here for the
// session and put back before paint — coming back from an album or a person,
// or from choosing a cover, lands where the user left, not at the top.
const scrollPositions = new Map<string, number>()

// The scroller only exists once the page's list has loaded, so the restore
// waits for `ready`; the grids' heights are pure CSS (aspect-ratio tiles),
// already laid out when this runs
export function useScrollMemory(key: string, ready: boolean) {
	const scrollerRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const el = scrollerRef.current
		if (!el) return
		el.scrollTop = scrollPositions.get(key) ?? 0
		return () => {
			scrollPositions.set(key, el.scrollTop)
		}
	}, [key, ready])
	return scrollerRef
}
