// The guest and controller are mutable objects, which the React Compiler can't
// see change
'use no memo'

import {
	ArrowUp,
	Grid3x3,
	Keyboard,
	LogOut,
	Maximize,
	MoreHorizontal,
	MousePointer2,
	Power,
	RotateCw,
	Smartphone,
	Volume2,
	VolumeX,
	X,
} from 'lucide-react'
import {animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useTransform} from 'motion/react'
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ReactNode,
	type Ref,
	type RefObject,
} from 'react'

import '@/features/machines/touch/touch-console.css'

import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

import {Camera, type Rect} from './camera'
import {Controller} from './controller'
import {useFold, type Fold} from './fold'
import type {Guest, GuestStatus} from './guest'
import {copyToDevice, KeyboardSink, useGlass, type Glass, type KeyboardSinkHandle} from './keyboard'
import {COMPACT_KEY_ROW_HEIGHT, KEY_ROW_HEIGHT, KeyRow, KeysPanel, ModifierDot, useKeepFocus} from './keys'
import {XK} from './keysyms'
import {attachDirect, attachNativeTouch, attachTrackpad, type SurfaceEffects} from './surface'

// Keyboard animations: the deck and the keys ride the same curve iOS uses for
// its own keyboard, so nothing slides at a different speed
const KEYBOARD_EASE = [0.38, 0.7, 0.125, 1] as const
const KEYBOARD_MS = 0.34
const DECK_SPRING = {type: 'spring', stiffness: 420, damping: 40, mass: 0.9} as const

// Below this a desktop can't hold real apps, so small screens get more pixels
// than points and rely on zooming
const MIN_DESKTOP_WIDTH = 1280
const NATIVE_DESKTOP_WIDTH = 1024
// A whole desktop this large is readable: 13 px text comes out at about 6 points
const READABLE_SCALE = 0.48
// Room for the trackpad and the keys side by side
const WIDE_DECK_WIDTH = 600
const MIN_DECK_HEIGHT = 240
// Tall enough for the keys as a strip under the trackpad, not beside it
const STRIP_DECK_HEIGHT = 440
// The keys need more room than the trackpad; a narrow deck opens up for them
const KEYS_DECK_HEIGHT = 348
// A keyboard's height before the first one has been measured
const GUESSED_KEYBOARD = {portrait: 329, landscape: 208}
const hasTouch = navigator.maxTouchPoints > 0
// While the keyboard is up, iOS 26 Safari floats its address pill over the bottom
// of what visualViewport reports. Sideways the pill moves to the top, leaving the
// report short of the keyboard, and that band matters when the keyboard
// takes most of the glass. A web app on the Home Screen has neither.
const isIPhoneSafari = /iPhone/.test(navigator.userAgent) && !(navigator as {standalone?: boolean}).standalone
// Only a tall iPhone keeps Safari's pill along the bottom: the iPhone Duo's displays
// are closer to 3:2, with Safari's controls beside the page or above it
const TALL_PHONE_SHAPE = 1.8
const safariKeyboardOffset = (upright: boolean, {long, short}: Display) =>
	isIPhoneSafari && long / short > TALL_PHONE_SHAPE ? (upright ? 18 : -12) : 0

// Anything shorter is the small bar iOS leaves when a hardware keyboard is attached
const MIN_SOFT_KEYBOARD_HEIGHT = 160

// After a dismissal the guest's I-beam shouldn't bring the keyboard straight back
const AUTO_KEYBOARD_QUIET_MS = 12_000
// How long after a tap the guest's cursor can still bring the keyboard up
const CURSOR_WAIT_MS = 700

type Display = {long: number; short: number}

// The screen, not the window: it stays the same when the device turns or Safari's
// bars come and go, and changes when it unfolds
export function currentDisplay(): Display {
	return {long: Math.max(screen.width, screen.height), short: Math.min(screen.width, screen.height)}
}

// One landscape desktop per display, whichever way up it's held, so turning the
// device never rearranges anyone's windows. It's shaped for the display on its
// side, up to a tablet's 4:3. A phone only ever shows a slice of it upright, and
// the shorter the desktop the larger that slice reads, whatever the phone's shape.
export function desktopFor({long, short}: Display) {
	const width = long >= NATIVE_DESKTOP_WIDTH ? long : MIN_DESKTOP_WIDTH
	const shape = short < WIDE_DECK_WIDTH ? 0.5 : Math.min(0.75, Math.max(0.5, short / long))
	return {width, height: Math.round(width * shape)}
}

const clampTo = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// Upright, a screen wide enough to read at full width sits at the top like a
// laptop's lid, and the deck takes the rest. A phone can't read a whole desktop,
// so there the deck stays short and the desktop gets the height, panning sideways.
export function deckHeightFor(glass: Glass, guest: Pick<Guest, 'width' | 'height'>, keysFace: boolean) {
	const usable = glass.height - glass.safe.top - glass.safe.bottom
	const least = keysFace ? KEYS_DECK_HEIGHT : MIN_DECK_HEIGHT
	if (glass.width / guest.width >= READABLE_SCALE) {
		return Math.round(Math.max(least, Math.min(usable - (glass.width * guest.height) / guest.width, usable * 0.6)))
	}
	return keysFace ? KEYS_DECK_HEIGHT : Math.round(clampTo(glass.height * 0.42, 250, 340))
}

function readPreference<T>(key: string, fallback: T): T {
	try {
		const stored = localStorage.getItem(key)
		return stored === null ? fallback : (JSON.parse(stored) as T)
	} catch {
		return fallback
	}
}

function writePreference(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Only means starting from the default next time
	}
}

type Props = {
	guest: Guest
	title: string
	subtitle: string
	icon: string
	muted: boolean
	onMuted: (muted: boolean) => void
	// An agent has the machine: nothing here reaches the guest, so the controls step
	// aside and the whole desktop stays in view
	watching: boolean
	// Drawn over the screen, with what it takes to find the desktop on it
	onScreen?: (refs: {stage: RefObject<HTMLDivElement | null>; layer: RefObject<HTMLDivElement | null>}) => ReactNode
	// What the machine itself has to say, over everything
	children?: ReactNode
	onLeave: () => void
	onPower: (action: 'restart' | 'stop') => void
}

