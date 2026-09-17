import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation} from 'react-router-dom'

import {useCmdkOpen} from '@/components/cmdk'
import {Orb, useOrbPalette} from '@/components/orb/orb'
import {darkTooltipClass} from '@/components/ui/dark-tooltip'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'
import {focusRingOnWallpaperClass} from '@/utils/element-classes'
import {cmdOrCtrl, platform} from '@/utils/misc'

// The Home screen's search pill, with a small orb of the wallpaper's colour
// that stays still until hovered
export function Search({onClick}: {onClick?: () => void}) {
	const {t} = useTranslation()
	const isMobile = useIsSmallMobile()
	const {open} = useCmdkOpen()
	const palette = useOrbPalette()
	const [hovered, setHovered] = useState(false)

	return (
		<button
			className={cn(
				darkTooltipClass,
				'group z-10 flex animate-in items-center gap-2 py-2 pr-3 pl-2.5 text-13 leading-inter-trimmed transition-[background-color,transform] duration-300 fill-mode-both fade-in hover:bg-white/10 active:scale-[0.97] active:bg-white/5 motion-reduce:active:scale-100',
				focusRingOnWallpaperClass,
			)}
			onClick={onClick}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<Orb size={20} palette={palette} live={hovered && !open} />
			{/* TODO: ideally, centralize shortcut preview and shortcut event listener so always in sync */}
			{t('search')}
			{platform() !== 'other' && !isMobile && <span className='text-white/40'>{cmdOrCtrl()}K</span>}
		</button>
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
