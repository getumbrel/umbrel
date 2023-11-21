import React, {Suspense} from 'react'
import {useTranslation} from 'react-i18next'

import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'

import {SettingsContent} from './_components/settings-content'

const TwoFactorDisableDialog = React.lazy(() => import('@/routes/settings/2fa-disable'))
const TwoFactorEnableDialog = React.lazy(() => import('@/routes/settings/2fa-enable'))
const AppStorePreferencesDialog = React.lazy(() => import('@/routes/settings/app-store-preferences'))
const ChangeNameDialog = React.lazy(() => import('@/routes/settings/change-name'))
const ChangePasswordDialog = React.lazy(() => import('@/routes/settings/change-password'))
const LiveUsageDialog = React.lazy(() => import('@/routes/settings/live-usage'))
const MigrationAssistantDialog = React.lazy(() => import('@/routes/settings/migration-assistant'))
const RestartDialog = React.lazy(() => import('@/routes/settings/restart'))
const ShutdownDialog = React.lazy(() => import('@/routes/settings/shutdown'))
const TroubleshootDialog = React.lazy(() => import('@/routes/settings/troubleshoot'))

const routeToDialog: Record<string, React.ComponentType> = {
	'2fa-disable': TwoFactorDisableDialog,
	'2fa-enable': TwoFactorEnableDialog,
	'app-store-preferences': AppStorePreferencesDialog,
	'change-name': ChangeNameDialog,
	'change-password': ChangePasswordDialog,
	'live-usage': LiveUsageDialog,
	'migration-assistant': MigrationAssistantDialog,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
	troubleshoot: TroubleshootDialog,
}

export function Settings() {
	const {t} = useTranslation()
	useUmbrelTitle(t('settings'))

	const {params} = useQueryParams()
	const dialog = params.get('dialog')
	// Prevent breaking if there's a dialog that is rendered somewhere else and not in this map ("logout", for example)
	const has = (dialog ?? '') in routeToDialog
	const Dialog = has && dialog ? routeToDialog[dialog] : () => null

	return (
		<>
			<SheetHeader>
				<SheetTitle className='text-48 leading-none'>{t('settings')}</SheetTitle>
			</SheetHeader>
			<SettingsContent />
			<Suspense>
				<Dialog />
			</Suspense>
		</>
	)
}