export function TouchConsole({
	guest,
	title,
	subtitle,
	icon,
	muted,
	onMuted,
	watching,
	onScreen,
	children,
	onLeave,
	onPower,
}: Props) {
	const glass = useGlass()
	const fold = useFold()
	const bent = fold.pose !== 'flat'
	const book = fold.pose === 'book'
	const upright = glass.height > glass.width
	const wide = glass.width >= WIDE_DECK_WIDTH
	const display = currentDisplay()
	const desktop = desktopFor(display)

	const [, guestResized] = useReducer((count: number) => count + 1, 0)
	const pansSideways = upright && glass.width / guest.width < READABLE_SCALE
	const cameraFill = watching ? undefined : book || pansSideways ? 'height' : bent ? 'width' : undefined

	const stage = useRef<HTMLDivElement>(null)
	const layer = useRef<HTMLDivElement>(null)
	const surface = useRef<HTMLDivElement>(null)
	const pad = useRef<HTMLDivElement>(null)
	const sink = useRef<KeyboardSinkHandle>(null)
	const effects = useRef<EffectsHandle>(null)
	const [controller, setController] = useState<Controller>()

	const [keyboardWanted, setKeyboardWanted] = useState(false)
	const [composing, setComposing] = useState(false)
	const composer = useRef<HTMLTextAreaElement>(null)
	const [panel, setPanel] = useState<'trackpad' | 'keys'>('trackpad')
	const [floatingKeys, setFloatingKeys] = useState(false)
	const [more, setMore] = useState(false)
	const [pointerMode, setPointerMode] = useState<'direct' | 'trackpad'>('direct')
	const [modeNotice, setModeNotice] = useState<string>()
	useEffect(() => {
		if (!modeNotice) return
		const timer = setTimeout(() => setModeNotice(undefined), 1_500)
		return () => clearTimeout(timer)
	}, [modeNotice])
	const lastKeyboard = useRef({portrait: GUESSED_KEYBOARD.portrait, landscape: GUESSED_KEYBOARD.landscape})
	const autoRaised = useRef(false)
	const typedSinceRaise = useRef(false)
	const quietUntil = useRef(0)

	// The deck: the bottom half of a laptop, whenever a device is upright. Folding
	// it away sticks, per display, and it starts folded with a pointer attached.
	// A text console has nothing to point at. Bending a foldable overrides all that:
	// the deck takes the half below the fold, or the page beside it, and the fold
	// itself is the hinge.
	const deckAllowed = (upright || bent) && !guest.nativeTouch && !watching
	const showsKeysOnly = !wide && panel === 'keys'
	const deckHeight =
		fold.pose === 'laptop'
			? glass.height - fold.at - glass.safe.bottom
			: book
				? glass.height - glass.safe.bottom
				: deckHeightFor(glass, guest, showsKeysOnly)
	const keysStrip = wide && !bent && deckHeight >= STRIP_DECK_HEIGHT
	const deckPreference = `umbrel:machines:deck:${display.long}x${display.short}`
	const deckWanted = () => !guest.textOnly && readPreference(deckPreference, !matchMedia('(any-pointer: fine)').matches)
	const deckProgress = useMotionValue(bent || deckWanted() ? 1 : 0)
	const [deckOpen, setDeckOpen] = useState(deckWanted)
	const deckTravel = useRef(deckHeight)
	deckTravel.current = book ? glass.width - fold.at + 24 : deckHeight + glass.safe.bottom + 24
	const deckSlide = useTransform(deckProgress, (progress) => (1 - progress) * deckTravel.current)
	const deckVisible = deckAllowed && (deckOpen || bent)

	const measuredKeyboard = glass.keyboard
	const orientation = upright ? 'portrait' : 'landscape'
	if (measuredKeyboard > 0) lastKeyboard.current[orientation] = measuredKeyboard
	// A hardware keyboard (an iPad's, a Bluetooth one) never shows on the viewport:
	// after a moment with no keyboard measured, the keys sit at the bottom instead
	const [noSoftKeyboard, setNoSoftKeyboard] = useState(!hasTouch)
	useEffect(() => {
		if (!keyboardWanted) return
		if (measuredKeyboard > 0) {
			setNoSoftKeyboard(false)
			return
		}
		const timer = setTimeout(() => setNoSoftKeyboard(true), 900)
		return () => clearTimeout(timer)
	}, [keyboardWanted, measuredKeyboard])
	const keyboardHeight = keyboardWanted
		? measuredKeyboard
			? measuredKeyboard + safariKeyboardOffset(upright, display)
			: noSoftKeyboard
				? deckVisible && !book
					? deckHeight + glass.safe.bottom
					: Math.max(glass.safe.bottom, 8)
				: lastKeyboard.current[orientation] + safariKeyboardOffset(upright, display)
		: 0
	const softKeyboardShowing = measuredKeyboard >= MIN_SOFT_KEYBOARD_HEIGHT || (!measuredKeyboard && !noSoftKeyboard)
	const rowHeight = !upright && glass.height < 500 ? COMPACT_KEY_ROW_HEIGHT : KEY_ROW_HEIGHT
	const keyboardUp = keyboardWanted

	// The glass left for the screen right now
	const viewFor = useCallback(
		(progress: number): Rect => {
			const {safe, width, height} = glass
			const onPage = deckAllowed && book
			const deck = deckAllowed && !book ? Math.max(safe.bottom, progress * (deckHeight + safe.bottom)) : safe.bottom
			// On a tablet the keyboard fits inside the deck, and the screen doesn't move
			const bottom = keyboardUp ? Math.max(keyboardHeight + rowHeight + (composing ? 52 : 0), deck) : deck
			const right = Math.max(safe.right, onPage ? progress * (width - fold.at) : 0)
			return {x: safe.left, y: safe.top, w: width - safe.left - right, h: height - safe.top - bottom}
		},
		[glass, keyboardUp, keyboardHeight, rowHeight, composing, deckAllowed, deckHeight, book, fold.at],
	)

	useLayoutEffect(() => {
		if (!layer.current) return
		const camera = new Camera(layer.current, guest.width, guest.height)
		camera.fill = cameraFill
		const next = new Controller(guest, camera)
		let caretTimer: ReturnType<typeof setTimeout> | undefined
		camera.onChange = () => {
			effects.current?.camera()
			guest.setViewScale?.(camera.s)
		}
		const followCaret = () => {
			const caret = guest.caret()
			if (caret) camera.keepInView(caret.x, caret.y)
		}
		guest.onCaretMove = followCaret
		next.onType = () => {
			typedSinceRaise.current = true
			if (guest.paced) return
			requestAnimationFrame(followCaret)
			// Return tends to take the caret somewhere new, a moment later
			clearTimeout(caretTimer)
			caretTimer = setTimeout(followCaret, 620)
		}
		camera.setView(viewFor(deckProgress.get()), {animate: false, pointer: {x: guest.width / 2, y: guest.height / 2}})
		camera.zoomed = false
		setController(next)
	}, [guest])

	// The guest decides its own size in the end
	useEffect(() => {
		if (!controller) return
		return guest.onResize(() => {
			const {camera} = controller
			camera.guestWidth = guest.width
			camera.guestHeight = guest.height
			if (layer.current) {
				layer.current.style.width = `${guest.width}px`
				layer.current.style.height = `${guest.height}px`
			}
			camera.setView(camera.view, {animate: false, pointer: {x: guest.width / 2, y: guest.height / 2}})
			guestResized()
		})
	}, [controller, guest])

	const [status, setStatus] = useState<GuestStatus>(guest.status)
	useEffect(() => guest.onStatus(() => setStatus(guest.status)), [guest])
	const seenFirstFrame = useRef(guest.status === 'connected')
	if (status === 'connected') seenFirstFrame.current = true

	// A guest's clipboard can only reach this device from inside a tap, so a copy
	// made over there waits here for one
	const [copied, setCopied] = useState<string>()
	useEffect(() => {
		guest.onClipboard = setCopied
		return () => {
			guest.onClipboard = undefined
		}
	}, [guest])
	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(undefined), 9_000)
		return () => clearTimeout(timer)
	}, [copied])

	// A new desktop only when the display itself changes, which is unfolding
	useEffect(() => {
		if (controller) guest.resizeTo?.(desktop.width, desktop.height)
	}, [controller, desktop.height, desktop.width, guest])

	useEffect(() => {
		if (controller) controller.camera.fill = cameraFill
	}, [controller, cameraFill])

	const raiseKeyboard = useCallback(() => {
		// Has to happen inside the touch, or iOS refuses to show the keyboard
		sink.current?.focus()
		setKeyboardWanted(true)
		typedSinceRaise.current = false
	}, [])

	const dismissKeyboard = useCallback(() => {
		if (autoRaised.current && !typedSinceRaise.current) quietUntil.current = performance.now() + AUTO_KEYBOARD_QUIET_MS
		autoRaised.current = false
		setComposing(false)
		sink.current?.blur()
		setKeyboardWanted(false)
	}, [])

	useEffect(() => {
		if (!watching) return
		dismissKeyboard()
		setFloatingKeys(false)
	}, [dismissKeyboard, watching])

	// The view follows the glass; the keyboard pulls it onto the caret
	const anchor = useCallback(() => {
		if (!controller) return {x: 0, y: 0}
		const point = guest.caret() ?? {x: controller.x, y: controller.y}
		// A text console's lines start at the margin
		return guest.textOnly ? {x: 0, y: point.y} : point
	}, [controller, guest])

	const wasKeyboardUp = useRef(false)
	useEffect(() => {
		if (!controller) return
		const {camera} = controller
		const view = viewFor(deckProgress.get())
		if (keyboardUp) {
			// Again whenever the glass changes under it: the first real keyboard
			// measurement, the composer opening, a turn of the phone
			const {view: current} = camera
			const sameGlass = current.w === view.w && current.h === view.h && current.y === view.y
			if (!wasKeyboardUp.current || !sameGlass) {
				const point = anchor()
				camera.focusOn(point.x, point.y, view)
			}
		} else if (wasKeyboardUp.current) camera.release(view, {x: controller.x, y: controller.y})
		else camera.setView(view, {animate: true, pointer: {x: controller.x, y: controller.y}})
		wasKeyboardUp.current = keyboardUp
	}, [controller, keyboardUp, viewFor])

	useMotionValueEvent(deckProgress, 'change', (progress) => {
		if (!controller || keyboardUp) return
		controller.camera.setView(viewFor(progress), {animate: false, pointer: {x: controller.x, y: controller.y}})
	})

	const setDeck = useCallback(
		(open: boolean) => {
			setDeckOpen(open)
			writePreference(deckPreference, open)
			if (open) setPointerMode('direct')
			void animate(deckProgress, open ? 1 : 0, DECK_SPRING)
		},
		[deckPreference, deckProgress],
	)

	const surfaceEffects = useMemo<SurfaceEffects>(
		() => ({
			ripple: (x, y) => effects.current?.ripple(x, y),
			arming: (x, y) => effects.current?.arming(x, y),
			disarm: () => effects.current?.disarm(),
			loupe: (x, y) => effects.current?.loupe(x, y),
			hideLoupe: () => effects.current?.hideLoupe(),
			tapped: () => {
				// The guest's cursor is the one signal VNC gives about what's under the
				// pointer: an I-beam means text. Tap one and the keyboard comes up, tap
				// anything else and it goes away again, like any field on a phone.
				const text = () => guest.textOnly || guest.cursor === 'ibeam'
				const raise = () => {
					if (keyboardUpRef.current || performance.now() < quietUntil.current) return
					autoRaised.current = true
					raiseKeyboard()
				}
				if (text()) return raise()
				if (keyboardUpRef.current && autoRaised.current) dismissKeyboard()
				// A quick tap can beat the cursor back from the guest. iOS still honours a
				// focus this soon after the touch.
				const stopWaiting = guest.onPointer(() => {
					if (!text()) return
					stopWaiting()
					raise()
				})
				setTimeout(stopWaiting, CURSOR_WAIT_MS)
			},
			padFingers: (fingers, pressed) => effects.current?.padFingers(fingers, pressed),
			pointerMoved: () => effects.current?.halo(),
			pointerClicked: () => effects.current?.clicked(),
		}),
		[dismissKeyboard, guest, raiseKeyboard],
	)
	const keyboardUpRef = useRef(false)
	keyboardUpRef.current = keyboardUp

	useEffect(() => {
		if (!surface.current || !controller) return
		const attach = guest.nativeTouch
			? attachNativeTouch
			: pointerMode === 'trackpad' && !deckVisible
				? attachTrackpad
				: attachDirect
		return attach(surface.current, controller, surfaceEffects)
	}, [controller, deckVisible, guest, pointerMode, surfaceEffects])

	useEffect(() => {
		if (!pad.current || !controller || showsKeysOnly || !deckAllowed) return
		return attachTrackpad(pad.current, controller, surfaceEffects)
	}, [controller, deckAllowed, showsKeysOnly, surfaceEffects])

	// Turning the device sideways folds the deck away; upright again, it's back. A
	// turn animates by itself, while bending the device is worth watching.
	const wasBent = useRef(bent)
	useEffect(() => {
		const shown = deckAllowed && (deckOpen || bent) ? 1 : 0
		if (wasBent.current !== bent) void animate(deckProgress, shown, DECK_SPRING)
		else deckProgress.set(shown)
		wasBent.current = bent
		setFloatingKeys(false)
	}, [deckAllowed, bent])

	// The other display of a foldable has its own preference
	const lastDeckPreference = useRef(deckPreference)
	useEffect(() => {
		if (lastDeckPreference.current === deckPreference) return
		lastDeckPreference.current = deckPreference
		const open = deckWanted()
		setDeckOpen(open)
		deckProgress.set(open || bent ? 1 : 0)
	}, [deckPreference])

	const [capsule, setCapsule] = useState<CapsulePlace>(() =>
		readPreference(CAPSULE_PREFERENCE, {side: 'right', offset: 0}),
	)
	const placeCapsule = (place: CapsulePlace) => {
		setCapsule(place)
		writePreference(CAPSULE_PREFERENCE, place)
	}

	// The system can take the keyboard away too: Done, a swipe, Android's back key.
	// Focus moving between the hidden field and the composer isn't that.
	const onTextFocusOut = (event: React.FocusEvent) => {
		const next = event.relatedTarget as HTMLElement | null
		if (next?.tagName === 'TEXTAREA') return
		requestAnimationFrame(() => {
			if (document.activeElement?.tagName !== 'TEXTAREA') dismissKeyboard()
		})
	}

	const openComposer = () => {
		setComposing((open) => {
			if (open) sink.current?.focus()
			else composer.current?.focus()
			return !open
		})
	}

	// Return in an empty field is Return on the machine, so a command goes across
	// and then runs, without leaving the keyboard
	const sendComposed = () => {
		if (!controller) return
		const text = composer.current?.value ?? ''
		if (text) controller.typeText(text)
		else controller.tapKey(XK.Return)
		if (composer.current) composer.current.value = ''
		composer.current?.focus()
	}

	const moreAction = {
		id: 'more',
		label: t('machines.touch-more'),
		icon: <MoreHorizontal className='size-5' />,
		run: () => setMore(true),
	}

	const openKeys = () => {
		if (keyboardUp) dismissKeyboard()
		if (deckAllowed) {
			setDeck(true)
			setPanel('keys')
		} else setFloatingKeys((open) => !open)
	}

	return (
		<div className='fixed inset-0 z-[60] overflow-hidden bg-black text-white' onBlur={onTextFocusOut}>
			<div ref={stage} className='absolute inset-0 overflow-hidden'>
				<div
					ref={layer}
					className='absolute top-0 left-0 origin-top-left transition-opacity duration-300'
					style={{width: guest.width, height: guest.height, opacity: seenFirstFrame.current ? 1 : 0}}
				>
					{guest.render()}
				</div>
				<div ref={surface} className='absolute inset-0 touch-none' />
				{controller && <Effects ref={effects} controller={controller} stage={stage} pad={pad} />}
				{onScreen?.({stage, layer})}
				{/* On the screen's own page, never across a fold */}
				<div className='absolute top-0 left-0 h-0' style={{width: book ? fold.at : '100%'}}>
					<AnimatePresence>
						{status !== 'connected' ? (
							<StatusNotice key='status' status={status} onTakeOver={() => guest.retry?.()} />
						) : modeNotice ? (
							<ModeNotice key={modeNotice} text={modeNotice} />
						) : copied ? (
							<CopiedNotice
								key='copied'
								source={title}
								onCopy={() => {
									copyToDevice(copied)
									setCopied(undefined)
								}}
							/>
						) : null}
					</AnimatePresence>
				</div>
			</div>

			{/* The deck */}
			<AnimatePresence>
				{deckAllowed && (
					<motion.div
						key='deck'
						className={cn(
							'absolute z-10 flex flex-col bg-[#0d0d0e]',
							book ? 'inset-y-0 right-0' : 'inset-x-0 bottom-0',
						)}
						initial={false}
						animate={{
							height: book ? glass.height : deckHeight + glass.safe.bottom,
							width: book ? glass.width - fold.at : glass.width,
						}}
						exit={book ? {opacity: 0, transition: {duration: 0.3}} : undefined}
						transition={DECK_SPRING}
						style={{
							...(book ? {x: deckSlide} : {y: deckSlide}),
							paddingTop: book ? glass.safe.top + 10 : bent ? 12 : 0,
							paddingBottom: Math.max(glass.safe.bottom, 10),
							paddingLeft: book ? 0 : glass.safe.left,
							paddingRight: glass.safe.right,
						}}
					>
						{!bent && <Hinge progress={deckProgress} height={deckHeight} onSnap={setDeck} />}
						<div className='flex min-h-0 flex-1 gap-2.5 px-3'>
							<div className='flex min-w-0 flex-1 flex-col gap-2.5'>
								{!showsKeysOnly && <Trackpad ref={pad} />}
								{controller && (showsKeysOnly || keysStrip || book) && (
									<KeysDeck
										controller={controller}
										strip={keysStrip}
										className={keysStrip ? 'h-[164px] shrink-0' : book ? 'h-[45%] shrink-0' : 'flex-1'}
									/>
								)}
								<div className='flex h-11 shrink-0 gap-2'>
									<DeckButton
										icon={<Keyboard className='size-[18px]' />}
										label={t('machines.touch-keyboard')}
										onClick={raiseKeyboard}
									/>
									{!wide && controller && <DeckFaces controller={controller} face={panel} onChange={setPanel} />}
									<DeckIconButton label={t('machines.touch-more')} onClick={() => setMore(true)}>
										<MoreHorizontal className='size-5' />
									</DeckIconButton>
								</div>
							</div>
							{controller && wide && !keysStrip && !book && (
								<KeysDeck controller={controller} className='w-1/2 shrink-0' />
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Folded, the deck leaves its hinge behind to pull it back up by */}
			{deckAllowed && !deckOpen && !bent && !keyboardUp && (
				<div className='absolute inset-x-0 flex justify-center' style={{bottom: Math.max(glass.safe.bottom - 8, 2)}}>
					<div className='w-28'>
						<Hinge progress={deckProgress} height={deckHeight} onSnap={setDeck} />
					</div>
				</div>
			)}

			{/* Full glass: the deck's controls move to a capsule on the edge */}
			{!deckVisible && !keyboardUp && (
				<ControlCapsule
					glass={glass}
					place={capsule}
					onPlace={placeCapsule}
					actions={
						watching
							? [moreAction]
							: [
									{
										id: 'keyboard',
										label: t('machines.touch-keyboard'),
										icon: <Keyboard className='size-5' />,
										run: raiseKeyboard,
									},
									{
										id: 'keys',
										label: t('machines.touch-keys'),
										icon: <Grid3x3 className='size-5' />,
										active: floatingKeys,
										badge: controller && <ModifierDot controller={controller} className='top-2 right-2' />,
										run: openKeys,
									},
									guest.nativeTouch || guest.textOnly
										? undefined
										: deckAllowed
											? {
													id: 'deck',
													label: t('machines.touch-trackpad'),
													icon: <MousePointer2 className='size-5' />,
													run: () => setDeck(true),
												}
											: {
													id: 'pointer',
													label: pointerMode === 'trackpad' ? t('machines.touch-touch') : t('machines.touch-trackpad'),
													icon:
														pointerMode === 'trackpad' ? (
															<Smartphone className='size-5' />
														) : (
															<MousePointer2 className='size-5' />
														),
													active: pointerMode === 'trackpad',
													run: () => {
														const next = pointerMode === 'trackpad' ? 'direct' : 'trackpad'
														setPointerMode(next)
														setModeNotice(
															next === 'trackpad'
																? t('machines.touch-trackpad-notice')
																: t('machines.touch-direct-notice'),
														)
													},
												},
									moreAction,
								].filter((action) => action !== undefined)
					}
				/>
			)}

			<AnimatePresence>
				{floatingKeys && controller && (
					<FloatingKeys
						controller={controller}
						glass={glass}
						side={capsule.side}
						onClose={() => setFloatingKeys(false)}
					/>
				)}
			</AnimatePresence>

			{/* On top of the keyboard */}
			<AnimatePresence>
				{keyboardUp && controller && (
					<motion.div
						key='key-tray'
						initial={{y: keyboardHeight + rowHeight + 60}}
						animate={{y: 0}}
						exit={{y: keyboardHeight + rowHeight + 60}}
						transition={{duration: KEYBOARD_MS, ease: KEYBOARD_EASE}}
						className='console-tray absolute inset-x-0 z-20'
						// Runs on under a software keyboard, so nothing shows between the keys
						// and it. A hardware keyboard leaves the deck where it is, and a tablet's
						// keyboard only covers its lower half, so the trackpad stays in reach.
						style={{
							bottom: softKeyboardShowing ? 0 : keyboardHeight,
							paddingBottom: softKeyboardShowing ? keyboardHeight : 0,
							paddingLeft: glass.safe.left,
							paddingRight: glass.safe.right,
						}}
					>
						{composing && <Composer ref={composer} onSend={sendComposed} />}
						<KeyRow
							controller={controller}
							height={rowHeight}
							wide={wide}
							composing={composing}
							onCompose={openComposer}
							onDismiss={dismissKeyboard}
						/>
					</motion.div>
				)}
			</AnimatePresence>

			<div className='absolute inset-0 z-30 empty:hidden'>{children}</div>

			<AnimatePresence>
				{more && (
					<MoreSheet
						title={title}
						subtitle={subtitle}
						icon={icon}
						fold={fold}
						muted={muted}
						onMuted={onMuted}
						onClose={() => setMore(false)}
						onFit={() => {
							controller?.camera.showAll()
							setMore(false)
						}}
						onRestart={() => {
							setMore(false)
							onPower('restart')
						}}
						onStop={() => {
							setMore(false)
							onPower('stop')
						}}
						onLeave={onLeave}
					/>
				)}
			</AnimatePresence>

			{controller && <KeyboardSink ref={sink} controller={controller} />}
		</div>
	)
}

function StatusNotice({status, onTakeOver}: {status: GuestStatus; onTakeOver: () => void}) {
	return (
		<motion.div
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}
			transition={{duration: 0.2}}
			className='absolute inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-10 flex justify-center'
		>
			<div className='console-glass flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] font-medium text-white/80'>
				<span className='py-1'>
					{status === 'superseded'
						? t('machines.console-controlled-elsewhere')
						: status === 'reconnecting'
							? t('machines.console-reconnecting')
							: t('machines.console-connecting')}
				</span>
				{status === 'superseded' ? (
					<button
						type='button'
						onClick={onTakeOver}
						className='rounded-full bg-white px-3 py-1 font-semibold text-black outline-none active:opacity-70'
					>
						{t('machines.console-agent-take-over')}
					</button>
				) : (
					<span className='mr-2.5 size-3 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/80' />
				)}
			</div>
		</motion.div>
	)
}

function ModeNotice({text}: {text: string}) {
	return (
		<motion.div
			initial={{opacity: 0, y: -6}}
			animate={{opacity: 1, y: 0}}
			exit={{opacity: 0, y: -6}}
			transition={{duration: 0.2, ease: [0.22, 1, 0.36, 1]}}
			className='pointer-events-none absolute inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-10 flex justify-center'
		>
			<div className='console-glass rounded-full px-4 py-2 text-[13px] font-medium text-white/80'>{text}</div>
		</motion.div>
	)
}

function CopiedNotice({source, onCopy}: {source: string; onCopy: () => void}) {
	return (
		<motion.div
			initial={{opacity: 0, y: -6}}
			animate={{opacity: 1, y: 0}}
			exit={{opacity: 0, y: -6}}
			transition={{duration: 0.2, ease: [0.22, 1, 0.36, 1]}}
			className='absolute inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-10 flex justify-center px-4'
		>
			<div className='console-glass flex min-w-0 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] font-medium text-white/80'>
				<span className='truncate py-1'>{t('machines.touch-text-from', {machine: source})}</span>
				<button
					type='button'
					onClick={onCopy}
					className='shrink-0 rounded-full bg-white px-3 py-1 font-semibold text-black outline-none active:opacity-70'
				>
					{t('machines.clipboard-copied-action')}
				</button>
			</div>
		</motion.div>
	)
}

function Hinge({
	progress,
	height,
	onSnap,
}: {
	progress: ReturnType<typeof useMotionValue<number>>
	height: number
	onSnap: (open: boolean) => void
}) {
	const drag = useRef<{y: number; from: number; t: number; lastY: number} | undefined>(undefined)
	return (
		<div
			role='separator'
			aria-label={t('machines.touch-resize-screen')}
			className='flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center'
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId)
				drag.current = {y: event.clientY, from: progress.get(), t: performance.now(), lastY: event.clientY}
			}}
			onPointerMove={(event) => {
				if (!drag.current) return
				const next = drag.current.from - (event.clientY - drag.current.y) / height
				progress.set(Math.max(0, Math.min(1, next)))
				drag.current.t = performance.now()
				drag.current.lastY = event.clientY
			}}
			onPointerUp={(event) => {
				if (!drag.current) return
				const moved = event.clientY - drag.current.y
				drag.current = undefined
				onSnap(Math.abs(moved) < 4 ? progress.get() < 0.5 : progress.get() > 0.55)
			}}
		>
			<div className='h-[5px] w-9 rounded-full bg-white/25' />
		</div>
	)
}

