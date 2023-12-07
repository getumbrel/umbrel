import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './index.css'
import './utils/i18n'

import {ErrorBoundary} from 'react-error-boundary'

import {IframeChecker} from './components/iframe-checker'
import {CoverMessage, CoverMessageParagraph} from './components/ui/cover-message'
import {Loading} from './components/ui/loading'
import {Toaster} from './components/ui/toast'
import {EnsureBackendAvailable} from './modules/auth/ensure-backend-available'
import {WallpaperProvider} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<IframeChecker>
			{/* <UpdatingCover> */}
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
				<Toaster />
			</ErrorBoundary>
			{/* </UpdatingCover> */}
		</IframeChecker>
	</React.StrictMode>,
)

// UI to show while updating umbrelOS
function UpdatingCover({children}: {children: React.ReactNode}) {
	return (
		<CoverMessage>
			<Loading>Updating umbrelOS</Loading>
			<CoverMessageParagraph>
				Please do not refresh this page or turn off your Umbrel while the update is in progress
			</CoverMessageParagraph>
		</CoverMessage>
	)
}
