import {toast} from 'sonner'

import type {Favorite} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

/**
 * Hook to manage favorites in the file system.
 * Provides functionality to fetch favorites, add/remove favorites, and check if an item is favorited.
 */
export function useFavorites() {
	const utils = trpcReact.useContext()

	// Query to fetch favorites
	const {data: favorites, isLoading: isLoadingFavorites} = trpcReact.files.favorites.useQuery(undefined, {
		keepPreviousData: true,
		staleTime: 15_000,
		onError: (error: RouterError) => {
			console.error('Failed to fetch favorites:', error)
		},
	})

	// Check if item is favorited
	const isPathFavorite = (path: string) => favorites?.some((favorite: Favorite) => favorite.path === path)

	// Add favorite mutation
	const {mutateAsync: addFavorite, isLoading: isAddingFavorite} = trpcReact.files.addFavorite.useMutation({
		onSuccess: async () => {
			await utils.files.favorites.invalidate()
		},
		onError: (error: RouterError) => {
			toast.error(t('files-error.add-favorite', {message: error.message}))
		},
	})

	// Remove favorite mutation
	const {mutateAsync: removeFavorite, isLoading: isRemovingFavorite} = trpcReact.files.deleteFavorite.useMutation({
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
