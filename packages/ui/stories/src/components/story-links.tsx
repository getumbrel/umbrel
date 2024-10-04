import {StoryRoute} from '@stories/layout'
import AppStoreStory from '@stories/routes/stories/app-store'
import CmdkStory from '@stories/routes/stories/cmdk'
import ColorThiefExample from '@stories/routes/stories/color-thief'
import CoverStory from '@stories/routes/stories/cover'
import DesktopStory from '@stories/routes/stories/desktop'
import DialogExamples from '@stories/routes/stories/dialogs'
import ErrorStory from '@stories/routes/stories/error'
import InputExamples from '@stories/routes/stories/input'
import {MarkdownExample} from '@stories/routes/stories/markdown'
import MigrateStory from '@stories/routes/stories/migrate'
import MiscStory from '@stories/routes/stories/misc'
import SettingsStory from '@stories/routes/stories/settings'
import SheetStory from '@stories/routes/stories/sheet'
import TailwindStory from '@stories/routes/stories/tailwind'
import Trpc from '@stories/routes/stories/trpc'
import WidgetsStory from '@stories/routes/stories/widgets'
import WifiStory from '@stories/routes/stories/wifi'

import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {AvailableAppsProvider} from '@/providers/available-apps'

export const storyLinks: StoryRoute[] = [
	{
		name: 'Dialogs',
		path: '/dialogs',
		Component: DialogExamples,
	},
	{
		name: 'Desktop',
		path: '/desktop',
		element: (
			<EnsureLoggedIn>
				<AvailableAppsProvider>
					<DesktopStory />
				</AvailableAppsProvider>
			</EnsureLoggedIn>
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
			<EnsureLoggedIn>
				<AvailableAppsProvider>
					<CmdkStory />
				</AvailableAppsProvider>
			</EnsureLoggedIn>
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
		element: (
			<EnsureLoggedIn>
				<MigrateStory />
			</EnsureLoggedIn>
		),
	},
	{
		name: 'Wifi',
		path: '/wifi',
		Component: WifiStory,
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
		path: '/cover',
		Component: CoverStory,
	},
]
