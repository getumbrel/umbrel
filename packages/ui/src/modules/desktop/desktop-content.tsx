import {motion, Variant} from 'motion/react'
import {useMemo} from 'react'
import {useLocation} from 'react-router-dom'

import {useMachines} from '@/features/machines/hooks/use-machines'
import type {Machine} from '@/features/machines/types'
import {useShortcuts, type Shortcut} from '@/hooks/use-shortcuts'
import {useWidgets} from '@/hooks/use-widgets'
import {SEARCH_DOCK_GAP} from '@/modules/floating-island/lane'
import {Widget} from '@/modules/widgets'
import {WidgetContainer} from '@/modules/widgets/shared/shared'
import {WidgetSlot} from '@/modules/widgets/shared/widget-row'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

import {AppGrid} from './app-grid/app-grid'
import {AppIconConnected, AppLabel} from './app-icon'
import {Search} from './desktop-misc'
import {DockSpacer} from './dock'
import {Header} from './header'
import {useHomeFit} from './home-fit'
import {MachineIcon} from './machine-icon'
import {ShortcutIcon} from './shortcut-icon'

// How the desktop presents for the current route: shown on the homescreen,
// lifted away under the widget editor, and hidden outright (no transition)
// under a sheet. Shared with the welcome desktop so both behave the same.
type DesktopVariant = 'default' | 'edit-widgets' | 'overlayed'

export const desktopVariants: Record<DesktopVariant, Variant> = {
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

export function useDesktopVariant(): DesktopVariant {
	const {pathname} = useLocation()
	return pathname === '/' ? 'default' : pathname.startsWith('/edit-widgets') ? 'edit-widgets' : 'overlayed'
}

// One of the account's enabled widgets as it appears in the homescreen row:
// the app's live widget once the app is ready, its state until then. Shared
// with the welcome desktop so a fresh account sees its real selection there.
export function desktopWidgetNode(widget: ReturnType<typeof useWidgets>['selected'][number]) {
	return (
		<motion.div
			key={widget.id}
			layout
			// No opacity animation — backdrop-filter on widgets can't be smoothly
			// faded (browsers skip compositing it at opacity 0, causing a flash).
			exit={{
				opacity: 0,
			}}
		>
			<WidgetSlot
				id={widget.id}
				// Get the app name from the endpoint
				label={widget.app.name}
			>
				{widget.app.state === 'ready' ? (
					<Widget appId={widget.app.id} config={widget} />
				) : (
					<WidgetContainer className='grid place-items-center rounded-17 text-13 text-white/50 sm:rounded-20'>
						<AppLabel state={widget.app.state} />
					</WidgetContainer>
				)}
			</WidgetSlot>
		</motion.div>
	)
}

export function DesktopContent({onSearchClick}: {onSearchClick?: () => void}) {
	const variant = useDesktopVariant()
	const fit = useHomeFit()

	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	const {userApps, isLoading} = useApps()
	const widgets = useWidgets()
	const {shortcuts} = useShortcuts()

	// Machines pinned to the homescreen consume the owner-only global cache.
	const {machines} = useMachines({enabled: getQuery.data?.role === 'owner'})
	const pinnedMachines = useMemo(() => machines.filter((machine) => machine.pinned), [machines])

	// Merge apps, shortcuts and pinned machines into a single alphabetically sorted list
	type GridItem =
		| {type: 'app'; id: string; name: string}
		| {type: 'shortcut'; shortcut: Shortcut}
		| {type: 'machine'; machine: Machine}

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

		for (const machine of pinnedMachines) {
			items.push({type: 'machine', machine})
		}

		const itemName = (item: GridItem) => {
			if (item.type === 'app') return item.name
			if (item.type === 'shortcut') return item.shortcut.title
			return item.machine.name
		}
		// Numeric so that "App 2" comes before "App 10"
		items.sort((a, b) => itemName(a).localeCompare(itemName(b), undefined, {numeric: true}))

		return items
	}, [userApps, shortcuts, pinnedMachines])

	if (isLoading || widgets.isLoading) return null
	if (!userApps) return null
	if (!name) return null

	return (
		<>
			<motion.div
				className='flex h-full w-full flex-col items-center justify-between'
				variants={desktopVariants}
				animate={variant}
				initial={{opacity: 1}}
				transition={{duration: 0.15, ease: 'easeOut'}}
			>
				<div style={{paddingTop: 'var(--home-gap)'}} />
				<Header userName={name} inline={fit.inlineHeader} />
				<div style={{paddingTop: 'var(--home-gap)'}} />
				<div className='flex w-full grow overflow-hidden'>
					<AppGrid
						widgets={widgets.selected.map(desktopWidgetNode)}
						apps={gridItems.map((item, i) => (
							<motion.div
								key={item.type === 'app' ? item.id : item.type === 'shortcut' ? item.shortcut.url : item.machine.id}
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
								{item.type === 'app' ? (
									<AppIconConnected appId={item.id} />
								) : item.type === 'shortcut' ? (
									<ShortcutIcon shortcut={item.shortcut} />
								) : (
									<MachineIcon machine={item.machine} />
								)}
							</motion.div>
						))}
					/>
				</div>
				<Search onClick={onSearchClick} visible={variant === 'default'} />
				{/* The floating islands' row shares this gap */}
				<div style={{paddingTop: SEARCH_DOCK_GAP}} />
				<DockSpacer />
			</motion.div>
		</>
	)
}
