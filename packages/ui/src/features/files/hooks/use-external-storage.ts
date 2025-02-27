import {useEffect} from 'react'
import {toast} from 'sonner'

import {HOME_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsUmbrelHome} from '@/hooks/use-is-umbrel-home'
import {useQueryParams} from '@/hooks/use-query-params'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

/**
 * Hook to manage external storage devices.
 * Provides functionality to fetch and eject external storage devices.
 * Also handles showing warning dialog for non-Umbrel Home devices.
 */
export function useExternalStorage() {
	const utils = trpcReact.useContext()
	const {isUmbrelHome} = useIsUmbrelHome()
	const {add} = useQueryParams()

	// Query for external storage on Umbrel Home
	const {data: disks, isLoading: isLoadingDisks} = trpcReact.files.externalStorage.useQuery(undefined, {
		keepPreviousData: true,
		staleTime: 0, // Don't cache the data
		refetchInterval: isUmbrelHome ? 5000 : false, // Only poll on Umbrel Home
		enabled: isUmbrelHome, // Only run query on Umbrel Home
		onError: (error: RouterError) => {
			console.error('Failed to fetch external storage:', error)
		},
	})

	// Query to check for external drives on non-Umbrel Home
	const {data: hasExternalDriveOnNonUmbrelHome} = trpcReact.files.isExternalDriveConnectedOnNonUmbrelHome.useQuery(
		undefined,
		{
			keepPreviousData: true,
			staleTime: 0,
			refetchInterval: !isUmbrelHome ? 5000 : false, // Only poll on non-Umbrel Home
			enabled: !isUmbrelHome, // Only run query on non-Umbrel Home
		},
	)

	const {currentPath, navigateToDirectory} = useNavigate()

	// Show dialog when external drive detected on non-Umbrel Home
	useEffect(() => {
		if (hasExternalDriveOnNonUmbrelHome) {
			// Check if dialog has already been shown in this session
			const dialogShown = sessionStorage.getItem('files-external-storage-unsupported-dialog-shown')

			if (!dialogShown) {
				console.log('hasExternalDriveOnNonUmbrelHome', hasExternalDriveOnNonUmbrelHome)
				add('dialog', 'files-external-storage-unsupported')
				// Mark dialog as shown for this session
				sessionStorage.setItem('files-external-storage-unsupported-dialog-shown', 'true')
			}
		}
	}, [hasExternalDriveOnNonUmbrelHome, add])

	// Eject disk mutation
	const {mutateAsync: ejectDisk, isLoading: isEjecting} = trpcReact.files.eject.useMutation({
		onMutate: (id) => {
			// snapshot the ejected disk
			return {
				ejectedDisk: disks?.find((disk) => disk.id === id.id),
			}
		},
		onSuccess: (_, id, context) => {
			// redirect to home path on ejection if the current path is in the ejected disk
			const ejectedDisk = context?.ejectedDisk
			if (ejectedDisk && ejectedDisk.partitions.some((partition) => currentPath.startsWith(partition.mountpoint))) {
				navigateToDirectory(HOME_PATH)
			}
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.eject-disk', {message: error.message}))
		},
		onSettled: () => {
			utils.files.externalStorage.invalidate()
		},
	})

	return {
		disks,
		isLoadingExternalStorage: isLoadingDisks,
		ejectDisk,
		isEjecting,
		isUmbrelHome,
		hasExternalDriveOnNonUmbrelHome,
	}
}
