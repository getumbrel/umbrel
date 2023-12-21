import {Close} from '@radix-ui/react-dialog'
import {ReactNode} from 'react'
import {Link, To} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

import {UMBREL_APP_STORE_ID} from './constants'

export function InstallTheseFirstDialog({
	open,
	onOpenChange,
	appId,
	registryId = UMBREL_APP_STORE_ID,
	toInstallFirstIds,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	appId: string
	registryId?: string
	toInstallFirstIds: string[]
}) {
	const appsQ = trpcReact.appStore.registry.useQuery()
	const apps = appsQ.data?.find((repo) => repo?.meta.id === registryId)?.apps ?? []
	const appsKeyed = keyBy(apps, 'id')
	const app = apps?.find((app) => app.id === appId)

	if (appsQ.isLoading) return null
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
