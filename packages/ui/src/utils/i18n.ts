import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Backend from 'i18next-http-backend'
import {initReactI18next} from 'react-i18next'

i18n
	.use(initReactI18next) // passes i18n down to react-i18next
	.use(Backend)
	.use(LanguageDetector)
	.init({
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
	})

export const i18next = i18n
export const t = i18n.t.bind(i18n)
