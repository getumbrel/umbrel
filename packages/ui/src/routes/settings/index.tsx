import React, {Suspense} from 'react'
import {Route, Routes} from 'react-router-dom'
import {keys} from 'remeda'
import {arrayIncludes} from 'ts-extras'

import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {t} from '@/utils/i18n'
import {IS_ANDROID} from '@/utils/misc'

// import {SettingsContent} from './_components/settings-content'
const SettingsContent = React.lazy(() =>
	import('./_components/settings-content').then((m) => ({default: m.SettingsContent})),
)
const SettingsContentMobile = React.lazy(() =>
	import('./_components/settings-content-mobile').then((m) => ({default: m.SettingsContentMobile})),
)

const AppStorePreferencesDialog = React.lazy(() => import('@/routes/settings/app-store-preferences'))
const ChangeNameDialog = React.lazy(() => import('@/routes/settings/change-name'))
const ChangePasswordDialog = React.lazy(() => import('@/routes/settings/change-password'))
const MigrationAssistantDialog = React.lazy(() => import('@/routes/settings/migration-assistant'))
const RestartDialog = React.lazy(() => import('@/routes/settings/restart'))
const ShutdownDialog = React.lazy(() => import('@/routes/settings/shutdown'))
const TroubleshootDialog = React.lazy(() => import('@/routes/settings/troubleshoot'))
const ConfirmEnableTorDialog = React.lazy(() => import('@/routes/settings/tor'))
const DeviceInfoDialog = React.lazy(() => import('@/routes/settings/device-info'))
const TwoFactorEnableDialog = React.lazy(() => import('@/routes/settings/2fa-enable'))
const TwoFactorDisableDialog = React.lazy(() => import('@/routes/settings/2fa-disable'))
// drawers
const StartMigrationDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/start-migration').then((m) => ({default: m.StartMigrationDrawer})),
)
const AccountDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/account').then((m) => ({default: m.AccountDrawer})),
)
const WallpaperDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/wallpaper').then((m) => ({default: m.WallpaperDrawer})),
)
const LanguageDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/language').then((m) => ({default: m.LanguageDrawer})),
)
const TorDrawer = React.lazy(() => import('@/routes/settings/mobile/tor').then((m) => ({default: m.TorDrawer})))
const AppStorePreferencesDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/app-store-preferences').then((m) => ({
		default: m.AppStorePreferencesDrawer,
	})),
)
const DeviceInfoDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/device-info').then((m) => ({default: m.DeviceInfoDrawer})),
)
const SoftwareUpdateDrawer = React.lazy(() =>
	import('@/routes/settings/mobile/software-update').then((m) => ({default: m.SoftwareUpdateDrawer})),
)

const routeToDialogDesktop = {
	'2fa-enable': TwoFactorEnableDialog,
	'2fa-disable': TwoFactorDisableDialog,
	'app-store-preferences': AppStorePreferencesDialog,
	account: AccountDrawer,
	'change-name': ChangeNameDialog,
	'change-password': ChangePasswordDialog,
	'migration-assistant': MigrationAssistantDialog,
	tor: ConfirmEnableTorDialog,
	'device-info': DeviceInfoDialog,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
	troubleshoot: TroubleshootDialog,
	// Allow drawers in desktop in case someone opens a link to a drawer
	// drawers
	'start-migration': StartMigrationDrawer,
	language: LanguageDrawer,
	wallpaper: WallpaperDrawer,
	'software-update': SoftwareUpdateDrawer,
} as const satisfies Record<string, React.ComponentType>

const dialogKeys = keys.strict(routeToDialogDesktop)

export type SettingsDialogKey = keyof typeof routeToDialogDesktop

const routeToDialogMobile: Record<string, React.ComponentType> = {
	'2fa-enable': TwoFactorEnableDialog,
	'2fa-disable': TwoFactorDisableDialog,
	'app-store-preferences': AppStorePreferencesDrawer,
	account: AccountDrawer,
	'change-name': AccountDrawer,
	'change-password': AccountDrawer,
	'migration-assistant': MigrationAssistantDialog,
	'device-info': DeviceInfoDrawer,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
	troubleshoot: TroubleshootDialog,
	// drawers
	'start-migration': StartMigrationDrawer,
	language: LanguageDrawer,
	wallpaper: WallpaperDrawer,
	tor: TorDrawer,
	'software-update': SoftwareUpdateDrawer,
} as const satisfies Record<SettingsDialogKey, React.ComponentType>

function Dialog() {
	const isMobile = useIsMobile() && !IS_ANDROID
	const routeToDialog = isMobile ? routeToDialogMobile : routeToDialogDesktop

	const {params} = useQueryParams()
	const dialog = params.get('dialog')

	// Prevent breaking if there's a dialog that is rendered somewhere else and not in this map ("logout", for example)
	const has = dialog && arrayIncludes(dialogKeys, dialog)
	const Component = has && dialog ? routeToDialog[dialog] : () => null

	return <Component />
}

export function Settings() {
	const title = t('settings')

	const isMobile = useIsMobile() && !IS_ANDROID

	return (
		<>
			<SheetHeader className='px-2.5'>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<SheetTitle className='leading-none'>{title}</SheetTitle>
			</SheetHeader>
			{isMobile && <SettingsContentMobile />}
			{!isMobile && <SettingsContent />}
			<Routes>
				<Route path='/2fa/enable' Component={TwoFactorEnableDialog} />
				<Route path='/2fa/disable' Component={TwoFactorDisableDialog} />
			</Routes>
			<Suspense>
				<Dialog />
			</Suspense>
		</>
	)
}
