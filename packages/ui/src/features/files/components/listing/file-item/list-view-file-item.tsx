import '@/features/files/components/listing/file-item/list-view-file-item.css'

import {ChevronRight} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {Progress} from '@/components/ui/progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {useFileItemContext} from '@/features/files/components/listing/file-item/file-item-context'
import {FolderAppStack} from '@/features/files/components/listing/file-item/folder-app-stack'
import {SelectCircle} from '@/features/files/components/listing/file-item/select-circle'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useAppStorageFolderTags} from '@/features/files/hooks/use-app-storage-folder-tags'
import type {FileSystemItem} from '@/features/files/types'
import {fileTypeLabel} from '@/features/files/utils/file-type-label'
import {formatFilesystemDate, formatFilesystemDateShort} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {formatUploadPercent} from '@/features/files/utils/format-upload-percent'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import type {Machine} from '@/features/machines/types'
import {SearchMatchLine} from '@/features/search/search-match-line'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'

export interface FileItemViewProps {
	item: FileSystemItem
	machine: Machine | undefined
	isEditingName: boolean
	onEditingNameComplete: () => void
	fadedContent?: boolean
	isSelected: boolean
	// A touch screen is selecting: the item shows its circle
	isSelecting: boolean
}

export function ListViewFileItem({
	item,
	machine,
	isEditingName,
	onEditingNameComplete,
	fadedContent,
	isSelected,
	isSelecting,
}: FileItemViewProps) {
	const {t} = useTranslation()
	const {showLocation, locationOf} = useFileItemContext()
	const displayName = machine?.name ?? item.name
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const {getFolderStorageApps} = useAppStorageFolderTags()
	const folderApps = getFolderStorageApps(item)

	const isMobile = useIsMobile()
	const [languageCode] = useLanguage()

	// What a folder is, where it is more than a folder
	const specialKind =
		item.type === 'directory' && isDirectoryAnExternalDrivePartition(item.path)
			? t('files-type.external-drive')
			: isDirectoryANetworkDevice(item.path)
				? t('files-type.network-drive')
				: isDirectoryAnUmbrelBackup(item.name)
					? t('files-type.umbrel-backup')
					: undefined

	// Where it lives, in a listing that gathers items from all over
	const location = showLocation ? locationOf(item.path) : undefined

	const iconDimmed = item.isDisconnected && !isDirectoryANetworkDevice(item.path)

	// Phones and tablets: a row made for a thumb. The icon or the picture
	// itself, large enough to tell by, then the name over a line of details.
	// A folder ends in a chevron: tapping goes in.
	if (isMobile) {
		// Folder sizes come from the index, so one that isn't indexed yet says
		// nothing, and neither does an empty one
		const size = specialKind ?? (item.type !== 'directory' || item.size ? formatFilesystemSize(item.size ?? null) : '')
		const details = item.isDisconnected
			? t('files-network-storage.disconnected')
			: isUploading
				? uploadingProgress === 0
					? t('files-state.waiting')
					: t('files-state.uploading-percent', {
							percent: formatUploadPercent(uploadingProgress ?? 0, languageCode),
						})
				: [location ?? (item.modified ? formatFilesystemDateShort(item.modified, languageCode) : ''), size]
						.filter(Boolean)
						.join(' - ')

		return (
			<div className={cn('flex h-full items-center px-3', isUploading && 'opacity-70')}>
				{/* The circle, and the strip a finger draws down to select a run of
				    rows: it takes the row's whole height and its left edge, and the
				    browser leaves a touch that starts on it alone */}
				<span
					data-select-handle={isSelecting ? '' : undefined}
					className={cn(
						'-ml-3 flex h-full shrink-0 items-center justify-end overflow-hidden transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
						isSelecting ? 'w-[46px] touch-none pr-3 opacity-100' : 'w-3 opacity-0',
					)}
				>
					<SelectCircle selected={isSelected} />
				</span>
				<div
					data-item-content
					className={cn('flex size-10 shrink-0 items-center justify-center', iconDimmed && 'opacity-50')}
				>
					<FileItemIcon
						item={item}
						machine={machine ?? null}
						className='size-10'
						thumbnailFit='hug'
						thumbnailClassName='size-10 [--thumbnail-radius:5px]'
					/>
				</div>
				<div className={cn('ml-3 flex min-w-0 flex-1 flex-col gap-0.5', fadedContent && 'opacity-50')}>
					{/* The name and the details hug their words, so the row's empty space is the row's (see FileItem) */}
					<div data-item-content className='flex max-w-full min-w-0 items-center gap-1.5 self-start'>
						<TruncatedFilename
							filename={displayName}
							view='list'
							className='min-w-0 text-15 leading-tight -tracking-2 text-white/90'
						/>
						{folderApps && <FolderAppStack apps={folderApps} />}
					</div>
					<span
						data-item-content
						className='max-w-full min-w-0 self-start truncate text-12 leading-tight text-white/50'
					>
						{/* In search, why this file is here takes the details' line */}
						{item.searchResult ? <SearchMatchLine result={item.searchResult} /> : details || '—'}
					</span>
				</div>
				{item.type === 'directory' && !isSelecting && !isUploading && (
					<ChevronRight className='ml-2 size-4 shrink-0 text-white/25' strokeWidth={2.5} aria-hidden />
				)}
				{/* Naming happens in a drawer here, and the row keeps its name beneath it */}
				{isEditingName && !machine && <EditableName item={item} view='list' onFinish={onEditingNameComplete} />}
			</div>
		)
	}

	// Desktop view. Columns share the row's width, but the date and size keep a floor that fits
	// them, in ems so it follows the text size. The header's columns match
	const cellClass = 'px-2.5 text-12 whitespace-nowrap overflow-hidden text-ellipsis text-white/50'

	return (
		<div className={cn('flex h-full items-center', isUploading && 'opacity-70')}>
			<div className='flex h-full min-w-0 flex-[5] items-center gap-2.5 px-2.5'>
				{/* A tablet on its side selects from these rows: each wears the circle,
				    in the strip a finger draws down to select a run of them. Closed, it
				    is the row's own padding, so nothing else moves. */}
				<span
					data-select-handle={isSelecting ? '' : undefined}
					className={cn(
						'-ml-2.5 flex h-full shrink-0 items-center justify-end overflow-hidden transition-[width,margin,opacity] duration-200 ease-out motion-reduce:transition-none',
						isSelecting ? 'w-8 touch-none opacity-100' : '-mr-2.5 w-2.5 opacity-0',
					)}
				>
					<SelectCircle selected={isSelected} />
				</span>
				<div
					data-item-content
					className={cn('flex size-7 shrink-0 items-center justify-center', iconDimmed && 'opacity-50')}
				>
					<FileItemIcon item={item} machine={machine ?? null} className='size-7' thumbnailFit='hug' />
				</div>
				{isEditingName && !machine ? (
					<div className={cn('min-w-0 flex-1', fadedContent && 'opacity-50')}>
						<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
					</div>
				) : (
					<div data-item-content className={cn('min-w-0', fadedContent && 'opacity-50')}>
						<div className='flex min-w-0 items-center gap-1.5'>
							<TruncatedFilename filename={displayName} view='list' className='min-w-0 text-13 text-white/90' />
							{folderApps && <FolderAppStack apps={folderApps} />}
						</div>
						{/* In search, why this file is here: the words that matched, or where it lives */}
						{item.searchResult && (
							<SearchMatchLine result={item.searchResult} className='text-11 leading-[14px] text-white/40' />
						)}
					</div>
				)}
			</div>

			<div className={cn(cellClass, 'min-w-[12em] flex-[2]', fadedContent && 'opacity-50')}>
				{item.isDisconnected ? (
					t('files-network-storage.disconnected')
				) : isUploading ? (
					<Progress value={uploadingProgress} />
				) : item.modified ? (
					formatFilesystemDate(item.modified, languageCode)
				) : (
					'—'
				)}
			</div>

			<div className={cn(cellClass, 'min-w-[6.5em] flex-1 tabular-nums', fadedContent && 'opacity-50')}>
				{isUploading
					? `${formatFilesystemSize(
							((item.size ?? 0) * (uploadingProgress ?? 0)) / 100,
						)} / ${formatFilesystemSize(item.size ?? null)}`
					: formatFilesystemSize(item.size ?? null)}
			</div>

			<div className={cn(cellClass, 'flex-[2]', fadedContent && 'opacity-50')} title={location}>
				{isUploading
					? uploadingProgress !== 0
						? t('files-state.uploading')
						: t('files-state.waiting')
					: (location ?? specialKind ?? fileTypeLabel(item, t))}
			</div>
		</div>
	)
}
