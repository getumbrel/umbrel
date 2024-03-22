import {ReactNode, Suspense} from 'react'
import {Link, Outlet, RouteObject, useLocation} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {AvailableAppsProvider} from '@/providers/available-apps'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import AppStoreStory from '@/routes/stories/app-store'
import CmdkStory from '@/routes/stories/cmdk'
import ColorThiefExample from '@/routes/stories/color-thief'
import CoverStory from '@/routes/stories/cover'
import DesktopStory from '@/routes/stories/desktop'
import DialogExamples from '@/routes/stories/dialogs'
import ErrorStory from '@/routes/stories/error'
import InputExamples from '@/routes/stories/input'
import {MarkdownExample} from '@/routes/stories/markdown'
import MigrateStory from '@/routes/stories/migrate'
import MiscStory from '@/routes/stories/misc'
import SettingsStory from '@/routes/stories/settings'
import SheetStory from '@/routes/stories/sheet'
import TailwindStory from '@/routes/stories/tailwind'
import Trpc from '@/routes/stories/trpc'
import WidgetsStory from '@/routes/stories/widgets'
import {keyBy, pathJoin} from '@/utils/misc'
import {tw} from '@/utils/tw'

type StoryRoute = RouteObject & {name: string; path: string}

const storyLinks: StoryRoute[] = [
	{
		name: 'Dialogs',
		path: '/dialogs',
		Component: DialogExamples,
	},
	{
		name: 'Desktop',
		path: '/desktop',
		element: (
			<AvailableAppsProvider>
				<DesktopStory />
			</AvailableAppsProvider>
		),
	},
	{
		name: 'Widgets',
		path: '/widgets',
		Component: WidgetsStory,
	},
	{
		name: 'App Store',
		path: '/app-store',
		Component: AppStoreStory,
	},
	{
		name: 'Settings',
		path: '/settings',
		Component: SettingsStory,
	},
	{
		name: 'tRPC',
		path: '/trpc',
		Component: Trpc,
	},
	{
		name: 'Input',
		path: '/input',
		Component: InputExamples,
	},
	{
		name: 'Color Thief',
		path: '/color-thief',
		Component: ColorThiefExample,
	},
	{
		name: 'Error',
		path: '/error',
		Component: ErrorStory,
	},
	{
		name: 'CMDK',
		path: '/cmdk',
		element: (
			<AvailableAppsProvider>
				<CmdkStory />
			</AvailableAppsProvider>
		),
	},
	{
		name: 'Sheet',
		path: '/sheet',
		element: <SheetStory />,
	},
	{
		name: 'Migrate',
		path: '/migrate',
		Component: MigrateStory,
	},
	{
		name: 'Markdown',
		path: '/markdown',
		Component: MarkdownExample,
	},
	{
		name: 'Tailwind',
		path: '/tailwind',
		Component: TailwindStory,
	},
	{
		name: 'Misc',
		path: '/misc',
		Component: MiscStory,
	},
	{
		name: 'Cover',
		path: '/stories/cover',
		Component: CoverStory,
	},
]

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
			<div className='fixed top-0 z-50 w-full bg-neutral-900 '>
				<FadeScroller direction='x' className='umbrel-hide-scrollbar flex shrink-0 items-center overflow-x-auto'>
					<NavLink to='/'>👈 Home</NavLink>
					<LanguageDropdown />
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
			<div className='mt-10 flex h-full flex-col gap-6 p-5'>
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

export const H1 = ({children}: {children: ReactNode}) => <h1 className='text-3xl font-bold'>{children}</h1>
export const H2 = ({children}: {children: ReactNode}) => (
	<h2 className='w-full border-t border-white/50 pt-1 text-2xl'>{children}</h2>
)
export const H3 = ({children}: {children: ReactNode}) => <h3 className='text-xl font-bold'>{children}</h3>
