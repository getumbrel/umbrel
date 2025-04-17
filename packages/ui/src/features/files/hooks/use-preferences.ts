import {keepPreviousData} from '@tanstack/react-query'

import {ViewPreferences} from '@/features/files/types'
import {RouterInput, trpcReact} from '@/trpc/trpc'

/**
 * Hook to list favorite directories in the file system.
 */
export function usePreferences() {
	const utils = trpcReact.useUtils()

	// Query to fetch favorites
	const {
		data: preferences,
		isLoading,
		isError,
		error,
	} = trpcReact.files.viewPreferences.useQuery(undefined, {
		placeholderData: keepPreviousData,
	})

	const setPreferences = trpcReact.files.updateViewPreferences.useMutation({
		onMutate: async (newPreferences: RouterInput['files']['updateViewPreferences']) => {
			// cancel any outgoing refetches (so they don't overwrite our optimistic update)
			await utils.files.viewPreferences.cancel()

			// snapshot the previous preferences
			const oldPreferences = utils.files.viewPreferences.getData()

			// optimistically update to the new value
			utils.files.viewPreferences.setData(undefined, () => ({
				view: oldPreferences?.view ?? 'list',
				sortBy: oldPreferences?.sortBy ?? 'name',
				sortOrder: oldPreferences?.sortOrder ?? 'ascending',
				...newPreferences,
			}))
		},
		onSettled: () => {
			// we don't need to revert the optimistic update on error
			// because it will be reverted by the invalidation
			utils.files.viewPreferences.invalidate()
		},
	})

	const setView = (view: ViewPreferences['view']) => {
		setPreferences.mutate({...preferences, view})
	}

	const setSortBy = (sortBy: ViewPreferences['sortBy']) => {
		// if the same column is clicked again, toggle the sort order
		if (preferences?.sortBy === sortBy) {
			const newSortOrder: ViewPreferences['sortOrder'] =
				preferences?.sortOrder === 'ascending' ? 'descending' : 'ascending'
			return setPreferences.mutate({...preferences, sortOrder: newSortOrder})
		}
		// otherwise, set to ascending for name, and descending for other columns
		const defaultSortOrder: ViewPreferences['sortOrder'] = sortBy === 'name' ? 'ascending' : 'descending'
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
