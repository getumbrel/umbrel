import {Captions as CaptionsIcon} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useVideoContext, Video} from 'react-video-kit'

import {captionCues, setCaptionsOn, useCaptionsOn, type CaptionCue} from '@/features/search/captions'
import type {TranscriptLine} from '@/features/search/transcript'
import {cn} from '@/lib/utils'

// The one video player, in Files and in Photos alike: the picture, never
// cropped, and its controls laid over it — fullscreen and picture in
// picture at the top left; captions and volume at the top right; skipping
// and playing in the middle; the timeline and times at the foot. No title:
// the viewer around it already names what is playing, and a name over the
// picture covers it for nothing.
//
// A transcript, when Search has one, is offered as captions (see Captions).
export function VideoPlayer({
	src,
	poster,
	transcript,
	keys,
	autoPlay = true,
	controls = true,
	className,
	onVideo,
}: {
	src: string
	poster?: string
	transcript?: readonly TranscriptLine[]
	// Which keys the player answers, anywhere on the page: all of them (space,
	// the arrows to seek, F, M, P, C for captions), only those that leave the
	// arrows to a viewer that steps between items with them, or none
	keys: Keys
	autoPlay?: boolean
	// Off while the picture is flying home, which it does as a picture alone
	controls?: boolean
	className?: string
	// The <video> element, once it is on the page, for a caller following playback
	onVideo?: (video: HTMLVideoElement | null) => void
}) {
	const cues = useMemo(() => captionCues(transcript ?? []), [transcript])
	const typing = useIsTyping()
	const kitKeys = keys === 'global' && !typing
	usePressHeldKeyOnce(kitKeys)
	return (
		// What the stage gestures look for to leave the controls theirs
		<div data-video-player='' className={cn('size-full', className)}>
			<Video.Root
				// Sized both ways, it takes the box's shape over its own 16:9
				className='size-full'
				src={src}
				poster={poster}
				autoPlay={autoPlay}
				// The kit's keys answer anywhere on the page, a field included,
				// and keep the letter for themselves: they stand down while one
				// is being typed in (the command palette, opened over a video)
				hotkeys={{scope: 'global', enabled: kitKeys}}
			>
				{/* Never cropped, in fullscreen too: the kit's inline `cover` gives
				    way only to an important rule */}
				<Video.Media className='!object-contain' />
				{onVideo && <ReportVideo onVideo={onVideo} />}
				<FadeControlsOnPlay />
				{keys === 'media' && <MediaKeys />}
				{controls && <Video.Backdrop />}
				{controls && cues.length > 0 && <Captions cues={cues} keys={keys !== false} />}
				{controls && (
					<>
						<Video.Header>
							<div className='rv-w-full rv-flex'>
								<Video.FullscreenToggle />
								<Video.PipToggle />
							</div>
							<div className='rv-w-full rv-flex rv-justify-end rv-items-center rv-h-fit'>
								{cues.length > 0 && <CaptionsToggle />}
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
						<Video.Footer className={FOOTER_CLASS}>
							<Video.Timeline />
							<div className='rv-flex rv-justify-between rv-w-full'>
								<Video.Time.Current />
								<Video.Time.Remaining negative />
							</div>
						</Video.Footer>
					</>
				)}
			</Video.Root>
		</div>
	)
}

type Keys = 'global' | 'media' | false

const TYPES = 'input, textarea, select, [contenteditable]'

// Whether the keyboard's focus is somewhere that types
function useIsTyping() {
	const [typing, setTyping] = useState(false)
	useEffect(() => {
		const read = () => setTyping(document.activeElement?.closest(TYPES) != null)
		read()
		document.addEventListener('focusin', read)
		document.addEventListener('focusout', read)
		// A field taken off the page with the focus in it can go without a
		// word: read again as a key goes down, or the keys would stay left to
		// a field that is no longer there
		window.addEventListener('keydown', read, true)
		return () => {
			document.removeEventListener('focusin', read)
			document.removeEventListener('focusout', read)
			window.removeEventListener('keydown', read, true)
		}
	}, [])
	return typing
}

// The kit's keys that switch something: pressed again by every repeat of a
// held key, F would flap in and out of fullscreen
const KIT_SWITCH_KEYS = new Set([' ', 'f', 'm', 'p'])

