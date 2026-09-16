import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react'

import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'

import {orbPaletteCssBackground, orbPaletteFromHsl, type OrbPalette} from './orb-palette'
import {createOrbRenderer, type OrbRenderer} from './orb-renderer'

// The wallpaper's orb. `live` keeps the swirl moving; a still orb draws once
// and again whenever its colours or size change (the Home pill's, until it is
// hovered). Where WebGL is missing, or the person asked for less motion, a
// gradient of the same palette stands in.

export function useOrbPalette(): OrbPalette {
	const {wallpaper} = useWallpaper()
	const hsl = wallpaper.id ? wallpaper.brandColorHsl : undefined
	const [palette, setPalette] = useState(() => orbPaletteFromHsl(hsl))
	const hslRef = useRef(hsl)
	useEffect(() => {
		if (hslRef.current === hsl) return
		hslRef.current = hsl
		setPalette(orbPaletteFromHsl(hsl))
	}, [hsl])
	return palette
}

export function Orb({
	size,
	palette,
	live = true,
	energy = 0,
	pulseKey = 0,
	seed = 0,
	className,
	style,
	ref,
}: {
	size: number
	palette: OrbPalette
	live?: boolean
	energy?: number
	// Bump to flash the orb once
	pulseKey?: number
	seed?: number
	className?: string
	style?: CSSProperties
	ref?: React.Ref<HTMLDivElement>
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const rendererRef = useRef<OrbRenderer | undefined>(undefined)
	const [fallback, setFallback] = useState(false)
	const reducedMotion = useReducedMotion()
	const animate = live && !reducedMotion

	useLayoutEffect(() => {
		const host = hostRef.current
		if (!host) return
		let renderer: OrbRenderer | undefined
		try {
			renderer = createOrbRenderer(host, {dpr: Math.min(window.devicePixelRatio || 1, 2), seed})
		} catch {
			// A driver or context quirk must never take the desktop down with it
			renderer = undefined
		}
		if (!renderer) {
			setFallback(true)
			return
		}
		rendererRef.current = renderer
		return () => {
			renderer.dispose()
			rendererRef.current = undefined
		}
	}, [seed])

	useLayoutEffect(() => {
		const renderer = rendererRef.current
		if (!renderer) return
		renderer.setSize(size)
		renderer.setPalette(palette)
		if (!animate) renderer.frame()
	}, [size, palette, animate])

	useEffect(() => {
		const renderer = rendererRef.current
		if (!renderer) return
		if (animate) renderer.start()
		else renderer.stop()
		return () => renderer.stop()
	}, [animate])

	useEffect(() => {
		rendererRef.current?.setEnergy(energy)
	}, [energy])

	useEffect(() => {
		if (pulseKey > 0) rendererRef.current?.pulse()
	}, [pulseKey])

	return (
		<div
			ref={ref}
			aria-hidden='true'
			className={cn('pointer-events-none relative shrink-0 rounded-full', className)}
			style={{width: size, height: size, ...style}}
		>
			{fallback ? (
				<span className='absolute inset-0 rounded-full' style={{background: orbPaletteCssBackground(palette)}} />
			) : (
				<div ref={hostRef} className='size-full' />
			)}
		</div>
	)
}

// A still, CSS-only orb for tiny glyphs (the "Everywhere" domain icon)
export function OrbGlyph({palette, size, className}: {palette: OrbPalette; size: number; className?: string}) {
	return (
		<span
			aria-hidden='true'
			className={cn('inline-block shrink-0 rounded-full', className)}
			style={{
				width: size,
				height: size,
				background: orbPaletteCssBackground(palette),
				boxShadow: 'inset 0 -1px 2px rgb(0 0 0 / 0.25), inset 0 1px 1px rgb(255 255 255 / 0.35)',
			}}
		/>
	)
}

function useReducedMotion() {
	const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
	useEffect(() => {
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const onChange = () => setReduced(query.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])
	return reduced
}
