import {RouterOutput, trpcReact} from '@/trpc/trpc'

// Types from backend
export type RaidStatus = RouterOutput['hardware']['raid']['getStatus']
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]
export type RaidType = 'storage' | 'failsafe'

// RAID device status from ZFS pool
export type RaidDeviceStatus = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED'

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
}

// Threshold % for lifetime usage warning (100 = the rated endurance being fully used)
export const LIFETIME_WARNING_THRESHOLD = 80

// Get device health status - single source of truth for all health checks
export function getDeviceHealth(device: StorageDevice) {
	// SMART status
	const smartUnhealthy = device.smartStatus === 'unhealthy'

	// Lifetime remaining (inverse of lifetimeUsed)
	const lifeRemaining = device.lifetimeUsed !== undefined ? Math.max(0, 100 - device.lifetimeUsed) : undefined
	const lifeWarning = device.lifetimeUsed !== undefined && device.lifetimeUsed >= LIFETIME_WARNING_THRESHOLD

	// Temperature checks (critical takes precedence over warning)
	const tempCritical =
		device.temperature !== undefined &&
		device.temperatureCritical !== undefined &&
		device.temperature >= device.temperatureCritical

	const tempWarning =
		!tempCritical &&
		device.temperature !== undefined &&
		device.temperatureWarning !== undefined &&
		device.temperature >= device.temperatureWarning

	// Any warning present
	const hasWarning = smartUnhealthy || lifeWarning || tempWarning || tempCritical

	return {
		hasWarning,
		smartUnhealthy,
		lifeRemaining,
		lifeWarning,
		tempWarning,
		tempCritical,
	}
}

// Device in RAID with merged health info from internal storage
export type RaidDevice = StorageDevice & {
	// From RAID status
	raidStatus: 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED'
	readErrors: number
	writeErrors: number
	checksumErrors: number
}

// Hook options
type UseStorageOptions = {
	/** Polling interval in ms for detecting new devices. Set to false to disable polling. */
	pollInterval?: number | false
}

/**
 * Main hook for storage management.
 * Provides RAID status, device info, and mutations for managing storage.
 */
