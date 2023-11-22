import {useLocation, useNavigate} from 'react-router-dom'

import {CoverMessage} from '@/components/ui/cover-message'
import {sleep} from '@/utils/misc'

const SLEEP_TIME = 600

type Page = 'onboarding' | 'login' | 'home'

const pageToPath = (page: Page) => {
	switch (page) {
		case 'onboarding':
			return '/onboarding'
		case 'login':
			return '/login'
		case 'home':
			return '/'
	}
}

export function RedirectOnboarding() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('onboarding')

	if (location.pathname.startsWith(path)) return null

	sleep(SLEEP_TIME).then(() => navigate(path))
	return <CoverMessage>Redirecting to onboarding...</CoverMessage>
}

export function RedirectLogin() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('login')

	if (location.pathname.startsWith(path)) return null

	sleep(SLEEP_TIME).then(() =>
		navigate({
			pathname: path,
			search: redirect.createRedirectSearch(),
		}),
	)
	return <CoverMessage>Redirecting to login...</CoverMessage>
}

export function RedirectHome() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('home')

	if (location.pathname === path) return null

	sleep(SLEEP_TIME).then(() => navigate(path))
	return <CoverMessage>Redirecting to home...</CoverMessage>
}

// Keep redirect after login stuff here because url stuff is stringly typed
export const redirect = {
	createRedirectSearch() {
		return `?redirect=${encodeURIComponent(location.pathname)}`
	},
	getRedirectPath() {
		return new URLSearchParams(window.location.search).get('redirect') || '/'
	},
}
