import {keepPreviousData} from '@tanstack/react-query'
import {useEffect} from 'react'
import {toast} from 'sonner'

import {HOME_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useQueryParams} from '@/hooks/use-query-params'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

/**
 * Hook to manage external storage devices.
 * Provides functionality to fetch and eject external storage devices.
 * Also handles showing warning dialog for unsupported (Raspberry Pi) devices.
 */
export function useExternalStorage() {
	const utils = trpcReact.useUtils()
	const {add} = useQueryParams()

	// Check device information to determine if external storage is supported (currently not supported on Raspberry Pi)
	const {data: deviceInfo} = trpcReact.system.device.useQuery()

	const isExternalStorageSupported = deviceInfo?.productName !== 'Raspberry Pi'

	// Query for external storage
	const {data: disks, isLoading: isLoadingDisks} = trpcReact.files.mountedExternalDevices.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 0, // Don't cache the data
		refetchInterval: isExternalStorageSupported ? 5000 : false, // Only poll on supported devices
		enabled: isExternalStorageSupported, // Only run query on supported devices
	})

	// Query to check for external drives on non-supported devices
	const {data: hasExternalDriveOnUnsupportedDevice} =
		trpcReact.files.isExternalDeviceConnectedOnUnsupportedDevice.useQuery(undefined, {
			placeholderData: keepPreviousData,
			staleTime: 0,
			refetchInterval: !isExternalStorageSupported ? 5000 : false, // Only poll on unsupported devices
			enabled: !isExternalStorageSupported, // Only run query on unsupported devices
		})

	const {currentPath, navigateToDirectory} = useNavigate()

	// Show dialog when external drive detected on unsupported devices
	useEffect(() => {
		if (hasExternalDriveOnUnsupportedDevice) {
			// Check if dialog has already been shown in this session
			const dialogShown = sessionStorage.getItem('files-external-storage-unsupported-dialog-shown')

			if (!dialogShown) {
				add('dialog', 'files-external-storage-unsupported')
				// Mark dialog as shown for this session
				sessionStorage.setItem('files-external-storage-unsupported-dialog-shown', 'true')
			}
		}
	}, [hasExternalDriveOnUnsupportedDevice, add])

	// Eject disk mutation
	const {mutateAsync: ejectDisk, isPending: isEjecting} = trpcReact.files.unmountExternalDevice.useMutation({
		onMutate: (id) => {
			// snapshot the ejected disk
			return {
				ejectedDisk: disks?.find((disk) => disk.id === id.deviceId),
			}
		},
		onSuccess: (_, id, context) => {
			// redirect to home path on ejection if the current path is in the ejected disk
			const ejectedDisk = context?.ejectedDisk
			if (
				ejectedDisk &&
				ejectedDisk.partitions.some((partition) =>
					// mountpoints is an array of mountpoints for the partition
					partition.mountpoints.some((mountpoint) => currentPath.startsWith(mountpoint)),
				)
			) {
				navigateToDirectory(HOME_PATH)
			}
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.eject-disk', {message: error.message}))
		},
		onSettled: () => {
			utils.files.mountedExternalDevices.invalidate()
		},
	})

	return {
		disks,
		isLoadingExternalStorage: isLoadingDisks,
		ejectDisk,
		isEjecting,
		isExternalStorageSupported,
		hasExternalDriveOnUnsupportedDevice,
	}
}
