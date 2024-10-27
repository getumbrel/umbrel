import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {redirect} from './redirects'

/**
 * Make sure to hard reload page after updating this because trpc client is created on page load and it's only possible to update it on page load.
 */
export function useJwt() {
	const jwt = window.localStorage.getItem(JWT_LOCAL_STORAGE_KEY)

	return {
		jwt,
		removeJwt() {
			window.localStorage.removeItem(JWT_LOCAL_STORAGE_KEY)
		},
		setJwt(jwt: string) {
			window.localStorage.setItem(JWT_LOCAL_STORAGE_KEY, jwt)
		},
	}
}

export function useAuth() {
	const {jwt, setJwt, removeJwt} = useJwt()

	const logoutMut = trpcReact.user.logout.useMutation({
		onSuccess(didWork) {
			// TODO: add translation
			if (!didWork) throw new Error("Logout didn't work.")
			removeJwt()
			// Hard navigate to `/login` to force all parent layouts to re-render
			window.location.href = '/login'
		},
		onError() {
			alert(t('logout-error-generic'))
		},
	})

	const refreshTokenQ = trpcReact.user.renewToken.useMutation()

	const refreshToken = async () => {
		const res = await refreshTokenQ.mutateAsync()
		setJwt(res)
	}

	return {
		jwt,
		async logout() {
			logoutMut.mutate()
		},
		loginWithJwt(jwt: string) {
			setJwt(jwt)

			// Ensure we only treat the redirect path as a relative URL
			const safeUrl = new URL(window.location.href)
			safeUrl.hash = ''
			safeUrl.search = ''
			safeUrl.pathname = redirect.getRedirectPath()

			// Hard navigate to force all parent layouts to re-render
			window.location.href = safeUrl.toString()
		},
		signUpWithJwt(jwt: string) {
			setJwt(jwt)
			window.location.href = '/onboarding/account-created'
		},
		refreshToken,
	}
}
