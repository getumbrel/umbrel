import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

import {Wallpaper} from '@/modules/desktop/wallpaper-context'

export function BareLayout() {
	return (
		<>
			<Wallpaper />
			<div className='fixed inset-0 bg-black/30 backdrop-blur-xl contrast-more:bg-black contrast-more:backdrop-blur-none' />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>
				<Suspense>
					<Outlet />
				</Suspense>
			</div>
		</>
	)
}
