import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {HOME_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {t} from '@/utils/i18n'

interface PathBarMobileProps {
	path: string
}

export function PathBarMobile({path}: PathBarMobileProps) {
	const isEmbedded = useIsFilesEmbedded()
	const {
		isInHome,
		isBrowsingRecents,
		isBrowsingTrash,
		isBrowsingExternalStorage,
		isViewingNetworkDevices,
		isBrowsingNetworkStorage,
		isBrowsingBackups,
		uiPath,
	} = useNavigate()

	// Use UI path for display so backups/snapshot segments are hidden
	const displayPath = uiPath
	const segments = displayPath.replace(HOME_PATH, '').split('/').filter(Boolean)
	const externalStorageDiskName = isBrowsingExternalStorage ? segments[1] : null
	const networkHostName = isBrowsingNetworkStorage && !isViewingNetworkDevices ? segments[1] : null

	return (
		<div className='flex items-center gap-1.5'>
			<FileItemIcon
				item={{
					path: isBrowsingNetworkStorage
						? (() => {
								// So for eg. if path is /Network/samba.orb.local/Documents, we want to return /Network/samba.orb.local
								//  otherwise the inactive NAS icon will be rendered
								const parts = path.split('/')
								// ['', 'Network', 'samba.orb.local', ...]
								if (parts.length >= 3) {
									return `/${parts[1]}/${parts[2]}`
								}
								return path
							})()
						: path,
					type: isBrowsingExternalStorage
						? 'external-storage'
						: isViewingNetworkDevices
							? 'network-root'
							: isBrowsingNetworkStorage
								? 'network-share'
								: 'directory',
					name: isEmbedded
						? segments[segments.length - 1] || t('files-sidebar.home')
						: isBrowsingBackups
							? t('backups')
							: segments[segments.length - 1] || t('files-sidebar.home'),
					operations: [],
					size: 0,
					modified: 0,
				}}
				className='h-5 w-5'
			/>
			<span className='text-13'>
				{isBrowsingTrash ? t('files-sidebar.trash') : ''}
				{isBrowsingRecents ? t('files-sidebar.recents') : ''}
				{isInHome ? t('files-sidebar.home') : ''}
				{isEmbedded ? '' : isBrowsingBackups ? t('backups') : ''}
				{isBrowsingExternalStorage ? externalStorageDiskName || t('files-sidebar.external-storage') : ''}
				{isViewingNetworkDevices ? t('files-sidebar.network-pathbar') : ''}
				{isBrowsingNetworkStorage && !isViewingNetworkDevices ? networkHostName : ''}
				{!isBrowsingTrash && !isBrowsingRecents && !isInHome && !isBrowsingExternalStorage && !isBrowsingNetworkStorage
					? `${formatItemName({name: segments[segments.length - 1] || t('files-sidebar.home')})}`
					: ''}
			</span>
		</div>
	)
}
