import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {HOME_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {t} from '@/utils/i18n'

interface PathBarMobileProps {
	path: string
}

export function PathBarMobile({path}: PathBarMobileProps) {
	const {isInHome, isBrowsingRecents, isBrowsingTrash, isBrowsingExternalStorage} = useNavigate()

	const segments = path.replace(HOME_PATH, '').split('/').filter(Boolean)
	const externalStorageDiskName = isBrowsingExternalStorage ? segments[1] : null

	return (
		<div className='flex items-center gap-1.5'>
			<FileItemIcon
				item={{
					path,
					type: isBrowsingExternalStorage ? 'external-storage' : 'directory',
					name: segments[segments.length - 1] || t('files-sidebar.home'),
					ops: 0,
				}}
				className='h-5 w-5'
			/>
			<span className='text-13'>
				{isBrowsingTrash ? t('files-sidebar.trash') : ''}
				{isBrowsingRecents ? t('files-sidebar.recents') : ''}
				{isInHome ? t('files-sidebar.home') : ''}
				{isBrowsingExternalStorage ? externalStorageDiskName || t('files-sidebar.external-storage') : ''}
				{!isBrowsingTrash && !isBrowsingRecents && !isInHome && !isBrowsingExternalStorage
					? `${formatItemName({name: segments[segments.length - 1] || t('files-sidebar.home')})}`
					: ''}
			</span>
		</div>
	)
}
