import {Navigate} from 'react-router-dom'

import {trpcReact} from '@/trpc/trpc'

// Owner-only screens send a member home instead of showing controls the server
// would refuse. Use inside EnsureLoggedIn.
export function EnsureOwner({children}: {children?: React.ReactNode}) {
	const userQ = trpcReact.user.get.useQuery()
	if (userQ.isLoading) return null
	if (userQ.data?.role === 'member') return <Navigate to='/' replace />
	return <>{children}</>
}