// A key held down is one press for the kit's keys too. The kit listens on
// the window as the key bubbles up and takes each repeat for a press, so a
// repeat of one that switches is stopped on its way down, before the kit
// hears it. The arrows are left to repeat: held, they seek and turn the volume.
function usePressHeldKeyOnce(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return
		const onKey = (event: KeyboardEvent) => {
			if (!event.repeat || !KIT_SWITCH_KEYS.has(event.key)) return
			if (event.target instanceof Element && event.target.closest(TYPES)) return
			// As the kit does with the press itself: held, space scrolls nothing
			event.preventDefault()
			event.stopPropagation()
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [enabled])
}

// The controls show until the pointer moves over the picture, and then fade
// a few seconds after it stops: left alone, a video that starts playing would
// keep them up — and on a small screen, keep its captions out of sight under
// them. So playback starting counts as a movement, and they fade as it plays.
function FadeControlsOnPlay() {
	const {isPlaying, videoRef, wrapperRef} = useVideoContext()
	useEffect(() => {
		if (!isPlaying) return
		// A beat after: the kit drops any pending fade as its playing state
		// changes, which it does just after this runs
		const handle = setTimeout(() => wrapperRef.current?.dispatchEvent(new MouseEvent('mousemove')), 100)
		return () => clearTimeout(handle)
	}, [isPlaying, wrapperRef])
	// The kit keeps its controls up while anything in it has focus, which is
	// right for the keyboard. A finger is not the keyboard, but Android gives
	// a tapped button focus all the same, and the controls would stay up
	// (and the captions hidden) after every tap on one: a tap lets it go.
	useEffect(() => {
		const wrapper = wrapperRef.current
		if (!wrapper) return
		const tapped = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') return
			setTimeout(() => {
				const focused = document.activeElement
				if (!(focused instanceof HTMLElement) || !wrapper.contains(focused)) return
				focused.blur()
				// Focus dropped the pending fade: start it again, a beat after,
				// once the kit has settled what letting go of focus does
				// — while it plays: paused, the controls stay
				setTimeout(() => {
					if (videoRef.current && !videoRef.current.paused) wrapper.dispatchEvent(new MouseEvent('mousemove'))
				}, 150)
			})
		}
		wrapper.addEventListener('pointerup', tapped)
		return () => wrapper.removeEventListener('pointerup', tapped)
	}, [videoRef, wrapperRef])
	return null
}

// The player's keys, less the arrows: space plays and pauses, F fills the
// screen, M mutes, wherever the focus is on the page (short of somewhere
// that types, or a button, which space presses)
function MediaKeys() {
	const {
		isPlaying,
		isMuted,
		isFullscreen,
		handlePlay,
		handlePause,
		handleMute,
		handleUnmute,
		handleFullScreen,
		handleExitFullScreen,
	} = useVideoContext()
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// A key held down is one press: repeating, F would flap in and out of fullscreen
			if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
			const target = event.target
			if (target instanceof Element && target.closest(TYPES)) return
			const key = event.key.toLowerCase()
			if (key === ' ') {
				if (target instanceof Element && target.closest('button, [role="button"], a')) return
				if (isPlaying) handlePause()
				else handlePlay()
			} else if (key === 'm') {
				if (isMuted) handleUnmute()
				else handleMute()
			} else if (key === 'f') {
				if (isFullscreen) handleExitFullScreen()
				else handleFullScreen()
			} else return
			event.preventDefault()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
	return null
}

function ReportVideo({onVideo}: {onVideo: (video: HTMLVideoElement | null) => void}) {
	const {videoRef} = useVideoContext()
	useEffect(() => {
		onVideo(videoRef.current)
		return () => onVideo(null)
	}, [videoRef, onVideo])
	return null
}

// Marks the footer, so captions can be lifted clear of what is in it
const FOOTER_CLASS = 'umbrel-video-footer'
// Air between the captions and the controls, or the picture's foot
const CAPTIONS_GAP_PX = 12
// A picture shorter than this has no room for captions above its controls
// without landing on the ones in its middle: while those show, the captions
// step aside
const ROOM_FOR_LIFT_PX = 320

