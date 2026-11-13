import {Ban, ChevronLeft, ChevronRight, Download, Lock, PackageOpen} from 'lucide-react'
import {Fragment, useEffect, useRef, useState, type ComponentProps} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {FixedSizeList, type ListChildComponentProps} from 'react-window'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {toast} from '@/components/ui/toast'
import {
	buildTree,
	extensionOf,
	typeOf,
	type ArchiveFile,
	type ArchiveFolder,
	type ArchiveNode,
} from '@/features/files/components/file-viewer/archive-viewer/tree'
import {
	ZipArchive,
	ZipError,
	type ZipEntry,
	type ZipErrorCode,
} from '@/features/files/components/file-viewer/shared/zip'
import {useViewerDetail, useViewerShown, ViewerTools} from '@/features/files/components/file-viewer/shell/context'
import {
	StageBoundary,
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
	stageStep,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {ToolPill} from '@/features/files/components/file-viewer/shell/tool-button'
import {
	fileSource,
	FileSourceContext,
	fileViewUrl,
	rangeReader,
	type FileSource,
} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {pillButtonClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {viewers, type Viewer, type ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {FolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {UnknownFileThumbnail} from '@/features/files/components/shared/file-item-icon/unknown-file-thumbnail'
import {FILE_TYPE_MAP, RENDERED_IMAGE_TYPES} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import type {ViewerStep} from '@/features/files/store/slices/file-viewer-slice'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {getFileViewer, isUncertainType} from '@/features/files/utils/get-file-viewer'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'
import type {SupportedLanguageCode} from '@/utils/language'
import {formatNumberI18n} from '@/utils/number'

const LIMITS = {
	// Listing an archive fetches and parses its whole central directory, around a hundred bytes an entry: past this
	// many, that's tens of megabytes before anything shows
	maxEntries: 200_000,
	// An entry is downloaded from memory, held twice on the way (inflated, then as the download), which a phone can't
	// spare much of
	maxEntrySize: 2 ** 28,
	// Nothing is inflated just to list the archive
	maxTotalSize: Infinity,
}
// What an entry may weigh to be opened in its viewer: it's held in memory while it's open. A video plays from there as
// it is, so it may weigh what a download may. Anything else is read again by its viewer, whole and more than once: as
// much as the text editor takes, and no viewer takes less, so none is handed an entry only to turn it away for its
// size. A file whose name doesn't say what it is opens only if it starts as text, and finding out takes inflating all
// of it: that's only tried while it's small.
const MAX_OPEN_SIZE = {video: LIMITS.maxEntrySize, known: 50 * 2 ** 20, uncertain: 2 ** 20}
// As tall as the listing's list view rows: one line, or two on a phone
const ROW_HEIGHT = {desktop: 40, mobile: 50}

type Opened = {archive: ZipArchive; root: ArchiveFolder; count: number} | {error: ZipErrorCode | 'unreachable'}

// A file of the archive, shown in the listing's place, and the viewer that draws it, if one can
type Shown = {file: ArchiveFile; item: FileSystemItem; viewer: Viewer | undefined}
// Back from a file, the row the keyboard goes to, and what puts it there once that row is rendered: once only, so
// the row scrolled away and back doesn't take it again
type ReturnTo = {file: ArchiveFile; focus: (row: HTMLElement | null) => void}

// A ZIP archive's contents, as folders to browse. Only its central directory is read to list them, with HTTP Range
// requests (an archive can be many gigabytes); an entry's own bytes are read, inflated and checked only when it's
// downloaded or opened, which an opened archive offers for each one.
export default function ArchiveViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const view = useAuthorizedHttpUrlQuery(fileViewUrl(item.path))
	const [opened, setOpened] = useState<Opened>()
	const [attempt, setAttempt] = useState(0)

	useEffect(() => {
		if (view.status !== 'ready') return
		const abort = new AbortController()
		// Downloads read through it too, so closing the viewer stops them
		ZipArchive.read(item.size ?? 0, rangeReader(view.url, abort.signal), LIMITS).then(
			(archive) => !abort.signal.aborted && setOpened({archive, ...buildTree(archive.entries)}),
			(error: unknown) =>
				!abort.signal.aborted && setOpened({error: error instanceof ZipError ? error.code : 'unreachable'}),
		)
		return () => abort.abort()
	}, [view.status, view.url, item.size, attempt])

	const failure = view.status === 'error' ? 'unreachable' : opened && 'error' in opened ? opened.error : undefined
	if (failure === 'unreachable') {
		const retry = () => {
			setOpened(undefined)
			if (view.status === 'error') view.retry()
			else setAttempt((count) => count + 1)
		}
		return (
			<StageMessage
				item={item}
				title={t('files-archive.unreachable-title')}
				detail={t('files-viewer.unreachable-detail')}
			>
				<button type='button' className={stageButtonClass} onClick={retry}>
					{t('try-again')}
				</button>
			</StageMessage>
		)
	}
	if (failure) {
		const tooLarge = failure === 'limits'
		return (
			<StageMessage
				item={item}
				title={t(tooLarge ? 'files-archive.too-large-title' : 'files-archive.damaged-title')}
				detail={t(tooLarge ? 'files-archive.too-large-detail' : 'files-archive.damaged-detail')}
			>
				<StageDownload item={item} />
			</StageMessage>
		)
	}
	return opened && 'archive' in opened ? <Listing item={item} mode={mode} {...opened} /> : <StageLoading item={item} />
}

type RowData = {
	nodes: ArchiveNode[]
	archive: ZipArchive
	// Entries are opened and downloaded only from an opened archive, never a quick look
	opened: boolean
	downloading: ReadonlySet<ZipEntry>
	isMobile: boolean
	languageCode: SupportedLanguageCode
	returnTo: ReturnTo | undefined
	onOpen: (folder: ArchiveFolder) => void
	onShow: (file: ArchiveFile) => void
	onDownload: (entry: ZipEntry, name: string) => void
}

function Listing({
	item,
	mode,
	archive,
	root,
	count,
}: ViewerProps & {archive: ZipArchive; root: ArchiveFolder; count: number}) {
	const {t, i18n} = useTranslation()
	const [languageCode] = useLanguage()
	const isMobile = useIsMobile()
	// The folders opened on the way down from the archive's root
	const [trail, setTrail] = useState<ArchiveFolder[]>([])
	const folder = trail.at(-1) ?? root
	const listRef = useRef<HTMLDivElement>(null)
	const {width, height} = useContainerSize(listRef)
	// How far down each folder was scrolled, for coming back up to it
	const offsets = useRef(new Map<ArchiveFolder, number>())
	const [downloading, setDownloading] = useState<ReadonlySet<ZipEntry>>(new Set())
	// The listing stays as it was beneath a file shown in its place (its folder, scrolled where it was), and comes
	// back as stepping between files does
	const [shown, setShown] = useState<Shown>()
	const [returnTo, setReturnTo] = useState<ReturnTo>()
	const list = useRef<FixedSizeList<RowData>>(null)

	// A file shown in the listing's place has a detail of its own
	useViewerDetail(
		shown
			? undefined
			: [
					t('files-listing.item-count', {
						count,
						formattedCount: formatNumberI18n({n: count, showDecimals: false, locale: i18n.language}),
					}),
					root.size > 0 && t('files-archive.uncompressed', {size: formatFilesystemSize(root.size)}),
				]
					.filter(Boolean)
					.join(' · '),
	)

	// The row or crumb the keyboard was on goes with the folder, so the keyboard follows into the folder: onto its
	// list, where the page keys scroll, or the listing when it's empty
	const focusNext = useRef(false)
	const go = (next: ArchiveFolder[]) => {
		setTrail(next)
		focusNext.current = true
	}
	const focusIn = (element: HTMLElement | null) => {
		if (!element || !focusNext.current) return
		focusNext.current = false
		element.focus({preventScroll: true})
	}

	const show = (file: ArchiveFile) => {
		const viewer = viewerOf(archive, file)
		// Its code arrives as its bytes inflate
		void viewer?.preload().catch(() => {})
		setShown({file, item: entryItem(item, trail, file), viewer})
	}
	// Back from a file, the keyboard is on its row: the file last shown, which stepping may have moved on from the
	// one opened, so its row is scrolled to
	const back = () => {
		if (!shown) return
		list.current?.scrollToItem(folder.children.indexOf(shown.file))
		let pending = true
		const focus = (row: HTMLElement | null) => {
			if (!row || !pending) return
			pending = false
			row.focus({preventScroll: true})
		}
		setReturnTo({file: shown.file, focus})
		setShown(undefined)
	}
	// ←/→ step through the folder's files as the listing's do for an opened file: those that open in a viewer that
	// leaves the arrows to stepping
	const step = (direction: ViewerStep) => {
		if (!shown) return
		const files = folder.children.filter((node): node is ArchiveFile => {
			const viewer = node.kind === 'file' ? viewerOf(archive, node) : undefined
			return !!viewer && !viewer.ownsArrows
		})
		const at = files.indexOf(shown.file)
		const next = at < 0 ? undefined : files[direction === 'previous' || direction === 'up' ? at - 1 : at + 1]
		if (next) show(next)
	}

	const download = async (entry: ZipEntry, name: string) => {
		setDownloading((busy) => new Set(busy).add(entry))
		try {
			// Bytes to save, typed as umbreld serves a download: an object URL has our origin, and one without a type
			// leaves a browser that's asked to open it to guess what the bytes are
			const bytes = await archive.bytes(entry.name)
			const url = URL.createObjectURL(new Blob([bytes], {type: 'application/octet-stream'}))
			offerDownload(url, name)
			// Long enough for the browser to have taken the download from it
			setTimeout(() => URL.revokeObjectURL(url), 60_000)
		} catch (error) {
			// A download cut short by the viewer closing says nothing
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				toast.error(t('files-archive.download-failed', {name}), {area: 'files'})
			}
		} finally {
			setDownloading((busy) => new Set([...busy].filter((each) => each !== entry)))
		}
	}

	const data: RowData = {
		nodes: folder.children,
		archive,
		opened: mode === 'open',
		downloading,
		isMobile,
		languageCode,
		returnTo,
		onOpen: (child) => go([...trail, child]),
		onShow: show,
		onDownload: (entry, name) => void download(entry, name),
	}

	return (
		// A quick look's step arrows sit over its edges, so its listing keeps clear of them
		<div className={cn('relative flex min-h-0 flex-1', mode === 'preview' ? 'px-14' : 'px-4 md:px-6')}>
			{mode === 'open' && count > 0 && !shown && <Uncompress item={item} />}
			{/* First, so the stage's first place for the keyboard is the file's rather than the listing's behind it */}
			{shown && (
				<Entry
					key={shown.file.entry.name}
					{...shown}
					archive={archive}
					archiveItem={item}
					from={trail.at(-1)?.name ?? item.name}
					downloading={downloading.has(shown.file.entry)}
					onBack={back}
					onStep={step}
					onDownload={() => void download(shown.file.entry, shown.file.name)}
				/>
			)}
			<div
				inert={!!shown}
				className={cn(
					// Shown again at once, never transitioned (stageStep's duration would ease its visibility in too): its row
					// takes the keyboard back as it shows, and a row still hidden can't
					'settings-edge-material relative mx-auto flex min-h-0 w-full max-w-[1280px] flex-col overflow-hidden rounded-20 bg-black/50 transition-none',
					shown ? 'invisible' : returnTo && stageStep,
				)}
			>
				<div className='flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 contrast-more:border-white/25'>
					<button
						type='button'
						aria-label={t('back')}
						disabled={trail.length === 0}
						onClick={() => go(trail.slice(0, -1))}
						className={pillButtonClass}
					>
						<ChevronLeft className='size-4' />
					</button>
					<div className='flex min-w-0 items-center overflow-hidden text-13 -tracking-2'>
						{[root, ...trail].map((crumb, depth) => (
							<Fragment key={depth}>
								{depth > 0 && <ChevronRight className='size-3.5 shrink-0 text-white/30' />}
								{depth === trail.length ? (
									<span
										aria-current='location'
										className='max-w-full shrink-0 truncate px-1.5 font-medium text-white/90'
									>
										{depth === 0 ? item.name : crumb.name}
									</span>
								) : (
									<button
										type='button'
										onClick={() => go(trail.slice(0, depth))}
										className='min-w-0 truncate rounded-md px-1.5 py-0.5 text-white/55 transition-colors hover:bg-white/6 hover:text-white/90 focus-visible:bg-white/6 focus-visible:outline-hidden'
									>
										{depth === 0 ? item.name : crumb.name}
									</button>
								)}
							</Fragment>
						))}
					</div>
				</div>

				{/* Column titles, as the listing's list view has them */}
				{!isMobile && (
					<div className='flex shrink-0 px-2 pt-1 text-12 text-white/50'>
						<span className='flex-[5] p-2.5'>{t('files-sort.name')}</span>
						<span className='flex-[2] p-2.5'>{t('files-sort.modified')}</span>
						<span className='flex-1 p-2.5'>{t('files-sort.size')}</span>
						<span className='w-10 shrink-0' />
					</div>
				)}

				<div ref={listRef} tabIndex={-1} className='min-h-0 flex-1 pb-2 outline-hidden'>
					{folder.children.length === 0 ? (
						<p
							ref={focusIn}
							tabIndex={-1}
							className='flex h-full items-center justify-center text-12 text-white/40 outline-hidden'
						>
							{t('files-listing.empty')}
						</p>
					) : (
						<FixedSizeList
							ref={list}
							// A list of its own for each folder, scrolled to where it was left
							key={trail.map((each) => each.name).join('/')}
							width={width}
							height={height}
							itemCount={folder.children.length}
							itemSize={isMobile ? ROW_HEIGHT.mobile : ROW_HEIGHT.desktop}
							itemData={data}
							outerRef={focusIn}
							outerElementType={Scroller}
							initialScrollOffset={offsets.current.get(folder) ?? 0}
							onScroll={({scrollOffset}) => offsets.current.set(folder, scrollOffset)}
							overscanCount={10}
						>
							{Row}
						</FixedSizeList>
					)}
				</div>
			</div>
		</div>
	)
}

// The list's scrolling element, focusable so the page keys scroll it
function Scroller(props: ComponentProps<'div'>) {
	return <div tabIndex={-1} {...props} className='outline-hidden' />
}

function Row({index, style, data}: ListChildComponentProps<RowData>) {
	const {nodes, isMobile, languageCode} = data
	const node = nodes[index]
	const isFolder = node.kind === 'folder'
	// A file opens as a folder does, in its viewer or to say why it can't be, unless the archive can't read it
	const opens = !isFolder && data.opened && !data.archive.refusal(node.entry.name)
	const date = formatFilesystemDate(isFolder ? node.modified : node.entry.modified, languageCode)
	const size = formatFilesystemSize(isFolder ? node.size : node.entry.size)
	const icon = <EntryIcon node={node} className={isMobile ? 'size-7 shrink-0' : 'size-5 shrink-0'} />
	const name = <span className='min-w-0 truncate'>{node.name}</span>
	const columns = isMobile ? (
		<>
			{icon}
			<span className='flex min-w-0 flex-1 flex-col'>
				{name}
				<span className='truncate text-11 text-white/40'>{date}</span>
			</span>
			<span className='shrink-0 pl-2 text-11 whitespace-nowrap text-white/40'>{size}</span>
		</>
	) : (
		<>
			<span className='flex min-w-0 flex-[5] items-center gap-1.5 p-2.5'>
				{icon}
				{name}
			</span>
			<span className='flex-[2] truncate p-2.5 text-white/60'>{date}</span>
			<span className='flex-1 truncate p-2.5 text-white/60'>{size}</span>
		</>
	)
	const trailing = (
		<span className='flex w-10 shrink-0 justify-center'>
			{isFolder ? <ChevronRight className='size-4 text-white/30' /> : <EntryAction node={node} data={data} />}
		</span>
	)
	const rowClass = 'group flex size-full items-center rounded-lg text-left text-12 text-white/90 transition-colors'
	const spacing = isMobile && 'gap-2 pl-3'

	return (
		<div style={style} className='px-2'>
			{isFolder ? (
				<button
					type='button'
					onClick={() => data.onOpen(node)}
					className={cn(rowClass, spacing, 'hover:bg-white/6 focus-visible:bg-white/8 focus-visible:outline-hidden')}
				>
					{columns}
					{trailing}
				</button>
			) : opens ? (
				// Its download's button can't sit in the row's: it sits beside it
				<div className={cn(rowClass, isMobile && 'gap-2', 'hover:bg-white/6 has-[>button:focus-visible]:bg-white/8')}>
					<button
						ref={data.returnTo?.file === node ? data.returnTo.focus : undefined}
						type='button'
						onClick={() => data.onShow(node)}
						className={cn('flex min-w-0 flex-1 items-center self-stretch text-left outline-hidden', spacing)}
					>
						{columns}
					</button>
					{trailing}
				</div>
			) : (
				<div className={cn(rowClass, spacing, 'hover:bg-white/4')}>
					{columns}
					{trailing}
				</div>
			)}
		</div>
	)
}

// Downloading the entry, or why it can't be read: said on hover and on a press, as a phone has no hover
function EntryAction({node: {entry, name}, data}: {node: ArchiveFile; data: RowData}) {
	const {t} = useTranslation()
	const refusal = data.archive.refusal(entry.name)
	if (refusal) {
		const reason = t(
			refusal === 'encrypted'
				? 'files-archive.encrypted'
				: refusal === 'unsupported'
					? 'files-archive.unsupported'
					: refusal === 'limits'
						? 'files-archive.too-large'
						: 'files-archive.damaged',
		)
		const Icon = refusal === 'encrypted' ? Lock : Ban
		return (
			<DarkTooltip label={reason}>
				<button
					type='button'
					aria-label={reason}
					onClick={() => toast.info(reason, {id: 'files-archive-refusal', area: 'files'})}
					className={cn(pillButtonClass, 'text-white/45')}
				>
					<Icon className='size-3.5' />
				</button>
			</DarkTooltip>
		)
	}
	if (!data.opened) return null
	const busy = data.downloading.has(entry)
	return (
		<DarkTooltip label={t('files-viewer.download')}>
			<button
				type='button'
				aria-label={t('files-archive.download', {name})}
				disabled={busy}
				onClick={() => data.onDownload(entry, name)}
				className={cn(
					pillButtonClass,
					'disabled:opacity-100',
					// With the row's hover or the keyboard on it, and always on a touch screen, which has no hover
					!busy && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
				)}
			>
				{busy ? <TbLoader className='size-4 animate-spin' /> : <Download className='size-4' />}
			</button>
		</DarkTooltip>
	)
}

const entryType = (name: string) => typeOf(name) ?? 'application/octet-stream'

// The viewer an entry opens in, if one can draw it: the one for the type its name says, as for a file of that name
// on disk (an extensionless README is text, if it starts as text), when the archive can read it and it's light enough
// to hold (see MAX_OPEN_SIZE). Not audio, whose island would play on past the archive; nor a picture shown from the
// rendition umbreld makes of a file on disk; nor an archive in the archive, which would nest.
function viewerOf(archive: ZipArchive, {name, entry}: ArchiveFile): Viewer | undefined {
	const type = entryType(name)
	const viewer = getFileViewer({name, type})
	const maxSize = isUncertainType({name, type})
		? MAX_OPEN_SIZE.uncertain
		: viewer === viewers.video
			? MAX_OPEN_SIZE.video
			: MAX_OPEN_SIZE.known
	const opens =
		viewer &&
		!viewer.island &&
		viewer !== viewers.archive &&
		!RENDERED_IMAGE_TYPES.has(type) &&
		!archive.refusal(entry.name) &&
		entry.size <= maxSize
	return opens ? viewer : undefined
}

// The entry as its viewer takes it: a file of the type its name says, where the listing shows it, with nothing that
// can be done to it (no viewer offers a change, and the shell never saves one). It isn't on the server, so there's no
// thumbnail to ask it for: its icon is its kind's, as in the listing.
const entryItem = (
	archiveItem: FileSystemItem,
	trail: ArchiveFolder[],
	{name, entry}: ArchiveFile,
): FileSystemItem => ({
	name,
	// Only ever a key: nothing asks the server for it
	path: [archiveItem.path, ...trail.map((folder) => folder.name), name].join('/'),
	type: entryType(name),
	size: entry.size,
	modified: entry.modified,
	operations: [],
	thumbnail: '',
})

// Hands the browser a file to save, as a link to it would
function offerDownload(url: string, name: string) {
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = name
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
}

// The keyboard goes with the stage: onto an entry shown over the listing, which it leaves inert
const focusOnMount = (element: HTMLElement | null) => element?.focus({preventScroll: true})

// An entry, shown on the stage in the listing's place: inflated into memory, one at a time (stepping on lets go of
// one still being read), and read from there by its viewer; with none to draw it, offered to download. The shell
// titles it, downloads it and steps through its folder.
function Entry({
	archive,
	archiveItem,
	file,
	item,
	viewer,
	from,
	downloading,
	onBack,
	onStep,
	onDownload,
}: Shown & {
	archive: ZipArchive
	archiveItem: FileSystemItem
	from: string
	downloading: boolean
	onBack: () => void
	onStep: (direction: ViewerStep) => void
	onDownload: () => void
}) {
	const {t} = useTranslation()
	// Its bytes in memory, or why they couldn't be read
	const [read, setRead] = useState<FileSource | 'damaged' | 'unreachable'>()
	const [attempt, setAttempt] = useState(0)
	const source = typeof read === 'object' ? read : undefined
	useViewerShown({
		item,
		viewer,
		// From memory once it's there; with no viewer, it's read only as it's downloaded
		download: source ? () => offerDownload(source.url, item.name) : !viewer && !downloading ? onDownload : undefined,
		from,
		back: onBack,
		step: onStep,
	})

	useEffect(() => {
		if (!viewer) return
		const abort = new AbortController()
		let url: string | undefined
		archive.bytes(file.entry.name, abort.signal).then(
			(bytes) => {
				if (abort.signal.aborted) return
				const source = fileSource(bytes, item.type)
				url = source.url
				setRead(source)
			},
			(error: unknown) => !abort.signal.aborted && setRead(error instanceof ZipError ? 'damaged' : 'unreachable'),
		)
		return () => {
			abort.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [archive, file, item.type, viewer, attempt])

	return (
		<div ref={focusOnMount} tabIndex={-1} className={cn('absolute inset-0 flex flex-col outline-hidden', stageStep)}>
			{!viewer ? (
				// As for a file on disk with no viewer, unless one would open it out of the archive
				<StageMessage
					item={item}
					title={t(getFileViewer(item) ? 'files-archive.unopenable-title' : 'files-viewer.unsupported-title')}
					detail={t('files-viewer.unsupported-detail')}
				>
					<button type='button' disabled={downloading} onClick={onDownload} className={cn(stageButtonClass, 'gap-2')}>
						{downloading && <TbLoader className='size-4 animate-spin' />}
						{t('files-viewer.download')}
					</button>
				</StageMessage>
			) : source ? (
				<FileSourceContext value={source}>
					<StageBoundary item={item}>
						<viewer.Component item={item} mode='open' />
					</StageBoundary>
				</FileSourceContext>
			) : read === 'damaged' ? (
				<StageMessage item={item} title={t('files-archive.damaged')} detail={t('files-archive.damaged-entry-detail')}>
					<StageDownload item={archiveItem} label={t('files-archive.download', {name: archiveItem.name})} />
				</StageMessage>
			) : read === 'unreachable' ? (
				<StageMessage
					item={item}
					title={t('files-viewer.unreachable-title')}
					detail={t('files-viewer.unreachable-detail')}
				>
					<button
						type='button'
						className={stageButtonClass}
						onClick={() => {
							setRead(undefined)
							setAttempt((count) => count + 1)
						}}
					>
						{t('try-again')}
					</button>
				</StageMessage>
			) : (
				<StageLoading item={item} />
			)}
		</div>
	)
}

// The listing's icon for what an entry's name says it is, never its thumbnail: only a file on disk has one
function EntryIcon({node, className}: {node: ArchiveNode; className: string}) {
	if (node.kind === 'folder') return <FolderIcon className={className} />
	const type = typeOf(node.name)
	const Thumbnail = (type && FILE_TYPE_MAP[type].thumbnail) as React.ComponentType<{className?: string}> | undefined
	if (Thumbnail) return <Thumbnail className={className} />
	// Kinds Files doesn't know are told apart by colour, as the listing does
	return <UnknownFileThumbnail type={extensionOf(node.name)} className={className} />
}

// The listing's Uncompress, which extracts the archive beside itself: it spins until the new folder is there
function Uncompress({item}: {item: FileSystemItem}) {
	const {t} = useTranslation()
	const readOnly = useIsFilesReadOnly()
	const {extractItems} = useFilesOperations()
	const uncompressing = useFilesStore((s) => s.pendingPaths.get(item.path) === 'processing')
	// The folder it's in takes the contents, so it must be writable, as the listing asks too
	const folder = trpcReact.files.pathOperations.useQuery(
		{path: item.path.slice(0, item.path.lastIndexOf('/'))},
		{enabled: !readOnly},
	)
	if (readOnly || !canPerformFileOperation(item, 'unarchive') || !folder.data?.includes('writable')) return null
	return (
		<ViewerTools>
			<ToolPill disabled={uncompressing} aria-busy={uncompressing} onClick={() => void extractItems([item])}>
				{uncompressing ? <TbLoader className='size-4 animate-spin' /> : <PackageOpen className='size-4 opacity-80' />}
				{t('files-action.uncompress')}
			</ToolPill>
		</ViewerTools>
	)
}
