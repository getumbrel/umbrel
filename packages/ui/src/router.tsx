import {createBrowserRouter} from 'react-router-dom'

import {AvailableAppsProvider} from './hooks/use-available-apps'
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
import {TwoFactorDialog} from './routes/settings/2fa'
import {AppStorePreferencesDialog} from './routes/settings/app-store-preferences'
import {ChangeNameDialog} from './routes/settings/change-name'
import {ChangePasswordDialog} from './routes/settings/change-password'
import {LiveUsageDialog} from './routes/settings/live-usage'
import {MigrationAssistantDialog} from './routes/settings/migration-assistant'
import {RestartDialog} from './routes/settings/restart'
import {ShutdownDialog} from './routes/settings/shutdown'
import {TroubleshootDialog} from './routes/settings/troubleshoot'
import {Stories} from './routes/stories'
import {ColorThiefExample} from './routes/stories/color-thief'
import {InputExamples} from './routes/stories/input'
import {Trpc} from './routes/stories/trpc'

// NOTE: consider extracting certain providers into react-router loaders
export const router = createBrowserRouter([
	{
		path: 'install-first-app',
		Component: InstallFirstApp,
	},

	// desktop
	{
		path: '/',
		Component: Desktop,
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
								path: '2fa',
								Component: TwoFactorDialog,
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
		children: [
			{
				path: 'stories',
				Component: Stories,
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
		],
	},
])
