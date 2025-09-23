import '@/features/files/components/listing/file-item/list-view-file-item.css'

import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface ListViewFileItemProps {
	item: FileSystemItem
	isEditingName: boolean
	onEditingNameComplete: () => void
	fadedContent?: boolean
}

export function ListViewFileItem({item, isEditingName, onEditingNameComplete, fadedContent}: ListViewFileItemProps) {
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
				<div className={cn('flex flex-1 items-center justify-between overflow-hidden', fadedContent && 'opacity-50')}>
					<div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
						{isEditingName ? (
							<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
						) : (
							<TruncatedFilename
								filename={item.name}
								view='list'
								className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap pr-2 text-12'
							/>
						)}
						<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-11 text-white/40'>
							{isUploading
								? uploadingProgress === 0
									? t('files-state.waiting')
									: `${t('files-state.uploading')} ${uploadingProgress}%`
								: formatFilesystemDate(item.modified, languageCode)}
						</span>
					</div>
					<span className='shrink-0 whitespace-nowrap pl-2 text-right text-11 text-white/40'>
						{item.type === 'directory'
							? isDirectoryAnExternalDrivePartition(item.path)
								? t('files-type.external-drive')
								: isDirectoryANetworkDevice(item.path)
									? t('files-type.network-drive')
									: isDirectoryAnUmbrelBackup(item.name)
										? t('files-type.umbrel-backup')
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
			<div className={`flex-[5] ${tableStyles}`}>
				<div className='flex items-center gap-1.5'>
					<div className='flex-shrink-0'>
						<FileItemIcon item={item} className='h-5 w-5' />
					</div>
					<div className={cn(fadedContent && 'opacity-50')}>
						{isEditingName ? (
							<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
						) : (
							<TruncatedFilename filename={item.name} view='list' className='min-w-0 text-12' />
						)}
					</div>
				</div>
			</div>

			<div className={cn(`flex-[2] ${tableStyles} text-white/60`, fadedContent && 'opacity-50')}>
				{isUploading ? <Progress value={uploadingProgress} /> : formatFilesystemDate(item.modified, languageCode)}
			</div>

			<div className={cn(`flex-1 ${tableStyles} text-white/60`, fadedContent && 'opacity-50')}>
				{isUploading
					? `${formatFilesystemSize(
							((item.size ?? 0) * (uploadingProgress ?? 0)) / 100,
						)} / ${formatFilesystemSize(item.size ?? null)}`
					: formatFilesystemSize(item.size ?? null)}
			</div>

			{/* TODO: Add this back in when we have a file system index in umbreld. The name header was previously flex-[3] */}
			{/* <div className={`flex-[2] lg:hidden xl:flex ${tableStyles} text-white/60`}>
				{isUploading ? `${formatFilesystemSize(item.speed ?? 0)}/s` : formatFilesystemDate(item.created, languageCode)}
			</div> */}

			<div className={cn(`flex-[2] ${tableStyles} text-white/60`, fadedContent && 'opacity-50')}>
				{isUploading
					? uploadingProgress !== 0
						? t('files-state.uploading')
						: t('files-state.waiting')
					: item.type === 'directory' && isDirectoryAnExternalDrivePartition(item.path)
						? t('files-type.external-drive')
						: isDirectoryANetworkDevice(item.path)
							? t('files-type.network-drive')
							: isDirectoryAnUmbrelBackup(item.name)
								? t('files-type.umbrel-backup')
								: translatedFileType}
			</div>
		</div>
	)
}
