import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './index.css'

import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Backend from 'i18next-http-backend'
import {initReactI18next} from 'react-i18next'

import {EnsureBackendAvailable} from './components/ensure-backend-available'
import {WallpaperProvider} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/TrpcProvider'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<TrpcProvider>
			<EnsureBackendAvailable>
				<WallpaperProvider>
					<TooltipProvider>
						<RouterProvider router={router} />
					</TooltipProvider>
				</WallpaperProvider>
			</EnsureBackendAvailable>
		</TrpcProvider>
	</React.StrictMode>,
)
