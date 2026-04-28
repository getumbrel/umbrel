import {useTranslation} from 'react-i18next'

import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useLanguage} from '@/hooks/use-language'

interface InfoCardViewerProps {
	item: FileSystemItem
}

export default function InfoCardViewer({item}: InfoCardViewerProps) {
	const {t} = useTranslation()
	const [languageCode] = useLanguage()

	const fileType = item.type ? FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP]?.nameTKey : ''
	const translatedFileType = fileType ? t(fileType) : item.type

	const typeLine = [
		translatedFileType,
		item.type !== 'directory' && item.size != null ? formatFilesystemSize(item.size) : null,
	]
		.filter(Boolean)
		.join(' — ')

	return (
		<ViewerWrapper>
			<div className='flex w-full max-w-[calc(100%-40px)] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 shadow-dialog backdrop-blur-2xl contrast-more:bg-dialog-content contrast-more:backdrop-blur-none sm:w-md'>
				<FileItemIcon item={item} className='h-16 w-16' />
				<div className='flex flex-col items-center gap-1 text-center'>
					<span className='text-17 leading-snug font-semibold -tracking-2 break-words text-white'>{item.name}</span>
					{typeLine && <span className='text-13 leading-tight -tracking-2 text-white/60'>{typeLine}</span>}
					{item.modified != null && (
						<span className='text-13 leading-tight -tracking-2 text-white/60'>
							Modified: {formatFilesystemDate(item.modified, languageCode)}
						</span>
					)}
				</div>
			</div>
		</ViewerWrapper>
	)
}
