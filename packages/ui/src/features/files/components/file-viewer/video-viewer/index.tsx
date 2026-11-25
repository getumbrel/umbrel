// TODO: Investigate pre-existing issue where large video files fail to play in Safari.
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {VideoPlayer} from '@/components/video-player'
import {useViewerSize, type ViewerSize} from '@/features/files/components/file-viewer/shell/context'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {useFileUrl} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {trpcReact} from '@/trpc/trpc'

export default function VideoViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const previewUrl = useFileUrl(item)
	const containerRef = useRef<HTMLDivElement>(null)
	// A search result opens at the moment that matched
	const startSeconds = (item.searchResult?.moment?.startMs ?? 0) / 1000

	// What is said in it, when Search has transcribed it, as captions (see
	// VideoPlayer)
	const {data: insights} = trpcReact.search.insights.useQuery(
		{path: item.path},
		{retry: false, refetchOnWindowFocus: false, staleTime: 60_000},
	)

	// Seeking needs the duration, so it waits for the metadata — which a cached
	// video may already have by the time this runs. Keyed on the URL: the
	// element only exists once it is authorized.
	useEffect(() => {
		const video = containerRef.current?.querySelector('video')
		if (!video || startSeconds <= 0) return
		const seek = () => {
			video.currentTime = startSeconds
		}
		if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return seek()
		video.addEventListener('loadedmetadata', seek, {once: true})
		return () => video.removeEventListener('loadedmetadata', seek)
	}, [previewUrl.url, startSeconds])

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
				<VideoPlayer
					key={item.path}
					src={previewUrl.url}
					transcript={insights?.transcript}
					// Opened, the player has the keyboard (space, seeking, C for
					// captions); a quick look leaves it to stepping and closing
					keys={mode !== 'preview' ? 'global' : false}
				/>
			</div>
		</div>
	)
}
