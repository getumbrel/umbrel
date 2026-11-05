import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {getActiveAppsUsingStoragePaths, showStorageInUseDialog} from '@/features/files/components/storage-in-use'
import {HOME_PATH} from '@/features/files/constants'
import {useExternalStorageDevices} from '@/features/files/hooks/use-external-storage-devices'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage external storage devices.
 * Provides functionality to fetch and eject external storage devices.
 */
export function useExternalStorage() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()
	const userQ = trpcReact.user.get.useQuery()
	const isExternalStorageSupported = true
	// For the blocked-eject dialog: which active apps keep storage on the drive.
	// Plain query rather than useApps() so the hook stays provider-independent.
	const appsQ = trpcReact.apps.list.useQuery(undefined, {enabled: userQ.data?.role === 'owner'})

	const {data: disks, isLoading: isLoadingDisks} = useExternalStorageDevices()
	const {currentPath, navigateToDirectory} = useNavigate()

	// Eject disk mutation
	// TODO: The externalDevices query has a 5s polling interval and a WebSocket subscription that
	// both trigger invalidation. These can refetch and undo the optimistic removal before the server
	// finishes ejecting, causing the disk to briefly flash back. May need to pause polling/subscription
	// during the mutation to fully prevent this.
	const {mutateAsync: ejectDisk, isPending: isEjecting} = trpcReact.files.unmountExternalDevice.useMutation({
		onMutate: async (id) => {
			const ejectedDisk = disks?.find((disk) => disk.id === id.deviceId)

			// Cancel the sidebar query we're about to optimistically update
			await utils.files.externalDevices.cancel()

			// Snapshot sidebar data for rollback
			const previousDisks = utils.files.externalDevices.getData()

			// Optimistically remove the disk from the sidebar
			utils.files.externalDevices.setData(undefined, (old) => old?.filter((disk) => disk.id !== id.deviceId))

			// Optimistically remove the disk's partitions from the directory listing via pendingPaths
			const ejectedPaths = ejectedDisk?.partitions.flatMap((p) => p.mountpoints) ?? []
			if (ejectedPaths.length > 0) {
				useFilesStore.getState().addPendingPaths(ejectedPaths, 'removing')
			}

			const ejectedDiskName =
				ejectedDisk?.partitions.length === 1
					? ejectedDisk.partitions[0].label || ejectedPaths[0]?.split('/').filter(Boolean).at(-1)
					: ejectedDisk?.name

			return {previousDisks, ejectedPaths, ejectedDiskName}
		},
		onSuccess: (_, __, context) => {
			// Only navigate away once the eject actually succeeded, e.g. it can be
			// blocked because an app is using the drive as a storage location. The
			// path is checked now rather than snapshotted at mutate time so a slow
			// eject doesn't yank the user out of a folder they've since moved to.
			const isBrowsingEjectedDisk = Boolean(
				context?.ejectedPaths?.some((mountpoint) => currentPath.startsWith(mountpoint)),
			)
			if (isBrowsingEjectedDisk) navigateToDirectory(HOME_PATH)
		},
		onError: (error: RouterError, _, context) => {
			// Rollback optimistic updates
			if (context?.previousDisks) {
				utils.files.externalDevices.setData(undefined, context.previousDisks)
			}
			if (context?.ejectedPaths?.length) {
				useFilesStore.getState().removePendingPaths(context.ejectedPaths)
			}
			// Being blocked because an app is using the drive gets a dialog listing
			// the apps so the user knows what to stop before ejecting again
			if (error.message.includes('[storage-in-use-by-apps]')) {
				showStorageInUseDialog({
					confirm,
					t,
					title: t('files-eject.blocked-title'),
					description: t('files-storage-in-use.description-drive'),
					fallbackMessage: getFilesErrorMessage(error.message),
					storagePath: context?.ejectedPaths?.[0],
					storageName: context?.ejectedDiskName,
					apps: getActiveAppsUsingStoragePaths(appsQ.data, context?.ejectedPaths ?? []),
				})
			} else {
				toast.error(t('files-error.eject-disk', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
			}
		},
		onSettled: () => {
			utils.files.externalDevices.invalidate()
		},
	})

	// Format disk mutation
	const {mutateAsync: formatExternalStorageDevice, isPending: isFormatting} =
		trpcReact.files.formatExternalDevice.useMutation({
			onError: (error: RouterError) => {
				toast.error(error.message || t('files-format.error'), {area: 'files'})
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
	}
}
