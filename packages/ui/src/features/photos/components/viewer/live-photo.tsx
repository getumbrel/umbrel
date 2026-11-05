import {Volume2, VolumeX} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {itemLiveUrl} from '@/features/photos/hooks/use-items'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'

// A live photo on the stage: the still everyone already sees, and under it
// this — the pair's motion clip (CONTRACT.md `/api/photos/live/:id`) and a
// LIVE chip. The clip plays through once when the photo arrives
// (the way Photos on a Mac greets a live photo), and again on demand:
// press-and-hold anywhere on the picture — the iPhone gesture, looping
// until the finger lifts — or, with a mouse, rest on the chip. The chip is
// also a button, so a tap or Enter plays one pass for hands the other
// gestures don't fit.
//
// The still never leaves: the video sits over it and only ever fades in
// once frames are actually rendering (the `playing` event), so a browser
// that can't decode the clip — Apple pairs are often HEVC — or an iOS Low
// Power Mode that refuses autoplay degrades to exactly the photo it was. A
// decode error unmounts the whole layer: no chip that does nothing, no
// broken player. The crossfades mask the seam between the still (a frame
// from the middle of the clip) and playback from its start.
//
// Mounted only for the item the eye has rested on (see ItemViewer's
// REST_MS): mounting is what starts the download, and flying along the
// strip must not fetch a video per flown-over item.

// How long a press must stay put to become a hold — a tap has released by
// then — and how far it may wander before it is a drag. The slop is the
// stage's own axis lock (stage-gestures LOCK), so the two agree on which
// gesture the finger meant, and whichever claims it first wins.
const HOLD_MS = 350
const HOLD_SLOP = 10

// The clip's sound — the wind, the laugh — behind a toggle on the picture's
// other corner, remembered across sessions and off until asked for: sound
// nobody invited is a startle, and browsers block unmuted autoplay anyway.
// With it on, every pass tries unmuted and `begin` falls back to muted where
// autoplay policy refuses (an arrival with no recent gesture), so sound can
// only ever add to a playback, never cost one.
const SOUND_KEY = 'photos:live-sound'
const readSound = () => {
	try {
		return localStorage.getItem(SOUND_KEY) === 'on'
	} catch {
		return false
	}
}
const writeSound = (on: boolean) => {
	try {
		localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
	} catch {
		// The preference just won't stick
	}
}

// What the clip should be doing: nothing, one pass, or looping under a
// held finger / hovered chip.
type Intent = 'off' | 'auto' | 'hold'

