import {keepPreviousData} from '@tanstack/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {HOME_PATH} from '@/features/files/constants'
import type {Share} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage file shares in the file system.
 * Provides functionality to fetch shares, add/remove shares, and get share password.
 */
export function useShares() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	// Invalidate shares when external storage changes (e.g., drive ejected/mounted)
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:external-storage:change'},
		{
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
		placeholderData: keepPreviousData,
		staleTime: 60_000, // Cache for 1 minute
	})

	// Check if item is shared
	const isPathShared = (path: string) => shares?.some((share: Share) => share && share.path === path)

	// Check if the entire home directory is shared
	const isHomeShared = () => shares?.some((share: Share) => share && share.path === HOME_PATH)

	// Query to get share password
	const {data: sharePassword, isLoading: isLoadingSharesPassword} = trpcReact.files.sharePassword.useQuery(undefined, {
		staleTime: Infinity, // Cache indefinitely until browser refresh
	})

	// Add share mutation
	const {mutateAsync: addShare, isPending: isAddingShare} = trpcReact.files.addShare.useMutation({
		onSuccess: async () => {
			await utils.files.shares.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.add-share', {message: getFilesErrorMessage(error.message)}))
		},
	})

	// Remove share mutation
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeShare.useMutation({
		onSuccess: async () => {
			await utils.files.shares.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.remove-share', {message: getFilesErrorMessage(error.message)}))
		},
	})

	return {
		// Queries
		shares,
		isLoadingShares,
		sharePassword,
		isLoadingSharesPassword,
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
