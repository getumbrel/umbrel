import {Close} from '@radix-ui/react-dialog'
import {ReactNode} from 'react'
import {Link, To} from 'react-router-dom'

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
	const availableApps = useAllAvailableApps()
	const app = availableApps.appsKeyed?.[appId]

	if (availableApps.isLoading) return null
	if (!app) throw new Error('App not found')

	const appName = app?.name
	const toInstallApps = toInstallFirstIds.map((id) => availableApps.appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('install-first.title', {app: appName})}</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{toInstallApps.map((app) => (
						<AppWithName
							key={app.id}
							icon={app.icon}
							appName={app.name}
							// TODO: link to community app store if needed
							to={`/app-store/${app.id}`}
							onClick={() => onOpenChange(false)}
						/>
					))}
				</div>
				<DialogDescription>{t('install-first.description', {app: appName})}</DialogDescription>
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

function AppWithName({icon, appName, to, onClick}: {icon: string; appName: ReactNode; to: To; onClick?: () => void}) {
	return (
		<div className='flex w-full items-center gap-2.5'>
			<AppIcon src={icon} size={36} className='rounded-8' />

			<h3 className='flex-1 truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
			<Link to={to} className='font-medium text-brand-lighter' onClick={onClick}>
				{t('app.install')}
			</Link>
		</div>
	)
}
