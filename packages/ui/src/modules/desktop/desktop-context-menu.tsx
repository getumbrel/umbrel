import {useRef, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {WallpaperPicker} from '@/routes/settings/_components/wallpaper-picker'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {Popover, PopoverAnchor, PopoverClose, PopoverContent} from '@/shadcn-components/ui/popover'
import {cn} from '@/shadcn-lib/utils'

export function DesktopContextMenu({children}: {children: React.ReactNode}) {
	const [show, setShow] = useState(false)
	const contentRef = useRef<HTMLDivElement>(null)
	const anchorRef = useRef<HTMLDivElement>(null)

	return (
		<>
			<ContextMenu modal={false}>
				<ContextMenuTrigger>{children}</ContextMenuTrigger>
				<ContextMenuContent ref={contentRef}>
					<ContextMenuItem asChild>
						<Link to='/edit-widgets'>Edit widgets</Link>
					</ContextMenuItem>
					<ContextMenuItem
						onSelect={() => {
							console.log(contentRef.current)
							// get bounding box
							const {top, left} = contentRef.current!.getBoundingClientRect()
							anchorRef.current!.style.top = `${top}px`
							anchorRef.current!.style.left = `${left}px`
							// Delay because otherwise just blinks into existence then disappears
							setTimeout(() => setShow(true), 200)
						}}
					>
						Change wallpaper
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<Popover open={show} onOpenChange={(open) => setShow(open)}>
				<PopoverAnchor className='fixed' ref={anchorRef} />
				<PopoverContent align='start' className='py-2.5 pl-1.5 pr-5'>
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
		<span className='sr-only'>Close</span>
	</PopoverClose>
)
