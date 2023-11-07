import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './utils/i18n'
import './index.css'

import {ErrorBoundary} from 'react-error-boundary'
import {Toaster} from 'sonner'

import {CoverMessage} from './components/ui/cover-message'
import {EnsureBackendAvailable} from './modules/auth/ensure-backend-available'
import {WallpaperProvider} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary fallback={<CoverMessage>Something went wrong</CoverMessage>}>
			<TrpcProvider>
				<EnsureBackendAvailable>
					<WallpaperProvider>
						<TooltipProvider>
							<RouterProvider router={router} />
						</TooltipProvider>
					</WallpaperProvider>
				</EnsureBackendAvailable>
			</TrpcProvider>
			<Toaster position='top-center' richColors />
		</ErrorBoundary>
	</React.StrictMode>,
)
