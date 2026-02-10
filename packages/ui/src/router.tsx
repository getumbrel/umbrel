import React, {Suspense} from 'react'
import {createBrowserRouter, Outlet} from 'react-router-dom'

import {CmdkMenu, CmdkProvider} from '@/components/cmdk'
import {ErrorBoundaryComponentFallback} from '@/components/ui/error-boundary-component-fallback'
import {filesRoutes} from '@/features/files/routes'
import {DesktopContextMenu} from '@/modules/desktop/desktop-context-menu'

import {ErrorBoundaryPageFallback} from './components/ui/error-boundary-page-fallback'
import {AppStoreLayout} from './layouts/app-store'
import {BareLayout} from './layouts/bare/bare'
import {OnboardingLayout} from './layouts/bare/onboarding'
import {Desktop} from './layouts/desktop'
import {SheetLayout} from './layouts/sheet'
import {EnsureLoggedIn, EnsureLoggedOut} from './modules/auth/ensure-logged-in'
import {EnsureNoRaidMountFailure} from './modules/auth/ensure-no-raid-mount-failure'
import {EnsureProDevice} from './modules/auth/ensure-pro-device'
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
const Raid = React.lazy(() => import('./routes/onboarding/raid'))
const RaidSetup = React.lazy(() => import('./routes/onboarding/raid/setup'))
const FactoryReset = React.lazy(() => import('./routes/factory-reset'))
const OnboardingRestore = React.lazy(() => import('./routes/onboarding/restore'))
const RaidError = React.lazy(() => import('./routes/raid-error'))

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	// desktop
	{
		path: '/',
		element: (
			<EnsureNoRaidMountFailure>
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
			</EnsureNoRaidMountFailure>
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

	// bare: layout with user's own wallpaper (blurred) and no card
	// Used for returning users (login) and system actions (factory reset)
	{
		path: '/',
		Component: BareLayout,
		ErrorBoundary: ErrorBoundaryPageFallback,
		children: [
			{
				path: 'login',
				element: (
					<EnsureNoRaidMountFailure>
						<EnsureUserExists>
							<EnsureLoggedOut>
								<Login />
							</EnsureLoggedOut>
						</EnsureUserExists>
					</EnsureNoRaidMountFailure>
				),
			},
			{
				path: 'factory-reset/*',
				element: <FactoryReset />,
			},
		],
	},

	// raid-error: shown when RAID mount fails (storage system unavailable)
	{
		path: '/raid-error',
		element: <RaidError />,
		ErrorBoundary: ErrorBoundaryPageFallback,
	},

	// onboarding: branded first-time setup experience
	// Pro/Home: Video background, Other devices: Static wallpaper
	{
		path: '/onboarding',
		element: (
			<EnsureNoRaidMountFailure>
				<OnboardingLayout />
			</EnsureNoRaidMountFailure>
		),
		ErrorBoundary: ErrorBoundaryPageFallback,
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
			// RAID setup flow (Pro only)
			// TODO: will require changes once RAID is available on custom amd64 devices.
			{
				path: 'raid',
				element: (
					<EnsureUserDoesntExist>
						<EnsureProDevice>
							<Raid />
						</EnsureProDevice>
					</EnsureUserDoesntExist>
				),
			},
			{
				// IMPORTANT: No EnsureUserDoesntExist guard here.
				// Unlike other onboarding routes, RAID setup spans a device reboot:
				// 1. User fills form (user doesn't exist yet)
				// 2. Backend sets up ZFS pool and reboots
				// 3. After reboot, backend creates user from saved credentials
				// 4. Frontend polls for user.exists, then shows success page
				// If we used EnsureUserDoesntExist, step 4 would redirect to /login
				// before showing the success page. The component protects itself by
				// checking for credentials in React Router's location.state and redirecting if missing.
				path: 'raid/setup',
				element: (
					<EnsureProDevice>
						<RaidSetup />
					</EnsureProDevice>
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
		path: '*',
		Component: NotFound,
	},
])
