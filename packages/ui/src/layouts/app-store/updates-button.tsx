import {Fragment, useState} from 'react'

import {AppIcon} from '@/components/app-icon'
import {ButtonLink} from '@/components/ui/button-link'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp, trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'

export function UpdatesButton() {
	const linkToDialog = useLinkToDialog()
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()

	if (isLoading) return null

	// If we link to the updates dialog, show it even if there are no updates
	if (!appsWithUpdates.length) {
		return <UpdatesDialog />
	}

	return (
		<>
			{/* w-auto because 'dialog' size buttons take up full width on mobile */}
			<ButtonLink to={linkToDialog('updates')} size='dialog' className='relative h-[33px] w-auto bg-white/10'>
				Updates
				<NotificationBadge count={appsWithUpdates.length} />
			</ButtonLink>
			<UpdatesDialog />
		</>
	)
}

export function UpdatesDialog() {
	const dialogProps = useDialogOpenProps('updates')

	const title = 'Updates'

	const {appsWithUpdates, isLoading} = useAppsWithUpdates()

	const updateAllMut = trpcReact.user.apps.updateAll.useMutation()

	const updateAll = () => updateAllMut.mutate()

	if (isLoading) return null

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent
					className='top-[10%] max-h-[calc(100vh-20%)] translate-y-0 gap-0 p-0 py-5 data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-top-[0%]'
					slide={false}
				>
					<DialogHeader className='px-5 pb-5'>
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
					<Separator className='mb-1' />
					<ScrollArea className='flex h-[500px] flex-col gap-y-2.5 px-5'>
						{appsWithUpdates.map((app, i) => (
							<Fragment key={app.id}>
								{i === 0 ? undefined : <Separator className='my-1' />}
								<AppItem app={app} />
							</Fragment>
						))}
					</ScrollArea>
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
		<div className='p-2.5'>
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
				<div className='relative mt-2 grid'>
					<div
						className={cn('relative text-13 opacity-50 transition-all', !showAll && 'line-clamp-2')}
						style={{
							maskImage: showAll ? undefined : 'linear-gradient(-45deg, transparent 30px, white 60px, white)',
						}}
					>
						{app.releaseNotes}
					</div>
					<button
						className='absolute bottom-0 right-0 text-13 text-brand underline underline-offset-2'
						onClick={() => setShowAll((s) => !s)}
					>
						{showAll ? 'less' : 'more'}
					</button>
				</div>
			)}
		</div>
	)
}
