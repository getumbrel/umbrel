import {RouterInput, RouterOutput, trpcReact} from '@/trpc/trpc'

// Types from backend
export type RaidStatus = RouterOutput['hardware']['raid']['getStatus']
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]

// RAID device status from ZFS pool
export type RaidDeviceStatus = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED' | 'CANT_OPEN'

// i18n translation keys for RAID device statuses - call t() with these at render time
// t('storage-manager.raid-status.online')
// t('storage-manager.raid-status.degraded')
// t('storage-manager.raid-status.failed')
// t('storage-manager.raid-status.offline')
// t('storage-manager.raid-status.unavailable')
// t('storage-manager.raid-status.removed')
export const raidStatusLabels: Record<RaidDeviceStatus, string> = {
	ONLINE: 'storage-manager.raid-status.online',
	DEGRADED: 'storage-manager.raid-status.degraded',
	FAULTED: 'storage-manager.raid-status.failed',
	OFFLINE: 'storage-manager.raid-status.offline',
	UNAVAIL: 'storage-manager.raid-status.unavailable',
	REMOVED: 'storage-manager.raid-status.removed',
	CANT_OPEN: 'storage-manager.raid-status.unavailable',
}

type UseStorageOptions = {
	/** Polling interval in ms, for temperature and health. Set to false to disable polling. */
	pollInterval?: number | false
}

type StorageEvent = RouterInput['eventBus']['listen']['event']

// A task ending, as each of umbreld's progress events says it
const ended = ['finished', 'canceled']
const switchEnded = ['complete', 'error']

// Reads again when umbreld announces that something has ended or changed
function useRefetchOn(event: StorageEvent, refetch: () => void, endings?: string[]) {
	trpcReact.eventBus.listen.useSubscription(
		{event},
		{
			onData(data) {
				if (!endings || endings.includes((data as {state: string}).state)) refetch()
			},
		},
	)
}

/**
 * The storage as umbreld reports it, kept fresh, and the changes umbreld can be asked to make.
 * Every change resolves once umbreld has accepted it: the work itself carries on afterwards,
 * and is followed through the progress events.
 */
export function useStorage({pollInterval = false}: UseStorageOptions = {}) {
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {refetchInterval: pollInterval})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {refetchInterval: pollInterval})

	const refetchAll = () => {
		void raidStatusQ.refetch()
		void devicesQ.refetch()
	}
	const mutation = {onSuccess: refetchAll}

	const addDeviceMut = trpcReact.hardware.raid.addDevice.useMutation(mutation)
	const addMirrorMut = trpcReact.hardware.raid.addMirror.useMutation(mutation)
	const addAcceleratorMut = trpcReact.hardware.raid.addAccelerator.useMutation(mutation)
	const replaceDeviceMut = trpcReact.hardware.raid.replaceDevice.useMutation(mutation)
	const transitionToFailsafeRaidzMut = trpcReact.hardware.raid.transitionToFailsafeRaidz.useMutation(mutation)
	const transitionToFailsafeMirrorMut = trpcReact.hardware.raid.transitionToFailsafeMirror.useMutation(mutation)
	const scrubMut = trpcReact.hardware.raid.scrub.useMutation(mutation)

	// The changes above return before their work is done, and drives come and go by themselves:
	// umbreld's events say when to read again
	useRefetchOn('raid:expansion-progress', refetchAll, ended)
	useRefetchOn('raid:rebuild-progress', refetchAll, ended)
	useRefetchOn('raid:replace-progress', refetchAll, ended)
	useRefetchOn('raid:scrub-progress', refetchAll, ended)
	useRefetchOn('raid:failsafe-transition-progress', refetchAll, switchEnded)
	// Block devices appearing or disappearing (throttled by the backend)
	useRefetchOn('system:disk:change', refetchAll)
	// The pool's user-visible state changing (status, membership, per-member status, raid type,
	// topology), from the backend's pool monitor
	useRefetchOn('raid:status-change', refetchAll)

	return {
		raidStatusQ,
		devicesQ,
		addDeviceAsync: addDeviceMut.mutateAsync,
		addMirrorAsync: addMirrorMut.mutateAsync,
		addAcceleratorAsync: addAcceleratorMut.mutateAsync,
		replaceDeviceAsync: replaceDeviceMut.mutateAsync,
		transitionToFailsafeRaidzAsync: transitionToFailsafeRaidzMut.mutateAsync,
		transitionToFailsafeMirrorAsync: transitionToFailsafeMirrorMut.mutateAsync,
		scrubAsync: scrubMut.mutateAsync,
	}
}
