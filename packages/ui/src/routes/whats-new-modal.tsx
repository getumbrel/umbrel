import {useEffect, useRef, useState, type ComponentType} from 'react'
import {useTranslation} from 'react-i18next'
import {IoLogoAndroid, IoLogoApple, IoLogoWindows} from 'react-icons/io5'
import {TbChevronLeft, TbChevronRight, TbPlayerPlayFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import appsImage from '@/assets/whats-new/apps.webp'
import failsafeVideo from '@/assets/whats-new/failsafe.mp4'
import failsafePoster from '@/assets/whats-new/failsafe.webp'
import filesVideo from '@/assets/whats-new/files.mp4'
import filesPoster from '@/assets/whats-new/files.webp'
import machinesImage from '@/assets/whats-new/machines.webp'
import mapVideo from '@/assets/whats-new/map.mp4'
import mapPoster from '@/assets/whats-new/map.webp'
import murmurVideo from '@/assets/whats-new/murmur.mp4'
import murmurPoster from '@/assets/whats-new/murmur.webp'
import peopleVideo from '@/assets/whats-new/people.mp4'
import peoplePoster from '@/assets/whats-new/people.webp'
import searchVideo from '@/assets/whats-new/search.mp4'
import searchPoster from '@/assets/whats-new/search.webp'
import transcriptionVideo from '@/assets/whats-new/transcription.mp4'
import transcriptionPoster from '@/assets/whats-new/transcription.webp'
import welcomeVideo from '@/assets/whats-new/welcome.mp4'
import welcomePoster from '@/assets/whats-new/welcome.webp'
import {FadeScroller} from '@/components/fade-scroller'
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
import {DialogPortal, DialogTitle} from '@/components/ui/dialog'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogFooter,
	ImmersiveDialogOverlay,
} from '@/components/ui/immersive-dialog'
import {appPath} from '@/constants/app-store'
import {lightboxButtonClass} from '@/features/photos/components/viewer/lightbox-button'
import {cn} from '@/lib/utils'
import {WHATS_NEW_VERSION_NAME} from '@/routes/whats-new'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {tw} from '@/utils/tw'

// Versions and features are hardcoded and we should update them on every release

/** How long a still image stays up before the carousel moves on */
const IMAGE_SLIDE_MS = 10000

/** Glass control floating over the media: the lightbox's rail button, tinted for bright footage */
const mediaButtonClass = cn(
	lightboxButtonClass,
	'bg-black/25 backdrop-blur-md hover:bg-black/40 contrast-more:bg-black/85 contrast-more:backdrop-blur-none contrast-more:hover:bg-black',
)

/** A link floating over the media in the same glass. Built on its own, because the rail button's
 * responsive sizes would square the pill off */
const mediaPillClass = tw`settings-edge-material flex h-12 max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-black/25 pr-5 pl-4 text-sm font-medium text-white backdrop-blur-md transition-[background-color,transform] duration-200 hover:bg-black/40 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20 active:scale-90 contrast-more:bg-black/85 contrast-more:backdrop-blur-none contrast-more:hover:bg-black`

/** Beside the media, under 500px tall, the footer's buttons stay compact and side by side as on desktop,
 * leaving the text the room that stacked phone buttons would take */
const lowFooterButtonClass = 'low:order-none low:h-[30px] low:w-auto low:font-medium'

/** The arrows only surface while the pointer rests on the media (or one has focus) */
const arrowButtonClass = cn(
	mediaButtonClass,
	'absolute top-1/2 z-10 -translate-y-1/2 opacity-0 transition-[background-color,transform,opacity] group-hover:opacity-100 focus-visible:opacity-100 max-sm:hidden',
)

type Feature = {
	id: string
	titleTKey: string
	descriptionTKey: string
	/** Optional fine print under the description */
	noteTKey?: string
	/** Needs the on-device models behind smart search, which some devices can't run (the Raspberry Pi 4,
	 * and x86 CPUs without AES-NI). There, fine print says so instead */
	needsSmartSearch?: {unsupportedNoteTKey: string}
	/** Downloads listed under the description, each opening in a new tab */
	downloads?: {href: string; labelTKey: string; icon: ComponentType<{className?: string}>}[]
	/** Optional call-to-action shown beside Next */
	link?: {
		labelTKey: string
		icon: ComponentType<{className?: string}>
	} & (
		| {
				/** Opens in a new tab */
				href: string
				to?: never
				/** Also float the link as a glass pill over the media */
				overlay?: boolean
				/** Faded at the pill's right edge: the linked video's runtime */
				overlayDuration?: string
		  }
		| {
				/** A page in umbrelOS, which takes the place of the dialog */
				to: string
				href?: never
				overlay?: never
				overlayDuration?: never
		  }
	)
} & (
	| {image: string; video?: never; poster?: never; loop?: never}
	| {
			video: string
			/** First frame of the video, shown until it buffers */
			poster: string
			/** Loop the video in place instead of moving on when it ends */
			loop?: boolean
			image?: never
	  }
)

