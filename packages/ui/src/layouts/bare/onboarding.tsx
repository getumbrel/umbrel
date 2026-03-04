import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

import {OnboardingPage} from '@/layouts/bare/onboarding-page'

export function OnboardingLayout() {
	return (
		<OnboardingPage>
			<Suspense>
				<Outlet />
			</Suspense>
		</OnboardingPage>
	)
}
