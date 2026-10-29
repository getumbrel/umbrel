import '@/features/files/components/file-viewer/document-viewer/document-viewer.css'

import {Search} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiEditLine} from 'react-icons/ri'

import {
	DocxError,
	openDocument,
	type DocxDocument,
	type DocxErrorCode,
} from '@/features/files/components/file-viewer/document-viewer/engine'
import {useDocumentFind} from '@/features/files/components/file-viewer/document-viewer/find'
import {
	useViewerDetail,
	useViewerEscape,
	useViewerSave,
	ViewerTools,
} from '@/features/files/components/file-viewer/shell/context'
import {EditHint, nudge} from '@/features/files/components/file-viewer/shell/edit-hint'
import {FindPill} from '@/features/files/components/file-viewer/shell/find-pill'
import {pageShortcut, pageTurn} from '@/features/files/components/file-viewer/shell/keys'
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
import {listenForPinch, zoomStep} from '@/features/files/components/file-viewer/shell/zoom'
import {ZoomPill, type ZoomPreset} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import type {FileSystemItem} from '@/features/files/types'
import {LightboxButton} from '@/features/photos/components/viewer/lightbox-button'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
// The space around and between pages on a narrow stage and a wide one (the host's padding follows the same 768px
// line, as a container query)
const SPACE = {narrow: 16, wide: 24}

type Opened = {doc: DocxDocument} | {error: DocxErrorCode}

type Stage = {width: number; height: number}
const spaceFor = (stage: Stage) => (stage.width < 768 ? SPACE.narrow : SPACE.wide)
// The stage as a fit sees it: its width beside the vertical scrollbar's gutter, its height without the sideways
// scrollbar of pages zoomed past it (a fit takes that away)
const stageOf = (scroller: HTMLElement): Stage => ({width: scroller.clientWidth, height: scroller.offsetHeight})

