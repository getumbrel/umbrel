import {keepPreviousData} from '@tanstack/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError} from '@/trpc/trpc'

/**
 * Hook to manage favorites in the file system.
 * Provides functionality to fetch favorites, add/remove favorites, and check if an item is favorited.
 */
export function useFavorites() {
	const {t} = useTranslation()
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
		onMutate: async ({path}) => {
			await utils.files.favorites.cancel()
			const previous = utils.files.favorites.getData()
			utils.files.favorites.setData(undefined, (old) => (old ? [...old, path] : [path]))
			return {previous}
		},
		onError: (error: RouterError, _, context) => {
			if (context?.previous) {
				utils.files.favorites.setData(undefined, context.previous)
			}
			toast.error(t('files-error.add-favorite', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: () => {
			utils.files.favorites.invalidate()
		},
	})

	// Remove favorite mutation
	const {mutateAsync: removeFavorite, isPending: isRemovingFavorite} = trpcReact.files.removeFavorite.useMutation({
		onMutate: async ({path}) => {
			await utils.files.favorites.cancel()
			const previous = utils.files.favorites.getData()
			utils.files.favorites.setData(undefined, (old) => (old ? old.filter((p) => p !== path) : []))
			return {previous}
		},
		onError: (error: RouterError, _, context) => {
			if (context?.previous) {
				utils.files.favorites.setData(undefined, context.previous)
			}
			toast.error(t('files-error.remove-favorite', {message: getFilesErrorMessage(error.message)}))
		},
		onSettled: () => {
			utils.files.favorites.invalidate()
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
