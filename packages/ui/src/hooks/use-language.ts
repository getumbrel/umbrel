import i18next from 'i18next'
import {arrayIncludes} from 'ts-extras'

import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode, supportedLanguageCodes} from '@/utils/language'

/**
 * Hook for reading and updating the active UI language.
 *
 * NOTE: There are differences when the user is logged‑in vs during onboarding:
 *  • It ALWAYS saves the chosen language to localStorage and tells `i18next`
 *    to switch immediately so that the UI updates.
 *  • If the user is authenticated (we have a JWT), it additionally persists
 *    the preference on the backend via `user.set`.
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
		if (arrayIncludes(supportedLanguageCodes, language)) {
			const hasJwt = Boolean(localStorage.getItem(JWT_LOCAL_STORAGE_KEY))
			// Persist remotely only if the user account has been created
			// (i.e. the user is changing the language via settings, not during onboarding)
			if (hasJwt) {
				// Update the preferred language on the backend, which in turn notifies
				// RemoteLanguageInjector that the preferred language has changed. When
				// this happens, and the preferred language differs from the active
				// language, the injector sets the new language and reloads the page.
				userSetMut.mutate({language})
			} else {
				// If the user is chanding language during the onboarding
				if (i18next.language !== language) {
					// Persist locally
					i18next.changeLanguage(language)
					// Reload the page manually as RemoteLanguageInjector won't be notified
					window.location.reload()
				}
			}
		}
	}

	// Default to English if active code is not supported
	const code = arrayIncludes(supportedLanguageCodes, i18next.language)
		? (i18next.language as SupportedLanguageCode)
		: 'en'

	return [code, setCode]
}
