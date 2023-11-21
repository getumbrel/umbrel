import React, {Suspense} from 'react'
import {useErrorBoundary} from 'react-error-boundary'
import {createBrowserRouter, useRouteError} from 'react-router-dom'

import {CoverMessage} from './components/ui/cover-message'
import {AvailableAppsProvider} from './hooks/use-available-apps'
import {InstalledAppsProvider} from './hooks/use-installed-apps'
import {AppStoreLayout} from './layouts/app-store'
import {BareLayout} from './layouts/bare/bare'
import {Demo} from './layouts/demo-layout'
import {Desktop} from './layouts/desktop'
import {SheetLayout} from './layouts/sheet'
import {StoriesLayout} from './layouts/stories'
import {EnsureLoggedIn, EnsureLoggedOut} from './modules/auth/ensure-logged-in'
import {EnsureUserDoesntExist, EnsureUserExists} from './modules/auth/ensure-user-exists'
import {Settings} from './routes/settings'
import TailwindStory from './routes/stories/tailwind'
import {Button} from './shadcn-components/ui/button'

const AppPage = React.lazy(() => import('./routes/app-store/app-page'))
const CategoryPage = React.lazy(() => import('./routes/app-store/category-page'))
const Discover = React.lazy(() => import('./routes/app-store/discover'))
const CommunityAppStoreHome = React.lazy(() => import('./routes/community-app-store'))
const CommunityAppPage = React.lazy(() => import('./routes/community-app-store/app-page'))
const One = React.lazy(() => import('./routes/demo/one'))
const Two = React.lazy(() => import('./routes/demo/two'))
const EditWidgetsPage = React.lazy(() => import('./routes/edit-widgets'))
const InstallFirstApp = React.lazy(() => import('./routes/install-first-app'))
const Login = React.lazy(() => import('./routes/login'))
const LoginTest = React.lazy(() => import('./routes/login-test'))
const Migrate = React.lazy(() => import('./routes/migrate'))
const MigrateFailed = React.lazy(() => import('./routes/migrate/migrate-failed'))
const MigrateSuccess = React.lazy(() => import('./routes/migrate/migrate-success'))
const OnboardingStart = React.lazy(() => import('./routes/onboarding'))
const CreateAccount = React.lazy(() => import('./routes/onboarding/1-create-account'))
const AccountCreated = React.lazy(() => import('./routes/onboarding/2-account-created'))
const Stories = React.lazy(() => import('./routes/stories'))
const AppStoreStory = React.lazy(() => import('./routes/stories/app-store'))
const CmdkStory = React.lazy(() => import('./routes/stories/cmdk'))
const ColorThiefExample = React.lazy(() => import('./routes/stories/color-thief'))
const DesktopStory = React.lazy(() => import('./routes/stories/desktop'))
const ErrorStory = React.lazy(() => import('./routes/stories/error'))
const InputExamples = React.lazy(() => import('./routes/stories/input'))
const MigrateStory = React.lazy(() => import('./routes/stories/migrate'))
const SettingsStory = React.lazy(() => import('./routes/stories/settings'))
const SheetStory = React.lazy(() => import('./routes/stories/sheet'))
const Trpc = React.lazy(() => import('./routes/stories/trpc'))

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	{
		path: 'install-first-app',
		element: (
			<Suspense>
				<InstallFirstApp />
			</Suspense>
		),
		errorElement: <ErrorBoundary />,
	},

	// desktop
	{
		path: '/',
		element: (
			<EnsureLoggedIn>
				<AvailableAppsProvider>
					<InstalledAppsProvider>
						<Desktop />
					</InstalledAppsProvider>
				</AvailableAppsProvider>
			</EnsureLoggedIn>
		),
		errorElement: <ErrorBoundary />,
		children: [
			{
				path: 'edit-widgets',
				Component: EditWidgetsPage,
			},
			{
				Component: SheetLayout,
				children: [
					{
						path: 'app-store',
						element: (
							<AvailableAppsProvider>
								<AppStoreLayout />
							</AvailableAppsProvider>
						),
						children: [
							{
								index: true,
								Component: Discover,
							},
							{
								path: 'category/:categoryishId',
								Component: CategoryPage,
							},
						],
					},
					{
						path: 'app-store/:appId',
						element: (
							<AvailableAppsProvider>
								<AppPage />
							</AvailableAppsProvider>
						),
					},
					{
						path: 'community-app-store/:appStoreId',
						children: [
							{
								index: true,
								Component: CommunityAppStoreHome,
							},
							{
								path: ':appId',
								Component: CommunityAppPage,
							},
						],
					},
					{
						path: 'settings',
						Component: Settings,
					},
				],
			},
		],
	},

	// bare
	{
		path: '/',
		Component: BareLayout,
		errorElement: <ErrorBoundary />,
		children: [
			{
				path: 'login',
				element: (
					<EnsureUserExists>
						<EnsureLoggedOut>
							<Login />
						</EnsureLoggedOut>
					</EnsureUserExists>
				),
			},
			{
				path: 'onboarding',
				children: [
					{
						index: true,
						element: (
							<EnsureUserDoesntExist>
								<OnboardingStart />
							</EnsureUserDoesntExist>
						),
					},
					{
						path: '1-create-account',
						element: (
							<EnsureUserDoesntExist>
								<CreateAccount />
							</EnsureUserDoesntExist>
						),
					},
					{
						path: '2-account-created',
						element: (
							<EnsureLoggedIn>
								<AccountCreated />
							</EnsureLoggedIn>
						),
					},
				],
			},
			{
				path: 'migrate',
				element: (
					<EnsureLoggedIn>
						<Migrate />
					</EnsureLoggedIn>
				),
			},
			{
				path: 'migrate/success',
				element: (
					<EnsureLoggedIn>
						<MigrateSuccess />
					</EnsureLoggedIn>
				),
			},
			{
				path: 'migrate/failed',
				element: (
					<EnsureLoggedIn>
						<MigrateFailed />
					</EnsureLoggedIn>
				),
			},
		],
	},

	// demo/test
	{
		path: '/',
		Component: Demo,
		errorElement: <ErrorBoundary />,
		children: [
			{
				path: 'one',
				Component: One,
			},
			{
				path: 'two',
				Component: Two,
			},
		],
	},
	{
		path: 'login-test',
		Component: LoginTest,
	},
	{
		path: '/',
		Component: StoriesLayout,
		errorElement: <ErrorBoundary />,
		children: [
			{
				path: 'stories',
				Component: Stories,
			},
			{
				path: 'stories/app-store',
				element: (
					<AvailableAppsProvider>
						<AppStoreStory />
					</AvailableAppsProvider>
				),
			},
			{
				path: 'stories/settings',
				Component: SettingsStory,
			},
			{
				path: 'stories/trpc',
				Component: Trpc,
			},
			{
				path: 'stories/input',
				Component: InputExamples,
			},
			{
				path: 'stories/color-thief',
				Component: ColorThiefExample,
			},
			{
				path: 'stories/error',
				Component: ErrorStory,
			},
			{
				path: 'stories/desktop',
				// Component: DesktopStory,
				element: (
					<AvailableAppsProvider>
						<DesktopStory />
					</AvailableAppsProvider>
				),
			},
			{
				path: 'stories/cmdk',
				element: (
					<AvailableAppsProvider>
						<CmdkStory />
					</AvailableAppsProvider>
				),
			},
			{
				path: 'stories/sheet',
				element: <SheetStory />,
			},
			{
				path: 'stories/migrate',
				Component: MigrateStory,
			},
			{
				path: 'stories/tailwind',
				Component: TailwindStory,
			},
		],
	},
])

function ErrorBoundary() {
	const error = useRouteError()
	const {resetBoundary} = useErrorBoundary()
	// console.error(error)
	return (
		<CoverMessage>
			<div className=''>
				<h1 className='font-semibold text-destructive2-lightest'>⚠ Dang!</h1>
				<p className='max-w-sm text-13'>{error instanceof Error ? error.message : 'Unexpected error'}</p>
				<Button variant='secondary' size='sm' className='mt-2' onClick={resetBoundary}>
					Try Again
				</Button>
			</div>
		</CoverMessage>
	)
}
