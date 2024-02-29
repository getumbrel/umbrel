import {useEffect, useState} from 'react'

import {trpcReact} from '@/trpc/trpc'

export type RestartState = 'initial' | 'waiting' | 'failing' | 'succeeding-again'

/** Can also use for shutdown */
export function useShutdownRestartPolling({
	onFailing,
	onSucceedingAgain,
}: {
	onFailing?: () => void
	onSucceedingAgain?: () => void
} = {}) {
	const [state, setState] = useState<RestartState>('initial')

	const canPoll = state === 'waiting' || state === 'failing'

	const pingQ = trpcReact.debug.sayHi.useQuery(undefined, {
		enabled: canPoll,
		refetchInterval: 1000,
		cacheTime: 0,
		// retry: false,
		// refetchOnReconnect: false,
		// refetchOnWindowFocus: false,
		trpc: {
			// Aborts on React state update. This is good because a manual ping will cancel previous request
			abortOnUnmount: true,
		},
	})

	useEffect(() => {
		// trpc stays in success state until a few failures happen.
		// We want to react to the first failure.
		if (pingQ.isError || pingQ.failureCount > 0) {
			setState('failing')
			onFailing?.()
			// The real check is not `isSuccess` because trpc doesn't change that state until a few failed attempts.
		} else if (state === 'failing' && pingQ.isSuccess && !pingQ.isFetching && !pingQ.isRefetching) {
			setState('succeeding-again')
			onSucceedingAgain?.()
		}
	}, [pingQ.isError, pingQ.isSuccess, pingQ.failureCount, pingQ.isFetching, pingQ.isRefetching])

	const manualPing = () => {
		if (!canPoll) return
		pingQ.refetch()
	}

	const startExpectingFailure = () => {
		setState('waiting')
	}

	return {state, startExpectingFailure: startExpectingFailure, canManualPing: canPoll, pingQ, manualPing}
}
