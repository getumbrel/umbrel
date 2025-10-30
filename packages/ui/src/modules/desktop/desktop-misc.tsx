import {useLocation} from 'react-router-dom'

import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {useWallpaper} from '@/providers/wallpaper'
import {t} from '@/utils/i18n'
import {cmdOrCtrl, platform} from '@/utils/misc'

export function Search({onClick}: {onClick?: () => void}) {
	const isMobile = useIsSmallMobile()
	return (
		<button
			className='z-10 select-none rounded-full border border-white/5 bg-neutral-600/20 px-3 py-2.5 text-12 leading-inter-trimmed text-white/90 backdrop-blur-sm transition-colors delay-300 duration-300 animate-in fade-in fill-mode-both hover:bg-neutral-600/30 active:bg-neutral-600/10'
			onClick={onClick}
		>
			{/* TODO: ideally, centralize shortcut preview and shortcut event listener so always in sync */}
			{t('search')} {platform() !== 'other' && !isMobile && <span className='text-white/20'>{cmdOrCtrl()}K</span>}
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
	const {wallpaper, wallpaperFullyVisible, isLoading} = useWallpaper()

	if (!wallpaperFullyVisible || isLoading) return null

	return (
		<div
			// Ideally, we'd match the `block` visibility to the arrow buttons, but that would require a lot of work.
			// Ideally we'd use a breakpoint based on the CSS var --app-max-w, but that's not possible
			className='pointer-events-none fixed top-0 hidden h-full bg-cover bg-center md:block'
			style={{
				// For debugging:
				// backgroundColor: 'red',
				backgroundImage: `url(${wallpaper.url})`,
				backgroundAttachment: 'fixed',
				WebkitMaskImage: `linear-gradient(to ${side}, transparent, black)`,
				[side]: 'calc((100% - (var(--page-w) + var(--apps-padding-x) * 2)) / 2)',
				width: 'var(--apps-padding-x)',
			}}
		/>
	)
}
