import {storyLinks} from '@stories/components/story-links'
import {WallpaperDropdown} from '@stories/components/wallpaper-dropdown'
import {ReactNode, Suspense} from 'react'
import {Link, Outlet, RouteObject, useLocation} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {keyBy, pathJoin} from '@/utils/misc'
import {tw} from '@/utils/tw'

export type StoryRoute = RouteObject & {name: string; path: string}

const storyRoutesKeyed = keyBy(storyLinks, 'path')

export function SpecificStory() {
	const location = useLocation()

	const path = location.pathname.replace(/^\/stories/, '')
	const {Component, element} =
		path in storyRoutesKeyed ? storyRoutesKeyed[path] : {Component: undefined, element: undefined}

	if (Component) {
		return <Component />
	} else if (element) {
		return element
	} else {
		return <div>Story not found</div>
	}
}

export function StoriesLayout() {
	return (
		<div className='flex min-h-full flex-col bg-neutral-700'>
			<div className='fixed top-0 z-50 w-full bg-neutral-900'>
				<FadeScroller direction='x' className='umbrel-hide-scrollbar flex shrink-0 items-center overflow-x-auto'>
					<div className='flex items-center gap-1'>
						<NavLink to='/'>👈 Home</NavLink>
						<LanguageDropdown />
						<WallpaperDropdown />
						<div className='h-5 w-5 shrink-0 bg-brand' />
					</div>
					<span className='px-2'>|</span>
					<NavLink to='/stories'>Stories</NavLink>
					{storyLinks.map(({name, path}) => (
						<NavLink key={path} to={pathJoin('stories/', path)}>
							{name}
						</NavLink>
					))}
					<a href='/iframe-test.html' className={navLinkClass}>
						iframe-test.html
					</a>
				</FadeScroller>
			</div>
			<div className='h-10' />
			<div className='flex h-full flex-col gap-6 p-5'>
				<Suspense>
					<Outlet />
				</Suspense>
			</div>
		</div>
	)
}

const NavLink = ({to, children}: {to: string; children: ReactNode}) => (
	<Link to={to} className={navLinkClass}>
		{children}
	</Link>
)

const navLinkClass = tw`'shrink-0 p-2 hover:bg-white/10 whitespace-nowrap`
