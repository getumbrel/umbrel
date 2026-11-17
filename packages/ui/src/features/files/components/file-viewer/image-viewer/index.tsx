import {useQuery} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {useViewerSize, ViewerBackdrop, type ViewerSize} from '@/features/files/components/file-viewer/shell/context'
import {StageDownload, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {fileViewUrl, useFileSource} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {RENDERED_IMAGE_TYPES} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'

// Where the picture is read from: the file, or its rendition (see
// RENDERED_IMAGE_TYPES), which has no URL while it's being made and fails if
// it can't be. A file held in memory (an archive's entry) is shown from there,
// as it is: none of the types that need a rendition is opened from memory.
function usePicture(item: FileSystemItem) {
	// The React client, as the listing's thumbnails ask: a request held open
	// while the rendition is made stays out of the pool pictures load through
	const {client: trpc} = trpcReact.useUtils()
	const source = useFileSource()
	const svg = source && item.type === 'image/svg+xml' ? source.blob : undefined
	const svgUrl = useSvgDataUrl(svg)
	const rendered = !source && RENDERED_IMAGE_TYPES.has(item.type)
	const rendition = useQuery({
		// Under the file's revision, as the listing's thumbnails are
		queryKey: ['files-viewer-rendition', item.path, item.modified, item.size],
		queryFn: () => trpc.files.getThumbnail.mutate({path: item.path, variant: 'preview-1280-webp-v2'}),
		enabled: rendered,
		// Addressed by content, its URL never goes stale. One that couldn't be
		// made is asked for again the next time the file is opened.
		staleTime: Infinity,
		retry: false,
		refetchOnWindowFocus: false,
	})
	const url = useAuthorizedHttpUrl(source ? undefined : rendered ? rendition.data : fileViewUrl(item.path))
	if (source) return {url: svg ? svgUrl : source.url, failed: false}
	return {url, failed: rendition.isError}
}

// An SVG held in memory, as a data: URL to show it from. Its object URL is
// never typed as SVG, as a picture must be: that URL has our origin, and an
// SVG opened from it as a page (in a new tab, say) could run script as us. A
// data: URL has no origin of its own, and a browser won't open one as a page.
function useSvgDataUrl(blob: Blob | undefined) {
	const [url, setUrl] = useState<{blob: Blob; url: string}>()
	useEffect(() => {
		if (!blob) return
		const reader = new FileReader()
		reader.onload = () => setUrl({blob, url: reader.result as string})
		reader.readAsDataURL(new Blob([blob], {type: 'image/svg+xml'}))
		return () => reader.abort()
	}, [blob])
	return blob && url?.blob === blob ? url.url : undefined
}

// A finger travels this far sideways, before it travels as far up or down, to take hold of the picture
const SWIPE_SLOP_PX = 8
// Let go this far along, or flicked this fast (px/ms) from a little way along, the picture gives way to the next
const SWIPE_COMMIT_PX = 72
const SWIPE_FLICK_PX = 16
const SWIPE_FLICK_SPEED = 0.35
// The picture that comes in travels this far to its place, the way the last one left
const SWIPE_ARRIVAL_PX = 56
// The way the picture just swiped aside was going (-1 left, 1 right), for the
// one that takes its place: each file has a stage of its own (see ViewerShell)
let swipedAside: {sign: number; at: number} | null = null

// On a touch screen a picture is swiped aside for the one after it in the
// folder, or before it, as pictures are everywhere else: there are no arrow
// keys to step with. The picture follows the finger, and past the last one it
// only gives a little, to say there is nothing further that way. Let go, it
// leaves the way it was going and the next arrives from the other side. The
// listing the viewer was opened from does the stepping (see ViewerStepper),
// so the order is the folder's own.
function useSwipeToStep() {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const stage = ref.current
		if (!stage) return
		const stillness = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
		// `speed` is how fast the finger is going as it goes (px/ms, signed), not its average since it landed
		let swipe: {id: number; x: number; y: number; taken: boolean; lastX: number; lastAt: number; speed: number} | null =
			null
		const move = (x: number, animate: boolean) => {
			stage.style.transition = animate ? 'transform 200ms cubic-bezier(0.215, 0.61, 0.355, 1), opacity 200ms' : ''
			stage.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`
		}
		const stepper = () => useFilesStore.getState().viewerStepper

		// Swiped here: in from the side the last picture didn't leave by
		const arrival = swipedAside
		swipedAside = null
		if (arrival && !stillness && performance.now() - arrival.at < 600) {
			move(-arrival.sign * SWIPE_ARRIVAL_PX, false)
			// Settled at its start before it is sent on its way
			void stage.offsetWidth
			move(0, true)
		}

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'mouse') return
			// A second finger is a pinch, which is the browser's: the picture goes back
			if (swipe) {
				if (swipe.taken) move(0, true)
				swipe = null
				return
			}
			swipe = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				taken: false,
				lastX: event.clientX,
				lastAt: event.timeStamp,
				speed: 0,
			}
		}
		const onPointerMove = (event: PointerEvent) => {
			if (!swipe || event.pointerId !== swipe.id) return
			const dx = event.clientX - swipe.x
			const dy = event.clientY - swipe.y
			const elapsed = event.timeStamp - swipe.lastAt
			if (elapsed > 0) {
				swipe.speed = swipe.speed * 0.4 + ((event.clientX - swipe.lastX) / elapsed) * 0.6
				swipe.lastX = event.clientX
				swipe.lastAt = event.timeStamp
			}
			if (!swipe.taken) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_SLOP_PX) return
				if (Math.abs(dy) >= Math.abs(dx)) {
					swipe = null
					return
				}
				swipe.taken = true
				stage.setPointerCapture(event.pointerId)
			}
			// Nothing that way: the picture gives a third of the finger's travel
			const canStep = stepper()?.canStep(dx < 0 ? 'next' : 'previous') ?? false
			move(canStep ? dx : dx / 3, false)
		}
		const onPointerUp = (event: PointerEvent) => {
			if (!swipe || event.pointerId !== swipe.id) return
			const {taken, x, speed, lastAt} = swipe
			swipe = null
			if (!taken) return
			const dx = event.clientX - x
			const step = dx < 0 ? 'next' : 'previous'
			// A flick is still going the way it went when the finger lifts; one that came to rest first is no flick
			const flicked =
				event.timeStamp - lastAt < 80 && Math.sign(speed) === Math.sign(dx) && Math.abs(speed) > SWIPE_FLICK_SPEED
			const commits = Math.abs(dx) > SWIPE_COMMIT_PX || (Math.abs(dx) > SWIPE_FLICK_PX && flicked)
			if (!commits || !stepper()?.canStep(step)) return move(0, true)
			if (stillness) return stepper()?.step(step)
			// Off the way it was going, then the next picture comes in in its place
			move(Math.sign(dx) * stage.clientWidth, true)
			stage.style.opacity = '0'
			window.setTimeout(() => {
				swipedAside = {sign: Math.sign(dx), at: performance.now()}
				stepper()?.step(step)
				// Still here a moment on, the step was refused: the picture comes back
				window.setTimeout(() => {
					if (!stage.isConnected) return
					swipedAside = null
					stage.style.opacity = ''
					move(0, true)
				}, 120)
			}, 140)
		}
		stage.addEventListener('pointerdown', onPointerDown)
		stage.addEventListener('pointermove', onPointerMove)
		stage.addEventListener('pointerup', onPointerUp)
		stage.addEventListener('pointercancel', onPointerUp)
		return () => {
			stage.removeEventListener('pointerdown', onPointerDown)
			stage.removeEventListener('pointermove', onPointerMove)
			stage.removeEventListener('pointerup', onPointerUp)
			stage.removeEventListener('pointercancel', onPointerUp)
		}
	}, [])
	return ref
}

export default function ImageViewer({item}: ViewerProps) {
	const {t} = useTranslation()
	const {url, failed} = usePicture(item)
	const swipeRef = useSwipeToStep()
	const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
	// The picture's own size, which a quick look takes the shape of
	const [size, setSize] = useState<ViewerSize>()
	useViewerSize(size)

	if (state === 'failed' || failed) {
		return (
			<StageMessage item={item} title={t('files-viewer.error-title')} detail={t('files-viewer.error-detail')}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}

	return (
		<>
			{/* The picture itself, blown up and blurred, is the light around it */}
			{url && state === 'loaded' && (
				<ViewerBackdrop>
					<img
						src={url}
						alt=''
						aria-hidden='true'
						className='absolute inset-0 size-full scale-125 object-cover opacity-50 blur-[72px] motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in'
					/>
				</ViewerBackdrop>
			)}
			{/* Sideways drags are the picture's (see useSwipeToStep); the browser keeps the rest */}
			<div ref={swipeRef} className='relative flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom flex-col'>
				{state === 'loading' && <StageLoading item={item} />}
				{url && (
					// Absolutely placed with auto margins, the element is exactly the
					// picture's fitted box, so the rounded corners land on the picture
					<img
						src={url}
						alt={item.name}
						draggable={false}
						onLoad={(event) => {
							setState('loaded')
							setSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})
						}}
						onError={() => setState('failed')}
						className={cn(
							'absolute inset-x-4 inset-y-0 m-auto max-h-full max-w-[calc(100%-2rem)] rounded-xl object-contain transition-opacity duration-200 md:inset-x-6 md:max-w-[calc(100%-3rem)]',
							state === 'loaded' ? 'opacity-100' : 'opacity-0',
						)}
					/>
				)}
			</div>
		</>
	)
}
