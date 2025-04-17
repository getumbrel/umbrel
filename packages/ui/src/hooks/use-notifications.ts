import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

/**
 * Hook to query and clear system notifications
 */
export function useNotifications() {
	const utils = trpcReact.useUtils()

	// Query to fetch notifications
	const {
		data: notifications = [],
		isLoading,
		isError,
		error,
	} = trpcReact.notifications.get.useQuery(undefined, {
		placeholderData: keepPreviousData,
	})

	// Mutation to clear a notification
	const clearNotification = trpcReact.notifications.clear.useMutation({
		onMutate: async (notificationToRemove: string) => {
			await utils.notifications.get.cancel()
			const previousNotifications = utils.notifications.get.getData()

			// Optimistically update the notifications list
			utils.notifications.get.setData(undefined, (old = []) => old.filter((n) => n !== notificationToRemove))

			return {previousNotifications}
		},
		onSettled: () => {
			utils.notifications.get.invalidate()
		},
	})

	return {
		notifications,
		clearNotification: (notification: string) => clearNotification.mutate(notification),
		isLoading,
		isError,
		error,
	}
}
