import {t} from 'i18next'
import {useTranslation} from 'react-i18next'
import {take} from 'remeda'

import {LOADING_DASH} from '@/constants'
// Files-specific utilities
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import type {BaseWidget, Link, RegistryWidget} from '@/modules/widgets/shared/constants'
import {glassCellClass, glassCellInteractiveClass} from '@/modules/widgets/shared/glass-cell'
import {FileName} from '@/modules/widgets/shared/text'
import {
	compactContainerClass,
	compactLabelClass,
	widgetCaptionClass,
	WidgetShell,
} from '@/modules/widgets/shared/widget-shell'

export type FilesListWidget = BaseWidget & {
	type: 'files-list'
	link?: Link
	items?: FileSystemItem[]
	noItemsText?: string
}

export type FilesGridWidget = BaseWidget & {
	type: 'files-grid'
	link?: Link
	paths?: FileSystemItem['path'][]
	noItemsText?: string
}

export const filesWidgetTypes = ['files-list', 'files-grid'] as const

// Dummy files widgets for the widget selector
const dummyFileAttributes = {
	modified: Date.now(),
	size: 100,
	operations: [],
}
export const filesWidgets: RegistryWidget<'files-list' | 'files-grid'>[] = [
	{
		// These widgets are Umbrel widgets, so they are always prefixed with
		// `umbrel:`. The suffixes (here `files-recents` and `files-favorites`)
		// must match the key that we register in
		// packages/umbreld/source/modules/files/widgets.ts
		id: 'umbrel:files-recents',
		type: 'files-list',
		example: {
			items: [
				{name: 'Notes.txt', path: '/Home/notes.txt', type: 'text/plain', ...dummyFileAttributes},
				{name: 'Vacation.jpg', path: '/Home/vacation-photo.jpg', type: 'image/jpeg', ...dummyFileAttributes},
				{
					name: 'Report.docx',
					path: '/Home/report.docx',
					type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					...dummyFileAttributes,
				},
			],
			noItemsText: t('files-widgets.recents.no-items-text'),
		},
	},
	{
		id: 'umbrel:files-favorites',
		type: 'files-grid',
		example: {
			paths: ['/Home/Downloads', '/Home/Photos', '/Home/Videos', '/Home/Documents'],
			noItemsText: t('files-widgets.favorites.no-items-text'),
		},
	},
]

interface FilesListWidgetProps {
	items?: FileSystemItem[]
	link?: Link
	noItemsText?: string
	onClick?: (link?: string) => void
}

interface FilesGridWidgetProps {
	paths?: FileSystemItem['path'][]
	link?: Link
	noItemsText?: string
	onClick?: (link?: string) => void
}

// List widget (Recents). Rows open the file; the rest of the widget opens Files.
export function FilesListWidget({
	items,
	link,
	noItemsText = 'files-widgets.recents.no-items-text',
	onClick,
}: FilesListWidgetProps) {
	const {t} = useTranslation()
	const {navigateToItem} = useNavigate()
	return (
		<WidgetShell
			onClick={() => onClick?.(link)}
			compact={<CompactRecents items={items} onOpen={navigateToItem} />}
			className='gap-0.5 overflow-hidden px-2 pt-2 w-tall:gap-1 w-tall:pt-3'
		>
			<p className={cn(widgetCaptionClass, 'px-1')}>{t('files-sidebar.recents')}</p>

			{/* Empty state */}
			{items?.length === 0 ? (
				<p className='grid flex-1 place-items-center px-1 pb-4 text-center text-11 opacity-50'>{t(noItemsText)}</p>
			) : (
				(items ?? [undefined, undefined, undefined])
					.slice(0, 3)
					.map((item, i) =>
						item ? (
							<ListItem key={item.path} item={item} onOpen={() => navigateToItem(item)} />
						) : (
							<SkeletonListItem key={i} />
						),
					)
			)}
		</WidgetShell>
	)
}

function SkeletonListItem() {
	return (
		<div className='flex items-center gap-1.5 px-1 py-1'>
			<span className='size-5 shrink-0 animate-pulse rounded-3 bg-white/10 w-expanded:size-7' />
			<span className='h-2 w-3/5 animate-pulse rounded-full bg-white/10' />
		</div>
	)
}

function ListItem({item, onOpen}: {item: FileSystemItem; onOpen: () => void}) {
	return (
		<div
			role='button'
			tabIndex={0}
			onClick={(e) => {
				// The row opens the file, not Files
				e.stopPropagation()
				onOpen()
			}}
			className='flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-white/10 w-expanded:gap-2'
		>
			<FileItemIcon item={item} className='size-5 max-w-5 shrink-0 w-expanded:size-7 w-expanded:max-w-7' />
			{/* Cut in the middle, so the extension stays */}
			<FileName name={item.name} className='text-12 text-white/85 w-expanded:text-13' />
		</div>
	)
}

