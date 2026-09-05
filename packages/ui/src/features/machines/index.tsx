import {motion} from 'motion/react'
import {Suspense, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {Outlet, useMatch, useNavigate, useParams} from 'react-router-dom'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {MachineRail} from '@/features/machines/components/machine-rail'
import {MachinesTabBar} from '@/features/machines/components/machines-tab-bar'
import {layoutMorphTransition, MACHINES_CONFIGURE_PATH, MACHINES_PATH} from '@/features/machines/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {usePauseWallpaperVideo} from '@/providers/wallpaper'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'

// Console aspect ratios (width / height). Android machines boot a phone-shaped
// 720x1560 scanout (set in umbreld's domain XML); everything else is 16:10.
const LANDSCAPE_ASPECT_RATIO = 1.6
const PHONE_ASPECT_RATIO = 720 / 1560

// Whether the machine view can afford its header: true when the console's
// natural (width-limited) height at its aspect ratio plus the full chrome —
// including the header, its gap, and the top padding the chrome would
// otherwise rise into — fits the viewport. Mirrors the --machines-chrome
// accounting on the layout column below; keep the two in sync.
function useMachineViewHeaderFits(aspectRatio: number) {
	const [fits, setFits] = useState(true)
	useEffect(() => {
		const compute = () => {
			const vw = window.innerWidth
			const xl = vw >= 1280
			const md = vw >= 768
			const contentWidth = Math.min(1600, vw) - (md ? 64 : 0)
			// xl: rail (48) + counterweight (48) + two row gaps (12) sit beside
			const consoleWidth = xl ? contentWidth - 120 : contentWidth
			const chromeWithHeader = (xl ? 170 : 230) + 50 + 20 + (md ? 32 : 16)
			setFits(window.innerHeight >= consoleWidth / aspectRatio + chromeWithHeader)
		}
		compute()
		window.addEventListener('resize', compute)
		return () => window.removeEventListener('resize', compute)
	}, [aspectRatio])
	return fits
}

// Immersive overlay over the desktop wallpaper (the desktop content fades
// itself out for any non-root route, and the dock stays mounted via the
// router layout).
export default function MachinesLayout() {
	const navigate = useNavigate()
	const {machines, isLoading} = useMachines()
	const {machineId} = useParams<{machineId: string}>()
	const [closing, setClosing] = useState(false)
	const isSettingsView = !!useMatch(`${MACHINES_PATH}/:machineId/settings`)
	const isCreateView = !!useMatch(MACHINES_CONFIGURE_PATH)
	const canImplicitlyDismiss = !isSettingsView && !isCreateView

	// Warm all in-feature lazy chunks once the feature is open so navigating
	// between pages never suspends (avoids blank flashes between views)
	useEffect(() => {
		import('@/features/machines/components/machines-index')
		import('@/features/machines/components/os-catalog')
		import('@/features/machines/components/create-machine')
		import('@/features/machines/components/machine-window')
		import('@/features/machines/components/machine-settings')
		import('@/features/files/components/mini-browser')
	}, [])

	// Fade the overlay out before actually leaving
	const close = useCallback(() => {
		setClosing(true)
		setTimeout(() => navigate('/'), 150)
	}, [navigate])

	// The overlay's live backdrop blur re-renders for every wallpaper video frame,
	// so hold the video still while it's up. Keyed on `closing` so motion is back
	// before the fade-out reveals the desktop.
	usePauseWallpaperVideo(!closing)
	const stopImplicitDismiss = (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()

	// Escape closes the overlay via the same fade-out path as the close button.
	// Routed create/settings pages own form state, so Escape must stay on those
	// pages rather than discarding edits and tearing down the entire Machines
	// overlay. Radix dialogs/menus and text fields keep their own behavior too.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented || isSettingsView || isCreateView) return
			const target = e.target as HTMLElement | null
			if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return
			close()
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [close, isCreateView, isSettingsView])

	// The machine console view gets a wider canvas than the catalog/list pages.
	// The settings sub-route carries a machineId too but is a regular page.
	const isMachineView = !!machineId && machineId !== 'new' && !isSettingsView
	const machine = isMachineView ? machines.find((machine) => machine.id === machineId) : undefined

	// The header only slides away when hiding it actually buys the console
	// height: on tall viewports a 16:10 screen is width-limited and there is
	// room for everything, so the header stays put. A phone-shaped screen is
	// always height-limited, so there it always goes.
	const isPhoneConsole = machine?.osId === 'android'
	const headerFits = useMachineViewHeaderFits(isPhoneConsole ? PHONE_ASPECT_RATIO : LANDSCAPE_ASPECT_RATIO)
	const hideHeader = isMachineView && !headerFits

	return (
		<motion.div
			initial={{opacity: 0}}
			animate={{opacity: closing ? 0 : 1}}
			transition={{duration: 0.15, ease: 'easeOut'}}
			// stable both-edges: pages taller than the viewport (catalog) and shorter
			// ones (index) would otherwise toggle the scrollbar and shift the centered
			// column; both-edges reserves symmetric gutters so it stays centered
			className='fixed inset-0 z-30 overflow-y-auto overscroll-contain bg-black/50 backdrop-blur-xl [scrollbar-gutter:stable_both-edges]'
			onClick={!closing && canImplicitlyDismiss ? close : undefined}
		>
			<motion.div
				initial={{scale: 0.985}}
				animate={{scale: closing ? 0.99 : 1}}
				transition={{duration: 0.2, ease: 'easeOut'}}
				className={cn(
					'relative z-10 mx-auto flex min-h-full w-full flex-col gap-5 pt-8 pb-4 md:px-8 md:pt-12',
					// Machine-view fixed chrome, feeding the console's Fit cap below:
					// 16px effective top padding (pt minus the chrome's rise) + tab
					// bar (32) + one gap (20) + dock spacer (74/84) + pb (16) + 2px
					// rounding cushion — the header is slid out on this route and the
					// trailing gaps are collapsed. Below xl the rail wraps under the
					// console, adding its 48px height plus the 12px row gap.
					'[--machines-chrome:230px] xl:[--machines-chrome:170px]',
					isMachineView ? 'max-w-[1600px]' : 'max-w-[1054px]',
				)}
			>
				{/* Top chrome is pinned to the narrow column's content width (1054
				   minus its 2×32px md padding) even while the console row widens to
				   1600px, so entering a machine never shifts the header or the tab
				   pills sideways. On the console route it also rises into most of
				   the column's top padding, easing on the same curve as the morph. */}
				<div
					onClick={stopImplicitDismiss}
					className={cn(
						'mx-auto flex w-full max-w-[1054px] flex-col gap-5 transition-[margin] duration-[350ms] ease-[cubic-bezier(0.32,0.72,0,1)] md:max-w-[990px]',
						hideHeader && '-mt-4 md:-mt-8',
					)}
				>
					{/* The header slides up and out on the console route — the screen
					   gets the height, and the tab bar plus Escape remain as the ways
					   back. marginBottom cancels the column gap so nothing pops when
					   it lands. */}
					<motion.div
						initial={false}
						animate={
							hideHeader
								? {height: 0, marginBottom: -20, y: -16, opacity: 0}
								: {height: 50, marginBottom: 0, y: 0, opacity: 1}
						}
						transition={layoutMorphTransition.layout}
						style={{pointerEvents: hideHeader ? 'none' : undefined}}
						aria-hidden={hideHeader}
						className='flex items-center justify-between'
					>
						<div className='flex items-center gap-3'>
							<img
								src='/assets/dock/dock-machines.webp'
								alt=''
								draggable={false}
								className='size-[50px] shrink-0 rounded-12 shadow-lg'
							/>
							<div className='flex flex-col gap-1.5'>
								<h1 className='text-17 leading-none font-semibold -tracking-2 text-white'>{t('machines')}</h1>
								<p className='text-15 leading-none -tracking-2 text-white/50'>{t('machines.tagline')}</p>
							</div>
						</div>
						<DarkTooltip label={t('close')} side='left'>
							<button onClick={close} aria-label={t('close')} className={dialogHeaderCircleButtonClass}>
								<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
							</button>
						</DarkTooltip>
					</motion.div>

					{!isLoading && machines.length > 0 && <MachinesTabBar machines={machines} />}
				</div>

				{/* One persistent container shared by every page: the dark card holding
				   the catalog/list/create form morphs into the machine screen instead
				   of unmounting, so switching views never flickers */}
				<div
					className={cn(
						'flex w-full flex-col items-start gap-3',
						// Machine view centers the (possibly height-capped) screen
						isMachineView && 'items-center xl:flex-row xl:items-start xl:justify-center',
					)}
				>
					{/* Invisible counterweight matching the rail's width, so the screen
					   itself sits dead center with the rail balancing it on the right */}
					{machine && <div aria-hidden className='hidden w-12 shrink-0 xl:block' />}
					<motion.div
						onClick={stopImplicitDismiss}
						layout
						style={{borderRadius: isMachineView ? 12 : 24}}
						transition={layoutMorphTransition}
						className={cn(
							'relative w-full min-w-0 overflow-hidden shadow-dialog',
							isMachineView ? 'flex-1 border border-white/20 bg-black' : 'bg-black/60 backdrop-blur-2xl',
							// Fit: a monitor never scrolls. Cap the width so the screen's
							// height never exceeds the viewport slice between the tab bar
							// and the dock; short-wide viewports get a narrower centered
							// screen instead of one that runs under the dock. Android gets
							// a phone-shaped 6:13 screen so its portrait display has no bars.
							isMachineView &&
								(isPhoneConsole
									? 'aspect-6/13 max-w-[calc((100dvh-var(--machines-chrome))*0.4615)]'
									: 'aspect-16/10 max-w-[calc((100dvh-var(--machines-chrome))*1.6)]'),
						)}
					>
						{/* layout='position' opts the content out of the container's FLIP scaling:
						   it snaps to its final size immediately (no stretching) while the box
						   resizes and clips around it */}
						<motion.div layout='position' transition={layoutMorphTransition} className='relative h-full w-full'>
							<Suspense>
								<Outlet />
							</Suspense>
						</motion.div>
					</motion.div>
					{machine && (
						<div className='w-full shrink-0 xl:w-auto' onClick={stopImplicitDismiss}>
							<MachineRail machine={machine} onClose={close} />
						</div>
					)}
				</div>

				{/* Machine view: no grow spacer and the dock spacer pulls up over the
				   trailing column gap, so the screen sits just above the dock */}
				{!isMachineView && <div className='grow' />}
				<DockSpacer className={cn(isMachineView && '-mt-5')} />
			</motion.div>
		</motion.div>
	)
}
