import {AnimatePresence, motion} from 'motion/react'
import {useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useTranslation} from 'react-i18next'
import {useLocation} from 'react-router-dom'
import {useWindowSize} from 'react-use'

import {useCmdkOpen} from '@/components/cmdk'
import {Orb, useOrbPalette} from '@/components/orb/orb'
import {darkTooltipClass} from '@/components/ui/dark-tooltip'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {islandSizes} from '@/modules/floating-island/bare-island'
import {LANE_GAP, SEARCH_HEIGHT, searchShift, searchWidth, useLaneStore} from '@/modules/floating-island/lane'
import {useImmersiveDialogOpen} from '@/providers/immersive-dialog'
import {useWallpaper} from '@/providers/wallpaper'
import {focusRingOnWallpaperClass} from '@/utils/element-classes'
import {cmdOrCtrl, platform} from '@/utils/misc'

// Roughly the full pill's width, for deciding when the shared row is crowded
const SEARCH_FULL_WIDTH = 140
const condenseTransition = {type: 'spring' as const, stiffness: 400, damping: 40}

// The Home screen's search pill, with a small orb of the wallpaper's colour
// that stays still until hovered.
//
// It shares its row with the floating islands (modules/floating-island/lane.ts):
// while any are up it steps aside so the pair stays centred, and when the row
// gets crowded it shrinks to just its orb. On phones it joins the islands'
// sideways-scrolling row as that orb, and steps out while a card is open so
// the card can take the row.
export function Search({onClick, visible = true}: {onClick?: () => void; visible?: boolean}) {
	const {t} = useTranslation()
	const isMobile = useIsSmallMobile()
	const {open} = useCmdkOpen()
	const palette = useOrbPalette()
	const [hovered, setHovered] = useState(false)
	const {width: windowWidth} = useWindowSize()

	const islandCount = useLaneStore((state) => state.islandCount)
	const expandedCount = useLaneStore((state) => state.expandedCount)
	const setSearchShown = useLaneStore((state) => state.setSearchShown)
	const rowSlot = useLaneStore((state) => state.searchSlot)
	const isImmersiveDialogOpen = useImmersiveDialogOpen()

	const rowWidth = SEARCH_FULL_WIDTH + islandCount * (islandSizes.minimized.width + LANE_GAP)
	const condensed = islandCount > 0 && (isMobile || rowWidth > windowWidth - 32)
	const steppedOut = isMobile && expandedCount > 0
	const shown = visible && !isImmersiveDialogOpen && !steppedOut
	// Phones with islands up: Search lives in their scrolling row
	const inRow = isMobile && islandCount > 0 && rowSlot !== null

	useLayoutEffect(() => setSearchShown(shown), [shown, setSearchShown])
	useLayoutEffect(() => () => setSearchShown(false), [setSearchShown])

	// Live width for the lane, so the islands sit exactly beside it. The pill
	// remounts when it moves into or out of the phone row, so measure again.
	const buttonRef = useRef<HTMLButtonElement>(null)
	useLayoutEffect(() => {
		const el = buttonRef.current
		if (!el) return
		const measure = () => searchWidth.set(el.offsetWidth)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => {
			observer.disconnect()
			searchWidth.set(0)
		}
	}, [inRow, shown])

	const pill = (
		<motion.button
			ref={buttonRef}
			aria-label={t('search')}
			className={cn(
				darkTooltipClass,
				'group flex animate-in items-center py-2 text-13 leading-inter-trimmed transition-[background-color] duration-300 fill-mode-both fade-in hover:bg-white/10 active:scale-[0.97] active:bg-white/5 motion-reduce:active:scale-100',
				focusRingOnWallpaperClass,
			)}
			// Condensed, the 20px orb and 8px either side make a 38px circle
			initial={false}
			animate={{paddingLeft: condensed ? 8 : 10, paddingRight: condensed ? 8 : 12}}
			transition={condenseTransition}
			onClick={onClick}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<Orb size={20} palette={palette} live={hovered && !open} />
			<motion.span
				className='overflow-hidden'
				initial={false}
				animate={{width: condensed ? 0 : 'auto', opacity: condensed ? 0 : 1}}
				transition={{width: condenseTransition, opacity: {duration: condensed ? 0.1 : 0.2}}}
				aria-hidden={condensed}
			>
				{/* The space after the orb lives inside, so it folds away with the label */}
				<span className='flex items-center gap-2 pl-2 whitespace-nowrap'>
					{t('search')}
					{/* TODO: ideally, centralize shortcut preview and shortcut event listener so always in sync */}
					{platform() !== 'other' && !isMobile && (
						<span className='text-white/40 pointer-coarse:hidden'>{cmdOrCtrl()}K</span>
					)}
				</span>
			</motion.span>
		</motion.button>
	)

	// Coming back to Home with islands up, they first slide over from the
	// centre to make room: Search waits a beat so it never fades in under one
	const waitForIslands = islandCount > 0 ? 0.14 : 0

	if (inRow) {
		return (
			<>
				{/* Holds Search's place in the desktop column so the app grid keeps its size */}
				<div style={{height: SEARCH_HEIGHT}} />
				{createPortal(
					<AnimatePresence mode='popLayout'>
						{shown && (
							<motion.div
								key='search'
								layout='position'
								className='pointer-events-auto'
								initial={{opacity: 0}}
								animate={{opacity: 1, transition: {duration: 0.15, ease: 'easeOut', delay: waitForIslands}}}
								exit={{opacity: 0, transition: {duration: 0.1}}}
							>
								{pill}
							</motion.div>
						)}
					</AnimatePresence>,
					rowSlot,
				)}
			</>
		)
	}

	const hidden = steppedOut || (!visible && islandCount > 0)

	return (
		<motion.div
			className='z-10'
			style={{x: searchShift}}
			initial={false}
			animate={{opacity: hidden ? 0 : 1}}
			transition={{duration: 0.15, ease: 'easeOut', delay: hidden ? 0 : waitForIslands}}
			inert={steppedOut}
		>
			{pill}
		</motion.div>
	)
}

