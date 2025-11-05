import {DialogPortal} from '@radix-ui/react-dialog'
import {useEffect, useRef, useState} from 'react'
import {TbChevronLeft, TbChevronRight} from 'react-icons/tb'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogFooter,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {Carousel, CarouselContent, CarouselItem, type CarouselApi} from '@/shadcn-components/ui/carousel'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

// Versions and features are hardcoded and we should update them on every release

const VERSION = 'umbrelOS 1.5'

const FEATURES = [
	{
		id: 1,
		video: '/whats-new/backups.webm',
		titleTKey: 'backups',
		descriptionTKey: 'whats-new.feature-1.description',
	},
	{
		id: 2,
		video: '/whats-new/rewind.webm',
		titleTKey: 'rewind',
		descriptionTKey: 'whats-new.feature-2.description',
	},
	{
		id: 3,
		video: '/whats-new/restore.webm',
		titleTKey: 'backups-restore',
		descriptionTKey: 'whats-new.feature-3.description',
	},
	{
		id: 4,
		video: '/whats-new/network-devices.webm',
		titleTKey: 'whats-new.feature-4.title',
		descriptionTKey: 'whats-new.feature-4.description',
	},
	{
		id: 5,
		video: '/whats-new/external-storage.webm',
		titleTKey: 'whats-new.feature-5.title',
		descriptionTKey: 'whats-new.feature-5.description',
		helperTextTKey: 'whats-new.feature-5.helper-text',
	},
]

function DotIndicators({
	currentIndex,
	total,
	onDotClick,
	progress,
}: {
	currentIndex: number
	total: number
	onDotClick: (index: number) => void
	progress: number
}) {
	return (
		<div className='flex items-center justify-center gap-1'>
			{Array.from({length: total}).map((_, index) => {
				const isActive = index === currentIndex

				return (
					<button
						key={index}
						onClick={() => onDotClick(index)}
						className='group p-1 transition-opacity hover:opacity-80'
						aria-label={`Go to slide ${index + 1}`}
						tabIndex={-1}
					>
						<div
							className={cn(
								'relative h-1.5 overflow-hidden rounded-full transition-all duration-300',
								isActive ? 'w-10 bg-white/40 group-hover:bg-white/60' : 'w-1.5 bg-white/40 group-hover:bg-white/60',
							)}
						>
							{isActive && (
								<div
									className='absolute inset-y-0 left-0 rounded-full bg-white transition-all duration-300 ease-linear'
									style={{width: `${progress}%`}}
								/>
							)}
						</div>
					</button>
				)
			})}
		</div>
	)
}

