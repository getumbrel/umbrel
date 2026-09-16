import {DialogPortal, DialogTitle} from '@radix-ui/react-dialog'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoLogoApple} from 'react-icons/io5'
import {TbChevronLeft, TbChevronRight} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	Carousel,
	CarouselContent,
	CarouselDots,
	CarouselItem,
	useCarouselAutoAdvance,
	useCarouselSnaps,
	type CarouselApi,
} from '@/components/ui/carousel'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogFooter,
	ImmersiveDialogOverlay,
} from '@/components/ui/immersive-dialog'
import {WHATS_NEW_VERSION_NAME} from '@/routes/whats-new'
import {useDialogOpenProps} from '@/utils/dialog'

// Versions and features are hardcoded and we should update them on every release

/** How long a still image stays up before the carousel moves on */
const IMAGE_SLIDE_MS = 10000

type Feature = {
	id: string
	titleTKey: string
	descriptionTKey: string
	/** Optional call-to-action shown beside Next, opening in a new tab */
	link?: {href: string; labelTKey: string}
} & ({image: string; video?: never} | {video: string; image?: never})

const FEATURES: Feature[] = [
	{
		id: 'redesign',
		image: '/assets/whats-new/welcome.webp',
		titleTKey: 'whats-new-umbrelos-2-0.redesign-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.redesign-description',
	},
	{
		id: 'photos',
		image: '/assets/whats-new/photos.webp',
		titleTKey: 'whats-new-umbrelos-2-0.photos-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.photos-description',
		link: {href: 'https://link.umbrel.com/ios-app', labelTKey: 'whats-new-umbrelos-2-0.photos-get-ios-app'},
	},
	{
		id: 'machines',
		image: '/assets/whats-new/machines.webp',
		titleTKey: 'whats-new-umbrelos-2-0.machines-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.machines-description',
	},
	{
		id: 'multi-user',
		image: '/assets/whats-new/multi-user.webp',
		titleTKey: 'whats-new-umbrelos-2-0.multi-user-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.multi-user-description',
	},
	{
		id: 'ai-agents',
		image: '/assets/whats-new/ai-agents.webp',
		titleTKey: 'whats-new-umbrelos-2-0.ai-agents-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.ai-agents-description',
	},
	{
		id: 'storage-manager',
		image: '/assets/whats-new/storage-manager.webp',
		titleTKey: 'whats-new-umbrelos-2-0.storage-manager-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.storage-manager-description',
	},
	{
		id: 'cloud',
		image: '/assets/whats-new/cloud.webp',
		titleTKey: 'whats-new-umbrelos-2-0.cloud-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.cloud-description',
	},
	{
		id: 'gpu',
		image: '/assets/whats-new/gpu.webp',
		titleTKey: 'whats-new-umbrelos-2-0.gpu-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.gpu-description',
	},
	{
		id: 'app-settings',
		image: '/assets/whats-new/app-settings.webp',
		titleTKey: 'whats-new-umbrelos-2-0.app-settings-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.app-settings-description',
	},
	{
		id: 'mac-app',
		image: '/assets/whats-new/mac-app.webp',
		titleTKey: 'whats-new-umbrelos-2-0.mac-app-heading',
		descriptionTKey: 'whats-new-umbrelos-2-0.mac-app-description',
		link: {href: 'https://link.umbrel.com/macos-app', labelTKey: 'whats-new-umbrelos-2-0.mac-app-download'},
	},
]

