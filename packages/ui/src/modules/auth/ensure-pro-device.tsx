import {Navigate} from 'react-router-dom'

import {StoragePage, StorageReadError} from '@/features/storage/components/storage-page'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {trpcReact} from '@/trpc/trpc'

export function EnsureProDevice({children}: {children?: React.ReactNode}) {
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery()
	if (identityQ.isLoading) return null
	if (!identityQ.data && identityQ.error?.data?.code === 'UNAUTHORIZED') {
		return <Navigate to='/' replace />
	}
	// Keep setup mounted if a background read fails during its expected reboot.
	if (identityQ.error && !identityQ.data)
		return (
			<StoragePage>
				<StorageReadError
					onRetry={() => {
						void identityQ.refetch()
					}}
					retrying={identityQ.isFetching}
					detail={identityQ.error.message}
				/>
			</StoragePage>
		)
	if (deviceInfoToHostEnvironment(identityQ.data) !== 'umbrel-pro') return <Navigate to='/' replace />
	return <>{children}</>
}
