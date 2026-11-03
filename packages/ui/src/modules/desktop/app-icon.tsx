import {motion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {FaRegPlayCircle} from 'react-icons/fa'
import {FaRegCirclePause} from 'react-icons/fa6'
import {TbAlertTriangle} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {registryAppPath} from '@/constants/app-store'
import {canRestart, canStart, canStop, useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {indexRegistryApps} from '@/lib/app-store-registry'
import {cn} from '@/lib/utils'
import {getAppWarning} from '@/modules/apps/app-warnings'
import {useAppUninstall} from '@/modules/apps/use-app-uninstall'
import {useHasMembers} from '@/modules/user-sharing'
import {useUserApp} from '@/providers/apps'
import {AppStateOrLoading, progressBarStates, progressStates, trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {assertUnreachable} from '@/utils/misc'

import {MemberAppUnavailableDialog} from './member-app-unavailable-dialog'

export const APP_ICON_PLACEHOLDER_SRC = '/assets/app-icon-placeholder.svg'

export function AppIcon({
	label,
	src,
	onClick,
	state = 'ready',
	progress,
	warning = false,
}: {
	label: string
	src: string
	onClick?: () => void
	state?: AppStateOrLoading
	progress?: number
	warning?: boolean
}) {
	const [appIconSrc, setAppIconSrc] = useState(src)

	const inProgress = arrayIncludes(progressStates, state)
	const isStopped = state === 'stopped'
	// App state and settings warnings are independent: an app can still be
	// running while required storage is unavailable. Progress takes precedence,
	// then warnings, then the stopped control.
	const showWarning = !inProgress && (state === 'unknown' || warning)
	const showStopped = !inProgress && !showWarning && isStopped

	const appIcon = (
		<motion.button
			onClick={onClick}
			className={cn(
				'group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-[var(--app-pad)] focus:outline-hidden',
			)}
			layout
			initial={{
				opacity: 1,
				scale: 0.8,
			}}
			animate={{
				opacity: 1,
				scale: 1,
			}}
			exit={{
				opacity: 0,
				scale: 0.5,
			}}
			transition={{
				type: 'spring',
				stiffness: 500,
				damping: 30,
			}}
		>
			{/* The backdrop blur only shows until the opaque icon loads. Firefox redraws
			    it on every frame of the hover scale, so it goes without there. */}
			<div
				className={cn(
					'relative aspect-square w-[var(--app-icon)] shrink-0 overflow-hidden rounded-[var(--app-icon-radius)] bg-white/10 bg-cover bg-center ring-white/25 backdrop-blur-xs transition-[scale,box-shadow] duration-300 group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6 firefox:backdrop-blur-none',
				)}
			>
				{appIconSrc && (
					<FadeInImg
						src={appIconSrc}
						alt={label}
						onError={() => setAppIconSrc(APP_ICON_PLACEHOLDER_SRC)}
						className={cn(
							'h-full w-full duration-500',
							(inProgress || showStopped || showWarning) && 'brightness-50',
							!inProgress && !showStopped && !showWarning && 'animate-in fade-in',
						)}
						draggable={false}
					/>
				)}
				{inProgress && (
					<div className='absolute inset-0 flex items-center justify-center'>
						<div className='relative h-1 w-[75%] overflow-hidden rounded-full bg-white/40'>
							{arrayIncludes(progressBarStates, state) ? (
								<div
									className='absolute inset-0 w-0 animate-in rounded-full bg-white/90 transition-[width] delay-200 duration-700 fill-mode-both slide-in-from-left-full'
									style={{width: `${progress}%`}}
								/>
							) : (
								<div className='absolute inset-0 w-[30%] animate-sliding-loader rounded-full bg-white/90' />
							)}
						</div>
					</div>
				)}
				{/* Same dim + centered white glyph as the stopped state, but a warning
				    triangle so the shape reads as "problem" rather than "inactive" */}
				{showWarning && (
					<div className='absolute inset-0 flex items-center justify-center'>
						<TbAlertTriangle className='h-6 w-6 text-white/90 md:h-8 md:w-8' strokeWidth={2} />
					</div>
				)}
				{showStopped && (
					<div className='absolute inset-0 flex items-center justify-center'>
						<FaRegCirclePause className='h-6 w-6 text-white/90 group-hover:hidden md:h-8 md:w-8' />
						<FaRegPlayCircle className='hidden h-6 w-6 text-white/90 group-hover:block md:h-8 md:w-8' />
					</div>
				)}
			</div>
			<div className='max-w-full text-[length:var(--app-label)] leading-normal drop-shadow-desktop-label'>
				<div className='truncate contrast-more:bg-black contrast-more:px-1'>
					<AppLabel state={state} label={label} />
				</div>
			</div>
		</motion.button>
	)

	return appIcon
}

export function AppLabel({state, label = ''}: {state: AppStateOrLoading; label?: string}) {
	const {t} = useTranslation()
	switch (state) {
		case 'not-installed':
			return t('app.installing')
		case 'installing':
			return label
		case 'ready':
			return label
		case 'running':
			return label
		case 'starting':
			return t('app.starting') + '…'
		case 'restarting':
			return t('app.restarting') + '…'
		case 'stopping':
			return t('app.stopping') + '…'
		case 'uninstalling':
			return t('app.uninstalling') + '…'
		case 'updating':
			return t('app.updating') + '…'
		case 'loading':
			return label
		case 'stopped':
			return label
		case 'unknown':
			return t('app.offline')
	}
	return assertUnreachable(state)
}

export function AppIconConnected({appId}: {appId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const userApp = useUserApp(appId)
	const appInstall = useAppInstall(appId)
	const {promptUninstall, dialogs: uninstallDialogs} = useAppUninstall(appId, appInstall)
	const launchApp = useLaunchApp()
	const linkToDialog = useLinkToDialog()
	const hasMembers = useHasMembers()

	// Members see shared apps but can't manage them
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'
	const [showMemberUnavailableDialog, setShowMemberUnavailableDialog] = useState(false)

	if (!userApp || !userApp.app) return <AppIcon label='' src='' />

	const state = appInstall.state
	// Only data-root problems make an app unusable. Folder-access warnings are
	// advisory — the app keeps running with the folder missing, and a slow
	// drive or share can flag them transiently — so they surface in the app's
	// settings without hijacking the icon's launch behavior.
	const storageWarning = getAppWarning(userApp.app)
	const storageBlocked = storageWarning === 'app-storage' || storageWarning === 'app-data-missing'

	const startDisabled = !canStart(state)
	const stopDisabled = !canStop(state)
	const restartDisabled = !canRestart(state)
	// Troubleshoot is available whenever restart is
	const troubleshootDisabled = !canRestart(state)
	// Uninstall is never disabled just so the user can always retry uninstalling if the app
	// ever gets stuck in an uninstalling state.
	const uninstallDisabled = false

	const handleAppClick = async () => {
		if (storageBlocked) {
			return navigate(linkToDialog('app-settings', {for: appId, view: 'storage'}))
		}
		// Launch the app if it's ready
		if (state === 'ready') {
			return launchApp(appId)
		}
		// Start the app if it's stopped
		if (state === 'stopped') {
			return appInstall.start()
		}
		// Try restarting the app if it's 'unknown'
		if (state === 'unknown') {
			return appInstall.restart()
		}
	}

	// Members only get the app icon, the context menu is device management.
	// Clicking an app that isn't running explains the state instead of
	// attempting owner-only start/restart actions that would just error.
	if (isMember) {
		const handleMemberAppClick = () => {
			if (storageBlocked) return setShowMemberUnavailableDialog(true)
			if (state === 'ready') return launchApp(appId)
			if (state === 'stopped' || state === 'unknown') setShowMemberUnavailableDialog(true)
		}
		return (
			<>
				<AppIcon
					label={userApp.app.name}
					src={userApp.app.icon}
					onClick={handleMemberAppClick}
					state={state}
					progress={appInstall.progress}
					warning={storageBlocked}
				/>
				<MemberAppUnavailableDialog
					appName={userApp.app.name}
					variant={state === 'stopped' && !storageBlocked ? 'stopped' : 'problem'}
					open={showMemberUnavailableDialog}
					onOpenChange={setShowMemberUnavailableDialog}
				/>
			</>
		)
	}

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger className='group'>
					<AppIcon
						label={userApp.app.name}
						src={userApp.app.icon}
						onClick={handleAppClick}
						state={state}
						progress={appInstall.progress}
						warning={storageBlocked}
					/>
				</ContextMenuTrigger>
				<ContextMenuContent>
					{/* Start / Stop */}
					{state !== 'stopped' ? (
						<ContextMenuItem disabled={stopDisabled} onSelect={stopDisabled ? undefined : appInstall.stop}>
							{t('stop')}
						</ContextMenuItem>
					) : (
						<ContextMenuItem onSelect={appInstall.start} disabled={startDisabled}>
							{t('start')}
						</ContextMenuItem>
					)}

					{/* Restart */}
					<ContextMenuItem disabled={restartDisabled} onSelect={restartDisabled ? undefined : appInstall.restart}>
						{t('restart')}
					</ContextMenuItem>

					{/* App settings */}
					<ContextMenuItem asChild>
						<Link to={linkToDialog('app-settings', {for: appId})}>{t('desktop.app.context.settings')}</Link>
					</ContextMenuItem>

					{/* Troubleshoot */}
					<ContextMenuItem
						disabled={troubleshootDisabled}
						onSelect={() => navigate(linkToDialog('troubleshoot', {for: appId}))}
					>
						{t('troubleshoot')}
					</ContextMenuItem>

					{/* Share with users */}
					{hasMembers && (
						<ContextMenuItem asChild>
							<Link to={linkToDialog('app-share-users', {for: appId})}>
								{t('desktop.app.context.share-with-users')}
							</Link>
						</ContextMenuItem>
					)}

					{/* Go to app store page */}
					<ContextMenuItemLinkToAppStore appId={appId} />

					{/* Uninstall */}
					<ContextMenuItem
						className={contextMenuClasses.item.rootDestructive}
						disabled={uninstallDisabled}
						onSelect={uninstallDisabled ? undefined : promptUninstall}
					>
						{t('desktop.app.context.uninstall')}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{uninstallDialogs}
		</>
	)
}

function ContextMenuItemLinkToAppStore({appId}: {appId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const utils = trpcReact.useUtils()
	return (
		<ContextMenuItem asChild>
			<button
				// `w-full` because it doesn't fill the context menu otherwise
				className='w-full'
				onClick={async () => {
					const installedApps = await utils.apps.list.fetch()
					const installedApp = installedApps.find((app) => app.id === appId)
					if (!installedApp) return

					const availableApps = await utils.appStore.registry.fetch()
					const appStoreApp = indexRegistryApps(availableApps).appsKeyed[installedApp.id]
					if (appStoreApp) navigate(registryAppPath(appStoreApp))
				}}
			>
				{t('desktop.app.context.go-to-store-page')}
			</button>
		</ContextMenuItem>
	)
}
