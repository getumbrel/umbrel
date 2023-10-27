import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link, useLocation} from 'react-router-dom'

import UmbrelLogo from '@/assets/umbrel-logo'
import {useWallpaper} from '@/modules/desktop/wallpaper-context'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

export function Header() {
	const {t} = useTranslation()
	const getQuery = trpcReact.user.get.useQuery()

	const name = getQuery.data?.name

	// Always rendering the entire component to avoid layout thrashing
	return (
		<div className={cn('relative z-10', name ? 'animate-in fade-in' : 'invisible')}>
			<div className='flex flex-col items-center gap-4 px-4'>
				<UmbrelLogo
					// Need to remove `view-transition-name` because it causes the logo to
					// briefly appear over the sheets between page transitions
					ref={(ref) => {
						ref?.style?.removeProperty('view-transition-name')
					}}
				/>
				<h1 className='text-center text-2xl font-bold md:text-5xl'>
					{
						{
							morning: t('desktop.greeting.morning', {name}),
							afternoon: t('desktop.greeting.afternoon', {name}),
							evening: t('desktop.greeting.evening', {name}),
						}[getPartofDay()]
					}
				</h1>
			</div>
		</div>
	)
}

// https://stackoverflow.com/a/13245058
function getPartofDay() {
	const today = new Date()
	const curHr = today.getHours()

	if (curHr < 12) {
		return 'morning'
	} else if (curHr < 18) {
		return 'afternoon'
	} else {
		return 'evening'
	}
}

export function Search() {
	const {t} = useTranslation()
	return (
		<div className='select-none rounded-full bg-neutral-600/10 px-3 py-2.5 text-12 leading-inter-trimmed text-white/75 backdrop-blur-lg'>
			{t('search')} <span className='text-white/20'>⌘K</span>
		</div>
	)
}

export function AppGridGradientMasking() {
	const {pathname} = useLocation()
	const [showGradient, setShowGradient] = useState(false)

	// Delay because sometimes wallpaper tears on first render
	useEffect(() => {
		if (pathname !== '/') {
			setShowGradient(false)
			return
		}
		sleep(1000).then(() => setShowGradient(true))
	}, [pathname])

	// Only show gradient on home page
	// Also, when transitioning between pages, this gradient can get in the way, so we hide it without animating it
	if (pathname !== '/') return null

	if (!showGradient) return null

	return (
		<>
			<GradientMaskSide side='left' />
			<GradientMaskSide side='right' />
		</>
	)
}

function GradientMaskSide({side}: {side: 'left' | 'right'}) {
	const {wallpaper} = useWallpaper()

	return (
		<div
			// Ideally, we'd match the `block` visibility to the arrow buttons, but that would require a lot of work.
			// Ideally we'd use a breakpoint based on the CSS var --app-max-w, but that's not possible
			className='pointer-events-none fixed top-0 hidden h-full bg-cover bg-center md:block'
			style={{
				// For debugging:
				// backgroundColor: "red",
				backgroundImage: `url(${wallpaper.url})`,
				backgroundAttachment: 'fixed',
				WebkitMaskImage: `linear-gradient(to ${side}, transparent, black)`,
				[side]: 'calc((100% - (var(--page-w) + var(--apps-padding-x) * 2)) / 2)',
				width: 'var(--apps-padding-x)',
			}}
		/>
	)
}

export function DesktopContextMenu({children}: {children: React.ReactNode}) {
	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem asChild>
					<Link to='/edit-widgets'>Edit widgets</Link>
				</ContextMenuItem>
				<ContextMenuItem asChild>
					<Link to='/settings'>Change wallpaper</Link>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