const TRACKPAD_HINT_KEY = 'umbrel:machines:trackpad-used'
function trackpadUsedBefore() {
	try {
		return localStorage.getItem(TRACKPAD_HINT_KEY) === '1'
	} catch {
		return false
	}
}
function rememberTrackpadUsed() {
	try {
		localStorage.setItem(TRACKPAD_HINT_KEY, '1')
	} catch {
		// Only means the hint shows again next time
	}
}

function Trackpad({ref}: {ref: Ref<HTMLDivElement>}) {
	const [hinted] = useState(trackpadUsedBefore)
	return (
		<div
			ref={ref}
			data-trackpad
			className='relative min-h-0 flex-1 touch-none overflow-hidden rounded-[18px] bg-white/[0.055] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.05)]'
		>
			<div
				data-trackpad-hint
				hidden={hinted}
				className='pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] leading-[17px] text-white/30 transition-opacity duration-500'
			>
				{t('machines.touch-trackpad-hint-click')}
				<br />
				{t('machines.touch-trackpad-hint-right-click')}
			</div>
		</div>
	)
}

function KeysDeck({controller, strip, className}: {controller: Controller; strip?: boolean; className: string}) {
	const element = useKeepFocus()
	return (
		<div ref={element} className={cn('min-h-0 overflow-hidden', className)}>
			<KeysPanel controller={controller} strip={strip} className='h-full' />
		</div>
	)
}

