import {Fragment, useState} from 'react'

import {AppIcon} from '@/components/app-icon'
import {LinkButton} from '@/components/ui/link-button'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp, trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'

export function UpdatesButton() {
	const linkToDialog = useLinkToDialog()
	const appsWithUpdates = useAppsWithUpdates()

	// If we link to the updates dialog, show it even if there are no updates
	if (!appsWithUpdates.length) {
		return <UpdatesDialog />
	}

	return (
		<>
			{/* w-auto because 'dialog' size buttons take up full width on mobile */}
			<LinkButton to={linkToDialog('updates')} variant='default' size='dialog' className='relative h-[33px] w-auto'>
				Updates
				<NotificationBadge count={appsWithUpdates.length} />
			</LinkButton>
			<UpdatesDialog />
		</>
	)
}

export function UpdatesDialog() {
	const dialogProps = useDialogOpenProps('updates')

	const title = 'Updates'

	const appsWithUpdates = useAppsWithUpdates()

	const updateAllMut = trpcReact.user.apps.updateAll.useMutation()

	const updateAll = () => updateAllMut.mutate()

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='top-[10%] translate-y-0 p-0 data-[state=closed]:slide-out-to-top-[10%] data-[state=open]:slide-in-from-top-[10%]'>
					<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-2.5 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
							<DialogTitle className='flex flex-row items-center justify-between'>
								{appsWithUpdates.length} updates available{' '}
								<Button
									size='dialog'
									variant='primary'
									onClick={updateAll}
									className='w-auto'
									disabled={updateAllMut.isLoading || appsWithUpdates.length === 0}
								>
									{updateAllMut.isLoading ? 'Updating...' : 'Update all'}
								</Button>
							</DialogTitle>
						</DialogHeader>
						{appsWithUpdates.map((app, i) => (
							<Fragment key={app.id}>
								{i === 0 ? <Separator className='my-2.5' /> : <Separator className='my-1' />}
								<AppItem app={app} />
							</Fragment>
						))}
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

function AppItem({app}: {app: RegistryApp}) {
	const [showAll, setShowAll] = useState(false)
	const updateMut = trpcReact.user.apps.update.useMutation()
	const updateApp = () => updateMut.mutate({appId: app.id})

	return (
		<div>
			<div className='flex items-center gap-2.5'>
				<AppIcon src={app.icon} size={36} className='rounded-8' />
				<div className='flex flex-col'>
					<h3 className='text-13 font-semibold'>{app.name}</h3>
					<p className='text-13 opacity-40'>{app.version}</p>
				</div>
				<div className='flex-1' />
				<Button size='sm' onClick={updateApp} disabled={updateMut.isLoading}>
					{updateMut.isLoading ? 'Updating...' : 'Update'}
				</Button>
			</div>
			{app.releaseNotes && (
				<div className='flex items-end'>
					<div className={cn('relative mt-2.5 text-13 opacity-50 transition-all', !showAll && 'line-clamp-2')}>
						{app.releaseNotes}
					</div>
					<button
						className='bottom-0 right-0 text-13 text-brand underline underline-offset-2'
						onClick={() => setShowAll((s) => !s)}
					>
						{showAll ? 'less' : 'more'}
					</button>
				</div>
			)}
		</div>
	)
}
