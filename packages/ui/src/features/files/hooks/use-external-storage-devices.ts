import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

// Shared, read-only inventory for Files and Storage Manager. The server excludes
// USB disks backing the running system, internal drives, and network shares.
export function useExternalStorageDevices() {
	const utils = trpcReact.useUtils()
	const userQ = trpcReact.user.get.useQuery()
	// Also used during onboarding, before an owner account exists.
	const enabled = userQ.data?.role !== 'member'

	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:external-storage:change'},
		{
			enabled,
			onData() {
				utils.files.externalDevices.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(files:external-storage:change) subscription error', err)
			},
		},
	)

	return trpcReact.files.externalDevices.useQuery(undefined, {
		placeholderData: keepPreviousData,
		// Physical removal can miss the mount event. Poll while drives are present,
		// and more slowly when empty in case a connection event was missed.
		refetchInterval: (query) => (query.state.data?.length ? 5000 : 30_000),
		staleTime: 0,
		enabled,
	})
}
