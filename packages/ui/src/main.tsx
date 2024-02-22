import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './index.css'
import './utils/i18n'

import {ErrorBoundary} from 'react-error-boundary'

import {IframeChecker} from './components/iframe-checker'
import {BareCoverMessage} from './components/ui/cover-message'
import {Toaster} from './components/ui/toast'
import {RemoteWallpaperInjector, WallpaperProvider} from './providers/wallpaper'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'
import {t} from './utils/i18n'

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
			</ErrorBoundary>
		</IframeChecker>
	</React.StrictMode>,
)
