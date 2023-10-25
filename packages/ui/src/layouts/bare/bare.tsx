import {Outlet} from 'react-router-dom'

import {Wallpaper} from '@/components/wallpaper-context'

export function BareLayout() {
	return (
		<>
			<Wallpaper />
			<div className='fixed inset-0 bg-black/30 backdrop-blur-xl' />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>
				<Outlet />
			</div>
		</>
	)
}
