import {BareCoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {trpcReact} from '@/trpc/trpc'

import {RedirectRaidError} from './redirects'

// TODO: Remove all mock data before merging
const MOCK_RAID_MOUNT_FAILURE = false

// Checks if RAID mount failed during boot.
// If mount failed, we redirect to the raid error screen.
export function EnsureNoRaidMountFailure({children}: {children?: React.ReactNode}) {
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {
		retry: false,
	})

	// Mock for development
	if (MOCK_RAID_MOUNT_FAILURE) {
		return <RedirectRaidError />
	}

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
