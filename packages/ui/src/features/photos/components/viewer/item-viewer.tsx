import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Album, ChevronLeft, ChevronRight, Download, Heart, Info, RotateCcw, Trash2, X} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useParams} from 'react-router-dom'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {preventDialogDismissForToasts} from '@/components/ui/shared/dialog'
import {toast} from '@/components/ui/toast'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useRouteFilter} from '@/features/photos/components/listing'
import {usePhotosView} from '@/features/photos/components/view-context'
import {Filmstrip} from '@/features/photos/components/viewer/filmstrip'
import {InfoPanel} from '@/features/photos/components/viewer/info-panel'
import {LightboxButton, lightboxButtonClass} from '@/features/photos/components/viewer/lightbox-button'
import {LivePhoto} from '@/features/photos/components/viewer/live-photo'
import {useNeighborPrefetch} from '@/features/photos/components/viewer/neighbor-prefetch'
import {usePictureFlight} from '@/features/photos/components/viewer/picture-flight'
import {useSeedRenditions} from '@/features/photos/components/viewer/seed-rendition'
import {PANE_GAP, useStageGestures} from '@/features/photos/components/viewer/stage-gestures'
import {
	itemOriginalUrl,
	itemThumbnailUrl,
	useItem,
	useItemActions,
	useItemNeighbors,
	useItems,
	type Item,
	type ThumbSize,
} from '@/features/photos/hooks/use-items'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {takenAtClock} from '@/features/photos/utils/taken-at'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {useDialogOpenProps} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'
import {tw} from '@/utils/tw'

// Filmstrip mode, to isolate its cost while tuning: 'off' hides it, 'static'
// drops the hover growth, 'grow' is the full effect. Override per browser
// with localStorage.setItem('photos:filmstrip', 'static').
type FilmstripMode = 'off' | 'static' | 'grow'
const FILMSTRIP_MODE: FilmstripMode = (() => {
	try {
		const stored = localStorage.getItem('photos:filmstrip')
		return stored === 'off' || stored === 'static' || stored === 'grow' ? stored : 'grow'
	} catch {
		return 'grow'
	}
})()

// Whether the inspector opens with the lightbox, remembered across sessions —
// a desktop preference (the phone sheet covers the picture, so it never opens
// itself). Told true it opens for everything, told false for nothing, and
// until the user has said either way it opens for photos only: info suits a
// still, a video wants the stage to itself. A hand on the panel — the toolbar
// button, `i`, its close button — is what says; closing the lightbox says
// nothing.
const INFO_OPEN_KEY = 'photos:info-open'
const readInfoOpen = (): boolean | undefined => {
	try {
		const stored = localStorage.getItem(INFO_OPEN_KEY)
		return stored === 'true' ? true : stored === 'false' ? false : undefined
	} catch {
		return undefined
	}
}
const writeInfoOpen = (open: boolean) => {
	try {
		localStorage.setItem(INFO_OPEN_KEY, String(open))
	} catch {
		// The preference just won't stick
	}
}