export function LivePhoto({id, autoPlay}: {id: string; autoPlay: boolean}) {
	const {t} = useTranslation()
	const clipUrl = useAuthorizedHttpUrl(itemLiveUrl(id))
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [intent, setIntent] = useState<Intent>('off')
	// The video's opacity — true only while frames are rendering, so the
	// fade-in starts the moment motion does, never on an empty element
	const [showing, setShowing] = useState(false)
	const [failed, setFailed] = useState(false)
	const [sound, setSound] = useState(readSound)
	// The arrival pass has been offered (played, or superseded by a hold)
	const playedRef = useRef(false)

	// Play and pause are called here, in the handler's own stack, not from an
	// effect — a muted play() needs no user activation most places, but iOS
	// Low Power Mode grants it only near a gesture
	const begin = (mode: 'auto' | 'hold') => {
		const video = videoRef.current
		if (!video) return
		setIntent(mode)
		video.loop = mode === 'hold'
		video.muted = !sound
		// A hold during the arrival pass takes over the running playback
		// seamlessly; from rest, the pass starts at the clip's beginning
		if (video.paused) {
			video.currentTime = 0
			video.play().catch((error: unknown) => {
				// Only an autoplay-policy refusal (sound wants a user activation
				// this pass may not have) earns the muted replay — an end() while
				// the clip was still buffering rejects this same promise with an
				// AbortError, and retrying that would resurrect a playback the
				// user just released. When no playback starts at all, the intent
				// returns to rest so the chip's next press plays, not "stops".
				if (!video.muted && (error as DOMException)?.name === 'NotAllowedError') {
					video.muted = true
					video.play().catch(() => setIntent('off'))
				} else {
					setIntent('off')
				}
			})
		}
	}
	const end = () => {
		setIntent('off')
		videoRef.current?.pause()
		setShowing(false)
	}

	// The press-and-hold, on a surface covering the picture. Movement past
	// the slop hands the pointer to the stage's gestures (a step or a
	// dismissal), releasing the clip if the hold had already fired; the
	// pointer is captured only at that firing, so the release is seen
	// wherever the finger has wandered — and so an unfired press stays
	// untouched, keeping the chip's own click intact (a captured pointer
	// retargets its click). A fired hold's release needs no click guard: its
	// press never began on the chip, so the click it synthesizes targets
	// this surface — which listens for none — never the chip.
	const holdRef = useRef<{pointerId: number; x0: number; y0: number; timer: number; fired: boolean} | null>(null)
	useEffect(
		() => () => {
			if (holdRef.current) clearTimeout(holdRef.current.timer)
		},
		[],
	)

	const startHold = (event: React.PointerEvent) => {
		// A second finger makes it a pinch (the stage's zoom): no hold
		if (!event.isPrimary) {
			const hold = holdRef.current
			holdRef.current = null
			if (hold) clearTimeout(hold.timer)
			if (hold?.fired) end()
			return
		}
		if (event.button !== 0 || holdRef.current) return
		// A press on a chip is the chip's (its click, its hover)
		if ((event.target as Element).closest('button')) return
		const surface = event.currentTarget as HTMLElement
		// Zoomed, a press is a pan (and the clip is drawn at the still's size):
		// no hold — checked again when it would fire, a zoom may begin under it
		const zoomed = () => !!surface.closest('[data-zoomed]')
		if (zoomed()) return
		const hold = {pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, timer: 0, fired: false}
		hold.timer = window.setTimeout(() => {
			if (zoomed()) {
				holdRef.current = null
				return
			}
			hold.fired = true
			surface.setPointerCapture(hold.pointerId)
			begin('hold')
		}, HOLD_MS)
		holdRef.current = hold
	}
	const moveHold = (event: React.PointerEvent) => {
		const hold = holdRef.current
		if (!hold || event.pointerId !== hold.pointerId) return
		if (Math.hypot(event.clientX - hold.x0, event.clientY - hold.y0) < HOLD_SLOP) return
		holdRef.current = null
		clearTimeout(hold.timer)
		if (hold.fired) end()
	}
	const endHold = (event: React.PointerEvent) => {
		const hold = holdRef.current
		if (!hold || event.pointerId !== hold.pointerId) return
		holdRef.current = null
		clearTimeout(hold.timer)
		if (hold.fired) end()
	}

	// The chip under a mouse plays while hovered, the way the badge does in
	// Photos on a Mac. Touch pointers pass through to the click. The leave is
	// unconditional — after any enter the truth is 'hold' whatever a stale
	// render says, and end() at rest is a no-op — so a fast sweep across the
	// chip can never leave the clip looping behind the pointer.
	const chipHover = (event: React.PointerEvent, entering: boolean) => {
		if (event.pointerType !== 'mouse') return
		if (entering) begin('hold')
		else end()
	}
	const chipClick = () => {
		// While hovered it is already playing; the click is the hover's
		if (intent === 'hold') return
		if (intent === 'off') begin('auto')
		else end()
	}

	// Applied to the playing element too, so the toggle answers mid-pass —
	// and this click is the very activation an unmute needs
	const toggleSound = () => {
		const on = !sound
		setSound(on)
		writeSound(on)
		const video = videoRef.current
		if (video) video.muted = !on
	}

	if (failed) return null

	return (
		// The callout suppression keeps iOS from offering to save the image
		// mid-hold; the surface has no interactive default of its own, and the
		// stage's own gestures still see every pointer through bubbling
		<div
			className='absolute inset-0 select-none [-webkit-touch-callout:none]'
			onPointerDown={startHold}
			onPointerMove={moveHold}
			onPointerUp={endHold}
			onPointerCancel={endHold}
			onContextMenu={(event) => {
				// A long-press's context menu (Android) would interrupt the hold
				if (holdRef.current) event.preventDefault()
			}}
		>
			{clipUrl && (
				<video
					ref={videoRef}
					src={clipUrl}
					muted
					playsInline
					preload='auto'
					aria-hidden='true'
					onCanPlay={() => {
						// The arrival pass, once per mount — canplay refires on seeks
						if (playedRef.current) return
						playedRef.current = true
						if (autoPlay && intent === 'off') begin('auto')
					}}
					onPlaying={() => setShowing(true)}
					onEnded={end}
					onError={() => setFailed(true)}
					className={cn(
						'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ease-out motion-reduce:transition-none',
						// In quick (the motion should answer the gesture), out at a
						// settle's pace — it is a return to stillness, not a dismissal
						showing ? 'opacity-100 duration-200' : 'opacity-0 duration-300',
					)}
				/>
			)}
			<button
				type='button'
				aria-label={t('photos-item.live-play')}
				onClick={chipClick}
				onPointerEnter={(event) => chipHover(event, true)}
				onPointerLeave={(event) => chipHover(event, false)}
				className='absolute top-3 left-3 flex items-center gap-1 rounded-full bg-black/55 py-1 pr-2.5 pl-1.5 text-[11px] font-medium tracking-wide text-white outline-hidden backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/60 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in'
			>
				<LivePhotoIcon className='size-4' />
				{t('photos-item.live-badge')}
			</button>
			{/* The sound toggle, on the picture's other corner. Presses on any
			    button are the button's alone (startHold skips them). */}
			<button
				type='button'
				aria-label={t('photos-item.live-sound')}
				aria-pressed={sound}
				onClick={toggleSound}
				className='absolute top-3 right-3 flex items-center rounded-full bg-black/55 p-1.5 text-white outline-hidden backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/60 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in'
			>
				{sound ? <Volume2 className='size-4' /> : <VolumeX className='size-4' />}
			</button>
		</div>
	)
}
