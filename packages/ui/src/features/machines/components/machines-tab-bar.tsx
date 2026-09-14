import {LayoutGrid, Plus} from 'lucide-react'
import {motion} from 'motion/react'
import {useEffect} from 'react'
import {NavLink, useLocation} from 'react-router-dom'

import {useFadeScroller} from '@/components/fade-scroller'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {OsIcon} from '@/features/machines/components/os-icon'
import {layoutMorphTransition, machinePath, MACHINES_ADD_PATH, MACHINES_PATH} from '@/features/machines/constants'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

// Same minimal surface + settings-card edge shine as the machine control
// buttons. The transparent border reserves the active ring's 1px so pills
// never shift when selection changes (it also supersedes the material's own
// hairline, whose look survives via the box-shadow shine).
const tabClass = tw`settings-edge-material flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent bg-white/6 text-14 font-semibold -tracking-2 whitespace-nowrap text-white/85 transition-[background-color,border-color,color,transform] duration-200 hover:bg-white/12 hover:text-white focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20 active:scale-95`
const tabActiveClass = tw`border-white/60 bg-white/14 text-white hover:bg-white/14`

// Each pill animates its own position during the column-width morph (the nav
// itself is full-width and a scroll container, so animating it does nothing)
const MotionNavLink = motion.create(NavLink)

function Tab({
	to,
	end,
	label,
	children,
	className,
	ref,
	...props
}: {
	to: string
	end?: boolean
	label?: string
	children: React.ReactNode
	className?: string
	ref?: React.Ref<HTMLAnchorElement>
} & Omit<
	React.ComponentPropsWithoutRef<typeof NavLink>,
	'to' | 'className' | 'children' | 'style' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>) {
	return (
		<MotionNavLink
			layout='position'
			transition={layoutMorphTransition}
			to={to}
			end={end}
			ref={ref}
			aria-label={label}
			className={({isActive}: {isActive: boolean}) => cn(tabClass, isActive && tabActiveClass, className)}
			{...props}
		>
			{children}
		</MotionNavLink>
	)
}

export function MachinesTabBar({machines}: {machines: Machine[]}) {
	const {ref: navRef, scrollerClass} = useFadeScroller('x', false, 24)
	const {pathname} = useLocation()

	// One horizontally scrollable row (no wrapping); keep the active tab in view
	useEffect(() => {
		navRef.current
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({inline: 'nearest', block: 'nearest', behavior: 'smooth'})
	}, [pathname])

	return (
		<nav
			ref={navRef}
			// py-1/-mt-1 reserve focus-ring room inside the scroll clip without
			// shifting layout; -mb-3 tightens the layout's gap-5 below the pills
			// to a visual 12px. pr-2 keeps the last pill off the clip edge when
			// scrolled fully right (below md the column edge is the viewport edge,
			// so a negative right margin here would overflow the page sideways)
			className={cn(
				scrollerClass,
				'-mt-1 -mb-3 flex scroll-px-6 items-center gap-2 overflow-x-auto py-1 pr-2 [scrollbar-width:none] md:pr-0 [&::-webkit-scrollbar]:hidden',
			)}
		>
			<DarkTooltip label={t('machines.all-machines')} side='bottom'>
				<Tab to={MACHINES_PATH} end label={t('machines.all-machines')} className='w-10'>
					<LayoutGrid className='size-5' />
				</Tab>
			</DarkTooltip>
			<DarkTooltip label={t('machines.add-machine')} side='bottom'>
				<Tab to={MACHINES_ADD_PATH} label={t('machines.add-machine')} className='w-10'>
					<Plus className='size-5' />
				</Tab>
			</DarkTooltip>
			{machines.map((machine) => (
				<Tab key={machine.id} to={machinePath(machine.id)} className='animate-in px-3 duration-300 fade-in'>
					<OsIcon osId={machine.osId} state={machine.state} className='size-6' />
					<span className='max-w-40 truncate'>{machine.name}</span>
				</Tab>
			))}
		</nav>
	)
}
