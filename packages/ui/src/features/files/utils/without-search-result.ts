import type {FileSystemItem} from '@/features/files/types'

// A file found by a search is listed, and opened, as the result it is: why it
// matched and where in it (see `searchResult`). Anywhere else it is only the
// file. This is the file, for wherever one leaves the search that found it:
// shown in its folder, renamed, saved as a copy, held on the clipboard.
export function withoutSearchResult<T extends FileSystemItem>(item: T): T {
	if (!item.searchResult) return item
	const file = {...item}
	delete file.searchResult
	return file
}
