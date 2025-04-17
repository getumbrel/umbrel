import type {FileSystemItem, ViewPreferences} from '@/features/files/types'

// Static comparison utility for fast sorting
const collator = new Intl.Collator('en-US', {sensitivity: 'base', numeric: true})

const compareByName = (a: FileSystemItem, b: FileSystemItem) => collator.compare(a.name, b.name)

// TODO: Add this back in when we have a file system index in umbreld
// const compareByCreated = (a: FileSystemItem, b: FileSystemItem) => {
// 	const aCreated = a.created ? new Date(a.created).getTime() : 0
// 	const bCreated = b.created ? new Date(b.created).getTime() : 0
// 	return aCreated - bCreated
// }

const compareByModified = (a: FileSystemItem, b: FileSystemItem) => {
	const aModified = a.modified ? new Date(a.modified).getTime() : 0
	const bModified = b.modified ? new Date(b.modified).getTime() : 0
	return aModified - bModified
}

const compareByType = (a: FileSystemItem, b: FileSystemItem) => {
	const aType = a.type || ''
	const bType = b.type || ''
	return collator.compare(aType, bType)
}

const compareBySize = (a: FileSystemItem, b: FileSystemItem) => {
	const aSize = a.size || 0
	const bSize = b.size || 0
	return aSize - bSize
}

/**
 * Sort filesystem items based on the provided sort options
 * @param items - Array of filesystem items to sort
 * @param sortBy - Property to sort by
 * @param sortOrder - Sort order (ascending or descending)
 * @returns Sorted array of filesystem items
 */
export function sortFilesystemItems(
	items: FileSystemItem[],
	sortBy: ViewPreferences['sortBy'] = 'name',
	sortOrder: ViewPreferences['sortOrder'] = 'ascending',
): FileSystemItem[] {
	const ascending = sortOrder === 'ascending'
	const compare =
		// TODO: Add this back in when we have a file system index in umbreld
		// sortBy === 'created'
		// 	? compareByCreated :
		sortBy === 'modified'
			? compareByModified
			: sortBy === 'type'
				? compareByType
				: sortBy === 'size'
					? compareBySize
					: compareByName

	return [...items].sort((a, b) => {
		// Apply sort order and fall back to compare by name when comparing equal
		const comparison = compare(a, b) || compareByName(a, b)
		return ascending ? comparison : -comparison
	})
}