export function WhatsNewModal() {
	const dialogProps = useDialogOpenProps('whats-new')

	const [api, setApi] = useState<CarouselApi>()
	const [currentIndex, setCurrentIndex] = useState(0)
	const [progress, setProgress] = useState(0)
	const videoRefs = useRef<(HTMLVideoElement | null)[]>([])

	useEffect(() => {
		if (!api) return

		setCurrentIndex(api.selectedScrollSnap())

		api.on('select', () => {
			setCurrentIndex(api.selectedScrollSnap())
		})
	}, [api])

	// Wire up video events for auto-advance and track progress
	useEffect(() => {
		const video = videoRefs.current[currentIndex]
		if (!video) return

		// Pause all other videos first
		videoRefs.current.forEach((v, i) => {
			if (v && i !== currentIndex) {
				v.pause()
				v.currentTime = 0
			}
		})

		// Reset progress and restart video
		setProgress(0)
		video.currentTime = 0
		video.play().catch(() => {
			// Ignore play errors
		})

		const handleTimeUpdate = () => {
			if (video.duration > 0) {
				setProgress((video.currentTime / video.duration) * 100)
			}
		}

		const handleEnded = () => {
			setProgress(100)
			// If last slide, loop to first; otherwise advance
			if (currentIndex === FEATURES.length - 1) {
				api?.scrollTo(0)
			} else {
				api?.scrollNext()
			}
		}

		video.addEventListener('timeupdate', handleTimeUpdate)
		video.addEventListener('ended', handleEnded)

		return () => {
			video.removeEventListener('timeupdate', handleTimeUpdate)
			video.removeEventListener('ended', handleEnded)
		}
	}, [currentIndex, api])

	// Pause all videos when dialog closes
	useEffect(() => {
		if (!dialogProps.open) {
			videoRefs.current.forEach((v) => {
				if (v) {
					v.pause()
					v.currentTime = 0
				}
			})
		}
	}, [dialogProps.open])

	const handleNext = () => {
		if (currentIndex < FEATURES.length - 1) {
			api?.scrollNext()
		} else {
			dialogProps.onOpenChange(false)
		}
	}

	const handlePrevious = () => {
		api?.scrollPrev()
	}

	const handleDotClick = (index: number) => {
		api?.scrollTo(index)
	}

	const isLastSlide = currentIndex === FEATURES.length - 1
	const canScrollPrev = api?.canScrollPrev() ?? false
	const canScrollNext = api?.canScrollNext() ?? false

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent size='sm' onInteractOutside={(e) => e.preventDefault()}>
					{/* Header */}
					<div className='mb-1 max-md:mb-0 max-md:mt-2'>
						<h1 className={cn(immersiveDialogTitleClass, 'max-md:text-xl')}>
							{t('whats-new.title', {version: VERSION})}
						</h1>
					</div>

					{/* Carousel Container */}
					<div className='relative -mx-4 flex flex-1 flex-col overflow-hidden md:-mx-8'>
						{/* Video Carousel */}
						<Carousel setApi={setApi} className='w-full'>
							<CarouselContent className='-ml-0'>
								{FEATURES.map((feature, index) => (
									<CarouselItem key={feature.id} className='pl-0'>
										<div className='relative aspect-[4/3] max-h-[calc(100dvh-440px)] min-h-[200px] w-full overflow-hidden bg-neutral-900'>
											<video
												ref={(el) => (videoRefs.current[index] = el)}
												src={feature.video}
												muted
												playsInline
												className='size-full object-cover'
											/>
										</div>
									</CarouselItem>
								))}
							</CarouselContent>

							{/* Custom Navigation Arrows */}
							{canScrollPrev && (
								<button
									onClick={handlePrevious}
									className='absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-black/60 max-sm:hidden md:left-6'
									aria-label='Previous slide'
								>
									<TbChevronLeft className='size-6' />
								</button>
							)}

							{canScrollNext && (
								<button
									onClick={handleNext}
									className='absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-black/60 max-sm:hidden md:right-6'
									aria-label='Next slide'
								>
									<TbChevronRight className='size-6' />
								</button>
							)}
						</Carousel>

						{/* Dot Indicators */}
						<div className='mt-5 px-4 md:px-8'>
							<DotIndicators
								currentIndex={currentIndex}
								total={FEATURES.length}
								onDotClick={handleDotClick}
								progress={progress}
							/>
						</div>

						{/* Feature Content - updates based on currentIndex */}
						<div className='flex-1 space-y-4 px-4 py-6 md:px-8'>
							<div className='space-y-3'>
								<h3 className='text-2xl font-semibold -tracking-3 md:text-3xl'>
									{t(FEATURES[currentIndex].titleTKey)}
								</h3>
								<p className='text-base leading-tight text-white/70'>{t(FEATURES[currentIndex].descriptionTKey)}</p>
								{FEATURES[currentIndex].helperTextTKey && (
									<p className='text-xs leading-tight text-white/70'>{t(FEATURES[currentIndex].helperTextTKey)}</p>
								)}
							</div>
						</div>
					</div>

					{/* Footer */}
					<ImmersiveDialogFooter className='justify-end'>
						<Button variant='secondary' size='dialog' onClick={handleNext}>
							{isLastSlide ? t('whats-new.continue') : t('whats-new.next')}
						</Button>
					</ImmersiveDialogFooter>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}
