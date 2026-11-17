import {FolderPlus, Upload} from 'lucide-react'
import {useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {TbWorldPlus} from 'react-icons/tb'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import nasIconInactive from '@/features/files/assets/nas-icon-inactive.png'
import networkIcon from '@/features/files/assets/network-icon.png'
import {StateView} from '@/features/files/components/listing'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useLinkToDialog} from '@/utils/dialog'

// An empty folder says so, and offers the two ways to change that right
// where the eye already is. With a pointer it also says files can be dropped on it.
export function EmptyStateDirectory() {
	const {t} = useTranslation()
	const {currentPath, isViewingNetworkShares} = useNavigate()
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {startNewFolder} = useNewFolder()
	const isReadOnly = useIsFilesReadOnly()
	const isTouchDevice = useIsTouchDevice()
	// The backend's writable operation on this directory (shares the listing
	// query with the surrounding view); hides the write actions in places like
	// cloud mirrors and backup snapshots
	const {listing} = useListDirectory(currentPath)
	const isWritable = listing?.operations.includes('writable') ?? false
	const uploadInputRef = useRef<HTMLInputElement | null>(null)

	const isOfflineNetworkHost = isViewingNetworkShares && !doesHostHaveMountedShares?.(currentPath)
	// in read-only mode or non-writable directories, we don't offer the upload and new folder buttons
	const canAdd = !isViewingNetworkShares && !isReadOnly && isWritable

	if (isOfflineNetworkHost)
		return (
			<StateView
				icon={<img src={nasIconInactive} alt='' className='size-14' draggable={false} />}
				title={t('files-empty.network-host-offline')}
			/>
		)

	return (
		<StateView
			icon={<EmptyFolderIcon />}
			title={t('files-empty.directory')}
			description={canAdd && !isTouchDevice ? t('files-empty.directory-hint') : undefined}
		>
			{canAdd && (
				<div className='flex items-center gap-2'>
					<PillButton icon={Upload} onClick={() => uploadInputRef.current?.click()}>
						{t('files-action.upload')}
					</PillButton>
					<PillButton icon={FolderPlus} onClick={startNewFolder}>
						{t('files-action.new-folder')}
					</PillButton>
					<UploadInput ref={uploadInputRef} />
				</div>
			)}
		</StateView>
	)
}

// No network devices yet: what they are, and the way to add the first
export function EmptyStateNetwork() {
	const {t} = useTranslation()
	const isReadOnly = useIsFilesReadOnly()
	const navigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	return (
		<StateView
			icon={<img src={networkIcon} alt='' className='size-14 object-contain opacity-80' draggable={false} />}
			title={t('files-empty.network')}
			description={t('files-empty.network-hint')}
		>
			{!isReadOnly && (
				<PillButton icon={TbWorldPlus} onClick={() => navigate(linkToDialog('files-add-network-share'))}>
					{t('files-action.add-network-device')}
				</PillButton>
			)}
		</StateView>
	)
}
