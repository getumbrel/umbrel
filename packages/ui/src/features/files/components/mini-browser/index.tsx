import {ChevronRight, Loader2} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'

import {BACKUP_FILE_NAME} from '@/features/backups/utils/filepath-helpers'
import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import type {FileSystemItem} from '@/features/files/types'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

type MiniBrowserProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	// The root path to start the tree from
	rootPath: string
	// The path to expand to when the browser is opened
	onOpenPath?: string
	// If true (default), preselects onOpenPath when opened. Set false to require explicit selection.
	preselectOnOpen?: boolean
	onSelect?: (path: string) => void
	// Allow selecting files and folders, or only folders (defaults to files-and-folders)
	selectionMode?: 'files-and-folders' | 'folders'
	// Disabled paths
	disabledPaths?: string[]
	title?: string
	// optional actions to render in the browser. e.g., "add NAS" button to open the add NAS dialog
	actions?: React.ReactNode
}

// Visual indentation cap the Tree so it doesn't get too wide and overflow
const INDENT_PER_LEVEL = 16
const MAX_INDENT_LEVELS = 9
const MOBILE_MAX_INDENT_LEVELS = 6
// Number of ancestor segments (in addition to the final name) to include in the compact path label
const PATH_ANCESTORS_TO_SHOW = 1

// Truncates a path to a compact string with the given number of ancestors to show
// e.g., /a/b/c/d.txt -> a/b/c/d.txt -> …/d.txt
function formatCompactPath(path: string, ancestorsToShow: number) {
	const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
	const take = Math.max(1, Math.min(parts.length, ancestorsToShow + 1))
	const last = parts.slice(-take)
	const prefix = parts.length > last.length ? '…/' : ''
	return prefix + last.join('/')
}

