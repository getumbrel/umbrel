import i18next from 'i18next'

import {trpcReact} from '@/trpc/trpc'
import {supportedLanguageCodes} from '@/utils/language'

export function RemoteLanguageInjector() {
	const languageQ = trpcReact.user.language.useQuery()

	const activeLanguage = i18next.language
	const preferredLanguage = languageQ.data

	if (supportedLanguageCodes.includes(preferredLanguage)) {
		// Reconfigure i18n and reload the page when the preferred language
		// changed on the backend and now differs from the active language
		localStorage.setItem('i18nextLng', preferredLanguage)
		if (preferredLanguage !== activeLanguage) {
			window.location.reload()
		}
	}

	return null
}
