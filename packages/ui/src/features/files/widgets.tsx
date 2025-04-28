import {motion} from 'framer-motion'
import {t} from 'i18next'
import {useMemo} from 'react'

// Files-specific utilities
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {FileSystemItem} from '@/features/files/types'
import {formatItemName, splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useIsMobile} from '@/hooks/use-is-mobile'
import type {BaseWidget, Link, RegistryWidget} from '@/modules/widgets/shared/constants'
import {WidgetContainer} from '@/modules/widgets/shared/shared'
import {cn} from '@/shadcn-lib/utils'

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

// List widget (Recents)
export function FilesListWidget({
	items,
	link,
	noItemsText = 'files-widgets.recents.no-items-text',
	onClick,
}: FilesListWidgetProps) {
	return (
		<WidgetContainer
			onClick={(e: React.MouseEvent<HTMLDivElement>) => {
				// Ignore if the click was on an interactive element inside this container,
				// because if the user clicked on an item, we want to navigate to it
				if (e.target instanceof HTMLElement && e.target.closest('[role="button"]')) {
					return
				}
				onClick?.(link)
			}}
			className='overflow-hidden p-1 !pb-0 sm:p-2'
		>
			<span className='-mb-2 ml-2 mt-1 text-9 text-white/60 sm:-mb-1 sm:text-xs'>{t('files-sidebar.recents')}</span>
			<div
				className='flex h-full w-full flex-col'
				style={{maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 30px), transparent)'}}
			>
				{/* Loading state */}
				{!items && (
					<>
						<SkeletonListItem />
						<SkeletonListItem />
						<SkeletonListItem />
					</>
				)}

				{/* Empty state */}
				{items?.length === 0 && (
					<div className='-mt-3 grid h-full w-full place-items-center pb-2 text-center text-xs text-white/50 sm:pb-4'>
						{t(`${noItemsText}`)}
					</div>
				)}

				{/* Actual items  */}
				{items && items.length > 0 && items.slice(0, 3).map((item) => <ListItem key={item.path} item={item} />)}
			</div>
		</WidgetContainer>
	)
}

function SkeletonListItem() {
	return (
		<div className='flex items-center gap-1 px-2 py-[0.3rem] sm:gap-2'>
			{/* placeholder icon */}
			<div className='h-5 w-5 animate-pulse rounded-sm bg-white/10 sm:h-7 sm:w-7 sm:rounded-md' />
			<div className='flex flex-col gap-1 overflow-hidden'>
				{/* name */}
				<div className='h-2 w-24 animate-pulse rounded-md bg-white/10 sm:h-3 sm:w-32' />
			</div>
		</div>
	)
}

