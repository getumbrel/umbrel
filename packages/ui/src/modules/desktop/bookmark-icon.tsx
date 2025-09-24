import {motion} from 'framer-motion'
import {useState} from 'react'
import {RiExternalLinkLine} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {APP_ICON_PLACEHOLDER_SRC} from './app-icon'
import {Bookmark} from './bookmark-dialog'
import {useIconBackground} from './use-icon-background'

export function BookmarkIcon({bookmark}: {bookmark: Bookmark}) {
	const [iconSrc, setIconSrc] = useState(bookmark.icon || APP_ICON_PLACEHOLDER_SRC)
	const utils = trpcReact.useUtils()
	const linkToDialog = useLinkToDialog()
	const backgroundColor = useIconBackground(iconSrc)

	const deleteBookmarkMut = trpcReact.user.deleteBookmark.useMutation({
		onSuccess: () => {
			utils.user.bookmarks.invalidate()
			utils.user.get.invalidate()
		},
	})

	const handleClick = () => {
		if (bookmark.openInNewTab) {
			window.open(bookmark.url, '_blank', 'noopener,noreferrer')
		} else {
			window.location.href = bookmark.url
		}
	}

	const handleDelete = () => {
		if (confirm(t('desktop.bookmark.context.delete') + '?')) {
			deleteBookmarkMut.mutate({id: bookmark.id})
		}
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>
				<motion.button
					onClick={handleClick}
					className='group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-3 focus:outline-none'
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
						{iconSrc && (
							<>
								{/* Background fill for images with uniform edges */}
								{backgroundColor && <div className='absolute inset-0' style={{backgroundColor}} />}
								<FadeInImg
									src={iconSrc}
									alt={bookmark.name}
									onError={() => setIconSrc(APP_ICON_PLACEHOLDER_SRC)}
									className='relative z-10 h-full w-full animate-in fade-in duration-500'
									draggable={false}
								/>
							</>
						)}
						{/* External link indicator */}
						<div className='absolute bottom-1 right-1 z-20 rounded-full bg-black/40 p-1 backdrop-blur-sm'>
							<RiExternalLinkLine className='h-2.5 w-2.5 text-white/80 md:h-3 md:w-3' />
						</div>
					</div>
					<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
						<div className='truncate contrast-more:bg-black contrast-more:px-1'>
							<span className='text-white/80 duration-300 group-hover:text-white'>{bookmark.name}</span>
						</div>
					</div>
				</motion.button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem asChild>
					<Link to={linkToDialog('add-bookmark', {id: bookmark.id})}>
						{t('desktop.bookmark.context.edit')}
					</Link>
				</ContextMenuItem>
				<ContextMenuItem onSelect={handleDelete} className={contextMenuClasses.item.rootDestructive}>
					{t('desktop.bookmark.context.delete')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
