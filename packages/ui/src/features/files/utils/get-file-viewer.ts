import {FILE_TYPE_MAP, type FileType} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'

export function getFileViewer(item: Pick<FileSystemItem, 'name' | 'type'>) {
	const entry = FILE_TYPE_MAP[item.type as FileType]
	return entry?.viewer ?? (item.type === 'application/octet-stream' ? FILE_TYPE_MAP['text/plain'].viewer : undefined)
}
