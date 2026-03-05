import type {Backup} from '@/features/backups/hooks/use-backups'

// Sort backups from latest to oldest
export function sortBackupsByTimeDesc(backups: Backup[] | undefined | null): Backup[] {
	if (!Array.isArray(backups)) return []
	return [...backups].sort((a, b) => {
		const timeA = a.time ? new Date(a.time).getTime() : 0
		const timeB = b.time ? new Date(b.time).getTime() : 0
		return timeB - timeA
	}) as Backup[]
}
