import {
	createContext,
	ReactNode,
	RefObject,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'
import {usePreviousDistinct} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {Wallpaper23VideoSources} from '@/components/wallpaper-23-video-sources'
import {useDocumentHidden} from '@/hooks/use-document-hidden'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {IS_IPHONE_BROWSER, keyBy} from '@/utils/misc'
import {tw} from '@/utils/tw'

import {wallpapers as wallpaperDefinitions, type WallpaperId} from '../../../umbreld/source/modules/user/wallpapers'

export type WallpaperAvifTier = 'large' | 'medium' | 'small' | 'thumbnails'

export function getWallpaperJpgUrl(id: WallpaperId) {
	return `/assets/wallpapers/${id}.jpg`
}

export const wallpapers = wallpaperDefinitions.map((wallpaper) => ({
	...wallpaper,
	url: getWallpaperJpgUrl(wallpaper.id),
}))
export type Wallpaper = (typeof wallpapers)[number]
export const wallpaperIds = wallpapers.map((wallpaper) => wallpaper.id)
export const wallpapersKeyed = keyBy(wallpapers, 'id')

export function getWallpaperAvifUrl(wallpaper: Wallpaper | typeof nullWallpaper, tier: WallpaperAvifTier) {
	return `/assets/wallpapers/generated-avif/${tier}/${wallpaper.id}.avif`
}

export function WallpaperAvifSource({
	wallpaper,
	tier,
}: {
	wallpaper: Wallpaper | typeof nullWallpaper
	tier: WallpaperAvifTier
}) {
	// While the remote wallpaper is still resolving we hold `nullWallpaper`, whose id is
	// undefined. A <source> is picked on `type` support alone — never on whether the file
	// loads — so emitting `.../undefined.avif` would commit an AVIF-capable browser to a
	// 404 with no fallback to the sibling <img>.
	if (!wallpaper.id) return null
	return <source type='image/avif' srcSet={getWallpaperAvifUrl(wallpaper, tier)} />
}

const wallpaperAvifLargeWidths: Partial<Record<string, number>> = {
	// The original artwork is 1920×1080; do not label an upscale as a 2880px source.
	'14': 1920,
}

export function getWallpaperAvifSrcSet(wallpaper: Wallpaper | typeof nullWallpaper) {
	const largeWidth = (wallpaper.id && wallpaperAvifLargeWidths[wallpaper.id]) || 2880
	return [
		`${getWallpaperAvifUrl(wallpaper, 'medium')} 1440w`,
		`${getWallpaperAvifUrl(wallpaper, 'large')} ${largeWidth}w`,
	].join(', ')
}

const wallpaperSizes = '100vw'

function FullWallpaperAvifSources({wallpaper}: {wallpaper: Wallpaper | typeof nullWallpaper}) {
	return (
		<>
			{/* object-cover scales landscape wallpapers by viewport height in portrait, so always use the largest tier there. */}
			<source media='(orientation: portrait)' type='image/avif' srcSet={getWallpaperAvifUrl(wallpaper, 'large')} />
			<source type='image/avif' srcSet={getWallpaperAvifSrcSet(wallpaper)} sizes={wallpaperSizes} />
		</>
	)
}

export {type WallpaperId}

// ---

const nullWallpaper = {
	id: undefined,
	url: '',
	brandColorHsl: '0 0% 50%',
} as const

type WallpaperType = {
	wallpaper: Wallpaper | typeof nullWallpaper
	isLoading: boolean
	prevWallpaper: Wallpaper | undefined
	setWallpaperId: (id: WallpaperId) => void
	wallpaperFullyVisible: boolean
	setWallpaperFullyVisible: () => void
	setWallpaperLoaded: (url: string) => void
	setWallpaperLoadFailed: () => void
	wallpaperLoadedUrl: string | undefined
	/** The full-res wallpaper media — Glass surfaces refract from it on browsers without backdrop-filter: url() */
	wallpaperImgRef: RefObject<HTMLImageElement | HTMLVideoElement | null>
	/** A static full-size wallpaper image for surfaces that should not sample a video wallpaper. */
	staticWallpaperImgRef: RefObject<HTMLImageElement | null>
}

const WallPaperContext = createContext<WallpaperType>(null as any)

type WallpaperVideoPauseType = {
	/** Whether the desktop's wallpaper video is held still, e.g. while a sheet covers the desktop. */
	paused: boolean
	setPaused: (paused: boolean) => void
}

// Separate from WallPaperContext so toggling it re-renders only the wallpaper
// video and whoever holds it, not every useWallpaper() consumer.
const WallpaperVideoPauseContext = createContext<WallpaperVideoPauseType | null>(null)

function WallpaperVideoPauseProvider({children}: {children: ReactNode}) {
	const [paused, setPaused] = useState(false)
	return <WallpaperVideoPauseContext value={{paused, setPaused}}>{children}</WallpaperVideoPauseContext>
}

function useWallpaperVideoPause() {
	const ctx = useContext(WallpaperVideoPauseContext)
	if (!ctx) throw new Error('useWallpaperVideoPause must be used within WallpaperProvider')
	return ctx
}

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

export function WallpaperProviderConnected({children}: {children: ReactNode}) {
	const remote = useRemoteWallpaper()

	const remoteWallpaper = remote.wallpaper

	// We want to avoid showing a wallpaper and then changing it later, unless we already had one cached locally
	// since that's most likely going to be the right one. But after the remote call returns, we show the remote
	// one if it returns (usually when user is logged in), and otherwise we show either the local one.
	// The default one is loaded when nothing is in local storage yet.
	const wallpaper = remote.isLoading ? nullWallpaper : remoteWallpaper || nullWallpaper

	return (
		<WallpaperProvider wallpaper={wallpaper} onWallpaperChange={(w) => remote.setWallpaperId(w.id)}>
			{children}
		</WallpaperProvider>
	)
}

export function WallpaperProvider({
	wallpaper,
	onWallpaperChange,
	children,
}: {
	wallpaper: Wallpaper | typeof nullWallpaper
	onWallpaperChange: (wallpaper: Wallpaper) => void
	children: ReactNode
}) {
	const [isLoading, setIsLoading] = useState(true)
	const [wallpaperFullyVisible, setWallpaperFullyVisible] = useState(false)
	const [wallpaperLoadedUrl, setWallpaperLoadedUrl] = useState<string>()
	const wallpaperImgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
	const staticWallpaperImgRef = useRef<HTMLImageElement | null>(null)

	const prevId = usePreviousDistinct(wallpaper.id)

	useWallpaperCssVars(wallpaper.id)
	useWallpaperHeight()

	useLayoutEffect(() => {
		if (wallpaper.id === prevId) return
		setWallpaperFullyVisible(false)
		setIsLoading(true)
		setWallpaperLoadedUrl(undefined)
	}, [wallpaper.id, prevId])

	return (
		<WallPaperContext
			value={{
				wallpaper,
				isLoading,
				prevWallpaper: (prevId && wallpapersKeyed[prevId]) || undefined,
				setWallpaperId: (id: WallpaperId) => {
					onWallpaperChange(wallpapersKeyed[id])
				},
				wallpaperFullyVisible,
				setWallpaperFullyVisible: () => setWallpaperFullyVisible(true),
				setWallpaperLoaded: (url) => {
					setWallpaperLoadedUrl(url)
					setIsLoading(false)
				},
				setWallpaperLoadFailed: () => {
					setWallpaperLoadedUrl(undefined)
					setIsLoading(false)
					setWallpaperFullyVisible(true)
				},
				wallpaperLoadedUrl,
				wallpaperImgRef,
				staticWallpaperImgRef,
			}}
		>
			<WallpaperVideoPauseProvider>{children}</WallpaperVideoPauseProvider>
		</WallPaperContext>
	)
}

// Dark enough to sit behind white browser chrome text, light enough to carry the wallpaper's hue
const THEME_COLOR_LIGHTNESS = 12
const THEME_COLOR_FALLBACK = '#000000'

export function useWallpaperCssVars(wallpaperId?: WallpaperId) {
	const {brandColorHsl} = wallpaperId ? wallpapersKeyed[wallpaperId] : nullWallpaper
	// No wallpaper means no hue to borrow: stay black rather than tint from the null wallpaper's grey
	const themeColorHsl = wallpaperId ? brandHslWithLightness(brandColorHsl, THEME_COLOR_LIGHTNESS) : undefined

	// Tints the browser's own chrome to match the wallpaper. The meta tag covers
	// browsers that honor it; Safari 26 ignores it and instead samples the background
	// of the page's edge-to-edge fixed layers (the full wallpaper) and the body, which
	// both read `--wallpaper-theme-color`.
	useLayoutEffect(() => {
		const el = document.documentElement
		if (themeColorHsl) el.style.setProperty('--wallpaper-theme-color', themeColorHsl)
		else el.style.removeProperty('--wallpaper-theme-color')
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', themeColorHsl ? `hsl(${themeColorHsl})` : THEME_COLOR_FALLBACK)
	}, [themeColorHsl])

	useLayoutEffect(() => {
		const el = document.documentElement
		el.style.setProperty('--color-brand', brandColorHsl)
		el.style.setProperty('--color-brand-lighter', brandHslLighter(brandColorHsl))
		el.style.setProperty('--color-brand-lightest', brandHslLightest(brandColorHsl))
		const settingsToneLightnesses = [62, 48, 34, 20, 10, 2]
		settingsToneLightnesses.forEach((lightness, index) => {
			el.style.setProperty(`--settings-tone-${index + 1}`, brandHslWithLightness(brandColorHsl, lightness))
		})
		el.style.setProperty('--settings-tone-cold', brandHslWithLightness(brandColorHsl, 90))
		el.style.setProperty('--settings-tone-temperature-border', brandHslWithLightness(brandColorHsl, 10))
		el.style.setProperty('--settings-tone-hot', brandHslWithLightness(brandColorHsl, 10))
	}, [brandColorHsl])
}

// Safari on an iPhone can show the wallpaper under its bottom bar (see
// useWallpaperUnderBrowserBar), so there the wallpaper is as tall as the screen.
// Everywhere else it covers the viewport with the browser's bars tucked away.
function useWallpaperHeight() {
	useLayoutEffect(() => {
		if (!IS_IPHONE_BROWSER) return
		const el = document.documentElement
		const update = () => {
			// The screen's sides stay put when the phone turns
			const sideways = window.innerWidth > window.innerHeight
			const height = sideways ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
			el.style.setProperty('--wallpaper-height', `${height}px`)
		}
		update()
		window.addEventListener('resize', update)
		return () => {
			window.removeEventListener('resize', update)
			el.style.removeProperty('--wallpaper-height')
		}
	}, [])
}

/**
 * Get the wallpaper from the user's settings. However, we want to preserve the wallpaper after logout locally so they see it when they log in again.
 */
export const useWallpaper = () => {
	const ctx = useContext(WallPaperContext)
	if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
	return ctx
}

/**
 * Holds the desktop's wallpaper video (wallpaper 23) still while `paused` is true.
 * A sheet leaves only the wallpaper's margins visible, and decoding a video behind
 * it costs ~35% of a CPU core wherever the browser lacks a hardware decoder for
 * the chosen codec. The video resumes as soon as `paused` turns false or the
 * caller unmounts.
 */
export function usePauseWallpaperVideo(paused: boolean) {
	const {setPaused} = useWallpaperVideoPause()

	useEffect(() => {
		if (!paused) return
		setPaused(true)
		return () => setPaused(false)
	}, [paused, setPaused])
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
	const {
		wallpaper,
		prevWallpaper,
		isLoading,
		wallpaperFullyVisible,
		setWallpaperFullyVisible,
		setWallpaperLoaded,
		setWallpaperLoadFailed,
		wallpaperImgRef,
		staticWallpaperImgRef,
	} = useWallpaper()
	const {paused: videoPaused} = useWallpaperVideoPause()

	if (!wallpaper || !wallpaper.id) return null

	return (
		<>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
				<FadeInImg
					key={wallpaper.url + '-loading'}
					src={wallpaper.url}
					// Stays fixed under Safari's bar on Home (see index.css): scaled up, it would make the page wider than the window
					className={cn(
						'pointer-events-none fixed inset-0 w-full scale-125 object-cover object-center blur-[var(--wallpaper-blur)] duration-700',
						isPreview && 'absolute h-full',
						!isPreview && 'h-(--wallpaper-height)',
						className,
					)}
				/>
			</picture>
			{!stayBlurred &&
				(wallpaper.id === '23' ? (
					<FullWallpaperVideo
						key={wallpaper.url}
						wallpaper={wallpaper}
						isLoading={isLoading}
						isPreview={isPreview}
						className={className}
						wallpaperImgRef={isPreview ? undefined : wallpaperImgRef}
						staticWallpaperImgRef={isPreview ? undefined : staticWallpaperImgRef}
						paused={!isPreview && videoPaused}
						onLoad={setWallpaperLoaded}
						onLoadFailure={setWallpaperLoadFailed}
						onAnimationEnd={setWallpaperFullyVisible}
					/>
				) : (
					<FullWallpaperImage
						key={wallpaper.url}
						wallpaper={wallpaper}
						isLoading={isLoading}
						isPreview={isPreview}
						className={className}
						wallpaperImgRef={isPreview ? undefined : wallpaperImgRef}
						staticWallpaperImgRef={isPreview ? undefined : staticWallpaperImgRef}
						onLoad={setWallpaperLoaded}
						onLoadFailure={setWallpaperLoadFailed}
						onAnimationEnd={setWallpaperFullyVisible}
					/>
				))}
			{/* Put this last so that we can see it exiting over the new wallpaper */}
			{prevWallpaper && !wallpaperFullyVisible && (
				<picture key={prevWallpaper.url}>
					<FullWallpaperAvifSources wallpaper={prevWallpaper} />
					<img
						src={prevWallpaper.url}
						alt=''
						aria-hidden='true'
						data-wallpaper-layer={isPreview ? undefined : ''}
						className={cn(
							'pointer-events-none fixed inset-0 w-full animate-out object-cover object-center duration-700 fill-mode-both fade-out zoom-out-125',
							isPreview && 'absolute h-full',
							!isPreview && 'h-(--wallpaper-height)',
							className,
						)}
					/>
				</picture>
			)}
			{/* {isLoading && <div className='fixed left-0 top-0 '>Loading...</div>} */}
		</>
	)
}

type FullWallpaperImageProps = {
	wallpaper: Wallpaper
	isLoading: boolean
	isPreview?: boolean
	className?: string
	wallpaperImgRef?: RefObject<HTMLImageElement | HTMLVideoElement | null>
	staticWallpaperImgRef?: RefObject<HTMLImageElement | null>
	onLoad: (url: string) => void
	onLoadFailure: () => void
	onAnimationEnd: () => void
}

function FullWallpaperImage({
	wallpaper,
	isLoading,
	isPreview,
	className,
	wallpaperImgRef,
	staticWallpaperImgRef,
	onLoad,
	onLoadFailure,
	onAnimationEnd,
}: FullWallpaperImageProps) {
	const [loadAttempt, setLoadAttempt] = useState<'responsive' | 'jpeg' | 'failed'>('responsive')
	const setImageRef = useCallback(
		(image: HTMLImageElement | null) => {
			if (wallpaperImgRef) wallpaperImgRef.current = image
			if (staticWallpaperImgRef) staticWallpaperImgRef.current = image
		},
		[staticWallpaperImgRef, wallpaperImgRef],
	)

	if (loadAttempt === 'failed') return null

	return (
		<picture>
			{loadAttempt === 'responsive' && <FullWallpaperAvifSources wallpaper={wallpaper} />}
			<FadeInImg
				key={loadAttempt}
				ref={setImageRef}
				src={wallpaper.url}
				data-wallpaper-full=''
				data-wallpaper-layer={isPreview ? undefined : ''}
				className={cn(
					// Opaque bg because sometimes we want to show the wallpaper before it's loaded, and over other elements.
					// It's the theme color rather than black because Safari 26 tints its chrome from this layer's background.
					tw`pointer-events-none fixed inset-0 w-full animate-in bg-[hsl(var(--wallpaper-theme-color,0_0%_0%))] object-cover object-center duration-700 fade-in`,
					isPreview && 'absolute h-full',
					!isPreview && 'h-(--wallpaper-height)',
					className,
				)}
				style={{
					// Mount immediately so the browser can fetch its chosen candidate, then reveal only after it loads.
					animation: isLoading ? 'none' : 'animate-unblur 0.7s',
				}}
				onLoad={(event) => onLoad(event.currentTarget.currentSrc)}
				onError={() => {
					if (loadAttempt === 'responsive') {
						setLoadAttempt('jpeg')
						return
					}
					setLoadAttempt('failed')
					onLoadFailure()
				}}
				onAnimationEnd={onAnimationEnd}
			/>
		</picture>
	)
}

// Lets the sheet's 200ms enter animation land before the wallpaper's motion stops.
const VIDEO_PAUSE_DELAY_MS = 250

function FullWallpaperVideo(props: FullWallpaperImageProps & {paused: boolean}) {
	const {
		wallpaper,
		isLoading,
		isPreview,
		className,
		wallpaperImgRef,
		staticWallpaperImgRef,
		paused,
		onLoad,
		onAnimationEnd,
	} = props
	const loadNotifiedRef = useRef(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const setVideoRef = useCallback(
		(video: HTMLVideoElement | null) => {
			videoRef.current = video
			if (wallpaperImgRef) wallpaperImgRef.current = video
		},
		[wallpaperImgRef],
	)

	// Nothing sees the video while a sheet covers the desktop or the tab is in the
	// background, so stop decoding it. Resuming is immediate: the frames are buffered.
	const documentHidden = useDocumentHidden()
	const shouldPause = paused || documentHidden
	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		if (!shouldPause) {
			// Rejects when a pause() lands before playback starts; nothing to handle
			if (video.paused) video.play().catch(() => {})
			return
		}
		const timeout = setTimeout(() => {
			// A video that hasn't shown a frame yet is left to `handlePlaying`:
			// pausing it now would cancel autoplay and strand the loaded signal
			if (loadNotifiedRef.current) video.pause()
		}, VIDEO_PAUSE_DELAY_MS)
		return () => clearTimeout(timeout)
	}, [shouldPause])
	const handlePlaying = useCallback(() => {
		if (!loadNotifiedRef.current) {
			loadNotifiedRef.current = true
			onLoad(wallpaper.url)
		}
		// Covers a first frame that arrived after the timer above, and playback the
		// browser resumed on its own (e.g. iOS returning to the foreground)
		if (shouldPause) videoRef.current?.pause()
	}, [onLoad, shouldPause, wallpaper.url])
	const setStaticImageRef = useCallback(
		(image: HTMLImageElement | null) => {
			if (staticWallpaperImgRef) staticWallpaperImgRef.current = image
		},
		[staticWallpaperImgRef],
	)

	return (
		<>
			{staticWallpaperImgRef && (
				<img
					ref={setStaticImageRef}
					src={wallpaper.url}
					alt=''
					aria-hidden='true'
					data-wallpaper-static-source=''
					data-wallpaper-layer={isPreview ? undefined : ''}
					className={cn(
						'pointer-events-none fixed inset-0 w-full object-cover object-center opacity-0',
						isPreview && 'absolute h-full',
						!isPreview && 'h-(--wallpaper-height)',
						className,
					)}
				/>
			)}
			<video
				ref={setVideoRef}
				autoPlay
				loop
				muted
				playsInline
				disablePictureInPicture
				preload='auto'
				poster={wallpaper.url}
				aria-hidden='true'
				data-wallpaper-full=''
				data-wallpaper-layer={isPreview ? undefined : ''}
				className={cn(
					// Theme color bg for the same Safari 26 chrome tinting as the image above
					tw`pointer-events-none fixed inset-0 w-full animate-in bg-[hsl(var(--wallpaper-theme-color,0_0%_0%))] object-cover object-center opacity-100 transition-opacity duration-700 fade-in`,
					isPreview && 'absolute h-full',
					!isPreview && 'h-(--wallpaper-height)',
					className,
				)}
				style={{
					animation: isLoading ? 'none' : 'animate-unblur 0.7s',
				}}
				onPlaying={handlePlaying}
				onAnimationEnd={onAnimationEnd}
			>
				<Wallpaper23VideoSources />
			</video>
		</>
	)
}

