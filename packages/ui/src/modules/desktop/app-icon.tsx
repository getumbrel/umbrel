import {motion} from 'framer-motion'
import {useState} from 'react'
import {FaRegPlayCircle} from 'react-icons/fa'
import {FaRegCirclePause} from 'react-icons/fa6'
import {Link, useNavigate} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {getAppStoreAppFromInstalledApp} from '@/modules/app-store/utils'
import {useUserApp} from '@/providers/apps'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {cn} from '@/shadcn-lib/utils'
import {AppStateOrLoading, progressBarStates, progressStates} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {assertUnreachable} from '@/utils/misc'

import {UninstallConfirmationDialog} from './uninstall-confirmation-dialog'
import {UninstallTheseFirstDialog} from './uninstall-these-first-dialog'

export const APP_ICON_PLACEHOLDER_SRC = '/figma-exports/app-icon-placeholder.svg'

export function AppIcon({
	label,
	src,
	onClick,
	state = 'ready',
	progress,
}: {
	label: string
	src: string
	onClick?: () => void
	state?: AppStateOrLoading
	progress?: number
}) {
	const [appIconSrc, setAppIconSrc] = useState(src)

	const inProgress = arrayIncludes(progressStates, state)
	const isStopped = state === 'stopped'

	const appIcon = (
		<motion.button
			onClick={onClick}
			className={cn(
				'group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3 focus:outline-none',
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
			<div
				className={cn(
					'relative aspect-square w-12 shrink-0 overflow-hidden rounded-10 bg-white/10 bg-cover bg-center ring-white/25 backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6 md:w-16 md:rounded-15',
				)}
			>
				{appIconSrc && (
					<FadeInImg
						src={appIconSrc}
						alt={label}
						onError={() => setAppIconSrc(APP_ICON_PLACEHOLDER_SRC)}
						className={cn(
							'h-full w-full duration-500',
							(inProgress || isStopped) && 'brightness-50',
							!inProgress && !isStopped && 'animate-in fade-in',
						)}
						draggable={false}
					/>
				)}
				{inProgress && (
					<div className='absolute inset-0 flex items-center justify-center'>
						<div className='relative h-1 w-[75%] overflow-hidden rounded-full bg-white/40'>
							{arrayIncludes(progressBarStates, state) ? (
								<div
									className='absolute inset-0 w-0 rounded-full bg-white/90 transition-[width] delay-200 duration-700 animate-in slide-in-from-left-full fill-mode-both'
									style={{width: `${progress}%`}}
								/>
							) : (
								<div className='absolute inset-0 w-[30%] animate-sliding-loader rounded-full bg-white/90' />
							)}
						</div>
					</div>
				)}
				{isStopped && (
					<div className='absolute inset-0 flex items-center justify-center'>
						<FaRegCirclePause className='h-6 w-6 text-white/90 group-hover:hidden md:h-8 md:w-8' />
						<FaRegPlayCircle className='hidden h-6 w-6 text-white/90 group-hover:block md:h-8 md:w-8' />
					</div>
				)}
			</div>
			<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
				<div className='truncate contrast-more:bg-black contrast-more:px-1'>
					<AppLabel state={state} label={label} />
				</div>
			</div>
		</motion.button>
	)

	return appIcon
}

export function AppLabel({state, label = ''}: {state: AppStateOrLoading; label?: string}) {
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
			return t('app.starting') + '...'
		case 'restarting':
			return t('app.restarting') + '...'
		case 'stopping':
			return t('app.stopping') + '...'
		case 'uninstalling':
			return t('app.uninstalling') + '...'
		case 'updating':
			return t('app.updating') + '...'
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
	const navigate = useNavigate()
	const userApp = useUserApp(appId)
	const appInstall = useAppInstall(appId)
	const [openDepsDialog, setOpenDepsDialog] = useState(false)
	const [toUninstallFirstIds, setToUninstallFirstIds] = useState<string[]>([])
	const [showUninstallDialog, setShowUninstallDialog] = useState(false)
	const launchApp = useLaunchApp()
	const linkToDialog = useLinkToDialog()

	const uninstall = async () => {
		const res = await appInstall.uninstall()
		if (res?.uninstallTheseFirst) {
			setToUninstallFirstIds(res.uninstallTheseFirst)
			setOpenDepsDialog(true)
		} else {
			setShowUninstallDialog(false)
		}
	}

	const uninstallPrecheck = async () => {
		const apps = await appInstall.getAppsToUninstallFirst()
		if (apps.length > 0) {
			setToUninstallFirstIds(apps)
			setOpenDepsDialog(true)
		} else {
			setShowUninstallDialog(true)
		}
	}

	if (!userApp || !userApp.app) return <AppIcon label='' src='' />

	const state = appInstall.state

	// Start is disabled if the app is not stopped or unknown
	const startDisabled = !arrayIncludes(['stopped', 'unknown'], state)
	// Stop is disabled if the app is not running or ready
	const stopDisabled = !arrayIncludes(['running', 'ready'], state)
	// Restart is disabled if the app is not running or ready or unknown
	const restartDisabled = !arrayIncludes(['running', 'ready', 'unknown'], state)
	// Troubleshoot is disabled if the app is not running or ready or unknown
	const troubleshootDisabled = !arrayIncludes(['running', 'ready', 'unknown'], state)
	// Uninstall is never disabled just so the user can always retry uninstalling if the app
	// ever gets stuck in an uninstalling state.
	const uninstallDisabled = false

	const handleAppClick = async () => {
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
					/>
				</ContextMenuTrigger>
				<ContextMenuContent>
					{userApp.app.credentials &&
						(userApp.app.credentials.defaultUsername || userApp.app.credentials.defaultPassword) && (
							<ContextMenuItem asChild>
								<Link to={linkToDialog('default-credentials', {for: appId})}>
									{t('desktop.app.context.show-default-credentials')}
								</Link>
							</ContextMenuItem>
						)}

					{/* App settings (currently dependencies only) */}
					{!!userApp.app.dependencies?.length && (
						<ContextMenuItem asChild>
							<Link to={linkToDialog('app-settings', {for: appId})}>{t('desktop.app.context.settings')}</Link>
						</ContextMenuItem>
					)}

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

					{/* Troubleshoot */}
					<ContextMenuItem
						disabled={troubleshootDisabled}
						onSelect={() => navigate(`/settings/troubleshoot/app/${appId}`)}
					>
						{t('troubleshoot')}
					</ContextMenuItem>

					{/* Go to app store page */}
					<ContextMenuItemLinkToAppStore appId={appId} />

					{/* Uninstall */}
					<ContextMenuItem
						className={contextMenuClasses.item.rootDestructive}
						disabled={uninstallDisabled}
						onSelect={uninstallDisabled ? undefined : uninstallPrecheck}
					>
						{t('desktop.app.context.uninstall')}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{/* Dialogs */}
			{toUninstallFirstIds.length > 0 && (
				<UninstallTheseFirstDialog
					appId={appId}
					toUninstallFirstIds={toUninstallFirstIds}
					open={openDepsDialog}
					onOpenChange={setOpenDepsDialog}
				/>
			)}
			{showUninstallDialog && (
				<UninstallConfirmationDialog
					appId={appId}
					open={showUninstallDialog}
					onOpenChange={setShowUninstallDialog}
					onConfirm={uninstall}
				/>
			)}
		</>
	)
}

function ContextMenuItemLinkToAppStore({appId}: {appId: string}) {
	const navigate = useNavigate()
	return (
		<ContextMenuItem asChild>
			<button
				// `w-full` because it doesn't fill the context menu otherwise
				className='w-full'
				onClick={async () => {
					const appStoreApp = await getAppStoreAppFromInstalledApp(appId)
					const registryId = appStoreApp?.registryId ?? UMBREL_APP_STORE_ID
					if (registryId !== UMBREL_APP_STORE_ID) {
						navigate(`/community-app-store/${registryId}/${appId}`)
					} else {
						navigate(`/app-store/${appId}`)
					}
				}}
			>
				{t('desktop.app.context.go-to-store-page')}
			</button>
		</ContextMenuItem>
	)
}
