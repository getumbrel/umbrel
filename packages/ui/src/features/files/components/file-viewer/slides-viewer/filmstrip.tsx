import {EyeOff} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {keepFocus} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {Presentation} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {SlideView} from '@/features/files/components/file-viewer/slides-viewer/slide'
import {cn} from '@/lib/utils'

// Thumbs are mounted this far beyond each edge of the strip
const OVERSCAN = 4
// Room around the thumbs for the current one's ring
const INSET = 4

// The deck's slides in a row along the bottom of the stage, as in the Photos filmstrip: windowed (a long deck only
// ever draws the thumbs in view), the current slide ringed and kept in view, hidden slides dimmed. A deck that fits
// sits centred; a longer one scrolls, and a vertical wheel scrolls it sideways.
export function Filmstrip({
	deck,
	current,
	versions,
	compact,
	onSelect,
}: {
	deck: Presentation
	current: number
	// Bumped for a slide whose text changed, to draw its thumb again
	versions: Record<number, number>
	compact: boolean
	onSelect: (index: number) => void
}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const scrollerRef = useRef<HTMLDivElement>(null)
	const count = deck.slideCount
	const height = compact ? 44 : 64
	const width = Math.max(16, Math.round((height * deck.slideSize.width) / deck.slideSize.height))
	const gap = compact ? 8 : 10
	const slot = width + gap
	const length = count * slot - gap + 2 * INSET
	const [view, setView] = useState({start: 0, end: 0})

	useLayoutEffect(() => {
		const scroller = scrollerRef.current!
		const measure = () => {
			const left = scroller.scrollLeft - INSET
			const start = Math.max(0, Math.floor(left / slot) - OVERSCAN)
			const end = Math.min(count, Math.ceil((left + scroller.clientWidth) / slot) + OVERSCAN)
			setView((view) => (view.start === start && view.end === end ? view : {start, end}))
		}
		measure()
		scroller.addEventListener('scroll', measure, {passive: true})
		const observer = new ResizeObserver(measure)
		observer.observe(scroller)
		// A mouse wheel is vertical, the strip isn't. React's wheel listener is passive, so this one is the strip's
		// own, to claim the event.
		const onWheel = (event: WheelEvent) => {
			if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
			event.preventDefault()
			scroller.scrollLeft += event.deltaY
		}
		scroller.addEventListener('wheel', onWheel, {passive: false})
		return () => {
			scroller.removeEventListener('scroll', measure)
			scroller.removeEventListener('wheel', onWheel)
			observer.disconnect()
		}
	}, [count, slot])

	// The current thumb stays in view, with a neighbour's room either side: carried there from nearby, placed at
	// once the first time and from far off (Home, End, find) rather than sweeping past the whole deck
	const placed = useRef(false)
	useLayoutEffect(() => {
		const scroller = scrollerRef.current!
		const left = INSET + current * slot
		const room = Math.min(slot, (scroller.clientWidth - width) / 2)
		const inView =
			left - room >= scroller.scrollLeft && left + width + room <= scroller.scrollLeft + scroller.clientWidth
		const target = left + width / 2 - scroller.clientWidth / 2
		const near = Math.abs(target - scroller.scrollLeft) < scroller.clientWidth
		if (!inView)
			scroller.scrollTo({left: target, behavior: placed.current && near && !reduceMotion ? 'smooth' : 'instant'})
		placed.current = true
	}, [current, slot, width, reduceMotion])

	const thumbs = []
	for (let index = view.start; index < view.end; index++) {
		const hidden = deck.isHidden(index)
		thumbs.push(
			<button
				key={index}
				type='button'
				aria-label={t(hidden ? 'files-slides.go-to-hidden-slide' : 'files-slides.go-to-slide', {number: index + 1})}
				aria-current={index === current || undefined}
				onMouseDown={keepFocus}
				onClick={() => onSelect(index)}
				className={cn(
					'absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-[5px] bg-white/8 ring-white outline-hidden transition-[opacity,box-shadow] duration-200',
					index === current
						? 'ring-2'
						: 'opacity-75 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60',
				)}
				style={{left: INSET + index * slot, width, height}}
			>
				<Thumb
					deck={deck}
					index={index}
					version={versions[index]}
					scale={height / deck.slideSize.height}
					hidden={hidden}
				/>
				{hidden && (
					<span className='absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-black/60'>
						<EyeOff className='size-2.5 text-white/90' />
					</span>
				)}
			</button>,
		)
	}

	return (
		<FadeScroller
			ref={scrollerRef}
			direction='x'
			fadeSize={32}
			role='group'
			aria-label={t('files-slides.slides')}
			className='umbrel-hide-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain'
		>
			<div className='relative mx-auto' style={{width: length, height: height + 2 * INSET}}>
				{thumbs}
			</div>
		</FadeScroller>
	)
}

// A slide drawn small, a frame after it mounts: opening a deck paints the slide on stage first, and a fling
// through the strip never waits on it. It's inert, so links in it take no clicks or focus.
function Thumb({
	deck,
	index,
	version,
	scale,
	hidden,
}: {
	deck: Presentation
	index: number
	version: number | undefined
	scale: number
	hidden: boolean
}) {
	const [ready, setReady] = useState(false)
	useEffect(() => setReady(true), [])
	return (
		<div inert className={cn(hidden && 'opacity-40')}>
			{ready && <SlideView deck={deck} index={index} version={version} scale={scale} />}
		</div>
	)
}
