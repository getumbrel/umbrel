import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './index.css'
import './utils/i18n'

import i18next from 'i18next'
import {ErrorBoundary} from 'react-error-boundary'

import {initTokenRenewal} from '@/modules/auth/shared'

import {IframeChecker} from './components/iframe-checker'
import {BareCoverMessage, CoverMessageTarget} from './components/ui/cover-message'
import {Toaster} from './components/ui/toast'
import {RemoteWallpaperInjector, WallpaperProvider} from './providers/wallpaper'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'
import {t} from './utils/i18n'

initTokenRenewal()

i18next.on('initialized', () => {
	ReactDOM.createRoot(document.getElementById('root')!).render(
		<React.StrictMode>
			<IframeChecker>
				{/* <UpdatingCover> */}
				<ErrorBoundary fallback={<BareCoverMessage>{t('something-went-wrong')}</BareCoverMessage>}>
					<TrpcProvider>
						<WallpaperProvider>
							<RemoteWallpaperInjector />
							<TooltipProvider>
								{/* TODO: move stories out of main router */}
								<RouterProvider router={router} />
							</TooltipProvider>
						</WallpaperProvider>
					</TrpcProvider>
					<Toaster />
					{/* Want to show cover message over Toast elements */}
					<CoverMessageTarget />
				</ErrorBoundary>
			</IframeChecker>
		</React.StrictMode>,
	)
})