// The two faces of the deck, as a switch: there's always exactly one
function DeckFaces({
	controller,
	face,
	onChange,
}: {
	controller: Controller
	face: 'trackpad' | 'keys'
	onChange: (face: 'trackpad' | 'keys') => void
}) {
	const faces = [
		{id: 'trackpad', label: t('machines.touch-trackpad'), icon: <MousePointer2 className='size-[17px]' />},
		{id: 'keys', label: t('machines.touch-keys'), icon: <Grid3x3 className='size-[17px]' />},
	] as const
	return (
		<div
			role='radiogroup'
			aria-label={t('machines.touch-deck')}
			className='settings-edge-material relative flex h-11 shrink-0 rounded-full bg-white/8 p-[3px]'
		>
			<motion.div
				className='absolute top-[3px] left-[3px] h-[38px] w-11 rounded-full bg-white/16 shadow-[0_1px_2px_rgb(0_0_0/0.25)]'
				initial={false}
				animate={{x: face === 'keys' ? 44 : 0}}
				transition={DECK_SPRING}
			/>
			{faces.map(({id, label, icon}) => (
				<button
					key={id}
					type='button'
					role='radio'
					aria-checked={face === id}
					aria-label={label}
					onClick={() => onChange(id)}
					className={cn(
						'relative grid h-[38px] w-11 place-items-center rounded-full transition-colors duration-200 outline-none',
						face === id ? 'text-white' : 'text-white/55',
					)}
				>
					{icon}
					{id === 'keys' && <ModifierDot controller={controller} className='top-1.5 right-1.5' />}
				</button>
			))}
		</div>
	)
}