function ListItem({item}: {item: FileSystemItem}) {
	const {navigateToItem} = useNavigate()
	const isMobile = useIsMobile()

	const {name, extension} = splitFileName(item.name)
	const extensionWithoutDot = extension?.startsWith('.') ? extension.slice(1) : extension

	return (
		<div
			role='button'
			onClick={() => navigateToItem(item)}
			className='flex cursor-pointer items-center gap-1 rounded-lg px-2 py-[0.3rem] transition-all hover:bg-white/10 sm:gap-2'
		>
			<FileItemIcon item={item} className='h-5 w-5 max-w-5 sm:h-7 sm:w-7 sm:max-w-7' />
			<div className='flex items-baseline gap-1 overflow-hidden'>
				<p className='truncate text-11 text-white/80 sm:text-13'>
					{formatItemName({name, maxLength: isMobile ? 13 : 22})}
				</p>
				{extension && <p className='truncate text-9 uppercase text-white/50'>{extensionWithoutDot}</p>}
			</div>
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
	// Convert the raw paths into lightweight FileSystemItem stubs so that we can
	// reuse the existing <FileItemIcon> component.
	const gridItems = useMemo(() => {
		if (!paths) return undefined // still loading
		return paths
			.map((p) => ({
				path: p,
				name: p.split('/').pop() || '',
				type: 'directory',
				modified: Date.now(),
				size: 0,
				operations: [],
			}))
			.slice(0, 4)
	}, [paths])

	const count = gridItems?.length ?? 0

	return (
		<WidgetContainer
			className={cn(
				'gap-1 p-1.5 sm:gap-2 sm:p-2.5',
				count === 1 && 'grid grid-cols-1 grid-rows-1',
				count === 2 && 'grid grid-cols-2 grid-rows-1',
				count === 3 && 'sm:grid sm:grid-cols-3 sm:grid-rows-1',
				(count >= 4 || !gridItems) && 'grid grid-cols-2 grid-rows-2',
			)}
			onClick={() => {
				// If there are no items, navigate to the link
				// otherwise there isn't enough empty space
				// to register a meaningful click compared to the
				// items themselves, so we ignore the click event.

				if (count === 0) {
					return onClick?.(link)
				}
			}}
		>
			{/* Loading state */}
			{!gridItems && (
				<>
					<SkeletonGridItem />
					<SkeletonGridItem />
					<SkeletonGridItem />
					<SkeletonGridItem />
				</>
			)}

			{/* Empty state */}
			{gridItems?.length === 0 && (
				<div className='grid h-full w-full place-items-center pb-2 text-center text-xs text-white/50 sm:pb-4'>
					{t(`${noItemsText}`)}
				</div>
			)}

			{/* Actual items  */}
			{gridItems &&
				gridItems.length > 0 &&
				gridItems
					.slice(0, 4)
					.map((item, index) => <GridItem key={item.path} item={item} index={index} count={gridItems.length} />)}
		</WidgetContainer>
	)
}

function SkeletonGridItem() {
	return (
		<div className='flex h-full w-full items-center gap-1 rounded-5 bg-white/5 px-1 leading-none text-white/70 sm:gap-2 sm:px-2 sm:py-3'>
			{/* Placeholder icon */}
			<div className='h-4 w-4 animate-pulse rounded-sm bg-white/10 sm:h-8 sm:w-8 sm:rounded-md' />
			{/* name */}
			<div className='h-1 w-8 animate-pulse rounded bg-white/10 sm:h-3 sm:w-16' />
		</div>
	)
}

function GridItem({item, count}: {item: FileSystemItem; index: number; count: number}) {
	const {navigateToDirectory} = useNavigate()
	return (
		<motion.div
			onClick={() => navigateToDirectory(item.path)}
			whileHover={{scale: 1.04, backgroundColor: 'rgba(255, 255, 255, 0.1)'}}
			whileTap={{scale: 0.96, backgroundColor: 'rgba(255, 255, 255, 0.1)'}}
			className={cn(
				'flex h-full w-full items-center rounded-5 bg-white/5 px-1 leading-none text-white/70 sm:py-3',
				'cursor-pointer overflow-hidden',
				'line-clamp-2 [overflow-wrap:anywhere]',
				'sm:rounded-12 sm:px-2',
				count === 1 && 'flex-col justify-center gap-1 text-center',
				count === 2 && 'flex-col justify-center gap-1 text-center',
				count === 3 && 'flex-row justify-start gap-1 sm:flex-col sm:justify-center',
				count === 4 && 'flex-col justify-center gap-[0.2rem] sm:flex-row sm:justify-start sm:gap-[0.35rem]',
			)}
		>
			<FileItemIcon
				item={item}
				className={cn(count <= 2 ? 'h-8 w-8 sm:h-12 sm:w-12' : 'h-4 w-4 sm:h-8 sm:w-8', 'shrink-0')}
			/>
			<p
				className={cn(
					'text-9 font-medium sm:text-11',
					count === 1 && 'h-[16px] sm:h-[24px]',
					count === 2 && 'h-[16px] sm:h-[24px]',
					count === 3 && 'h-[11px] text-left sm:h-[24px] sm:text-center',
					count === 4 && 'text-center sm:text-left',
				)}
				title={item?.name}
			>
				{formatItemName({name: item.name, maxLength: 20})}
			</p>
		</motion.div>
	)
}
