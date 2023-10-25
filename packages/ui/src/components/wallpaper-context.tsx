import {keyBy} from 'lodash-es'
import {createContext, useContext, useLayoutEffect} from 'react'

import {useLocalStorage2} from '@/hooks/use-local-storage2'

type WallpaperT = {
	id: string
	label: string
	url: string
	brandColorHsl: string
	brandColorLighterHsl: string
}

export const wallpapers = [
	{
		id: 'water-dark',
		label: 'Dark water',
		url: '/wallpapers/water-dark.jpg',
		brandColorHsl: '204 100% 41%',
		brandColorLighterHsl: '204 83% 50%',
	},
	{
		id: 'mountain-sunset',
		label: 'Mountain sunset',
		url: '/wallpapers/mountain-sunset.jpg',
		brandColorHsl: '259 100% 59%',
		brandColorLighterHsl: '259 100% 64%',
	},
	{
		id: 'purple-mountain-range',
		label: 'Purple mountain range',
		url: '/wallpapers/purple-mountain-range.jpg',
		brandColorHsl: '236 100% 60%',
		brandColorLighterHsl: '236 100% 70%',
	},
	{
		id: 'top-green-road',
		label: 'Aerial winding road',
		url: '/wallpapers/top-green-road.jpg',
		brandColorHsl: '48 100% 36%',
		brandColorLighterHsl: '48 100% 26%',
	},
	{
		id: 'abstract-purple',
		label: 'Abstract purple',
		url: '/wallpapers/abstract-purple.jpg',
		brandColorHsl: '300 100% 50%',
		brandColorLighterHsl: '300 100% 63%',
	},
	{
		id: 'desert-mountains',
		label: 'Desert mountains',
		url: '/wallpapers/desert-mountains.jpg',
		brandColorHsl: '189 100% 35%',
		brandColorLighterHsl: '189 100% 40%',
	},
	{
		id: 'gradient-neutral',
		label: 'Neutral Gradient',
		url: '/wallpapers/gradient-neutral.svg',
		brandColorHsl: '0 0% 0%',
		brandColorLighterHsl: '0 0% 0%',
	},
	{
		id: 'gradient-blue',
		label: 'Blue Gradient',
		url: '/wallpapers/gradient-blue.svg',
		brandColorHsl: '248 80% 60%',
		brandColorLighterHsl: '248 80% 63%',
	},
	{
		id: 'gradient-green',
		label: 'Green Gradient',
		url: '/wallpapers/gradient-green.svg',
		brandColorHsl: '137 90% 30%',
		brandColorLighterHsl: '137 100% 63%',
	},
	{
		id: 'gradient-red',
		label: 'Red Gradient',
		url: '/wallpapers/gradient-red.svg',
		brandColorHsl: '0 90% 30%',
		brandColorLighterHsl: '0 100% 63%',
	},
	{
		id: 'gradient-fire',
		label: 'Fire Gradient',
		url: '/wallpapers/gradient-fire.svg',
		brandColorHsl: '30 90% 30%',
		brandColorLighterHsl: '30 100% 63%',
	},
] as const satisfies readonly WallpaperT[]

export const wallpapersKeyed = keyBy(wallpapers, 'id') as {
	[K in (typeof wallpapers)[number]['id']]: WallpaperT
}

type WallpaperId = (typeof wallpapers)[number]['id']

// ---

type WallpaperContextT = {
	wallpaper: WallpaperT
	setWallpaperId: (wallpaperId: WallpaperId) => void
}

const WallpaperContext = createContext<WallpaperContextT | null>(null)

const nullWallpaper = {
	id: 'none',
	label: 'None',
	url: '',
	brandColorHsl: '0 0 0',
	brandColorLighterHsl: '0 0 0',
}

export function WallpaperProvider({children}: {children: React.ReactNode}) {
	const [wallpaperId, setWallpaperId] = useLocalStorage2<WallpaperId>('wallpaperId', 'water-dark')

	const wallpaper = wallpaperId ? wallpapersKeyed[wallpaperId] : nullWallpaper

	useLayoutEffect(() => {
		const el = document.documentElement
		if (!el) return
		el.style.setProperty('--color-brand', wallpaper.brandColorHsl)
		el.style.setProperty('--color-brand-lighter', wallpaper.brandColorLighterHsl)
	}, [wallpaper.brandColorHsl, wallpaper.brandColorLighterHsl])

	if (!wallpaperId) return

	return (
		<WallpaperContext.Provider
			value={{
				wallpaper,
				setWallpaperId: (id: WallpaperId) => setWallpaperId(id),
			}}
		>
			{children}
		</WallpaperContext.Provider>
	)
}

export const useWallpaper = () => {
	const ctx = useContext(WallpaperContext)
	if (ctx === null) {
		throw new Error('useWallpaper must be used inside WallpaperProvider')
	}
	return ctx
}

export function Wallpaper() {
	const {wallpaper} = useWallpaper()

	return (
		<div
			className='pointer-events-none fixed inset-0 bg-cover bg-center duration-700 animate-in fade-in zoom-in-110'
			style={{
				backgroundImage: `url(${wallpaper.url})`,
			}}
		/>
	)
}