function DeckButton({
	icon,
	label,
	active,
	onClick,
}: {
	icon: ReactNode
	label: string
	active?: boolean
	onClick: () => void
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'settings-edge-material flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-transparent bg-white/8 text-[14px] font-semibold -tracking-[0.01em] text-white/90 transition-[background-color,border-color,transform] duration-150 outline-none active:scale-[0.97]',
				active && 'border-white/60 bg-white/14',
			)}
		>
			{icon}
			{label}
		</button>
	)
}

function DeckIconButton({label, onClick, children}: {label: string; onClick: () => void; children: ReactNode}) {
	return (
		<button
			type='button'
			aria-label={label}
			onClick={onClick}
			className='settings-edge-material grid size-11 shrink-0 place-items-center rounded-full bg-white/8 text-white/90 transition-transform duration-150 outline-none active:scale-90'
		>
			{children}
		</button>
	)
}

type CapsuleAction = {id: string; label: string; icon: ReactNode; active?: boolean; badge?: ReactNode; run: () => void}
type CapsulePlace = {side: 'left' | 'right'; offset: number}

const CAPSULE_PREFERENCE = 'umbrel:machines:capsule'
const CAPSULE_MARGIN = 6
const CAPSULE_DIM_MS = 2_600

// With the deck out of the way its controls wait on the edge, and a keyboard is
// always one tap away. It dims when left alone, and drags along the edge or across
// to the other hand when it's in the way.
function ControlCapsule({
	glass,
	place,
	onPlace,
	actions,
}: {
	glass: Glass
	place: CapsulePlace
	onPlace: (place: CapsulePlace) => void
	actions: CapsuleAction[]
}) {
	const offset = useMotionValue(place.offset)
	const drag = useRef<{x: number; y: number; from: number; moved: boolean} | undefined>(undefined)
	const justDragged = useRef(false)
	const [awake, setAwake] = useState(true)
	const sleepTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const wake = useCallback(() => {
		setAwake(true)
		clearTimeout(sleepTimer.current)
		sleepTimer.current = setTimeout(() => setAwake(false), CAPSULE_DIM_MS)
	}, [])
	useEffect(() => {
		wake()
		return () => clearTimeout(sleepTimer.current)
	}, [wake])
	const inset = (place.side === 'right' ? glass.safe.right : glass.safe.left) + CAPSULE_MARGIN
	const limit = Math.max(0, glass.height / 2 - 24 * actions.length - 16)
	useEffect(() => offset.set(clampTo(offset.get(), -limit, limit)), [limit, offset])

	return (
		<motion.div
			layout='position'
			transition={DECK_SPRING}
			className='console-glass absolute top-1/2 z-10 flex touch-none flex-col gap-0.5 rounded-full p-1 transition-opacity duration-500'
			style={{y: offset, marginTop: -(22 * actions.length + 4), [place.side]: inset, opacity: awake ? 1 : 0.5}}
			onPointerDown={(event) => {
				justDragged.current = false
				drag.current = {x: event.clientX, y: event.clientY, from: offset.get(), moved: false}
				wake()
			}}
			onPointerMove={(event) => {
				const current = drag.current
				if (!current) return
				const dy = event.clientY - current.y
				if (!current.moved && Math.hypot(event.clientX - current.x, dy) > 8) {
					current.moved = true
					event.currentTarget.setPointerCapture(event.pointerId)
				}
				if (current.moved) offset.set(clampTo(current.from + dy, -limit, limit))
			}}
			onPointerUp={(event) => {
				const current = drag.current
				drag.current = undefined
				if (!current?.moved) return
				justDragged.current = true
				const crossed = Math.abs(event.clientX - current.x) > glass.width / 4
				const side = crossed ? (event.clientX < glass.width / 2 ? 'left' : 'right') : place.side
				onPlace({side, offset: offset.get()})
			}}
		>
			{actions.map((action) => (
				<button
					key={action.id}
					type='button'
					aria-label={action.label}
					onClick={() => {
						if (justDragged.current) return
						wake()
						action.run()
					}}
					className={cn(
						'relative grid size-11 place-items-center rounded-full text-white/90 transition-[background-color,transform] duration-150 outline-none active:scale-90 active:bg-white/15',
						action.active && 'bg-white text-black active:bg-white',
					)}
				>
					{action.icon}
					{action.badge}
				</button>
			))}
		</motion.div>
	)
}

