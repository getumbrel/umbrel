import {RouterOutput, trpcReact} from '@/trpc/trpc'

import {getGenericSsdRaidDevices} from '../storage-selection'

// Type from backend hardware.internalStorage.getDevices
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]

// Hook to detect storage devices. Umbrel Pro owns all devices returned here; generic
// SSD onboarding must exclude the boot disk, unidentified disks, and HDDs.
export function useDetectStorageDevices({genericSsd = false}: {genericSsd?: boolean} = {}) {
	const query = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		// Poll every 3 seconds so newly attached drives show up quickly during onboarding
		// (also keeps temperature and health status up to date)
		refetchInterval: 3_000,
	})

	const detectedDevices = query.data ?? []
	const devices = genericSsd ? getGenericSsdRaidDevices(detectedDevices) : detectedDevices

	return {
		devices,
		// We only use isLoading (not isFetching) so polling doesn't trigger the loading scanner
		isDetecting: query.isLoading,
		isFetching: query.isFetching,
		error: query.error?.message ?? null,
		refetch: query.refetch,
	}
}
