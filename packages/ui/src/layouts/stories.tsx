import {ReactNode, Suspense} from 'react'
import {Link, Outlet} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'

const storyLinks = [
	{
		name: 'Desktop',
		path: '/stories/desktop',
	},
	{
		name: 'App Store',
		path: '/stories/app-store',
	},
	{
		name: 'Settings',
		path: '/stories/settings',
	},
	{
		name: 'tRPC',
		path: '/stories/trpc',
	},
	{
		name: 'Input',
		path: '/stories/input',
	},
	{
		name: 'Color Thief',
		path: '/stories/color-thief',
	},
	{
		name: 'Error',
		path: '/stories/error',
	},
	{
		name: 'CMDK',
		path: '/stories/cmdk',
	},
	{
		name: 'Sheet',
		path: '/stories/sheet',
	},
	{
		name: 'Migrate',
		path: '/stories/migrate',
	},
	{
		name: 'Tailwind',
		path: '/stories/tailwind',
	},
]

export function StoriesLayout() {
	useUmbrelTitle('Stories')

	return (
		<>
			<div className='umbrel-fade-scroller-x umbrel-hide-scrollbar sticky top-0 z-50 flex items-center overflow-x-auto bg-neutral-900'>
				<NavLink to='/'>👈 Home</NavLink>
				<span className='px-2'>|</span>
				<NavLink to='/stories'>Stories</NavLink>
				{storyLinks.map(({name, path}) => (
					<NavLink key={path} to={path}>
						{name}
					</NavLink>
				))}
			</div>
			<div className='flex flex-col gap-6'>
				<Suspense>
					<Outlet />
				</Suspense>
			</div>
		</>
	)
}

const NavLink = ({to, children}: {to: string; children: ReactNode}) => (
	<Link to={to} className='shrink-0 p-2 hover:bg-white/10'>
		{children}
	</Link>
)

export const H1 = ({children}: {children: ReactNode}) => <h1 className='text-3xl font-bold'>{children}</h1>
export const H2 = ({children}: {children: ReactNode}) => (
	<h2 className='border-t border-white/50 pt-1 text-2xl'>{children}</h2>
)
export const H3 = ({children}: {children: ReactNode}) => <h3 className='text-xl font-bold'>{children}</h3>
