import {cloudSyncName, useCloudAccounts, useCloudProviders, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import {cloudAccountBrand, cloudBrandName} from '@/features/files/utils/cloud'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {cloudActivityHasWork, useCloudActivity} from '@/providers/cloud'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

export type CloudIslandRow = {
	id: string
	name: string
	provider?: string
	providerName?: string
	percent?: number
	transferredFiles: number
	totalFiles?: number
	transferredBytes: number
	totalBytes?: number
	bytesPerSecond: number
}

export function CloudIsland() {
	const {activities} = useCloudActivity()
	// Name and brand lookup for the active transfers
	const {data: clouds} = useCloudSyncs()
	const {data: providers} = useCloudProviders()
	const {data: accounts} = useCloudAccounts()

	// Hide rows still in the scan/check phase so a scanning download doesn't sit
	// next to a transferring one with "-" for its byte count
	const rows: CloudIslandRow[] = activities.filter(cloudActivityHasWork).map((activity) => {
		const record = clouds?.find(({id}) => id === activity.syncId)
		const account = accounts?.find(({id}) => id === record?.accountId)
		const brand = account ? cloudAccountBrand(account) : 'cloud'
		return {
			id: activity.syncId,
			name: record ? cloudSyncName(record) : '',
			provider: brand,
			providerName: cloudBrandName(brand, providers) ?? account?.displayName ?? 'Cloud',
			percent: activity.percent,
			transferredFiles: activity.transferredFiles,
			totalFiles: activity.totalFiles,
			transferredBytes: activity.transferredBytes,
			totalBytes: activity.totalBytes,
			bytesPerSecond: activity.bytesPerSecond,
		}
	})

	// Aggregate over transfers with a known percent; undefined when all are
	// indeterminate. When every one of them also reports a total size, the
	// aggregate weights by size so a 100 GB download doesn't advance at the pace
	// of a 10 MB sibling.
	const known = rows.filter((row) => row.percent !== undefined)
	const weighted = known.length > 0 && known.every((row) => row.totalBytes)
	const totalPercent =
		known.length > 0
			? weighted
				? known.reduce((sum, row) => sum + (row.percent ?? 0) * (row.totalBytes ?? 0), 0) /
					known.reduce((sum, row) => sum + (row.totalBytes ?? 0), 0)
				: known.reduce((sum, row) => sum + (row.percent ?? 0), 0) / known.length
			: undefined
	const totalSpeed = rows.reduce((sum, row) => sum + row.bytesPerSecond, 0)

	return (
		<Island id='cloud-island' nonDismissable>
			<IslandMinimized>
				<MinimizedContent rows={rows} totalPercent={totalPercent} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent rows={rows} totalSpeed={totalSpeed} />
			</IslandExpanded>
		</Island>
	)
}
