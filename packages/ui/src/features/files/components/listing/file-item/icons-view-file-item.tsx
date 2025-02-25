import {useState} from 'react'

import {CircularProgress} from '@/features/files/components/listing/file-item/circular-progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import type {FileSystemItem} from '@/features/files/types'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {t} from '@/utils/i18n'

interface IconsViewFileItemProps {
	item: FileSystemItem
	isEditingName: boolean
	onEditingNameComplete: () => void
}

export const IconsViewFileItem = ({item, isEditingName, onEditingNameComplete}: IconsViewFileItemProps) => {
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const isTouchDevice = useIsTouchDevice()

	const [isHovered, setIsHovered] = useState(false)

	return (
		<div
			className='relative flex flex-col items-center gap-1 overflow-hidden text-ellipsis break-all p-2 text-center'
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Do not use animated icon for touch devices where hover doesn't make sense */}
			{/* We pass in isHovered so that the trigger for hovering can be on a parent div */}
			<FileItemIcon item={item} className='h-14 w-14' useAnimatedIcon={!isTouchDevice} isHovered={isHovered} />
			<div className='relative flex-col items-center'>
				{isEditingName ? (
					<EditableName item={item} view='icons' onFinish={onEditingNameComplete} />
				) : (
					<span className='mt-1 line-clamp-2 w-full text-12 leading-tight'>
						{formatItemName({name: item.name, maxLength: 20})}
					</span>
				)}
				<span className='text-12 text-white/40'>
					{isUploading
						? uploadingProgress === 0
							? t('files-state.waiting')
							: `${uploadingProgress}%`
						: item.type === 'directory'
							? isDirectoryAnExternalDrivePartition(item.path)
								? t('files-type.external-drive')
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
