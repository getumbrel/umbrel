import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

import {usePendingRaidOperation} from '../providers/pending-operation-context'

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

type ScrubStatus = {
	state: 'scrubbing' | 'finished' | 'canceled'
	progress: number
	errors: number
}

type FailsafeTransitionStatus = {
	state: 'syncing' | 'rebooting' | 'rebuilding' | 'complete' | 'error'
	progress: number
	error?: string
}

export type RaidOperationType = 'expansion' | 'rebuild' | 'replace' | 'failsafe-transition' | 'scrub'

export type RaidProgress = {
	type: RaidOperationType
	state: string
	progress: number
	errors?: number
}

// How long after the latest event a status read has to be before it can overrule that event.
// Anything sooner could have started before the operation did.
const STATUS_SETTLE_MS = 2000
const STATUS_RECHECK_MS = 30_000

// Hook to subscribe to all RAID progress events and return the active operation.
// Returns null when no operation is in progress.
//
// Events only report change, so the pool's status covers what they can't: work that was already
// running when this mounted, and an operation whose final event was lost while the socket was down.
export function useRaidProgress(): RaidProgress | null {
	const {t} = useTranslation()
	const {setOperationError} = usePendingRaidOperation()
	const utils = trpcReact.useUtils()
	const lastEventAt = useRef(0)
	const lastFinalEventAt = useRef(0)
	const noteEvent = (isFinal: boolean) => {
		lastEventAt.current = Date.now()
		if (!isFinal) return
		// The cached status would otherwise keep reporting the operation once this one clears
		lastFinalEventAt.current = lastEventAt.current
		void utils.hardware.raid.getStatus.invalidate()
	}
	// Track all RAID operation states
	const [expansion, setExpansion] = useState<ExpansionStatus | null>(null)
	const [rebuild, setRebuild] = useState<RebuildStatus | null>(null)
	const [replace, setReplace] = useState<ReplaceStatus | null>(null)
	const [failsafeTransition, setFailsafeTransition] = useState<FailsafeTransitionStatus | null>(null)
	const [scrub, setScrub] = useState<ScrubStatus | null>(null)

	// Keep reading while an operation is showing, so a lost final event can't leave it stuck.
	// A read from before the latest final event says nothing about what's running now.
	const isTracking = !!(expansion || rebuild || replace || failsafeTransition || scrub)
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'
	const poolQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {
		enabled: isOwner,
		refetchInterval: isTracking ? STATUS_RECHECK_MS : false,
	})
	const pool = poolQ.dataUpdatedAt >= lastFinalEventAt.current ? poolQ.data : undefined

	// Subscribe to all RAID progress events
	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:expansion-progress'},
		{
			onData(data) {
				const status = data as ExpansionStatus
				noteEvent(status.state !== 'expanding')
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
				noteEvent(status.state !== 'rebuilding')
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
				noteEvent(status.state !== 'rebuilding')
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
				noteEvent(status.state === 'error' || status.state === 'complete')
				// On error: show toast and clear immediately. The hook is mounted by many
				// consumers at once (island + every storage dialog), so a stable id keeps
				// one event from stacking a toast per instance.
				if (status.state === 'error') {
					setOperationError(status.error || t('storage-manager.failsafe-transition-failed'))
					toast.error(status.error || t('storage-manager.failsafe-transition-failed'), {
						area: 'settings',
						id: 'raid-failsafe-transition-error',
					})
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

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:scrub-progress'},
		{
			onData(data) {
				const status = data as ScrubStatus
				noteEvent(status.state !== 'scrubbing')
				if (status.state === 'finished' || status.state === 'canceled') {
					setTimeout(() => setScrub(null), 2000)
				}
				setScrub(status)
			},
			onError(err) {
				console.error('eventBus.listen(raid:scrub-progress) subscription error', err)
			},
		},
	)

	// What the pool itself reports as running
	const poolFailsafeTransition =
		pool?.failsafeTransitionStatus && !['error', 'complete'].includes(pool.failsafeTransitionStatus.state)
			? pool.failsafeTransitionStatus
			: null
	const poolReplace = pool?.replace?.state === 'rebuilding' ? pool.replace : null
	const poolRebuild = pool?.rebuild?.state === 'rebuilding' ? pool.rebuild : null
	const poolExpansion = pool?.expansion?.state === 'expanding' ? pool.expansion : null
	const poolScrub = pool?.scrub?.state === 'scrubbing' ? pool.scrub : null

	// A settled read that no longer reports an operation means its final event went missing
	useEffect(() => {
		if (!pool || poolQ.dataUpdatedAt < lastEventAt.current + STATUS_SETTLE_MS) return
		if (expansion?.state === 'expanding' && !poolExpansion) setExpansion(null)
		if (rebuild?.state === 'rebuilding' && !poolRebuild) setRebuild(null)
		if (replace?.state === 'rebuilding' && !poolReplace) setReplace(null)
		if (scrub?.state === 'scrubbing' && !poolScrub) setScrub(null)
		if (failsafeTransition && failsafeTransition.state !== 'complete' && !poolFailsafeTransition) {
			setFailsafeTransition(null)
		}
		// Only a new read can change the answer
	}, [poolQ.dataUpdatedAt])

	const activeFailsafeTransition = failsafeTransition ?? poolFailsafeTransition
	const activeReplace = replace ?? poolReplace
	const activeRebuild = rebuild ?? poolRebuild
	const activeExpansion = expansion ?? poolExpansion
	const activeScrub = scrub ?? poolScrub

	// Determine which operation to display (priority order)
	// Failsafe transition takes priority as it's a major operation
	if (activeFailsafeTransition) {
		return {
			type: 'failsafe-transition',
			state: activeFailsafeTransition.state,
			progress: activeFailsafeTransition.progress,
		}
	}

	if (activeReplace) {
		return {
			type: 'replace',
			state: activeReplace.state,
			progress: activeReplace.progress,
		}
	}

	if (activeRebuild) {
		return {
			type: 'rebuild',
			state: activeRebuild.state,
			progress: activeRebuild.progress,
		}
	}

	if (activeExpansion) {
		return {
			type: 'expansion',
			state: activeExpansion.state,
			progress: activeExpansion.progress,
		}
	}

	if (activeScrub) {
		return {
			type: 'scrub',
			state: activeScrub.state,
			progress: activeScrub.progress,
			errors: activeScrub.errors,
		}
	}

	return null
}
