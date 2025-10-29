import {DialogProps} from '@radix-ui/react-dialog'
import {Fragment, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {appStateToString} from '@/components/cmdk'
import {Markdown} from '@/components/markdown'
import {ProgressButton} from '@/components/progress-button'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useUpdateAllApps} from '@/hooks/use-update-all-apps'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {progressStates, RegistryApp, trpcReact} from '@/trpc/trpc'
import {MS_PER_SECOND} from '@/utils/date-time'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function UpdatesDialogConnected() {
	const dialogProps = useDialogOpenProps('updates')
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()
	const updateAll = useUpdateAllApps()

	if (isLoading) return null

	return (
		<UpdatesDialog
			{...dialogProps}
			open={dialogProps.open}
			appsWithUpdates={appsWithUpdates}
			titleRightChildren={
				<Button
					size='md'
					variant='primary'
					onClick={updateAll.updateAll}
					className='w-auto'
					disabled={updateAll.isLoading || updateAll.isUpdating || appsWithUpdates.length === 0}
				>
					{updateAll.isUpdating ? t('app-updates.updating') : t('app-updates.update-all')}
				</Button>
			}
		/>
	)
}

export function UpdatesDialog({
	appsWithUpdates,
	titleRightChildren,
	...dialogProps
}: {
	appsWithUpdates: RegistryApp[]
	titleRightChildren?: React.ReactNode
} & DialogProps) {
	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent
					className='top-[10%] max-h-[calc(100vh-20%)] translate-y-0 gap-0 p-0 py-5 data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-top-[0%]'
					slide={false}
				>
					<DialogHeader className='px-5 pb-5'>
						<DialogTitle className='flex flex-row items-center justify-between'>
							<span>{t('app-updates.updates-available-count', {count: appsWithUpdates.length})}</span>
							{titleRightChildren}
						</DialogTitle>
					</DialogHeader>
					<Separator />
					<ScrollArea className='flex max-h-[500px] flex-col gap-y-2.5 px-5'>
						{appsWithUpdates.length === 0 && (
							<p className='p-4 text-center text-13 opacity-40'>{t('app-updates.no-updates')}</p>
						)}
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
	const appStateQ = trpcReact.apps.state.useQuery(
		{appId: app.id},
		{
			refetchInterval: 2 * MS_PER_SECOND,
		},
	)
	const [showAll, setShowAll] = useState(false)
	const utils = trpcReact.useUtils()
	const updateMut = trpcReact.apps.update.useMutation({
		onMutate: () => {
			// Optimistic updates because otherwise it's too slow and feels like nothing is happening
			utils.apps.state.cancel()
			utils.apps.state.setData({appId: app.id}, {state: 'updating', progress: 0})
		},
		onSuccess: () => {
			// This should cause the app to be removed from the list
			utils.apps.list.invalidate()
		},
	})
	const updateApp = () => updateMut.mutate({appId: app.id})

	const progress = appStateQ.data?.progress
	const appState = appStateQ.isLoading ? 'loading' : appStateQ.data!.state
	const inProgress = arrayIncludes(progressStates, appState)

	return (
		<div className='p-2.5'>
			<div className='flex items-center gap-2.5'>
				<AppIcon src={app.icon} size={36} className='rounded-8' />
				<div className='flex flex-col'>
					<h3 className='text-13 font-semibold'>{app.name}</h3>
					<p className='text-13 opacity-40'>{app.version}</p>
				</div>
				<div className='flex-1' />
				<ProgressButton
					size='sm'
					onClick={updateApp}
					disabled={inProgress || updateMut.isPending}
					state={appState}
					progress={progress}
					style={{
						['--progress-button-bg' as string]: 'hsl(0 0 30%)',
					}}
				>
					{inProgress ? appStateToString(appState) + '...' : t('app-updates.update')}
				</ProgressButton>
			</div>
			{app.releaseNotes && (
				<div className='relative mt-2 grid'>
					<div
						className={cn('relative overflow-x-auto text-13 opacity-50 transition-all')}
						style={{
							maskImage: showAll ? undefined : 'linear-gradient(-45deg, transparent 30px, white 60px, white)',
						}}
						ref={(ref) => {
							ref?.addEventListener('focusin', () => {
								setShowAll(true)
							})
						}}
					>
						<Markdown className={cn('text-13 leading-snug -tracking-3', !showAll && 'line-clamp-2')}>
							{app.releaseNotes}
						</Markdown>
					</div>
					<button
						className={cn(
							'justify-self-end text-13 text-brand underline underline-offset-2',
							!showAll && 'absolute bottom-0 right-0 ',
						)}
						onClick={() => setShowAll((s) => !s)}
					>
						{showAll ? t('app-updates.less') : t('app-updates.more')}
					</button>
				</div>
			)}
		</div>
	)
}
