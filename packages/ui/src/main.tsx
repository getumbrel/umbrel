import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './index.css'
import './utils/i18n'

import {ErrorBoundary} from 'react-error-boundary'

import {IframeChecker} from './components/iframe-checker'
import {CoverMessage} from './components/ui/cover-message'
import {Toaster} from './components/ui/toast'
import {EnsureBackendAvailable} from './modules/auth/ensure-backend-available'
import {WallpaperInjector} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<IframeChecker>
			{/* <UpdatingCover> */}
			<ErrorBoundary fallback={<CoverMessage>Something went wrong</CoverMessage>}>
				<TrpcProvider>
					<WallpaperInjector />
					<EnsureBackendAvailable>
						<TooltipProvider>
							<RouterProvider router={router} />
						</TooltipProvider>
					</EnsureBackendAvailable>
				</TrpcProvider>
				<Toaster />
			</ErrorBoundary>
		</IframeChecker>
	</React.StrictMode>,
)