export default function DocumentViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const file = useFileBytes(item)
	const readOnly = useIsFilesReadOnly() || !item.operations.includes('writable')
	// The bytes are opened once: the document holds the edits from then on
	const [source, setSource] = useState<{bytes: ArrayBuffer; revision: string | undefined}>()
	if (file.status === 'ready' && !source) setSource({bytes: file.bytes, revision: file.revision})
	const [opened, setOpened] = useState<Opened>()

	useEffect(() => {
		if (!source) return
		let live = true
		let doc: DocxDocument | undefined
		openDocument(new Uint8Array(source.bytes)).then(
			(result) => {
				doc = result
				if (live) setOpened({doc: result})
				else result.destroy()
			},
			(error: unknown) => live && setOpened({error: error instanceof DocxError ? error.code : 'corrupt'}),
		)
		return () => {
			live = false
			doc?.destroy()
		}
	}, [source])

	if (!source && file.status === 'error') {
		const missing = file.error === 'not-found'
		return (
			<StageMessage
				item={item}
				title={t(missing ? 'files-document.missing-title' : 'files-document.unreachable-title')}
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
	if (opened && 'error' in opened) return <CantOpen item={item} error={opened.error} />
	if (!opened || !source) return <StageLoading item={item} />
	return (
		<Pages
			item={item}
			mode={mode}
			doc={opened.doc}
			revision={source.revision}
			writable={mode === 'open' && !readOnly}
		/>
	)
}

// Why the document can't be shown, with the file to download instead
function CantOpen({item, error}: {item: FileSystemItem; error: DocxErrorCode}) {
	const {t} = useTranslation()
	const [title, detail] = {
		encrypted: ['files-document.encrypted-title', 'files-document.encrypted-detail'],
		// A document in the older format can't be opened either, for a reason of its own
		unsupported: ['files-document.damaged-title', 'files-document.legacy-detail'],
		limits: ['files-document.too-large-title', 'files-viewer.too-large-detail'],
		corrupt: ['files-document.damaged-title', 'files-document.damaged-detail'],
	}[error]
	return (
		<StageMessage item={item} title={t(title)} detail={t(detail)}>
			<StageDownload item={item} />
		</StageMessage>
	)
}

function Pages({
	item,
	mode,
	doc,
	revision: openedRevision,
	writable,
}: ViewerProps & {doc: DocxDocument; revision: string | undefined; writable: boolean}) {
	const {t} = useTranslation()
	// A file that can be written is edited in place, unless that would break the document's Track Changes or editing
	// restriction
	const protection = writable ? doc.protection : undefined
	const editable = writable && !protection
	const touch = useIsTouchDevice()
	// A phone on its side has no height to spare: the page gets all of it, with no notice or edit hint above it
	const short = useShortScreen()
	const scrollerRef = useRef<HTMLDivElement>(null)
	const hostRef = useRef<HTMLDivElement>(null)
	const hintRef = useRef<HTMLParagraphElement>(null)
	const findInputRef = useRef<HTMLInputElement>(null)
	const [area, setArea] = useState<HTMLDivElement | null>(null)
	// The pages as laid out (the engine hands over new ones when edits lay them out again)
	const [pages, setPages] = useState<HTMLElement[]>([])
	const [failed, setFailed] = useState<DocxErrorCode>()
	// The pages' scale, and the zoom asked for: a fit follows the stage as it resizes, and 'auto' fills its width up to
	// 125%, a landscape page's too. A document is read down its pages, so its text gets the width, where a PDF's 'auto'
	// fits a landscape page (often a slide) whole wherever that leaves it at least half the width.
	const [scale, setScale] = useState(1)
	const scaleRef = useRef(1)
	const [zoom, setZoom] = useState<ZoomPreset | 'auto'>('auto')
	// The widest page's width at 100%
	const [widest, setWidest] = useState(0)
	// The page in view (from 1), and the first and last on screen (indices)
	const [page, setPage] = useState(1)
	const [first, setFirst] = useState(0)
	const [last, setLast] = useState(0)
	const [editing, setEditing] = useState(false)
	const [dirty, setDirty] = useState(false)
	const [revision, setRevision] = useState(openedRevision)
	// Bumped as the text changes, for find to read it again
	const [version, setVersion] = useState(0)
	// The stage size the fit was last worked out for
	const fitted = useRef<Stage>({width: 0, height: 0})
	// A two-finger pinch in progress: where the fingers were last
	const pinch = useRef<{distance: number; x: number; y: number}>(undefined)
	// Where the caret was in the text as find opened, for it to go back to
	const caret = useRef<Range>(undefined)
	const painted = pages.length > 0
	const isEditing = editing && editable
	const find = useDocumentFind({pages, version, scrollerRef, page: page - 1, shown: [first, last]})

	// Laid out once, at the document's own size; then fitted to the stage (and faded in, see the host). Nothing reads
	// layout in between: a first layout of a long document's pages is costly (in WebKit above all), and the stage's
	// size is taken while it's empty.
	useEffect(() => {
		const scroller = scrollerRef.current!
		const abort = new AbortController()
		const stage = stageOf(scroller)
		const decorate = (pages: HTMLElement[]) => {
			for (const page of pages) page.classList.add('umbrel-docx-page')
		}
		doc
			.render(hostRef.current!, {
				gap: spaceFor(stage),
				signal: abort.signal,
				onChange: () => {
					setDirty(doc.isDirty())
					setVersion((count) => count + 1)
				},
				// Before the new pages are painted, so they never show bare
				onLayout: ({pages}) => {
					decorate(pages)
					setPages(pages)
				},
				onRefuse: () => nudge(hintRef.current),
			})
			.then(
				({pages}) => {
					if (abort.signal.aborted) return
					decorate(pages)
					setWidest(Math.max(...pages.map((page) => parseFloat(page.style.width))))
					const fit = fitZoom('auto', stage, pages[0], 1)
					doc.setZoom(fit)
					scaleRef.current = fit
					fitted.current = stage
					setScale(fit)
					setPages(pages)
					// Arrows, Page Up/Down, Home/End and Space scroll the document
					scroller.focus({preventScroll: true})
				},
				(error: unknown) => !abort.signal.aborted && setFailed(error instanceof DocxError ? error.code : 'corrupt'),
			)
		return () => abort.abort()
	}, [doc])

	useEffect(() => doc.setEditable(isEditing), [doc, isEditing])

	// Scales the pages, keeping the point at `at` (the middle of the stage unless a pinch says where) where it is
	const scaleTo = (next: number, at?: {x: number; y: number}) => {
		const scroller = scrollerRef.current
		if (!scroller || !pages.length) return
		const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
		const view = scroller.getBoundingClientRect()
		const point = at ?? {x: view.left + view.width / 2, y: view.top + view.height / 2}
		const anchor = pages[pageAt(pages, point.y)]
		const before = anchor.getBoundingClientRect()
		doc.setZoom(target)
		scaleRef.current = target
		setScale(target)
		const after = anchor.getBoundingClientRect()
		scroller.scrollLeft += after.left - point.x + ((point.x - before.left) / before.width) * after.width
		scroller.scrollTop += after.top - point.y + ((point.y - before.top) / before.height) * after.height
	}
	const applyZoom = (preset: ZoomPreset) => {
		const scroller = scrollerRef.current
		if (!scroller || !pages.length) return
		setZoom(preset)
		scaleTo(fitZoom(preset, stageOf(scroller), pages[page - 1], scaleRef.current))
		// A page fitted whole is shown whole, its top a gap below the stage's
		if (preset === 'page-fit') scrollToPage(page)
	}
	// Steps zoom about the middle of what's in view
	const stepZoom = (direction: 1 | -1) => {
		const target = zoomStep(scaleRef.current, direction)
		setZoom(target)
		scaleTo(target)
	}
	const scrollToPage = (target: number) => {
		const scroller = scrollerRef.current
		const element = pages[target - 1]
		if (!scroller || !element) return
		scroller.scrollTop +=
			element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - spaceFor(stageOf(scroller))
	}
	const goToPage = (target: number) => {
		scrollToPage(target)
		scrollerRef.current?.focus({preventScroll: true})
	}

	// Keeps the page in view, and the pages on screen, as the document scrolls. The first look waits for a frame: new
	// pages are laid out with it, and reading their layout sooner would lay them all out once more (in WebKit, a long
	// document's slowest step).
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || !pages.length) return
		let frame = 0
		const update = () => {
			frame = 0
			const {current, first, last} = inView(scroller, pages)
			setPage(current + 1)
			setFirst(first)
			setLast(last)
		}
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update)
		}
		onScroll()
		scroller.addEventListener('scroll', onScroll, {passive: true})
		return () => {
			cancelAnimationFrame(frame)
			scroller.removeEventListener('scroll', onScroll)
		}
	}, [pages, scale])

	// Fits follow the stage as the window resizes
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || !painted || typeof zoom === 'number') return
		const observer = new ResizeObserver(() => {
			const stage = stageOf(scroller)
			if (stage.width === fitted.current.width && stage.height === fitted.current.height) return
			fitted.current = stage
			scaleTo(fitZoom(zoom, stage, pages[page - 1], scaleRef.current))
		})
		observer.observe(scroller)
		return () => observer.disconnect()
	})

	// Pinching — two fingers, a trackpad, ctrl and the wheel — zooms the pages, never the window around them. The
	// listeners stay for the layout: a pinch is followed to its end by those that saw it start.
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || !painted) return
		const abort = new AbortController()
		const zoomBy = (factor: number, x: number, y: number) => {
			const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scaleRef.current * factor))
			setZoom(target)
			scaleTo(target, {x, y})
		}
		listenForPinch(scroller, zoomBy, {gestures: !touch, signal: abort.signal})
		if (touch) {
			const fingers = ({touches: [a, b]}: TouchEvent) => ({
				distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
				x: (a.clientX + b.clientX) / 2,
				y: (a.clientY + b.clientY) / 2,
			})
			const settle = (event: TouchEvent) => {
				pinch.current = event.touches.length === 2 ? fingers(event) : undefined
			}
			scroller.addEventListener('touchstart', settle, {passive: true, signal: abort.signal})
			scroller.addEventListener('touchend', settle, {passive: true, signal: abort.signal})
			scroller.addEventListener('touchcancel', settle, {passive: true, signal: abort.signal})
			scroller.addEventListener(
				'touchmove',
				(event) => {
					const from = pinch.current
					if (!from || event.touches.length !== 2) return
					event.preventDefault()
					// Zoomed about where the fingers were, then carried along with them
					const to = fingers(event)
					zoomBy(to.distance / from.distance, from.x, from.y)
					scroller.scrollLeft -= to.x - from.x
					scroller.scrollTop -= to.y - from.y
					pinch.current = to
				},
				{passive: false, signal: abort.signal},
			)
		}
		return () => abort.abort()
	}, [painted, touch, pages])

	const openFind = () => {
		const selection = document.getSelection()
		caret.current =
			isEditing && selection?.rangeCount && hostRef.current!.contains(selection.anchorNode)
				? selection.getRangeAt(0).cloneRange()
				: undefined
		find.show()
		findInputRef.current?.select()
	}
	// The match found is left selected, as in any editor (typing replaces it); without one, the caret goes back to
	// where it was. A selection in the text being edited takes the focus there.
	const closeFind = () => {
		const range = find.match() ?? caret.current
		find.close()
		scrollerRef.current?.focus({preventScroll: true})
		if (range)
			document
				.getSelection()
				?.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
	}
	const stopEditing = () => {
		setEditing(false)
		scrollerRef.current?.focus({preventScroll: true})
	}

	// ⌘F finds, ⌘+ ⌘− ⌘0 zoom the pages rather than the window, ⌘A selects the document's text (not the viewer's), and
	// ←/→ turn the page when nothing scrolls sideways
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || !painted) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (isBeneathModal(scroller, event)) return
			if (pageShortcut(event, {find: openFind, zoom: stepZoom, actualSize: () => applyZoom(1)})) return
			const mod = event.metaKey || event.ctrlKey
			if (mod && !event.altKey && event.key.toLowerCase() === 'a' && event.target === scroller) {
				event.preventDefault()
				document.getSelection()?.selectAllChildren(hostRef.current!)
				return
			}
			const turn = pageTurn(event, scroller, mode)
			if (!turn || scroller.scrollWidth > scroller.clientWidth) return
			event.preventDefault()
			// From the page in view now: a second press before the indicator has caught up goes on from the first
			goToPage(Math.min(pages.length, Math.max(1, inView(scroller, pages).current + 1 + turn)))
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	useViewerEscape(() => {
		if (find.open) closeFind()
		else if (isEditing) stopEditing()
		else return false
		return true
	})
	useViewerDetail(painted ? t('files-viewer.pages', {count: pages.length}) : undefined)
	useViewerSave(
		editable && painted
			? {
					revision,
					serialize: async () => new Blob([(await doc.save()) as Uint8Array<ArrayBuffer>], {type: item.type}),
					onSaved: (saved) => {
						doc.markSaved()
						setRevision(saved)
						setDirty(doc.isDirty())
					},
				}
			: null,
		dirty,
	)

	// Why it can't be edited, then "Charts and equations can't be shown fully here…", known once the pages are drawn
	const approximation = useApproximationNotice(doc.approximated, editable)
	const notice = [
		protection && t(protection === 'tracked' ? 'files-document.notice-tracked' : 'files-document.notice-protected'),
		painted && approximation,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<>
			<ViewerTools>
				{painted && (
					<>
						<LightboxButton
							icon={Search}
							label={t('files-viewer.find')}
							active={find.open}
							onClick={() => (find.open ? closeFind() : openFind())}
						/>
						{editable && (
							<ToolPill active={isEditing} onClick={() => (isEditing ? stopEditing() : setEditing(true))}>
								<RiEditLine className='size-4 opacity-80' />
								{t('files-viewer.edit')}
							</ToolPill>
						)}
					</>
				)}
			</ViewerTools>

			<div className='relative flex min-h-0 flex-1 flex-col'>
				{/* While editing, the hint floats at the top, as the notice does (in its band, when the document has
				    one: the notice steps aside meanwhile), unless find has the top. Outside the area, so the band
				    doesn't open for the hint alone: the pages scroll out from under it. */}
				{isEditing && !find.open && !short && <EditHint ref={hintRef} />}

				<div ref={setArea} className='group/area relative min-h-0 flex-1'>
					<div
						ref={scrollerRef}
						tabIndex={-1}
						role='document'
						aria-label={item.name}
						className='@container absolute inset-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain outline-none [scrollbar-gutter:stable]'
					>
						{/* The engine's pages, centred inside the gutters a fit leaves (a page wider than that starts at
						    the left one). While the notice is up the first page starts below it, rather than under it:
						    there from the start, and easing back up once the notice is dismissed. */}
						<div
							ref={hostRef}
							className={cn(
								'px-4 pt-4 pb-14 transition-[opacity,padding] duration-300 ease-out motion-reduce:!transition-none @3xl:px-6 @3xl:pt-6',
								!short && 'group-has-[[role=status]]/area:!pt-20 group-has-[[role=status]]/area:transition-opacity',
								!painted && 'opacity-0',
							)}
						/>
						{/* As wide as the widest page with a gutter either side: a page zoomed past the stage's width
						    scrolls on to a gutter at its far side too (the column alone leaves it flush with the edge) */}
						<div
							className='invisible absolute top-0 left-0 box-content h-px px-4 @3xl:px-6'
							style={{width: widest * scale}}
						/>
					</div>

					{failed ? (
						<div className='absolute inset-0 flex'>
							<CantOpen item={item} error={failed} />
						</div>
					) : (
						!painted && (
							<div className='absolute inset-0 flex'>
								<StageLoading item={item} />
							</div>
						)
					)}

					{painted && (
						<>
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
							{/* Find takes the top of the stage while it's open, and the edit hint while editing (the first
							    page keeps its place below either way). A phone on its side shows neither the notice nor
							    the hint: with no height to spare, they'd sit on the page. */}
							{notice && (
								<div hidden={find.open || isEditing || short}>
									<StageNotice>{notice}</StageNotice>
								</div>
							)}
							{/* A quick look is a glance at the pages, with nothing over them */}
							{mode === 'open' && (
								<ZoomPill
									zoom={scale * 100}
									preset={zoom === 'auto' ? undefined : zoom}
									onZoomIn={() => stepZoom(1)}
									onZoomOut={() => stepZoom(-1)}
									onPreset={applyZoom}
									page={page}
									pageCount={pages.length}
									onPage={goToPage}
									target={area}
								/>
							)}
						</>
					)}
				</div>
			</div>
		</>
	)
}

