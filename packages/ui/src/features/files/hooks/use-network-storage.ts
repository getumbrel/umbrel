import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {getActiveAppsUsingStoragePaths, showStorageInUseDialog} from '@/features/files/components/storage-in-use'
import {NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkSharesQuery} from '@/features/files/hooks/use-network-shares-query'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {
	isDirectoryANetworkDevice,
	isDirectoryANetworkShare,
} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

// We use `suppressNavigateOnAdd` to prevent navigating after adding a share from the backup/restore wizards.
export function useNetworkStorage(options?: {suppressNavigateOnAdd?: boolean; pollShares?: boolean}) {
	const {t} = useTranslation()
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()
	// For the blocked-removal dialog: which active apps keep storage on the
	// share. Plain query rather than useApps() so the hook stays
	// provider-independent (it's also used from the backup wizards).
	const appsQ = trpcReact.apps.list.useQuery(undefined, {enabled: userQ.data?.role === 'owner'})
	const invalidateShares = () => utils.files.listNetworkShares.invalidate()
	const invalidateNetworkShares = () => utils.files.list.invalidate({path: NETWORK_STORAGE_PATH})

	const {currentPath, navigateToDirectory} = useNavigate()

	// Fetch the current shares (both mounted and unmounted)
	const {
		data: shares,
		isPending: isLoadingShares,
		refetch: refetchShares,
	} = useNetworkSharesQuery({poll: options?.pollShares})

	// Check if a specific share is mounted
	const isShareMounted = (mountPath: string) => shares?.some((s) => s.mountPath === mountPath && s.isMounted)

	// Check if any shares on this host are currently mounted
	const doesHostHaveMountedShares = (rootPath: string) => {
		// Members only discover hosts through an authorized /Network listing,
		// and cannot query the owner-only mount-management endpoint.
		if (isMember) return true
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
			toast.error(t('files-network-storage-error.add-share', {message: getFilesErrorMessage(error.message)}), {
				area: 'files',
			}),
	})

	// Remove a share
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeNetworkShare.useMutation({
		onMutate: async ({mountPath}) => {
			const hostPath = mountPath.split('/').slice(0, -1).join('/')

			// Cancel the sidebar query we're about to optimistically update
			await utils.files.listNetworkShares.cancel()

			// Snapshot sidebar data for rollback
			const previousShares = utils.files.listNetworkShares.getData()

			// Count from the cache rather than this render's `shares`, so removing a
			// host share by share sees the earlier optimistic removals.
			const remainingSharesForHost =
				previousShares?.filter((s) => s.mountPath.startsWith(hostPath + '/') && s.mountPath !== mountPath).length || 0

			// Optimistically remove the share from the sidebar
			utils.files.listNetworkShares.setData(undefined, (old) => old?.filter((s) => s.mountPath !== mountPath))

			// Optimistically remove the share from the directory listing via pendingPaths
			useFilesStore.getState().addPendingPaths([mountPath], 'removing')

			return {
				mountPath,
				hostPath,
				remainingSharesForHost,
				previousShares,
			}
		},
		onSuccess: (_, __, ctx) => {
			if (!ctx) return

			// Only navigate away once the removal actually succeeded, e.g. it can be
			// blocked because an app is using the share as a storage location. The
			// path is checked now rather than snapshotted at mutate time so a slow
			// removal doesn't yank the user out of a folder they've since moved to.
			const isBrowsingRemovedHost =
				ctx.remainingSharesForHost === 0 && (currentPath === ctx.hostPath || currentPath.startsWith(ctx.hostPath + '/'))
			if (isBrowsingRemovedHost) navigateToDirectory(NETWORK_STORAGE_PATH)

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
			// Being blocked because an app is using the share gets a dialog listing
			// the apps so the user knows what to stop before removing again
			if (error.message.includes('[storage-in-use-by-apps]')) {
				showStorageInUseDialog({
					confirm,
					t,
					title: t('files-network-storage.remove-blocked-title'),
					description: t('files-storage-in-use.description-share'),
					fallbackMessage: getFilesErrorMessage(error.message),
					storagePath: ctx?.mountPath,
					apps: getActiveAppsUsingStoragePaths(appsQ.data, ctx?.mountPath ? [ctx.mountPath] : []),
				})
			} else {
				toast.error(t('files-network-storage-error.remove-share', {message: getFilesErrorMessage(error.message)}), {
					area: 'files',
				})
			}
		},
		onSettled: invalidateShares,
	})

	// Remove host or share by path
	const removeHostOrShare = async (path: string) => {
		if (!shares) return

		if (isDirectoryANetworkDevice(path)) {
			// Host path: /Network/hostname - remove all shares for this host
			const hostShares = shares.filter((s) => s.mountPath.startsWith(path + '/'))
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
				{area: 'files'},
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
				{area: 'files'},
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