// MAIN COMPONENT
export function MiniBrowser({
	open,
	onOpenChange,
	rootPath,
	disabledPaths = [],
	onOpenPath = rootPath,
	preselectOnOpen = true,
	onSelect,
	selectionMode = 'files-and-folders',
	title = t('mini-browser.default-title'),
	actions,
}: MiniBrowserProps) {
	const [selected, setSelected] = useState<{path: string; isDirectory: boolean} | null>(null)

	// Set selection on open if preselectOnOpen is true
	// e.g., if we want to show a previously selected path when the mini browser is opened
	useEffect(() => {
		if (!open) return
		if (preselectOnOpen) setSelected({path: onOpenPath, isDirectory: true})
		else setSelected(null)
	}, [open, onOpenPath, preselectOnOpen])

	const selectButtonLabel =
		selectionMode === 'files-and-folders' ? t('files-action.select') : t('mini-browser.select-folder')
	const isSelectionValid =
		!!selected &&
		(selectionMode === 'files-and-folders' || selected.isDirectory) &&
		!disabledPaths.includes(selected.path)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-w-[720px]'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>

				<div className='h-[min(60vh,480px)] overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-white/5 p-2'>
					{/* Optional actions to render in the browser. e.g., "add NAS" button to open the add NAS dialog */}
					{actions ? <div className='flex items-center justify-end'>{actions}</div> : null}

					{/* The tree of files and folders */}
					<Tree
						initialPath={rootPath}
						expandTo={onOpenPath}
						onSelect={(p, isDirectory) => setSelected({path: p, isDirectory})}
						selectedPath={selected?.path ?? null}
						selectionMode={selectionMode}
					/>
				</div>

				<DialogFooter className='mt-4'>
					<Button variant='primary' onClick={() => selected && onSelect?.(selected.path)} disabled={!isSelectionValid}>
						{selectButtonLabel}
					</Button>
					<Button variant='default' onClick={() => onOpenChange(false)}>
						{t('cancel')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// This Tree component renders the root of the tree (top-level nodes). Each Node can expand to show its Subtree.
// This component kicks off the recursive rendering: Tree -> Node -> Subtree -> Node -> ...
function Tree({
	initialPath,
	onSelect,
	selectedPath,
	expandTo,
	selectionMode,
}: {
	initialPath: string
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
}) {
	const {listing, isLoading} = useListDirectory(initialPath)

	const entries: FileSystemItem[] = useMemo(() => {
		return (listing?.items as FileSystemItem[]) ?? []
	}, [listing])

	return (
		<div className='space-y-1'>
			{isLoading ? (
				<div className='py-6 text-center text-white/60'>{t('files-listing.loading')}</div>
			) : entries.length === 0 ? (
				<div className='mt-28 flex flex-col items-center justify-center gap-3 text-center'>
					<div className='flex flex-col items-center gap-3'>
						<EmptyFolderIcon className='h-15 w-15' />
						<div className='w-3/4 text-12 text-white/80'>{t('backups.location-root-folder-empty')}</div>
					</div>
				</div>
			) : (
				entries.map((d) => (
					<Node
						key={d.path}
						entry={d}
						// depth=0 means root-level nodes
						depth={0}
						onSelect={onSelect}
						selectedPath={selectedPath}
						expandTo={expandTo}
						selectionMode={selectionMode}
					/>
				))
			)}
		</div>
	)
}

// This is a tree node that renders a single file or folder and, if expanded and it's a directory, its Subtree
function Node({
	entry,
	depth,
	onSelect,
	selectedPath,
	expandTo,
	selectionMode,
}: {
	entry: FileSystemItem
	depth: number
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
}) {
	const [expanded, setExpanded] = useState(false)
	const userInteractedRef = useRef(false)
	const isMobile = useIsSmallMobile()
	const maxIndentLevels = isMobile ? MOBILE_MAX_INDENT_LEVELS : MAX_INDENT_LEVELS

	const toggle = async () => {
		userInteractedRef.current = true
		setExpanded((prev) => !prev)
	}

	// Auto-expand toward target path, but respect user collapse afterwards
	useEffect(() => {
		if (!expandTo) return
		if (userInteractedRef.current) return
		const isSelfOrAncestor = expandTo === entry.path || expandTo.startsWith(entry.path + '/')
		const isDir = entry.type === 'directory'
		if (isSelfOrAncestor && !expanded && isDir) {
			setExpanded(true)
		}
	}, [expandTo, expanded, entry.path, entry.type])

	const isSelected = selectedPath === entry.path
	const isRepositoryDir = entry.type === 'directory' && entry.name === BACKUP_FILE_NAME
	const isSelectable = entry.type === 'directory' || selectionMode === 'files-and-folders'
	const isDisabled = isRepositoryDir || !isSelectable

	return (
		<div className='select-none'>
			<div
				className={cn(
					'flex min-w-0 items-center gap-2 rounded-md p-2',
					isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
					isSelected ? 'border border-brand bg-brand/15' : 'border border-transparent hover:bg-white/10',
				)}
				style={{paddingLeft: 8 + Math.min(depth, maxIndentLevels) * INDENT_PER_LEVEL}}
				onClick={() => {
					if (isDisabled) return
					onSelect(entry.path, entry.type === 'directory')
				}}
			>
				<ChevronRight
					className={cn(
						'size-4 shrink-0 transition-transform',
						expanded && 'rotate-90',
						(isRepositoryDir || entry.type !== 'directory') && 'opacity-0',
					)}
					onClick={(e) => {
						e.stopPropagation()
						if (isRepositoryDir || entry.type !== 'directory') return
						toggle()
					}}
				/>
				<FileItemIcon item={entry} className='size-5' />
				<span className='min-w-0 flex-1 truncate text-sm' title={entry.path}>
					{depth > maxIndentLevels ? formatCompactPath(entry.path, PATH_ANCESTORS_TO_SHOW) : entry.name}
				</span>
			</div>
			{expanded && entry.type === 'directory' && !isRepositoryDir && (
				<Subtree
					path={entry.path}
					depth={depth + 1}
					onSelect={onSelect}
					selectedPath={selectedPath}
					expandTo={expandTo}
					selectionMode={selectionMode}
				/>
			)}
		</div>
	)
}

// The Subtree renders the children of a directory (recursively)
function Subtree({
	path,
	depth,
	onSelect,
	selectedPath,
	expandTo,
	selectionMode,
}: {
	path: string
	depth: number
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
}) {
	const {listing, isLoading, fetchMoreItems} = useListDirectory(path)
	const children: FileSystemItem[] = useMemo(() => (listing?.items as FileSystemItem[]) ?? [], [listing])
	const hasMore = listing?.hasMore ?? false

	// Visual indentation for the Subtree
	// We need less indentation for mobile devices so the tree doesn't get too wide and become unreadable
	const isMobile = useIsSmallMobile()
	const maxIndentLevels = isMobile ? MOBILE_MAX_INDENT_LEVELS : MAX_INDENT_LEVELS
	const leftPad = 8 + Math.min(depth, maxIndentLevels) * INDENT_PER_LEVEL
	const folderName = useMemo(() => path.split('/').filter(Boolean).pop() || '/', [path])

	const [isLoadingMore, setIsLoadingMore] = useState(false)

	return (
		<div className='mt-1 space-y-1'>
			{children.map((c) => (
				<Node
					key={c.path}
					entry={c}
					depth={depth}
					onSelect={onSelect}
					selectedPath={selectedPath}
					expandTo={expandTo}
					selectionMode={selectionMode}
				/>
			))}
			{/* We render the "Load more" control when listing is paginated */}
			{!isLoading && children.length > 0 && hasMore && (
				<button
					type='button'
					onClick={async () => {
						if (isLoadingMore) return
						setIsLoadingMore(true)
						try {
							await fetchMoreItems()
						} finally {
							setIsLoadingMore(false)
						}
					}}
					className='flex w-full items-center gap-2 rounded-md p-2 text-sm text-white/80 hover:bg-white/10'
					style={{paddingLeft: leftPad}}
					aria-label={t('mini-browser.load-more-in-folder', {name: folderName})}
				>
					{isLoadingMore ? <Loader2 className='size-3 animate-spin opacity-70' /> : null}
					<span>
						{isLoadingMore ? t('mini-browser.loading-more') : t('mini-browser.load-more')}
						<span className='opacity-60'> · {folderName}</span>
					</span>
				</button>
			)}
		</div>
	)
}