/** Murmur's own app icon, for its slide's button */
function MurmurIcon({className}: {className?: string}) {
	return (
		<img src='/assets/mcp/murmur.webp' alt='' draggable={false} className={cn(className, 'size-4.5 rounded-[5px]')} />
	)
}

// TODO: Replace the 2.0 media standing in for each slide with footage of what it describes
const FEATURES: Feature[] = [
	{
		id: 'welcome',
		video: welcomeVideo,
		poster: welcomePoster,
		loop: true,
		link: {
			href: 'https://youtu.be/IXVEoYV17t4',
			labelTKey: 'whats-new-umbrelos-2-1.welcome-watch-launch',
			icon: TbPlayerPlayFilled,
			overlay: true,
			overlayDuration: '2:00',
		},
		titleTKey: 'whats-new-umbrelos-2-1.welcome-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.welcome-description',
	},
	{
		id: 'smart-search',
		video: searchVideo,
		poster: searchPoster,
		titleTKey: 'whats-new-umbrelos-2-1.smart-search-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.smart-search-description',
		needsSmartSearch: {unsupportedNoteTKey: 'whats-new-umbrelos-2-1.smart-search-unsupported'},
	},
	{
		id: 'people',
		video: peopleVideo,
		poster: peoplePoster,
		titleTKey: 'whats-new-umbrelos-2-1.people-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.people-description',
		needsSmartSearch: {unsupportedNoteTKey: 'whats-new-umbrelos-2-1.people-unsupported'},
	},
	{
		id: 'map',
		video: mapVideo,
		poster: mapPoster,
		titleTKey: 'whats-new-umbrelos-2-1.map-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.map-description',
	},
	{
		id: 'transcription',
		video: transcriptionVideo,
		poster: transcriptionPoster,
		titleTKey: 'whats-new-umbrelos-2-1.transcription-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.transcription-description',
		needsSmartSearch: {unsupportedNoteTKey: 'whats-new-umbrelos-2-1.transcription-unsupported'},
	},
	{
		id: 'failsafe',
		video: failsafeVideo,
		poster: failsafePoster,
		titleTKey: 'whats-new-umbrelos-2-1.failsafe-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.failsafe-description',
		noteTKey: 'whats-new-umbrelos-2-1.failsafe-note',
	},
	{
		id: 'files',
		video: filesVideo,
		poster: filesPoster,
		titleTKey: 'whats-new-umbrelos-2-1.files-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.files-description',
	},
	{
		id: 'machines',
		image: machinesImage,
		titleTKey: 'whats-new-umbrelos-2-1.machines-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.machines-description',
		noteTKey: 'whats-new-umbrelos-2-1.machines-note',
	},
	{
		id: 'apps',
		image: appsImage,
		titleTKey: 'whats-new-umbrelos-2-1.apps-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.apps-description',
		downloads: [
			{href: 'https://link.umbrel.com/ios-app', labelTKey: 'whats-new-umbrelos-2-1.apps-iphone', icon: IoLogoApple},
			{
				href: 'https://link.umbrel.com/android-app',
				labelTKey: 'whats-new-umbrelos-2-1.apps-android',
				icon: IoLogoAndroid,
			},
			{href: 'https://link.umbrel.com/macos-app', labelTKey: 'whats-new-umbrelos-2-1.apps-mac', icon: IoLogoApple},
			{
				href: 'https://link.umbrel.com/windows-app',
				labelTKey: 'whats-new-umbrelos-2-1.apps-windows',
				icon: IoLogoWindows,
			},
		],
	},
	{
		id: 'murmur',
		video: murmurVideo,
		poster: murmurPoster,
		titleTKey: 'whats-new-umbrelos-2-1.murmur-heading',
		descriptionTKey: 'whats-new-umbrelos-2-1.murmur-description',
		link: {
			to: appPath('murmur'),
			labelTKey: 'whats-new-umbrelos-2-1.murmur-get',
			icon: MurmurIcon,
		},
	},
]

