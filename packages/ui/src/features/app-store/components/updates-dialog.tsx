import {DialogProps} from '@radix-ui/react-dialog'
import {Fragment, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {Markdown} from '@/components/markdown'
import {ProgressButton} from '@/components/progress-button'
import {AnimatedNumber} from '@/components/ui/animated-number'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/components/ui/dialog'
import {ScrollArea} from '@/components/ui/scroll-area'
import {Separator} from '@/components/ui/separator'
import {UNKNOWN} from '@/constants'
import {pollStates, useAppInstallProgress} from '@/hooks/use-app-install'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useUpdateAllApps} from '@/hooks/use-update-all-apps'
import {useUpdateApp} from '@/hooks/use-update-app'
import {cn} from '@/lib/utils'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {canExecuteUpdate} from '@/modules/app-store/update-availability'
import {RegistryApp} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

export function UpdatesDialogConnected() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('updates')
	const {appsWithUpdates, isLoading} = useAppsWithUpdates()
	const updateAll = useUpdateAllApps()

	if (isLoading) return null

	return (
		<UpdatesDialog
			{...dialogProps}
			open={dialogProps.open}
			appsWithUpdates={appsWithUpdates}
			// A single update has its own row button; Update all only earns its
			// place once there is more than one
			titleRightChildren={
				appsWithUpdates.length > 1 && (
					<Button
						size='md'
						variant='primary'
						onClick={updateAll.updateAll}
						className='w-auto'
						disabled={updateAll.isLoading || !updateAll.canUpdateAll}
					>
						{updateAll.isUpdating ? t('app-updates.updating') : t('app-updates.update-all')}
					</Button>
				)
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
	const {t} = useTranslation()
	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent
					className='umbrel-app-store-modal top-[10%] max-h-[calc(100vh-20%)] translate-y-0 gap-0 p-0 py-5 data-[state=closed]:slide-out-to-top-[0%] data-[state=open]:slide-in-from-top-[0%]'
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
	const {t} = useTranslation()
	const [showAll, setShowAll] = useState(false)
	// Polls the per-app state only while a transition is running, so an open
	// dialog with many rows doesn't poll for idle apps
	const {state, progress} = useAppInstallProgress(app.id)
	const updateApp = useUpdateApp(app.id)

	const inProgress = state !== 'loading' && arrayIncludes(pollStates, state)

	return (
		<div className='p-2.5'>
			<div className='flex items-center gap-2.5'>
				<AppIcon src={app.icon} size={36} className='rounded-8' />
				<div className='flex min-w-0 flex-col'>
					<h3 className='text-13 font-semibold'>{app.name}</h3>
					<p className='text-13 opacity-40'>{app.version}</p>
					{!app.compatible && (
						<p className='text-12 text-amber-300/70'>
							{t('app-updates.os-update-required', {
								version: app.manifestVersion.replace(/\.0$/, ''),
							})}
						</p>
					)}
				</div>
				<div className='flex-1' />
				<ProgressButton
					size='sm'
					onClick={updateApp.update}
					disabled={!canExecuteUpdate(state, app.compatible) || updateApp.isPending}
					state={state}
					progress={progress}
					style={{
						['--progress-button-bg' as string]: 'hsl(0 0 30%)',
					}}
				>
					{state === 'updating' ? (
						<>
							{t('app.updating')}{' '}
							<span className='inline-block w-[4ch] text-right -tracking-[0.08em] opacity-40'>
								{progress === undefined ? UNKNOWN() : <AnimatedNumber to={progress} />}%
							</span>
						</>
					) : inProgress ? (
						appStateToString(state, t) + '...'
					) : (
						t('app-updates.update')
					)}
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
							!showAll && 'absolute right-0 bottom-0',
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
