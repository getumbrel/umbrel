import {ComponentPropsWithoutRef, useEffect, useRef} from 'react'

import './index.css'

type FadeScrollerProps = ComponentPropsWithoutRef<'div'> & {
	direction: 'x' | 'y'
	debug?: boolean
}

const supportsScrollTimeline = CSS.supports('scroll-timeline', '--scroll-timeline')

const FADE_SCROLLER_CLASS_X = 'umbrel-fade-scroller-x'
const FADE_SCROLLER_CLASS_Y = 'umbrel-fade-scroller-y'

export function useFadeScroller(direction: 'x' | 'y', debug?: boolean) {
	const ref = useRef<HTMLDivElement>(null)

	// TODO: consider re-running this effect when window is resized
	useEffect(() => {
		if (supportsScrollTimeline) return
		const el = ref!.current
		if (!el) return

		const handleScroll = () => {
			if (!el) return

			if (debug) {
				// eslint-disable-next-line no-debugger
				debugger
			}

			// TODO: don't use fraction, just calculate distance from beginning and end
			const fractionScrolled =
				direction === 'x'
					? el.scrollLeft / (el.scrollWidth - el.clientWidth)
					: el.scrollTop / (el.scrollHeight - el.clientHeight)

			if (isNaN(fractionScrolled)) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `0px`)
			} else if (fractionScrolled <= 0.01) {
				el.style.setProperty('--distance1', `0px`)
				el.style.setProperty('--distance2', `50px`)
			} else if (fractionScrolled >= 0.99) {
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

export function FadeScroller({direction, debug, className, ...props}: FadeScrollerProps) {
	const {scrollerClass, ref} = useFadeScroller(direction, debug)

	return <div ref={ref} className={scrollerClass + ' ' + className} {...props} />
}
