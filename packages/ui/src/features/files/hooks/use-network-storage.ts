import {keepPreviousData} from '@tanstack/react-query'
import {toast} from 'sonner'

import {NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {
	isDirectoryANetworkDevice,
	isDirectoryANetworkShare,
} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// We use `suppressNavigateOnAdd` to prevent navigating after adding a share from the backup/restore wizards.
export function useNetworkStorage(options?: {suppressNavigateOnAdd?: boolean}) {
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
		onError: (error: RouterError) => toast.error(t('files-network-storage-error.add-share', {message: error.message})),
	})

	// Remove a share
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeNetworkShare.useMutation({
		onMutate: ({mountPath}) => {
			const hostPath = mountPath.split('/').slice(0, -1).join('/')
			const hostName = mountPath.split('/')[2]
			// Count how many shares this host will have after this removal
			const remainingSharesForHost = shares?.filter((s) => s.host === hostName && s.mountPath !== mountPath).length || 0

			return {
				mountPath,
				hostPath,
				hostName,
				remainingSharesForHost,
			}
		},
		onSuccess: (_, __, ctx) => {
			if (!ctx) return

			// We navigate based on user's current browsing location and remaining shares
			const isUserBrowsingThisHost = currentPath.startsWith(ctx.hostPath)
			const isLastShareForHost = ctx.remainingSharesForHost === 0

			// If we are browsing a host that's being completely removed, then we navigate to /Network
			if (isUserBrowsingThisHost && isLastShareForHost) navigateToDirectory(NETWORK_STORAGE_PATH)

			// Otherwise we don't navigate at all, which handles all other cases
			// (e.g., browsing a network device with another share that's not being removed, browsing /Downloads while ejecting a device from the sidebar, etc.)

			// Invalidate the /Network listing so the host device disappears if we’re browsing /Network directly
			invalidateNetworkShares()
			// Invalidate the host directory listing in case we're viewing that device and removing a single share
			utils.files.list.invalidate({path: ctx.hostPath})
		},
		onError: (error: RouterError) =>
			toast.error(t('files-network-storage-error.remove-share', {message: error.message})),
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
					message: (res.error as RouterError).message,
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
					message: (error as RouterError).message,
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
