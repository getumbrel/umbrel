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

// Instead of using `useTranslation` hook, we can use `i18n.t` directly
// The reason for `useTranslation` is to keep the component updated when the language changes, but we just reload the page anyhow.
export const t = i18next.t.bind(i18next)
export const maybeT = (key: string | undefined) => (key ? t(key) : t('unknown'))
