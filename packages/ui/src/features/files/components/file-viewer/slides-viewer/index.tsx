import '@/features/files/components/file-viewer/slides-viewer/slides-viewer.css'

import {NotebookText, Play, Search} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {flushSync} from 'react-dom'
import {useTranslation} from 'react-i18next'
import {RiEditLine} from 'react-icons/ri'

import {
	useViewerDetail,
	useViewerEscape,
	useViewerSave,
	ViewerTools,
} from '@/features/files/components/file-viewer/shell/context'
import {EditHint, nudge} from '@/features/files/components/file-viewer/shell/edit-hint'
import {FindPill} from '@/features/files/components/file-viewer/shell/find-pill'
import {isTyping} from '@/features/files/components/file-viewer/shell/keys'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
	StageNotice,
	useApproximationNotice,
	useShortScreen,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {ToolPill} from '@/features/files/components/file-viewer/shell/tool-button'
import {useFileBytes} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {useAwake, wakesPill} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {
	openPresentation,
	PresentationError,
	type Presentation,
	type PresentationErrorCode,
} from '@/features/files/components/file-viewer/slides-viewer/engine'
import {Filmstrip} from '@/features/files/components/file-viewer/slides-viewer/filmstrip'
import {useSlideFind} from '@/features/files/components/file-viewer/slides-viewer/find'
import {Presenter, visibleFrom} from '@/features/files/components/file-viewer/slides-viewer/presenter'
import {SlidePill, SlideView} from '@/features/files/components/file-viewer/slides-viewer/slide'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {LightboxButton} from '@/features/photos/components/viewer/lightbox-button'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'

// How long the first slide may wait for its fonts before it's shown anyway
const FONT_WAIT_MS = 800
// How far a finger has to travel sideways, or how fast (px/ms), to turn the slide; the dark between a dragged
// slide and its neighbours (as in the Photos lightbox)
const SWIPE = 64
const FLICK = 0.5
const PANE_GAP = 24
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const NOTES_KEY = 'files:slides-notes'

type Opened = {deck: Presentation} | {error: PresentationErrorCode}

export default function SlidesViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const file = useFileBytes(item)
	const readOnly = useIsFilesReadOnly()
	// The bytes are opened once: the deck holds the edits from then on
	const [source, setSource] = useState<{bytes: ArrayBuffer; revision: string | undefined}>()
	if (file.status === 'ready' && !source) setSource({bytes: file.bytes, revision: file.revision})
	const [opened, setOpened] = useState<Opened>()

	useEffect(() => {
		if (!source) return
		let live = true
		let deck: Presentation | undefined
		void (async () => {
			try {
				deck = await openPresentation(new Uint8Array(source.bytes))
				if (!live) return deck.destroy()
				await fontsFor(deck.renderSlide(0))
				if (live) setOpened({deck})
			} catch (error) {
				if (live) setOpened({error: error instanceof PresentationError ? error.code : 'corrupt'})
			}
		})()
		return () => {
			live = false
			deck?.destroy()
		}
	}, [source])

	if (!source && file.status === 'error') {
		const missing = file.error === 'not-found'
		return (
			<StageMessage
				item={item}
				title={t(missing ? 'files-slides.missing-title' : 'files-slides.unreachable-title')}
				detail={t(missing ? 'files-viewer.missing-detail' : 'files-viewer.unreachable-detail')}
			>
				{!missing && (
					<button type='button' className={stageButtonClass} onClick={file.retry}>
						{t('try-again')}
					</button>
				)}
			</StageMessage>
		)
	}
	if (opened && 'error' in opened) {
		const [title, detail] = {
			encrypted: ['files-slides.encrypted-title', 'files-slides.encrypted-detail'],
			// A presentation in the older format can't be opened either, for a reason of its own
			unsupported: ['files-slides.damaged-title', 'files-slides.legacy-detail'],
			limits: ['files-slides.too-large-title', 'files-viewer.too-large-detail'],
			corrupt: ['files-slides.damaged-title', 'files-slides.damaged-detail'],
		}[opened.error]
		return (
			<StageMessage item={item} title={t(title)} detail={t(detail)}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}
	if (!opened || !source) return <StageLoading item={item} />
	return (
		<Deck
			item={item}
			mode={mode}
			deck={opened.deck}
			revision={source.revision}
			editable={mode === 'open' && !readOnly && item.operations.includes('writable')}
		/>
	)
}

