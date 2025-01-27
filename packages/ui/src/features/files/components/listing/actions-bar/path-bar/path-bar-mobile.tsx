import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {HOME_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {t} from '@/utils/i18n'

interface PathBarMobileProps {
	path: string
}

export function PathBarMobile({path}: PathBarMobileProps) {
	const {isInHome, isBrowsingRecents, isBrowsingTrash} = useNavigate()

	const segments = path.replace(HOME_PATH, '').split('/').filter(Boolean)

	return (
		<div className='flex items-center gap-1.5'>
			<FileItemIcon
				item={{path, type: 'directory', name: segments[segments.length - 1] || t('files-sidebar.home'), ops: 0}}
				className='h-5 w-5'
			/>
			<span className='text-13'>
				{isBrowsingTrash ? t('files-sidebar.trash') : ''}
				{isBrowsingRecents ? t('files-sidebar.recents') : ''}
				{isInHome ? t('files-sidebar.home') : ''}
				{!isBrowsingTrash && !isBrowsingRecents && !isInHome
					? `${formatItemName({name: segments[segments.length - 1] || t('files-sidebar.home')})}`
					: ''}
			</span>
		</div>
	)
}
