import React, {Suspense} from 'react'
import {createBrowserRouter, Outlet} from 'react-router-dom'

import {ErrorBoundary} from './components/ui/error-boundary'
import {AppStoreLayout} from './layouts/app-store'
import {BareLayout} from './layouts/bare/bare'
import {Demo} from './layouts/demo-layout'
import {Desktop} from './layouts/desktop'
import {SheetLayout} from './layouts/sheet'
import {StoriesLayout} from './layouts/stories'
import {EnsureLoggedIn, EnsureLoggedOut} from './modules/auth/ensure-logged-in'
import {EnsureUserDoesntExist, EnsureUserExists} from './modules/auth/ensure-user-exists'
import {BlurBelowDock} from './modules/desktop/blur-below-dock'
import {Dock, DockBottomPositioner} from './modules/desktop/dock'
import {AppsProvider} from './providers/apps'
import {AvailableAppsProvider} from './providers/available-apps'
import {Wallpaper} from './providers/wallpaper'
import {NotFound} from './routes/not-found'
import {Settings} from './routes/settings'

const AppPage = React.lazy(() => import('./routes/app-store/app-page'))
const CategoryPage = React.lazy(() => import('./routes/app-store/category-page'))
const Discover = React.lazy(() => import('./routes/app-store/discover'))
const CommunityAppStoreHome = React.lazy(() => import('./routes/community-app-store'))
const CommunityAppPage = React.lazy(() => import('./routes/community-app-store/app-page'))
const One = React.lazy(() => import('./routes/demo/one'))
const Two = React.lazy(() => import('./routes/demo/two'))
const EditWidgetsPage = React.lazy(() => import('./routes/edit-widgets'))
const Login = React.lazy(() => import('./routes/login'))
const LoginWithUmbrel = React.lazy(() => import('./routes/login-with-umbrel'))
const LoginTest = React.lazy(() => import('./routes/login-test'))
const Migrate = React.lazy(() => import('./routes/migrate'))
const MigrateFailed = React.lazy(() => import('./routes/migrate/migrate-failed'))
const MigrateSuccess = React.lazy(() => import('./routes/migrate/migrate-success'))
const OnboardingStart = React.lazy(() => import('./routes/onboarding'))
const CreateAccount = React.lazy(() => import('./routes/onboarding/1-create-account'))
const AccountCreated = React.lazy(() => import('./routes/onboarding/2-account-created'))
const Stories = React.lazy(() => import('./routes/stories'))
const FactoryReset = React.lazy(() => import('./routes/factory-reset'))
const RestartTest = React.lazy(() => import('./routes/restart-test'))
const SpecificStory = React.lazy(() => import('./layouts/stories').then((m) => ({default: m.SpecificStory})))

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	// desktop
	{
		path: '/',
		element: (
			<EnsureLoggedIn>
				<Wallpaper />
				<AvailableAppsProvider>
					<AppsProvider>
						<Desktop />
						<Suspense>
							<Outlet />
						</Suspense>
						{/* Putting `BlurBelowDock` after `AppGridGradientMasking` because we don't want layering issues  */}
						<BlurBelowDock />
						<DockBottomPositioner>
							<Dock />
						</DockBottomPositioner>
					</AppsProvider>
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
						path: 'settings/*',
						Component: Settings,
						children: [
							{
								path: ':settingsDialog',
							},
						],
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
				path: 'login-with-umbrel/:appId',
				element: (
					<EnsureUserExists>
						<AppsProvider>
							{/* <EnsureLoggedIn> */}
							<LoginWithUmbrel />
							{/* </EnsureLoggedIn> */}
						</AppsProvider>
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
			{
				path: 'factory-reset/*',
				element: <FactoryReset />,
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
		path: 'restart-test',
		Component: RestartTest,
	},
	{
		path: '/',
		Component: StoriesLayout,
		errorElement: <ErrorBoundary />,
		children: [
			{
				path: 'stories',
				Component: Stories,
				index: true,
			},
			{
				path: 'stories/*',
				Component: SpecificStory,
			},
		],
	},

	{
		path: '*',
		Component: NotFound,
	},
])
