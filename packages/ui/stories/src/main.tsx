import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {ReactNode, useState} from 'react'
import {RouterProvider} from 'react-router-dom'

import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {Wallpaper, WallpaperProvider, wallpapers} from '@/providers/wallpaper'
import {TrpcProvider} from '@/trpc/trpc-provider'

import {storiesRouter} from './router'

initTokenRenewal()

init(
	<SimpleWallpaperProvider>
		<TrpcProvider>
			<RouterProvider router={storiesRouter} />
			<TrpcMarker />
			<ReactQueryDevtools initialIsOpen={false} position='bottom' />
		</TrpcProvider>
	</SimpleWallpaperProvider>,
)

// In producation, we sync the wallpaper to the backend, but for stories, we don't wanna require being logged-in
function SimpleWallpaperProvider({children}: {children: ReactNode}) {
	const [w, setW] = useState<Wallpaper>(wallpapers[3])

	return (
		<WallpaperProvider wallpaper={w} onWallpaperChange={setW}>
			{children}
		</WallpaperProvider>
	)
}

function TrpcMarker() {
	return (
		<div className='fixed bottom-0 left-0 bg-yellow-400 text-xs font-medium tracking-normal text-yellow-900'>
			VITE_PROXY_BACKEND: {import.meta.env.VITE_PROXY_BACKEND}
		</div>
	)
}
