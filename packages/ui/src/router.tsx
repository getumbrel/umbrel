import {useErrorBoundary} from 'react-error-boundary'
import {createBrowserRouter, useRouteError} from 'react-router-dom'

import {CoverMessage} from './components/ui/cover-message'
import {AvailableAppsProvider} from './hooks/use-available-apps'
import {InstalledAppsProvider} from './hooks/use-installed-apps'
import {AppStoreLayout} from './layouts/app-store'
import {BareLayout} from './layouts/bare/bare'
import {Demo} from './layouts/demo-layout'
import {Desktop} from './layouts/desktop'
import {SettingsLayout} from './layouts/settings'
import {SheetLayout} from './layouts/sheet'
import {StoriesLayout} from './layouts/stories'
import {EnsureLoggedIn} from './modules/auth/ensure-logged-in'
import {AppPage} from './routes/app-store/app-page'
import {CategoryPage} from './routes/app-store/category-page'
import {Discover} from './routes/app-store/discover'
import {CommunityAppStoreHome} from './routes/community-app-store'
import {CommunityAppPage} from './routes/community-app-store/app-page'
import {One} from './routes/demo/one'
import {Two} from './routes/demo/two'
import {EditWidgetsPage} from './routes/edit-widgets'
import {InstallFirstApp} from './routes/install-first-app'
import {Login} from './routes/login'
import {LoginTest} from './routes/login-test'
import {Migrate} from './routes/migrate'
import {MigrateFailed} from './routes/migrate/migrate-failed'
import {MigrateSuccess} from './routes/migrate/migrate-success'
import {OnboardingStart} from './routes/onboarding'
import {CreateAccount} from './routes/onboarding/1-create-account'
import {AccountCreated} from './routes/onboarding/2-account-created'
import {TwoFactorDisableDialog} from './routes/settings/2fa-disable'
import {TwoFactorEnableDialog} from './routes/settings/2fa-enable'
import {AppStorePreferencesDialog} from './routes/settings/app-store-preferences'
import {ChangeNameDialog} from './routes/settings/change-name'
import {ChangePasswordDialog} from './routes/settings/change-password'
import {LiveUsageDialog} from './routes/settings/live-usage'
import {MigrationAssistantDialog} from './routes/settings/migration-assistant'
import {RestartDialog} from './routes/settings/restart'
import {ShutdownDialog} from './routes/settings/shutdown'
import {TroubleshootDialog} from './routes/settings/troubleshoot'
import {Stories} from './routes/stories'
import {AppStoreStory} from './routes/stories/app-store'
import {CmdkStory} from './routes/stories/cmdk'
import {ColorThiefExample} from './routes/stories/color-thief'
import {DesktopStory} from './routes/stories/desktop'
import {ErrorStory} from './routes/stories/error'
import {InputExamples} from './routes/stories/input'
import {MigrateStory} from './routes/stories/migrate'
import {SettingsStory} from './routes/stories/settings'
import {SheetStory} from './routes/stories/sheet'
import {Trpc} from './routes/stories/trpc'
import {Button} from './shadcn-components/ui/button'

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	{
		path: 'install-first-app',
		Component: InstallFirstApp,
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
						Component: SettingsLayout,
						children: [
							// top section
							{
								path: 'troubleshoot',
								Component: TroubleshootDialog,
							},
							{
								path: 'restart',
								Component: RestartDialog,
							},
							{
								path: 'shutdown',
								Component: ShutdownDialog,
							},
							// left
							{
								path: 'live-usage',
								Component: LiveUsageDialog,
							},
							// right
							{
								path: 'change-name',
								Component: ChangeNameDialog,
							},
							{
								path: 'change-password',
								Component: ChangePasswordDialog,
							},
							{
								path: '2fa-enable',
								Component: TwoFactorEnableDialog,
							},
							{
								path: '2fa-disable',
								Component: TwoFactorDisableDialog,
							},
							{
								path: 'migration-assistant',
								Component: MigrationAssistantDialog,
							},
							{
								path: 'app-store-preferences',
								Component: AppStorePreferencesDialog,
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
				Component: Login,
			},
			{
				path: 'onboarding',
				Component: OnboardingStart,
			},
			{
				path: 'onboarding/1-create-account',
				Component: CreateAccount,
			},
			{
				path: 'onboarding/2-account-created',
				Component: AccountCreated,
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
