import useEmblaCarousel, {type UseEmblaCarouselType} from 'embla-carousel-react'
import {ArrowLeft, ArrowRight} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import * as React from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronLeft, TbChevronRight} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {useDocumentHidden} from '@/hooks/use-document-hidden'
import {cn} from '@/lib/utils'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
	opts?: CarouselOptions
	plugins?: CarouselPlugin
	orientation?: 'horizontal' | 'vertical'
	setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
	carouselRef: ReturnType<typeof useEmblaCarousel>[0]
	api: ReturnType<typeof useEmblaCarousel>[1]
	scrollPrev: () => void
	scrollNext: () => void
	canScrollPrev: boolean
	canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
	const context = React.useContext(CarouselContext)

	if (!context) {
		throw new Error('useCarousel must be used within a <Carousel />')
	}

	return context
}

function Carousel({
	orientation = 'horizontal',
	opts,
	setApi,
	plugins,
	className,
	children,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & CarouselProps & {ref?: React.Ref<HTMLDivElement>}) {
	const {t} = useTranslation()
	const [carouselRef, api] = useEmblaCarousel(
		{
			...opts,
			axis: orientation === 'horizontal' ? 'x' : 'y',
		},
		plugins,
	)
	const [canScrollPrev, setCanScrollPrev] = React.useState(false)
	const [canScrollNext, setCanScrollNext] = React.useState(false)

	const onSelect = React.useCallback((api: CarouselApi) => {
		if (!api) {
			return
		}

		setCanScrollPrev(api.canScrollPrev())
		setCanScrollNext(api.canScrollNext())
	}, [])

	const scrollPrev = React.useCallback(() => {
		api?.scrollPrev()
	}, [api])

	const scrollNext = React.useCallback(() => {
		api?.scrollNext()
	}, [api])

	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'ArrowLeft') {
				event.preventDefault()
				scrollPrev()
			} else if (event.key === 'ArrowRight') {
				event.preventDefault()
				scrollNext()
			}
		},
		[scrollPrev, scrollNext],
	)

	React.useEffect(() => {
		if (!api || !setApi) {
			return
		}

		setApi(api)
	}, [api, setApi])

	React.useEffect(() => {
		if (!api) {
			return
		}

		onSelect(api)
		api.on('reInit', onSelect)
		api.on('select', onSelect)

		return () => {
			api?.off('select', onSelect)
		}
	}, [api, onSelect])

	return (
		<CarouselContext
			value={{
				carouselRef,
				api: api,
				opts,
				orientation: orientation || (opts?.axis === 'y' ? 'vertical' : 'horizontal'),
				scrollPrev,
				scrollNext,
				canScrollPrev,
				canScrollNext,
			}}
		>
			<div
				ref={ref}
				onKeyDownCapture={handleKeyDown}
				className={cn('relative', className)}
				role='region'
				aria-roledescription={t('carousel.roledescription')}
				{...props}
			>
				{children}
			</div>
		</CarouselContext>
	)
}

