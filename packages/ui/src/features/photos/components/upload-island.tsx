import {useState, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'
import {RiArrowUpLine, RiCloseLine, RiPauseFill, RiPlayFill} from 'react-icons/ri'

import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {LightboxButton} from '@/features/photos/components/viewer/lightbox-button'
import {photosUploads, usePhotosUploads} from '@/features/photos/hooks/use-upload'
import {Island, IslandExpanded, IslandMinimized, type IslandSizes} from '@/modules/floating-island/bare-island'
import {formatNumberI18n} from '@/utils/number'
import {secondsToEta} from '@/utils/seconds-to-eta'

// Compressed it reads like the other islands; expanded it is a wide glass
// stadium: title and count on the left, pause/resume and cancel on the right
// (the lightbox's rail buttons), and between them the run's progress bar with
// the photo currently uploading riding the fill's leading edge. It peeks open
// when a run starts and whenever another drop joins, then settles back into
// the pill by itself.
const sizes: IslandSizes = {
	minimized: {width: 150, height: 40, borderRadius: 22},
	expanded: {width: 480, height: 100, borderRadius: 50},
}

export function PhotosUploadIsland() {
	// Primitive subscription: this only re-renders when a new drop joins
	const enqueuedBatches = useSyncExternalStore(photosUploads.subscribe, () => photosUploads.snapshot().enqueuedBatches)

	return (
		<Island
			id='photos-upload-island'
			nonDismissable
			sizes={sizes}
			expandKey={enqueuedBatches}
			minimizeAfter={2000}
			// overflow-visible lets the current photo float past the pill's top
			// edge; the expanded content instead fades in a beat late, so the
			// growing pill doesn't spill it mid-spring
			expandedClassName='max-w-[calc(100vw-40px)] overflow-visible bg-black/25 settings-edge-material backdrop-blur-xl backdrop-saturate-150'
		>
			<IslandMinimized>
				<MinimizedContent />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent />
			</IslandExpanded>
		</Island>
	)
}

// "2 / 20,000 added", numbers in the viewer's locale
function useAddedText(done: number, total: number) {
	const {t, i18n} = useTranslation()
	const format = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})
	return t('photos-upload.added', {done: format(done), total: format(total)})
}

function MinimizedContent() {
	const {status, done, total, progress, etaSeconds} = usePhotosUploads()
	const addedText = useAddedText(done, total)

	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={progress * 100}>
				{status === 'paused' ? (
					<RiPauseFill className='h-2.5 w-2.5 text-white/60' />
				) : (
					<RiArrowUpLine className='h-3 w-3 text-white/60' />
				)}
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>{addedText}</span>
			</div>
			{status === 'uploading' && etaSeconds !== undefined && (
				<span className='shrink-0 text-xs text-white/60'>{secondsToEta(etaSeconds, {compact: true})}</span>
			)}
		</div>
	)
}

function ExpandedContent() {
	const {t} = useTranslation()
	const {status, done, total, progress, currentPreview, speed, etaSeconds} = usePhotosUploads()
	const addedText = useAddedText(done, total)
	const paused = status === 'paused'
	const percent = progress * 100
	const wire = !paused && speed !== undefined && etaSeconds !== undefined
	// A photo the browser can't decode (HEIC) simply shows no thumbnail, like
	// videos; the next file's preview is a new URL, so it shows again
	const [failedPreview, setFailedPreview] = useState<string>()
	const preview = currentPreview !== failedPreview ? currentPreview : undefined

	// Phones live at the viewport cap, so below sm everything tucks in a
	// little to leave the track more room
	return (
		<div className='flex h-full w-full items-center gap-4 pr-4 pl-6 motion-safe:animate-in motion-safe:duration-200 motion-safe:fill-mode-both motion-safe:[animation-delay:150ms] motion-safe:fade-in sm:gap-5 sm:pr-6 sm:pl-8'>
			<div className='flex shrink-0 flex-col gap-1'>
				<span className='text-15 font-medium whitespace-nowrap text-white'>
					{paused ? t('photos-upload.paused') : t('photos-upload.uploading')}
				</span>
				<span className='text-12 whitespace-nowrap text-white/50'>{addedText}</span>
			</div>

			{/* The bar runs through the island's vertical centre; the photo rides
			    the fill's leading edge above it */}
			<div className='relative h-full min-w-0 flex-1'>
				<div className='absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-white/20'>
					<div
						className='h-full rounded-full bg-white transition-[width] duration-200 ease-linear'
						style={{width: `${percent}%`}}
					/>
				</div>
				{/* The knob on the fill's leading edge, in a soft white glow */}
				<div
					className='absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_2px_rgba(255,255,255,0.45)] transition-[left] duration-200 ease-linear'
					style={{left: `${percent}%`}}
				/>
				{/* The wire's pace tucked under the track: speed at its near end,
				    time remaining at its far end */}
				{wire && (
					<>
						<span className='absolute top-[calc(50%+10px)] left-0 text-11 whitespace-nowrap text-white/40'>
							{formatFilesystemSize(speed)}/s
						</span>
						<span className='absolute top-[calc(50%+10px)] right-0 text-11 whitespace-nowrap text-white/40'>
							{secondsToEta(etaSeconds, {compact: true})}
						</span>
					</>
				)}
				{/* The current photo floating over the fill's leading edge, riding a
				    little past the pill's top; nothing at all when there is no
				    preview. max-w-none: near the track's end the wrapper's
				    shrink-to-fit space runs out and the base img max-width would
				    squeeze the tile. */}
				{preview && (
					<div
						className='absolute top-1/2 -translate-x-1/2 -translate-y-[calc(100%+14px)] transition-[left] duration-200 ease-linear'
						style={{left: `clamp(24px, ${percent}%, calc(100% - 24px))`}}
					>
						<img
							key={preview}
							src={preview}
							alt=''
							className='size-12 max-w-none rounded-lg bg-white/10 object-cover shadow-lg ring-2 ring-white/80'
							onError={() => setFailedPreview(preview)}
						/>
					</div>
				)}
			</div>

			<div className='flex shrink-0 items-center gap-1.5 sm:gap-2'>
				<LightboxButton
					icon={paused ? RiPlayFill : RiPauseFill}
					label={paused ? t('photos-upload.resume') : t('photos-upload.pause')}
					side='top'
					className='size-11 sm:size-12'
					onClick={() => (paused ? photosUploads.resume() : photosUploads.pause())}
				/>
				<LightboxButton
					icon={RiCloseLine}
					label={t('photos-upload.cancel')}
					side='top'
					className='size-11 sm:size-12'
					onClick={() => photosUploads.cancel()}
				/>
			</div>
		</div>
	)
}
