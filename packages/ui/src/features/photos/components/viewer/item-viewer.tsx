import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Album, Download, Heart, Info, Plus, RotateCcw, Trash2, X} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'
import {useMedia} from 'react-use'

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
import {VideoPlayer} from '@/components/video-player'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {createTileLift} from '@/features/photos/components/listing/tile-lift'
import {useListing} from '@/features/photos/components/listing/use-listing'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import {FaceOutlines, type FaceFocus} from '@/features/photos/components/viewer/face-outlines'
import {Filmstrip, FilmstripPlaceholder} from '@/features/photos/components/viewer/filmstrip'
import {InfoPanel} from '@/features/photos/components/viewer/info-panel'
import {InfoSheet, useInfoSheet} from '@/features/photos/components/viewer/info-sheet'
import {LightboxButton, lightboxButtonClass, StageArrow} from '@/features/photos/components/viewer/lightbox-button'
import {LivePhoto} from '@/features/photos/components/viewer/live-photo'
import {useNeighborPrefetch} from '@/features/photos/components/viewer/neighbor-prefetch'
import {usePictureFlight, type FlightStart} from '@/features/photos/components/viewer/picture-flight'
import {useSeedRenditions} from '@/features/photos/components/viewer/seed-rendition'
import {PANE_GAP, useStageGestures} from '@/features/photos/components/viewer/stage-gestures'
import {TextHighlights} from '@/features/photos/components/viewer/text-highlights'
import {textLines, type TextFocus} from '@/features/photos/components/viewer/text-regions'
import {createStripDrive} from '@/features/photos/components/viewer/viewer-channels'
import {useViewerItemId} from '@/features/photos/components/viewer/viewer-location'
import {
	itemOriginalUrl,
	itemThumbnailUrl,
	useItem,
	useItemActions,
	useItemNeighbors,
	type Item,
	type ThumbSize,
} from '@/features/photos/hooks/use-items'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {useItemInsights} from '@/features/photos/hooks/use-search'
import {takenAtClock} from '@/features/photos/utils/taken-at'
import {snippetTerms} from '@/features/search/snippet'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {capitalizeDate} from '@/utils/date-time'
import {useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'
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

// With no grid behind the lightbox — the map with its list put away — the
// picture's place is emptied all the same, by the same rule (tile-lift.ts): a
// map marker showing the item is lifted while the picture is away from it
const ungriddedLift = createTileLift()

// The lightbox. Shares the listing on screen (see useListing), so the
// filmstrip and ←/→ walk the same list the user was looking at — a timeline
// extended page by page, or a search's results in their ranked order — and
// when the item isn't in a timeline's list (a deep link), neighbours come
// from the API. A ranked list has no neighbours but its own: an item opened
// before its search has answered (a link from ⌘K) simply stands alone for
// that moment, rather than stepping off into the calendar.
//
// `photos-item-t=<ms>` beside the id opens a video at that moment — a search
// result that matched something said or seen partway through.
export function ItemViewer() {
	const dialogProps = useDialogOpenProps('photos-item')
	// The item on stage: the URL's on opening, the viewer's own as it steps
	// (written back to the URL once it rests, see useViewerItemId)
	const {currentId, goTo, commitUrl} = useViewerItemId(dialogProps.open)
	const {params, remove} = useQueryParams()
	// Where to start the video, taken out of the address bar as soon as it is
	// read — like a handed-over search, so Back and a reload don't replay it —
	// and spent on the player's first metadata (see the <video> below). It
	// waits its turn behind `q`, which leaves the same way: two rewrites of
	// the same URL in one commit would undo each other.
	const [startAt, setStartAt] = useState<{id: string; ms: number}>()
	const handedStart = params.get('photos-item-t')
	const handedSearch = params.has('q')
	useEffect(() => {
		if (handedStart === null || handedSearch) return
		const ms = Number(handedStart)
		if (currentId && Number.isFinite(ms) && ms > 0) setStartAt({id: currentId, ms})
		remove('photos-item-t', {replace: true})
	}, [handedStart, handedSearch, currentId])
	const {t, i18n} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const {mode, filter, items, hasMore, before, loadMore, pending, snippets} = useListing({enabled: dialogProps.open})
	const inDeleted = filter.deleted === true
	const confirm = useConfirmation()
	const {data: item} = useItem(currentId, inDeleted)
	const index = items.findIndex((candidate) => candidate.id === currentId)
	// The list has no neighbour to give when it doesn't hold the item — or
	// holds it first while being the timeline's tail from a jump (see
	// useItems), with the rest of the timeline above it
	// A ranked list has no neighbours but its own (see above)
	const {data: apiNeighbors} = useItemNeighbors(
		mode === 'timeline' && !pending && (index === -1 || (index === 0 && before !== undefined)) ? currentId : undefined,
		filter,
	)
	const prevId = index > 0 ? items[index - 1]!.id : apiNeighbors?.prevId
	const nextId = index >= 0 && index < items.length - 1 ? items[index + 1]!.id : apiNeighbors?.nextId
	const {setFavorite, deleteItems, restoreItems, deletePermanently} = useItemActions()
	const {addToAlbum, removeFromAlbum} = useAlbumActions()
	const selection = usePhotosSelection()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
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
	// The stage's player, for the inspector's transcript to follow and seek
	const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
	// Whose face the inspector is pointing at (see FaceOutlines): a matter of
	// one picture, so it starts over with each
	const [faceFocus, setFaceFocus] = useState<FaceFocus>(null)
	const [faceFocusId, setFaceFocusId] = useState(currentId)
	// … and which of its text (see TextHighlights), likewise
	const [textFocus, setTextFocus] = useState<TextFocus>(null)
	if (faceFocusId !== currentId) {
		setFaceFocusId(currentId)
		setFaceFocus(null)
		setTextFocus(null)
	}
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
	// A picture the list doesn't hold — the lightbox opened on it from a link
	// or a reload, or stepped up to it from the head of a jump's tail. The
	// grid behind is asked to bring its stretch of the timeline on screen (see
	// GridHandle.seekTile): the list here is then the picture's own
	// neighbourhood — what the filmstrip shows, what the arrows step through —
	// and closing leaves the timeline at its tile rather than at the top.
	// Once per picture: one a view simply doesn't hold (a link to a photo
	// opened in Favorites, say) stays the lightbox's alone. Not while the list
	// is whole and loaded to its end, when that is the only way to be absent.
	const seekTile = grid?.seekTile
	const soughtRef = useRef<string>(undefined)
	const absent = dialogProps.open && index === -1 && items.length > 0 && (hasMore || before !== undefined)
	const itemTakenAt = item && item.id === currentId ? item.takenAt : undefined
	useEffect(() => {
		if (!dialogProps.open) soughtRef.current = undefined
		if (!absent || !seekTile || !currentId || itemTakenAt === undefined || soughtRef.current === currentId) return
		soughtRef.current = currentId
		seekTile(currentId, itemTakenAt)
	}, [dialogProps.open, absent, seekTile, currentId, itemTakenAt])
	// Every URL is derived from the id (CONTRACT.md). The stage rests on the
	// 1280 rendition — the true original is only ever downloaded, and videos
	// stream it through the player (range requests).
	const restingUrl = useAuthorizedHttpUrl(currentId ? itemThumbnailUrl(currentId, 1280) : undefined)
	const videoUrl = useAuthorizedHttpUrl(currentId && isVideo ? itemOriginalUrl(currentId) : undefined)
	const downloadUrl = useAuthorizedHttpUrl(currentId ? itemOriginalUrl(currentId, {download: true}) : undefined)
	// The seed — the rendition the item's tile has on screen, already decoded,
	// else the 192 (see useSeedRenditions) — is what flies in, sits under the
	// resting image until that has loaded and, blown up and blurred, is the
	// backdrop. It is never traded for a finer thumbnail on the way: the wire
	// is the 1280's.
	const seedFor = useSeedRenditions(dialogProps.open)
	const thumbnailUrl = useSharedAuthorizedHttpUrl(
		dialogProps.open && currentId ? itemThumbnailUrl(currentId, seedFor(currentId)) : undefined,
	)
	// The item whose resting image has arrived, so the thumbnail can give way to it
	const [loadedId, setLoadedId] = useState<string>()

	// Opening and closing: the picture flies, everything else follows `closing`
	const flight = usePictureFlight({
		open: dialogProps.open,
		id: currentId,
		reduceMotion,
		tileRect: grid?.tileRect,
		liftTile: grid?.liftTile ?? ungriddedLift.set,
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
	useEffect(() => setMeasureFallback(false), [currentId])
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
	// Where the picture's text is in it, for pointing at on the stage: asked
	// for when there is something to point with — a search that found the
	// picture by its words, or the inspector, which asks for the same thing
	// and shares the answer. A video's text is wherever its frames put it,
	// and a live photo's still is played over.
	const matched = item ? snippets.get(item.id) : undefined
	const matchedTerms = useMemo(() => snippetTerms(matched), [matched])
	const pointsAtText = item !== undefined && !isVideo && item.subKind !== 'live' && (showInfo || matched !== undefined)
	// A video's are asked for too: what is said in it is its captions
	const {data: insights} = useItemInsights(pointsAtText || (item !== undefined && isVideo) ? item?.id : undefined)
	const textLinesOnStage = useMemo(() => {
		const lines = insights?.text && insights.textQuads ? textLines(insights.text, insights.textQuads) : undefined
		return lines?.some((line) => line.quad) ? lines : undefined
	}, [insights])
	// Open where the search matched: seek before the first frame is shown,
	// and autoplay carries on from there
	useEffect(() => {
		if (!videoEl || !item || startAt?.id !== item.id) return
		const seek = () => {
			videoEl.currentTime = startAt.ms / 1000
			setStartAt(undefined)
		}
		if (videoEl.readyState >= HTMLMediaElement.HAVE_METADATA) return seek()
		videoEl.addEventListener('loadedmetadata', seek, {once: true})
		return () => videoEl.removeEventListener('loadedmetadata', seek)
	}, [videoEl, item, startAt, setStartAt])
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
	// `from` is where a drag-to-dismiss or a pinch-close let go of the
	// picture, for the flight to carry on from the finger (see
	// useStageGestures); a close begun while zoomed starts from the zoom.
	// `next` runs once the picture is home, in place of clearing the URL's
	// dialog slot: another dialog opening there is what closes this one.
	const close = async (from?: FlightStart, next?: () => void) => {
		if (closingRef.current) return
		closingRef.current = true
		// The URL names the item being closed on (for the close itself, a
		// reload, the next open) and takes no more steps from this session
		commitUrl()
		// A picture lifted by the phone's info sheet flies home from where it is
		// drawn: the lift is folded into the transform the flight starts from
		const start = infoSheet.handOff(from ?? gestures.flatten())
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
		if (currentId) grid?.revealTile(currentId)
		await Promise.all([flight.back(start), new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : LEAVE_MS))])
		if (next) next()
		else dialogProps.onOpenChange(false)
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
	// Phones: the inspector is a sheet that rises from the bottom as the
	// picture lifts into the top of the screen (see useInfoSheet) — or, in a
	// short landscape window, a panel at the right the picture makes way for.
	// The stage is what lifts; the bottom toolbar floats over the sheet's foot,
	// and the filmstrip follows the picture aside for the panel.
	const phoneLandscape = useMedia('(orientation: landscape) and (max-height: 500px)', false)
	const stageRef = useRef<HTMLElement | null>(null)
	const toolbarRef = useRef<HTMLDivElement | null>(null)
	const stripRef = useRef<HTMLElement | null>(null)
	const infoSheet = useInfoSheet({
		enabled: isMobile,
		session: dialogProps.open,
		open: showInfo,
		onOpenChange: setInfoByHand,
		layout: phoneLandscape ? 'side' : 'bottom',
		stageRef,
		pictureRef,
		toolbarRef,
		stripRef,
		refitKey: `${currentId}:${aspect}`,
		reduceMotion,
	})
	// The neighbours' panes for a horizontal swipe: they ride one stage-width
	// to each side of the picture, so the next item slides in with the finger
	// (iOS-style) rather than appearing once the swipe has landed
	const peekRefs = {prev: useRef<HTMLElement | null>(null), next: useRef<HTMLElement | null>(null)}
	const peekPrev = usePeek(isTouch && dialogProps.open && index > 0 ? items[index - 1] : undefined, seedFor)
	const peekNext = usePeek(isTouch && dialogProps.open && index >= 0 ? items[index + 1] : undefined, seedFor)
	// The stage's horizontal travel, for the filmstrip to follow a swipe frame
	// by frame without a render (see StripDrive)
	const [drive] = useState(createStripDrive)
	const gestures = useStageGestures({
		open: dialogProps.open,
		enabled: isTouch && dialogProps.open && !closing && flight.arrived,
		// Stills zoom (a video keeps its own controls); the original's pixels
		// and name say how far, and whether the browser can draw it sharper.
		// Not under the phone's info sheet, which lifts the picture as a
		// preview beside the info: opened over a zoom, it goes back to fit.
		zoom: {
			enabled: dialogProps.open && !closing && flight.arrived && !!shown && !isVideo && !(isMobile && showInfo),
			width: shown?.width ?? 0,
			height: shown?.height ?? 0,
			fileName: item?.id === currentId ? item?.fileName : undefined,
		},
		pictureRef,
		peekRefs,
		shownId: currentId,
		canStep: (dir) => !!(dir === 1 ? nextId : prevId),
		onStep: (dir) => goTo(dir === 1 ? nextId : prevId),
		onDismissStart: () => {
			if (currentId) grid?.revealTile(currentId)
		},
		onDismiss: (from) => void close(from),
		drive,
		// Phones: an upward swipe lifts the picture and raises the info sheet
		onLift: isMobile ? infoSheet.lift : undefined,
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
		settled: flight.arrived && (isVideo || (!!currentId && loadedId === currentId)),
		currentId,
		prevId,
		nextId,
		deleted: inDeleted,
		infoShowing: showInfo,
	})
	// … and a neighbour whose resting image is in hand slides in under the
	// finger as that image, not as the thumbnail it would otherwise be until
	// the swipe has landed (see PeekPane)
	const prevRestingUrl = useSharedAuthorizedHttpUrl(isTouch && prevId ? itemThumbnailUrl(prevId, 1280) : undefined)
	const nextRestingUrl = useSharedAuthorizedHttpUrl(isTouch && nextId ? itemThumbnailUrl(nextId, 1280) : undefined)

	// The id that has been looked at for a beat (REST_MS): the stage requests
	// an original — or mounts an autoplaying player — only for this one, so
	// flying along the strip runs on thumbnails alone. A prefetched neighbour
	// bypasses the rest (`warm`): its bytes are already here, show them at once.
	// A photo the strip is only coasting past is never rested on, however slow
	// the last of the coast: its end dwells on each of the photos before the
	// one it lands on for longer than the beat.
	const [restedId, setRestedId] = useState<string>()
	const [passingId, setPassingId] = useState<string>()
	useEffect(() => {
		if (currentId === passingId) return
		const handle = setTimeout(() => setRestedId(currentId), REST_MS)
		return () => clearTimeout(handle)
	}, [currentId, passingId])
	const selectFromStrip = useCallback(
		(id: string, passing = false) => {
			setPassingId(passing ? id : undefined)
			goTo(id)
		},
		[goTo],
	)

	useEffect(() => {
		if (!dialogProps.open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return
			// A key that is somewhere's own stays there: typed into a field, an
			// arrow that moves a slider of the player's, a menu's arrows and the
			// letters that find its rows — stepping under an open menu would hand
			// what is picked from it to another picture
			const own = 'input, textarea, select, [contenteditable], [role="slider"], [role="menu"]'
			if (e.target instanceof Element && e.target.closest(own)) return
			// … and so does every key while a video fills the screen, which a
			// step would take it off
			if (document.fullscreenElement) return
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
	// New album… as from the tile's menu: the picture flies home, its tile is
	// selected, and the new-album dialog takes it from the selection
	// … and the menu keeps the keyboard from its button on the way out, whose
	// tooltip would otherwise hang over the close
	const leavingForNewAlbum = useRef(false)
	const handleNewAlbum = (id: string) => {
		leavingForNewAlbum.current = true
		void close(undefined, () => {
			leavingForNewAlbum.current = false
			selection.set([id])
			navigate(linkToDialog('photos-create-album'))
		})
	}

	// From the list's item rather than the fetched detail, so a step shows the
	// new date in the same frame as the new picture — at the wall clock the
	// photo was taken by, when its file carried the offset
	const takenOn = shown
		? (() => {
				const clock = takenAtClock(shown.takenAt, shown.takenAtOffsetMinutes)
				const date = clock.date.toLocaleDateString(i18n.language, {
					weekday: 'short',
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: clock.timeZone,
				})
				return capitalizeDate(date, i18n.language)
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
									disabled={!item}
									className={lightboxButtonClass}
								>
									<Album className='size-5' />
								</button>
							</DropdownMenuTrigger>
						</DarkTooltip>
						<DropdownMenuContent
							align='end'
							onCloseAutoFocus={(event) => leavingForNewAlbum.current && event.preventDefault()}
						>
							{routeAlbumId && (
								<>
									<DropdownMenuItem onSelect={handleRemoveFromAlbum}>
										{t('photos-item.remove-from-album')}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
								</>
							)}
							<DropdownMenuItem onSelect={() => item && handleNewAlbum(item.id)}>
								<Plus className='mr-2 size-4' />
								{t('photos-selection.new-album')}
							</DropdownMenuItem>
							{otherAlbums && otherAlbums.length > 0 && <DropdownMenuSeparator />}
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
					// The focus comes to the lightbox itself rather than to a button
					// in it. Left on the tile that was clicked, Space would press
					// that tile again instead of playing or pausing a video.
					onOpenAutoFocus={(e) => {
						e.preventDefault()
						if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus({preventScroll: true})
					}}
					onPointerDownOutside={preventDialogDismissForToasts}
					className='fixed inset-0 z-50 h-dvh w-screen ps-(--safe-left) pe-(--safe-right) pt-(--safe-top) outline-hidden'
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
						<header className='flex items-start justify-between gap-4 px-4 pt-4 md:px-6 md:pt-5 phone-side:pt-3'>
							{/* The lines keep their boxes while a step's detail (the file name)
							    is still on its way: the stage below is sized from what's left,
							    so a collapsing header would resize the picture mid-swipe */}
							<div className={cn('min-w-0', chrome('top'))}>
								<p className='min-h-[1lh] truncate text-15 font-semibold -tracking-2 text-white/95'>{takenOn}</p>
								<p className='min-h-[1lh] truncate text-12 text-white/50'>{item?.fileName}</p>
							</div>
							{/* Desktop: actions ride the header's right edge. So do a phone's
							    on its side, where a toolbar under the strip would leave the
							    picture a third of the height */}
							<div className={cn('hidden md:block phone-side:block', chrome('top'))}>{actions}</div>
						</header>

						{/* Stage: the picture, fitted by CSS (a size container, so it can be
						    sized from the stage's height), and the inspector docked beside
						    it on desktop — the picture makes room as it slides in */}
						<main ref={stageRef} className='relative mx-4 mt-3 flex min-h-0 flex-1 md:mx-6'>
							<div
								className={cn(
									'group [container-type:size] relative flex min-w-0 flex-1 items-center justify-center',
									isTouch && 'touch-none',
								)}
								{...gestures.handlers}
							>
								{shown && aspect === undefined && <TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />}
								{/* This element is the flight's and the stage gestures' — its
								    inline transform is theirs, about its top-left corner — so the
								    zoom rides a layer inside it, wrapping everything it draws, with
								    a transform of its own (see useStageGestures) */}
								{shown && aspect !== undefined && (
									<div
										ref={setPictureEl}
										className='relative max-h-full [transform-origin:0_0] overflow-hidden rounded-xl bg-black/40'
										style={{width: `min(100%, calc(100cqh * ${aspect}))`, aspectRatio: aspect}}
									>
										{/* Zoomed, a live photo's chips would grow with it: they step aside */}
										<div
											ref={gestures.zoomRef}
											className='absolute inset-0 [transform-origin:0_0] data-zoomed:[&_button]:invisible'
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
														// The same player as Files (see VideoPlayer), captions and all.
														// The arrow keys step between items here, so the player
														// answers the rest (space, C, F, M) and leaves it those.
														<VideoPlayer
															key={item.id}
															src={videoUrl}
															poster={thumbnailUrl}
															transcript={insights?.transcript}
															keys='media'
															controls={!closing}
															onVideo={setVideoEl}
															className='absolute inset-0'
														/>
													)
												) : restingUrl && (!closing || loadedId === item.id) ? (
													// One that was prefetched is the picture from its first
													// frame: decoded with the commit that mounts it, and with
													// nothing to fade in from. A swipe brought it in as itself
													// (see PeekPane), and a thumbnail showing through for a
													// beat would be the picture going soft and sharp again.
													<img
														key={item.id}
														src={restingUrl}
														alt={item.fileName}
														draggable={false}
														fetchPriority='high'
														decoding={warm(item.id) ? 'sync' : 'async'}
														onLoad={() => setLoadedId(item.id)}
														className={cn(
															'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
															loadedId === item.id || warm(item.id) ? 'opacity-100' : 'opacity-0',
														)}
													/>
												) : null)}
											{/* The original, once the zoom has gone past what the 1280 can
											    show — downloaded and decoded first, then laid over it */}
											{gestures.originalUrl && (
												<img
													src={gestures.originalUrl}
													alt=''
													aria-hidden='true'
													draggable={false}
													className='absolute inset-0 h-full w-full object-cover'
												/>
											)}
											{/* A live photo's motion clip and LIVE chip (see LivePhoto). Gated on
											    the rest alone — never `warm`, which only means a neighbouring
											    still was prefetched, while mounting this starts a video download.
											    Gone the moment the close begins: the picture flies home as the
											    still it will land as. */}
											{item && item.subKind === 'live' && flight.arrived && restedId === item.id && !closing && (
												<LivePhoto id={item.id} autoPlay={!reduceMotion} />
											)}
											{/* The faces the inspector points at, on a still that has
											    landed — a video's faces are wherever its frames put them */}
											{item && !isVideo && flight.arrived && !closing && item.people.length > 0 && (
												<FaceOutlines people={item.people} focus={showInfo ? faceFocus : null} />
											)}
											{/* … and its text: the words a search found it by, and the
											    lines the inspector points at */}
											{item && pointsAtText && textLinesOnStage && flight.arrived && !closing && (
												<TextHighlights
													key={`text:${item.id}`}
													lines={textLinesOnStage}
													aspect={aspect}
													matched={matchedTerms}
													focus={showInfo ? textFocus : null}
												/>
											)}
										</div>
									</div>
								)}
								{/* A horizontal swipe's neighbours, mounted only while the strip
								    is being dragged: each pane sits one stage-width to its side
								    and follows the finger with the picture (stage-gestures) */}
								{gestures.stepping && peekPrev && (
									<PeekPane
										ref={peekRefs.prev}
										side={-1}
										picture={peekPrev}
										restingUrl={prevId && warm(prevId) ? prevRestingUrl : undefined}
									/>
								)}
								{gestures.stepping && peekNext && (
									<PeekPane
										ref={peekRefs.next}
										side={1}
										picture={peekNext}
										restingUrl={nextId && warm(nextId) ? nextRestingUrl : undefined}
									/>
								)}
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
										{item && infoUsed && (
											<InfoPanel
												item={item}
												showing={showInfo}
												onClose={() => setInfoByHand(false)}
												video={isVideo ? videoEl : null}
												matched={matched}
												onTextFocus={textLinesOnStage ? setTextFocus : undefined}
												faceFocus={faceFocus}
												onFaceFocus={isVideo ? undefined : setFaceFocus}
											/>
										)}
									</div>
								</aside>
							)}
						</main>

						{/* Filmstrip */}
						{FILMSTRIP_MODE === 'off' ? (
							<footer className='h-4' />
						) : (
							<footer
								ref={stripRef}
								// A pointer's strip keeps 32px of headroom for the hover growth (and
								// its ring), and pulling it up by 24px keeps the visible thumb-to-stage
								// gap at 16px, same as the edge. That overlap sits over the stage —
								// exactly where a height-constrained video draws its seek bar — so
								// the footer must not catch hits; the strip re-enables them over its
								// visible band (see Filmstrip). A touch screen's strip has no growth
								// and is all hit target: it sits below the stage, the same 16px from
								// it — on a tablet wide enough for the desktop layout too.
								className={cn(
									'pointer-events-none',
									isMobile || isTouch ? 'pt-3 pb-2' : '-mt-6 pt-2 pb-2',
									chrome('bottom'),
								)}
								// Desktop: the strip spans the stage and nothing more, so its centre is
								// the picture's — the stage's margin on the left, and on the right the
								// margin plus whatever the inspector's dock takes (its width and its
								// ml-4, less the -mr-6 it borrows the margin back with). Same duration
								// and easing as the dock, so the two slide as one; pinned with it for
								// the close (see closingAside). The transition is inline because the
								// chrome's own (opacity, for the dismiss drag) would otherwise win the
								// class merge.
								style={
									isMobile
										? undefined
										: {
												paddingLeft: STAGE_MARGIN,
												paddingRight:
													STAGE_MARGIN +
													(closingAside
														? closingAside.width + closingAside.marginLeft - STAGE_MARGIN
														: showInfo
															? INSPECTOR_WIDTH + 16
															: 0),
												...(!closingAside &&
													!reduceMotion && {
														transitionProperty: 'opacity, padding',
														transitionDuration: '200ms, 300ms',
														transitionTimingFunction: 'var(--default-transition-timing-function), var(--ease-out)',
													}),
											}
								}
							>
								{currentId && items.length > 0 ? (
									<Filmstrip
										items={items}
										currentId={currentId}
										hasMore={hasMore}
										loadMore={loadMore}
										onSelect={selectFromStrip}
										grow={FILMSTRIP_MODE === 'grow'}
										drive={drive}
									/>
								) : (
									<FilmstripPlaceholder />
								)}
							</footer>
						)}

						{/* Phones: the actions are a toolbar under the strip. It floats over
						    the info sheet's foot, so Info closes what it opened. */}
						<div
							ref={toolbarRef}
							className={cn('relative z-30 flex justify-center pb-3 md:hidden phone-side:hidden', chrome('bottom'))}
						>
							{/* Its floor over the info sheet, faded in as the sheet passes
							    under it (--sheet-under, see useInfoSheet) */}
							<div
								aria-hidden='true'
								className='pointer-events-none absolute inset-x-0 -top-6 bottom-0 bg-linear-to-t from-[rgb(8_9_11/0.94)] from-55% to-transparent opacity-(--sheet-under,0)'
							/>
							<div className='relative'>{actions}</div>
						</div>

						{/* Phones: the inspector as a sheet the picture lifts above (see
						    useInfoSheet), fed by the stage's upward swipe */}
						{isMobile && (
							<InfoSheet
								sheet={infoSheet}
								item={item}
								built={infoUsed}
								closing={closing}
								onClose={() => setInfoByHand(false)}
								video={isVideo ? videoEl : null}
								matched={matched}
							/>
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
// real stage takes over on the same pixels. Over the thumbnail goes the
// neighbour's resting image when it has already been fetched (`restingUrl`):
// the picture then arrives as sharp as it will rest, where the thumbnail
// alone is a few hundred pixels stretched over the screen for the whole of
// the slide.
function PeekPane({
	ref,
	side,
	picture,
	restingUrl,
}: {
	ref: React.Ref<HTMLElement>
	side: -1 | 1
	picture: {url: string; aspect: number}
	restingUrl?: string
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
				{restingUrl && (
					<img src={restingUrl} alt='' draggable={false} className='absolute inset-0 h-full w-full object-cover' />
				)}
			</div>
		</div>
	)
}
