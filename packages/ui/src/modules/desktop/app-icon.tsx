import {motion} from 'framer-motion'
import {useState} from 'react'
import {Link} from 'react-router-dom'

import {useAppInstall} from '@/hooks/use-app-install'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUserApp} from '@/hooks/use-user-apps'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {cn} from '@/shadcn-lib/utils'
import {AppState} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

import {UninstallTheseFirstDialog} from './uninstall-these-first-dialog'

const PLACEHOLDER_SRC = '/icons/app-icon-placeholder.svg'

export function AppIcon({
	appId,
	label,
	src,
	port,
	state = 'ready',
}: {
	appId: string
	label: string
	src: string
	port: number
	state?: AppState
}) {
	const [url, setUrl] = useState(src)

	const finalLabel = {
		ready: label,
		installing: 'Installing...',
		offline: 'Starting...',
		uninstalling: 'Uninstalling...',
		updating: 'Updating...',
	}[state]

	const disabled = state !== 'ready'

	const activeProps = {
		onClick: () => trackAppOpen(appId),
		href: portToUrl(port),
		target: '_blank',
	}

	return (
		<motion.a
			className={cn(
				'group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3 focus:outline-none',
				disabled && 'disabled',
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
			{...(!disabled && activeProps)}
		>
			<div
				className={cn(
					'aspect-square w-12 overflow-hidden rounded-10 bg-white/10 bg-cover bg-center ring-white/25 backdrop-blur-sm transition-all md:w-16 md:rounded-15',
					!disabled &&
						'group-hover:scale-110 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6',
				)}
				style={{
					backgroundImage: state === 'ready' ? `url(${PLACEHOLDER_SRC})` : undefined,
				}}
			>
				{url && (
					<img
						src={url}
						alt={label}
						onError={() => setUrl('')}
						className={cn(
							'h-full w-full',
							state !== 'ready' && 'animate-pulse',
							state === 'ready' && 'animate-in fade-in',
						)}
						draggable={false}
					/>
				)}
			</div>
			<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
				<div className='truncate contrast-more:bg-black contrast-more:px-1'>{finalLabel}</div>
			</div>
		</motion.a>
	)
}

export function AppIconConnected({appId}: {appId: string}) {
	const {addLinkSearchParams} = useQueryParams()
	const userApp = useUserApp(appId)
	const appInstall = useAppInstall(appId)
	const [openDepsDialog, setOpenDepsDialog] = useState(false)
	const [toUninstallFirstIds, setToUninstallFirstIds] = useState<string[]>([])

	const uninstall = async () => {
		const res = await appInstall.uninstall()
		if (res?.uninstallTheseFirst) {
			setToUninstallFirstIds(res.uninstallTheseFirst)
			setOpenDepsDialog(true)
		}
	}

	if (!userApp || !userApp.app) return <AppIcon appId={appId} label='' src='' port={0} />

	if (appInstall.state === 'loading') {
		return <AppIcon appId={appId} label='' src='' port={0} state='ready' />
	}

	if (appInstall.state === 'uninstalled') {
		return <AppIcon appId={appId} label={userApp.app.name} src={userApp.app.icon} port={0} state='ready' />
	}

	if (appInstall.state !== 'ready') {
		return (
			<AppIcon
				appId={appId}
				label={userApp.app.name}
				src={userApp.app.icon}
				port={userApp.app.port}
				state={appInstall.state}
			/>
		)
	}

	// If app is installed, show context menu
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger className='group'>
					<AppIcon
						appId={appId}
						label={userApp.app.name}
						src={userApp.app.icon}
						port={userApp.app.port}
						state={appInstall.state}
					/>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem asChild>
						<Link to={`/app-store/${appId}`}>Go to store page</Link>
					</ContextMenuItem>
					<ContextMenuItem asChild>
						<Link to={{search: addLinkSearchParams({dialog: 'default-credentials', 'default-credentials-for': appId})}}>
							Show default credentials
						</Link>
					</ContextMenuItem>
					<ContextMenuItem onSelect={appInstall.restart}>Restart</ContextMenuItem>
					<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onSelect={uninstall}>
						Uninstall
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{toUninstallFirstIds.length > 0 && (
				<UninstallTheseFirstDialog
					appId={appId}
					toUninstallFirstIds={toUninstallFirstIds}
					open={openDepsDialog}
					onOpenChange={setOpenDepsDialog}
				/>
			)}
		</>
	)
}
