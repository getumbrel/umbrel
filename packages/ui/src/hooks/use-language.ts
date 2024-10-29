import i18next from 'i18next'
import {arrayIncludes} from 'ts-extras'

import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode, supportedLanguageCodes} from '@/utils/language'

export function useLanguage(): [code: SupportedLanguageCode, setCode: (code: SupportedLanguageCode) => void] {
	const ctx = trpcReact.useContext()
	const userSetMut = trpcReact.user.set.useMutation({
		onSuccess() {
			ctx.user.get.invalidate()
			ctx.user.language.invalidate()
		},
	})

	const setCode = (language: SupportedLanguageCode) => {
		// Update the preferred language on the backend, which in turn notifies
		// RemoteLanguageInjector that the preferred language has changed. When
		// this happens, and the preferred language differs from the active
		// language, the injector sets the new language and reloads the page.
		if (arrayIncludes(supportedLanguageCodes, language)) {
			userSetMut.mutate({language})
		}
	}

	// Default to English if active code is not supported
	const code = arrayIncludes(supportedLanguageCodes, i18next.language) ? i18next.language : 'en'

	return [code, setCode]
}
