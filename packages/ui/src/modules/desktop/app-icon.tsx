import {motion} from 'framer-motion'
import {useState} from 'react'
import {Link} from 'react-router-dom'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useUserApp} from '@/providers/apps'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {cn} from '@/shadcn-lib/utils'
import {AppState, AppStateOrLoading} from '@/trpc/trpc'
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
}: {
	label: string
	src: string
	onClick?: () => void
	state?: AppState
}) {
	const [url, setUrl] = useState(src)

	const disabled = state !== 'ready'

	return (
		<motion.button
			onClick={disabled ? undefined : onClick}
			className={cn(
				'group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3 focus:outline-none',
				disabled && 'disabled pointer-events-none',
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
					'aspect-square w-12 shrink-0 overflow-hidden rounded-10 bg-white/10 bg-cover bg-center ring-white/25 backdrop-blur-sm transition-all duration-300 md:w-16 md:rounded-15',
					!disabled &&
						'group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6',
				)}
				style={{
					backgroundImage: state === 'ready' ? `url(${APP_ICON_PLACEHOLDER_SRC})` : undefined,
				}}
			>
				{url && (
					<FadeInImg
						src={url}
						alt={label}
						onError={() => setUrl('')}
						className={cn(
							'h-full w-full duration-500',
							state !== 'ready' && 'animate-pulse duration-1000',
							state === 'ready' && 'animate-in fade-in',
						)}
						draggable={false}
					/>
				)}
			</div>
			<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
				<div className='truncate contrast-more:bg-black contrast-more:px-1'>
					<AppLabel state={state} label={label} />
				</div>
			</div>
		</motion.button>
	)
}

function AppLabel({state, label}: {state: AppStateOrLoading; label: string}) {
	switch (state) {
		case 'not-installed':
			return t('app.installing')
		case 'installing':
			return t('app.installing') + '...'
		case 'ready':
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
			return t('loading') + '...'
		case 'stopped':
		case 'unknown':
			return t('app.offline')
	}
	return assertUnreachable(state)
}

export function AppIconConnected({appId}: {appId: string}) {
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

	switch (appInstall.state) {
		case 'loading':
			return <AppIcon label='' src={userApp.app.icon} state='ready' />
		case 'restarting':
		case 'starting':
		case 'stopping':
		case 'unknown':
		case 'stopped':
		case 'uninstalling':
		case 'updating':
			return <AppIcon label='' src={userApp.app.icon} state={appInstall.state} />
		case 'not-installed':
			return <AppIcon label='' src={userApp.app.icon} state='ready' />
		case 'installing':
			return <AppIcon label={userApp.app.name} src={userApp.app.icon} state='installing' />
		case 'running':
		case 'ready': {
			return (
				<>
					<ContextMenu>
						<ContextMenuTrigger className='group'>
							<AppIcon
								label={userApp.app.name}
								src={userApp.app.icon}
								onClick={() => launchApp(appId)}
								state={appInstall.state}
							/>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem asChild>
								<Link to={`/app-store/${appId}`}>{t('desktop.app.context.go-to-store-page')}</Link>
							</ContextMenuItem>
							<ContextMenuItem asChild>
								<Link to={linkToDialog('default-credentials', {for: appId})}>
									{t('desktop.app.context.show-default-credentials')}
								</Link>
							</ContextMenuItem>
							<ContextMenuItem onSelect={appInstall.restart}>{t('restart')}</ContextMenuItem>
							<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onSelect={uninstallPrecheck}>
								{t('desktop.app.context.uninstall')}
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
					{toUninstallFirstIds.length > 0 && (
						<UninstallTheseFirstDialog
							appId={appId}
							registryId={userApp.app.registryId}
							toUninstallFirstIds={toUninstallFirstIds}
							open={openDepsDialog}
							onOpenChange={setOpenDepsDialog}
						/>
					)}
					{showUninstallDialog && (
						<UninstallConfirmationDialog
							appId={appId}
							registryId={userApp.app.registryId}
							open={showUninstallDialog}
							onOpenChange={setShowUninstallDialog}
							onConfirm={uninstall}
						/>
					)}
				</>
			)
		}
	}
}
