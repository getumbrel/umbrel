import {CoverMessage} from '@/components/ui/cover-message'
import {trpcReact} from '@/trpc/trpc'

export function EnsureBackendAvailable({children}: {children: React.ReactNode}) {
	// TODO: probably want a straightforward `fetch` call here instead of using trpc
	const getQuery = trpcReact.debug.sayHi.useQuery(undefined, {
		retry: false,
	})

	if (getQuery.isLoading) {
		return <CoverMessage>Checking backend...</CoverMessage>
	}

	if (getQuery.error) {
		return <CoverMessage>Backend unavailable.</CoverMessage>
	}

	return children
}
