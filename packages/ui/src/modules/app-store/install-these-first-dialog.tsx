import {Close} from '@radix-ui/react-dialog'
import {ReactNode} from 'react'
import {Link, To} from 'react-router-dom'

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

export function InstallTheseFirstDialog({
	open,
	onOpenChange,
	appId,
	toInstallFirstIds,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	appId: string
	toInstallFirstIds: string[]
}) {
	const {appsKeyed, isLoading} = useAvailableApps()
	const app = appsKeyed?.[appId]

	if (isLoading) return null
	if (!app) throw new Error('App not found')

	const appName = app?.name
	const toInstallApps = toInstallFirstIds.map((id) => appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{appName} requires access to</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{toInstallApps.map((app) => (
						<AppWithName
							key={app.id}
							icon={app.icon}
							appName={app.name}
							to={`/app-store/${app.id}`}
							onClick={() => onOpenChange(false)}
						/>
					))}
				</div>
				<DialogDescription>Install these first to install {appName}.</DialogDescription>
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

function AppWithName({icon, appName, to, onClick}: {icon: string; appName: ReactNode; to: To; onClick?: () => void}) {
	return (
		<div className='flex w-full items-center gap-2.5'>
			<AppIcon src={icon} size={36} className='rounded-8' />

			<h3 className='flex-1 truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
			<Link to={to} className='font-medium text-brand-lighter' onClick={onClick}>
				Install
			</Link>
		</div>
	)
}
