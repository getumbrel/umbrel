// Route structure:
// - routes/ contains page-level components mapped to URL paths
// - modules/ contains reusable UI compositions shared across routes (app-store, desktop, auth, etc.)
// - features/ may colocate their own route definitions (e.g., files/routes.tsx) when they own an entire route subtree

import React, {Suspense} from 'react'
import {createBrowserRouter, Outlet} from 'react-router-dom'

import {CmdkMenu, CmdkProvider} from '@/components/cmdk'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {appStoreRoutes} from '@/features/app-store/routes'
import {filesRoutes} from '@/features/files/routes'
import {machinesConsoleRoutes, machinesRoutes} from '@/features/machines/routes'
import {photosRoutes} from '@/features/photos/routes'
import {DesktopContextMenu} from '@/modules/desktop/desktop-context-menu'

import {ErrorBoundaryPageFallback} from './components/ui/error-boundary-page-fallback'
import {BareLayout} from './layouts/bare/bare'
import {OnboardingLayout} from './layouts/bare/onboarding'
import {Desktop} from './layouts/desktop'
import {SheetLayout} from './layouts/sheet'
import {EnsureLoggedIn, EnsureLoggedOut} from './modules/auth/ensure-logged-in'
import {EnsureNoRaidMountFailure} from './modules/auth/ensure-no-raid-mount-failure'
import {EnsureProDevice} from './modules/auth/ensure-pro-device'
import {EnsureUserDoesntExist, EnsureUserExists} from './modules/auth/ensure-user-exists'
import {Dock, DockBottomPositioner} from './modules/desktop/dock'
import {NavigationShortcuts} from './modules/desktop/navigation-shortcuts'
import {FloatingIslandContainer} from './modules/floating-island/container'
import {GlobalDialogs} from './modules/global-dialogs'
import {AppsProvider, AppStatePolling} from './providers/apps'
import {AvailableAppsProvider} from './providers/available-apps'
import {CloudActivityProvider} from './providers/cloud'
import {GlobalFilesProvider} from './providers/global-files'
import {Wallpaper} from './providers/wallpaper'
import {NotFound} from './routes/not-found'
import {Notifications} from './routes/notifications'
import {Settings} from './routes/settings'