function FloatingKeys({
	controller,
	glass,
	side,
	onClose,
}: {
	controller: Controller
	glass: Glass
	side: CapsulePlace['side']
	onClose: () => void
}) {
	const element = useKeepFocus()
	const edge = (side === 'right' ? glass.safe.right : glass.safe.left) + CAPSULE_MARGIN + 60
	return (
		<>
			<div className='absolute inset-0 z-10' onPointerDown={onClose} />
			<motion.div
				ref={element}
				initial={{opacity: 0, x: side === 'right' ? 12 : -12, scale: 0.97}}
				animate={{opacity: 1, x: 0, scale: 1}}
				exit={{opacity: 0, x: side === 'right' ? 8 : -8, scale: 0.98}}
				transition={{duration: 0.2, ease: [0.22, 1, 0.36, 1]}}
				className='console-glass absolute top-1/2 z-20 w-[min(372px,calc(100%-96px))] -translate-y-1/2 rounded-[20px] p-2.5'
				style={{[side]: edge}}
			>
				<KeysPanel controller={controller} className='h-[min(264px,calc(100dvh-44px))]' />
			</motion.div>
		</>
	)
}

// For anything better written than typed key by key. It's a real text field, so
// autocorrect, dictation, autofill and the system Paste all work, and the text
// goes to the guest in one go. Over plain HTTP that's also the only way to get a
// phone's clipboard across.
function Composer({onSend, ref}: {onSend: () => void; ref: Ref<HTMLTextAreaElement>}) {
	const input = useRef<HTMLTextAreaElement>(null)
	const element = useKeepFocus()
	useImperativeHandle(ref, () => input.current as HTMLTextAreaElement)
	useEffect(() => input.current?.focus(), [])
	return (
		<div ref={element} className='flex items-end gap-2 px-2 pt-2'>
			<textarea
				ref={input}
				rows={1}
				aria-label={t('machines.touch-compose-field')}
				placeholder={t('machines.touch-compose-placeholder')}
				className='console-composer h-9 min-w-0 flex-1 resize-none rounded-[18px] border-0 px-3.5 py-[7px] text-[16px] leading-[22px] outline-none'
				style={{WebkitUserSelect: 'text', userSelect: 'text'}}
				onKeyDown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault()
						onSend()
					}
				}}
			/>
			<button
				type='button'
				aria-label={t('machines.touch-send')}
				onPointerDown={(event) => event.preventDefault()}
				onPointerUp={onSend}
				className='console-send grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-150 outline-none active:scale-90'
			>
				<ArrowUp className='size-5' strokeWidth={2.4} />
			</button>
		</div>
	)
}

