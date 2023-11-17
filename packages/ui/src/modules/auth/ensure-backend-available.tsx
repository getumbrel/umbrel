import {CoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'

export function EnsureBackendAvailable({children}: {children: React.ReactNode}) {
	// TODO: probably want a straightforward `fetch` call here instead of using trpc. This will allow us to check if the backend is available before we even load the trpc provider.
	const getQuery = trpcReact.debug.sayHi.useQuery(undefined, {
		retry: false,
	})

	if (getQuery.isLoading) {
		return <CoverMessage delayed>Checking backend...</CoverMessage>
	}

	if (getQuery.error) {
		return <CoverMessage>Backend unavailable.</CoverMessage>
	}

	return children
}
