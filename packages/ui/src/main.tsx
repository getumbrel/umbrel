import {RouterProvider} from 'react-router-dom'

import {PendingRaidOperationProvider} from '@/features/storage/contexts/pending-operation-context'
import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {ConfirmationProvider} from '@/providers/confirmation'
import {GlobalSystemStateProvider} from '@/providers/global-system-state/index'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

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
						<PendingRaidOperationProvider>
							<ImmersiveDialogProvider>
								{/* v7_startTransition wraps navigations in React.startTransition(), which keeps the old page
								visible while lazy components load. Without this, view transitions snapshot the Suspense
								fallback instead of the actual destination page. */}
								<RouterProvider router={router} future={{v7_startTransition: true}} />
							</ImmersiveDialogProvider>
						</PendingRaidOperationProvider>
					</GlobalFilesProvider>
				</GlobalSystemStateProvider>
			</ConfirmationProvider>
		</WallpaperProviderConnected>
		<Prefetcher />
	</TrpcProvider>,
)
