import {Upload} from 'lucide-react'
import {useRef} from 'react'

import {IconButton} from '@/components/ui/icon-button'
import {AddFolderIcon} from '@/features/files/assets/add-folder-icon'
import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import nasIconInactive from '@/features/files/assets/nas-icon-inactive.png'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {t} from '@/utils/i18n'

export function EmptyStateDirectory() {
	const {currentPath, isViewingNetworkShares} = useNavigate()
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {startNewFolder} = useNewFolder()
	const isReadOnly = useIsFilesReadOnly()
	const uploadInputRef = useRef<HTMLInputElement | null>(null)

	const handleUploadClick = () => {
		uploadInputRef.current?.click()
	}

	const isOfflineNetworkHost = isViewingNetworkShares && !doesHostHaveMountedShares?.(currentPath)

	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<div className='flex flex-col items-center gap-3'>
				{isOfflineNetworkHost ? (
					<img src={nasIconInactive} alt='Network offline' className='h-12 w-12' />
				) : (
					<EmptyFolderIcon className='h-15 w-15' />
				)}
				<div className='text-12 text-white/40'>
					{isOfflineNetworkHost ? t('files-empty.network-host-offline') : t('files-empty.directory')}
				</div>
			</div>
			{/* in read-only mode, we don't render the upload and new folder buttons */}
			{!isViewingNetworkShares && !isReadOnly && (
				<div className='flex items-center gap-2'>
					<IconButton icon={Upload} variant='primary' onClick={handleUploadClick}>
						{t('files-action.upload')}
					</IconButton>
					<IconButton icon={AddFolderIcon} onClick={startNewFolder}>
						{t('files-folder')}
					</IconButton>
					<UploadInput ref={uploadInputRef} />
				</div>
			)}
		</div>
	)
}

export function EmptyStateNetwork() {
	return (
		<div className='flex h-full items-center justify-center p-4 pt-0 text-center'>
			<div className='text-12 text-white/40'>{t('files-empty.network')}</div>
		</div>
	)
}