function CarouselContent({
	className,
	containerClassName,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	/** Extra classes for the overflow-clipping viewport (e.g. inner padding so
	 * slides align to the content grid while bleeding to the sheet edges) */
	containerClassName?: string
	ref?: React.Ref<HTMLDivElement>
}) {
	const {carouselRef, orientation} = useCarousel()

	return (
		<div ref={carouselRef} className={cn('overflow-hidden', containerClassName)}>
			<div
				ref={ref}
				className={cn('flex', orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col', className)}
				{...props}
			/>
		</div>
	)
}

function CarouselItem({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {ref?: React.Ref<HTMLDivElement>}) {
	const {t} = useTranslation()
	const {orientation} = useCarousel()

	return (
		<div
			ref={ref}
			role='group'
			aria-roledescription={t('carousel.slide-roledescription')}
			className={cn('min-w-0 shrink-0 grow-0 basis-full', orientation === 'horizontal' ? 'pl-4' : 'pt-4', className)}
			{...props}
		/>
	)
}

function CarouselPrevious({
	className,
	ref,
	variant = 'default',
	size = 'icon-only',
	...props
}: React.ComponentProps<typeof Button> & {ref?: React.Ref<HTMLButtonElement>}) {
	const {t} = useTranslation()
	const {orientation, scrollPrev, canScrollPrev} = useCarousel()

	return (
		<Button
			ref={ref}
			variant={variant}
			size={size}
			className={cn(
				'absolute h-8 w-8 rounded-full',
				orientation === 'horizontal'
					? 'top-1/2 -left-12 -translate-y-1/2'
					: '-top-12 left-1/2 -translate-x-1/2 rotate-90',
				className,
			)}
			disabled={!canScrollPrev}
			onClick={scrollPrev}
			{...props}
		>
			<ArrowLeft className='h-4 w-4' />
			<span className='sr-only'>{t('carousel.previous')}</span>
		</Button>
	)
}

function CarouselNext({
	className,
	ref,
	variant = 'default',
	size = 'icon-only',
	...props
}: React.ComponentProps<typeof Button> & {ref?: React.Ref<HTMLButtonElement>}) {
	const {t} = useTranslation()
	const {orientation, scrollNext, canScrollNext} = useCarousel()

	return (
		<Button
			ref={ref}
			variant={variant}
			size={size}
			className={cn(
				'absolute h-8 w-8 rounded-full',
				orientation === 'horizontal'
					? 'top-1/2 -right-12 -translate-y-1/2'
					: '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
				className,
			)}
			disabled={!canScrollNext}
			onClick={scrollNext}
			{...props}
		>
			<ArrowRight className='h-4 w-4' />
			<span className='sr-only'>{t('carousel.next')}</span>
		</Button>
	)
}

/** The carousel's snap positions and which one is active, kept in sync with the api */
function useCarouselSnaps(api: CarouselApi) {
	const [snapCount, setSnapCount] = React.useState(0)
	const [activeIndex, setActiveIndex] = React.useState(0)
	const [canScrollPrev, setCanScrollPrev] = React.useState(false)
	const [canScrollNext, setCanScrollNext] = React.useState(false)

	React.useEffect(() => {
		if (!api) return
		const update = () => {
			setSnapCount(api.scrollSnapList().length)
			setActiveIndex(api.selectedScrollSnap())
			setCanScrollPrev(api.canScrollPrev())
			setCanScrollNext(api.canScrollNext())
		}
		update()
		api.on('select', update)
		api.on('reInit', update)
		return () => {
			api.off('select', update)
			api.off('reInit', update)
		}
	}, [api])

	return {snapCount, activeIndex, canScrollPrev, canScrollNext}
}

/** Drives the active dot's countdown fill; the fill advances the carousel when it completes. */
type CarouselCountdown = {
	durationMs: number
	/** Freezes the fill in place (dragging, hovering, focus within, hidden tab) */
	held: boolean
	onComplete: () => void
}

/**
 * Auto-advances the carousel: the active dot's fill is a CSS animation lasting
 * `intervalMs` and the carousel moves on when it ends, so nothing ticks in
 * JavaScript. The countdown holds while the user is dragging, hovering,
 * focusing carousel content, or while the tab is hidden, restarts whenever the
 * slide changes, and is disabled entirely under reduced motion.
 */
function useCarouselAutoAdvance(
	api: CarouselApi,
	{intervalMs = 5000, enabled = true, paused = false} = {},
): CarouselCountdown | undefined {
	const reducedMotion = useReducedMotion()
	const documentHidden = useDocumentHidden()
	const [dragging, setDragging] = React.useState(false)
	const run = !!api && enabled && !reducedMotion

	React.useEffect(() => {
		if (!api || !run) return
		const onPointerDown = () => setDragging(true)
		const onPointerUp = () => setDragging(false)
		api.on('pointerDown', onPointerDown)
		api.on('pointerUp', onPointerUp)
		return () => {
			api.off('pointerDown', onPointerDown)
			api.off('pointerUp', onPointerUp)
		}
	}, [api, run])

	const onComplete = React.useCallback(() => {
		if (!api) return
		if (api.canScrollNext()) api.scrollNext()
		else api.scrollTo(0)
	}, [api])

	if (!run) return undefined
	return {durationMs: intervalMs, held: paused || dragging || documentHidden, onComplete}
}

/**
 * Pill dot indicators: the active dot stretches into a pill and fills up left
 * to right — over an auto-advance countdown, or to a given progress (video
 * position…); with neither it renders solid. Both fills move on the
 * compositor only.
 */
function CarouselDots({
	count,
	activeIndex,
	onSelect,
	countdown,
	progress,
	className,
}: {
	count: number
	activeIndex: number
	onSelect: (index: number) => void
	/** Auto-advance countdown filling the active dot over its duration */
	countdown?: CarouselCountdown
	/** 0–100 fill of the active dot, when it tracks something other than a countdown */
	progress?: number
	className?: string
}) {
	const {t} = useTranslation()
	if (count <= 1) return null

	return (
		<div className={cn('flex items-center justify-center gap-1', className)}>
			{Array.from({length: count}).map((_, index) => {
				const isActive = index === activeIndex

				return (
					<button
						key={index}
						onClick={() => onSelect(index)}
						className='group rounded-full p-1 outline-hidden transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/40 motion-reduce:transition-none'
						aria-label={t('carousel.go-to-slide', {number: index + 1})}
						aria-current={isActive ? 'true' : undefined}
					>
						<div
							className={cn(
								'relative h-1.5 overflow-hidden rounded-full transition-all duration-300 motion-reduce:transition-none',
								isActive ? 'w-10 bg-white/40 group-hover:bg-white/60' : 'w-1.5 bg-white/40 group-hover:bg-white/60',
							)}
						>
							{isActive && (
								// The fill slides in from the left on the compositor; a fresh element per
								// active slide restarts the countdown, and `animationend` advances
								<div
									className={cn(
										'absolute inset-0 rounded-full bg-white',
										countdown
											? 'umbrel-carousel-fill'
											: progress !== undefined &&
													'transition-transform duration-300 ease-linear motion-reduce:transition-none',
									)}
									style={
										countdown
											? {
													animationDuration: `${countdown.durationMs}ms`,
													animationPlayState: countdown.held ? 'paused' : 'running',
												}
											: progress !== undefined
												? {transform: `translateX(${Math.min(100, Math.max(0, progress)) - 100}%)`}
												: undefined
									}
									onAnimationEnd={countdown?.onComplete}
								/>
							)}
						</div>
					</button>
				)
			})}
		</div>
	)
}

const carouselArrowClass =
	'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 outline-hidden transition-colors hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40 disabled:hover:bg-white/10'

/** Round previous/next buttons for a carousel's control row (the
 * apps.umbrel.com banner treatment), sitting opposite the dots */
function CarouselArrows({
	onPrev,
	onNext,
	disablePrev = false,
	disableNext = false,
	className,
}: {
	onPrev: () => void
	onNext: () => void
	disablePrev?: boolean
	disableNext?: boolean
	className?: string
}) {
	const {t} = useTranslation()
	return (
		// Touch screens swipe, so only a pointer gets arrows
		<div className={cn('flex items-center gap-2 pointer-coarse:hidden', className)}>
			{/* Chevrons, matching the spotlight banners' View pill */}
			<button
				aria-label={t('carousel.previous')}
				onClick={onPrev}
				disabled={disablePrev}
				className={carouselArrowClass}
			>
				<TbChevronLeft className='h-4 w-4' />
			</button>
			<button aria-label={t('carousel.next')} onClick={onNext} disabled={disableNext} className={carouselArrowClass}>
				<TbChevronRight className='h-4 w-4' />
			</button>
		</div>
	)
}

export {
	type CarouselApi,
	Carousel,
	CarouselArrows,
	CarouselContent,
	CarouselDots,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
	useCarouselAutoAdvance,
	type CarouselCountdown,
	useCarouselSnaps,
}
