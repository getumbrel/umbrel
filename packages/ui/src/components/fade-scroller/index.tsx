import {ComponentPropsWithoutRef, ForwardedRef, forwardRef, useLayoutEffect, useRef} from 'react'

import './index.css'

import {mergeRefs} from 'react-merge-refs'

export type FadeScrollerProps = ComponentPropsWithoutRef<'div'> & {
	direction: 'x' | 'y'
	debug?: boolean
}

const FADE_SCROLLER_CLASS_X = 'umbrel-fade-scroller-x'
const FADE_SCROLLER_CLASS_Y = 'umbrel-fade-scroller-y'

export function useFadeScroller(direction: 'x' | 'y', debug?: boolean) {
	const ref = useRef<HTMLDivElement>(null)

	// TODO: consider re-running this effect when window is resized
	// NOTE: useLayoutEffect is used to avoid flicker when fading is rendered
	useLayoutEffect(() => {
		// Horizontal scroll in chrome adds fading via scroll-timeline even when it shouldn't. This happens in the 3-up section of the app store
		// Animating in the side fades also doesn't work because the positions of the gradient markers would be based on the scroll position
		const el = ref!.current
		if (!el) return

		const handleScroll = () => {
			if (!el) return

			if (debug) {
				// console.log('scroll', el.scrollLeft, el.scrollWidth, el.clientWidth)
				// eslint-disable-next-line no-debugger
				debugger
			}

			// Round to avoid issues with sub-pixel scrolling
			// Using `<` and `>` to capture the edge case where the user scrolls past the end of the content (iOS bouncing)
			const atStart = direction === 'x' ? el.scrollLeft <= 0 : el.scrollTop <= 0
			const atEnd =
				direction === 'x'
					? Math.round(el.scrollLeft) + el.clientWidth >= el.scrollWidth
					: Math.round(el.scrollTop) + el.clientHeight >= el.scrollHeight

			// if (direction === 'x') {
			// 	console.log('fractionScrolled', atStart, atEnd, Math.round(el.scrollLeft), el.scrollWidth - el.clientWidth)
			// } else {
			// 	console.log('fractionScrolled', atStart, atEnd, Math.round(el.scrollTop), el.scrollHeight - el.clientHeight)
			// }

			if (atStart && atEnd) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `0px`)
			} else if (atStart) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `50px`)
			} else if (atEnd) {
				el.style.setProperty('--distance1', `50px`)
				el.style.setProperty('--distance2', `0px`)
			} else {
				el.style.setProperty('--distance1', `50px`)
				el.style.setProperty('--distance2', `50px`)
			}
		}

		// Run on mount by default
		handleScroll()

		el.addEventListener('scroll', handleScroll)
		return () => {
			el.removeEventListener('scroll', handleScroll)
		}
	}, [debug, direction])

	const scrollerClass =
		direction === 'x' ? FADE_SCROLLER_CLASS_X : direction === 'y' ? FADE_SCROLLER_CLASS_Y : undefined

	return {scrollerClass, ref}
}

export const FadeScroller = forwardRef(
	({direction, debug, className, ...props}: FadeScrollerProps, ref: ForwardedRef<HTMLDivElement>) => {
		const {scrollerClass, ref: scrollerRef} = useFadeScroller(direction, debug)

		return <div ref={mergeRefs([ref, scrollerRef])} className={scrollerClass + ' ' + className} {...props} />
	},
)
