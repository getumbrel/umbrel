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

	return {
		jwt,
		logout() {
			removeJwt()
			// Hard navigate to `/login` to force all parent layouts to re-render
			window.location.href = '/login'
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
