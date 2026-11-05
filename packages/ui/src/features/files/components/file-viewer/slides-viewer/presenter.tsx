import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {useAwake} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {Presentation} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {SlidePill, SlideView} from '@/features/files/components/file-viewer/slides-viewer/slide'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useContainerSize} from '@/hooks/use-container-size'
import {cn} from '@/lib/utils'

// The cursor and the controls go after this long without the pointer moving
const IDLE_MS = 2000
// How far a finger has to travel sideways to turn the slide
const SWIPE = 48

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'])
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'])

// The next slide a slideshow shows from `index` going `direction`: hidden slides are skipped
export function visibleFrom(deck: Presentation, index: number, direction: 1 | -1): number | undefined {
	for (let at = index + direction; at >= 0 && at < deck.slideCount; at += direction) if (!deck.isHidden(at)) return at
	return undefined
}

// The slideshow: black, each visible slide fitted whole and fading in over the one before. A click, a tap, Space
// or → goes on, ← back, a swipe either way; after the last slide comes a black end screen, and going on from there
// ends the show. Its keys are caught before anything else hears them, so the viewer's own and the shell's (Space
// closes a quick look, Escape closes the viewer) stand aside: Escape ends the show, and only the next one closes.
// In fullscreen the browser keeps Escape for itself and leaves fullscreen, which ends the show as well.
export function Presenter({
	deck,
	start,
	onExit,
	ref,
}: {
	deck: Presentation
	start: number
	// Where the show was when it ended, for the stage to carry on from
	onExit: (index: number) => void
	ref: React.RefObject<HTMLDivElement | null>
}) {
	const {t} = useTranslation()
	const isTouch = useIsTouchDevice()
	const end = deck.slideCount
	const last = deck.isHidden(end - 1) ? visibleFrom(deck, end - 1, -1) : end - 1
	// The slide on show, and the one it's fading in over
	const [shown, setShown] = useState<{index: number; previous?: number}>({index: start})
	const [active, wake] = useAwake(IDLE_MS)
	const size = useContainerSize(ref)
	const scale = Math.min(size.width / deck.slideSize.width, size.height / deck.slideSize.height)
	const touch = useRef<{id: number; x: number; y: number; swiped: boolean}>(undefined)

	const at = shown.index === end ? (last ?? start) : shown.index
	const show = (index: number) => {
		setShown((shown) => (index === shown.index ? shown : {index, previous: shown.index}))
		wake()
	}
	const step = (direction: 1 | -1) => {
		if (direction < 0) {
			const previous = visibleFrom(deck, shown.index, -1)
			if (previous !== undefined) show(previous)
		} else if (shown.index === end) onExit(at)
		else show(visibleFrom(deck, shown.index, 1) ?? end)
	}

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return
			const direction = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0
			const jump = event.key === 'Home' ? visibleFrom(deck, -1, 1) : event.key === 'End' ? last : undefined
			// Tab too: there's nothing to move to while the show is on
			if (!direction && jump === undefined && event.key !== 'Escape' && event.key !== 'Tab') return
			event.preventDefault()
			event.stopPropagation()
			if (event.key === 'Escape') onExit(at)
			else if (direction) step(direction)
			else if (jump !== undefined) show(jump)
		}
		window.addEventListener('keydown', onKeyDown, {capture: true})
		return () => window.removeEventListener('keydown', onKeyDown, {capture: true})
	})

	useEffect(() => {
		const onChange = () => !document.fullscreenElement && onExit(at)
		document.addEventListener('fullscreenchange', onChange)
		return () => document.removeEventListener('fullscreenchange', onChange)
	})

	useEffect(() => ref.current?.focus({preventScroll: true}), [ref])

	return (
		<div
			ref={ref}
			tabIndex={-1}
			role='region'
			aria-label={t('files-slides.slideshow')}
			onPointerMove={(event) => event.pointerType === 'mouse' && wake()}
			onPointerDown={(event) => {
				wake()
				// A second finger leaves the first one's swipe be
				if (!event.isPrimary) return
				touch.current =
					event.pointerType === 'touch'
						? {id: event.pointerId, x: event.clientX, y: event.clientY, swiped: false}
						: undefined
			}}
			onPointerUp={(event) => {
				const start = touch.current
				if (start?.id !== event.pointerId) return
				const dx = event.clientX - start.x
				if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(event.clientY - start.y)) return
				start.swiped = true
				step(dx < 0 ? 1 : -1)
			}}
			onClick={(event) => {
				// Links and the controls do their own thing; a swipe has already turned the slide
				if (event.button !== 0 || (event.target as Element).closest('a, [role="toolbar"]') || touch.current?.swiped)
					return
				step(1)
			}}
			className={cn(
				'fixed inset-0 z-50 touch-pan-y overflow-hidden bg-black outline-hidden select-none',
				!active && 'cursor-none',
			)}
		>
			{size.width > 0 &&
				[shown.previous, shown.index].map(
					(index, layer) =>
						index !== undefined &&
						index !== end && (
							<div
								key={index}
								aria-hidden={layer === 0 || undefined}
								className={cn(
									'absolute inset-0 flex items-center justify-center',
									layer === 1 && 'motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in',
								)}
							>
								<SlideView deck={deck} index={index} scale={scale} />
							</div>
						),
				)}
			{shown.index === end && (
				<div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black text-center motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in'>
					<p className='text-15 font-medium text-white/70'>{t('files-slides.end')}</p>
					<p className='text-13 text-white/40'>{t(isTouch ? 'files-slides.end-tap' : 'files-slides.end-click')}</p>
				</div>
			)}
			<SlidePill
				index={at}
				count={end}
				awake={active}
				canStep={(direction) => direction > 0 || visibleFrom(deck, shown.index, -1) !== undefined}
				onStep={step}
				onExit={() => onExit(at)}
			/>
		</div>
	)
}
