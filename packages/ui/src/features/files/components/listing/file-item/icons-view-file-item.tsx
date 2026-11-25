import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {CircularProgress} from '@/features/files/components/listing/file-item/circular-progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {useFileItemContext} from '@/features/files/components/listing/file-item/file-item-context'
import {FolderAppStack} from '@/features/files/components/listing/file-item/folder-app-stack'
import type {FileItemViewProps} from '@/features/files/components/listing/file-item/list-view-file-item'
import {SelectCircle} from '@/features/files/components/listing/file-item/select-circle'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useAppStorageFolderTags} from '@/features/files/hooks/use-app-storage-folder-tags'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {formatUploadPercent} from '@/features/files/utils/format-upload-percent'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {matchReason, SearchMatchLine} from '@/features/search/search-match-line'
import {useLargerText} from '@/hooks/use-accessibility'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'

// A tile of the icons view: the icon, or the picture itself at its own shape
// and as large as the tile allows, over the name and a line of details. Tiles
// share their row's width (see VirtualizedList), so the box here fills its cell.
export const IconsViewFileItem = ({
	item,
	machine,
	isEditingName,
	onEditingNameComplete,
	fadedContent,
	isSelected,
	isSelecting,
}: FileItemViewProps) => {
	const {t} = useTranslation()
	const [languageCode] = useLanguage()
	const {gridItemWidth, showLocation} = useFileItemContext()
	const displayName = machine?.name ?? item.name
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const isTouchDevice = useIsTouchDevice()
	const isMobile = useIsMobile()
	const {getFolderStorageApps} = useAppStorageFolderTags()
	const folderApps = getFolderStorageApps(item)
	// Middle-truncation budget for the name's two lines: about 27 characters fill
	// every 100px of tile, and the app stack takes the room of 6. Fewer fit as the
	// 12px name grows with the text size setting, and a little under in
	// proportion, since a shorter line loses more of itself to where it breaks.
	const largerText = useLargerText()
	const nameMaxLength = Math.floor(
		((Math.round((gridItemWidth - 16) * 0.31) - (folderApps ? 6 : 0)) * 12) / (12 + largerText * 1.5),
	)

	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			className='relative flex h-full w-full flex-col items-center overflow-hidden px-2 pt-3 pb-2 text-center break-words'
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* The circle a touch screen selects by, on the corner of the icon or the picture */}
			{isSelecting && (
				<SelectCircle selected={isSelected} onPicture className='absolute top-2 left-[calc(50%-52px)] z-10' />
			)}
			{/* Do not use animated icon for touch devices where hover doesn't make sense */}
			{/* We pass in isActive so that the trigger for hovering can be on a parent div */}
			{/* TODO: set isHovered to true when the item's context menu is open */}
			<div
				className={cn(
					'flex h-[72px] w-full shrink-0 items-center justify-center',
					item.isDisconnected && !isDirectoryANetworkDevice(item.path) && 'opacity-50',
				)}
			>
				<FileItemIcon
					item={item}
					machine={machine ?? null}
					className={isMobile ? 'size-16' : 'size-[72px]'}
					// A picture may be wider than an icon: as wide as the tile's own room
					thumbnailFit='hug'
					thumbnailClassName='h-[72px] w-full max-w-[108px] [--thumbnail-radius:6px]'
					useAnimatedIcon={!isTouchDevice && !item.isDisconnected}
					isHovered={isHovered}
					momentTime
				/>
			</div>
			<div className={cn('relative mt-2 w-full flex-col items-center', fadedContent && 'opacity-50')}>
				{isEditingName && !machine ? (
					<EditableName item={item} view='icons' onFinish={onEditingNameComplete} />
				) : (
					<TruncatedFilename
						filename={displayName}
						view='icons'
						className='line-clamp-2 w-full text-center text-12 leading-tight text-white/90'
						// The app stack rides the name's own line flow, so a shorter name
						// budget keeps it inside the two-line clamp
						maxLength={nameMaxLength}
						suffix={folderApps ? <FolderAppStack apps={folderApps} className='ml-0.5 align-[-3px]' /> : undefined}
					/>
				)}
				{/* In search, what was found in this file takes the size's line. One
				    found by its name keeps the folder it is in there: the whole way
				    to it would be cut short of that folder, the part that tells it apart. */}
				<span className='block w-full truncate text-center text-11 leading-normal text-white/45'>
					{item.searchResult && matchReason(item.searchResult).type !== 'folder' ? (
						<SearchMatchLine result={item.searchResult} />
					) : item.isDisconnected ? (
						t('files-network-storage.disconnected')
					) : isUploading ? (
						uploadingProgress === 0 ? (
							t('files-state.waiting')
						) : (
							formatUploadPercent(uploadingProgress ?? 0, languageCode)
						)
					) : showLocation ? (
						// Among items gathered from all over, the folder each one is in says the most
						item.path.split('/').slice(-2, -1)[0] || formatFilesystemSize(item.size)
					) : item.type === 'directory' ? (
						isDirectoryAnExternalDrivePartition(item.path) ? (
							t('files-type.external-drive')
						) : isDirectoryANetworkDevice(item.path) ? (
							t('files-type.network-drive')
						) : isDirectoryAnUmbrelBackup(item.name) ? (
							t('files-type.umbrel-backup')
						) : // Folder sizes come from the index, so one that isn't indexed yet falls back to
						// the label, and so does an empty one: "0 KB" says less than "Folder"
						item.size ? (
							formatFilesystemSize(item.size)
						) : (
							t('files-type.directory')
						)
					) : (
						formatFilesystemSize(item.size)
					)}
				</span>
			</div>

			{!!isUploading && (
				<div className='absolute inset-0 rounded-12 bg-black/35'>
					<CircularProgress progress={uploadingProgress} />
				</div>
			)}
		</div>
	)
}
