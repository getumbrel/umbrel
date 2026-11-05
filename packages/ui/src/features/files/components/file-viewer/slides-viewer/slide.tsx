import {ChevronLeft, ChevronRight, EyeOff, X} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react'
import {useTranslation} from 'react-i18next'

import {FloatingPill, keepFocus, PillButton, PillDivider} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {Presentation} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {cn} from '@/lib/utils'

// A slide as the engine draws it, shown at `scale` of its own size. Every place a slide appears holds its own
// drawing: the engine hands out a fresh element each time, cheaply. One per slide: key it by index.
export function SlideView({
	deck,
	index,
	scale,
	version,
	editable = false,
	onDrawn,
	className,
}: {
	deck: Presentation
	index: number
	scale: number
	// A change draws the slide again (its text was edited elsewhere)
	version?: number
	editable?: boolean
	// Told of the drawing, now and whenever it's drawn again (a neighbour becoming the slide on stage starts
	// telling without being drawn again)
	onDrawn?: (element: HTMLElement) => void
	className?: string
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const [element, setElement] = useState<HTMLElement>()
	useLayoutEffect(() => {
		const drawn = deck.renderSlide(index)
		hostRef.current!.replaceChildren(drawn)
		setElement(drawn)
		return () => drawn.remove()
	}, [deck, index, version])
	useLayoutEffect(() => {
		if (element) onDrawn?.(element)
	}, [element, onDrawn])
	useEffect(() => {
		if (!element || !editable) return
		deck.setEditable(index, element, true)
		return () => deck.setEditable(index, element, false)
	}, [deck, index, element, editable])
	const {width, height} = deck.slideSize
	return (
		<div className={cn('overflow-hidden', className)} style={{width: width * scale, height: height * scale}}>
			<div
				ref={hostRef}
				style={
					{width, height, transform: `scale(${scale})`, transformOrigin: '0 0', '--slide-scale': scale} as CSSProperties
				}
			/>
		</div>
	)
}

// Where the deck is, floating over the bottom of the slide: "4 / 24" between previous and next, and in a slideshow
// a way out. It keeps out of the way unless `awake`, hovered or focused from the keyboard.
export function SlidePill({
	index,
	count,
	hidden = false,
	awake,
	canStep,
	onStep,
	onExit,
	pillRef,
}: {
	index: number
	count: number
	hidden?: boolean
	awake: boolean
	canStep: (direction: 1 | -1) => boolean
	onStep: (direction: 1 | -1) => void
	onExit?: () => void
	pillRef?: React.Ref<HTMLDivElement>
}) {
	const {t} = useTranslation()
	return (
		<>
			<FloatingPill
				label={t('files-slides.navigation')}
				awake={awake}
				pillRef={pillRef}
				onMouseDown={keepFocus}
				className='bottom-3'
			>
				<PillButton
					icon={ChevronLeft}
					label={t('files-slides.previous')}
					disabled={!canStep(-1)}
					onClick={() => onStep(-1)}
				/>
				<span aria-hidden='true' className='flex items-center gap-1.5 px-1.5'>
					{index + 1} / {count}
					{hidden && <EyeOff className='size-3.5 text-white/50' />}
				</span>
				<PillButton
					icon={ChevronRight}
					label={t('files-slides.next')}
					disabled={!canStep(1)}
					onClick={() => onStep(1)}
				/>
				{onExit && (
					<>
						<PillDivider />
						<PillButton icon={X} label={t('files-slides.exit')} onClick={onExit} />
					</>
				)}
			</FloatingPill>
			<span aria-live='polite' className='sr-only'>
				{t(hidden ? 'files-slides.position-hidden' : 'files-slides.position', {current: index + 1, total: count})}
			</span>
		</>
	)
}