// How the lightbox opens: the picture takes off from its tile (see
// usePictureFlight) over a backdrop fading up beneath it, and a beat later
// the chrome — title, actions, filmstrip — rises in from the edge it lives
// at. Closing runs it backwards, the chrome leaving first. Stepping between
// items animates nothing: only the picture's source changes.
const CHROME_DELAY = tw`motion-safe:[animation-delay:120ms]`
const chromeEnter = {
	top: tw`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-250 motion-safe:fill-mode-both`,
	bottom: tw`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-250 motion-safe:fill-mode-both`,
	// The inspector's arrival, when a session opens with it: chrome like the
	// rest, rising from the edge it docks at. Transform and opacity only — its
	// box is reserved from the first commit (the flight measures the stage
	// against it), so the entrance may never move the layout. Backwards fill,
	// not both: a forwards fill would keep the finished animation owning
	// transform, and the hand-toggle's slide beneath it would never move.
	right: tw`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-250 motion-safe:fill-mode-backwards`,
}
const chromeLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-150 motion-safe:fill-mode-forwards`
const backdropEnter = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:fill-mode-both`
const backdropLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-250 motion-safe:fill-mode-forwards`
// Long enough for the chrome and backdrop to be gone (the picture's own flight is awaited)
const LEAVE_MS = 260
// How long the eye must rest on an item before its original is asked for:
// under a held-down arrow key or a flick along the strip, ids fly past faster
// than this, and a browser finishes an image download even after the element
// that asked is gone — so each flown-over item must not cost one
const REST_MS = 150
// The inspector: docked beside the picture on desktop, a sheet over it on phones
const INSPECTOR_WIDTH = 340
// The stage's side margin on desktop (`md:mx-6`), which the dock takes over
// so the inspector slides in from the edge of the window, not the stage's
const STAGE_MARGIN = 24

// The lightbox. Shares the timeline's item query, so the filmstrip and ←/→
// walk the same list the user was looking at and extend it page by page;
// when the item isn't in that list (a deep link), neighbours come from the API.
export function ItemViewer() {
	const dialogProps = useDialogOpenProps('photos-item')
	const {params, add} = useQueryParams()
	const id = params.get('photos-item-id') ?? undefined
	const {t, i18n} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const filter = useRouteFilter()
	const inDeleted = filter.deleted === true
	const confirm = useConfirmation()
	const {items, hasMore, loadMore} = useItems(filter, {enabled: dialogProps.open})
	const {data: item} = useItem(id, inDeleted)
	const index = items.findIndex((candidate) => candidate.id === id)
	const {data: apiNeighbors} = useItemNeighbors(index === -1 ? id : undefined, filter)
	const prevId = index > 0 ? items[index - 1]!.id : apiNeighbors?.prevId
	const nextId = index >= 0 && index < items.length - 1 ? items[index + 1]!.id : apiNeighbors?.nextId
	const {setFavorite, deleteItems, restoreItems, deletePermanently} = useItemActions()
	const {addToAlbum, removeFromAlbum} = useAlbumActions()
	// The album page the lightbox was opened from, if any — from the route,
	// not the filter (a search token also fills the filter's albumIds)
	const routeAlbumId = useParams().albumId
	// Where else the item could go: any album but the one being looked at
	const otherAlbums = useAlbums().data?.filter((album) => album.id !== routeAlbumId)
	const isMobile = useIsMobile()
	const [showInfo, setShowInfo] = useState(false)
	// … and is only built once it has been asked for in this session
	const [infoUsed, setInfoUsed] = useState(false)
	if (showInfo && !infoUsed) setInfoUsed(true)
	// Opening or closing the inspector by hand is the preference the next
	// session opens under (see readInfoOpen)
	const setInfoByHand = useCallback(
		(open: boolean) => {
			if (!isMobile) writeInfoOpen(open)
			setShowInfo(open)
		},
		[isMobile],
	)

	// What the picture is: the list's item the moment the lightbox opens, the
	// fetched detail otherwise
	const shown = items[index] ?? item
	const isVideo = shown?.kind === 'video'
	// The inspector stays open while stepping through items; whether a session
	// starts with it is decided once per open, and in render so the first
	// commit already holds the panel — the flight must measure a stage of its
	// final width. The remembered preference answers by itself; unset, the
	// default depends on what is being looked at, so a cold deep link decides
	// only once the item is known (and the panel slides in after the fact).
	const [infoDecided, setInfoDecided] = useState(false)
	// … and whether this session arrived with it: the arrival plays the
	// chrome's entrance (see chromeEnter.right), which belongs to the
	// lightbox's own opening — a later hand-open slides instead
	const [openedWithInfo, setOpenedWithInfo] = useState(false)
	if (!dialogProps.open) {
		if (infoDecided) setInfoDecided(false)
		if (openedWithInfo) setOpenedWithInfo(false)
		if (showInfo) setShowInfo(false)
		if (infoUsed) setInfoUsed(false)
	} else if (!infoDecided) {
		const stored = readInfoOpen()
		if (stored !== undefined || shown) {
			setInfoDecided(true)
			if (!isMobile && (stored ?? shown!.kind !== 'video')) {
				setShowInfo(true)
				setOpenedWithInfo(true)
			}
		}
	}
	const {grid} = usePhotosView()
	// Every URL is derived from the id (CONTRACT.md). The stage rests on the
	// 1280 rendition — the true original is only ever downloaded, and videos
	// stream it through the player (range requests).
	const restingUrl = useAuthorizedHttpUrl(id ? itemThumbnailUrl(id, 1280) : undefined)
	const videoUrl = useAuthorizedHttpUrl(id && isVideo ? itemOriginalUrl(id) : undefined)
	const downloadUrl = useAuthorizedHttpUrl(id ? itemOriginalUrl(id, {download: true}) : undefined)
	// The seed — the rendition the item's tile has on screen, already decoded,
	// else the 192 (see useSeedRenditions) — is what flies in, sits under the
	// resting image until that has loaded and, blown up and blurred, is the
	// backdrop. It is never traded for a finer thumbnail on the way: the wire
	// is the 1280's.
	const seedFor = useSeedRenditions(dialogProps.open)
	const thumbnailUrl = useSharedAuthorizedHttpUrl(
		dialogProps.open && id ? itemThumbnailUrl(id, seedFor(id)) : undefined,
	)
	// The item whose resting image has arrived, so the thumbnail can give way to it
	const [loadedId, setLoadedId] = useState<string>()

	// Swapping the id in place keeps one history entry per lightbox session
	const goTo = useCallback((target?: string) => target && add('photos-item-id', target, {replace: true}), [add])

	// Opening and closing: the picture flies, everything else follows `closing`
	const flight = usePictureFlight({
		open: dialogProps.open,
		id,
		reduceMotion,
		tileRect: grid?.tileRect,
		liftTile: grid?.liftTile,
	})

	// The picture's shape is the thumbnail's bitmap — what is actually drawn,
	// so it holds even where stored dimensions and rendered pixels disagree
	// (EXIF-rotated photos). A decoded thumbnail — the seed is the tile's own —
	// answers before paint, so the flight is measured on the right frame; an
	// item whose thumbnail can't be served (a broken file) is measured from the
	// resting rendition instead.
	// The measurement belongs to its URL: the opening flight waits for the
	// right one, while stepping keeps the last shape until the next is known.
	// A future optimization can seed the shape from the indexed
	// `shown.width / shown.height`; the bitmap remains the final word.
	const [measureFallback, setMeasureFallback] = useState(false)
	useEffect(() => setMeasureFallback(false), [id])
	const measureUrl = measureFallback ? restingUrl : thumbnailUrl
	const [measured, setMeasured] = useState<{url: string; aspect: number}>()
	useLayoutEffect(() => {
		if (!measureUrl) return
		const image = new Image()
		image.src = measureUrl
		const measure = () =>
			image.naturalWidth > 0 && setMeasured({url: measureUrl, aspect: image.naturalWidth / image.naturalHeight})
		const fail = () => setMeasureFallback(true)
		if (image.complete) {
			if (image.naturalWidth > 0) measure()
			else fail()
		} else {
			image.onload = measure
			image.onerror = fail
		}
		return () => {
			image.onload = null
			image.onerror = null
		}
	}, [measureUrl])
	const aspect = measured && (measured.url === measureUrl || flight.arrived) ? measured.aspect : undefined
	const [closing, setClosing] = useState(false)
	const closingRef = useRef(false)
	// The inspector dock's box, pinned for the length of the close. The flight
	// home is measured once against the stage as it stands when the close
	// begins, so the stage must not move under it — but hiding the panel
	// collapses the dock and re-centres the stage mid-flight, and the picture
	// lands half the panel's width from its tile. Pinned, the panel slides out
	// within a frozen box (a transform, no layout) and the stage reclaims the
	// space only when the lightbox unmounts. Measured rather than assumed
	// open-width, so a close that catches the dock mid-slide freezes it where
	// the flight saw it.
	const asideRef = useRef<HTMLElement | null>(null)
	const [closingAside, setClosingAside] = useState<{width: number; marginLeft: number} | null>(null)
	// `from` is a drag-to-dismiss's final transform, for the flight to carry
	// on from the finger (see useStageGestures)
	const close = async (from?: string) => {
		if (closingRef.current) return
		closingRef.current = true
		const aside = asideRef.current
		if (aside)
			setClosingAside({
				width: aside.getBoundingClientRect().width,
				marginLeft: parseFloat(getComputedStyle(aside).marginLeft) || 0,
			})
		setClosing(true)
		setShowInfo(false)
		// Stepping may have walked far from the tile the lightbox opened on:
		// the timeline catches up behind the backdrop, so the user is left at
		// the item they were looking at — and the picture has a tile to fly to
		if (id) grid?.revealTile(id)
		await Promise.all([flight.back(from), new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : LEAVE_MS))])
		dialogProps.onOpenChange(false)
		setClosing(false)
		setClosingAside(null)
		closingRef.current = false
	}

	// Touch drives the stage directly: a horizontal drag steps, a downward
	// one dismisses (the timeline having already caught up, so the backdrop
	// clears to the right place and the picture lands on its tile)
	const isTouch = useIsTouchDevice()
	const pictureRef = useRef<HTMLElement | null>(null)
	const setPictureEl = useCallback(
		(el: HTMLDivElement | null) => {
			pictureRef.current = el
			flight.ref(el)
		},
		[flight.ref],
	)
	// The neighbours' panes for a horizontal swipe: they ride one stage-width
	// to each side of the picture, so the next item slides in with the finger
	// (iOS-style) rather than appearing once the swipe has landed
	const peekRefs = {prev: useRef<HTMLElement | null>(null), next: useRef<HTMLElement | null>(null)}
	const peekPrev = usePeek(isTouch && dialogProps.open && index > 0 ? items[index - 1] : undefined, seedFor)
	const peekNext = usePeek(isTouch && dialogProps.open && index >= 0 ? items[index + 1] : undefined, seedFor)
	const gestures = useStageGestures({
		open: dialogProps.open,
		enabled: isTouch && dialogProps.open && !closing && flight.arrived,
		pictureRef,
		peekRefs,
		shownId: id,
		canStep: (dir) => !!(dir === 1 ? nextId : prevId),
		onStep: (dir) => goTo(dir === 1 ? nextId : prevId),
		onDismissStart: () => {
			if (id) grid?.revealTile(id)
		},
		onDismiss: (from) => void close(from),
	})

	// Keep the filmstrip fed when the item sits near the end of what's loaded
	useEffect(() => {
		if (hasMore && index >= 0 && index >= items.length - 2) loadMore()
	}, [hasMore, index, items.length, loadMore])

	// Decode the neighbours' seeds while the user looks at this one, so ←/→ is
	// instant (usually a cache hit: the tile or the filmstrip already has them)
	const neighborSeedUrl = (neighbor: Item | undefined) =>
		dialogProps.open && neighbor && neighbor.kind !== 'video'
			? itemThumbnailUrl(neighbor.id, seedFor(neighbor.id))
			: undefined
	const prevUrl = useSharedAuthorizedHttpUrl(neighborSeedUrl(index > 0 ? items[index - 1] : undefined))
	const nextUrl = useSharedAuthorizedHttpUrl(neighborSeedUrl(index >= 0 ? items[index + 1] : undefined))
	useEffect(() => {
		if (!dialogProps.open) return
		const handle = setTimeout(() => {
			for (const url of [nextUrl, prevUrl]) if (url) new Image().src = url
		}, 300)
		return () => clearTimeout(handle)
	}, [dialogProps.open, prevUrl, nextUrl])

	// … and once this one's resting image is up, theirs too (stills only), so
	// the step lands full-size (see useNeighborPrefetch)
	const {warm} = useNeighborPrefetch({
		open: dialogProps.open,
		settled: flight.arrived && (isVideo || (!!id && loadedId === id)),
		currentId: id,
		prevId,
		nextId,
		deleted: inDeleted,
		infoShowing: showInfo,
	})

	// The id that has been looked at for a beat (REST_MS): the stage requests
	// an original — or mounts an autoplaying player — only for this one, so
	// flying along the strip runs on thumbnails alone. A prefetched neighbour
	// bypasses the rest (`warm`): its bytes are already here, show them at once.
	const [restedId, setRestedId] = useState<string>()
	useEffect(() => {
		const handle = setTimeout(() => setRestedId(id), REST_MS)
		return () => clearTimeout(handle)
	}, [id])

	useEffect(() => {
		if (!dialogProps.open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
			if (e.key === 'ArrowLeft') goTo(prevId)
			else if (e.key === 'ArrowRight') goTo(nextId)
			else if (e.key === 'i') setInfoByHand(!showInfo)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [dialogProps.open, prevId, nextId, goTo, showInfo, setInfoByHand])

	// The item leaves this list: move on to a neighbour, or close
	const mutationFailed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})
	const leaveList = async (action: Promise<unknown>) => {
		const target = nextId ?? prevId
		try {
			await action
		} catch {
			mutationFailed()
			return
		}
		if (target) goTo(target)
		else void close()
	}
	const handleDelete = () => item && leaveList(deleteItems({ids: [item.id]}))
	const handleRestore = () => item && leaveList(restoreItems({ids: [item.id]}))
	const handlePurge = async () => {
		if (!item) return
		const formattedCount = formatNumberI18n({n: 1, showDecimals: false, locale: i18n.language})
		const ok = await confirm({
			title: t('photos-selection.delete-permanently-title', {count: 1, formattedCount}),
			message: t('photos-selection.delete-permanently-message', {count: 1}),
			actions: [
				{label: t('photos-item.delete-permanently'), value: 'delete', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).then(
			(result) => result.actionValue === 'delete',
			() => false,
		)
		if (ok) await leaveList(deletePermanently({ids: [item.id]}))
	}
	const handleRemoveFromAlbum = () =>
		item && routeAlbumId && leaveList(removeFromAlbum({id: routeAlbumId, ids: [item.id]}))

	// From the list's item rather than the fetched detail, so a step shows the
	// new date in the same frame as the new picture — at the wall clock the
	// photo was taken by, when its file carried the offset
	const takenOn = shown
		? (() => {
				const clock = takenAtClock(shown.takenAt, shown.takenAtOffsetMinutes)
				return clock.date.toLocaleDateString(i18n.language, {
					weekday: 'short',
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: clock.timeZone,
				})
			})()
		: ''
	// While a dismissal is being dragged the chrome steps aside, and comes
	// back if the drag lets go short of the threshold
	const chrome = (edge: 'top' | 'bottom') =>
		cn(
			closing ? chromeLeave : cn(chromeEnter[edge], CHROME_DELAY),
			'transition-opacity duration-200',
			gestures.dismissing && 'opacity-0',
		)

	const actions = (
		<div className='flex shrink-0 items-center gap-1'>
			{inDeleted ? (
				<>
					<LightboxButton icon={RotateCcw} label={t('photos-item.restore')} disabled={!item} onClick={handleRestore} />
					<LightboxButton
						icon={Trash2}
						label={t('photos-item.delete-permanently')}
						disabled={!item}
						onClick={() => void handlePurge()}
					/>
				</>
			) : (
				<>
					<LightboxButton
						icon={Heart}
						label={item?.isFavorite ? t('photos-item.unfavorite') : t('photos-item.favorite')}
						className={cn(item?.isFavorite && 'text-white [&>svg]:fill-current')}
						disabled={!item}
						onClick={() => item && setFavorite({ids: [item.id], favorite: !item.isFavorite}).catch(mutationFailed)}
					/>
					<DropdownMenu>
						{/* Tooltip and menu triggers compose onto one real button via asChild */}
						<DarkTooltip label={t('photos-item.add-to-album')} side='bottom'>
							<DropdownMenuTrigger asChild>
								<button
									type='button'
									aria-label={t('photos-item.add-to-album')}
									disabled={!item || (!otherAlbums?.length && !routeAlbumId)}
									className={lightboxButtonClass}
								>
									<Album className='size-5' />
								</button>
							</DropdownMenuTrigger>
						</DarkTooltip>
						<DropdownMenuContent align='end'>
							{routeAlbumId && (
								<>
									<DropdownMenuItem onSelect={handleRemoveFromAlbum}>
										{t('photos-item.remove-from-album')}
									</DropdownMenuItem>
									{otherAlbums && otherAlbums.length > 0 && <DropdownMenuSeparator />}
								</>
							)}
							{otherAlbums?.map((album) => (
								<DropdownMenuItem
									key={album.id}
									onSelect={() => item && addToAlbum({id: album.id, ids: [item.id]}).catch(mutationFailed)}
								>
									{album.name}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					{downloadUrl ? (
						<DarkTooltip label={t('photos-item.download')} side='bottom'>
							<a
								href={downloadUrl}
								download={item?.fileName}
								aria-label={t('photos-item.download')}
								title={t('photos-item.download')}
								className={lightboxButtonClass}
							>
								<Download className='size-5' />
							</a>
						</DarkTooltip>
					) : (
						<LightboxButton icon={Download} label={t('photos-item.download')} disabled />
					)}
					<LightboxButton icon={Trash2} label={t('photos-item.delete')} disabled={!item} onClick={handleDelete} />
				</>
			)}
			<LightboxButton
				icon={Info}
				label={t('photos-item.info')}
				active={showInfo}
				onClick={() => setInfoByHand(!showInfo)}
			/>
			<LightboxButton icon={X} label={t('close')} onClick={() => void close()} />
		</div>
	)

	return (
		<DialogPrimitive.Root
			open={dialogProps.open}
			onOpenChange={(open) => (open ? dialogProps.onOpenChange(true) : void close())}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className='fixed inset-0 z-50' />
				{/* No animation of its own (see the flight): the layers inside make their own entrances */}
				<DialogPrimitive.Content
					onOpenAutoFocus={(e) => e.preventDefault()}
					onPointerDownOutside={preventDialogDismissForToasts}
					className='fixed inset-0 z-50 h-dvh w-screen outline-hidden'
				>
					<DialogPrimitive.Title className='sr-only'>
						{item?.fileName ?? t('photos-item.viewer-title')}
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className='sr-only'>{takenOn}</DialogPrimitive.Description>

					{/* Backdrop: the item, blown out and darkened, over the dark base.
					    Clipped in its own box so the scale-up never becomes scrollable
					    overflow of the dialog. */}
					<div
						ref={gestures.backdropRef}
						className={cn(
							'pointer-events-none absolute inset-0 overflow-clip bg-neutral-950',
							closing ? backdropLeave : backdropEnter,
						)}
					>
						{thumbnailUrl && !isVideo && (
							<img
								src={thumbnailUrl}
								alt=''
								aria-hidden='true'
								draggable={false}
								className='absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-[72px] motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in'
							/>
						)}
						<div className='absolute inset-0 bg-black/45' />
					</div>

					<div className='relative flex h-full flex-col'>
						{/* Chrome */}
						<header className='flex items-start justify-between gap-4 px-4 pt-4 md:px-6 md:pt-5'>
							{/* The lines keep their boxes while a step's detail (the file name)
							    is still on its way: the stage below is sized from what's left,
							    so a collapsing header would resize the picture mid-swipe */}
							<div className={cn('min-w-0', chrome('top'))}>
								<p className='min-h-[1lh] truncate text-15 font-semibold -tracking-2 text-white/95'>{takenOn}</p>
								<p className='min-h-[1lh] truncate text-12 text-white/50'>{item?.fileName}</p>
							</div>
							{/* Desktop: actions ride the header's right edge */}
							<div className={cn('hidden md:block', chrome('top'))}>{actions}</div>
						</header>

						{/* Stage: the picture, fitted by CSS (a size container, so it can be
						    sized from the stage's height), and the inspector docked beside
						    it on desktop — the picture makes room as it slides in */}
						<main className='relative mx-4 mt-3 flex min-h-0 flex-1 md:mx-6'>
							<div
								className={cn(
									'group [container-type:size] relative flex min-w-0 flex-1 items-center justify-center',
									isTouch && 'touch-none',
								)}
								{...gestures.handlers}
							>
								{shown && aspect === undefined && <TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />}
								{shown && aspect !== undefined && (
									<div
										ref={setPictureEl}
										className='relative max-h-full [transform-origin:0_0] overflow-hidden rounded-xl bg-black/40'
										style={{width: `min(100%, calc(100cqh * ${aspect}))`, aspectRatio: aspect}}
									>
										{thumbnailUrl && (
											<img
												src={thumbnailUrl}
												alt=''
												aria-hidden='true'
												draggable={false}
												className='absolute inset-0 h-full w-full object-cover'
											/>
										)}
										{/* The resting image only once the picture is in place — decoding a
											    full-size image would stall the flight, and a player would
											    paint black over the flying thumbnail and start playing —
											    and only once the item is rested on or prefetched (REST_MS).
											    The same goes for the flight home: the picture leaves as the
											    resting image when that is what was being looked at, and as
											    the seed it flew in on when that never arrived — one still
											    loading is let go rather than left to land mid-flight. */}
										{item &&
											flight.arrived &&
											(restedId === item.id || warm(item.id)) &&
											(isVideo ? (
												videoUrl && (
													<video
														key={item.id}
														src={videoUrl}
														poster={thumbnailUrl}
														controls
														autoPlay
														playsInline
														className='absolute inset-0 h-full w-full'
													/>
												)
											) : restingUrl && (!closing || loadedId === item.id) ? (
												<img
													key={item.id}
													src={restingUrl}
													alt={item.fileName}
													draggable={false}
													fetchPriority='high'
													decoding='async'
													onLoad={() => setLoadedId(item.id)}
													className={cn(
														'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
														loadedId === item.id ? 'opacity-100' : 'opacity-0',
													)}
												/>
											) : null)}
										{/* A live photo's motion clip and LIVE chip (see LivePhoto). Gated on
										    the rest alone — never `warm`, which only means a neighbouring
										    still was prefetched, while mounting this starts a video download.
										    Gone the moment the close begins: the picture flies home as the
										    still it will land as. */}
										{item && item.subKind === 'live' && flight.arrived && restedId === item.id && !closing && (
											<LivePhoto id={item.id} autoPlay={!reduceMotion} />
										)}
									</div>
								)}
								{/* A horizontal swipe's neighbours, mounted only while the strip
								    is being dragged: each pane sits one stage-width to its side
								    and follows the finger with the picture (stage-gestures) */}
								{gestures.stepping && peekPrev && <PeekPane ref={peekRefs.prev} side={-1} picture={peekPrev} />}
								{gestures.stepping && peekNext && <PeekPane ref={peekRefs.next} side={1} picture={peekNext} />}
								{/* Touch steps by swiping; the arrows are the pointer's (and would
								    be an invisible tap target at each edge) */}
								{!isTouch && (
									<>
										<StageArrow
											side='left'
											label={t('photos-item.previous')}
											disabled={!prevId}
											onClick={() => goTo(prevId)}
										/>
										<StageArrow
											side='right'
											label={t('photos-item.next')}
											disabled={!nextId}
											onClick={() => goTo(nextId)}
										/>
									</>
								)}
							</div>
							{/* Desktop: the inspector docks at the window's edge — the dock takes the
							    stage's margin as its own padding, so the panel slides in from the
							    edge of the screen; closed, it is exactly that margin, so the stage
							    stays centred. While the lightbox is closing the dock's box is
							    pinned (see closingAside) so the stage holds still under the
							    picture's flight home; the panel still slides out within it. */}
							{!isMobile && (
								<aside
									ref={asideRef}
									inert={!showInfo}
									className={cn(
										'-mr-6 shrink-0 overflow-hidden',
										closingAside
											? 'transition-none'
											: 'transition-[width,margin-left] duration-300 ease-out motion-reduce:transition-none',
										!closingAside && (showInfo ? 'ml-4' : 'ml-0'),
									)}
									style={closingAside ?? {width: showInfo ? INSPECTOR_WIDTH + STAGE_MARGIN : STAGE_MARGIN}}
								>
									<div
										className={cn(
											'h-full pr-6 transition-transform duration-300 ease-out motion-reduce:transition-none',
											showInfo ? 'translate-x-0' : 'translate-x-full',
											// The arrival plays once, with the chrome, in sessions
											// that open with the panel; a hand-toggle slides on the
											// transition above, and the close slides the panel out
											// the same way (within the pinned dock, see closingAside)
											!closing && openedWithInfo && cn(chromeEnter.right, CHROME_DELAY),
										)}
										style={{width: INSPECTOR_WIDTH + STAGE_MARGIN}}
									>
										{item && infoUsed && <InfoPanel item={item} onClose={() => setInfoByHand(false)} />}
									</div>
								</aside>
							)}
						</main>

						{/* Filmstrip */}
						{FILMSTRIP_MODE === 'off' ? (
							<footer className='h-4' />
						) : (
							<footer className={cn('pointer-events-none -mt-6 pt-2 pb-2', chrome('bottom'))}>
								{/* The strip box keeps 32px of headroom for the hover growth (and its ring);
								    pulling it up by 24px keeps the visible thumb-to-stage gap at 16px, same as the edge.
								    That overlap sits over the stage — exactly where a height-constrained video draws
								    its seek bar — so the footer must not catch hits; the strip re-enables them over
								    its visible band (see Filmstrip) */}
								{id && items.length > 0 ? (
									<Filmstrip
										items={items}
										currentId={id}
										hasMore={hasMore}
										loadMore={loadMore}
										onSelect={goTo}
										grow={FILMSTRIP_MODE === 'grow'}
									/>
								) : (
									<div className='h-20' />
								)}
							</footer>
						)}

						{/* Phones: the actions are a toolbar under the strip (whose headroom
						    would otherwise sit over them) */}
						<div className={cn('flex justify-center pb-3 md:hidden', chrome('bottom'))}>{actions}</div>

						{/* Phones: the inspector is a sheet over everything */}
						{isMobile && (
							<div
								inert={!showInfo}
								className={cn(
									'absolute inset-x-0 bottom-0 z-20 h-[75%] transition-transform duration-300 ease-out motion-reduce:transition-none',
									showInfo ? 'translate-y-0' : 'translate-y-full',
								)}
							>
								{item && infoUsed && <InfoPanel item={item} onClose={() => setInfoByHand(false)} sheet />}
							</div>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}

// A neighbour's picture, ready for the swipe: its seed — the very rendition
// the stage will show once the swipe lands, usually already decoded for the
// ←/→ warm-up — and the shape of that bitmap, so its pane can be fitted
// exactly the way the stage fits the current picture
function usePeek(item: Item | undefined, seedFor: (id: string) => ThumbSize) {
	const url = useSharedAuthorizedHttpUrl(item ? itemThumbnailUrl(item.id, seedFor(item.id)) : undefined)
	const [measured, setMeasured] = useState<{url: string; aspect: number}>()
	useLayoutEffect(() => {
		if (!url) return
		const image = new Image()
		image.src = url
		const measure = () => image.naturalWidth > 0 && setMeasured({url, aspect: image.naturalWidth / image.naturalHeight})
		if (image.complete) measure()
		else image.onload = measure
		return () => {
			image.onload = null
		}
	}, [url])
	return item && url && measured?.url === url ? {url, aspect: measured.aspect} : undefined
}

// One pane of the swipe's strip: a stage-sized box one stage-width (plus the
// gap) to the picture's side, holding the neighbour's thumbnail fitted the
// way the stage will fit it — so when the swipe lands and the id swaps, the
// real stage takes over on the same pixels
function PeekPane({
	ref,
	side,
	picture,
}: {
	ref: React.Ref<HTMLElement>
	side: -1 | 1
	picture: {url: string; aspect: number}
}) {
	return (
		<div
			ref={ref as React.Ref<HTMLDivElement>}
			aria-hidden='true'
			className='pointer-events-none absolute inset-y-0 flex w-full items-center justify-center'
			style={{left: `calc(${side * 100}% ${side > 0 ? '+' : '-'} ${PANE_GAP}px)`}}
		>
			<div
				className='relative max-h-full overflow-hidden rounded-xl bg-black/40'
				style={{width: `min(100%, calc(100cqh * ${picture.aspect}))`, aspectRatio: picture.aspect}}
			>
				<img src={picture.url} alt='' draggable={false} className='absolute inset-0 h-full w-full object-cover' />
			</div>
		</div>
	)
}

// Edge arrows: present for the pointer, quiet until the stage is hovered
function StageArrow({
	side,
	label,
	disabled,
	onClick,
}: {
	side: 'left' | 'right'
	label: string
	disabled: boolean
	onClick: () => void
}) {
	const Icon = side === 'left' ? ChevronLeft : ChevronRight
	return (
		<button
			type='button'
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'absolute top-1/2 z-[5] flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:text-white focus-visible:opacity-100 disabled:!opacity-0',
				side === 'left' ? 'left-3' : 'right-3',
			)}
		>
			<Icon className='size-5' />
		</button>
	)
}
