import {useEffect, useLayoutEffect} from 'react'
import {arrayIncludes} from 'ts-extras'

import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

type WallpaperT = {
	id: string
	label: string
	url: string
	brandColorHsl: string
	brandColorLighterHsl: string
	source?: string
	photographer?: string
}

export const wallpapers = [
	{
		id: 'water-dark',
		label: 'Dark water',
		url: '/wallpapers/water-dark.jpg',
		brandColorHsl: '204 100% 41%',
		brandColorLighterHsl: '204 83% 50%',
		source: 'https://unsplash.com/photos/body-of-water-during-daytime-hRemch0ZDwI',
		photographer: 'Conor Sexton',
	},
	{
		id: 'mountain-sunset',
		label: 'Mountain sunset',
		url: '/wallpapers/mountain-sunset.jpg',
		brandColorHsl: '259 100% 59%',
		brandColorLighterHsl: '259 100% 64%',
		source: 'https://unsplash.com/photos/silhouette-of-trees-during-sunset-JUFuI-kBtas',
		photographer: 'Federico Bottos',
	},
	{
		id: 'purple-mountain-range',
		label: 'Purple mountain range',
		url: '/wallpapers/purple-mountain-range.jpg',
		brandColorHsl: '236 100% 60%',
		brandColorLighterHsl: '236 100% 70%',
		source: 'https://unsplash.com/photos/mountain-range-rnKqWvO80Y4',
		photographer: 'Michael D',
	},
	{
		id: 'top-green-road',
		label: 'Aerial winding road',
		url: '/wallpapers/top-green-road.jpg',
		brandColorHsl: '48 100% 36%',
		brandColorLighterHsl: '48 100% 26%',
		source: 'https://www.pexels.com/photo/aerial-photo-of-empty-meandering-road-in-between-forest-2876511/',
		photographer: 'kellymlacy',
	},
	{
		id: 'desert-mountains',
		label: 'Desert mountains',
		url: '/wallpapers/desert-mountains.jpg',
		brandColorHsl: '189 100% 35%',
		brandColorLighterHsl: '189 100% 40%',
		source: 'https://unsplash.com/photos/an-aerial-view-of-a-desert-at-sunset-YeLs9lJDx9M',
		photographer: 'NEOM',
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

type WallpaperId = (typeof wallpapers)[number]['id']
const wallpaperIds = wallpapers.map((w) => w.id)
export const wallpapersKeyed = keyBy(wallpapers, 'id')

// ---

const nullWallpaper = {
	id: 'none',
	label: 'None',
	url: '',
	brandColorHsl: '0 0 0',
	brandColorLighterHsl: '0 0 0',
}

const DEFAULT_WALLPAPER_ID: WallpaperId = 'desert-mountains'

/**
 * Get the wallpaper from the user's settings. However, we want to preserve the wallpaper after logout locally so they see it when they log in again.
 */
export const useWallpaper = () => {
	const userQ = trpcReact.user.get.useQuery(undefined, {
		// Refetching causes lots of failed calls to the backend on bare pages before we're logged in.
		retry: false,
	})
	const wallpaperQId = userQ.data?.wallpaper
	const wallpaperId = arrayIncludes(wallpaperIds, wallpaperQId) ? wallpaperQId : DEFAULT_WALLPAPER_ID

	// trpc
	const ctx = trpcReact.useContext()
	const userMut = trpcReact.user.set.useMutation({onSuccess: () => ctx.user.get.invalidate()})
	const setWallpaperId = (id: WallpaperId) => userMut.mutate({wallpaper: id})

	const hasData = userQ.data && !userQ.isError
	const wallpaper = hasData ? wallpapersKeyed[wallpaperId] : nullWallpaper
	// const wallpaper = nullWallpaper

	const [localWallpaperId, setLocalWallpaperId] = useLocalStorage2('wallpaperId', wallpaperId)
	const localWallpaper = localWallpaperId ? wallpapersKeyed[localWallpaperId] : wallpaper

	useEffect(() => {
		hasData && setLocalWallpaperId(wallpaperId)
	}, [hasData, setLocalWallpaperId, wallpaperId])

	return {wallpaper, localWallpaper, setWallpaperId}
}

export function WallpaperInjector() {
	const {wallpaper, localWallpaper} = useWallpaper()

	const w = (wallpaper !== nullWallpaper && wallpaper) || localWallpaper || DEFAULT_WALLPAPER_ID

	useLayoutEffect(() => {
		const el = document.documentElement
		el.style.setProperty('--color-brand', w.brandColorHsl)
		el.style.setProperty('--color-brand-lighter', w.brandColorLighterHsl)
	}, [w.brandColorHsl, w.brandColorLighterHsl])

	return null
}

export function Wallpaper() {
	const {wallpaper, localWallpaper} = useWallpaper()

	return (
		<div
			className='pointer-events-none fixed inset-0 bg-cover bg-center duration-700 animate-in fade-in zoom-in-110'
			style={{
				backgroundImage: `url(${wallpaper.url || localWallpaper.url})`,
			}}
		/>
	)
}
