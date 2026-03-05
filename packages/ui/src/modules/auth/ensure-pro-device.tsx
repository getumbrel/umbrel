import {Navigate} from 'react-router-dom'

import {useDeviceInfo} from '@/hooks/use-device-info'

// Ensures device is Umbrel Pro before showing children.
// Non-Pro devices are redirected to root, which routes them appropriately
// (onboarding if no user, login if not logged in, dashboard if logged in).
export function EnsureProDevice({children}: {children?: React.ReactNode}) {
	const {data: deviceInfo, isLoading} = useDeviceInfo()

	if (isLoading) return null

	const isPro = deviceInfo?.umbrelHostEnvironment === 'umbrel-pro'

	if (!isPro) return <Navigate to='/' replace />

	return <>{children}</>
}
