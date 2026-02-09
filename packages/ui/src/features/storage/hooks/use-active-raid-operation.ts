import {usePendingRaidOperation} from '../providers/pending-operation-context'
import {RaidProgress, useRaidProgress} from './use-raid-progress'

/**
 * Hook to check if any RAID operation is currently active.
 * Combines real operations (from backend events) with pending operations (optimistic UI).
 * Use this to prevent starting new operations while one is in progress.
 */
export function useActiveRaidOperation(): RaidProgress | null {
	const realOperation = useRaidProgress()
	const {pendingOperation} = usePendingRaidOperation()
	return realOperation ?? pendingOperation
}