export function AppGridGradientMasking() {
	const {pathname} = useLocation()

	// Only show gradient on home page
	// Also, when transitioning between pages, this gradient can get in the way, so we hide it without animating it
	if (pathname !== '/') return null

	return (
		<>
			<GradientMaskSide side='left' />
			<GradientMaskSide side='right' />
		</>
	)
}

function GradientMaskSide({side}: {side: 'left' | 'right'}) {
	const {wallpaper, wallpaperLoadedUrl, wallpaperFullyVisible, isLoading} = useWallpaper()

	if (!wallpaperLoadedUrl || !wallpaperFullyVisible || isLoading) return null
	// The fade repaints the wallpaper image over the sliding content, which can
	// never line up with the live video wallpaper's current frame — the strip's
	// opaque edge then shows as a hard seam during page slides
	if (wallpaper?.id === '23') return null

	return (
		<div
			// Ideally, we'd match the `block` visibility to the arrow buttons, but that would require a lot of work.
			// Ideally we'd use a breakpoint based on the CSS var --app-max-w, but that's not possible
			className='pointer-events-none fixed top-0 hidden h-full bg-cover bg-center md:block'
			style={{
				// For debugging:
				// backgroundColor: 'red',
				// Reuse the browser-selected AVIF candidate instead of fetching the JPG fallback again.
				backgroundImage: `url(${wallpaperLoadedUrl})`,
				backgroundAttachment: 'fixed',
				WebkitMaskImage: `linear-gradient(to ${side}, transparent, black)`,
				[side]: 'calc((100% - (var(--page-w) + var(--apps-padding-x) * 2)) / 2)',
				width: 'var(--apps-padding-x)',
			}}
		/>
	)
}
