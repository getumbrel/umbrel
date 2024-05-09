import {RouterProvider} from 'react-router-dom'

import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {GlobalSystemStateProvider} from '@/providers/global-system-state/index'

import {RemoteWallpaperInjector, WallpaperProviderConnected} from './providers/wallpaper'
import {router} from './router'
import {TrpcProvider} from './trpc/trpc-provider'

initTokenRenewal()

init(
	<TrpcProvider>
		{/* Wallpaper inside trpc because it requires backend call */}
		<WallpaperProviderConnected>
			<RemoteWallpaperInjector />
			<GlobalSystemStateProvider>
				<RouterProvider router={router} />
			</GlobalSystemStateProvider>
		</WallpaperProviderConnected>
	</TrpcProvider>,
)
