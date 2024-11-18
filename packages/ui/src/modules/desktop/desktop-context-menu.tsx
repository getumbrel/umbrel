import {useRef, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {useQueryParams} from '@/hooks/use-query-params'
import {WallpaperPicker} from '@/routes/settings/_components/wallpaper-picker'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {Popover, PopoverAnchor, PopoverClose, PopoverContent} from '@/shadcn-components/ui/popover'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function DesktopContextMenu({children}: {children: React.ReactNode}) {
	const [show, setShow] = useState(false)
	const contentRef = useRef<HTMLDivElement>(null)
	const anchorRef = useRef<HTMLDivElement>(null)
	const {params, addLinkSearchParams} = useQueryParams()
	const isShowingDialog = params.get('dialog') !== null

	return (
		<>
			<ContextMenu modal={false}>
				<ContextMenuTrigger disabled={isShowingDialog}>{children}</ContextMenuTrigger>
				<ContextMenuContent ref={contentRef}>
					<ContextMenuItem asChild>
						<Link to='/edit-widgets'>{t('desktop.context-menu.edit-widgets')}</Link>
					</ContextMenuItem>
					<ContextMenuItem
						onSelect={() => {
							// get bounding box
							const {top, left} = contentRef.current!.getBoundingClientRect()
							anchorRef.current!.style.top = `${top}px`
							anchorRef.current!.style.left = `${left}px`
							// Delay because otherwise just blinks into existence then disappears
							setTimeout(() => setShow(true), 200)
						}}
					>
						{t('desktop.context-menu.change-wallpaper')}
					</ContextMenuItem>
					<ContextMenuItem asChild className={contextMenuClasses.item.rootDestructive}>
						<Link to={{search: addLinkSearchParams({dialog: 'logout'})}}>{t('desktop.context-menu.logout')}</Link>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<Popover open={show} onOpenChange={(open) => setShow(open)}>
				<PopoverAnchor className='fixed' ref={anchorRef} />
				{/* `relative` fixes Safari paint bug caused by the `mask-image` property in the `WallpaperPicker` not playing well with the popover `transform: translate()`. On hovering the close button, Safari would jump the wallpaper picker in the wrong spot. */}
				<PopoverContent align='start' className='relative py-2.5 pl-1.5 pr-5'>
					<CloseButton className='absolute right-2 top-2' />
					<WallpaperPicker maxW={300} />
				</PopoverContent>
			</Popover>
		</>
	)
}

const CloseButton = ({className}: {className: string}) => (
	<PopoverClose
		className={cn(
			'rounded-full opacity-30 outline-none ring-white/60 transition-opacity hover:opacity-40 focus-visible:opacity-40 focus-visible:ring-2',
			className,
		)}
	>
		<RiCloseCircleFill className='h-4 w-4' />
		<span className='sr-only'>{t('close')}</span>
	</PopoverClose>
)
