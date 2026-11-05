import {ChevronRight} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {materialSurfaceClasses} from '@/components/ui/shared/material'
import type {PdfSession} from '@/features/files/components/file-viewer/pdf-viewer'
import {safeHref} from '@/features/files/components/file-viewer/shared/links'
import {cn} from '@/lib/utils'

// A thumbnail fits this box; every row is the same height, so the list can
// be windowed without knowing every page's size
const THUMB = {width: 120, height: 156}
const ROW_HEIGHT = THUMB.height + 40
const LIST_PADDING = 20
const OVERSCAN = 2

type OutlineItem = Awaited<ReturnType<PdfSession['pdf']['getOutline']>>[number]

export function PdfSidebar({
	session,
	page,
	onPage,
	open,
}: {
	session: PdfSession
	page: number
	onPage: (page: number) => void
	open: boolean
}) {
	const {t} = useTranslation()
	const [tab, setTab] = useState<'pages' | 'outline'>('pages')
	// undefined while it's read, null when the document has none
	const [outline, setOutline] = useState<OutlineItem[] | null>()
	useEffect(() => {
		let live = true
		session.pdf.getOutline().then(
			(items) => live && setOutline(items?.length ? items : null),
			() => live && setOutline(null),
		)
		return () => void (live = false)
	}, [session])

	return (
		<section
			aria-label={t('files-pdf.pages-and-outline')}
			className={cn(materialSurfaceClasses.modal, 'flex h-full flex-col overflow-hidden')}
		>
			{outline && (
				<div className='px-3 pt-3'>
					<SegmentedControl
						value={tab}
						onValueChange={setTab}
						tabs={[
							{id: 'pages', label: t('files-pdf.pages-tab')},
							{id: 'outline', label: t('files-pdf.outline-tab')},
						]}
						className='w-full'
					/>
				</div>
			)}
			{tab === 'outline' && outline ? (
				<div className='umbrel-hide-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2'>
					<OutlineTree items={outline} session={session} />
				</div>
			) : (
				// Thumbnails only render while the sidebar is open
				open && <Thumbnails session={session} page={page} onPage={onPage} />
			)}
		</section>
	)
}

function Thumbnails({session, page, onPage}: {session: PdfSession; page: number; onPage: (page: number) => void}) {
	const {t} = useTranslation()
	const listRef = useRef<HTMLDivElement>(null)
	const count = session.pdf.numPages
	const [range, setRange] = useState({start: 0, end: 0})
	// Until a page is drawn it's a blank sheet the size page 1 would be
	const first = session.viewer.getPageView(0)
	const placeholder = fit(first.width / first.scale, first.height / first.scale)
	// Made in an effect so that unmounting — StrictMode's rehearsal included —
	// cancels its drawing and frees its images
	const [thumbnails, setThumbnails] = useState<Thumbnails>()
	useEffect(() => {
		const created = createThumbnails(session)
		setThumbnails(created)
		return () => created.destroy()
	}, [session])

	// Only the rows in view (and a couple either side) are built
	useLayoutEffect(() => {
		const list = listRef.current!
		const measure = () => {
			const start = Math.max(0, Math.floor((list.scrollTop - LIST_PADDING) / ROW_HEIGHT) - OVERSCAN)
			const end = Math.min(count, Math.ceil((list.scrollTop + list.clientHeight) / ROW_HEIGHT) + OVERSCAN)
			setRange((range) => (range.start === start && range.end === end ? range : {start, end}))
		}
		measure()
		list.addEventListener('scroll', measure, {passive: true})
		const observer = new ResizeObserver(measure)
		observer.observe(list)
		return () => {
			list.removeEventListener('scroll', measure)
			observer.disconnect()
		}
	}, [count])

	// The current page's thumbnail stays in view as the document scrolls
	useLayoutEffect(() => {
		const list = listRef.current!
		const top = LIST_PADDING + (page - 1) * ROW_HEIGHT
		if (top < list.scrollTop) list.scrollTop = top
		else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight)
			list.scrollTop = top + ROW_HEIGHT - list.clientHeight
	}, [page])

	const rows = []
	for (let index = range.start; index < range.end; index++) {
		const number = index + 1
		rows.push(
			<button
				key={number}
				type='button'
				onClick={() => onPage(number)}
				aria-label={t('files-pdf.go-to-page', {page: number})}
				aria-current={number === page ? 'page' : undefined}
				className='group absolute inset-x-0 flex flex-col items-center gap-2 outline-hidden'
				style={{top: LIST_PADDING + index * ROW_HEIGHT, height: ROW_HEIGHT}}
			>
				<div className='flex items-center justify-center' style={THUMB}>
					<Thumbnail thumbnails={thumbnails} placeholder={placeholder} page={number} current={number === page} />
				</div>
				<span
					className={cn(
						'rounded-full px-2 text-11 font-medium tabular-nums transition-colors',
						number === page ? 'bg-white/15 text-white' : 'text-white/45 group-hover:text-white/70',
					)}
				>
					{number}
				</span>
			</button>,
		)
	}

	return (
		<div ref={listRef} className='umbrel-hide-scrollbar min-h-0 flex-1 overflow-y-auto'>
			<div className='relative' style={{height: count * ROW_HEIGHT + 2 * LIST_PADDING}}>
				{rows}
			</div>
		</div>
	)
}

