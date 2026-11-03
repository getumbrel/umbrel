import '@/features/files/components/file-viewer/pdf-viewer/pdf-viewer.css'

import {Lock, PanelLeft, PenLine, Search} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {PasswordInput} from '@/components/ui/input'
import {
	HIGHLIGHTS,
	MarkupToolbar,
	useMarkup,
	type SignatureRequest,
} from '@/features/files/components/file-viewer/pdf-viewer/markup'
import {
	AnnotationEditorType,
	AnnotationMode,
	EventBus,
	LinkTarget,
	noteIconPath,
	openPdf,
	PasswordResponses,
	PDFFindController,
	PDFLinkService,
	PDFViewer,
	TouchManager,
	type AnnotationEditorLayer,
	type AnnotationEditorUIManager,
	type PDFDocumentLoadingTask,
	type PDFDocumentProxy,
} from '@/features/files/components/file-viewer/pdf-viewer/pdfjs'
import {PdfSidebar} from '@/features/files/components/file-viewer/pdf-viewer/sidebar'
import {SignatureDialog} from '@/features/files/components/file-viewer/pdf-viewer/signature-dialog'
import {
	useViewerDetail,
	useViewerEscape,
	useViewerSave,
	ViewerTools,
} from '@/features/files/components/file-viewer/shell/context'
import {FindPill} from '@/features/files/components/file-viewer/shell/find-pill'
import {pageShortcut, pageTurn} from '@/features/files/components/file-viewer/shell/keys'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {ToolPill} from '@/features/files/components/file-viewer/shell/tool-button'
import {fileViewUrl} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {listenForPinch, zoomStep} from '@/features/files/components/file-viewer/shell/zoom'
import {ZoomPill, type ZoomPreset} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {LightboxButton} from '@/features/photos/components/viewer/lightbox-button'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'
import {isBeneathModal} from '@/utils/is-beneath-modal'

// A gesture's zoom is redrawn once it rests this long; until then the pages
// scale as they are
const ZOOM_DRAWING_DELAY = 400
// Space around a fitted page: beside it (wide and narrow stages), above and below
const GUTTER = {wide: 24, narrow: 16}
const PAGE_GAP = 16
const SIDEBAR_WIDTH = 208
const SIDEBAR_KEY = 'files:pdf-sidebar'
// A signature's height on the page, in points, as pdf.js sizes its own
const SIGNATURE_HEIGHT = 40

type Load =
	| {status: 'loading'}
	| {status: 'password'; attempt: number; incorrect: boolean; submit: (password: string) => void}
	| {status: 'error'; error: 'damaged' | 'missing' | 'unreachable'}
	| {status: 'ready'}

export type PdfSession = {
	pdf: PDFDocumentProxy
	viewer: PDFViewer
	eventBus: EventBus
	linkService: PDFLinkService
	// What looks after the annotation editors, once pdf.js has made it: for a
	// document that can be marked up, as its first page comes in
	readonly editors: AnnotationEditorUIManager | undefined
}

export default function PdfViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const query = useAuthorizedHttpUrlQuery(fileViewUrl(item.path))
	// pdf.js reads ranges from the URL it opened for as long as the document
	// is open, so the viewer holds on to the first one
	const [url, setUrl] = useState<string>()
	if (!url && query.status === 'ready') setUrl(query.url)
	const editable = mode === 'open' && !useIsFilesReadOnly() && item.operations.includes('writable')

	if (!url) {
		if (query.status !== 'error') return <StageLoading item={item} />
		return (
			<StageMessage item={item} title={t('files-pdf.unreachable-title')} detail={t('files-viewer.unreachable-detail')}>
				<button type='button' className={stageButtonClass} onClick={query.retry}>
					{t('try-again')}
				</button>
			</StageMessage>
		)
	}
	// Forms and markup are set up with pdf.js: another mode is another viewer
	return <PdfDocument key={`${mode}:${editable}`} item={item} mode={mode} url={url} editable={editable} />
}