export default function WhatsNewModal() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('whats-new')

	const [api, setApi] = useState<CarouselApi>()
	const {activeIndex: currentIndex, canScrollPrev, canScrollNext} = useCarouselSnaps(api)
	const [hovered, setHovered] = useState(false)
	const [videoProgress, setVideoProgress] = useState(0)
	const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
	const textRef = useRef<HTMLDivElement>(null)

	const feature = FEATURES[currentIndex]
	const isVideoSlide = !!feature.video
	// Only a device that can't run the models says so. Until the answer is in, or if it can't be had,
	// nothing is said, so a device that can never sees the fine print flash in
	const searchStatusQ = trpcReact.search.status.useQuery(undefined, {
		enabled: dialogProps.open,
		retry: false,
		refetchOnWindowFocus: false,
	})
	const smartSearchUnsupported = searchStatusQ.data?.reason === 'unsupported-device'
	const noteTKey = (slide: Feature) =>
		slide.needsSmartSearch && smartSearchUnsupported ? slide.needsSmartSearch.unsupportedNoteTKey : slide.noteTKey
	// A looping video holds its slide until the user moves on, so nothing counts down
	const isLoopingSlide = isVideoSlide && !!feature.loop

	// Still images hold for a fixed beat; the dot fill counts it down and the
	// carousel moves on (looping at the end). Videos drive the fill themselves.
	const countdown = useCarouselAutoAdvance(api, {
		intervalMs: IMAGE_SLIDE_MS,
		enabled: dialogProps.open && !isVideoSlide,
		paused: hovered,
	})

	// Play the active slide's video from the top, track it into the dot fill,
	// and advance when it ends (a looping one never ends, and shows no fill);
	// every other video sits paused at frame zero
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

	// A slide's text starts at its top, wherever the last one was scrolled to
	useEffect(() => {
		textRef.current?.scrollTo({top: 0})
	}, [currentIndex])

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
					// Side by side, under 500px tall, the text needs the width it has above the media: at 600px
					// it got 252px in Safari's landscape phone, too narrow for its two buttons in a row
					className='low:max-w-[800px]'
					// Over the footage, the close button's cross stands out in white, on the usual circle
					closeCrossClassName='text-white/80'
					onOpenAutoFocus={(e) => {
						// The dialog opens on its own, so move focus into it (rather than
						// leaving it behind the overlay) without ringing the first button.
						e.preventDefault()
						;(e.currentTarget as HTMLElement).focus()
					}}
					onInteractOutside={(e) => e.preventDefault()}
				>
					<DialogTitle className='sr-only'>{t('whats-new.title', {version: WHATS_NEW_VERSION_NAME})}</DialogTitle>

					{/* Bleeds to the dialog's edges, the media curving with its corners. The media takes the height
					    the text and buttons leave, up to 4:3 (75cqw), so a short window crops it rather than
					    leaving a gap, and no less than 40cqw, so long or large text scrolls rather than squeezing
					    it shut. Under 500px tall it moves beside them instead, where the text scrolls. */}
					<div className='@container relative -mx-6 -my-4 flex flex-1 flex-col overflow-hidden md:-m-8 low:grid low:grid-cols-2 low:grid-rows-[auto_minmax(0,1fr)_auto]'>
						{/* Media Carousel */}
						<Carousel
							setApi={setApi}
							className='group max-h-[75cqw] min-h-[40cqw] w-full flex-1 overflow-hidden rounded-t-[var(--window-radius)] low:row-span-3 low:max-h-none low:min-h-0 low:rounded-none low:rounded-s-[var(--window-radius)]'
							onPointerEnter={() => setHovered(true)}
							onPointerLeave={() => setHovered(false)}
						>
							<CarouselContent containerClassName='h-full' className='-ml-0 h-full'>
								{FEATURES.map((feature, index) => (
									<CarouselItem key={feature.id} className='pl-0'>
										<div className='relative size-full overflow-hidden bg-neutral-900'>
											{feature.video ? (
												<video
													ref={(el) => {
														videoRefs.current[index] = el
													}}
													src={feature.video}
													poster={feature.poster}
													loop={feature.loop}
													muted
													playsInline
													preload='auto'
													className='size-full object-cover'
												/>
											) : (
												<img src={feature.image} alt='' draggable={false} className='size-full object-cover' />
											)}
											{feature.link?.overlay && feature.link.href && (
												<div className='absolute inset-0 flex items-center justify-center'>
													<a
														href={feature.link.href}
														target='_blank'
														rel='noopener noreferrer'
														draggable={false}
														className={mediaPillClass}
													>
														<feature.link.icon className='size-4 shrink-0' />
														<span className='min-w-0 truncate'>{t(feature.link.labelTKey)}</span>
														{feature.link.overlayDuration && (
															<span className='text-white/50 tabular-nums'>{feature.link.overlayDuration}</span>
														)}
													</a>
												</div>
											)}
										</div>
									</CarouselItem>
								))}
							</CarouselContent>

							{/* Navigation arrows */}
							{canScrollPrev && (
								<button
									type='button'
									onClick={handlePrevious}
									className={cn(arrowButtonClass, 'left-4 md:left-6')}
									aria-label={t('carousel.previous')}
								>
									<TbChevronLeft className='size-6' />
								</button>
							)}

							{canScrollNext && (
								<button
									type='button'
									onClick={handleNext}
									className={cn(arrowButtonClass, 'right-4 md:right-6')}
									aria-label={t('carousel.next')}
								>
									<TbChevronRight className='size-6' />
								</button>
							)}
						</Carousel>

						{/* Dot Indicators */}
						<div className='mt-5 shrink-0 px-6 md:px-8 low:mt-6'>
							<CarouselDots
								activeIndex={currentIndex}
								count={FEATURES.length}
								onSelect={handleDotClick}
								countdown={countdown}
								progress={isVideoSlide && !isLoopingSlide ? videoProgress : undefined}
							/>
						</div>

						{/* Feature Content: every slide's text shares one cell, so the block is as tall as the
						    longest and the media keeps its size from slide to slide. Beside the media, under
						    500px tall, the height is fixed anyway and only the current slide takes room. It
						    scrolls, fading where it's cut, once there's no room left. */}
						<FadeScroller
							ref={textRef}
							direction='y'
							fadeSize={24}
							className='grid min-h-0 overflow-y-auto px-6 py-6 md:px-8 low:py-4'
						>
							{FEATURES.map((slide, index) => (
								<div
									key={slide.id}
									aria-hidden={index !== currentIndex}
									className={cn('col-start-1 row-start-1 space-y-3', index !== currentIndex && 'invisible low:hidden')}
								>
									<h3 className='text-2xl font-semibold -tracking-3 md:text-3xl low:text-2xl'>{t(slide.titleTKey)}</h3>
									<p className='text-base leading-tight text-white/70'>{t(slide.descriptionTKey)}</p>
									{noteTKey(slide) && <p className='text-13 leading-tight text-white/40'>{t(noteTKey(slide)!)}</p>}
									{slide.downloads && (
										// Two by two on a phone, where four in a row would run out of room; in a row anywhere wider
										<div className='grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap'>
											{slide.downloads.map((download) => (
												<Button key={download.href} asChild className='h-8 gap-1.5 px-3.5 text-12'>
													<a href={download.href} target='_blank' rel='noopener noreferrer'>
														<download.icon className='size-3.5 shrink-0' />
														{t(download.labelTKey)}
													</a>
												</Button>
											))}
										</div>
									)}
								</div>
							))}
						</FadeScroller>

						{/* Footer */}
						<ImmersiveDialogFooter className='mt-auto shrink-0 justify-end px-6 pt-6 pb-4 md:px-8 md:pb-8 low:pt-0 low:pb-6'>
							{feature.link && (
								// Stacked on mobile the footer wraps in reverse, so ordering this last puts it above Next
								<Button variant='default' size='dialog' className={cn('max-md:order-1', lowFooterButtonClass)} asChild>
									{feature.link.to ? (
										<Link to={feature.link.to}>
											<feature.link.icon className='size-3.5' />
											{t(feature.link.labelTKey)}
										</Link>
									) : (
										<a href={feature.link.href} target='_blank' rel='noopener noreferrer'>
											<feature.link.icon className='size-3.5' />
											{t(feature.link.labelTKey)}
										</a>
									)}
								</Button>
							)}
							<Button variant='secondary' size='dialog' className={lowFooterButtonClass} onClick={handleNext}>
								{isLastSlide ? t('whats-new.continue') : t('whats-new.next')}
							</Button>
						</ImmersiveDialogFooter>
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}