function Thumbnail({
	thumbnails,
	placeholder,
	page,
	current,
}: {
	thumbnails: Thumbnails | undefined
	placeholder: Size
	page: number
	current: boolean
}) {
	const [image, setImage] = useState(() => thumbnails?.get(page))
	useEffect(() => {
		if (image || !thumbnails) return
		return thumbnails.request(page, setImage)
	}, [thumbnails, page, image])
	const size = image ?? placeholder
	return (
		<div
			className={cn(
				'overflow-hidden rounded-[2px] bg-white shadow-[0_2px_8px_rgb(0_0_0/0.3)] outline-2 outline-offset-[3px] transition-[outline-color] duration-200',
				current
					? 'outline-white'
					: 'outline-transparent group-hover:outline-white/30 group-focus-visible:outline-white/70',
			)}
			style={{width: size.width, height: size.height}}
		>
			{image && (
				<img
					src={image.url}
					alt=''
					draggable={false}
					className='size-full motion-safe:animate-in motion-safe:fade-in'
				/>
			)}
		</div>
	)
}

type Thumbnails = ReturnType<typeof createThumbnails>
type Size = {width: number; height: number}
type Image = Size & {url: string}
type Ask = {onImage: (image: Image) => void}

// A page's size fitted into the thumbnail box, and the scale that fits it
function fit(width: number, height: number) {
	const scale = Math.min(THUMB.width / width, THUMB.height / height)
	return {width: Math.round(width * scale), height: Math.round(height * scale), scale}
}

