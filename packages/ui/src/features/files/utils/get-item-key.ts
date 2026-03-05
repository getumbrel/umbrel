import type {FileSystemItem} from '@/features/files/types'

/**
 * Generates a unique key for a file system item
 * Takes into account uploading status for items that are being uploaded
 *
 * @param item The file system item
 * @returns A unique string key
 */
export function getItemKey(item: FileSystemItem): string {
	const isUploading = 'isUploading' in item && item.isUploading
	return `${item.path}${isUploading ? '-uploading' : ''}`
}
