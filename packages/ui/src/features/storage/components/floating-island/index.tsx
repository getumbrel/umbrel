import {useEffect} from 'react'

import {usePendingRaidOperation} from '@/features/storage/contexts/pending-operation-context'
import {useRaidProgress, type RaidOperationType, type RaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

// Re-export types for use in child components
export type {RaidOperationType, RaidProgress}

// i18n translation keys for operation types - call t() with these at render time
// t('storage-manager.operation.expanding')
// t('storage-manager.operation.rebuilding')
// t('storage-manager.operation.replacing')
// t('storage-manager.operation.enabling-failsafe')
export const raidOperationLabels: Record<RaidOperationType, string> = {
	expansion: 'storage-manager.operation.expanding',
	rebuild: 'storage-manager.operation.rebuilding',
	replace: 'storage-manager.operation.replacing',
	'failsafe-transition': 'storage-manager.operation.enabling-failsafe',
}

export function RaidIsland() {
	const realOperation = useRaidProgress()
	const {pendingOperation, clearPendingOperation} = usePendingRaidOperation()

	// When real events arrive, clear the pending operation
	useEffect(() => {
		if (realOperation && pendingOperation) {
			clearPendingOperation()
		}
	}, [realOperation, pendingOperation, clearPendingOperation])

	// Use real operation if available, otherwise fall back to pending
	const activeOperation = realOperation ?? pendingOperation

	// Don't render if no active operation
	// Container handles visibility check, but this is a safety fallback
	if (!activeOperation) return null

	// Force the island to stay expanded when rebooting so the countdown is always visible.
	// This helps ensure users see this critical warning before the system restarts.
	const isRebooting = activeOperation.state === 'rebooting'

	return (
		<Island id='raid-island' nonDismissable forceExpanded={isRebooting}>
			<IslandMinimized>
				<MinimizedContent operation={activeOperation} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent operation={activeOperation} />
			</IslandExpanded>
		</Island>
	)
}
