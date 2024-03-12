import {BareCoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

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
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery(undefined)
	const isLoggedIn = isLoggedInQ.data ?? false
	const wantsLoggedIn = loggedIn

	// ---

	if (isLoggedInQ.isLoading) {
		return <BareCoverMessage delayed>{t('auth.checking-backend-for-user')}</BareCoverMessage>
	}

	if (isLoggedInQ.isError) {
		return <BareCoverMessage>{t('auth.failed-checking-if-user-logged-in')}</BareCoverMessage>
	}

	if (isLoggedIn === wantsLoggedIn) {
		return children
	} else {
		return otherwise
	}
}