// Captions on or off: one track, so a switch rather than a menu of one. Lit
// when on, the frame of the glyph filled.
function CaptionsToggle() {
	const {t} = useTranslation()
	const on = useCaptionsOn()
	const label = on ? t('video-captions.hide') : t('video-captions.show')
	return (
		<button
			type='button'
			aria-label={label}
			title={label}
			aria-pressed={on}
			onClick={() => setCaptionsOn(!on)}
			className='z-50 flex size-10 items-center justify-center rounded-full text-white/85 outline-hidden transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40'
		>
			<CaptionsIcon
				className={cn('size-6', on && '[&>path]:stroke-black [&>rect]:fill-white [&>rect]:stroke-white')}
				strokeWidth={1.75}
			/>
		</button>
	)
}

// What is being said, over the foot of the picture. Drawn here rather than
// left to the browser's own caption rendering, which can't know about this
// player's controls: while they show, the words rise above the timeline
// rather than sit under it, and settle back when the controls go, moving
// with them rather than jumping. Sized to the picture, as captions are on a
// screen of any size, and set on a soft panel around each line, so the
// picture still shows around the words. Always on the page while there are
// captions, on or off, since C works them — and C is pressed most when the
// controls, and the switch with them, are hidden.
function Captions({cues, keys}: {cues: readonly CaptionCue[]; keys: boolean}) {
	const on = useCaptionsOn()
	const {videoRef, wrapperRef, showControls} = useVideoContext()
	const [cue, setCue] = useState<CaptionCue>()
	const [frame, setFrame] = useState<{width: number; height: number; lift: number}>({width: 0, height: 0, lift: 0})

	useEffect(() => {
		if (!keys) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 'c' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target
			if (target instanceof Element && target.closest(TYPES)) return
			setCaptionsOn(!on)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [keys, on])

	// The cue at the playhead, followed frame by frame while playing (a
	// timeupdate comes only every quarter second or so)
	useEffect(() => {
		const video = videoRef.current
		if (!video || !on) return setCue(undefined)
		let frameId = 0
		const update = () => {
			const ms = video.currentTime * 1000
			setCue((current) =>
				current && current.startMs <= ms && ms < current.endMs
					? current
					: cues.find((candidate) => candidate.startMs <= ms && ms < candidate.endMs),
			)
		}
		const loop = () => {
			update()
			if (!video.paused && !video.ended) frameId = requestAnimationFrame(loop)
		}
		const start = () => {
			cancelAnimationFrame(frameId)
			loop()
		}
		const events = ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata'] as const
		for (const event of events) video.addEventListener(event, start)
		start()
		return () => {
			cancelAnimationFrame(frameId)
			for (const event of events) video.removeEventListener(event, start)
		}
	}, [videoRef, cues, on])

	// The picture's size, for the type, and how far the controls reach up it
	useEffect(() => {
		const video = videoRef.current
		if (!video || !on) return
		const measure = () => {
			const box = video.getBoundingClientRect()
			const footer = showControls ? wrapperRef.current?.querySelector(`.${FOOTER_CLASS}`) : null
			const tops = footer ? Array.from(footer.children, (child) => child.getBoundingClientRect().top) : []
			const lift = tops.length > 0 ? Math.max(0, box.bottom - Math.min(...tops)) : 0
			setFrame({width: box.width, height: box.height, lift})
		}
		measure()
		const resized = new ResizeObserver(measure)
		resized.observe(video)
		return () => resized.disconnect()
	}, [videoRef, wrapperRef, showControls, on])

	if (!on || !cue) return null
	const crowded = showControls && frame.height < ROOM_FOR_LIFT_PX
	// About a twentieth of the picture's height, as television keeps to, within
	// reason. A player taller than it is wide is sized by its width instead,
	// so that a line of a cue (see captionCues) still fits across it.
	const fontSize = Math.min(56, Math.max(13, Math.min(frame.height * 0.045, frame.width * 0.04)))
	return (
		<div
			className={cn(
				'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-[6%] text-center transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
				crowded && 'opacity-0',
			)}
			style={{transform: `translateY(-${(crowded ? 0 : frame.lift) + CAPTIONS_GAP_PX}px)`}}
		>
			<p
				className='font-medium [text-wrap:balance] [overflow-wrap:anywhere] whitespace-pre-line text-white'
				style={{fontSize, lineHeight: 1.35}}
			>
				<span className='rounded-md bg-black/60 box-decoration-clone px-[0.35em] py-[0.08em]'>{cue.text}</span>
			</p>
		</div>
	)
}
