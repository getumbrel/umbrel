import type {Viewer} from '@/features/files/components/file-viewer/viewers'
import {FILE_TYPE_MAP, type FileType} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'

// Text by its type: text/*, and JSON or XML by their structured syntax suffix
const isTextType = (type: string) => type.startsWith('text/') || type.endsWith('+json') || type.endsWith('+xml')

// Types that don't say what a file holds: none is known for its name, or the
// name is two formats' (.ts and .mts are TypeScript as often as an MPEG
// transport stream, which browsers don't play; .m2ts is only ever video). The
// text viewer opens such a file if it starts as text.
export const isUncertainType = ({name, type}: Pick<FileSystemItem, 'name' | 'type'>) =>
	type === 'application/octet-stream' || (type === 'video/mp2t' && /\.m?ts$/i.test(name))

export function getFileViewer(item: Pick<FileSystemItem, 'name' | 'type'>): Viewer | undefined {
	const entry = FILE_TYPE_MAP[item.type as FileType]
	const text = isTextType(item.type) || isUncertainType(item)
	return entry?.viewer ?? (text ? FILE_TYPE_MAP['text/plain'].viewer : undefined)
}
