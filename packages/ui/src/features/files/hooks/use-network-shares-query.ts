import {keepPreviousData} from '@tanstack/react-query'

import {trpcReact} from '@/trpc/trpc'

// The owner's network share configuration with mount status. Members use their
// authorized directory listings and must never render cached owner configuration.
export function useNetworkSharesQuery({enabled = true, poll = false}: {enabled?: boolean; poll?: boolean} = {}) {
	const userQ = trpcReact.user.get.useQuery()
	const canManage = userQ.data?.role === 'owner'
	const query = trpcReact.files.listNetworkShares.useQuery(undefined, {
		enabled: enabled && canManage,
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		refetchInterval: poll ? 15_000 : false,
	})
	// Pick fields explicitly: spreading the observer result tracks every property,
	// so each consumer would re-render on every fetchStatus flip of the shared poll.
	return {
		data: canManage ? query.data : undefined,
		canManage,
		// Pending until the role is known, then until the configuration arrives.
		isPending: enabled && (userQ.isPending || (canManage && query.isPending)),
		isError: canManage && query.isError,
		error: canManage ? query.error : null,
		refetch: query.refetch,
	}
}
