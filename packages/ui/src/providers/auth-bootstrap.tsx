import {useEffect} from 'react'

import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcReact} from '@/trpc/trpc'

// Clear a stale JWT at page load if umbreld reports we're not logged in.
// Without this, a stale JWT can cause WS auth failures and redirect loops
// because we have a tRPC split-link that prefers WS when a token exists.
export function AuthBootstrap() {
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery(undefined)

	useEffect(() => {
		// Wait until the server answers definitively
		if (!isLoggedInQ.isSuccess) return

		// If the server says we're NOT logged in but a JWT exists locally,
		// it's stale (e.g., after secret rotation, restore, migration, new install etc).
		const isLoggedIn = Boolean(isLoggedInQ.data)
		const hasJwt = Boolean(localStorage.getItem(JWT_LOCAL_STORAGE_KEY))

		// If we're already logged in or there is no JWT to clear, we do nothing
		if (isLoggedIn || !hasJwt) return

		// Clear the stale JWT and hard-navigate to login page so guards and split-link
		// recompute state without a token.
		localStorage.removeItem(JWT_LOCAL_STORAGE_KEY)
		window.location.replace('/login')
	}, [isLoggedInQ.isSuccess, isLoggedInQ.data])

	return null
}
