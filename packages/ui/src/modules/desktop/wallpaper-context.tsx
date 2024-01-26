import {useEffect, useLayoutEffect} from 'react'
import {arrayIncludes} from 'ts-extras'

import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

type WallpaperT = {
	id: string
	url: string
	brandColorHsl: string
}

export const wallpapers = [
	{
		id: '1',
		url: '/wallpapers/1.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '2',
		url: '/wallpapers/2.jpg',
		brandColorHsl: '6 56% 54%',
	},
	{
		id: '3',
		url: '/wallpapers/3.jpg',
		brandColorHsl: '22 88% 40%',
	},
	{
		id: '4',
		url: '/wallpapers/4.jpg',
		brandColorHsl: '198 100% 31%',
	},
	{
		id: '5',
		url: '/wallpapers/5.jpg',
		brandColorHsl: '202 100% 33%',
	},
	{
		id: '6',
		url: '/wallpapers/6.jpg',
		brandColorHsl: '160 100% 27%',
	},
	{
		id: '7',
		url: '/wallpapers/7.jpg',
		brandColorHsl: '79 100% 25%',
	},
	{
		id: '8',
		url: '/wallpapers/8.jpg',
		brandColorHsl: '185 100% 29%',
	},
	{
		id: '9',
		url: '/wallpapers/9.jpg',
		brandColorHsl: '359 64% 62%',
	},
	{
		id: '10',
		url: '/wallpapers/10.jpg',
		brandColorHsl: '18 75% 52%',
	},
	{
		id: '11',
		url: '/wallpapers/11.jpg',
		brandColorHsl: '185 100% 29%',
	},
	{
		id: '12',
		url: '/wallpapers/12.jpg',
		brandColorHsl: '332 84% 47%',
	},
	{
		id: '13',
		url: '/wallpapers/13.jpg',
		brandColorHsl: '194 81% 39%',
	},
	{
		id: '14',
		url: '/wallpapers/14.jpg',
		brandColorHsl: '328 87% 49%',
	},
	{
		id: '15',
		url: '/wallpapers/15.jpg',
		brandColorHsl: '32 100% 36%',
	},
	{
		id: '16',
		url: '/wallpapers/16.jpg',
		brandColorHsl: '265 100% 42%',
	},
	{
		id: '17',
		url: '/wallpapers/17.jpg',
		brandColorHsl: '184 100% 25%',
	},
	{
		id: '18',
		url: '/wallpapers/18.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '19',
		url: '/wallpapers/19.jpg',
		brandColorHsl: '204 100% 41%',
	},
	{
		id: '20',
		url: '/wallpapers/20.jpg',
		brandColorHsl: '259 100% 59%',
	},
	{
		id: '21',
		url: '/wallpapers/21.jpg',
		brandColorHsl: '12 78% 50%',
	},
] as const satisfies readonly WallpaperT[]

export type WallpaperId = (typeof wallpapers)[number]['id']
const wallpaperIds = wallpapers.map((w) => w.id)
export const wallpapersKeyed = keyBy(wallpapers, 'id')

// ---

const nullWallpaper = {
	id: 'none',
	url: '',
	brandColorHsl: '0 0 0',
}

const DEFAULT_WALLPAPER_ID: WallpaperId = '1'

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
		el.style.setProperty('--color-brand-lighter', brandHslLighter(w.brandColorHsl))
	}, [w.brandColorHsl])

	return null
}

export function Wallpaper({className}: {className?: string}) {
	const {wallpaper, localWallpaper} = useWallpaper()

	return (
		<div
			className={cn(
				'pointer-events-none fixed inset-0 bg-cover bg-center duration-700 animate-in fade-in zoom-in-110',
				className,
			)}
			style={{
				backgroundImage: `url(${wallpaper.url || localWallpaper.url})`,
			}}
		/>
	)
}

const LIGHTEN_AMOUNT = 8
export function brandHslLighter(hsl: string) {
	const tokens = hsl.split(' ')
	const h = tokens[0]
	const s = parseFloat(tokens[1])
	const l = parseFloat(tokens[2].replace('%', ''))
	const lLighter = l > 100 ? 100 : l + LIGHTEN_AMOUNT
	return `${h} ${s}% ${lLighter}%`
}
