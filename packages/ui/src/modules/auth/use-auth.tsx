import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {transfers} from '@/features/files/transfers/transfers'
import {finishBrowserLogout} from '@/modules/auth/logout'
import {AUTH_TOKEN_LOCAL_STORAGE_KEY, clearAuthToken, storeAuthToken} from '@/modules/auth/token-renewal'
import {trpcReact} from '@/trpc/trpc'

import {redirect} from './redirects'

/**
 * Make sure to hard reload page after updating this because trpc client is created on page load and it's only possible to update it on page load.
 */
export function useAuthToken() {
	const token = window.localStorage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY)

	return {
		token,
		removeToken() {
			clearAuthToken(window.localStorage)
		},
		setToken(token: string) {
			storeAuthToken(window.localStorage, token)
		},
	}
}

export function useAuth() {
	const {t} = useTranslation()
	const {token, setToken} = useAuthToken()

	const logoutMut = trpcReact.user.logout.useMutation({
		onSuccess(didWork) {
			// TODO: add translation
			if (!didWork) throw new Error("Logout didn't work.")
			// Work accepted under this account must not outlive it
			transfers.reset()
			finishBrowserLogout()
		},
		onError() {
			toast.error(t('logout-error-generic'), {area: 'umbrelos'})
		},
	})

	return {
		token,
		async logout() {
			logoutMut.mutate()
		},
		loginWithToken(token: string) {
			setToken(token)
			const safeUrl = redirect.getRedirectUrl()

			// Hard navigate to force all parent layouts to re-render
			window.location.href = safeUrl.toString()
		},
		signUpWithToken(token: string, redirectTo: string = '/onboarding/account-created') {
			setToken(token)
			window.location.href = redirectTo
		},
	}
}
