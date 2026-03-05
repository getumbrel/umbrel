import i18next from 'i18next'
import {arrayIncludes} from 'ts-extras'

import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode, supportedLanguageCodes} from '@/utils/language'

/**
 * Hook for reading and updating the active UI language.
 *
 * NOTE: There are differences when the user is logged‑in vs during onboarding:
 *  • During onboarding: The language is not persisted on the backend because the user does not yet have a valid JWT.
 *    Instead, the langauge is saved to localStorage with `i18next` and the page is reloaded to apply the change.
 *  • When a user account exists, the language is persisted on the backend via `user.set`.
 *    The `RemoteLanguageInjector` component then detects this backend change, updates the local
 *    `i18next` state and localStorage, and reloads the page to apply the change globally.
 */
export function useLanguage(): [SupportedLanguageCode, (code: SupportedLanguageCode) => void] {
	const utils = trpcReact.useUtils()
	const userSetMut = trpcReact.user.set.useMutation({
		onSuccess() {
			// Keep local caches in sync
			utils.user.get.invalidate()
			utils.user.language.invalidate()
		},
	})

	const setCode = (language: SupportedLanguageCode) => {
		// Return early if the language is not supported.
		if (!arrayIncludes(supportedLanguageCodes, language)) return

		// Return early if a user clicks the same language that is already active.
		if (i18next.language === language) return

		const hasJwt = Boolean(localStorage.getItem(JWT_LOCAL_STORAGE_KEY))
		const isOnboarding = window.location.pathname.startsWith('/onboarding')

		// If a user account has not been created yet (i.e., we are onboarding), we only persist the language locally
		// because we won't have a valid JWT yet.
		// We make the explicit check for `isOnboarding` to handle the edge case of a user having a JWT in localStorage from a previous install.
		if (isOnboarding || !hasJwt) {
			i18next.changeLanguage(language)
			window.location.reload()
			return
		}

		// If we reach here, the user is logged in, not onboarding, and language has changed.
		// We update the preferred language on the backend, which in turn notifies
		// RemoteLanguageInjector that the preferred language has changed. When
		// this happens, the injector sets the new language and reloads the page.
		userSetMut.mutate({language})
	}

	// Default to English if active code is not supported
	const code = arrayIncludes(supportedLanguageCodes, i18next.language)
		? (i18next.language as SupportedLanguageCode)
		: 'en'

	return [code, setCode]
}
