import {motion} from 'motion/react'
import {useEffect, useState} from 'react'
import {HiExternalLink} from 'react-icons/hi'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {useShortcuts, type Shortcut} from '@/hooks/use-shortcuts'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

import {resolveShortcutUrl} from './shortcut-dialog'
import {resolveShortcutIcon, ShortcutIconImage} from './shortcut-icon-image'

export type {Shortcut}

export function ShortcutIcon({shortcut}: {shortcut: Shortcut}) {
	const [iconSrc, setIconSrc] = useState(() => resolveShortcutIcon(shortcut))

	useEffect(() => {
		setIconSrc(resolveShortcutIcon(shortcut))
	}, [shortcut.icon, shortcut.url])

	const {remove} = useShortcuts()

	const handleClick = () => {
		window.open(resolveShortcutUrl(shortcut), '_blank')?.focus()
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>
				<motion.button
					onClick={handleClick}
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
					<ShortcutIconImage
						src={iconSrc}
						title={shortcut.title}
						className='relative aspect-square w-12 shrink-0 rounded-10 bg-white/10 ring-white/10 backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6 md:w-16 md:rounded-15'
					/>
					{/* Label structure intentionally mirrors AppIcon (block layout, not flex)
				   so text baselines align on the same grid row. The link icon is inline
				   rather than a flex sibling to preserve identical vertical positioning. */}
					<div className='max-w-full text-11 leading-normal drop-shadow-desktop-label md:text-13'>
						<div className='truncate contrast-more:bg-black contrast-more:px-1'>
							<HiExternalLink className='mr-0.5 inline h-3 w-3 align-[-0.15em] text-white/70 md:h-3.5 md:w-3.5' />
							{shortcut.title}
						</div>
					</div>
				</motion.button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={handleClick}>{t('shortcut.open')}</ContextMenuItem>
				<ContextMenuItem
					className={contextMenuClasses.item.rootDestructive}
					onSelect={() => remove({url: shortcut.url})}
				>
					{t('shortcut.remove')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
