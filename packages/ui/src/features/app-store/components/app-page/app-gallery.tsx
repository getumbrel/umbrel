import PhotoSwipeLightbox from 'photoswipe/lightbox'
import {useEffect, useState} from 'react'

import 'photoswipe/style.css'

import {
	Carousel,
	CarouselArrows,
	CarouselContent,
	CarouselDots,
	CarouselItem,
	useCarouselSnaps,
	type CarouselApi,
} from '@/components/ui/carousel'
import {FadeInImg} from '@/components/ui/fade-in-img'

/**
 * The app's screenshots as a draggable carousel with pill dot indicators
 * (shared with the Discover banners and What's new): slides align to the
 * content grid but bleed to the sheet edges, and clicking a screenshot still
 * opens the full-size lightbox.
 */
export function AppGallery({gallery, galleryId}: {gallery: string[]; galleryId: string}) {
	const [api, setApi] = useState<CarouselApi>()
	const {snapCount, activeIndex, canScrollPrev, canScrollNext} = useCarouselSnaps(api)

	useEffect(() => {
		let lightbox: PhotoSwipeLightbox | null = new PhotoSwipeLightbox({
			gallery: '#' + galleryId,
			children: 'a',
			pswpModule: () => import('photoswipe'),
		})
		lightbox.init()

		return () => {
			lightbox?.destroy()
			lightbox = null
		}
	}, [galleryId])

	if (gallery.length === 0) return null

	return (
		<section>
			<Carousel
				setApi={setApi}
				className='-mx-3 md:-mx-[40px] xl:-mx-[70px]'
				opts={{align: 'start', containScroll: 'trimSnaps'}}
			>
				<CarouselContent
					containerClassName='px-3 md:px-[40px] xl:px-[70px]'
					className='pswp-gallery -ml-2.5 md:-ml-4'
					id={galleryId}
				>
					{gallery.map((src, i) => (
						<CarouselItem
							// Index key: some manifests repeat the same image URL
							key={i}
							className='basis-auto pl-2.5 md:pl-4'
						>
							<a
								href={src}
								data-pswp-width={2880}
								data-pswp-height={1800}
								// The after: hairline sits over the image edge, so it reads on bright
								// artwork too and doesn't change the image box
								className='group relative block aspect-1.6 h-[clamp(160px,45dvh,220px)] animate-in overflow-hidden rounded-24 bg-white/6 ring-white/80 outline-hidden fill-mode-both slide-in-from-right-10 fade-in ring-inset after:pointer-events-none after:absolute after:inset-0 after:rounded-24 after:ring-1 after:ring-white/8 after:ring-inset focus-visible:ring-4 md:h-[clamp(200px,45dvh,360px)]'
								style={{
									animationDelay: `${i * 0.1}s`,
								}}
								target='_blank'
								rel='noreferrer'
								draggable={false}
							>
								{/* Out of flow so the slide's width comes from its height and aspect ratio
								    alone: Safari sizes a basis-auto slide to an in-flow screenshot's
								    natural width (2000px+), spreading the slides a screen apart */}
								<FadeInImg
									src={src}
									loading={i > 2 ? 'lazy' : undefined}
									className='absolute inset-0 h-full w-full object-cover group-focus-visible:opacity-80'
									alt=''
									draggable={false}
								/>
							</a>
						</CarouselItem>
					))}
				</CarouselContent>
			</Carousel>
			{snapCount > 1 && (
				<div className='mt-3 flex items-center justify-between pointer-coarse:justify-center'>
					<CarouselDots count={snapCount} activeIndex={activeIndex} onSelect={(index) => api?.scrollTo(index)} />
					<CarouselArrows
						onPrev={() => api?.scrollPrev()}
						onNext={() => api?.scrollNext()}
						disablePrev={!canScrollPrev}
						disableNext={!canScrollNext}
					/>
				</div>
			)}
		</section>
	)
}