export function WhatsNewModal() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('whats-new')

	const [api, setApi] = useState<CarouselApi>()
	const {activeIndex: currentIndex, canScrollPrev, canScrollNext} = useCarouselSnaps(api)
	const [hovered, setHovered] = useState(false)
	const [videoProgress, setVideoProgress] = useState(0)
	const videoRefs = useRef<(HTMLVideoElement | null)[]>([])

	const feature = FEATURES[currentIndex]
	const isVideoSlide = !!feature.video

	// Still images hold for a fixed beat; the dot fill counts it down and the
	// carousel moves on (looping at the end). Videos drive the fill themselves.
	const countdown = useCarouselAutoAdvance(api, {
		intervalMs: IMAGE_SLIDE_MS,
		enabled: dialogProps.open && !isVideoSlide,
		paused: hovered,
	})

	// Play the active slide's video from the top, track it into the dot fill,
	// and advance when it ends; every other video sits paused at frame zero
	useEffect(() => {
		videoRefs.current.forEach((v, i) => {
			if (v && i !== currentIndex) {
				v.pause()
				v.currentTime = 0
			}
		})

		const video = videoRefs.current[currentIndex]
		if (!video) return

		setVideoProgress(0)
		video.currentTime = 0
		video.play().catch(() => {
			// Ignore play errors
		})

		const handleTimeUpdate = () => {
			if (video.duration > 0) {
				setVideoProgress((video.currentTime / video.duration) * 100)
			}
		}

		const handleEnded = () => {
			setVideoProgress(100)
			if (!api) return
			if (api.canScrollNext()) api.scrollNext()
			else api.scrollTo(0)
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

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					size='sm'
					onOpenAutoFocus={(e) => {
						// The dialog opens on its own, so move focus into it (rather than
						// leaving it behind the overlay) without ringing the first button.
						e.preventDefault()
						;(e.currentTarget as HTMLElement).focus()
					}}
					onInteractOutside={(e) => e.preventDefault()}
				>
					<DialogTitle className='sr-only'>{t('whats-new.title', {version: WHATS_NEW_VERSION_NAME})}</DialogTitle>

					{/* Carousel Container: bleeds to the dialog's edges, the media curving with its top corners */}
					<div className='relative -mx-6 -mt-4 flex flex-1 flex-col overflow-hidden md:-mx-8 md:-mt-8'>
						{/* Media Carousel */}
						<Carousel
							setApi={setApi}
							className='w-full overflow-hidden rounded-t-[var(--window-radius)]'
							onPointerEnter={() => setHovered(true)}
							onPointerLeave={() => setHovered(false)}
						>
							<CarouselContent className='-ml-0'>
								{FEATURES.map((feature, index) => (
									<CarouselItem key={feature.id} className='pl-0'>
										<div className='relative aspect-[4/3] max-h-[calc(100dvh-440px)] min-h-[200px] w-full overflow-hidden bg-neutral-900'>
											{feature.video ? (
												<video
													ref={(el) => {
														videoRefs.current[index] = el
													}}
													src={feature.video}
													muted
													playsInline
													preload='auto'
													className='size-full object-cover'
												/>
											) : (
												<img src={feature.image} alt='' draggable={false} className='size-full object-cover' />
											)}
										</div>
									</CarouselItem>
								))}
							</CarouselContent>

							{/* Custom Navigation Arrows */}
							{canScrollPrev && (
								<button
									onClick={handlePrevious}
									className='absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-xs transition-all hover:scale-110 hover:bg-black/60 max-sm:hidden md:left-6'
									aria-label='Previous slide'
								>
									<TbChevronLeft className='size-6' />
								</button>
							)}

							{canScrollNext && (
								<button
									onClick={handleNext}
									className='absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-xs transition-all hover:scale-110 hover:bg-black/60 max-sm:hidden md:right-6'
									aria-label='Next slide'
								>
									<TbChevronRight className='size-6' />
								</button>
							)}
						</Carousel>

						{/* Dot Indicators */}
						<div className='mt-5 px-6 md:px-8'>
							<CarouselDots
								activeIndex={currentIndex}
								count={FEATURES.length}
								onSelect={handleDotClick}
								countdown={countdown}
								progress={isVideoSlide ? videoProgress : undefined}
							/>
						</div>

						{/* Feature Content - updates based on currentIndex */}
						<div className='flex-1 space-y-4 px-6 py-6 md:px-8'>
							<div className='space-y-3'>
								<h3 className='text-2xl font-semibold -tracking-3 md:text-3xl'>{t(feature.titleTKey)}</h3>
								<p className='text-base leading-tight text-white/70'>{t(feature.descriptionTKey)}</p>
							</div>
						</div>
					</div>

					{/* Footer */}
					<ImmersiveDialogFooter className='justify-end'>
						{feature.link && (
							// Stacked on mobile the footer wraps in reverse, so ordering this last puts it above Next
							<Button variant='default' size='dialog' className='max-md:order-1' asChild>
								<a href={feature.link.href} target='_blank' rel='noopener noreferrer'>
									<IoLogoApple className='size-3.5' />
									{t(feature.link.labelTKey)}
								</a>
							</Button>
						)}
						<Button variant='secondary' size='dialog' onClick={handleNext}>
							{isLastSlide ? t('whats-new.continue') : t('whats-new.next')}
						</Button>
					</ImmersiveDialogFooter>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}
