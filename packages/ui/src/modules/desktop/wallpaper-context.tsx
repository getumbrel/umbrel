import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useState} from 'react'
import {usePreviousDistinct} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {keyBy, preloadImage} from '@/utils/misc'
import {tw} from '@/utils/tw'

type WallpaperT = {
	id: string | undefined
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
export const wallpapersKeyed = keyBy(wallpapers, 'id')
const wallpaperIds = wallpapers.map((w) => w.id)

// ---

const DEFAULT_WALLPAPER_ID: WallpaperId = '1'

const nullWallpaper = {
	id: undefined,
	url: '',
	brandColorHsl: '0 0% 100%',
} as const satisfies WallpaperT

type WallpaperType = {
	wallpaper: WallpaperT
	isLoading: boolean
	prevWallpaper: WallpaperT | undefined
	setWallpaperId: (id: WallpaperId) => void
	wallpaperFullyVisible: boolean
	setWallpaperFullyVisible: () => void
}

const WallPaperContext = createContext<WallpaperType>(null as any)

/*
Scenarios:
- First load, nothing in localStorage yet
- Waiting for remote call
	* Always show either local or null wallpaper
- Remote and local are different
	* Always 
- Logged out vs. logged in
	* When logged out, use the local storage value
	* After logged in, use remote value
*/

export function WallpaperProvider({children}: {children: React.ReactNode}) {
	const [localWallpaperId, setLocalWallpaperId] = useLocalStorage2<WallpaperId>('wallpaperId')
	const remote = useRemoteWallpaper(setLocalWallpaperId)
	const [isLoading, setIsLoading] = useState(true)
	const [wallpaperFullyVisible, setWallpaperFullyVisible] = useState(false)

	const defaultWallpaper = wallpapersKeyed[DEFAULT_WALLPAPER_ID]
	const localWallpaper = localWallpaperId && wallpapersKeyed[localWallpaperId]
	const remoteWallpaper = remote.wallpaper

	// We want to avoid showing a wallpaper and then changing it later, unless we already had one cached locally
	// since that's most likely going to be the right one. But after the remote call returns, we show the remote
	// one if it returns (usually when user is logged in), and otherwise we show either the local one.
	// The default one is loaded when nothing is in local storage yet.
	const wallpaper = remote.isLoading
		? localWallpaper || nullWallpaper
		: remoteWallpaper || localWallpaper || defaultWallpaper

	const prevId = usePreviousDistinct(wallpaper.id)

	const {brandColorHsl} = wallpaper

	useLayoutEffect(() => {
		const el = document.documentElement
		el.style.setProperty('--color-brand', brandColorHsl)
		el.style.setProperty('--color-brand-lighter', brandHslLighter(brandColorHsl))
	}, [brandColorHsl])

	useLayoutEffect(() => {
		if (wallpaper.id === prevId) return
		setWallpaperFullyVisible(false)
		setIsLoading(true)

		// preload image
		preloadImage(wallpaper.url).then(() => setIsLoading(false))
	}, [wallpaper.url, wallpaper.id, prevId])

	return (
		<WallPaperContext.Provider
			value={{
				wallpaper,
				isLoading,
				prevWallpaper: (prevId && wallpapersKeyed[prevId]) || undefined,
				setWallpaperId: (id: WallpaperId) => {
					setLocalWallpaperId(id)
					remote.setWallpaperId(id)
				},
				wallpaperFullyVisible,
				setWallpaperFullyVisible: () => setWallpaperFullyVisible(true),
			}}
		>
			{children}
		</WallPaperContext.Provider>
	)
}

/**
 * Get the wallpaper from the user's settings. However, we want to preserve the wallpaper after logout locally so they see it when they log in again.
 */
export const useWallpaper = () => {
	const ctx = useContext(WallPaperContext)
	if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
	return ctx
}

export function Wallpaper({
	className,
	stayBlurred,
	isPreview,
}: {
	className?: string
	stayBlurred?: boolean
	isPreview?: boolean
}) {
	const {wallpaper, prevWallpaper, isLoading, wallpaperFullyVisible, setWallpaperFullyVisible} = useWallpaper()

	if (!wallpaper || !wallpaper.id) return null

	return (
		<>
			<FadeInImg
				key={wallpaper.url + '-loading'}
				src={`/wallpapers/generated-thumbs/${wallpaper.id}.jpg`}
				className={cn(
					'pointer-events-none fixed inset-0 h-full w-full scale-125 object-cover object-center blur-xl',
					isPreview && 'absolute',
				)}
			/>
			{!isLoading && !stayBlurred && (
				<FadeInImg
					key={wallpaper.url}
					src={wallpaper.url}
					className={cn(
						// Using black bg by default because sometimes we want to show the wallpaper before it's loaded, and over other elements
						tw`pointer-events-none fixed inset-0 h-full w-full bg-black object-cover object-center duration-700 animate-in fade-in zoom-in-125`,
						isPreview && 'absolute',
						className,
					)}
					style={{
						animation: 'animate-unblur 0.7s',
					}}
					onAnimationEnd={setWallpaperFullyVisible}
				/>
			)}
			{/* Put this last so that we can see it exiting over the new wallpaper */}
			{prevWallpaper && !wallpaperFullyVisible && (
				<div
					key={prevWallpaper.url}
					className={cn(
						'pointer-events-none fixed inset-0 bg-cover bg-center duration-700 animate-out fade-out zoom-out-125 fill-mode-both',
						isPreview && 'absolute',
						className,
					)}
					style={{
						backgroundImage: `url(${prevWallpaper.url})`,
					}}
				/>
			)}
			{/* {isLoading && <div className='fixed left-0 top-0 '>Loading...</div>} */}
		</>
	)
}

function useRemoteWallpaper(onSuccess?: (id: WallpaperId) => void) {
	// Refetching causes lots of failed calls to the backend on bare pages before we're logged in.
	const userQ = trpcReact.user.get.useQuery(undefined, {
		retry: false,
		onSuccess: (data) => {
			if (arrayIncludes(wallpaperIds, data.wallpaper)) {
				onSuccess?.(data.wallpaper)
			}
		},
	})
	const wallpaperQId = userQ.data?.wallpaper

	const ctx = trpcReact.useContext()
	const userMut = trpcReact.user.set.useMutation({
		onSuccess: () => ctx.user.get.invalidate(),
	})
	const setWallpaperId = useCallback((id: WallpaperId) => userMut.mutate({wallpaper: id}), [userMut])

	return {
		isLoading: userQ.isLoading,
		wallpaper: wallpaperQId && arrayIncludes(wallpaperIds, wallpaperQId) ? wallpapersKeyed[wallpaperQId] : undefined,
		setWallpaperId,
	}
}

/**
 * Updates local storage with the wallpaper id from the backend.
 *
 * There's a little dance that needs to happen with wallpapers. When we first load the page, we don't have the TRPC context yet, and we determine the wallpaper from
 * local storage. Usually, this id will be correct. However, if the user changed the wallpaper on another browser,
 * the local storage value will be out of date. So we load the old wallpaper and wait until the TRPC context is available to load the correct one.
 */
export function RemoteWallpaperInjector() {
	const remote = useRemoteWallpaper()
	const {wallpaper, setWallpaperId} = useWallpaper()

	const localId = wallpaper?.id
	const remoteId = remote.wallpaper?.id

	// Chance of circular dependency here, so it's important to ensure that the dependencies do not invalidate unless absolutely necessary.
	useEffect(() => {
		if (remoteId && remoteId !== localId) setWallpaperId(remoteId)
	}, [remoteId, localId, setWallpaperId])

	return null
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
