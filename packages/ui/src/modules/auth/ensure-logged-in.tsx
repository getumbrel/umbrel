import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Cover, LoadingCover} from '@/components/ui/cover'
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
	const {t} = useTranslation()
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery(undefined)
	const isLoggedIn = isLoggedInQ.data ?? false
	const wantsLoggedIn = loggedIn

	// ---

	if (isLoggedInQ.isLoading) {
		return <LoadingCover label={t('auth.checking-backend-for-user')} />
	}

	if (isLoggedInQ.isError) {
		return (
			<Cover
				surface='black'
				mark='logo-dimmed'
				title={t('connection-lost')}
				description={t('auth.failed-checking-if-user-logged-in')}
				actions={
					<Button size='dialog' variant='secondary' onClick={() => void isLoggedInQ.refetch()}>
						{t('reconnect')}
					</Button>
				}
			/>
		)
	}

	if (isLoggedIn === wantsLoggedIn) {
		return children
	} else {
		return otherwise
	}
}
