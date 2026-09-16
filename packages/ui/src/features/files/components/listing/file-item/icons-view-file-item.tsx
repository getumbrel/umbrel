import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {CircularProgress} from '@/features/files/components/listing/file-item/circular-progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {FolderAppStack} from '@/features/files/components/listing/file-item/folder-app-stack'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useAppStorageFolderTags} from '@/features/files/hooks/use-app-storage-folder-tags'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'

interface IconsViewFileItemProps {
	item: FileSystemItem
	machine: Machine | undefined
	isEditingName: boolean
	onEditingNameComplete: () => void
	fadedContent?: boolean
}

export const IconsViewFileItem = ({
	item,
	machine,
	isEditingName,
	onEditingNameComplete,
	fadedContent,
}: IconsViewFileItemProps) => {
	const {t} = useTranslation()
	const displayName = machine?.name ?? item.name
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const isTouchDevice = useIsTouchDevice()
	const {getFolderStorageApps} = useAppStorageFolderTags()
	const folderApps = getFolderStorageApps(item)

	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			// 100px (w-25) below lg / 112px (w-28) at lg+ — must match getGridItemWidth()
			className='relative flex h-full w-25 flex-col items-center gap-1 overflow-hidden p-2 text-center break-all text-ellipsis lg:w-28'
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Do not use animated icon for touch devices where hover doesn't make sense */}
			{/* We pass in isActive so that the trigger for hovering can be on a parent div */}
			{/* TODO: set isHovered to true when the item's context menu is open */}
			<div
				className={cn(
					'flex justify-center',
					item.isDisconnected && !isDirectoryANetworkDevice(item.path) && 'opacity-50',
				)}
			>
				<FileItemIcon
					item={item}
					machine={machine ?? null}
					className='h-14 w-14'
					useAnimatedIcon={!isTouchDevice && !item.isDisconnected}
					isHovered={isHovered}
				/>
			</div>
			<div className={cn('relative w-full flex-col items-center', fadedContent && 'opacity-50')}>
				{isEditingName && !machine ? (
					<EditableName item={item} view='icons' onFinish={onEditingNameComplete} />
				) : (
					<TruncatedFilename
						filename={displayName}
						view='icons'
						className='mt-1 line-clamp-2 w-full text-center text-12 leading-tight'
						// The app stack rides the name's own line flow, so a shorter name
						// budget keeps it inside the two-line clamp
						maxLength={folderApps ? 24 : undefined}
						suffix={folderApps ? <FolderAppStack apps={folderApps} className='ml-0.5 align-[-3px]' /> : undefined}
					/>
				)}
				<span className='w-full truncate text-center text-12 text-white/40'>
					{item.isDisconnected
						? t('files-network-storage.disconnected')
						: isUploading
							? uploadingProgress === 0
								? t('files-state.waiting')
								: `${uploadingProgress}%`
							: item.type === 'directory'
								? isDirectoryAnExternalDrivePartition(item.path)
									? t('files-type.external-drive')
									: isDirectoryANetworkDevice(item.path)
										? t('files-type.network-drive')
										: isDirectoryAnUmbrelBackup(item.name)
											? t('files-type.umbrel-backup')
											: t('files-type.directory')
								: formatFilesystemSize(item.size)}
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
