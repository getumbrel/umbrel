import {ChevronRight, FolderPlus, Loader2} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {toast} from 'sonner'

import {BACKUP_FILE_NAME} from '@/features/backups/utils/filepath-helpers'
import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import activeNasIcon from '@/features/files/assets/nas-icon-active.png'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import type {FileSystemItem} from '@/features/files/types'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {useIsMobile, useIsSmallMobile} from '@/hooks/use-is-mobile'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
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
	// Optional faded description below the title
	subtitle?: React.ReactNode
	// optional actions to render in the browser. e.g., "add NAS" button to open the add NAS dialog
	actions?: React.ReactNode
	// Optional function to determine which items are selectable
	selectableFilter?: (entry: FileSystemItem) => boolean
	// Allow creating new folders
	allowNewFolderCreation?: boolean
	// Custom button label (overrides default based on selectionMode)
	selectButtonLabel?: string
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
	subtitle,
	actions,
	selectableFilter,
	allowNewFolderCreation = false,
	selectButtonLabel,
}: MiniBrowserProps) {
	const [selected, setSelected] = useState<{path: string; isDirectory: boolean} | null>(null)
	const [newFolder, setNewFolder] = useState<(FileSystemItem & {isNew: boolean}) | null>(null)
	const utils = trpcReact.useUtils()
	const isMobile = useIsMobile()

	// Set selection on open if preselectOnOpen is true
	// e.g., if we want to show a previously selected path when the mini browser is opened
	useEffect(() => {
		if (!open) return
		if (preselectOnOpen) setSelected({path: onOpenPath, isDirectory: true})
		else setSelected(null)
		setNewFolder(null) // Clear any pending new folder when dialog opens
	}, [open, onOpenPath, preselectOnOpen])

	const finalSelectButtonLabel = selectButtonLabel ?? t('mini-browser.select')

	const isSelectionValid = (() => {
		// Must have a selection
		if (!selected) return false

		// Must not be in disabled paths
		if (disabledPaths.includes(selected.path)) return false

		// Use custom filter if provided
		if (selectableFilter) {
			return selectableFilter({
				path: selected.path,
				type: selected.isDirectory ? 'directory' : 'file',
				name: selected.path.split('/').pop() || '',
			} as FileSystemItem)
		}

		// Default validation based on selection mode
		// Allow both files and folders
		if (selectionMode === 'files-and-folders') return true

		// Only allow folders
		if (selectionMode === 'folders') return selected.isDirectory

		// Fallback: no valid selection
		return false
	})()

	const createFolder = trpcReact.files.createDirectory.useMutation({
		onSuccess: (_, {path}: {path: string}) => {
			setNewFolder(null)
			utils.files.list.invalidate()
			// Select the newly created folder
			setSelected({path, isDirectory: true})
		},
		onError: (error) => {
			toast.error(t('files-error.create-folder', {message: error.message}))
			setNewFolder(null)
		},
	})

	const currentPath = selected?.isDirectory ? selected.path : rootPath

	const handleNewFolder = () => {
		const parentPath = currentPath

		// Prevent folder creation at Network host level (folders here would be shares, not regular folders)
		// External device level is allowed
		if (isDirectoryANetworkDevice(parentPath)) return

		const name = t('files-folder')

		const timestamp = new Date().getTime()
		const newFolderItem: FileSystemItem & {isNew: boolean} = {
			name,
			path: parentPath + '/' + name,
			type: 'directory',
			size: 0,
			modified: timestamp,
			operations: [],
			isNew: true,
		}

		setNewFolder(newFolderItem)
		// Clear selection so the parent folder doesn't show selected while editing the new folder
		setSelected(null)
	}

	const newFolderButton = allowNewFolderCreation ? (
		<Button
			variant='default'
			onClick={handleNewFolder}
			disabled={!!newFolder || isDirectoryANetworkDevice(currentPath)}
			size='default'
			className={isMobile ? '' : 'mr-auto'}
		>
			<FolderPlus className={isMobile ? 'size-4' : 'mr-2 size-4'} />
			{t('files-action.new-folder')}
		</Button>
	) : null

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-w-[720px]'>
				<DialogHeader>
					<div className='flex items-center justify-between gap-2'>
						<div className='min-w-0 flex-1'>
							<DialogTitle>{title}</DialogTitle>
							{subtitle ? <p className='mt-1 text-xs text-white/60'>{subtitle}</p> : null}
						</div>
						{/* Show new folder button on mobile in header */}
						{isMobile && newFolderButton}
					</div>
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
						selectableFilter={selectableFilter}
						newFolder={newFolder}
						onCancelNewFolder={() => setNewFolder(null)}
						onCreateFolder={(path) => createFolder.mutate({path})}
					/>
				</div>

				<DialogFooter className='mt-4'>
					{/* Show new folder button on desktop in footer */}
					{!isMobile && newFolderButton}
					<Button variant='primary' onClick={() => selected && onSelect?.(selected.path)} disabled={!isSelectionValid}>
						{finalSelectButtonLabel}
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
	selectableFilter,
	newFolder,
	onCancelNewFolder,
	onCreateFolder,
}: {
	initialPath: string
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
	selectableFilter?: (entry: FileSystemItem) => boolean
	newFolder: (FileSystemItem & {isNew: boolean}) | null
	onCancelNewFolder: () => void
	onCreateFolder: (path: string) => void
}) {
	const {listing, isLoading} = useListDirectory(initialPath)

	// Tailored empty state message and icon for known roots
	const emptyStateText = useMemo(() => {
		if (initialPath.startsWith('/Network')) return t('mini-browser.empty-network')
		if (initialPath.startsWith('/External')) return t('mini-browser.empty-external')
		return t('files-empty.directory')
	}, [initialPath])

	const EmptyIcon = useMemo(() => {
		if (initialPath.startsWith('/Network'))
			return (props: {className?: string}) => (
				<img src={activeNasIcon} alt={t('nas')} className={props.className} draggable={false} />
			)
		if (initialPath.startsWith('/External'))
			return (props: {className?: string}) => (
				<img src={externalStorageIcon} alt={t('external-drive')} className={props.className} draggable={false} />
			)
		return EmptyFolderIcon
	}, [initialPath])

	const entries: FileSystemItem[] = useMemo(() => {
		return (listing?.items as FileSystemItem[]) ?? []
	}, [listing])

	// Check if the new folder should be rendered at this level
	const shouldRenderNewFolder = newFolder && newFolder.path.startsWith(initialPath + '/')
	const newFolderParent = newFolder ? newFolder.path.split('/').slice(0, -1).join('/') : ''
	const isNewFolderAtThisLevel = shouldRenderNewFolder && newFolderParent === initialPath

	return (
		<div className='space-y-1'>
			{isLoading ? (
				<div className='py-6 text-center text-white/60'>{t('files-listing.loading')}</div>
			) : entries.length === 0 && !isNewFolderAtThisLevel ? (
				<div className='mt-28 flex flex-col items-center justify-center gap-3 text-center'>
					<div className='flex flex-col items-center gap-3'>
						<div className='inline-flex size-[60px] items-center justify-center'>
							<EmptyIcon className={'max-h-full max-w-full opacity-40'} />
						</div>
						<div className='w-3/4 text-12 text-white/40'>{emptyStateText}</div>
					</div>
				</div>
			) : (
				<>
					{entries.map((d) => (
						<Node
							key={d.path}
							entry={d}
							// depth=0 means root-level nodes
							depth={0}
							onSelect={onSelect}
							selectedPath={selectedPath}
							expandTo={expandTo}
							selectionMode={selectionMode}
							selectableFilter={selectableFilter}
							newFolder={newFolder}
							onCancelNewFolder={onCancelNewFolder}
							onCreateFolder={onCreateFolder}
						/>
					))}
					{isNewFolderAtThisLevel && (
						<NewFolderNode entry={newFolder} depth={0} onCancel={onCancelNewFolder} onCreate={onCreateFolder} />
					)}
				</>
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
	selectableFilter,
	newFolder,
	onCancelNewFolder,
	onCreateFolder,
}: {
	entry: FileSystemItem
	depth: number
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
	selectableFilter?: (entry: FileSystemItem) => boolean
	newFolder: (FileSystemItem & {isNew: boolean}) | null
	onCancelNewFolder: () => void
	onCreateFolder: (path: string) => void
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

	// Auto-expand when a new folder is being created inside this directory
	useEffect(() => {
		if (!newFolder) return
		const newFolderParent = newFolder.path.split('/').slice(0, -1).join('/')
		const isDir = entry.type === 'directory'
		if (newFolderParent === entry.path && !expanded && isDir) {
			setExpanded(true)
		}
	}, [newFolder, expanded, entry.path, entry.type])

	const isSelected = selectedPath === entry.path
	// TODO: get rid of this, and have the backend return the repository directory as a file type instead
	const isRepositoryDir = entry.type === 'directory' && entry.name === BACKUP_FILE_NAME

	// Selection logic: when selectableFilter is provided we use it; otherwise use default directory/file rules
	const isSelectable = selectableFilter
		? selectableFilter(entry)
		: entry.type === 'directory' || selectionMode === 'files-and-folders'

	// Visual disabling: only show disabled state when NOT using selectableFilter (preserves expand/collapse UX)
	const isDisabled = !selectableFilter && !isSelectable
	const isFaded = (isDisabled || !isSelectable) && entry.type !== 'directory'

	return (
		<div className='select-none'>
			<div
				className={cn(
					'flex min-w-0 items-center gap-2 rounded-md p-2',
					isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
					isSelected ? 'border border-brand bg-brand/15' : 'border border-transparent hover:bg-white/10',
					isFaded && 'opacity-50',
				)}
				style={{paddingLeft: 8 + Math.min(depth, maxIndentLevels) * INDENT_PER_LEVEL}}
				onClick={() => {
					if (isDisabled || !isSelectable) return
					onSelect(entry.path, entry.type === 'directory')
				}}
				onDoubleClick={() => {
					if (isRepositoryDir || entry.type !== 'directory') return
					toggle()
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
					selectableFilter={selectableFilter}
					newFolder={newFolder}
					onCancelNewFolder={onCancelNewFolder}
					onCreateFolder={onCreateFolder}
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
	selectableFilter,
	newFolder,
	onCancelNewFolder,
	onCreateFolder,
}: {
	path: string
	depth: number
	onSelect: (p: string, isDirectory: boolean) => void
	selectedPath: string | null
	expandTo?: string
	selectionMode: 'folders' | 'files-and-folders'
	selectableFilter?: (entry: FileSystemItem) => boolean
	newFolder: (FileSystemItem & {isNew: boolean}) | null
	onCancelNewFolder: () => void
	onCreateFolder: (path: string) => void
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

	// Check if the new folder should be rendered at this level
	const newFolderParent = newFolder ? newFolder.path.split('/').slice(0, -1).join('/') : ''
	const isNewFolderAtThisLevel = newFolder && newFolderParent === path

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
					selectableFilter={selectableFilter}
					newFolder={newFolder}
					onCancelNewFolder={onCancelNewFolder}
					onCreateFolder={onCreateFolder}
				/>
			))}
			{isNewFolderAtThisLevel && (
				<NewFolderNode entry={newFolder} depth={depth} onCancel={onCancelNewFolder} onCreate={onCreateFolder} />
			)}
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

// NewFolderNode renders an inline editable input for creating a new folder
function NewFolderNode({
	entry,
	depth,
	onCancel,
	onCreate,
}: {
	entry: FileSystemItem & {isNew: boolean}
	depth: number
	onCancel: () => void
	onCreate: (path: string) => void
}) {
	const [name, setName] = useState(entry.name)
	const inputRef = useRef<HTMLInputElement>(null)
	const isMobile = useIsSmallMobile()
	const maxIndentLevels = isMobile ? MOBILE_MAX_INDENT_LEVELS : MAX_INDENT_LEVELS

	useEffect(() => {
		const timer = setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.focus()
				inputRef.current.select()
			}
		}, 100)
		return () => clearTimeout(timer)
	}, [])

	const handleSubmit = () => {
		const trimmedName = name.trim()
		if (!trimmedName) {
			onCancel()
			return
		}

		const parentPath = entry.path.split('/').slice(0, -1).join('/')
		const fullPath = `${parentPath}/${trimmedName}`
		onCreate(fullPath)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			e.stopPropagation()
			handleSubmit()
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			onCancel()
		}
	}

	const handleBlur = () => {
		handleSubmit()
	}

	return (
		<div className='select-none'>
			<div
				className={cn('flex min-w-0 items-center gap-2 rounded-md border border-brand bg-brand/15 p-2')}
				style={{paddingLeft: 8 + Math.min(depth, maxIndentLevels) * INDENT_PER_LEVEL}}
			>
				<ChevronRight className='size-4 shrink-0 opacity-0' />
				<FileItemIcon item={entry} className='size-5' />
				<input
					ref={inputRef}
					type='text'
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={handleKeyDown}
					onBlur={handleBlur}
					onClick={(e) => e.stopPropagation()}
					onDoubleClick={(e) => e.stopPropagation()}
					className='min-w-0 flex-1 truncate bg-transparent text-sm outline-none'
				/>
			</div>
		</div>
	)
}
