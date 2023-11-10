import {useLocation, useNavigate} from 'react-router-dom'

import {CoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

/** Don't show children unless logged in */
export function EnsureLoggedIn({children}: {children?: React.ReactNode}) {
	const location = useLocation()
	const navigate = useNavigate()

	const {
		data: isLoggedIn,
		isLoading,
		isError,
	} = trpcReact.user.isLoggedIn.useQuery(undefined, {
		retry: false,
	})

	if (isLoading) {
		return <CoverMessage delayed>Checking backend for user...</CoverMessage>
	}

	if (isError) {
		return <CoverMessage delayed>Error checking authentication status.</CoverMessage>
	}

	if (isLoggedIn) {
		if (location.pathname.startsWith('/login')) {
			sleep(500).then(() => navigate('/'))
			return <CoverMessage delayed>Redirecting to home...</CoverMessage>
		}
	} else {
		if (!location.pathname.startsWith('/login')) {
			sleep(500).then(() => navigate('/login'))
			return <CoverMessage delayed>Redirecting to login...</CoverMessage>
		}
	}

	return children
}
