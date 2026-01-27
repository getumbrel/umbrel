import {BareCoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'

import {RedirectRaidError} from './redirects'

// Checks if RAID mount failed during boot.
// If mount failed, we redirect to the raid error screen.
export function EnsureNoRaidMountFailure({children}: {children?: React.ReactNode}) {
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {
		retry: false,
	})

	// Still loading - show spinner
	if (mountFailureQ.isLoading) {
		return (
			<BareCoverMessage delayed>
				<Loading />
			</BareCoverMessage>
		)
	}

	// Query failed - assume no mount failure (let app continue, other errors will surface)
	if (mountFailureQ.isError) {
		return <>{children}</>
	}

	// Mount failed - redirect to raid error screen
	if (mountFailureQ.data === true) {
		return <RedirectRaidError />
	}

	// Mount OK - render children
	return <>{children}</>
}
