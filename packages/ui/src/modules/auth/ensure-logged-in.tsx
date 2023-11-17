import {CoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'

import {RedirectHome, RedirectLogin} from './redirects'

export function EnsureLoggedIn({children}: {children?: React.ReactNode}) {
	return (
		<EnsureLoggedInState loggedIn otherwise={<RedirectLogin />}>
			{children}
		</EnsureLoggedInState>
	)
}

export function EnsureLoggedOut({children}: {children?: React.ReactNode}) {
	return (
		<EnsureLoggedInState loggedIn={false} otherwise={<RedirectHome />}>
			{children}
		</EnsureLoggedInState>
	)
}

/** Don't show children unless logged in */
function EnsureLoggedInState({
	loggedIn,
	otherwise,
	children,
}: {
	loggedIn: boolean
	otherwise: React.ReactNode
	children?: React.ReactNode
}) {
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery(undefined, {
		retry: false,
	})
	const isLoggedIn = isLoggedInQ.data ?? false
	const wantsLoggedIn = loggedIn

	// ---

	if (isLoggedInQ.isLoading) {
		return <CoverMessage delayed>Checking backend for user...</CoverMessage>
	}

	if (isLoggedInQ.isError) {
		return <CoverMessage>Failed to check if user is logged in.</CoverMessage>
	}

	if (isLoggedIn === wantsLoggedIn) {
		return children
	} else {
		return otherwise
	}
}
