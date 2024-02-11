import {ReloadPageButton} from '@/components/reload-page-button'
import {BareCoverMessage, CoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'

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
	const userExists = userExistsQ.data ?? false
	const wantsUserExists = exists

	if (userExistsQ.isLoading) {
		return (
			<BareCoverMessage delayed>
				<Loading />
			</BareCoverMessage>
		)
	}

	if (userExistsQ.isError) {
		return (
			<BareCoverMessage>
				Failed to check if user exists.
				<ReloadPageButton />
			</BareCoverMessage>
		)
	}

	if (userExists === wantsUserExists) {
		return children
	} else {
		return otherwise
	}
}
