import {motion, Variant} from 'motion/react'
import {useMemo} from 'react'
import {useLocation} from 'react-router-dom'

import {useShortcuts, type Shortcut} from '@/hooks/use-shortcuts'
import {useWidgets} from '@/hooks/use-widgets'
import {Widget} from '@/modules/widgets'
import {WidgetContainer} from '@/modules/widgets/shared/shared'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

import {AppGrid} from './app-grid/app-grid'
import {AppIconConnected, AppLabel} from './app-icon'
import {Search} from './desktop-misc'
import {DockSpacer} from './dock'
import {Header} from './header'
import {ShortcutIcon} from './shortcut-icon'

export function DesktopContent({onSearchClick}: {onSearchClick?: () => void}) {
	const {pathname} = useLocation()

	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	const {userApps, isLoading} = useApps()
	const widgets = useWidgets()
	const {shortcuts} = useShortcuts()

	// Merge apps and shortcuts into a single alphabetically sorted list
	type GridItem = {type: 'app'; id: string; name: string} | {type: 'shortcut'; shortcut: Shortcut}

	const gridItems = useMemo(() => {
		const items: GridItem[] = []

		if (userApps) {
			for (const app of userApps) {
				items.push({type: 'app', id: app.id, name: app.name})
			}
		}

		if (shortcuts) {
			for (const shortcut of shortcuts) {
				items.push({type: 'shortcut', shortcut})
			}
		}

		items.sort((a, b) => {
			const nameA = a.type === 'app' ? a.name : a.shortcut.title
			const nameB = b.type === 'app' ? b.name : b.shortcut.title
			return nameA.localeCompare(nameB)
		})

		return items
	}, [userApps, shortcuts])

	if (isLoading || widgets.isLoading) return null
	if (!userApps) return null
	if (!name) return null

	type DesktopVariant = 'default' | 'edit-widgets' | 'overlayed'
	const variant: DesktopVariant =
		pathname === '/' ? 'default' : pathname.startsWith('/edit-widgets') ? 'edit-widgets' : 'overlayed'

	const variants: Record<DesktopVariant, Variant> = {
		default: {
			opacity: 1,
		},
		'edit-widgets': {
			translateY: -20,
			opacity: 0,
		},
		overlayed: {
			translateY: 0,
			opacity: 0,
			transition: {
				duration: 0,
			},
		},
	}

	return (
		<>
			<motion.div
				className='flex h-full w-full flex-col items-center justify-between'
				variants={variants}
				animate={variant}
				initial={{opacity: 1}}
				transition={{duration: 0.15, ease: 'easeOut'}}
			>
				<div className='pt-6 md:pt-8' />
				<Header userName={name} />
				<div className='pt-6 md:pt-8' />
				<div className='flex w-full grow overflow-hidden'>
					<AppGrid
						widgets={widgets.selected.map((widget) => (
							<motion.div
								key={widget.id}
								layout
								// No opacity animation — backdrop-filter on widgets can't be smoothly
								// faded (browsers skip compositing it at opacity 0, causing a flash).
								exit={{
									opacity: 0,
								}}
							>
								<WidgetWrapper
									// Get the app name from the endpoint
									label={widget.app.name}
								>
									{widget.app.state === 'ready' ? (
										<Widget appId={widget.app.id} config={widget} />
									) : (
										<WidgetContainer className='grid place-items-center text-13 text-white/50'>
											<AppLabel state={widget.app.state} />
										</WidgetContainer>
									)}
								</WidgetWrapper>
							</motion.div>
						))}
						apps={gridItems.map((item, i) => (
							<motion.div
								key={item.type === 'app' ? item.id : item.shortcut.url}
								layout
								initial={{
									opacity: 0,
									scale: 0.75,
								}}
								animate={{
									opacity: 1,
									scale: 1,
								}}
								exit={{
									opacity: 0,
									scale: 0.75,
								}}
								transition={{
									delay: (widgets.selected.length * 1.5 + i) * 0.01,
									duration: 0.2,
									ease: 'easeOut',
								}}
							>
								{item.type === 'app' ? <AppIconConnected appId={item.id} /> : <ShortcutIcon shortcut={item.shortcut} />}
							</motion.div>
						))}
					/>
				</div>
				<Search onClick={onSearchClick} />
				<div className='pt-6' />
				<DockSpacer />
			</motion.div>
		</>
	)
}
