import {RouterProvider} from 'react-router-dom'

import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'

import {RemoteWallpaperInjector, WallpaperProvider} from './providers/wallpaper'
import {router} from './router'
import {TrpcProvider} from './trpc/trpc-provider'

initTokenRenewal()

init(
	<TrpcProvider>
		<WallpaperProvider>
			<RemoteWallpaperInjector />
			<RouterProvider router={router} />
		</WallpaperProvider>
	</TrpcProvider>,
)
