import type {TFunction} from 'i18next'

import {FILE_TYPE_MAP, type FileType} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'

// A kind name for any item, never its raw MIME type: the known name ("PDF Document"), else one
// from a plain extension like Windows does ("BIN File"), else just "File"
export function fileTypeLabel(item: Pick<FileSystemItem, 'name' | 'type'>, t: TFunction): string {
	const nameTKey = FILE_TYPE_MAP[item.type as FileType]?.nameTKey
	if (nameTKey) return t(nameTKey)
	// A dotfile like ".env" is all name and no extension
	const {name, extension} = splitFileName(item.name)
	const plainExtension = name && extension?.match(/^\.([a-z0-9]{1,8})$/i)?.[1]
	return plainExtension
		? t('files-type.extension-file', {extension: plainExtension.toUpperCase()})
		: t('files-type.file')
}
