import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Backend from 'i18next-http-backend'
import {initReactI18next} from 'react-i18next'

i18next
	.use(initReactI18next) // passes i18n down to react-i18next
	.use(Backend)
	.use(LanguageDetector)
	.init({
		// debug: true,
		// initImmediate: true,
		backend: {
			loadPath: '/locales/{{lng}}.json',
		},
		// lng: "fr",
		// lng: "en", // if you're using a language detector, do not define the lng option
		fallbackLng: 'en',

		interpolation: {
			escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
		},

		detection: {
			order: ['localStorage'],
			caches: ['localStorage'],
		},
		react: {
			// Prevents basic elements like `<em>`from being rendered through `dangerouslySetInnerHTML`
			// Not just for security, but also want to be able to use markup to swap out even basic elements like `<em>` for `<span>`.
			transSupportBasicHtmlNodes: false,
		},
	})

// Components and hooks should use `useTranslation()` from react-i18next for reactive language switching.
// This static binding is only for utility functions that are called during render (not React components/hooks).
export const t = i18next.t.bind(i18next)
export const maybeT = (key: string | undefined) => (key ? t(key) : t('unknown'))
