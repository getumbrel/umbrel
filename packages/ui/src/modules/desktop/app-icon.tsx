import {Link} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'

export function AppIcon({appId, label, src}: {appId: string; label: string; src: string}) {
	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger className='group'>
				<div className='flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3'>
					<img
						src={src}
						alt={label}
						width={64}
						height={64}
						className='h-16 w-16 rounded-15 bg-white/50 bg-cover bg-center ring-white/25 backdrop-blur-sm group-data-[state=open]:ring-6'
						style={{
							backgroundImage: `url(/icons/app-icon-placeholder.svg)`,
						}}
					/>
					<div className='max-w-full text-13 leading-normal drop-shadow-desktop-label'>
						<div className='truncate'>{label}</div>
					</div>
				</div>
			</ContextMenuTrigger>
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