function Deck({
	item,
	mode,
	deck,
	revision: openedRevision,
	editable,
}: ViewerProps & {deck: Presentation; revision: string | undefined; editable: boolean}) {
	const {t} = useTranslation()
	const phone = useIsSmallMobile()
	// A phone on its side has no height to spare, and the slide gets all of it: no filmstrip or notice, find over
	// the slide rather than above it, and notes beside it
	const short = useShortScreen()
	const reduceMotion = useReducedMotion() ?? false
	const stageRef = useRef<HTMLDivElement>(null)
	const regionRef = useRef<HTMLDivElement>(null)
	const slideRef = useRef<HTMLDivElement>(null)
	const pillRef = useRef<HTMLDivElement>(null)
	const presenterRef = useRef<HTMLDivElement>(null)
	const findInputRef = useRef<HTMLInputElement>(null)
	const hintRef = useRef<HTMLParagraphElement>(null)
	const region = useContainerSize(regionRef)
	const count = deck.slideCount
	const [current, setCurrent] = useState(0)
	// The slide on stage as drawn, for find to highlight in
	const [drawn, setDrawn] = useState<HTMLElement>()
	// A finger is pulling the slide sideways: its neighbours ride along beside it
	const [dragging, setDragging] = useState(false)
	// A quick look has no toolbar to show or hide them from, so it's the slides alone
	const [notes, setNotes] = useState(() => mode === 'open' && readNotes())
	const [editing, setEditing] = useState(false)
	const [presenting, setPresenting] = useState(false)
	// Bumped for a slide whose text was edited, so its thumb is drawn again once the text is left: on blur, or
	// when the slide changes under the caret (a click on a thumb leaves focus where it is)
	const [versions, setVersions] = useState<Record<number, number>>({})
	const edited = useRef<number>(undefined)
	const settleEdits = () => {
		const index = edited.current
		if (index === undefined) return
		edited.current = undefined
		setVersions((versions) => ({...versions, [index]: (versions[index] ?? 0) + 1}))
	}
	const [revision, setRevision] = useState(openedRevision)
	const [dirty, setDirty] = useState(false)
	// What the file holds as far as the viewer knows, and what it last gave the shell to save, as a token per save
	// (the bytes themselves would be a second whole deck to keep). The engine takes what it saves as its baseline
	// straight away, before the upload has landed, so until it has the edits are unsaved.
	const stored = useRef<object>(undefined)
	const serialized = useRef<object>(undefined)
	const notice = useApproximationNotice(deck.approximated, editable)
	const [awake, wake] = useAwake()
	const swipe = useRef<{id: number; x: number; y: number; t: number; axis?: 'x' | 'y'}>(undefined)
	const find = useSlideFind({deck, slide: current, drawn, setSlide: setCurrent})

	const goTo = (index: number) => {
		wake()
		setCurrent(Math.max(0, Math.min(count - 1, index)))
	}

	const refreshDirty = () => setDirty(deck.isDirty() || serialized.current !== stored.current)
	useViewerSave(
		editable
			? {
					revision,
					serialize: async () => {
						const bytes = await deck.save()
						serialized.current = {}
						return new Blob([bytes as Uint8Array<ArrayBuffer>], {type: item.type})
					},
					onSaved: (saved) => {
						stored.current = serialized.current
						setRevision(saved)
						refreshDirty()
					},
				}
			: null,
		dirty,
	)
	useViewerDetail(t('files-slides.count', {count}))

	const openFind = () => {
		find.show()
		findInputRef.current?.select()
	}
	const closeFind = () => {
		find.close()
		stageRef.current?.focus({preventScroll: true})
	}
	const stopEditing = () => {
		setEditing(false)
		stageRef.current?.focus({preventScroll: true})
	}
	useViewerEscape(() => {
		if (find.open) closeFind()
		else if (editing) stopEditing()
		else return false
		return true
	})

	// What the text won't take (a new paragraph, formatting, a bullet's removal) the engine refuses, and the hint, which
	// says so, answers with a nudge. A paste goes back in as plain text, which is no refusal.
	useEffect(() => {
		const strip = slideRef.current
		if (!strip || !editing) return
		const onBeforeInput = (event: InputEvent) => {
			if (event.defaultPrevented && !event.inputType.startsWith('insertFrom')) nudge(hintRef.current)
		}
		strip.addEventListener('beforeinput', onBeforeInput)
		return () => strip.removeEventListener('beforeinput', onBeforeInput)
	}, [editing])

	// The slideshow goes full screen where the browser lets an element (not iPhone Safari, which has only video),
	// and fills the window otherwise. It's mounted in the click, so the fullscreen request comes inside it.
	const present = () => {
		flushSync(() => setPresenting(true))
		if (document.fullscreenEnabled) presenterRef.current?.requestFullscreen().catch(() => {})
	}
	const endShow = (index: number) => {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
		setPresenting(false)
		goTo(index)
		stageRef.current?.focus({preventScroll: true})
	}

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (presenting || isBeneathModal(stageRef.current, event)) return
			const mod = event.metaKey || event.ctrlKey
			if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
				event.preventDefault()
				openFind()
				return
			}
			if (mod || event.altKey || isTyping(event.target)) return
			const step = stepFor(event, mode)
			if (step === undefined) return
			event.preventDefault()
			goTo(step === 'first' ? 0 : step === 'last' ? count - 1 : current + step)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	// Touch: a sideways drag pulls the slide along with its neighbours beside it (only a little past either end)
	// and, far or fast enough, carries on until the neighbour is in place; short of that, it all slides back. Not
	// while editing, where a drag selects text.
	const {width, height} = deck.slideSize
	const scale = region.width > 0 && region.height > 0 ? Math.min(region.width / width, region.height / height) : 0
	const pitch = width * scale + PANE_GAP
	const slide = (box: HTMLElement, to: number, then: () => void) => {
		const from = box.style.transform
		box.style.transform = to ? `translateX(${to}px)` : ''
		if (reduceMotion) return then()
		box.animate([{transform: from}, {transform: `translateX(${to}px)`}], {duration: 240, easing: EASE_OUT}).onfinish =
			then
	}
	const onPointerDown = (event: React.PointerEvent) => {
		if (wakesPill(event, pillRef.current)) wake()
		// A second finger leaves the first one's drag be
		if (!event.isPrimary) return
		swipe.current =
			event.pointerType === 'touch' && !editing && count > 1 && !slideRef.current?.getAnimations().length
				? {id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp}
				: undefined
	}
	const onPointerMove = (event: React.PointerEvent) => {
		if (wakesPill(event, pillRef.current)) wake()
		const start = swipe.current
		const box = slideRef.current
		if (start?.id !== event.pointerId || !box) return
		const dx = event.clientX - start.x
		const dy = event.clientY - start.y
		if (!start.axis && Math.hypot(dx, dy) > 10) {
			start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
			if (start.axis === 'x') setDragging(true)
		}
		if (start.axis !== 'x') return
		const beyond = (dx > 0 && current === 0) || (dx < 0 && current === count - 1)
		box.style.transform = `translateX(${beyond ? dx / 4 : dx}px)`
	}
	const release = (event: React.PointerEvent, cancelled: boolean) => {
		const start = swipe.current
		const box = slideRef.current
		swipe.current = undefined
		if (start?.id !== event.pointerId || start.axis !== 'x' || !box) return
		const dx = event.clientX - start.x
		const speed = dx / Math.max(1, event.timeStamp - start.t)
		const direction = cancelled ? 0 : dx < -SWIPE || speed < -FLICK ? 1 : dx > SWIPE || speed > FLICK ? -1 : 0
		const target = current + direction
		if (!direction || target < 0 || target >= count) return slide(box, 0, () => setDragging(false))
		// The neighbour, already drawn, becomes the slide on stage where it stands (see the layout effect below)
		slide(box, -direction * pitch, () => goTo(target))
	}
	// The strip is back at rest in the same commit the new slide takes the middle, so nothing jumps; a slide changed
	// some other way mid-swipe (a key, find) ends the swipe
	useLayoutEffect(() => {
		const box = slideRef.current
		if (!box) return
		for (const animation of box.getAnimations()) animation.cancel()
		box.style.transform = ''
		swipe.current = undefined
		setDragging(false)
	}, [current])
	useEffect(settleEdits, [current])

	const showNotes = (show: boolean) => {
		setNotes(show)
		try {
			localStorage.setItem(NOTES_KEY, String(show))
		} catch {
			// The preference just won't stick
		}
	}

	const text = notes ? deck.notes(current) : ''

	return (
		<>
			<ViewerTools>
				<LightboxButton
					icon={Search}
					label={t('files-viewer.find')}
					active={find.open}
					onClick={() => (find.open ? closeFind() : openFind())}
				/>
				<ToolPill active={notes} onClick={() => showNotes(!notes)}>
					<NotebookText className='size-4 opacity-80' />
					{t('files-slides.notes')}
				</ToolPill>
				{editable && (
					<ToolPill active={editing} onClick={() => (editing ? stopEditing() : setEditing(true))}>
						<RiEditLine className='size-4 opacity-80' />
						{t('files-viewer.edit')}
					</ToolPill>
				)}
				<ToolPill onClick={present}>
					<Play className='size-3.5 fill-current opacity-80' />
					{t('files-slides.play')}
				</ToolPill>
			</ViewerTools>

			<div
				ref={stageRef}
				tabIndex={-1}
				className={cn('relative flex min-h-0 flex-1 outline-hidden', short ? 'flex-row' : 'flex-col')}
			>
				{/* While the notice, find or the edit hint is up the slide starts below it, rather than hide its top
				    under it, and grows back once it's gone */}
				<div
					ref={regionRef}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={(event) => release(event, false)}
					onPointerCancel={(event) => release(event, true)}
					className={cn(
						'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pt-1 pb-3 transition-[padding] duration-300 ease-out motion-reduce:transition-none md:px-6',
						!short && cn('has-[[role=status]]:pt-20', find.open && 'pt-20'),
						!editing && 'touch-pan-y',
					)}
				>
					{scale > 0 && (
						<div
							ref={slideRef}
							onInput={() => {
								edited.current = current
								refreshDirty()
								if (drawn) find.refresh(current, drawn)
							}}
							onBlur={settleEdits}
							className='relative shrink-0'
							style={{width: width * scale, height: height * scale}}
						>
							{[current - 1, current, current + 1].map(
								(index) =>
									(index === current || (dragging && index >= 0 && index < count)) && (
										<div
											key={index}
											inert={index !== current}
											className={cn(
												'absolute top-0 rounded-12 shadow-[0_8px_30px_rgb(0_0_0/0.35)] ring-1 ring-white/5',
												// Its words can be selected and copied (the app selects nothing by default),
												// which is also what WebKit needs to paint find's highlights
												index === current && 'select-text',
												index === current && editing && 'umbrel-slide-editing',
											)}
											style={{left: (index - current) * pitch}}
										>
											<SlideView
												deck={deck}
												index={index}
												scale={scale}
												editable={index === current && editing}
												onDrawn={index === current ? setDrawn : undefined}
												className='rounded-12'
											/>
										</div>
									),
							)}
						</div>
					)}
					{count > 1 && (
						<SlidePill
							pillRef={pillRef}
							index={current}
							count={count}
							hidden={deck.isHidden(current)}
							awake={awake}
							canStep={(direction) => current + direction >= 0 && current + direction < count}
							onStep={(direction) => goTo(current + direction)}
						/>
					)}
					{find.open && (
						<FindPill
							inputRef={findInputRef}
							query={find.query}
							onQuery={find.search}
							current={find.current}
							total={find.total}
							searching={find.searching}
							onNext={() => find.step(1)}
							onPrevious={() => find.step(-1)}
							onClose={closeFind}
						/>
					)}
					{/* Find takes the top while it's open, and the edit hint while editing. A phone on its side shows
					    neither the notice nor the hint: with no room above the slide, they'd sit on its title. */}
					{notice && (
						<div hidden={find.open || editing || short}>
							<StageNotice>{notice}</StageNotice>
						</div>
					)}
					{editing && !find.open && !short && <EditHint ref={hintRef} />}
				</div>

				{notes && (
					<section
						aria-label={t('files-slides.notes')}
						className={cn(
							'shrink-0 overflow-y-auto overscroll-contain motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in',
							short
								? 'settings-edge-material mr-4 mb-3 w-[min(40%,20rem)] rounded-20 bg-black/25 px-5 py-4 motion-safe:slide-in-from-right-2'
								: phone
									? 'h-[45%] rounded-t-20 border-t border-white/8 bg-black/40 px-5 pt-4 pb-6 backdrop-blur-xl motion-safe:slide-in-from-bottom-4'
									: 'settings-edge-material mx-auto mb-3 h-[min(24%,180px)] w-[calc(100%-3rem)] rounded-20 bg-black/25 px-5 py-4 motion-safe:slide-in-from-bottom-2',
						)}
						style={short || phone ? undefined : {maxWidth: Math.max(480, width * scale)}}
					>
						{text ? (
							<p className='text-14 leading-relaxed break-words whitespace-pre-wrap text-white/80'>{text}</p>
						) : (
							<p className='flex h-full items-center justify-center text-13 text-white/35'>
								{t('files-slides.no-notes')}
							</p>
						)}
					</section>
				)}

				{count > 1 && !short && !(phone && notes) && (
					<div className='shrink-0 px-4 pb-1 md:px-6'>
						<Filmstrip deck={deck} current={current} versions={versions} compact={phone} onSelect={goTo} />
					</div>
				)}
			</div>

			{presenting && (
				<Presenter
					ref={presenterRef}
					deck={deck}
					start={
						deck.isHidden(current)
							? (visibleFrom(deck, current, 1) ?? visibleFrom(deck, current, -1) ?? current)
							: current
					}
					onExit={endShow}
				/>
			)}
		</>
	)
}

