import {useEffect} from 'react'

import {usePoolDeviceType} from '@/features/storage/hooks/use-pool-device-type'
import {useRaidProgress, type RaidOperationType, type RaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {usePendingRaidOperation} from '@/features/storage/providers/pending-operation-context'
import {failsafeStep} from '@/features/storage/state'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {trpcReact} from '@/trpc/trpc'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

// Re-export types for use in child components
export type {RaidOperationType, RaidProgress}

// Scrubs run silently in the background - their results surface through toasts and the
// storage manager, never an island - so island contents only deal with the remaining
// operation types. useRaidProgress still tracks scrub for the toasts and dialog gating.
export type IslandOperationType = Exclude<RaidOperationType, 'scrub'>
export type IslandRaidProgress = Omit<RaidProgress, 'type'> & {type: IslandOperationType}

export function isIslandOperation(operation: RaidProgress): operation is IslandRaidProgress {
	return operation.type !== 'scrub'
}

// What the island shows for a task: the same step and the same number Storage Manager shows.
// umbreld reports one number for a whole switch to FailSafe, with the restart at 50. Storage
// Manager shows each step's own progress, so the island does too. A switch to mirrored pairs
// (`mirrored`) is a single step.
export function islandProgress(operation: IslandRaidProgress, mirrored: boolean) {
	if (operation.type !== 'failsafe-transition' || operation.state === 'complete' || operation.state === 'starting')
		return {step: null, progress: operation.progress}
	const phase =
		operation.state === 'syncing' ? 'copying' : operation.state === 'rebooting' ? 'restarting' : 'rebuilding'
	const {step, progress} = failsafeStep({
		kind: 'failsafe',
		phase,
		progress: operation.progress,
		to: mirrored ? 'mirror' : undefined,
	})
	// The copy is done by the time the restart starts
	return {step, progress: progress ?? 100}
}

// t('storage-manager.operation.step-copy')
// t('storage-manager.operation.step-restart')
// t('storage-manager.operation.step-protect')
export const islandStepLabels = [
	'storage-manager.operation.step-copy',
	'storage-manager.operation.step-restart',
	'storage-manager.operation.step-protect',
] as const

// i18n translation keys for operation types - call t() with these at render time
// t('storage-manager.operation.expanding')
// t('storage-manager.operation.rebuilding')
// t('storage-manager.operation.replacing')
// t('storage-manager.operation.enabling-failsafe')
export const raidOperationLabels: Record<IslandOperationType, string> = {
	expansion: 'storage-manager.operation.expanding',
	rebuild: 'storage-manager.operation.rebuilding',
	replace: 'storage-manager.operation.replacing',
	'failsafe-transition': 'storage-manager.operation.enabling-failsafe',
}

export function RaidIsland() {
	const realOperation = useRaidProgress()
	const {pendingOperation, clearPendingOperation} = usePendingRaidOperation()
	// HDD pools get platter visuals, SSD pools the NAND flicker (and 'ssd' is the fallback while loading)
	const deviceType = usePoolDeviceType()
	// A switch to mirrored pairs makes the storage mirrored from its first moment
	const mirrored = trpcReact.hardware.raid.getStatus.useQuery(undefined, {staleTime: 5_000}).data?.topology === 'mirror'

	// A scrub is never displayed, so it must not clear a pending operation either
	const displayedRealOperation = realOperation && isIslandOperation(realOperation) ? realOperation : null

	// When real events arrive, clear the pending operation
	useEffect(() => {
		if (displayedRealOperation && pendingOperation) {
			clearPendingOperation()
		}
	}, [displayedRealOperation, pendingOperation, clearPendingOperation])

	// Use real operation if available, otherwise fall back to pending
	const activeOperation = displayedRealOperation ?? pendingOperation

	// Don't render without a displayable operation (dialogs never set a pending scrub).
	// Container handles visibility check, but this is a safety fallback.
	if (!activeOperation || !isIslandOperation(activeOperation)) return null

	// Force the island to stay expanded when rebooting so the countdown is always visible.
	// This helps ensure users see this critical warning before the system restarts.
	const isRebooting = activeOperation.state === 'rebooting'

	return (
		<Island id='raid-island' nonDismissable forceExpanded={isRebooting}>
			<IslandMinimized>
				<MinimizedContent operation={activeOperation} deviceType={deviceType} mirrored={mirrored} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent operation={activeOperation} deviceType={deviceType} mirrored={mirrored} />
			</IslandExpanded>
		</Island>
	)
}
