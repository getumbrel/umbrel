import {useTranslation} from 'react-i18next'

import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import type {FileSystemItem} from '@/features/files/types'
import {fileTypeLabel} from '@/features/files/utils/file-type-label'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useLanguage} from '@/hooks/use-language'

// A quick look at something Files has no viewer for: what it is, how big, how
// recent. The quick look's panel is the card.
export function InfoCard({item}: {item: FileSystemItem}) {
	const {t} = useTranslation()
	const [languageCode] = useLanguage()

	const translatedFileType = fileTypeLabel(item, t)

	const size = item.size != null ? formatFilesystemSize(item.size) : null
	// A folder is its size, as in the listing; its size comes from the index, so
	// one not indexed yet is just a folder
	const typeLine =
		item.type === 'directory' ? (size ?? translatedFileType) : [translatedFileType, size].filter(Boolean).join(' · ')

	return (
		<div className='flex flex-col items-center gap-5 p-8'>
			<FileItemIcon item={item} className='h-16 w-16' />
			<div className='flex w-full min-w-0 flex-col items-center gap-1 text-center'>
				<span className='max-w-full min-w-0 text-17 leading-snug font-semibold -tracking-2 break-words text-white'>
					{item.name}
				</span>
				{typeLine && <span className='text-13 leading-tight -tracking-2 text-white/60'>{typeLine}</span>}
				{item.modified != null && (
					<span className='text-13 leading-tight -tracking-2 text-white/60'>
						{t('files-viewer.modified', {date: formatFilesystemDate(item.modified, languageCode)})}
					</span>
				)}
			</div>
		</div>
	)
}
