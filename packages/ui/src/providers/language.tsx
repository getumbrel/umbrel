import i18next from 'i18next'
import {useEffect} from 'react'
import {arrayIncludes} from 'ts-extras'

import {trpcReact} from '@/trpc/trpc'
import {supportedLanguageCodes} from '@/utils/language'

/**
 * Monitors the backend language preference and syncs it to i18next.
 * Handles the case where language is changed from another session/device.
 */
export function RemoteLanguageInjector() {
	const languageQ = trpcReact.user.language.useQuery()
	const preferredLanguage = languageQ.data

	useEffect(() => {
		if (arrayIncludes(supportedLanguageCodes, preferredLanguage) && preferredLanguage !== i18next.language) {
			i18next.changeLanguage(preferredLanguage)
		}
	}, [preferredLanguage])

	return null
}
