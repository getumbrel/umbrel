import {Link} from 'react-router-dom'
import {toast} from 'sonner'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {trpcReact} from '@/trpc/trpc'

export function AppIcon({appId, label, src}: {appId: string; label: string; src: string}) {
	const ctx = trpcReact.useContext()
	const userMut = trpcReact.user.set.useMutation({
		onSuccess: () => ctx.user.get.invalidate(),
	})

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>
				<button
					className='group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3'
					onClick={() => {
						userMut.mutate({
							openedApp: appId,
						})
						toast(`${appId} opened`)
					}}
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
				</button>
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
