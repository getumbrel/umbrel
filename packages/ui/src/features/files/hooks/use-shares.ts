import {keepPreviousData} from '@tanstack/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import type {Share} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

const SAMBA_STATE_REFETCH_INTERVAL_MS = 30_000

// Whether a path is shared, for an icon's badge. Every icon asks, and a
// listing mounts and unmounts icons with every scroll, so this is a narrow
// read of the two queries below and nothing else: useShares itself, mounted
// once per icon, opened an event subscription for each one and refetched
// three queries each time a row scrolled into view. An icon's answer may be
// as old as the interval the shares are polled at anyway, and a share added
// or removed here still shows at once (that invalidates the query).
export function useIsPathShared(path: string, {enabled = true}: {enabled?: boolean} = {}) {
	const {data: canManageShares} = trpcReact.user.get.useQuery(undefined, {
		enabled,
		select: (user) => user.role === 'owner' || user.sambaEnabled === true,
		staleTime: SAMBA_STATE_REFETCH_INTERVAL_MS,
	})
	const {data: isShared} = trpcReact.files.shares.useQuery(undefined, {
		enabled: enabled && canManageShares === true,
		select: (shares) => shares.some((share: Share) => share && share.path === path),
		placeholderData: keepPreviousData,
		staleTime: SAMBA_STATE_REFETCH_INTERVAL_MS,
	})
	return isShared ?? false
}

/**
 * Hook to manage file shares in the file system.
 * Provides functionality to fetch shares, add/remove shares, and get share password.
 */
export function useShares() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	const {data: user} = trpcReact.user.get.useQuery(undefined, {
		staleTime: 0,
		refetchInterval: SAMBA_STATE_REFETCH_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnReconnect: 'always',
		refetchOnWindowFocus: 'always',
	})
	const canManageShares = user?.role === 'owner' || user?.sambaEnabled === true
	const homePath = useHomePath()

	// Invalidate shares when external storage changes (e.g., drive ejected/mounted)
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:external-storage:change'},
		{
			enabled: user?.role === 'owner',
			onData() {
				utils.files.shares.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(files:external-storage:change) subscription error', err)
			},
		},
	)

	// Query to fetch all shares
	const {data: shares, isLoading: isLoadingShares} = trpcReact.files.shares.useQuery(undefined, {
		enabled: canManageShares,
		placeholderData: keepPreviousData,
		staleTime: 0,
		refetchInterval: SAMBA_STATE_REFETCH_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnReconnect: 'always',
		refetchOnWindowFocus: 'always',
	})

	// Check if item is shared
	const isPathShared = (path: string) => shares?.some((share: Share) => share && share.path === path)

	// Check if the entire home directory is shared
	const isHomeShared = () => shares?.some((share: Share) => share && share.path === homePath)

	// Query to get share password
	const {data: sharePassword, isLoading: isLoadingSharesPassword} = trpcReact.files.sharePassword.useQuery(undefined, {
		enabled: canManageShares,
		staleTime: 0,
		refetchInterval: SAMBA_STATE_REFETCH_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnReconnect: 'always',
		refetchOnWindowFocus: 'always',
	})

	// Add share mutation
	const {mutateAsync: addShare, isPending: isAddingShare} = trpcReact.files.addShare.useMutation({
		onSuccess: async () => {
			await utils.files.shares.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.add-share', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
	})

	// Remove share mutation
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeShare.useMutation({
		onSuccess: async () => {
			await utils.files.shares.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.remove-share', {message: getFilesErrorMessage(error.message)}), {area: 'files'})
		},
	})

	return {
		// Queries
		shares,
		isLoadingShares,
		sharePassword,
		isLoadingSharesPassword,
		canManageShares,
		isPathShared,
		isHomeShared,

		// Add share
		addShare,
		isAddingShare,

		// Remove share
		removeShare,
		isRemovingShare,
	}
}
