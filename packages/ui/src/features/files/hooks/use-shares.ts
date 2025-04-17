import {keepPreviousData} from '@tanstack/react-query'
import {toast} from 'sonner'

import {HOME_PATH} from '@/features/files/constants'
import type {Share} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

/**
 * Hook to manage file shares in the file system.
 * Provides functionality to fetch shares, add/remove shares, and get share password.
 */
export function useShares() {
	const utils = trpcReact.useUtils()

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
			toast.error(t('files-error.add-share', {message: error.message}))
		},
	})

	// Remove share mutation
	const {mutateAsync: removeShare, isPending: isRemovingShare} = trpcReact.files.removeShare.useMutation({
		onSuccess: async () => {
			await utils.files.shares.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.remove-share', {message: error.message}))
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