// Recent files, one line each. Just the start of each name: the icon already says the type
function CompactRecents({items, onOpen}: {items?: FileSystemItem[]; onOpen: (item: FileSystemItem) => void}) {
	const {t} = useTranslation()
	return (
		<div className={cn(compactContainerClass, 'gap-1.5 px-2')}>
			<div className={cn(compactLabelClass, 'px-0.5')}>{t('files-sidebar.recents')}</div>
			{items
				? take(items, 3).map((item) => (
						<div
							key={item.path}
							role='button'
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation()
								onOpen(item)
							}}
							className='flex min-w-0 items-center gap-1 rounded-5 px-0.5 transition-colors hover:bg-white/10'
						>
							<FileItemIcon item={item} className='size-4 max-w-4 shrink-0' />
							<FileName name={item.name} className='text-11 leading-4 text-white/85' />
						</div>
					))
				: [0, 1, 2].map((i) => (
						<div key={i} className='flex items-center gap-1 px-0.5'>
							<span className='size-4 shrink-0 animate-pulse rounded-3 bg-white/10' />
							<span className='h-2 w-3/5 animate-pulse rounded-full bg-white/10' />
						</div>
					))}
		</div>
	)
}

// Grid widget (Favourites)
export function FilesGridWidget({
	paths,
	noItemsText = 'files-widgets.favorites.no-items-text',
	link,
	onClick,
}: FilesGridWidgetProps) {
	const {t} = useTranslation()
	const {navigateToDirectory} = useNavigate()
	// Convert the raw paths into lightweight FileSystemItem stubs so that we can
	// reuse the existing <FileItemIcon> component.
	const gridItems = paths?.slice(0, 4).map(folderItem)
	const count = gridItems?.length ?? 4

	return (
		<WidgetShell
			// If there are no items, navigate to the link; otherwise there isn't
			// enough empty space to register a meaningful click compared to the
			// items themselves
			onClick={count === 0 ? () => onClick?.(link) : undefined}
			compact={<CompactFavorites paths={paths} noItemsText={noItemsText} onOpen={navigateToDirectory} />}
			className={cn(
				'grid gap-1 p-1.5 w-tall:gap-1.5 w-tall:p-2 w-expanded:gap-2 w-expanded:p-2.5',
				count === 1 && 'grid-cols-1',
				count === 2 && 'grid-cols-2',
				count === 3 && 'grid-cols-1 w-expanded:grid-cols-3',
				count >= 4 && 'grid-cols-2 grid-rows-2',
			)}
		>
			{/* Empty state */}
			{gridItems?.length === 0 ? (
				<p className='grid h-full place-items-center px-1 text-center text-11 opacity-50'>{t(noItemsText)}</p>
			) : (
				(gridItems ?? [undefined, undefined, undefined, undefined]).map((item, i) => (
					<button
						key={item?.path ?? i}
						onClick={() => item && navigateToDirectory(item.path)}
						className={cn(
							'flex min-h-0 min-w-0 items-center justify-center gap-1.5 rounded-10 px-1 text-left w-tall:rounded-12',
							count >= 4 &&
								'flex-col gap-1 w-expanded:flex-row w-expanded:justify-start w-expanded:gap-2 w-expanded:px-2',
							count <= 2 && 'flex-col gap-1.5',
							count === 3 && 'justify-start px-1.5 w-expanded:flex-col w-expanded:justify-center',
							glassCellClass,
							glassCellInteractiveClass,
						)}
					>
						{item ? (
							<FileItemIcon
								item={item}
								className={cn('size-4 shrink-0 w-expanded:size-8', count <= 2 && 'size-8 w-expanded:size-12')}
							/>
						) : (
							<span className='size-4 shrink-0 animate-pulse rounded-3 bg-white/10 w-expanded:size-8' />
						)}
						<span
							className={cn(
								'min-w-0 truncate text-11 leading-tight font-medium text-white/90',
								count >= 4 && 'max-w-full text-[10px] w-tall:text-11',
							)}
							title={item?.name}
						>
							{item?.name ?? LOADING_DASH}
						</span>
					</button>
				))
			)}
		</WidgetShell>
	)
}

// Favourite folders as an icon-only 2×2 grid; each icon opens its folder
function CompactFavorites({
	paths,
	noItemsText,
	onOpen,
}: {
	paths?: string[]
	noItemsText: string
	onOpen: (path: string) => void
}) {
	const {t} = useTranslation()
	if (paths?.length === 0) {
		return (
			<div className={cn(compactContainerClass, 'items-center justify-center text-center text-[10px] opacity-60')}>
				{t(noItemsText)}
			</div>
		)
	}
	const cells = paths ? take(paths, 4) : [undefined, undefined, undefined, undefined]
	return (
		// At the narrowest size (the accordion's 85px) less padding top and bottom
		// spreads the two rows further apart
		<div className='grid h-full w-full grid-cols-2 grid-rows-2 place-items-center gap-1 p-2.5 @max-[90px]/widget:py-1'>
			{cells.map((path, i) => (
				// No cell behind each folder: the icons get the room instead, big enough to tell apart
				<div key={path ?? i} className='grid place-items-center'>
					{path && (
						<button
							aria-label={folderItem(path).name}
							title={folderItem(path).name}
							onClick={() => onOpen(path)}
							className='grid place-items-center rounded-8 transition-[filter] hover:brightness-125 active:brightness-95'
						>
							<FileItemIcon item={folderItem(path)} className='size-7' />
						</button>
					)}
				</div>
			))}
		</div>
	)
}

function folderItem(path: string): FileSystemItem {
	return {path, name: path.split('/').pop() || '', type: 'directory', modified: Date.now(), size: 0, operations: []}
}
