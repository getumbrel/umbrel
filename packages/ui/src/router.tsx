import React, {Suspense} from 'react'
import {createBrowserRouter, Outlet} from 'react-router-dom'

import {CmdkMenu, CmdkProvider} from '@/components/cmdk'
import {ErrorBoundaryComponentFallback} from '@/components/ui/error-boundary-component-fallback'
import {filesRoutes} from '@/features/files/routes'
import {DesktopContextMenu} from '@/modules/desktop/desktop-context-menu'

import {ErrorBoundaryPageFallback} from './components/ui/error-boundary-page-fallback'
import {AppStoreLayout} from './layouts/app-store'
import {BareLayout} from './layouts/bare/bare'
import {Desktop} from './layouts/desktop'
import {SheetLayout} from './layouts/sheet'
import {EnsureLoggedIn, EnsureLoggedOut} from './modules/auth/ensure-logged-in'
import {EnsureUserDoesntExist, EnsureUserExists} from './modules/auth/ensure-user-exists'
import {Dock, DockBottomPositioner} from './modules/desktop/dock'
import {FloatingIslandContainer} from './modules/floating-island/container'
import {AppsProvider} from './providers/apps'
import {AvailableAppsProvider} from './providers/available-apps'
import {Wallpaper} from './providers/wallpaper'
import {NotFound} from './routes/not-found'
import {Notifications} from './routes/notifications'
import {Settings} from './routes/settings'

const AppPage = React.lazy(() => import('./routes/app-store/app-page'))
const CategoryPage = React.lazy(() => import('./routes/app-store/category-page'))
const Discover = React.lazy(() => import('./routes/app-store/discover'))
const CommunityAppStoreHome = React.lazy(() => import('./routes/community-app-store'))
const CommunityAppPage = React.lazy(() => import('./routes/community-app-store/app-page'))
const EditWidgetsPage = React.lazy(() => import('./routes/edit-widgets'))
const Login = React.lazy(() => import('./routes/login'))
const OnboardingStart = React.lazy(() => import('./routes/onboarding'))
const CreateAccount = React.lazy(() => import('./routes/onboarding/create-account'))
const AccountCreated = React.lazy(() => import('./routes/onboarding/account-created'))
const FactoryReset = React.lazy(() => import('./routes/factory-reset'))
const OnboardingRestore = React.lazy(() => import('./routes/onboarding/restore'))

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	// desktop
	{
		path: '/',
		element: (
			<EnsureLoggedIn>
				<Wallpaper />
				{/* Get any notifications from umbreld and render them as alert dialogs */}
				<Notifications />
				<AvailableAppsProvider>
					<AppsProvider>
						<CmdkProvider>
							<DesktopContextMenu>
								<Desktop />
							</DesktopContextMenu>
							<CmdkMenu />
						</CmdkProvider>
						<Suspense>
							<Outlet />
						</Suspense>
						<FloatingIslandContainer />
						<DockBottomPositioner>
							<Dock />
						</DockBottomPositioner>
					</AppsProvider>
				</AvailableAppsProvider>
			</EnsureLoggedIn>
		),
		ErrorBoundary: ErrorBoundaryPageFallback,
		children: [
			{
				path: 'edit-widgets',
				Component: EditWidgetsPage,
				ErrorBoundary: ErrorBoundaryComponentFallback,
			},
			{
				Component: SheetLayout,
				children: [
					...filesRoutes,
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
								ErrorBoundary: ErrorBoundaryComponentFallback,
							},
							{
								path: 'category/:categoryishId',
								Component: CategoryPage,
								ErrorBoundary: ErrorBoundaryComponentFallback,
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
								ErrorBoundary: ErrorBoundaryComponentFallback,
							},
							{
								path: ':appId',
								Component: CommunityAppPage,
								ErrorBoundary: ErrorBoundaryComponentFallback,
							},
						],
					},
					{
						path: 'settings/*',
						Component: Settings,
						children: [
							{
								path: ':settingsDialog',
								Component: Settings,
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
		ErrorBoundary: ErrorBoundaryPageFallback,
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
						path: 'restore',
						element: (
							<EnsureUserDoesntExist>
								<OnboardingRestore />
							</EnsureUserDoesntExist>
						),
					},
					{
						path: 'create-account',
						element: (
							<EnsureUserDoesntExist>
								<CreateAccount />
							</EnsureUserDoesntExist>
						),
					},
					{
						path: 'account-created',
						element: (
							<EnsureLoggedIn>
								<AccountCreated />
							</EnsureLoggedIn>
						),
					},
				],
			},
			{
				path: 'factory-reset/*',
				element: <FactoryReset />,
			},
		],
	},
	{
		path: '*',
		Component: NotFound,
	},
])
