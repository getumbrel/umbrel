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
import {useViewerDetail, ViewerTools} from '@/features/files/components/file-viewer/shell/context'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {ToolPill} from '@/features/files/components/file-viewer/shell/tool-button'
import {fileViewUrl, rangeReader} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {pillButtonClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {FolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {UnknownFileThumbnail} from '@/features/files/components/shared/file-item-icon/unknown-file-thumbnail'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
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
// As tall as the listing's list view rows: one line, or two on a phone
const ROW_HEIGHT = {desktop: 40, mobile: 50}

type Opened = {archive: ZipArchive; root: ArchiveFolder; count: number} | {error: ZipErrorCode | 'unreachable'}

// A ZIP archive's contents, as folders to browse. Only its central directory is read to list them, with HTTP Range
// requests (an archive can be many gigabytes); an entry's own bytes are read, inflated and checked only when it's
// downloaded, which an opened archive offers for each one.
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
	// Entries are downloaded only from an opened archive, never a quick look
	downloads: boolean
	downloading: ReadonlySet<ZipEntry>
	isMobile: boolean
	languageCode: SupportedLanguageCode
	onOpen: (folder: ArchiveFolder) => void
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

	useViewerDetail(
		[
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

	const download = async (entry: ZipEntry, name: string) => {
		setDownloading((busy) => new Set(busy).add(entry))
		try {
			const url = URL.createObjectURL(new Blob([await archive.bytes(entry.name)]))
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = name
			document.body.append(anchor)
			anchor.click()
			anchor.remove()
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
		downloads: mode === 'open',
		downloading,
		isMobile,
		languageCode,
		onOpen: (child) => go([...trail, child]),
		onDownload: (entry, name) => void download(entry, name),
	}

	return (
		// A quick look's step arrows sit over its edges, so its listing keeps clear of them
		<div className={cn('relative flex min-h-0 flex-1', mode === 'preview' ? 'px-14' : 'px-4 md:px-6')}>
			{mode === 'open' && count > 0 && <Uncompress item={item} />}
			<div className='settings-edge-material relative mx-auto flex min-h-0 w-full max-w-[1280px] flex-col overflow-hidden rounded-20 bg-black/50'>
				<div className='flex h-12 shrink-0 items-center gap-1 border-b border-white/6 px-2'>
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
	const date = formatFilesystemDate(isFolder ? node.modified : node.entry.modified, languageCode)
	const size = formatFilesystemSize(isFolder ? node.size : node.entry.size)
	const icon = <EntryIcon node={node} className={isMobile ? 'size-7 shrink-0' : 'size-5 shrink-0'} />
	const name = <span className='min-w-0 truncate'>{node.name}</span>
	const content = (
		<>
			{isMobile ? (
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
			)}
			<span className='flex w-10 shrink-0 justify-center'>
				{isFolder ? <ChevronRight className='size-4 text-white/30' /> : <EntryAction node={node} data={data} />}
			</span>
		</>
	)
	const rowClass = cn(
		'group flex size-full items-center rounded-lg text-left text-12 text-white/90 transition-colors',
		isMobile && 'gap-2 pl-3',
	)

	return (
		<div style={style} className='px-2'>
			{isFolder ? (
				<button
					type='button'
					onClick={() => data.onOpen(node)}
					className={cn(rowClass, 'hover:bg-white/6 focus-visible:bg-white/8 focus-visible:outline-hidden')}
				>
					{content}
				</button>
			) : (
				<div className={cn(rowClass, 'hover:bg-white/4')}>{content}</div>
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
	if (!data.downloads) return null
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
