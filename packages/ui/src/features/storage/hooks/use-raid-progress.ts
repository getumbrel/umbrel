import {useState} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// Types matching the backend event types
type ExpansionStatus = {
	state: 'expanding' | 'finished' | 'canceled'
	progress: number
}

type RebuildStatus = {
	state: 'rebuilding' | 'finished' | 'canceled'
	progress: number
}

type ReplaceStatus = RebuildStatus

type FailsafeTransitionStatus = {
	state: 'syncing' | 'rebooting' | 'rebuilding' | 'complete' | 'error'
	progress: number
	error?: string
}

export type RaidOperationType = 'expansion' | 'rebuild' | 'replace' | 'failsafe-transition'

export type RaidProgress = {
	type: RaidOperationType
	state: string
	progress: number
}

// Hook to subscribe to all RAID progress events and return the active operation.
// Returns null when no operation is in progress.
export function useRaidProgress(): RaidProgress | null {
	// Track all RAID operation states
	const [expansion, setExpansion] = useState<ExpansionStatus | null>(null)
	const [rebuild, setRebuild] = useState<RebuildStatus | null>(null)
	const [replace, setReplace] = useState<ReplaceStatus | null>(null)
	const [failsafeTransition, setFailsafeTransition] = useState<FailsafeTransitionStatus | null>(null)

	// Subscribe to all RAID progress events
	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:expansion-progress'},
		{
			onData(data) {
				const status = data as ExpansionStatus
				// Clear when finished or canceled
				if (status.state === 'finished' || status.state === 'canceled') {
					// Keep visible briefly so user sees completion
					setTimeout(() => setExpansion(null), 2000)
				}
				setExpansion(status)
			},
			onError(err) {
				console.error('eventBus.listen(raid:expansion-progress) subscription error', err)
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:rebuild-progress'},
		{
			onData(data) {
				const status = data as RebuildStatus
				if (status.state === 'finished' || status.state === 'canceled') {
					setTimeout(() => setRebuild(null), 2000)
				}
				setRebuild(status)
			},
			onError(err) {
				console.error('eventBus.listen(raid:rebuild-progress) subscription error', err)
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:replace-progress'},
		{
			onData(data) {
				const status = data as ReplaceStatus
				if (status.state === 'finished' || status.state === 'canceled') {
					setTimeout(() => setReplace(null), 2000)
				}
				setReplace(status)
			},
			onError(err) {
				console.error('eventBus.listen(raid:replace-progress) subscription error', err)
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:failsafe-transition-progress'},
		{
			onData(data) {
				const status = data as FailsafeTransitionStatus
				// On error: show toast and clear immediately
				if (status.state === 'error') {
					toast.error(status.error || t('storage-manager.failsafe-transition-failed'))
					setFailsafeTransition(null)
					return
				}
				// On complete: keep visible briefly so user sees completion
				if (status.state === 'complete') {
					setTimeout(() => setFailsafeTransition(null), 2000)
				}
				setFailsafeTransition(status)
			},
			onError(err) {
				console.error('eventBus.listen(raid:failsafe-transition-progress) subscription error', err)
			},
		},
	)

	// Determine which operation to display (priority order)
	// Failsafe transition takes priority as it's a major operation
	if (failsafeTransition) {
		return {
			type: 'failsafe-transition',
			state: failsafeTransition.state,
			progress: failsafeTransition.progress,
		}
	}

	if (replace) {
		return {
			type: 'replace',
			state: replace.state,
			progress: replace.progress,
		}
	}

	if (rebuild) {
		return {
			type: 'rebuild',
			state: rebuild.state,
			progress: rebuild.progress,
		}
	}

	if (expansion) {
		return {
			type: 'expansion',
			state: expansion.state,
			progress: expansion.progress,
		}
	}

	return null
}
