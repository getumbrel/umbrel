import type {FileSystemItem} from '@/features/files/types'

/**
 * Group snapshot item paths by their present-day destination directory for restore.
 *
 * Context:
 * - In Rewind feature, users browse a mounted snapshot at virtual roots:
 *   - `/Backups/<mountedDir>/Home`
 *   - `/Backups/<mountedDir>/Apps`
 * - When restoring, we want to copy selected items back to their logical parents
 *   under `/Home` or `/Apps` in the current filesystem, preserving their folder structure.
 * - Our copy API (`copyItems`) accepts a single `toDirectory` per batch, so we need
 *   to group selected source paths by their target parent directory.
 *
 * Example:
 * - Selected from snapshot:
 *   - `/Backups/<dir>/Home/Documents/Notes/todo.txt`
 *   - `/Backups/<dir>/Home/Documents/Notes/ideas.md`
 *   - `/Backups/<dir>/Apps/Memos/data.db`
 *
 * - Grouped result map:
 *   - key `/Home/Documents/Notes` -> [both notes files]
 *   - key `/Apps/Memos` -> [data.db]
 */
export function groupRestoreByDestination(selectedItems: FileSystemItem[], mountedDir: string): Map<string, string[]> {
	const baseHome = `/Backups/${mountedDir}/Home`
	const baseApps = `/Backups/${mountedDir}/Apps`
	const groups = new Map<string, string[]>()
	for (const item of selectedItems) {
		let destRoot = ''
		let relative = ''
		if (item.path.startsWith(baseHome)) {
			destRoot = '/Home'
			relative = item.path.slice(baseHome.length)
		} else if (item.path.startsWith(baseApps)) {
			destRoot = '/Apps'
			relative = item.path.slice(baseApps.length)
		} else {
			// Ignore items outside the mounted snapshot roots.
			continue
		}
		if (relative.startsWith('/')) relative = relative.slice(1)
		const parts = relative.split('/').filter(Boolean)
		// Drop the file/folder name; we want just the parent directory.
		parts.pop()
		const destDir = `${destRoot}${parts.length ? `/${parts.join('/')}` : ''}`
		if (!groups.has(destDir)) groups.set(destDir, [])
		groups.get(destDir)!.push(item.path)
	}
	return groups
}
