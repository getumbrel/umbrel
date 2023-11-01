import 'inter-ui/inter.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'

import './utils/i18n'
import './index.css'

import {EnsureBackendAvailable} from './modules/auth/ensure-backend-available'
import {WallpaperProvider} from './modules/desktop/wallpaper-context'
import {router} from './router'
import {TooltipProvider} from './shadcn-components/ui/tooltip'
import {TrpcProvider} from './trpc/trpc-provider'

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
