import {keepPreviousData} from '@tanstack/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {
	isDirectoryANetworkDevice,
	isDirectoryANetworkShare,
} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

// We use `suppressNavigateOnAdd` to prevent navigating after adding a share from the backup/restore wizards.
export function useNetworkStorage(options?: {suppressNavigateOnAdd?: boolean}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const invalidateShares = () => utils.files.listNetworkShares.invalidate()
	const invalidateNetworkShares = () => utils.files.list.invalidate({path: NETWORK_STORAGE_PATH})

	const {currentPath, navigateToDirectory} = useNavigate()

	// Fetch the current shares (both mounted and unmounted)
	const {
		data: shares,
		isLoading: isLoadingShares,
		refetch: refetchShares,
	} = trpcReact.files.listNetworkShares.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 15_000,
	})

	// Check if a specific share is mounted
	const isShareMounted = (mountPath: string) => shares?.some((s) => s.mountPath === mountPath && s.isMounted)

	// Check if any shares on this host are currently mounted
	const doesHostHaveMountedShares = (rootPath: string) => {
		if (!shares) return false
		// rootPath = /Network/<host>
		return shares.some((s) => s.isMounted && s.mountPath.startsWith(rootPath + '/'))
	}

	// Add a share
	const {mutateAsync: addShare, isPending: isAddingShare} = trpcReact.files.addNetworkShare.useMutation({
		onSuccess: async (mountPath: string) => {
			// navigate to the host path of the share (e.g. /Network/<host>) unless suppressed by caller
			const rootPath = mountPath.split('/').slice(0, -1).join('/')

			// only navigate if we're not suppressing it (e.g., from backup/restore wizards)
			if (!options?.suppressNavigateOnAdd) {
				navigateToDirectory(rootPath)
			}

			// invalidate shares to show the new share in the sidebar
			await invalidateShares()
			// invalidate the host directory listing to show the new share in the main view
			utils.files.list.invalidate({path: rootPath})
			// invalidate the network root to refresh MiniBrowser when browsing /Network
			utils.files.list.invalidate({path: NETWORK_STORAGE_PATH})
		},
		onError: (error: RouterError) =>
			toast.error(t('files-network-storage-error.add-share', {message: getFilesErrorMessage(error.message)})),
	})

	// Remove a share
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeNetworkShare.useMutation({
		onMutate: async ({mountPath}) => {
			const hostPath = mountPath.split('/').slice(0, -1).join('/')
			const hostName = mountPath.split('/')[2]
			const remainingSharesForHost = shares?.filter((s) => s.host === hostName && s.mountPath !== mountPath).length || 0

			// Cancel the sidebar query we're about to optimistically update
			await utils.files.listNetworkShares.cancel()

			// Snapshot sidebar data for rollback
			const previousShares = utils.files.listNetworkShares.getData()

			// Optimistically remove the share from the sidebar
			utils.files.listNetworkShares.setData(undefined, (old) => old?.filter((s) => s.mountPath !== mountPath))

			// Optimistically remove the share from the directory listing via pendingPaths
			useFilesStore.getState().addPendingPaths([mountPath], 'removing')

			// Navigate away immediately if this is the last share on the host
			const isUserBrowsingThisHost = currentPath.startsWith(hostPath)
			const isLastShareForHost = remainingSharesForHost === 0
			if (isUserBrowsingThisHost && isLastShareForHost) navigateToDirectory(NETWORK_STORAGE_PATH)

			return {
				mountPath,
				hostPath,
				hostName,
				remainingSharesForHost,
				previousShares,
			}
		},
		onSuccess: (_, __, ctx) => {
			if (!ctx) return

			// Invalidate the /Network listing so the host device disappears if we're browsing /Network directly
			invalidateNetworkShares()
			// Invalidate the host directory listing in case we're viewing that device and removing a single share
			utils.files.list.invalidate({path: ctx.hostPath})
		},
		onError: (error: RouterError, _, ctx) => {
			// Rollback optimistic updates
			if (ctx?.previousShares) {
				utils.files.listNetworkShares.setData(undefined, ctx.previousShares)
			}
			if (ctx?.mountPath) {
				useFilesStore.getState().removePendingPaths([ctx.mountPath])
			}
			toast.error(t('files-network-storage-error.remove-share', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: invalidateShares,
	})

	// Remove host or share by path
	const removeHostOrShare = async (path: string) => {
		if (!shares) return

		if (isDirectoryANetworkDevice(path)) {
			// Host path: /Network/hostname - remove all shares for this host
			const hostName = path.split('/')[2]
			const hostShares = shares.filter((s) => s.host === hostName)
			for (const share of hostShares) {
				await removeShare({mountPath: share.mountPath})
			}
		} else if (isDirectoryANetworkShare(path)) {
			// Share path: /Network/hostname/share - remove just this share
			await removeShare({mountPath: path})
		}
	}

	// Discover servers (disabled until fired)
	const discoverServersQuery = trpcReact.files.discoverNetworkShareServers.useQuery(undefined, {
		enabled: false,
		retry: false,
	})

	const discoverServers = async () => {
		const res = await discoverServersQuery.refetch()
		if (res.error) {
			toast.error(
				t('files-network-storage-error.discover-servers', {
					message: getFilesErrorMessage((res.error as RouterError).message),
				}),
			)
		}
		return res.data
	}

	// Discover shares on a chosen server
	const discoverSharesOnServer = async (host: string, username: string, password: string) => {
		try {
			return await utils.files.discoverNetworkSharesOnServer.fetch({
				host,
				username,
				password,
			})
		} catch (error: any) {
			toast.error(
				t('files-network-storage-error.discover-shares', {
					message: getFilesErrorMessage((error as RouterError).message),
				}),
			)
			throw error
		}
	}

	return {
		shares,
		isLoadingShares,
		isShareMounted,
		doesHostHaveMountedShares,
		refetchShares,
		addShare,
		isAddingShare,
		isRemovingShare,
		removeHostOrShare,
		discoverServers,
		discoveredServers: discoverServersQuery.data,
		isDiscoveringServers: discoverServersQuery.isFetching,
		discoverSharesOnServer,
	}
}
