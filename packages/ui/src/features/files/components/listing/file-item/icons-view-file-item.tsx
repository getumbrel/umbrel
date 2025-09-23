import {useState} from 'react'

import {CircularProgress} from '@/features/files/components/listing/file-item/circular-progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface IconsViewFileItemProps {
	item: FileSystemItem
	isEditingName: boolean
	onEditingNameComplete: () => void
	fadedContent?: boolean
}

export const IconsViewFileItem = ({
	item,
	isEditingName,
	onEditingNameComplete,
	fadedContent,
}: IconsViewFileItemProps) => {
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const isTouchDevice = useIsTouchDevice()

	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			// w-28 is 112px and corresponds to the fixed width of the icons view item
			className='relative flex h-full w-28 flex-col items-center gap-1 overflow-hidden text-ellipsis break-all p-2 text-center'
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Do not use animated icon for touch devices where hover doesn't make sense */}
			{/* We pass in isActive so that the trigger for hovering can be on a parent div */}
			{/* TODO: set isHovered to true when the item's context menu is open */}
			<div className='flex justify-center'>
				<FileItemIcon item={item} className='h-14 w-14' useAnimatedIcon={!isTouchDevice} isHovered={isHovered} />
			</div>
			<div className={cn('relative w-full flex-col items-center', fadedContent && 'opacity-50')}>
				{isEditingName ? (
					<EditableName item={item} view='icons' onFinish={onEditingNameComplete} />
				) : (
					<TruncatedFilename
						filename={item.name}
						view='icons'
						className='mt-1 line-clamp-2 w-full text-center text-12 leading-tight'
					/>
				)}
				<span className='w-full text-center text-12 text-white/40'>
					{isUploading
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
				<div className='absolute inset-0 rounded-lg bg-black/35'>
					<CircularProgress progress={uploadingProgress} />
				</div>
			)}
		</div>
	)
}
