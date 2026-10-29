// TODO: Investigate pre-existing issue where large video files fail to play in Safari.
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Video} from 'react-video-kit'

import {useViewerSize, type ViewerSize} from '@/features/files/components/file-viewer/shell/context'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {fileViewUrl} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

export default function VideoViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const previewUrl = useAuthorizedHttpUrlQuery(fileViewUrl(item.path))
	const containerRef = useRef<HTMLDivElement>(null)

	// Ensure video is fully stopped on unmount to prevent lingering audio
	useEffect(() => {
		return () => {
			const video = containerRef.current?.querySelector('video')
			if (video) {
				video.pause()
				video.removeAttribute('src')
				video.load()
			}
		}
	}, [])

	// The player takes the video's own shape, and so does a quick look. The video
	// often has its metadata before it's on the page (the stage is revealed a beat
	// after it's built), so its size is read as soon as the player mounts, not
	// only on the event, and again whenever a stream changes its size as it plays
	const [size, setSize] = useState<ViewerSize>()
	useViewerSize(size)
	const aspect = size ? size.width / size.height : 16 / 9
	// A video the browser can't play, whatever its type, says so: one in a format
	// or with codecs it lacks fails its source (an error that doesn't bubble, so
	// it's caught on its way down), and a damaged one fails as it decodes. A
	// connection lost as it plays isn't the video's doing, so that's left to the
	// player. It may have failed before it's on the page too, as it loads once
	// it's built: its own failure stays on it, and a failed source leaves it
	// waiting for another, with the one it tried still its currentSrc
	const [unplayable, setUnplayable] = useState(false)
	const playerMounted = previewUrl.status === 'ready'
	useLayoutEffect(() => {
		const video = containerRef.current?.querySelector('video')
		if (!video) return
		const measure = () => {
			if (video.videoWidth > 0 && video.videoHeight > 0) setSize({width: video.videoWidth, height: video.videoHeight})
		}
		const fail = () => {
			if (video.error?.code !== MediaError.MEDIA_ERR_NETWORK) setUnplayable(true)
		}
		if (video.readyState >= HTMLMediaElement.HAVE_METADATA) measure()
		if (video.error || (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && video.currentSrc)) fail()
		video.addEventListener('loadedmetadata', measure)
		video.addEventListener('resize', measure)
		video.addEventListener('error', fail, {capture: true})
		return () => {
			video.removeEventListener('loadedmetadata', measure)
			video.removeEventListener('resize', measure)
			video.removeEventListener('error', fail, {capture: true})
		}
	}, [playerMounted])

	if (previewUrl.status === 'error') {
		return (
			<StageMessage
				item={item}
				title={t('files-viewer.unreachable-title')}
				detail={t('files-viewer.unreachable-detail')}
			>
				<button type='button' className={stageButtonClass} onClick={previewUrl.retry}>
					{t('try-again')}
				</button>
			</StageMessage>
		)
	}
	if (previewUrl.status !== 'ready') return <StageLoading item={item} />
	if (unplayable) {
		return (
			<StageMessage item={item} title={t('files-video.unplayable-title')} detail={t('files-video.unplayable-detail')}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}

	// The player is the video's shape (16:9 until that's known) with its
	// controls laid over it, so it's sized to fit the stage both ways: the
	// whole frame shows, and on a short screen the timeline is never cut off.
	// It's never narrower than its controls need (15rem) unless the stage is, so
	// a tall video on a short screen is letterboxed in it instead
	return (
		<div className='@container-[size] flex min-h-0 flex-1 items-center justify-center px-4 md:px-6'>
			<div
				ref={containerRef}
				className='max-h-[100cqh] overflow-hidden rounded-xl bg-black'
				style={{width: `min(100cqw, clamp(15rem, 100cqh * ${aspect}, 72rem))`, aspectRatio: aspect}}
			>
				<Video.Root
					key={item.path}
					// Sized both ways, it takes the box's shape over its own 16:9
					className='size-full'
					src={previewUrl.url}
					title={item.name}
					autoPlay
					// Opened, the player has the keyboard (space, seeking); a quick look
					// leaves it to stepping and closing
					hotkeys={{scope: 'global', enabled: mode !== 'preview'}}
				>
					{/* Never cropped, in fullscreen too: the kit's inline `cover` gives
					    way only to an important rule */}
					<Video.Media className='!object-contain' />
					<Video.Backdrop />
					<Video.Header>
						<div className='rv-w-full rv-flex'>
							<Video.FullscreenToggle />
							<Video.PipToggle />
						</div>
						<div className='rv-w-full rv-flex rv-justify-end rv-items-center rv-h-fit'>
							<Video.Volume.Button />
							<Video.Volume.Slider />
						</div>
					</Video.Header>
					<Video.Center>
						<Video.SeekBack seconds={10} />
						<Video.PlayPause />
						<Video.SeekForward seconds={10} />
						<Video.Loading />
					</Video.Center>
					<Video.Footer>
						<Video.Title />
						<Video.Timeline />
						<div className='rv-flex rv-justify-between rv-w-full'>
							<Video.Time.Current />
							<Video.Time.Remaining negative />
						</div>
					</Video.Footer>
				</Video.Root>
			</div>
		</div>
	)
}