function MoreSheet({
	title,
	subtitle,
	icon,
	fold,
	muted,
	onMuted,
	onClose,
	onFit,
	onRestart,
	onStop,
	onLeave,
}: {
	title: string
	subtitle: string
	icon: string
	fold: Fold
	muted: boolean
	onMuted: (muted: boolean) => void
	onClose: () => void
	onFit: () => void
	onRestart: () => void
	onStop: () => void
	onLeave: () => void
}) {
	const rowClass =
		'flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-[15px] font-medium text-white/90 transition-colors duration-100 outline-none active:bg-white/10'
	return (
		<motion.div
			className='absolute inset-0 z-30 flex items-end justify-center bg-black/45 sm:items-center'
			// Clear of the fold, on the deck's side of it
			style={{
				paddingTop: fold.pose === 'laptop' ? fold.at : 0,
				paddingLeft: fold.pose === 'book' ? fold.at : 0,
			}}
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			exit={{opacity: 0}}
			transition={{duration: 0.18}}
			onPointerDown={(event) => event.target === event.currentTarget && onClose()}
		>
			<motion.div
				initial={{y: 24, opacity: 0.6}}
				animate={{y: 0, opacity: 1}}
				exit={{y: 24, opacity: 0}}
				transition={{duration: 0.24, ease: [0.22, 1, 0.36, 1]}}
				className='console-glass mb-2 flex max-h-[calc(100%-16px)] w-[min(380px,calc(100%-16px))] flex-col overflow-y-auto rounded-[24px] p-2'
			>
				<div className='flex items-center gap-3 px-3 py-2'>
					<img src={icon} alt='' className='size-10' />
					<div className='min-w-0 flex-1'>
						<div className='truncate text-[15px] font-semibold -tracking-[0.01em]'>{title}</div>
						<div className='text-[12px] text-white/50'>{subtitle}</div>
					</div>
					<button
						type='button'
						aria-label={t('close')}
						onClick={onClose}
						className='grid size-8 place-items-center rounded-full bg-white/10 outline-none active:bg-white/20'
					>
						<X className='size-4' />
					</button>
				</div>
				<button type='button' className={rowClass} onClick={onFit}>
					<Maximize className='size-[18px] text-white/60' /> {t('machines.touch-show-desktop')}
				</button>
				<button type='button' className={rowClass} onClick={() => onMuted(!muted)}>
					{muted ? (
						<VolumeX className='size-[18px] text-white/60' />
					) : (
						<Volume2 className='size-[18px] text-white/60' />
					)}
					{muted ? t('machines.console-enable-audio') : t('machines.console-mute-audio')}
				</button>
				<ConfirmRow
					className={rowClass}
					icon={<RotateCw className='size-[18px] text-white/60' />}
					label={t('machines.restart')}
					confirm={t('machines.touch-confirm-restart')}
					onConfirm={onRestart}
				/>
				<ConfirmRow
					className={cn(rowClass, 'text-[#ff6b6b]')}
					icon={<Power className='size-[18px]' />}
					label={t('machines.shut-down')}
					confirm={t('machines.touch-confirm-shut-down')}
					onConfirm={onStop}
				/>
				<button type='button' className={rowClass} onClick={onLeave}>
					<LogOut className='size-[18px] text-white/60' /> {t('machines.touch-back')}
				</button>
				<div className='mt-1 border-t border-white/8 px-3 pt-3 pb-2 text-[12.5px] leading-[19px] text-white/50'>
					<div className='mb-1 font-semibold text-white/70'>{t('machines.touch-help-screen-title')}</div>
					{t('machines.touch-help-screen')}
					<div className='mt-2 mb-1 font-semibold text-white/70'>{t('machines.touch-help-trackpad-title')}</div>
					{t('machines.touch-help-trackpad')}
				</div>
			</motion.div>
		</motion.div>
	)
}

// A thumb in a pocket shouldn't be able to turn a machine off
function ConfirmRow({
	className,
	icon,
	label,
	confirm,
	onConfirm,
}: {
	className: string
	icon: ReactNode
	label: string
	confirm: string
	onConfirm: () => void
}) {
	const [armed, setArmed] = useState(false)
	useEffect(() => {
		if (!armed) return
		const timer = setTimeout(() => setArmed(false), 3_000)
		return () => clearTimeout(timer)
	}, [armed])
	return (
		<button
			type='button'
			className={cn(className, armed && 'bg-white/10')}
			onClick={() => (armed ? onConfirm() : setArmed(true))}
		>
			{icon} {armed ? confirm : label}
		</button>
	)
}

type EffectsHandle = {
	ripple: (x: number, y: number) => void
	arming: (x: number, y: number) => void
	disarm: () => void
	loupe: (x: number, y: number) => void
	hideLoupe: () => void
	padFingers: (fingers: {x: number; y: number}[], pressed?: boolean) => void
	halo: () => void
	clicked: () => void
	camera: () => void
}

const HALO_SIZE = 36
const LOUPE_SIZE = 128
const LOUPE_PIXEL_RATIO = 3
const LOUPE_LIFT = 104