// The page in view (the one most in view, the first between equals, or the last at the very end of the document) and
// the first and last pages on screen. Pages are looked at only from the first on screen, found by bisection: a long
// document costs a handful of reads.
function inView(scroller: HTMLElement, pages: HTMLElement[]) {
	const view = scroller.getBoundingClientRect()
	const end = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
	const first = pageAt(pages, view.top)
	let current = first
	let last = first
	let most = -Infinity
	for (let i = first; i < pages.length; i++) {
		const rect = pages[i].getBoundingClientRect()
		if (rect.top >= view.bottom) break
		last = i
		const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top)
		if (end || shown > most) {
			current = i
			most = shown
		}
	}
	return {current, first, last}
}

// The page at a height on screen: the first whose bottom reaches it (the next one, between pages)
function pageAt(pages: HTMLElement[], y: number): number {
	let low = 0
	let high = pages.length - 1
	while (low < high) {
		const middle = (low + high) >> 1
		if (pages[middle].getBoundingClientRect().bottom < y) low = middle + 1
		else high = middle
	}
	return low
}

// The scale fitting a page across the stage, or whole: the page in view, so a landscape page in a portrait document
// scrolls sideways rather than every page shrinking to fit it. Its size is the one the engine set at `scale` (asking
// layout for it would lay out every page).
function fitZoom(preset: ZoomPreset | 'auto', stage: Stage, page: HTMLElement, scale: number): number {
	if (typeof preset === 'number') return preset
	const space = spaceFor(stage)
	const fitWidth = ((stage.width - 2 * space) * scale) / parseFloat(page.style.width)
	if (preset === 'auto') return Math.min(1.25, fitWidth)
	if (preset === 'page-width') return fitWidth
	return Math.min(fitWidth, ((stage.height - 2 * space) * scale) / parseFloat(page.style.height))
}
