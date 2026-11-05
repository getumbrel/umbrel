import {useTranslation} from 'react-i18next'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {StoragePage, StorageReadError} from '@/features/storage/components/storage-page'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {trpcReact} from '@/trpc/trpc'

import {RedirectRaidError} from './redirects'

// Checks if RAID mount failed during boot.
// If mount failed, we redirect to the raid error screen.
export function EnsureNoRaidMountFailure({children}: {children?: React.ReactNode}) {
	const {t} = useTranslation()
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {
		retry: 2,
		retryDelay: 1000,
		// Keep trying after the initial retries, without interrupting an established page.
		refetchInterval: (query) => (query.state.status === 'error' && query.state.data === undefined ? 5000 : false),
	})

	// Still loading - show spinner
	if (mountFailureQ.isLoading) {
		return (
			<BareCoverMessage delayed>
				<Loading />
			</BareCoverMessage>
		)
	}

	// Block an unknown mount state, but preserve the page when a background check fails.
	if (mountFailureQ.isError && mountFailureQ.data === undefined) {
		return (
			<OnboardingPage>
				<StoragePage>
					<StorageReadError
						message={t('storage-status.connection-unavailable')}
						onRetry={() => {
							void mountFailureQ.refetch()
						}}
						retrying={mountFailureQ.isFetching}
						detail={mountFailureQ.error.message}
					/>
				</StoragePage>
			</OnboardingPage>
		)
	}

	// Mount failed - redirect to raid error screen
	if (mountFailureQ.data === true) {
		return <RedirectRaidError />
	}

	// Mount OK - render children
	return <>{children}</>
}
