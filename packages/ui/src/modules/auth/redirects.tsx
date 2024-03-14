import {useLocation, useNavigate} from 'react-router-dom'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {t} from '@/utils/i18n'
import {IS_DEV, sleep} from '@/utils/misc'

const SLEEP_TIME = IS_DEV ? 600 : 0

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

	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-onboarding')}</BareCoverMessage>
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

	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-login')}</BareCoverMessage>
}

export function RedirectHome() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('home')

	if (location.pathname === path) return null

	sleep(SLEEP_TIME).then(() => navigate(path))

	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-home')}</BareCoverMessage>
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