const CommunityAppStoreHome = React.lazy(() => import('./routes/community-app-store'))
const CommunityAppPage = React.lazy(() => import('./routes/community-app-store/app-page'))
const EditWidgetsPage = React.lazy(() => import('./routes/edit-widgets'))
const Login = React.lazy(() => import('./routes/login'))
const OnboardingStart = React.lazy(() => import('./routes/onboarding'))
const CreateAccount = React.lazy(() => import('./routes/onboarding/create-account'))
const ExternalDriveChoice = React.lazy(() => import('./routes/onboarding/external-drive'))
const AccountCreated = React.lazy(() => import('./routes/onboarding/account-created'))
const Raid = React.lazy(() => import('./routes/onboarding/raid'))
const RaidSetup = React.lazy(() => import('./routes/onboarding/raid/setup'))
const HddRaid = React.lazy(() => import('./routes/onboarding/hdd-raid'))
const HddRaidSetup = React.lazy(() => import('./routes/onboarding/hdd-raid/setup'))
const FactoryReset = React.lazy(() => import('./routes/factory-reset'))
const OnboardingRestore = React.lazy(() => import('./routes/onboarding/restore'))
const RaidError = React.lazy(() => import('./routes/raid-error'))
const ConfirmStaticIp = React.lazy(() => import('./routes/confirm-static-ip'))

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	// desktop
	{
		path: '/',
		element: (
			<EnsureNoRaidMountFailure>
				<EnsureLoggedIn>
					{/* These providers open authenticated file-operation and cloud-activity subscriptions, so they must not mount on login/onboarding routes. */}
					<GlobalFilesProvider>
						<CloudActivityProvider>
							<Wallpaper />
							{/* Get any notifications from umbreld and render them as alert dialogs */}
							<Notifications />
							<AvailableAppsProvider>
								<AppsProvider>
									<AppStatePolling />
									<CmdkProvider>
										<DesktopContextMenu>
											<Desktop />
										</DesktopContextMenu>
										<CmdkMenu />
										{/* Alt/Option+letter dock shortcuts; inside CmdkProvider so they stand down while the palette is open */}
										<NavigationShortcuts />
									</CmdkProvider>
									<Suspense>
										<Outlet />
									</Suspense>
									<GlobalDialogs />
									<FloatingIslandContainer />
									<DockBottomPositioner>
										<Dock />
									</DockBottomPositioner>
								</AppsProvider>
							</AvailableAppsProvider>
						</CloudActivityProvider>
					</GlobalFilesProvider>
				</EnsureLoggedIn>
			</EnsureNoRaidMountFailure>
		),
		ErrorBoundary: ErrorBoundaryPageFallback,
		children: [
			{
				path: 'edit-widgets',
				Component: EditWidgetsPage,
				ErrorBoundary: ErrorBoundaryCardFallback,
			},
			...machinesRoutes,
			{
				Component: SheetLayout,
				children: [
					...filesRoutes,
					...photosRoutes,
					// The root desktop tree already mounts AvailableAppsProvider, so
					// app-store routes consume it without nesting another provider
					...appStoreRoutes,
					{
						path: 'community-app-store/:appStoreId',
						children: [
							{
								index: true,
								Component: CommunityAppStoreHome,
								ErrorBoundary: ErrorBoundaryCardFallback,
							},
							{
								path: ':appId',
								Component: CommunityAppPage,
								ErrorBoundary: ErrorBoundaryCardFallback,
							},
						],
					},
					{
						path: 'settings/*',
						Component: Settings,
						ErrorBoundary: ErrorBoundaryCardFallback,
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

	// machines fullscreen console: minimal-chrome VM view opened in a new tab
	...machinesConsoleRoutes,

	// raid-error: shown when RAID mount fails (storage system unavailable)
	{
		path: '/raid-error',
		element: <RaidError />,
		ErrorBoundary: ErrorBoundaryPageFallback,
	},

	// confirm-static-ip: public route opened in a new tab at the new IP during static IP setup.
	// Loading successfully proves the new IP is reachable; the page then calls `system.confirmStaticIp`
	// (which must be public) to unblock the pending `setStaticIp` mutation on the original tab.
	{
		path: '/confirm-static-ip',
		element: <ConfirmStaticIp />,
		ErrorBoundary: ErrorBoundaryPageFallback,
	},

	...(import.meta.env.DEV ? [] : []),

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
			// Raspberry Pi with an external drive attached: choose where data lives
			{
				path: 'external-drive',
				element: (
					<EnsureUserDoesntExist>
						<ExternalDriveChoice />
					</EnsureUserDoesntExist>
				),
			},
			// Umbrel Pro RAID setup flow
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
			// SSD RAID setup flow (generic devices with internal SSDs)
			{
				path: 'ssd-raid',
				element: (
					<EnsureUserDoesntExist>
						<Raid variant='generic' />
					</EnsureUserDoesntExist>
				),
			},
			{
				// No EnsureUserDoesntExist guard: setup spans the reboot that creates the user.
				path: 'ssd-raid/setup',
				element: <RaidSetup variant='generic' />,
			},
			// HDD RAID setup flow (generic devices with internal hard drives)
			{
				path: 'hdd-raid',
				element: (
					<EnsureUserDoesntExist>
						<HddRaid />
					</EnsureUserDoesntExist>
				),
			},
			{
				// No EnsureUserDoesntExist guard for the same reason as raid/setup above:
				// setup spans the reboot that creates the user. The component protects itself
				// by checking for credentials in location.state and redirecting if missing.
				path: 'hdd-raid/setup',
				element: <HddRaidSetup />,
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
