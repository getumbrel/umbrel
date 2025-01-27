import {Preferences} from '@/features/files/types'
import {RouterError, RouterInput, trpcReact} from '@/trpc/trpc'

/**
 * Hook to list favorite directories in the file system.
 */
export function usePreferences() {
	const utils = trpcReact.useContext()

	// Query to fetch favorites
	const {
		data: preferences,
		isLoading,
		isError,
		error,
	} = trpcReact.files.preferences.useQuery(undefined, {
		keepPreviousData: true,
		onError: (error: RouterError) => {
			console.error('Failed to fetch preferences:', error)
		},
	})

	const setPreferences = trpcReact.files.setPreferences.useMutation({
		onMutate: async (newPreferences: RouterInput['files']['setPreferences']) => {
			// cancel any outgoing refetches (so they don't overwrite our optimistic update)
			await utils.files.preferences.cancel()

			// snapshot the previous preferences
			const oldPreferences = utils.files.preferences.getData()

			// optimistically update to the new value
			utils.files.preferences.setData(undefined, () => ({
				view: oldPreferences?.view ?? 'list',
				sortBy: oldPreferences?.sortBy ?? 'name',
				sortOrder: oldPreferences?.sortOrder ?? 'asc',
				...newPreferences,
			}))
		},
		onSettled: () => {
			// we don't need to revert the optimistic update on error
			// because it will be reverted by the invalidation
			utils.files.preferences.invalidate()
		},
	})

	const setView = (view: Preferences['view']) => {
		setPreferences.mutate({...preferences, view})
	}

	const setSortBy = (sortBy: Preferences['sortBy']) => {
		// if the same column is clicked again, toggle the sort order
		if (preferences?.sortBy === sortBy) {
			const newSortOrder: Preferences['sortOrder'] = preferences.sortOrder === 'asc' ? 'desc' : 'asc'
			return setPreferences.mutate({...preferences, sortOrder: newSortOrder})
		}
		// otherwise, set to ascending for name, and descending for other columns
		const defaultSortOrder: Preferences['sortOrder'] = sortBy === 'name' ? 'asc' : 'desc'
		return setPreferences.mutate({...preferences, sortBy: sortBy, sortOrder: defaultSortOrder})
	}

	return {
		preferences,
		setPreferences,
		setView,
		setSortBy,
		isLoading,
		isError,
		error,
	}
}
