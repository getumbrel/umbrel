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

	// Subscribe to files:external-storage:change events that fire when devices are mounted/unmounted
	// and invalidate the external storage queries
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:external-storage:change'},
		{
			onData() {
				utils.files.externalDevices.invalidate()
				utils.files.isExternalDeviceConnectedOnUnsupportedDevice.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(files:external-storage:change) subscription error', err)
			},
		},
	)

	// Query for external storage
	const {data: disks, isLoading: isLoadingDisks} = trpcReact.files.externalDevices.useQuery(undefined, {
		placeholderData: keepPreviousData,
		refetchInterval: isExternalStorageSupported ? 5000 : false, // Poll every 5 seconds because files:external-storage:change doesn't fire if a device is removed but all current devices have all their partitions mounted
		staleTime: 0, // Don't cache the data
		enabled: isExternalStorageSupported, // Only run query on supported devices
	})

	// Query to check for external drives on non-supported devices
	const {data: hasExternalDriveOnUnsupportedDevice} =
		trpcReact.files.isExternalDeviceConnectedOnUnsupportedDevice.useQuery(undefined, {
			placeholderData: keepPreviousData,
			refetchInterval: !isExternalStorageSupported ? 5000 : false, // Poll every 5 seconds because files:external-storage:change doesn't fire if a device is removed but all current devices have all their partitions mounted
			staleTime: 0,
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
			utils.files.externalDevices.invalidate()
		},
	})

	// Format disk mutation
	const {mutateAsync: formatExternalStorageDevice, isPending: isFormatting} =
		trpcReact.files.formatExternalDevice.useMutation({
			onError: (error: RouterError) => {
				toast.error(error.message || t('files-format.error'))
			},
			onSettled: () => {
				utils.files.externalDevices.invalidate()
			},
		})

	return {
		disks,
		isLoadingExternalStorage: isLoadingDisks,
		ejectDisk,
		isEjecting,
		formatExternalStorageDevice,
		isFormatting,
		isExternalStorageSupported,
		hasExternalDriveOnUnsupportedDevice,
	}
}
