import {Close} from '@radix-ui/react-dialog'
import {ReactNode} from 'react'

import {AppIcon} from '@/components/app-icon'
import {useAllAvailableApps} from '@/providers/available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'

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
	const {appsKeyed, isLoading} = useAllAvailableApps()
	const app = appsKeyed?.[appId]

	if (isLoading) return null
	if (!app) throw new Error(t('app-not-found', {app: appId}))

	const appName = app?.name
	const toUninstallApps = toInstallFirstIds.map((id) => appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('app.uninstall.deps.used-by.title', {app: appName})}</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{toUninstallApps.map((app) => (
						<AppWithName key={app.id} icon={app.icon} appName={app.name} />
					))}
				</div>
				<DialogDescription>
					{/* i18n-ally-key-missing expected, but the key exists */}
					{t('app.uninstall.deps.used-by.description', {
						count: toUninstallApps.length,
						app: appName,
						firstAppToUninstall: toUninstallApps[0].name,
					})}
				</DialogDescription>
				<DialogFooter>
					<Close asChild>
						<Button variant='primary' size='dialog'>
							{t('ok')}
						</Button>
					</Close>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function AppWithName({icon, appName}: {icon: string; appName: ReactNode}) {
	return (
		<div className='flex w-full items-center gap-2.5'>
			<AppIcon src={icon} size={36} className='rounded-8' />
			<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<h3 className='truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
			</div>
		</div>
	)
}
