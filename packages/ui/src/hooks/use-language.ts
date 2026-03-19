import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode, supportedLanguageCodes} from '@/utils/language'

/**
 * Hook for reading and updating the active UI language.
 *
 * Uses react-i18next's `useTranslation` to subscribe to language changes,
 * so components re-render automatically when the language switches.
 *
 * When logged in, the language preference is also persisted on the backend.
 * The `RemoteLanguageInjector` component handles syncing backend preferences
 * (e.g., when changed from another session).
 */
export function useLanguage(): [SupportedLanguageCode, (code: SupportedLanguageCode) => void] {
	const {i18n} = useTranslation()
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
		if (i18n.language === language) return

		// Switch language immediately — useTranslation() subscribers re-render automatically
		i18n.changeLanguage(language)

		const hasJwt = Boolean(localStorage.getItem(JWT_LOCAL_STORAGE_KEY))
		const isOnboarding = window.location.pathname.startsWith('/onboarding')

		// Persist to backend if logged in (not during onboarding since there's no valid JWT yet)
		if (!isOnboarding && hasJwt) {
			userSetMut.mutate({language})
		}
	}

	// Default to English if active code is not supported
	const code = arrayIncludes(supportedLanguageCodes, i18n.language) ? (i18n.language as SupportedLanguageCode) : 'en'

	return [code, setCode]
}
