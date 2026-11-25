import {useLayoutEffect, useRef, type RefObject} from 'react'

// Where the view should be scrolled to put `target` in it: its middle a
// third of the way down, which shows what leads to it and leaves room for
// what follows. Nothing moves when it is already comfortably in view.
export function revealTop(
	view: {scrollTop: number; top: number; height: number; scrollHeight: number},
	target: {top: number; height: number},
) {
	const within = target.top - view.top
	const inView = within >= view.height * 0.08 && within + target.height <= view.height * 0.92
	if (inView) return view.scrollTop
	const top = view.scrollTop + within + target.height / 2 - view.height / 3
	return Math.round(Math.min(Math.max(0, view.scrollHeight - view.height), Math.max(0, top)))
}

// The panel a search result opens with is scrolled to what the search
// matched, once per item and match: the words in a card that may sit below
// the fold, and that may only arrive after the panel has opened (Search
// answers on its own time). Until a match shows up the view starts at the
// top for a new item, rather than wherever the last one was left. Once the
// match has been shown, the scroll is the reader's.
//
// A frame late on purpose: cards settle their own size in layout effects
// (a text card unfolds when its match is below its fold) after this one's
// would have measured.
export function useRevealMatch(scrollerRef: RefObject<HTMLElement | null>, key: string, wanted: boolean) {
	const done = useRef<string>(undefined)
	const seen = useRef<string>(undefined)
	useLayoutEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || done.current === key) return
		if (seen.current !== key) {
			seen.current = key
			scroller.scrollTop = 0
		}
		if (!wanted) return
		const frame = requestAnimationFrame(() => {
			const target = scroller.querySelector<HTMLElement>('[data-match-target]')
			if (!target || done.current === key) return
			done.current = key
			const view = scroller.getBoundingClientRect()
			const rect = target.getBoundingClientRect()
			scroller.scrollTop = revealTop(
				{scrollTop: scroller.scrollTop, top: view.top, height: view.height, scrollHeight: scroller.scrollHeight},
				{top: rect.top, height: rect.height},
			)
		})
		return () => cancelAnimationFrame(frame)
	})
}
