import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

import {DarkenLayer} from '@/components/darken-layer'
import {Wallpaper} from '@/providers/wallpaper'

export function BareLayout() {
	return (
		<>
			<Wallpaper stayBlurred />
			<DarkenLayer />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>
				<Suspense>
					<Outlet />
				</Suspense>
			</div>
		</>
	)
}