function useRemoteWallpaper(onSuccess?: (id: WallpaperId) => void) {
	// Refetching causes lots of failed calls to the backend on bare pages before we're logged in.
	const userQ = trpcReact.user.wallpaper.useQuery(undefined, {
		retry: false,
	})
	const wallpaperQId = userQ.data?.id

	// Handle the onSuccess side effect
	useEffect(() => {
		if (userQ.isSuccess && wallpaperQId && arrayIncludes(wallpaperIds, wallpaperQId)) {
			onSuccess?.(wallpaperQId)
		}
	}, [userQ.isSuccess, wallpaperQId, onSuccess])

	const utils = trpcReact.useUtils()
	const userMut = trpcReact.user.set.useMutation({
		onSuccess: () => {
			utils.user.get.invalidate()
			utils.user.wallpaper.invalidate()
		},
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

export const LIGHTEN_AMOUNT = 8
function brandHslWithLightness(hsl: string, lightness: number) {
	const [h, saturation] = hsl.split(' ')
	return `${h} ${saturation} ${lightness}%`
}

function brandHslLighterByAmount(hsl: string, amount: number) {
	const tokens = hsl.split(' ')
	const h = tokens[0]
	const s = parseFloat(tokens[1])
	const l = parseFloat(tokens[2].replace('%', ''))
	const lLighter = l > 100 ? 100 : l + amount
	return `${h} ${s}% ${lLighter}%`
}

export function brandHslLighter(hsl: string) {
	return brandHslLighterByAmount(hsl, LIGHTEN_AMOUNT)
}
export function brandHslLightest(hsl: string) {
	return brandHslLighterByAmount(hsl, LIGHTEN_AMOUNT * 2)
}
