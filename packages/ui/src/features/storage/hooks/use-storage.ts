import {RouterOutput, trpcReact} from '@/trpc/trpc'

import {getPoolDeviceType} from '../utils'

// Types from backend
export type RaidStatus = RouterOutput['hardware']['raid']['getStatus']
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]
export type RaidType = 'storage' | 'failsafe'

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

// Pick a drive to rebuild a failed member onto. Of those large enough, a healthy one comes
// first, then the member's own disk if it can be repaired in place. A spare with a warning is
// the last resort: rebuilding onto a failing drive would leave the pool exposed all over again.
export function pickReplacementDrive(candidates: StorageDevice[], minimumSize: number, ownDisk?: StorageDevice) {
	const fitting = candidates.filter((drive) => (drive.roundedSize ?? drive.size) >= minimumSize)
	return fitting.find((drive) => !getDeviceHealth(drive).hasWarning) ?? ownDisk ?? fitting[0]
}

// Threshold % for lifetime usage warning (100 = the rated endurance being fully used)
export const LIFETIME_WARNING_THRESHOLD = 80

// Get device health status - single source of truth for all health checks
export function getDeviceHealth(device: StorageDevice) {
	const isSsd = device.type === 'ssd'

	// SMART status
	const smartUnhealthy = device.smartStatus === 'unhealthy'

	// Lifetime remaining (inverse of lifetimeUsed)
	const lifeRemaining = isSsd && device.lifetimeUsed !== undefined ? Math.max(0, 100 - device.lifetimeUsed) : undefined
	const lifeWarning = isSsd && device.lifetimeUsed !== undefined && device.lifetimeUsed >= LIFETIME_WARNING_THRESHOLD

	// Temperature checks (critical takes precedence over warning)
	const tempCritical =
		device.temperature !== undefined &&
		isSsd &&
		device.temperatureCritical !== undefined &&
		device.temperature >= device.temperatureCritical

	const tempWarning =
		!tempCritical &&
		device.temperature !== undefined &&
		isSsd &&
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
	raidStatus: RaidDeviceStatus
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

	// Mutation: Transition from single-disk SSD storage to failsafe (raidz) mode
	const transitionToFailsafeMut = trpcReact.hardware.raid.transitionToFailsafeRaidz.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Add a mirror pair to an HDD failsafe array
	const addMirrorMut = trpcReact.hardware.raid.addMirror.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Add SSD accelerator device(s) to an HDD array
	const addAcceleratorMut = trpcReact.hardware.raid.addAccelerator.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Transition an HDD storage array to failsafe (mirror) mode
	const transitionToFailsafeMirrorMut = trpcReact.hardware.raid.transitionToFailsafeMirror.useMutation({
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

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:scrub-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	// Live-reload when block devices appear or disappear (throttled by the backend)
	trpcReact.eventBus.listen.useSubscription(
		{event: 'system:disk:change'},
		{
			onData() {
				refetchAll()
			},
		},
	)

	// Live-reload when the pool's user-visible state changes (status, membership,
	// per-member status, raid type, topology) - emitted by the backend pool monitor
	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:status-change'},
		{
			onData() {
				refetchAll()
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

	// Derived: Accelerator device IDs - these live outside raidStatus.devices (data vdevs only)
	// so they must be excluded from "available" devices separately
	const acceleratorDeviceIds = new Set(raidStatus?.accelerator?.devices?.map((d) => d.id) ?? [])

	// Derived: Available devices (not in RAID, can be added). System drives are excluded -
	// they're shown in their own section and must never be offered as RAID candidates.
	// TODO: Currently UI is limited to adding 1 SSD at a time due to ZFS raidz expansion limitations.
	// When backend supports adding multiple SSDs at once, the UI can show all available devices.
	const availableDevices = allDevices.filter(
		(device) =>
			device.id && !raidDeviceIds.has(device.id) && !acceleratorDeviceIds.has(device.id) && !device.isSystemDrive,
	)

	// Derived: Disks that back the running system (boot drive). Shown for health visibility
	// on custom hardware but never usable for storage.
	const systemDrives = allDevices.filter((device) => device.isSystemDrive)

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

	const poolDeviceType = getPoolDeviceType(raidStatus, allDevices)

	// Derived: Mirror pairs for HDD failsafe pools. Members keep their pool status even when
	// the physical device is missing so the UI can render a failed/removed drive.
	const mirrorPairs = (raidStatus?.mirrors ?? []).map((memberIds) =>
		memberIds.map((id) => ({
			id,
			raidDevice: raidDevices.find((d) => d.id === id),
			status: raidStatus?.devices?.find((d) => d.id === id)?.status,
		})),
	)

	// Derived: Unpooled devices split by type. On HDD pools the SSDs are accelerator
	// candidates and the HDDs are data drive candidates.
	const availableHdds = availableDevices.filter((device) => device.type === 'hdd')
	const availableSsds = availableDevices.filter((device) => device.type === 'ssd')

	// Derived: Accelerator devices with physical health and both ZFS partition
	// counters merged into one RaidDevice (undefined when detached).
	const acceleratorDevices = (raidStatus?.accelerator?.devices ?? []).map((acceleratorDevice) => {
		const storageDevice = allDevices.find((device) => device.id === acceleratorDevice.id)
		return {
			id: acceleratorDevice.id,
			status: acceleratorDevice.status,
			device: storageDevice
				? {
						...storageDevice,
						raidStatus: acceleratorDevice.status,
						readErrors: acceleratorDevice.readErrors,
						writeErrors: acceleratorDevice.writeErrors,
						checksumErrors: acceleratorDevice.checksumErrors,
					}
				: undefined,
		}
	})

	// Derived: Total size of attached drives that aren't part of the pool or accelerator
	const inactiveBytes = availableDevices.reduce((sum, device) => sum + device.size, 0)

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

	// Calculate wasted space in failsafe mode (when drives have different roundedSize values).
	// The topologies waste space differently: in raidz1 all drives can only contribute as much
	// as the smallest drive in the array, while in mirror pairs each drive is only limited by
	// its own partner. Since backend partitions drives using roundedSize, wasted space only
	// occurs when roundedSize values differ (e.g., mixing 2TB and 4TB drives)
	const calculateWastedSpace = (): number => {
		if (!raidStatus?.exists || raidStatus.raidType !== 'failsafe') return 0

		if (raidStatus.topology === 'raidz') {
			if (raidDeviceRoundedSizes.length < 2) return 0
			const totalRoundedSize = raidDeviceRoundedSizes.reduce((sum, size) => sum + size, 0)
			const usableRoundedSize = minRoundedDriveSize * raidDeviceRoundedSizes.length
			return Math.max(0, totalRoundedSize - usableRoundedSize)
		}

		if (raidStatus.topology === 'mirror') {
			return (raidStatus.mirrors ?? []).reduce((wasted, memberIds) => {
				const sizes = memberIds
					.map((id) => allDevices.find((d) => d.id === id)?.roundedSize)
					.filter((size): size is number => size !== undefined)
				if (sizes.length < 2) return wasted
				const smallest = Math.min(...sizes)
				return wasted + sizes.reduce((sum, size) => sum + (size - smallest), 0)
			}, 0)
		}

		return 0
	}

	// Calculate chart data from RAID status (works with both mock and real data).
	// Accelerator capacity (the special vdev) is included in ZFS usable space but is presented
	// to the user as acceleration rather than storage, so it's excluded from these numbers.
	const wastedBytes = calculateWastedSpace()
	const acceleratorSpecialBytes = raidStatus?.accelerator?.exists ? (raidStatus.accelerator.specialSize ?? 0) : 0
	const availableBytes = Math.max(0, (raidStatus?.usableSpace ?? 0) - acceleratorSpecialBytes)
	let failsafeOverheadBytes = 0
	if (raidStatus?.raidType === 'failsafe' && raidStatus.totalSpace && raidStatus.usableSpace) {
		// Mirror pools duplicate every stored byte, so the overhead is whatever remains of the
		// raw data-drive capacity after available and wasted space (totalSpace only covers the
		// data drives). raidz keeps the original total - usable calculation.
		failsafeOverheadBytes =
			raidStatus.topology === 'mirror'
				? Math.max(0, raidStatus.totalSpace - availableBytes - wastedBytes)
				: raidStatus.totalSpace - raidStatus.usableSpace
	}
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
		availableHdds,
		availableSsds,
		systemDrives,
		poolDeviceType,
		mirrorPairs,
		acceleratorDevices,
		accelerator: raidStatus?.accelerator,
		inactiveBytes,
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

		addMirrorAsync: addMirrorMut.mutateAsync,
		isAddingMirror: addMirrorMut.isPending,

		addAcceleratorAsync: addAcceleratorMut.mutateAsync,
		isAddingAccelerator: addAcceleratorMut.isPending,

		transitionToFailsafeMirrorAsync: transitionToFailsafeMirrorMut.mutateAsync,
		isTransitioningToFailsafeMirror: transitionToFailsafeMirrorMut.isPending,

		// Refetch
		refetch: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	}
}
