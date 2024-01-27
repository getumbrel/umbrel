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
import {EnsureBackendAvailable} from './modules/auth/ensure-backend-available'
import {RemoteWallpaperInjector, WallpaperProvider} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<IframeChecker>
			{/* <UpdatingCover> */}
			<ErrorBoundary fallback={<BareCoverMessage>Something went wrong.</BareCoverMessage>}>
				<TrpcProvider>
					<EnsureBackendAvailable>
						<WallpaperProvider>
							<RemoteWallpaperInjector />
							<TooltipProvider>
								{/* TODO: move stories out of main router */}
								<RouterProvider router={router} />
							</TooltipProvider>
						</WallpaperProvider>
					</EnsureBackendAvailable>
				</TrpcProvider>
				<Toaster />
			</ErrorBoundary>
		</IframeChecker>
	</React.StrictMode>,
)
