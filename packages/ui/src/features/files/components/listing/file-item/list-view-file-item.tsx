import '@/features/files/components/listing/file-item/list-view-file-item.css'

import {useTranslation} from 'react-i18next'

import {Progress} from '@/components/ui/progress'
import {EditableName} from '@/features/files/components/listing/file-item/editable-name'
import {FolderAppStack} from '@/features/files/components/listing/file-item/folder-app-stack'
import {TruncatedFilename} from '@/features/files/components/listing/file-item/truncated-filename'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useAppStorageFolderTags} from '@/features/files/hooks/use-app-storage-folder-tags'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import type {Machine} from '@/features/machines/types'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'

interface ListViewFileItemProps {
	item: FileSystemItem
	machine: Machine | undefined
	isEditingName: boolean
	onEditingNameComplete: () => void
	fadedContent?: boolean
}

export function ListViewFileItem({
	item,
	machine,
	isEditingName,
	onEditingNameComplete,
	fadedContent,
}: ListViewFileItemProps) {
	const {t} = useTranslation()
	const displayName = machine?.name ?? item.name
	const isUploading = 'isUploading' in item && item.isUploading
	const uploadingProgress = isUploading && 'progress' in item ? item.progress : 0
	const {getFolderStorageApps} = useAppStorageFolderTags()
	const folderApps = getFolderStorageApps(item)

	const isMobile = useIsMobile()
	const [languageCode] = useLanguage()

	// Get the file type name from the translation key
	const fileType = item.type ? FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP]?.nameTKey : ''
	const translatedFileType = fileType ? t(fileType) : item.type

	// Mobile view
	if (isMobile) {
		return (
			<div className={cn('flex items-center gap-2 rounded-lg px-3 py-2', isUploading && 'opacity-70')}>
				<div
					className={cn('flex-shrink-0', item.isDisconnected && !isDirectoryANetworkDevice(item.path) && 'opacity-50')}
				>
					<FileItemIcon item={item} machine={machine ?? null} className='h-7 w-7' />
				</div>
				<div className={cn('flex flex-1 items-center justify-between overflow-hidden', fadedContent && 'opacity-50')}>
					<div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
						{isEditingName && !machine ? (
							<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
						) : (
							<div className='flex min-w-0 items-center gap-1.5 pr-2'>
								<TruncatedFilename
									filename={displayName}
									view='list'
									className='min-w-0 overflow-hidden text-12 text-ellipsis whitespace-nowrap'
								/>
								{folderApps && <FolderAppStack apps={folderApps} />}
							</div>
						)}
						<span className='min-w-0 overflow-hidden text-11 text-ellipsis whitespace-nowrap text-white/40'>
							{item.isDisconnected
								? t('files-network-storage.disconnected')
								: isUploading
									? uploadingProgress === 0
										? t('files-state.waiting')
										: `${t('files-state.uploading')} ${uploadingProgress}%`
									: item.modified
										? formatFilesystemDate(item.modified, languageCode)
										: '—'}
						</span>
					</div>
					<span className='shrink-0 pl-2 text-right text-11 whitespace-nowrap text-white/40'>
						{item.type === 'directory'
							? isDirectoryAnExternalDrivePartition(item.path)
								? t('files-type.external-drive')
								: isDirectoryANetworkDevice(item.path)
									? t('files-type.network-drive')
									: isDirectoryAnUmbrelBackup(item.name)
										? t('files-type.umbrel-backup')
										: // Folder sizes come from the index, so one that isn't indexed yet falls back to the label
											item.size != null
											? formatFilesystemSize(item.size)
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
					<div
						className={cn(
							'flex-shrink-0',
							item.isDisconnected && !isDirectoryANetworkDevice(item.path) && 'opacity-50',
						)}
					>
						<FileItemIcon item={item} machine={machine ?? null} className='h-5 w-5' />
					</div>
					{isEditingName && !machine ? (
						<div className={cn('min-w-0', fadedContent && 'opacity-50')}>
							<EditableName item={item} view='list' onFinish={onEditingNameComplete} />
						</div>
					) : (
						<div className={cn('flex min-w-0 items-center gap-1.5', fadedContent && 'opacity-50')}>
							<TruncatedFilename filename={displayName} view='list' className='min-w-0 text-12' />
							{folderApps && <FolderAppStack apps={folderApps} />}
						</div>
					)}
				</div>
			</div>

			<div className={cn(`flex-[2] ${tableStyles} text-white/60`, fadedContent && 'opacity-50')}>
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
