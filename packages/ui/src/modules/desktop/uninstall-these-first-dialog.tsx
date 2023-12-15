import {Close} from '@radix-ui/react-dialog'
import {ReactNode} from 'react'

import {AppIcon} from '@/components/app-icon'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'

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
	const {appsKeyed, isLoading} = useAvailableApps()
	const app = appsKeyed?.[appId]

	if (isLoading) return null
	if (!app) throw new Error('App not found')

	const appName = app?.name
	const toUninstallApps = toInstallFirstIds.map((id) => appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{appName} is used by</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{toUninstallApps.map((app) => (
						<AppWithName key={app.id} icon={app.icon} appName={app.name} />
					))}
				</div>
				<DialogDescription>Uninstall these first to uninstall {appName}.</DialogDescription>
				<DialogFooter>
					<Close asChild>
						<Button variant='primary' size='dialog'>
							Ok
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