// Everything drawn over the screen to say what a touch did: rings, the loupe,
// and scroll indicators that show where this view sits on the whole desktop
function Effects({
	controller,
	stage,
	pad,
	ref,
}: {
	controller: Controller
	stage: React.RefObject<HTMLDivElement | null>
	pad: React.RefObject<HTMLDivElement | null>
	ref: Ref<EffectsHandle>
}) {
	const layer = useRef<HTMLDivElement>(null)
	const arming = useRef<HTMLDivElement>(undefined)
	const loupe = useRef<HTMLDivElement>(null)
	const horizontal = useRef<HTMLDivElement>(null)
	const vertical = useRef<HTMLDivElement>(null)
	const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const glow = useRef<HTMLDivElement>(undefined)
	const haloRef = useRef<HTMLDivElement>(null)
	const haloTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const loupeCanvas = useRef<HTMLCanvasElement>(null)
	const loupeAt = useRef<{gx: number; gy: number; scale: number}>(undefined)
	const loupeFrame = useRef(0)
	const {guest, camera} = controller

	useImperativeHandle(ref, () => ({
		ripple(x, y) {
			const node = document.createElement('div')
			node.className = 'console-ripple'
			node.style.left = `${x}px`
			node.style.top = `${y}px`
			node.addEventListener('animationend', () => node.remove())
			layer.current?.append(node)
		},
		arming(x, y) {
			navigator.vibrate?.(6)
			arming.current?.remove()
			const node = document.createElement('div')
			node.className = 'console-arming'
			node.style.left = `${x}px`
			node.style.top = `${y}px`
			layer.current?.append(node)
			arming.current = node
		},
		disarm() {
			arming.current?.remove()
			arming.current = undefined
		},
		loupe(x, y) {
			const element = loupe.current
			if (!element) return
			const {width} = stage.current?.getBoundingClientRect() ?? {width: 0}
			const above = y - LOUPE_LIFT
			const flip = above < LOUPE_SIZE / 2 + 8
			const left = Math.max(
				LOUPE_SIZE / 2 + 6,
				Math.min(width - LOUPE_SIZE / 2 - 6, flip ? x + (x < width / 2 ? 1 : -1) * LOUPE_LIFT : x),
			)
			const top = flip ? Math.max(y, LOUPE_SIZE / 2 + 8) : above
			element.style.transform = `translate3d(${left - LOUPE_SIZE / 2}px, ${top - LOUPE_SIZE / 2}px, 0)`
			element.style.opacity = '1'
			element.dataset.visible = ''
			const scale = Math.max(camera.s * 2.1, 1.25)
			const {x: gx, y: gy} = camera.toGuest(x, y)
			loupeAt.current = {gx, gy, scale}
			if (!loupeFrame.current) {
				const draw = () => {
					const context = loupeCanvas.current?.getContext('2d')
					const at = loupeAt.current
					if (context && at) {
						const pixels = LOUPE_SIZE * LOUPE_PIXEL_RATIO
						guest.drawLoupe(context, at.gx, at.gy, at.scale * LOUPE_PIXEL_RATIO, pixels)
					}
					loupeFrame.current = requestAnimationFrame(draw)
				}
				draw()
			}
		},
		hideLoupe() {
			cancelAnimationFrame(loupeFrame.current)
			loupeFrame.current = 0
			if (!loupe.current) return
			loupe.current.style.opacity = '0'
			delete loupe.current.dataset.visible
		},
		// A cursor at 40% scale is hard to find. While the trackpad drives it, a soft
		// halo in screen pixels says where it went, like the pointer on an iPad.
		halo() {
			const element = haloRef.current
			if (!element) return
			const {x, y} = camera.toStage(controller.x, controller.y)
			element.style.transform = `translate3d(${x - HALO_SIZE / 2}px, ${y - HALO_SIZE / 2}px, 0)`
			element.style.opacity = '1'
			clearTimeout(haloTimer.current)
			haloTimer.current = setTimeout(() => (element.style.opacity = '0'), 700)
		},
		clicked() {
			const {x, y} = camera.toStage(controller.x, controller.y)
			this.ripple(x, y)
		},
		padFingers(fingers, pressed) {
			const element = pad.current
			if (!element) return
			if (!glow.current) {
				const node = document.createElement('div')
				node.className = 'pointer-events-none absolute size-40 rounded-full opacity-0 transition-opacity duration-300'
				node.style.background = 'radial-gradient(closest-side, rgb(255 255 255 / 0.12), transparent)'
				node.style.transform = 'translate(-50%, -50%)'
				element.append(node)
				glow.current = node
			}
			const node = glow.current
			const [finger] = fingers
			if (finger) {
				node.style.left = `${finger.x}px`
				node.style.top = `${finger.y}px`
				node.style.opacity = '1'
				const hint = element.querySelector<HTMLElement>('[data-trackpad-hint]')
				if (hint && hint.style.opacity !== '0') {
					hint.style.opacity = '0'
					rememberTrackpadUsed()
				}
			} else node.style.opacity = pressed ? '0.5' : '0'
			if (pressed)
				element.animate([{backgroundColor: 'rgb(255 255 255 / 0.13)'}, {backgroundColor: 'rgb(255 255 255 / 0.055)'}], {
					duration: 180,
					easing: 'ease-out',
				})
		},
		camera() {
			const {view, s, x, y, guestWidth, guestHeight} = camera
			const showX = guestWidth * s > view.w + 1
			const showY = guestHeight * s > view.h + 1
			const barX = horizontal.current
			const barY = vertical.current
			if (barX) {
				const length = Math.max(28, (view.w / (guestWidth * s)) * (view.w - 12))
				const travel = (view.x - x) / (guestWidth * s - view.w || 1)
				barX.style.width = `${length}px`
				barX.style.left = `${view.x + 6 + travel * (view.w - 12 - length)}px`
				barX.style.top = `${view.y + view.h - 6}px`
				barX.style.opacity = showX ? '1' : '0'
			}
			if (barY) {
				const length = Math.max(28, (view.h / (guestHeight * s)) * (view.h - 12))
				const travel = (view.y - y) / (guestHeight * s - view.h || 1)
				barY.style.height = `${length}px`
				barY.style.top = `${view.y + 6 + travel * (view.h - 12 - length)}px`
				barY.style.left = `${view.x + view.w - 6}px`
				barY.style.opacity = showY ? '1' : '0'
			}
			clearTimeout(hideTimer.current)
			hideTimer.current = setTimeout(() => {
				if (barX) barX.style.opacity = '0'
				if (barY) barY.style.opacity = '0'
			}, 620)
		},
	}))

	return (
		<div ref={layer} className='pointer-events-none absolute inset-0 overflow-hidden'>
			<div
				ref={horizontal}
				className='absolute h-[3px] rounded-full bg-white/55 opacity-0 shadow-[0_0_0_0.5px_rgb(0_0_0/0.35)] transition-opacity duration-300'
			/>
			<div
				ref={vertical}
				className='absolute w-[3px] rounded-full bg-white/55 opacity-0 shadow-[0_0_0_0.5px_rgb(0_0_0/0.35)] transition-opacity duration-300'
			/>
			<div
				ref={haloRef}
				className='absolute top-0 left-0 rounded-full bg-white/18 opacity-0 shadow-[0_0_0_0.5px_rgb(255_255_255/0.4)] transition-opacity duration-300'
				style={{width: HALO_SIZE, height: HALO_SIZE}}
			/>
			<div
				ref={loupe}
				className='console-loupe absolute top-0 left-0 opacity-0 transition-opacity duration-150'
				style={{width: LOUPE_SIZE, height: LOUPE_SIZE}}
			>
				<div className='console-loupe-lens absolute inset-0 overflow-hidden rounded-full bg-black shadow-[0_10px_34px_rgb(0_0_0/0.55),0_0_0_0.5px_rgb(255_255_255/0.5)]'>
					<canvas
						ref={loupeCanvas}
						width={LOUPE_SIZE * LOUPE_PIXEL_RATIO}
						height={LOUPE_SIZE * LOUPE_PIXEL_RATIO}
						className='size-full'
					/>
					<div className='absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.28),inset_0_2px_10px_rgb(0_0_0/0.25)]' />
				</div>
			</div>
		</div>
	)
}
