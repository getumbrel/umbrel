import React, {Suspense} from 'react'
import {useTranslation} from 'react-i18next'
import {toast} from 'sonner'

import {DebugOnly} from '@/components/ui/debug-only'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {trpcReact} from '@/trpc/trpc'
import {useBreakpoint} from '@/utils/tw'

import ConfirmEnableTorDialog from './confirm-enable-tor'
import DeviceInfoDialog from './device-info'

// import {SettingsContent} from './_components/settings-content'
const SettingsContent = React.lazy(() =>
	import('./_components/settings-content').then((m) => ({default: m.SettingsContent})),
)
const SettingsContentMobile = React.lazy(() =>
	import('./_components/settings-content-mobile').then((m) => ({default: m.SettingsContentMobile})),
)

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
	'confirm-enable-tor': ConfirmEnableTorDialog,
	'device-info': DeviceInfoDialog,
	restart: RestartDialog,
	shutdown: ShutdownDialog,
	troubleshoot: TroubleshootDialog,
}

export function Settings() {
	const {t} = useTranslation()
	const title = t('settings')
	useUmbrelTitle(title)

	const {params} = useQueryParams()
	const dialog = params.get('dialog')
	// Prevent breaking if there's a dialog that is rendered somewhere else and not in this map ("logout", for example)
	const has = (dialog ?? '') in routeToDialog
	const Dialog = has && dialog ? routeToDialog[dialog] : () => null

	const breakpoint = useBreakpoint()

	return (
		<>
			<SheetHeader className='px-2.5'>
				<SheetTitle className='leading-none'>{title}</SheetTitle>
			</SheetHeader>
			{(breakpoint === 'sm' || breakpoint === 'md') && <SettingsContentMobile />}
			{breakpoint !== 'sm' && breakpoint !== 'md' && <SettingsContent />}
			<DebugOnly>
				<ExportOnlyActions />
			</DebugOnly>
			<Suspense>
				<Dialog />
			</Suspense>
		</>
	)
}

function ExportOnlyActions() {
	const ctx = trpcReact.useContext()
	const uinstallAllMut = trpcReact.user.apps.uninstallAll.useMutation({
		onSuccess: () => {
			toast.success('All apps uninstalled')
			ctx.user.apps.invalidate()
		},
	})

	return (
		<div>
			<Button
				onClick={() => {
					uinstallAllMut.mutate()
				}}
			>
				Uninstall all apps
			</Button>
		</div>
	)
}
