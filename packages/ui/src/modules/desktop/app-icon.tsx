import {Link, useLocation} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export function AppIcon({appId, label, src, port}: {appId: string; label: string; src: string; port: number}) {
	const {pathname} = useLocation()

	// Don't show context menu one desktop by default because it causes dialog enter animation to usually stutter if a page load opens a dialog
	const allowContextMenu = pathname === '/'

	const inner = (
		<a
			className='group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3'
			onClick={() => trackAppOpen(appId)}
			href={portToUrl(port)}
			target='_blank'
		>
			<img
				src={src}
				alt={label}
				width={64}
				height={64}
				className='h-16 w-16 rounded-15 bg-white/10 bg-cover bg-center ring-white/25 transition-all group-hover:scale-110 group-active:scale-95 group-data-[state=open]:ring-6'
				style={{
					backgroundImage: `url(/icons/app-icon-placeholder.svg)`,
				}}
				draggable={false}
			/>
			<div className='max-w-full text-13 leading-normal drop-shadow-desktop-label'>
				<div className='truncate contrast-more:bg-black contrast-more:px-1'>{label}</div>
			</div>
		</a>
	)

	if (!allowContextMenu) return inner

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>{inner}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem asChild>
					<Link to={`/app-store/${appId}`}>Go to store page</Link>
				</ContextMenuItem>
				<ContextMenuItem>Restart</ContextMenuItem>
				<ContextMenuItem className={contextMenuClasses.item.rootDestructive}>Uninstall</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
