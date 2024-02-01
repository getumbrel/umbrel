import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

import {Wallpaper} from '@/modules/desktop/wallpaper-context'

export function BareLayout() {
	return (
		<>
			<Wallpaper stayBlurred />
			<div className='fixed inset-0 bg-black/50  contrast-more:bg-black' />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>
				<Suspense>
					<Outlet />
				</Suspense>
			</div>
		</>
	)
}
