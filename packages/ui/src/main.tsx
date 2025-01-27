import {RouterProvider} from 'react-router-dom'

import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {GlobalSystemStateProvider} from '@/providers/global-system-state/index'

import {GlobalFilesProvider} from './providers/global-files'
import {RemoteLanguageInjector} from './providers/language'
import {Prefetcher} from './providers/prefetch'
import {RemoteWallpaperInjector, WallpaperProviderConnected} from './providers/wallpaper'
import {router} from './router'
import {TrpcProvider} from './trpc/trpc-provider'

initTokenRenewal()

init(
	<TrpcProvider>
		<RemoteLanguageInjector />
		{/* Wallpaper inside trpc because it requires backend call */}
		<WallpaperProviderConnected>
			<RemoteWallpaperInjector />
			<GlobalSystemStateProvider>
				<GlobalFilesProvider>
					<RouterProvider router={router} />
				</GlobalFilesProvider>
			</GlobalSystemStateProvider>
		</WallpaperProviderConnected>
		<Prefetcher />
	</TrpcProvider>,
)
