import {useEffect} from 'react'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {RedirectLogin, RedirectOnboarding} from './redirects'

export function EnsureUserDoesntExist({children}: {children?: React.ReactNode}) {
	return (
		<EnsureUser exists={false} otherwise={<RedirectLogin />}>
			{children}
		</EnsureUser>
	)
}

/** Don't show children unless logged in */
export function EnsureUserExists({children}: {children?: React.ReactNode}) {
	return (
		<EnsureUser exists otherwise={<RedirectOnboarding />}>
			{children}
		</EnsureUser>
	)
}

function EnsureUser({
	exists,
	otherwise,
	children,
}: {
	exists: boolean
	otherwise: React.ReactNode
	children?: React.ReactNode
}) {
	const userExistsQ = trpcReact.user.exists.useQuery(undefined, {
		retry: false,
	})

	// Show toast on error
	useEffect(() => {
		if (userExistsQ.isError) {
			toast.error(t('auth.failed-to-check-if-user-exists'))
		}
	}, [userExistsQ.isError])

	const userExists = userExistsQ.data ?? false
	const wantsUserExists = exists

	if (userExistsQ.isLoading) {
		return (
			<BareCoverMessage delayed>
				<Loading />
			</BareCoverMessage>
		)
	}

	if (userExists === wantsUserExists) {
		return children
	} else {
		return otherwise
	}
}
