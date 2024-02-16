import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {redirect} from './redirects'

/**
 * Make sure to hard reload page after updating this because trpc client is created on page load and it's only possible to update it on page load.
 */
export function useJwt() {
	const jwt = window.localStorage.getItem('jwt')

	return {
		jwt,
		removeJwt() {
			window.localStorage.removeItem('jwt')
		},
		setJwt(jwt: string) {
			window.localStorage.setItem('jwt', jwt)
		},
	}
}

export function useAuth() {
	const {jwt, setJwt, removeJwt} = useJwt()
	const logoutMut = trpcReact.user.logout.useMutation({
		onSuccess(didWork) {
			if (!didWork) throw new Error("Logout didn't work.")
			removeJwt()
			// Hard navigate to `/login` to force all parent layouts to re-render
			window.location.href = '/login'
		},
		onError() {
			alert(t('logout-error-generic'))
		},
	})

	return {
		jwt,
		async logout() {
			logoutMut.mutate()
		},
		loginWithJwt(jwt: string) {
			setJwt(jwt)
			// Hard navigate to `/` to force all parent layouts to re-render
			window.location.href = redirect.getRedirectPath()
		},
		signUpWithJwt(jwt: string) {
			setJwt(jwt)
			window.location.href = '/onboarding/2-account-created'
		},
	}
}
