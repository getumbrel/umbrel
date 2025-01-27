import {Upload} from 'lucide-react'
import {useRef} from 'react'

import {IconButton} from '@/components/ui/icon-button'
import {AddFolderIcon} from '@/features/files/assets/add-folder-icon'
import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {t} from '@/utils/i18n'

export function EmptyStateDirectory() {
	const {startNewFolder} = useNewFolder()
	const uploadInputRef = useRef<HTMLInputElement | null>(null)

	const handleUploadClick = () => {
		uploadInputRef.current?.click()
	}

	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<div className='flex flex-col items-center gap-3'>
				<EmptyFolderIcon className='h-15 w-15' />
				<div className='text-12 text-white/40'>{t('files-empty.directory')}</div>
			</div>
			<div className='flex items-center gap-2'>
				<IconButton icon={Upload} variant='primary' onClick={handleUploadClick}>
					{t('files-action.upload')}
				</IconButton>
				<IconButton icon={AddFolderIcon} onClick={startNewFolder}>
					{t('files-folder')}
				</IconButton>
				<UploadInput ref={uploadInputRef} />
			</div>
		</div>
	)
}
