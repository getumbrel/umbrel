import {ReactNode} from 'react'
import {Link, Outlet} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {WallpaperProvider} from '@/modules/desktop/wallpaper-context'

export function StoriesLayout() {
	useUmbrelTitle('Stories')

	return (
		<WallpaperProvider>
			<div className='h-full overflow-y-auto'>
				<div className='flex gap-2 bg-neutral-900 p-3'>
					<Link to='/'>🏠 Home</Link>
					<Link to='/stories'>Stories</Link>
					<Link to='/stories/desktop'>Desktop</Link>
					<Link to='/stories/app-store'>App Store</Link>
					<Link to='/stories/settings'>Settings</Link>
					<Link to='/stories/trpc'>tRPC</Link>
					<Link to='/stories/input'>Input</Link>
					<Link to='/stories/colorthief'>Color Thief</Link>
					<Link to='/stories/error'>Error</Link>
				</div>
				<div className='flex flex-col gap-6'>
					<Outlet />
				</div>
			</div>
		</WallpaperProvider>
	)
}

export const H1 = ({children}: {children: ReactNode}) => <h1 className='text-3xl font-bold'>{children}</h1>
export const H2 = ({children}: {children: ReactNode}) => (
	<h2 className='border-t border-white/50 pt-1 text-2xl'>{children}</h2>
)
export const H3 = ({children}: {children: ReactNode}) => <h3 className='text-xl font-bold'>{children}</h3>
