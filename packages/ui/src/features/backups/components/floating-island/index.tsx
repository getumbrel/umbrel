import {useBackupProgress} from '@/features/backups/hooks/use-backups'
import {useDescribeBackupLocation} from '@/features/backups/hooks/use-describe-backup-location'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {trpcReact} from '@/trpc/trpc'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

export function BackupsIsland() {
	// Poll backup progress; island visibility is controlled by container
	const progressQ = useBackupProgress(1000)
	const reposQ = trpcReact.backups.getRepositories.useQuery()
	const describeBackupLocation = useDescribeBackupLocation()

	const progresses = progressQ.data ?? []
	const repoMap = new Map((reposQ.data || []).map((r) => [r.id, r]))
	// TODO: Figure out why sometimes we cannot get the repo path and remove the path/null check
	const withNames: Array<{name: string; percent: number; path?: string}> = progresses
		.map((p: any) => {
			const repoPath = repoMap.get(p.repositoryId)?.path
			if (!repoPath) return null

			return {
				percent: p.percent ?? 0,
				name: describeBackupLocation(repoPath).name,
				path: repoPath,
			}
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)

	const count = withNames.length
	const totalPercent = count > 0 ? withNames.reduce((s, p) => s + (p.percent ?? 0), 0) / count : 0

	return (
		<Island id='backups-island' nonDismissable>
			<IslandMinimized>
				<MinimizedContent count={count} progress={totalPercent} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent progresses={withNames as any} />
			</IslandExpanded>
		</Island>
	)
}
