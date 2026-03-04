import {useEffect} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {BareCoverMessage} from '@/components/ui/cover-message'
import {t} from '@/utils/i18n'
import {IS_DEV, sleep} from '@/utils/misc'

const SLEEP_TIME = IS_DEV ? 600 : 0

type Page = 'onboarding' | 'login' | 'home' | 'raid-error'

const pageToPath = (page: Page) => {
	switch (page) {
		case 'onboarding':
			return '/onboarding'
		case 'login':
			return '/login'
		case 'home':
			return '/'
		case 'raid-error':
			return '/raid-error'
	}
}

export function RedirectOnboarding() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('onboarding')
	const shouldRedirect = !location.pathname.startsWith(path)

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-onboarding')}</BareCoverMessage>
}

export function RedirectLogin() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('login')
	const shouldRedirect = !location.pathname.startsWith(path)

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() =>
				navigate({
					pathname: path,
					search: redirect.createRedirectSearch(),
				}),
			)
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-login')}</BareCoverMessage>
}

export function RedirectHome() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('home')
	const shouldRedirect = location.pathname !== path

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-home')}</BareCoverMessage>
}

export function RedirectRaidError() {
	const location = useLocation()
	const navigate = useNavigate()

	const path = pageToPath('raid-error')
	const shouldRedirect = !location.pathname.startsWith(path)

	useEffect(() => {
		if (shouldRedirect) {
			sleep(SLEEP_TIME).then(() => navigate(path))
		}
	}, [shouldRedirect, navigate, path])

	if (!shouldRedirect) return null
	if (SLEEP_TIME === 0) return null
	return <BareCoverMessage>{t('redirect.to-raid-error')}</BareCoverMessage>
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
