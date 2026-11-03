import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {pollStates, useAppInstall} from '@/hooks/use-app-install'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'

import {useAppUninstall} from './use-app-uninstall'

export function UninstallTheseFirstDialog({
	open,
	onOpenChange,
	appId,
	toUninstallFirstIds: toInstallFirstIds,
}: {
	appId: string
	toUninstallFirstIds: string[]
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const {t} = useTranslation()
	const {appsKeyed, isLoading} = useAllAvailableApps()
	const {userAppsKeyed, isLoading: isUserAppsLoading} = useApps()
	// The registry is only a fallback: an installed app can be gone from every
	// app store while still blocking the uninstall
	const app = userAppsKeyed?.[appId] ?? appsKeyed?.[appId]

	if (isLoading || isUserAppsLoading) return null
	if (!app) throw new Error(t('app-not-found', {app: appId}))

	const appName = app?.name
	const toUninstallApps = toInstallFirstIds.flatMap((id) => userAppsKeyed?.[id] ?? appsKeyed?.[id] ?? [])
	if (toUninstallApps.length === 0) return null

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					{/* Same identity treatment as the uninstall confirmation, minus the
					    trash badge — this dialog itself deletes nothing */}
					<div className='relative mx-auto mt-1 w-fit'>
						<AppIcon src={app.icon} size={64} className='rounded-15' />
					</div>
					<AlertDialogTitle>{t('app.uninstall.deps.used-by.title', {app: appName})}</AlertDialogTitle>
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6 text-left'>
						{toUninstallApps.map((dependent) => (
							<DependentRow key={dependent.id} appId={dependent.id} icon={dependent.icon} name={dependent.name} />
						))}
					</div>
					<AlertDialogDescription>
						{toUninstallApps.length === 1
							? t('app.uninstall.deps.used-by.description-single', {
									app: appName,
									firstAppToUninstall: toUninstallApps[0].name,
								})
							: t('app.uninstall.deps.used-by.description-multiple', {app: appName})}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='primary' onClick={() => onOpenChange(false)}>
						{t('ok')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

// A blocking app with its own inline uninstall. The button runs the dependent's
// full uninstall flow (confirmation, and its own blockers if it has any), the
// row reports progress, and the parent's live filtering removes the row when
// the uninstall completes — chaining into the main app's confirmation once the
// last blocker is gone.
function DependentRow({appId, icon, name}: {appId: string; icon?: string; name: string}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(appId)
	const {promptUninstall, dialogs} = useAppUninstall(appId, appInstall)
	const state = appInstall.state
	const transitioning = state !== 'loading' && arrayIncludes(pollStates, state)

	return (
		<div className='flex h-[50px] items-center justify-between gap-2.5 px-3'>
			<span className='flex min-w-0 flex-1 items-center gap-2.5'>
				<AppIcon src={icon} size={26} className='shrink-0 rounded-6' />
				<span className='min-w-0 truncate text-14 font-medium'>{name}</span>
			</span>
			<Button size='sm' disabled={transitioning} onClick={promptUninstall}>
				{transitioning ? appStateToString(state, t) + '…' : t('app.uninstall.confirm.submit')}
			</Button>
			{dialogs}
		</div>
	)
}