export function useStorage(options: UseStorageOptions = {}) {
	const {pollInterval = false} = options

	// Query: RAID pool status
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {
		refetchInterval: pollInterval,
	})

	// Query: All internal storage devices (NVMe SSDs)
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		refetchInterval: pollInterval,
	})

	// Mutation: Add device to RAID
	const addDeviceMut = trpcReact.hardware.raid.addDevice.useMutation({
		onSuccess: () => {
			// Refetch both queries after adding a device
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Transition from single-disk storage to failsafe mode
	const transitionToFailsafeMut = trpcReact.hardware.raid.transitionToFailsafe.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Replace a device in the RAID array
	const replaceDeviceMut = trpcReact.hardware.raid.replaceDevice.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Refetch data when RAID operations complete (non-blocking RPCs return before operation finishes)
	const refetchAll = () => {
		raidStatusQ.refetch()
		devicesQ.refetch()
	}

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:expansion-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:rebuild-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:replace-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:failsafe-transition-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'complete' || status.state === 'error') {
					refetchAll()
				}
			},
		},
	)

	// Derived: All detected devices
	const allDevices = devicesQ.data ?? []

	// Derived: RAID status
	const raidStatus = raidStatusQ.data

	// Derived: Device IDs that are in the RAID
	const raidDeviceIds = new Set(raidStatus?.devices?.map((d) => d.id) ?? [])

	// Derived: RAID devices with merged health info
	const raidDevices: RaidDevice[] = (raidStatus?.devices ?? [])
		.map((raidDevice) => {
			// Find matching device from internal storage for health info
			const storageDevice = allDevices.find((d) => d.id === raidDevice.id)
			if (!storageDevice) return null

			return {
				...storageDevice,
				raidStatus: raidDevice.status,
				readErrors: raidDevice.readErrors,
				writeErrors: raidDevice.writeErrors,
				checksumErrors: raidDevice.checksumErrors,
			}
		})
		.filter((d): d is RaidDevice => d !== null)

	// Derived: Available devices (not in RAID, can be added)
	// TODO: Currently UI is limited to adding 1 SSD at a time due to ZFS raidz1 expansion limitations.
	// When backend supports adding multiple SSDs at once, the UI can show all available devices.
	const availableDevices = allDevices.filter((device) => device.id && !raidDeviceIds.has(device.id))

	// Derived: Failed/missing RAID devices that need replacement
	// A device needs replacement if:
	// 1. It's in the RAID with a non-ONLINE status (FAULTED, UNAVAIL, DEGRADED, OFFLINE, REMOVED)
	// 2. OR it's in the RAID but has no matching physical device (was physically removed)
	const failedRaidDevices = (raidStatus?.devices ?? []).filter((rd) => {
		const hasMatchingPhysical = allDevices.some((d) => d.id === rd.id)
		const isNotOnline = rd.status !== 'ONLINE'
		// Include if status is bad OR if physically missing
		return isNotOnline || !hasMatchingPhysical
	})

	// Derived: Can we replace a failed device? (degraded array + failed device + available replacement)
	const isDegraded = raidStatus?.status === 'DEGRADED'
	const canReplaceFailedDevice = isDegraded && failedRaidDevices.length > 0 && availableDevices.length > 0

	// Derived: Loading state
	const isLoading = raidStatusQ.isLoading || devicesQ.isLoading

	// Derived: Error state
	const error = raidStatusQ.error || devicesQ.error

	// --- Chart data calculations ---
	// TODO: Consider adding device sizes directly to raid.getStatus() backend response
	// instead of cross-referencing with internalStorage.getDevices()

	// Get rounded sizes of all RAID devices (backend rounds to nearest 250GB for drives ≥1TB)
	// This eliminates wasted space from manufacturer variance (e.g., Samsung vs Phison "4TB" drives)
	const getRaidDeviceRoundedSizes = (): number[] => {
		if (!raidStatus?.exists || !raidStatus.devices) return []
		return raidStatus.devices
			.map((raidDevice) => {
				const storageDevice = allDevices.find((d) => d.id === raidDevice.id)
				return storageDevice?.roundedSize ?? 0
			})
			.filter((size) => size > 0)
	}

	const raidDeviceRoundedSizes = getRaidDeviceRoundedSizes()
	const minRoundedDriveSize = raidDeviceRoundedSizes.length > 0 ? Math.min(...raidDeviceRoundedSizes) : 0

	// Calculate wasted space in failsafe mode (when drives have different roundedSize values)
	// In RAIDZ1, all drives can only contribute as much as the smallest drive
	// Since backend partitions drives using roundedSize, wasted space only occurs when
	// roundedSize values differ (e.g., mixing 2TB and 4TB drives)
	const calculateWastedSpace = (): number => {
		if (!raidStatus?.exists || raidStatus.raidType !== 'failsafe' || raidDeviceRoundedSizes.length < 2) {
			return 0
		}

		const totalRoundedSize = raidDeviceRoundedSizes.reduce((sum, size) => sum + size, 0)
		const usableRoundedSize = minRoundedDriveSize * raidDeviceRoundedSizes.length
		return Math.max(0, totalRoundedSize - usableRoundedSize)
	}

	// Calculate chart data from RAID status (works with both mock and real data)
	const wastedBytes = calculateWastedSpace()
	const availableBytes = raidStatus?.usableSpace ?? 0
	const failsafeOverheadBytes =
		raidStatus?.raidType === 'failsafe' && raidStatus.totalSpace && raidStatus.usableSpace
			? raidStatus.totalSpace - raidStatus.usableSpace
			: 0
	const totalCapacityBytes = availableBytes + failsafeOverheadBytes + wastedBytes

	// Chart data in TB (for donut chart proportions)
	const chartData = {
		used: raidStatus?.usedSpace ? raidStatus.usedSpace / 1e12 : 0,
		available: availableBytes / 1e12,
		failsafe: failsafeOverheadBytes / 1e12,
		wasted: wastedBytes / 1e12,
	}

	// Total for the chart = available + failsafe + wasted
	const chartTotal = chartData.available + chartData.failsafe + chartData.wasted

	// Derived: Number of drives currently in RAID
	const raidDriveCount = raidStatus?.devices?.length ?? 0

	// Derived: Can user choose between Storage and FailSafe when adding?
	// Only when they have exactly 1 drive in storage mode
	const canChooseMode = raidStatus?.exists && raidStatus.raidType === 'storage' && raidDriveCount === 1

	return {
		// RAID pool info
		raidStatus,
		raidExists: raidStatus?.exists ?? false,
		raidType: raidStatus?.raidType,
		poolStatus: raidStatus?.status,

		// Space info (raw bytes) for display with formatStorageSize
		usedSpace: raidStatus?.usedSpace,
		availableBytes,
		failsafeOverheadBytes,
		wastedBytes,
		totalCapacityBytes,

		// Chart data (in TB, for donut chart proportions)
		chartData: {
			...chartData,
			total: chartTotal,
		},

		// Per-drive wasted calculation (for failsafe mode with mismatched drives)
		// In failsafe mode, each drive can only contribute up to the smallest rounded size
		minRoundedDriveSize,

		// Devices
		allDevices,
		raidDevices,
		raidDriveCount,
		availableDevices,
		// Map devices to 4 slots (Umbrel Pro has 4 SSD slots)
		ssdSlots: Array.from({length: 4}, (_, i) => allDevices.find((d) => d.slot === i + 1) ?? null),
		// Set of device IDs that are detected but not in RAID (ready to add)
		readyToAddIds: new Set(availableDevices.map((d) => d.id)),

		// Mode selection
		// True when user has exactly 1 drive in storage mode and is adding more
		// In this case they can choose to stay in storage or switch to failsafe
		canChooseMode,

		// Degraded/failed device replacement
		// Failed RAID devices that need replacement (non-ONLINE status or physically missing)
		failedRaidDevices,
		// True when array is degraded AND has failed devices AND has available replacement devices
		canReplaceFailedDevice,
		isDegraded,

		// State
		isLoading,
		error,

		// Mutations
		addDevice: addDeviceMut.mutate,
		addDeviceAsync: addDeviceMut.mutateAsync,
		isAddingDevice: addDeviceMut.isPending,
		addDeviceError: addDeviceMut.error,

		transitionToFailsafe: transitionToFailsafeMut.mutate,
		transitionToFailsafeAsync: transitionToFailsafeMut.mutateAsync,
		isTransitioning: transitionToFailsafeMut.isPending,
		transitionError: transitionToFailsafeMut.error,

		replaceDevice: replaceDeviceMut.mutate,
		replaceDeviceAsync: replaceDeviceMut.mutateAsync,
		isReplacingDevice: replaceDeviceMut.isPending,
		replaceDeviceError: replaceDeviceMut.error,

		// Refetch
		refetch: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	}
}
