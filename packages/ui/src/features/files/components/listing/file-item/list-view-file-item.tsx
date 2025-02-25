import '@/features/files/components/listing/file-item/list-view-file-item.css'

import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface ListViewFileItemProps {
	item: FileSystemItem
	isEditingName: boolean
	onEditingNameComplete: () => void
}

export function ListViewFileItem({item, isEditingName, onEditingNameComplete}: ListViewFileItemProps) {
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0

	const isMobile = useIsMobile()
	const [languageCode] = useLanguage()

	// Get the file type name from the translation key
	const fileType = item.type ? FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP]?.nameTKey : ''
	const translatedFileType = fileType ? t(fileType) : item.type

	// Mobile view
	if (isMobile) {
		return (
			<div className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2', isUploading && 'opacity-70')}>
				<div className='flex-shrink-0'>
					<FileItemIcon item={item} className='h-7 w-7' />
				</div>
				<div className='flex w-[100%] items-center justify-between'>
					<div className='flex flex-col'>
						{isEditingName ? (
							<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
						) : (
							<span className='min-w-0 cursor-text truncate text-12'>{formatItemName({name: item.name})}</span>
						)}
						<span className='text-11 text-white/40'>
							{isUploading
								? uploadingProgress === 0
									? t('files-state.waiting')
									: `${t('files-state.uploading')} ${uploadingProgress}%`
								: formatFilesystemDate(item.modified, languageCode)}
						</span>
					</div>
					<span className='text-11 text-white/40'>
						{item.type === 'directory'
							? isDirectoryAnExternalDrivePartition(item.path)
								? t('files-type.external-drive')
								: t('files-type.directory')
							: formatFilesystemSize(item.size ?? null)}
					</span>
				</div>
			</div>
		)
	}

	// Desktop view
	const tableStyles = 'text-12 p-2.5 whitespace-nowrap overflow-hidden text-ellipsis'

	return (
		<div className={cn('flex items-center', isUploading && 'opacity-70')}>
			<div className={`flex-[3] ${tableStyles}`}>
				<div className='flex items-center gap-1.5'>
					<div className='flex-shrink-0'>
						<FileItemIcon item={item} className='h-5 w-5' />
					</div>
					{isEditingName ? (
						<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
					) : (
						<span className='min-w-0 truncate text-12'>{formatItemName({name: item.name})}</span>
					)}
				</div>
			</div>

			<div className={`flex-[2] ${tableStyles} text-white/60`}>
				{isUploading ? <Progress value={uploadingProgress} /> : formatFilesystemDate(item.modified, languageCode)}
			</div>

			<div className={`flex-1 ${tableStyles} text-white/60`}>
				{isUploading
					? `${formatFilesystemSize(
							((item.size ?? 0) * (uploadingProgress ?? 0)) / 100,
						)} / ${formatFilesystemSize(item.size ?? null)}`
					: formatFilesystemSize(item.size ?? null)}
			</div>

			<div className={`flex-[2] lg:hidden xl:flex ${tableStyles} text-white/60`}>
				{isUploading ? `${formatFilesystemSize(item.speed ?? 0)}/s` : formatFilesystemDate(item.created, languageCode)}
			</div>

			<div className={`flex-[2] ${tableStyles} text-white/60`}>
				{isUploading
					? uploadingProgress !== 0
						? t('files-state.uploading')
						: t('files-state.waiting')
					: item.type === 'directory' && isDirectoryAnExternalDrivePartition(item.path)
						? t('files-type.external-drive')
						: translatedFileType}
			</div>
		</div>
	)
}
