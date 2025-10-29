import {RouterProvider} from 'react-router-dom'

import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {ConfirmationProvider} from '@/providers/confirmation'
import {GlobalSystemStateProvider} from '@/providers/global-system-state/index'

import {AuthBootstrap} from './providers/auth-bootstrap'
import {GlobalFilesProvider} from './providers/global-files'
import {RemoteLanguageInjector} from './providers/language'
import {Prefetcher} from './providers/prefetch'
import {RemoteWallpaperInjector, WallpaperProviderConnected} from './providers/wallpaper'
import {router} from './router'
import {TrpcProvider} from './trpc/trpc-provider'

initTokenRenewal()

init(
	<TrpcProvider>
		<AuthBootstrap />
		<RemoteLanguageInjector />
		{/* Wallpaper inside trpc because it requires backend call */}
		<WallpaperProviderConnected>
			<RemoteWallpaperInjector />
			<ConfirmationProvider>
				<GlobalSystemStateProvider>
					<GlobalFilesProvider>
						<RouterProvider router={router} />
					</GlobalFilesProvider>
				</GlobalSystemStateProvider>
			</ConfirmationProvider>
		</WallpaperProviderConnected>
		<Prefetcher />
	</TrpcProvider>,
)