// Draws thumbnails one at a time, in the order their rows asked (rows that
// scroll away take their request with them), as blob images: tens of KB each
// to keep, instead of a canvas apiece
function createThumbnails({pdf, eventBus}: PdfSession) {
	const images = new Map<number, Image>()
	// Each request is an object of its own, so a row that asks again (remounted,
	// say) is told from the request it replaced, though its callback is the same
	const waiting = new Map<number, Ask>()
	let drawing: {ask: Ask; cancel: () => void} | undefined
	let destroyed = false

	const next = async () => {
		const [page] = waiting.keys()
		if (drawing || destroyed || page === undefined) return
		const ask = waiting.get(page)!
		const cancelled = new AbortController()
		let task: {cancel: () => void} | undefined
		drawing = {ask, cancel: () => (cancelled.abort(), task?.cancel())}
		const canvas = document.createElement('canvas')
		try {
			const pdfPage = await pdf.getPage(page)
			if (cancelled.signal.aborted) throw new Error('Cancelled')
			const unit = pdfPage.getViewport({scale: 1})
			const {width, height, scale} = fit(unit.width, unit.height)
			const viewport = pdfPage.getViewport({scale: scale * Math.min(window.devicePixelRatio || 1, 3)})
			canvas.width = Math.round(viewport.width)
			canvas.height = Math.round(viewport.height)
			const render = pdfPage.render({canvas, viewport})
			task = render
			await render.promise
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
			if (!blob || cancelled.signal.aborted || destroyed) throw new Error('Cancelled')
			const image = {url: URL.createObjectURL(blob), width, height}
			images.set(page, image)
			waiting.get(page)?.onImage(image)
			waiting.delete(page)
			// pdf.js frees what the page holds if it isn't one of the viewer's own
			eventBus.dispatch('thumbnailrendered', {source: null, pageNumber: page, pdfPage})
		} catch {
			// Cancelled, or a page that can't be drawn: its blank sheet stays, and
			// it isn't tried again until its row asks anew
			if (waiting.get(page) === ask) waiting.delete(page)
		} finally {
			// Its pixels are let go of now, drawn or not, rather than whenever the
			// canvas is collected: WebKit counts them against the page until then
			// (pdf.js empties its own canvases the same way)
			canvas.width = canvas.height = 0
			drawing = undefined
			void next()
		}
	}

	return {
		get: (page: number) => images.get(page),
		// Returns the cancel for a row that scrolls away before it's drawn
		request(page: number, onImage: (image: Image) => void) {
			const ask = {onImage}
			waiting.delete(page)
			waiting.set(page, ask)
			void next()
			return () => {
				if (waiting.get(page) === ask) waiting.delete(page)
				if (drawing?.ask === ask) drawing.cancel()
			}
		},
		destroy() {
			destroyed = true
			drawing?.cancel()
			for (const image of images.values()) URL.revokeObjectURL(image.url)
		},
	}
}

// The document's own table of contents: a click goes to the place, a chevron
// opens a section (sections the PDF keeps closed start closed)
function OutlineTree({items, session, depth = 0}: {items: OutlineItem[]; session: PdfSession; depth?: number}) {
	return (
		<ul role={depth ? 'group' : 'tree'}>
			{items.map((item, index) => (
				<OutlineRow key={index} item={item} session={session} depth={depth} />
			))}
		</ul>
	)
}

function OutlineRow({item, session, depth}: {item: OutlineItem; session: PdfSession; depth: number}) {
	const {t} = useTranslation()
	const [open, setOpen] = useState((item.count ?? 0) >= 0)
	const hasItems = item.items.length > 0
	const go = () => {
		const href = safeHref(item.url ?? undefined)
		if (item.dest) void session.linkService.goToDestination(item.dest)
		else if (href) window.open(href, '_blank', 'noopener,noreferrer')
	}
	return (
		<li role='treeitem' aria-expanded={hasItems ? open : undefined}>
			<div className='flex items-center rounded-8 hover:bg-white/8' style={{paddingLeft: depth * 12}}>
				<button
					type='button'
					aria-label={open ? t('files-pdf.collapse') : t('files-pdf.expand')}
					onClick={() => setOpen(!open)}
					className={cn(
						'flex size-6 shrink-0 items-center justify-center rounded-full text-white/45 hover:text-white',
						!hasItems && 'invisible',
					)}
				>
					<ChevronRight
						className={cn(
							'size-3.5 transition-transform duration-200 motion-reduce:transition-none',
							open && 'rotate-90',
						)}
					/>
				</button>
				<button
					type='button'
					onClick={go}
					className={cn(
						'min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-12 text-white/80 hover:text-white',
						item.bold && 'font-semibold',
						item.italic && 'italic',
					)}
					title={item.title}
				>
					{item.title}
				</button>
			</div>
			{hasItems && open && <OutlineTree items={item.items} session={session} depth={depth + 1} />}
		</li>
	)
}