// The keys that turn slides. The arrows and Space only when the file is opened: in a quick look the arrows step
// through files and Space closes it.
function stepFor(event: KeyboardEvent, mode: ViewerProps['mode']): 1 | -1 | 'first' | 'last' | undefined {
	switch (event.key) {
		case 'PageDown':
			return 1
		case 'PageUp':
			return -1
		case 'Home':
			return 'first'
		case 'End':
			return 'last'
	}
	if (mode !== 'open') return undefined
	if (event.key === ' ') {
		// A button focused from the keyboard is pressed with Space
		const control = event.target instanceof Element && event.target.closest('button, a')
		return control ? undefined : event.shiftKey ? -1 : 1
	}
	if (event.shiftKey) return undefined
	if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return 1
	if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return -1
	return undefined
}

function readNotes() {
	try {
		return localStorage.getItem(NOTES_KEY) === 'true'
	} catch {
		return false
	}
}

// Text drawn before its faces arrive is set in a fallback face and reflows when they land, so the first slide
// waits for the faces it uses (Umbrel's own Carlito and Caladea, or the device's), for a moment at most
async function fontsFor(slide: HTMLElement) {
	if (!('fonts' in document)) return
	const texts = new Map<string, string>()
	for (const node of slide.querySelectorAll<HTMLElement>('*')) {
		let text = ''
		for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) text += child.textContent
		if (!text.trim()) continue
		const {fontStyle, fontWeight, fontFamily} = node.style
		const font = `${fontStyle || 'normal'} ${fontWeight || '400'} 16px ${fontFamily || 'sans-serif'}`
		texts.set(font, (texts.get(font) ?? '') + text)
	}
	const loads = [...texts].map(([font, text]) => document.fonts.load(font, text))
	await Promise.race([Promise.allSettled(loads), new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))])
}