function PdfDocument({item, mode, url, editable}: ViewerProps & {url: string; editable: boolean}) {
	const {t} = useTranslation()
	const isTouch = useIsTouchDevice()
	// Settled once: canvas limits and gestures are set up with pdf.js
	const [touch] = useState(isTouch)
	const containerRef = useRef<HTMLDivElement>(null)
	const findInputRef = useRef<HTMLInputElement>(null)
	const [stage, setStage] = useState<HTMLDivElement | null>(null)
	const [attempt, setAttempt] = useState(0)
	const [load, setLoad] = useState<Load>({status: 'loading'})
	const [session, setSession] = useState<PdfSession>()
	const [revision, setRevision] = useState<string>()
	const [painted, setPainted] = useState(false)
	const [page, setPage] = useState(1)
	const [scale, setScale] = useState(1)
	const [zoom, setZoom] = useState<ZoomPreset | 'auto'>('auto')
	const [find, setFind] = useState<{query: string; current: number; total: number; searching: boolean}>()
	// A quick look has no toolbar to show or hide it from, so it's the pages alone
	const [sidebar, setSidebar] = useState(() => mode === 'open' && readSidebar())
	const [signing, setSigning] = useState<SignatureRequest>()
	const markup = useMarkup(session, editable)
	const changes = useChanges(session, editable)

	// The viewer is built once per document; what it reports flows into state
	useEffect(() => {
		const container = containerRef.current!
		const abort = new AbortController()
		const {signal} = abort
		const eventBus = new EventBus()
		const linkService = new PDFLinkService({eventBus, externalLinkTarget: LinkTarget.BLANK})
		const findController = new PDFFindController({eventBus, linkService})
		// Two of these the types leave out: the signature seam, and the signal
		// that disconnects the viewer's own observers
		const options = {
			container,
			eventBus,
			linkService,
			findController,
			annotationMode: editable ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE,
			imageResourcesPath: noteIconPath,
			annotationEditorMode: editable ? AnnotationEditorType.NONE : AnnotationEditorType.DISABLE,
			annotationEditorHighlightColors: HIGHLIGHTS.map(({name, color}) => `${name}=${color}`).join(),
			// What iOS can paint in one canvas
			maxCanvasPixels: touch ? 5_242_880 : undefined,
			// pdf.js asks for a signature once its empty editor is on the page
			signatureManager: {
				getSignature: ({editor}: {editor: SignatureRequest}) => setSigning(editor),
				loadSignatures: () => {},
				renderEditButton: async () => null,
				destroy: () => {},
			},
			abortSignal: signal,
		}
		const viewer = new PDFViewer(options)
		linkService.setViewer(viewer)

		eventBus.on('pagesinit', () => {
			viewer.currentScale = fitScale(viewer, 'auto')
			setPage(1)
		})
		eventBus.on('pagechanging', ({pageNumber}: {pageNumber: number}) => setPage(pageNumber))
		eventBus.on('scalechanging', ({scale}: {scale: number}) => setScale(scale))
		eventBus.on('updatefindmatchescount', ({matchesCount}: {matchesCount: {current: number; total: number}}) =>
			setFind((find) => find && {...find, ...matchesCount}),
		)
		eventBus.on(
			'updatefindcontrolstate',
			({state, matchesCount}: {state: number; matchesCount: {current: number; total: number}}) =>
				// 3 is FindState.PENDING: pages are still being read
				setFind((find) => find && {...find, ...matchesCount, searching: state === 3}),
		)
		let editors: AnnotationEditorUIManager | undefined
		eventBus.on('annotationeditoruimanager', ({uiManager}: {uiManager: AnnotationEditorUIManager}) => {
			editors = uiManager
		})

		// Pinching — two fingers, a trackpad, ctrl and the wheel — zooms the
		// pages, never the window around them. pdf.js rounds scales to 1%; what
		// a slow pinch loses to that is carried into its next step.
		let carried = 1
		const pinch = (factor: number, clientX: number, clientY: number, pan?: number[]) => {
			const current = viewer.currentScale
			const target = Math.min(25, Math.max(0.1, current * factor * carried))
			const rounded = Math.round(target * 100) / 100
			carried = target / rounded
			// pdf.js measures the origin from the container's offset position
			const rect = container.getBoundingClientRect()
			const origin = [clientX - rect.left + container.offsetLeft, clientY - rect.top + container.offsetTop]
			viewer.updateScale({drawingDelay: ZOOM_DRAWING_DELAY, scaleFactor: rounded / current, origin, pan})
			setZoom(rounded)
		}
		new TouchManager({
			container,
			onPinching: ([x, y]: number[], previous: number, distance: number, dx: number, dy: number) =>
				pinch(distance / previous, x, y, [dx, dy]),
			onPinchEnd: () => (carried = 1),
			onPanning: (dx: number, dy: number) => viewer.panBy(dx, dy),
			signal,
		})
		listenForPinch(container, pinch, {gestures: !touch, signal})

		let task: PDFDocumentLoadingTask | undefined
		let attempts = 0
		const open = async () => {
			// The revision first: every byte pdf.js reads is then asked for as of
			// that revision, so a save is checked against exactly what was shown
			const probe = await fetch(url, {headers: {Range: 'bytes=0-0'}, signal})
			void probe.body?.cancel()
			if (!probe.ok) throw Object.assign(new Error(probe.statusText), {status: probe.status})
			const revision = probe.headers.get('ETag') ?? undefined
			task = openPdf(url, revision)
			task.onPassword = (submit: (password: string) => void, reason: number) =>
				setLoad({
					status: 'password',
					attempt: ++attempts,
					incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
					submit,
				})
			const pdf = await task.promise
			if (signal.aborted) return
			viewer.setDocument(pdf)
			linkService.setDocument(pdf)
			setRevision(revision)
			setSession({
				pdf,
				viewer,
				eventBus,
				linkService,
				get editors() {
					return editors
				},
			})
			setLoad({status: 'ready'})
			await viewer.onePageRendered
			if (signal.aborted) return
			setPainted(true)
			// Page Up/Down and Home/End scroll the document, and once it's opened
			// the arrows and Space too (a quick look keeps those for stepping and
			// closing)
			container.focus({preventScroll: true})
		}
		open().catch((error: {name?: string; status?: number}) => {
			if (signal.aborted) return
			const kind = error.name === 'InvalidPDFException' ? 'damaged' : error.status === 404 ? 'missing' : 'unreachable'
			setLoad({status: 'error', error: kind})
		})

		return () => {
			abort.abort()
			viewer.setDocument(null)
			linkService.setDocument(null)
			void task?.destroy()
		}
	}, [attempt, url, editable, touch])

	// Fits follow the stage — the window resizing, the sidebar sliding in. The
	// pages scale at once and are redrawn when the stage settles.
	useEffect(() => {
		if (!session || typeof zoom === 'number') return
		const container = containerRef.current!
		const size = {width: container.clientWidth, height: container.clientHeight}
		const observer = new ResizeObserver(() => {
			if (container.clientWidth === size.width && container.clientHeight === size.height) return
			size.width = container.clientWidth
			size.height = container.clientHeight
			const {viewer} = session
			viewer.updateScale({drawingDelay: ZOOM_DRAWING_DELAY, scaleFactor: fitScale(viewer, zoom) / viewer.currentScale})
		})
		observer.observe(container)
		return () => observer.disconnect()
	}, [session, zoom])

	const applyZoom = (preset: ZoomPreset) => {
		if (!session) return
		const {viewer} = session
		setZoom(preset)
		viewer.currentScale = fitScale(viewer, preset)
		// A fitted page is shown whole, with its margins (pdf.js scrolls it flush
		// with the top)
		if (preset === 'page-fit')
			containerRef.current!.scrollTop = viewer.getPageView(viewer.currentPageNumber - 1).div.offsetTop - PAGE_GAP
	}
	// Stepping zooms about the middle of what's in view
	const stepZoom = (direction: 1 | -1) => {
		if (!session) return
		const {viewer} = session
		const container = containerRef.current!
		const current = viewer.currentScale
		const target = zoomStep(current, direction)
		setZoom(target)
		viewer.updateScale({
			scaleFactor: target / current,
			origin: [container.offsetLeft + container.clientWidth / 2, container.offsetTop + container.clientHeight / 2],
		})
	}
	const goToPage = (target: number) => {
		if (!session) return
		session.viewer.currentPageNumber = target
		containerRef.current?.focus({preventScroll: true})
	}

	const runFind = (query: string, again = false, findPrevious = false) =>
		session?.eventBus.dispatch('find', {
			source: null,
			type: again ? 'again' : '',
			query,
			caseSensitive: false,
			entireWord: false,
			highlightAll: true,
			findPrevious,
			matchDiacritics: false,
		})
	const openFind = () => {
		setFind((find) => find ?? {query: '', current: 0, total: 0, searching: false})
		findInputRef.current?.select()
	}
	const closeFind = () => {
		setFind(undefined)
		session?.eventBus.dispatch('findbarclose', {source: null})
		containerRef.current?.focus({preventScroll: true})
	}

	// ⌘F finds, ⌘+ ⌘− ⌘0 zoom the pages rather than the window, and ←/→ turn
	// the page when nothing scrolls sideways
	useEffect(() => {
		if (!session) return
		const container = containerRef.current!
		const onKeyDown = (event: KeyboardEvent) => {
			if (isBeneathModal(container, event)) return
			if (pageShortcut(event, {find: openFind, zoom: stepZoom, actualSize: () => applyZoom(1)})) return
			const turn = pageTurn(event, container, mode)
			if (!turn || session.viewer.isHorizontalScrollbarEnabled) return
			event.preventDefault()
			if (turn > 0) session.viewer.nextPage()
			else session.viewer.previousPage()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	useViewerEscape(() => {
		if (!find) return markup.unwind()
		closeFind()
		return true
	})
	useViewerDetail(session ? t('files-viewer.pages', {count: session.pdf.numPages}) : undefined)
	useViewerSave(
		editable && session
			? {
					revision,
					serialize: changes.serialize,
					onSaved: (saved) => {
						setRevision(saved)
						changes.saved()
					},
				}
			: null,
		changes.dirty,
	)

	const showSidebar = (open: boolean) => {
		setSidebar(open)
		try {
			localStorage.setItem(SIDEBAR_KEY, String(open))
		} catch {
			// The preference just won't stick
		}
	}
	const sidebarOpen = sidebar && painted

	return (
		<>
			<ViewerTools>
				{painted && (
					<>
						<LightboxButton
							icon={PanelLeft}
							label={t('files-pdf.sidebar')}
							active={sidebar}
							onClick={() => showSidebar(!sidebar)}
							className='max-md:hidden'
						/>
						<LightboxButton
							icon={Search}
							label={t('files-viewer.find')}
							active={!!find}
							onClick={() => (find ? closeFind() : openFind())}
						/>
						{editable && (
							<ToolPill active={markup.on} onClick={markup.toggle}>
								<PenLine className='size-4 opacity-80' />
								{t('files-pdf.markup')}
							</ToolPill>
						)}
					</>
				)}
			</ViewerTools>

			<div ref={setStage} className='relative flex min-h-0 flex-1'>
				{/* The sidebar docks at the stage's left: the dock widens, the pages
				    make room, and the panel slides in from the edge in step with it,
				    so nothing clips it and its shadow falls across the stage. Shut,
				    it's hidden once it has slid away */}
				<aside
					inert={!sidebarOpen}
					className='shrink-0 transition-[width] duration-300 ease-out motion-reduce:transition-none max-md:hidden'
					style={{width: sidebarOpen ? SIDEBAR_WIDTH + 16 : 0}}
				>
					<div
						className={cn(
							'h-full pb-4 pl-4 transition-[translate,visibility] duration-300 ease-out motion-reduce:transition-none',
							sidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
						)}
						style={{width: SIDEBAR_WIDTH + 16}}
					>
						{session && <PdfSidebar session={session} page={page} onPage={goToPage} open={sidebarOpen} />}
					</div>
				</aside>

				<div className='relative min-w-0 flex-1'>
					<div
						ref={containerRef}
						tabIndex={-1}
						className={cn(
							'umbrel-pdf absolute inset-0 overflow-auto outline-none',
							'transition-opacity duration-300 motion-reduce:transition-none',
							painted ? 'opacity-100' : 'opacity-0',
							markup.on && 'umbrel-pdf-markup',
						)}
					>
						<div className='pdfViewer' />
					</div>

					{load.status === 'password' ? (
						<PasswordCard
							key={load.attempt}
							item={item}
							mode={mode}
							incorrect={load.incorrect}
							onSubmit={load.submit}
						/>
					) : load.status === 'error' ? (
						<div className='absolute inset-0 flex'>
							<StageMessage
								item={item}
								title={
									load.error === 'damaged'
										? t('files-pdf.damaged-title')
										: load.error === 'missing'
											? t('files-pdf.missing-title')
											: t('files-pdf.unreachable-title')
								}
								detail={
									load.error === 'damaged'
										? t('files-pdf.damaged-detail')
										: load.error === 'missing'
											? t('files-viewer.missing-detail')
											: t('files-viewer.unreachable-detail')
								}
							>
								{load.error === 'unreachable' ? (
									<button
										type='button'
										className={stageButtonClass}
										onClick={() => {
											setLoad({status: 'loading'})
											setAttempt((count) => count + 1)
										}}
									>
										{t('try-again')}
									</button>
								) : (
									load.error === 'damaged' && <StageDownload item={item} />
								)}
							</StageMessage>
						</div>
					) : (
						!painted && (
							<div className='absolute inset-0 flex'>
								<StageLoading item={item} />
							</div>
						)
					)}

					{painted && session && (
						<>
							{markup.on && <MarkupToolbar markup={markup} />}
							{find && (
								<FindPill
									inputRef={findInputRef}
									// Beneath the markup toolbar when that's up too
									className={markup.on ? 'top-16' : undefined}
									query={find.query}
									onQuery={(query) => {
										setFind({query, current: 0, total: 0, searching: !!query})
										runFind(query)
									}}
									current={find.current}
									total={find.total}
									searching={find.searching}
									onNext={() => runFind(find.query, true)}
									onPrevious={() => runFind(find.query, true, true)}
									onClose={closeFind}
								/>
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
									pageCount={session.pdf.numPages}
									onPage={goToPage}
									target={stage}
								/>
							)}
						</>
					)}
				</div>
			</div>

			{signing && (
				<SignatureDialog
					onAdd={(drawing) => {
						signing.addSignature(signing.getDrawnSignature(drawing), SIGNATURE_HEIGHT, t('files-pdf.signature'), null)
						setSigning(undefined)
					}}
					onCancel={() => {
						signing.remove()
						setSigning(undefined)
					}}
				/>
			)}
		</>
	)
}

// Whether the document differs from what was opened or last saved: what the
// annotation storage would write, compared as text. pdf.js's own "modified"
// can't tell: it rises when markup merely takes up a file's existing
// annotations (unchanged, they write nothing), and drops when a save starts,
// whether or not the save lands.
export function useChanges(session: PdfSession | undefined, editable: boolean) {
	const [dirty, setDirty] = useState(false)
	const saved = useRef('[]')
	const saving = useRef('[]')
	// The form's values as the file has them: pdf.js stores some as it draws
	// the fields, unchanged, and a field still holding its value isn't a change
	const fields = useRef(new Map<string, unknown>())
	// The page a drawing is going on, until pdf.js lets go of it. pdf.js says
	// nothing of a drawing in progress: it's noted as a stroke starts, and
	// forgotten as the tool changes, which always lets go of it, or as it's saved.
	const drawing = useRef<AnnotationEditorLayer>(undefined)
	const written = () => (session ? snapshot(session.pdf, fields.current) : '[]')

	useEffect(() => {
		if (!session || !editable) return
		const {pdf, eventBus} = session
		let ready = false
		// Every change is a hand's — a pointer, a key, a field — or lands in the
		// storage after one: look again once the event is through
		let frame = 0
		const check = () => {
			cancelAnimationFrame(frame)
			if (!ready) return
			frame = requestAnimationFrame(() =>
				setDirty(snapshot(pdf, fields.current) !== saved.current || hasPendingMarkup(session, drawing.current)),
			)
		}
		void pdf.getFieldObjects().then((objects) => {
			// A checkbox or radio is stored as whether it's on
			for (const widgets of objects?.values() ?? [])
				for (const {id, type, value, exportValues} of widgets as Field[])
					fields.current.set(id, type === 'checkbox' || type === 'radiobutton' ? value === exportValues : value)
			ready = true
			check()
		})
		// (typed as null by pdf.js, but they are its change callbacks)
		Object.assign(pdf.annotationStorage, {onSetModified: check, onResetModified: check})
		const events = ['pointerup', 'keyup', 'input', 'change', 'focusout'] as const
		for (const event of events) window.addEventListener(event, check, true)
		// A stroke starts at a press on a page's own markup layer, with Draw in hand
		const draw = (event: PointerEvent) => {
			const {editors} = session
			if (event.button !== 0 || editors?.getMode() !== AnnotationEditorType.INK) return
			const layer: AnnotationEditorLayer | null = editors.findParent(event.clientX, event.clientY)
			if (layer?.div === event.target) drawing.current = layer
		}
		const letGo = () => {
			drawing.current = undefined
			check()
		}
		window.addEventListener('pointerdown', draw, true)
		eventBus.on('annotationeditormodechanged', letGo)
		return () => {
			cancelAnimationFrame(frame)
			Object.assign(pdf.annotationStorage, {onSetModified: null, onResetModified: null})
			for (const event of events) window.removeEventListener(event, check, true)
			window.removeEventListener('pointerdown', draw, true)
			eventBus.off('annotationeditormodechanged', letGo)
		}
	}, [session, editable])

	return {
		dirty,
		// The original bytes with an incremental update carrying every change:
		// what's on disk now plays no part, so saving again is just as correct
		serialize: async () => {
			// The text being typed goes in too, as pdf.js's own ⌘S commits it, and
			// the drawing, let go of as a change of tool would. pdf.js places the
			// annotation that makes in the page's structure a task later.
			session!.editors?.commitOrRemove()
			const drawn = drawing.current?.endDrawingSession()
			drawing.current = undefined
			if (drawn) await new Promise((resolve) => setTimeout(resolve))
			saving.current = written()
			const bytes = await session!.pdf.saveDocument()
			return new Blob([bytes as Uint8Array<ArrayBuffer>], {type: 'application/pdf'})
		},
		saved: () => {
			saved.current = saving.current
			setDirty(written() !== saved.current || hasPendingMarkup(session, drawing.current))
		},
	}
}

// Markup reaches the storage only as pdf.js lets go of it, and a press on the
// chrome (Close, Save) never makes it: text typed into an annotation goes on
// blur, Escape, ⌘↩ or ⌘S, a drawing's strokes as the tool changes, on Escape or
// at a press elsewhere. Until then it's a change of its own. What can't be told
// apart without pdf.js's private state costs at most a needless prompt: a text
// box merely opened to edit it, and, while Draw stays in hand, strokes undone
// or cancelled by a pinch.
function hasPendingMarkup(session: PdfSession | undefined, drawing: AnnotationEditorLayer | undefined) {
	return session?.editors?.getActive()?.isEmpty() === false || !!drawing
}

type Field = {id: string; type: string; value: unknown; exportValues?: unknown}

function snapshot(pdf: PDFDocumentProxy, fields: Map<string, unknown>) {
	const entries = []
	for (const [key, value] of pdf.annotationStorage) {
		try {
			if (typeof value?.serialize === 'function') {
				const data = value.serialize(false, null)
				if (data) entries.push([key, data])
			} else if (!fields.has(key) || JSON.stringify(fields.get(key)) !== JSON.stringify(value.value)) {
				entries.push([key, value])
			}
		} catch {
			// An editor mid-stroke can't say yet: changed, for now
			entries.push([key, 'unsettled'])
		}
	}
	return JSON.stringify(entries)
}

// The scale fitting the current page to the stage. 'auto' is pdf.js's
// default: a portrait page fills the width, up to 125%; a wider one (a slide,
// say) fits whole — unless whole it would fill less than half the width, as on
// a phone on its side, where it fills the width too.
export function fitScale(viewer: PDFViewer, preset: ZoomPreset | 'auto') {
	if (typeof preset === 'number') return preset
	const {container} = viewer
	const page = viewer.getPageView(viewer.currentPageNumber - 1)
	const width = page.width / page.scale
	const height = page.height / page.scale
	const gutter = container.clientWidth < 768 ? GUTTER.narrow : GUTTER.wide
	const fitWidth = (container.clientWidth - 2 * gutter) / width
	const fitPage = Math.min(fitWidth, (container.clientHeight - 2 * PAGE_GAP) / height)
	if (preset === 'page-width') return fitWidth
	if (preset === 'page-fit') return fitPage
	return Math.min(1.25, height >= width || fitPage < fitWidth / 2 ? fitWidth : fitPage)
}

function readSidebar() {
	try {
		return localStorage.getItem(SIDEBAR_KEY) === 'true'
	} catch {
		return false
	}
}

// A locked document asks for its password where its pages will be. Every
// attempt gets a fresh card: a wrong password clears the field and says so.
// In an opened file the field takes the keyboard; a quick look keeps it for
// stepping and closing until the field is clicked or a password tried.
function PasswordCard({
	item,
	mode,
	incorrect,
	onSubmit,
}: ViewerProps & {
	incorrect: boolean
	onSubmit: (password: string) => void
}) {
	const {t} = useTranslation()
	const [password, setPassword] = useState('')
	const [checking, setChecking] = useState(false)
	return (
		<div className='absolute inset-0 flex items-center justify-center p-4'>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					if (!password || checking) return
					setChecking(true)
					onSubmit(password)
				}}
				className='flex w-full max-w-[380px] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 text-center shadow-dialog backdrop-blur-2xl contrast-more:bg-dialog-content contrast-more:backdrop-blur-none'
			>
				<div className='flex size-12 items-center justify-center rounded-full bg-white/8'>
					<Lock className='size-5 text-white/80' />
				</div>
				<div className='min-w-0'>
					<h3 className='text-15 font-semibold -tracking-2 break-words text-white/90'>
						{t('files-pdf.password-title', {name: item.name})}
					</h3>
					<p className='mt-1.5 text-13 text-white/40'>{t('files-pdf.password-detail')}</p>
				</div>
				<PasswordInput
					label={t('files-pdf.password')}
					value={password}
					onValueChange={setPassword}
					error={incorrect ? t('files-pdf.password-incorrect') : undefined}
					sizeVariant='short'
					autoFocus={mode === 'open' || incorrect}
					className='w-full text-left'
				/>
				<button type='submit' disabled={!password} className={cn(stageButtonClass, 'gap-2 disabled:opacity-40')}>
					{checking && <TbLoader className='size-3.5 animate-spin' />}
					{t('files-pdf.open')}
				</button>
			</form>
		</div>
	)
}
