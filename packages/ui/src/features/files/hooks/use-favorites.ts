import {keepPreviousData} from '@tanstack/react-query'
import {toast} from 'sonner'

import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

/**
 * Hook to manage favorites in the file system.
 * Provides functionality to fetch favorites, add/remove favorites, and check if an item is favorited.
 */
export function useFavorites() {
	const utils = trpcReact.useUtils()

	// Query to fetch favorites (an array of virtual path strings)
	const {data: favorites, isLoading: isLoadingFavorites} = trpcReact.files.favorites.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 15_000,
	})

	// Check if item is favorited
	const isPathFavorite = (path: string) => favorites?.some((favorite) => favorite && favorite === path)

	// Add favorite mutation
	const {mutateAsync: addFavorite, isPending: isAddingFavorite} = trpcReact.files.addFavorite.useMutation({
		onSuccess: async () => {
			await utils.files.favorites.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.add-favorite', {message: error.message}))
		},
	})

	// Remove favorite mutation
	const {mutateAsync: removeFavorite, isPending: isRemovingFavorite} = trpcReact.files.removeFavorite.useMutation({
		onSuccess: async () => {
			await utils.files.favorites.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.remove-favorite', {message: error.message}))
		},
	})

	return {
		// Queries
		favorites,
		isLoadingFavorites,
		isPathFavorite,

		// Add favorite
		addFavorite,
		isAddingFavorite,

		// Remove favorite
		removeFavorite,
		isRemovingFavorite,
	}
}
