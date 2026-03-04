import prettyBytes from 'pretty-bytes'

import {RouterOutput, trpcReact} from '@/trpc/trpc'

// Type from backend hardware.internalStorage.getDevices
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]

// Matches backend z.enum(['storage', 'failsafe']) in user.register
export type RaidType = 'storage' | 'failsafe'

// Format bytes without space, rounding to integer only for 3+ digit values (>=100) to avoid overflow
// e.g., "4.5TB", "45.2GB", "256GB" - only 256.1GB gets rounded because 256 >= 100
export const formatSize = (bytes: number) => {
	// First format with 1 decimal to determine the numeric value
	const formatted = prettyBytes(bytes, {maximumFractionDigits: 1})
	const numericValue = parseFloat(formatted)

	// If 3+ digits (>=100), round to integer to keep string short
	const fractionDigits = numericValue >= 100 ? 0 : 1

	return prettyBytes(bytes, {maximumFractionDigits: fractionDigits}).replace(' ', '')
}

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

// Hook to detect storage devices
export function useDetectStorageDevices() {
	const query = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		// Poll every 10 seconds to keep temperature and health status up to date
		refetchInterval: 10_000,
	})

	return {
		devices: query.data ?? [],
		// We only use isLoading (not isFetching) so polling doesn't trigger the loading scanner
		isDetecting: query.isLoading,
		error: query.error?.message ?? null,
		refetch: query.refetch,
	}
}
