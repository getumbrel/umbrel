import prettyBytes from 'pretty-bytes'

import {RouterOutput, trpcReact} from '@/trpc/trpc'

// Type from backend hardware.internalStorage.getDevices
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]

// Matches backend z.enum(['storage', 'failsafe']) in user.register
export type RaidType = 'storage' | 'failsafe'

// Format bytes without space, max 1 decimal place (e.g., "4TB", "8.2TB" instead of "4 TB", "8.19TB")
export const formatSize = (bytes: number) => prettyBytes(bytes, {maximumFractionDigits: 1}).replace(' ', '')

// Threshold % for lifetime usage warning (100 = the rated endurance being fully used)
// Used by both ssd-tray.tsx (indicator dots) and ssd-health-dialog.tsx (warning display)
export const LIFETIME_WARNING_THRESHOLD = 80

// Color for FailSafe storage visualization (white to contrast with brand color)
export const FAILSAFE_COLOR = '#FFFFFF'

// Color for wasted storage visualization (red to indicate inefficiency)
export const WASTED_COLOR = '#FF2F63'

// Get device health status - single source of truth for all health checks
// Used by setup.tsx (warning indicators) and ssd-health-dialog.tsx (detailed display)
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

// TODO: remove this after development
// Set to true to use mock devices for dev testing
const USE_MOCK_DEVICES = false

const MOCK_DEVICES: StorageDevice[] = [
	{
		device: 'nvme2n1',
		id: 'nvme-eui.0025385951a0f2ea',
		pciSlotNumber: 6,
		name: 'Samsung SSD 990 EVO Plus 2TB',
		model: 'Samsung SSD 990 EVO Plus 2TB',
		serial: 'S7U7NU0Y940322F',
		size: 2000398934016,
		temperature: 29,
		temperatureWarning: 81,
		temperatureCritical: 85,
		lifetimeUsed: 0,
		smartStatus: 'healthy',
		slot: 1,
	},
	{
		device: 'nvme0n1',
		id: 'nvme-eui.00000000000000000026b76869d51375',
		pciSlotNumber: 14,
		name: 'KINGSTON SNV2S2000G',
		model: 'KINGSTON SNV2S2000G',
		serial: '50026B76869D5137',
		size: 2000398934016,
		temperature: 30,
		temperatureWarning: 83,
		temperatureCritical: 90,
		lifetimeUsed: 90,
		smartStatus: 'unhealthy',
		slot: 3,
	},
	{
		device: 'nvme1n1',
		id: 'nvme-eui.0025384751a1fd1e',
		pciSlotNumber: 12,
		name: 'Samsung SSD 990 PRO 2TB',
		model: 'Samsung SSD 990 PRO 2TB',
		serial: 'S7HENU0Y732728N',
		size: 2000398934016,
		temperature: 29,
		temperatureWarning: 82,
		temperatureCritical: 85,
		lifetimeUsed: 0,
		smartStatus: 'healthy',
		slot: 4,
	},
]

// Hook to detect storage devices
export function useDetectStorageDevices() {
	const query = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		// Poll every 10 seconds to keep temperature and health status up to date
		refetchInterval: 10_000,
		// Skip the query when using mock devices
		enabled: !USE_MOCK_DEVICES,
	})

	// TODO: remove this after development
	// Return mock data for dev testing
	if (USE_MOCK_DEVICES) {
		return {
			devices: MOCK_DEVICES,
			isDetecting: false,
			error: null,
			refetch: () => Promise.resolve({data: MOCK_DEVICES, error: null} as any),
		}
	}

	return {
		devices: query.data ?? [],
		// We only use isLoading (not isFetching) so polling doesn't trigger the loading scanner
		isDetecting: query.isLoading,
		error: query.error?.message ?? null,
		refetch: query.refetch,
	}
}
