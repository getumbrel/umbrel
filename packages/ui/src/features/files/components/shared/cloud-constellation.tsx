import {ChevronRight, FolderDown, Pause, RefreshCw, ShieldCheck, TriangleAlert} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {PitchPoints} from '@/components/ui/pitch-points'
import {toast} from '@/components/ui/toast'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import type {CloudProvider} from '@/features/files/hooks/use-cloud'
import {CLOUD_SELF_TILE_BRANDS, CLOUD_WEBDAV_FLAVORS, type CloudWebDavFlavorId} from '@/features/files/utils/cloud'
import {cn} from '@/lib/utils'

export type CloudPickerSelection = {provider: CloudProvider; flavor?: CloudWebDavFlavorId}

type CloudEntry = {
	id: string
	displayName: string
	logo: string
	provider: CloudProvider
	flavor?: CloudWebDavFlavorId
}

type SatelliteSlot = {ring: 'inner' | 'outer'; angle: number; size: number}

// Consumer clouds first, then the self-hosted flavors. The same order fills
// the constellation slots and the picker grid so the morph between them is 1:1.
const TILE_ORDER = ['google-drive', 'dropbox', 'icloud', 'onedrive']
const CONSTELLATION_IDS = new Set([...TILE_ORDER, ...CLOUD_WEBDAV_FLAVORS.map(({id}) => id)])
const COMING_SOON_PROVIDER_IDS = new Set(['google-drive'])

// A coming-soon tile unlocks after seven quick taps.
const UNLOCK_TAPS = 7
const UNLOCK_TAP_WINDOW_MS = 2000

function useProviderUnlock() {
	const {t} = useTranslation()
	const [unlocked, setUnlocked] = useState<Set<string>>(() => new Set())
	// The tile currently rattling from the shake keyframes, cleared once they finish
	const [shaking, setShaking] = useState<string | null>(null)
	const taps = useRef<{id: string; count: number; at: number}>({id: '', count: 0, at: 0})

	const tap = (id: string, displayName: string) => {
		const now = Date.now()
		const previous = taps.current
		const count = previous.id === id && now - previous.at < UNLOCK_TAP_WINDOW_MS ? previous.count + 1 : 1
		taps.current = {id, count, at: now}
		if (count < UNLOCK_TAPS) {
			// The tile starts pushing back halfway there, hinting that the taps count
			if (count >= 4) setShaking(id)
			return
		}
		taps.current = {id: '', count: 0, at: 0}
		setShaking(null)
		setUnlocked((current) => new Set(current).add(id))
		toast.success(t('files-cloud.unlocked', {provider: displayName}), {area: 'files'})
	}

	return {isUnlocked: (id: string) => unlocked.has(id), shaking, tap, settleShake: () => setShaking(null)}
}

// Logos that are already full app-icon squares render edge to edge; everything
// else sits inset on a white plate, so every satellite reads as an app icon.
const SELF_TILE_LOGOS = CLOUD_SELF_TILE_BRANDS

// Two elliptical orbit rings around the umbrel, read as circles on a tilted
// plane. Slow enough to feel serene, fast enough that the motion registers
// within a modal-length glance; the rings lap each other over time.
const ORBIT_RINGS = {
	inner: {rx: 118, ry: 66, duration: 38},
	outer: {rx: 142, ry: 92, duration: 55},
}

// Starting angles (deg), filled in tile order. Same-ring satellites keep their
// relative spacing forever, so the gaps are near-even with a slight wobble:
// even enough never to bunch, uneven enough not to read as a spinner.
const SATELLITE_SLOTS: SatelliteSlot[] = [
	{ring: 'inner', angle: 205, size: 70},
	{ring: 'inner', angle: 300, size: 62},
	{ring: 'inner', angle: 35, size: 68},
	{ring: 'inner', angle: 115, size: 73},
	{ring: 'outer', angle: 265, size: 49},
	{ring: 'outer', angle: 10, size: 44},
]
const WEBDAV_SLOT: SatelliteSlot = {ring: 'outer', angle: 140, size: 42}

const PLATE_SPRING = {type: 'spring' as const, stiffness: 190, damping: 24, mass: 0.9}

// The elliptical path as keyframes, relative to the satellite's resting point
// so the loop starts and ends at zero and the morph to the picker can catch it
// anywhere mid-flight. Depth follows the vertical position: at the bottom of
// the ellipse a satellite is near (larger), at the top it is far (smaller).
// The samples are whole `transform` strings rather than separate x, y and
// scale values: animating `transform` directly lets Motion hand the loop to
// the browser's compositor, so it keeps running while the main thread is
// busy. Motion cannot animate z-index, so each satellite keeps the z of its
// starting angle.
const ORBIT_STEPS = 24
function orbitKeyframes(slot: SatelliteSlot) {
	const ring = ORBIT_RINGS[slot.ring]
	const theta = (slot.angle * Math.PI) / 180
	const samples = Array.from({length: ORBIT_STEPS + 1}, (_, i) => theta + (2 * Math.PI * i) / ORBIT_STEPS)
	const depth = (a: number) => (Math.sin(a) + 1) / 2
	return {
		baseX: ring.rx * Math.cos(theta),
		baseY: ring.ry * Math.sin(theta),
		transform: samples.map(
			(a) =>
				`translate(${ring.rx * (Math.cos(a) - Math.cos(theta))}px, ${ring.ry * (Math.sin(a) - Math.sin(theta))}px) scale(${0.85 + 0.3 * depth(a)})`,
		),
		zIndex: Math.round(4 + 12 * depth(theta)),
		duration: ring.duration,
	}
}

// A cloud logo as an app-icon plate: full-bleed for logos that are already
// square tiles, inset on white for bare marks. The corner radius tracks the
// size so small and large plates share one shape, and the layoutId lets the
// same plate travel from constellation to picker tile to the connect and
// folder steps as one continuous object; morph opts a plate out of that
// shared flight when its screen wasn't reached through the picker tile.
export function CloudLogoPlate({
	id,
	logo,
	size,
	morph = true,
	className,
}: {
	id: string
	logo: string
	size: number
	morph?: boolean
	className?: string
}) {
	const radius = Math.round(size * 0.24)
	const shared = morph && {layoutId: `cloud-logo-${id}`}
	if (SELF_TILE_LOGOS.has(id)) {
		// These SVGs bake their own corner rounding at 5/18 of their size; the
		// CSS radius only shapes the shadow silhouette to match
		return (
			<motion.img
				{...shared}
				transition={PLATE_SPRING}
				src={logo}
				alt=''
				className={cn('object-cover shadow-[0_1px_8px_rgba(0,0,0,0.35)]', className)}
				style={{width: size, height: size, borderRadius: Math.round(size * (5 / 18))}}
				draggable={false}
			/>
		)
	}
	return (
		<motion.div
			{...shared}
			transition={PLATE_SPRING}
			className={cn('flex items-center justify-center bg-white shadow-[0_1px_8px_rgba(0,0,0,0.35)]', className)}
			style={{width: size, height: size, borderRadius: radius}}
		>
			<img src={logo} alt='' className='h-[62%] w-[62%] object-contain' draggable={false} />
		</motion.div>
	)
}

// The pitch, said in three glances: what it does, how it runs, and why it is
// private. Shared by the add wizard's first run, the manage dialog's empty
// state, and the /Cloud landing view so the promise reads the same everywhere.
export function CloudPitchPoints({delay = 0.1}: {delay?: number}) {
	const {t} = useTranslation()
	return (
		<PitchPoints
			delay={delay}
			points={[
				{
					icon: FolderDown,
					title: t('files-cloud.pitch-point-download-title'),
					description: t('files-cloud.pitch-point-download-description'),
				},
				{
					icon: RefreshCw,
					title: t('files-cloud.pitch-point-modes-title'),
					description: t('files-cloud.pitch-point-modes-description'),
				},
				{
					icon: ShieldCheck,
					title: t('files-cloud.pitch-point-private-title'),
					description: t('files-cloud.pitch-point-private-description'),
				},
			]}
		/>
	)
}

// The cloud flowing into the umbrel over an intact link: the live counterpart
// of the Rewind break diagram, shared by the connect and folder steps. With
// morph on, the plate continues its shared-element flight from the picker
// tile; entries that never passed the tile (an existing account) render the
// same diagram without inheriting anyone else's position. A soft highlight
// sweeps along the link to trace the direction the files move.
export function CloudLinkDiagram({
	layoutKey,
	logo,
	morph = true,
	entrance = true,
	state = 'live',
}: {
	layoutKey: string
	logo: string
	morph?: boolean
	// The umbrel's pop-in belongs to the wizard's choreographed reveal, where
	// it lands a beat after the plate's flight; surfaces that show the diagram
	// as an established fact (the details dialog) opt out and mount it settled
	entrance?: boolean
	// A stilled link wears a glyph on the line the way the Rewind break diagram
	// wears its severed cross: a pause badge for a paused download, an alert
	// badge when the link needs the user. Only a live link carries the shine.
	state?: 'live' | 'paused' | 'alert'
}) {
	const reducedMotion = useReducedMotion() ?? false
	return (
		<div className='flex items-center gap-3'>
			<CloudLogoPlate id={layoutKey} logo={logo} size={56} morph={morph} />
			<span className='relative flex h-8 w-20 items-center overflow-hidden'>
				<span className='h-px w-full bg-linear-to-r from-white/5 via-white/25 to-white/5' />
				<ChevronRight className='absolute -right-1 size-3 text-white/30' />
				{!reducedMotion && state === 'live' && (
					<motion.span
						animate={{x: [-48, 92]}}
						transition={{duration: 1.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6}}
						className='absolute top-[15.5px] left-0 h-px w-12 bg-linear-to-r from-transparent via-brand-lightest to-transparent'
					/>
				)}
				{state !== 'live' && (
					<span className='absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-dialog-content'>
						{state === 'paused' ? (
							<Pause className='size-2.5 text-white' fill='currentColor' strokeWidth={0} />
						) : (
							<TriangleAlert className='size-3 text-white' strokeWidth={2.5} />
						)}
					</span>
				)}
			</span>
			<motion.img
				{...(morph && {layoutId: 'cloud-diagram-umbrel'})}
				initial={reducedMotion || !entrance ? false : {opacity: 0, scale: 0.85}}
				animate={{opacity: 1, scale: 1}}
				transition={{type: 'spring', stiffness: 300, damping: 24, delay: 0.1}}
				src='/assets/umbrel-ios.png'
				alt='umbrelOS'
				className='size-14 shrink-0 rounded-[13px] object-contain'
				draggable={false}
			/>
		</div>
	)
}

// The providers rendered as tiles, with webdav returned separately: it orbits
// in the constellation but demotes to a quiet footer row in the picker. When
// the webdav provider is configured, Nextcloud and ownCloud are offered as
// named flavors of it.
function cloudEntries(providers: CloudProvider[] | undefined): {
	tiles: CloudEntry[]
	webdav: CloudEntry | null
} {
	if (!providers) return {tiles: [], webdav: null}
	const entry = (provider: CloudProvider): CloudEntry => ({
		id: provider.id,
		displayName: provider.displayName,
		logo: CLOUD_PROVIDER_LOGOS[provider.id] ?? '/assets/cloud/cloud.webp',
		provider,
	})
	const known = new Set([...TILE_ORDER, 'webdav'])
	const tiles = TILE_ORDER.flatMap((id) => {
		const provider = providers.find((candidate) => candidate.id === id)
		return provider ? [entry(provider)] : []
	})
	const webdavProvider = providers.find(({id}) => id === 'webdav')
	if (webdavProvider) {
		for (const flavor of CLOUD_WEBDAV_FLAVORS) {
			tiles.push({
				id: flavor.id,
				displayName: flavor.displayName,
				logo: CLOUD_PROVIDER_LOGOS[flavor.id],
				provider: webdavProvider,
				flavor: flavor.id,
			})
		}
	}
	// Any provider the backend adds before the UI learns about it still shows up
	tiles.push(...providers.filter(({id}) => !known.has(id)).map(entry))
	return {tiles, webdav: webdavProvider ? entry(webdavProvider) : null}
}

// The cloud providers as one morphing surface. In 'pitch' view they orbit the
// umbrelOS icon on a tilted plane: many clouds, one home in the middle.
// Switching to 'picker' view sends the same elements flying into a tidy grid
// of provider tiles (with WebDAV demoted to a quiet footer row), so the
// decoration turns out to have been the interface all along.
export function CloudConstellation({
	providers,
	view,
	onSelect,
	className,
}: {
	providers: CloudProvider[] | undefined
	view: 'pitch' | 'picker'
	onSelect?: (selection: CloudPickerSelection) => void
	className?: string
}) {
	const {t} = useTranslation()
	const reducedMotion = useReducedMotion() ?? false
	const {tiles, webdav} = cloudEntries(providers)
	const isPitch = view === 'pitch'
	// The entrance stagger is tuned for whichever view mounted first: leisurely
	// for the pitch, brisk for a picker shown directly
	const mountedAsPitch = useRef(isPitch).current
	// The entrance is driven by a post-mount state flip rather than `initial`:
	// the wizard's step AnimatePresence mounts with initial={false}, which
	// silently suppresses initial-based entrances for everything mounted in
	// that same first render whenever cached queries skip the skeleton. A
	// value change in `animate` always tweens, so the satellites render
	// hidden for one frame and then play. Once flipped, later remounts (the
	// picker morph) mount straight at their visible values.
	const [entered, setEntered] = useState(reducedMotion)
	useEffect(() => {
		const frame = requestAnimationFrame(() => setEntered(true))
		return () => cancelAnimationFrame(frame)
	}, [])

	const layoutTransition = reducedMotion ? {duration: 0} : PLATE_SPRING
	const unlock = useProviderUnlock()

	const satellite = (entry: CloudEntry, slot: SatelliteSlot | undefined, index: number, isFooter = false) => {
		// The stagger applies to the mount entrance only, never to the morph.
		// On the pitch the clouds hold back until the umbrel has landed, then
		// arrive in quick succession.
		const entranceDelay = isPitch ? (mountedAsPitch ? 0.2 + index * 0.05 : 0) : mountedAsPitch ? 0 : index * 0.03
		const orbit = slot ? orbitKeyframes(slot) : undefined
		const orbiting = isPitch && !reducedMotion && orbit
		const isComingSoon = COMING_SOON_PROVIDER_IDS.has(entry.id) && !unlock.isUnlocked(entry.id)
		const isShaking = !isPitch && isComingSoon && unlock.shaking === entry.id
		return (
			// The view is part of the key: switching to the picker mounts a fresh,
			// transform-free tile that flies in from the orbiting satellite's last
			// snapshot via the shared layoutId. Animating the same element out of
			// its live orbit transforms instead double-counts the distance and
			// collapses the flight into a jump.
			<motion.button
				key={`${entry.id}-${view}`}
				layoutId={`cloud-tile-${entry.id}`}
				animate={orbiting ? {transform: orbit.transform} : undefined}
				transition={
					orbiting ? {transform: {duration: orbit.duration, repeat: Infinity, ease: 'linear'}} : layoutTransition
				}
				type='button'
				disabled={isPitch}
				aria-hidden={isPitch}
				aria-disabled={!isPitch && isComingSoon}
				onClick={() => {
					if (isComingSoon) return unlock.tap(entry.id, entry.displayName)
					onSelect?.({provider: entry.provider, ...(entry.flavor && {flavor: entry.flavor})})
				}}
				whileTap={isPitch || isComingSoon ? undefined : {scale: 0.96}}
				className={cn(
					// The resting card is barely there; hover firms it up a notch, and
					// the change lands instantly so the grid feels snappy under the cursor
					!isPitch &&
						!isFooter &&
						'flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/7 p-4 focus:outline-hidden focus-visible:border-white/10 focus-visible:bg-white/6',
					!isPitch &&
						!isFooter &&
						(isComingSoon ? 'cursor-not-allowed text-white/50' : 'hover:border-white/10 hover:bg-white/10'),
					!isPitch &&
						isFooter &&
						'col-span-2 flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/7 px-3 py-2.5 text-white/60 hover:border-white/10 hover:bg-white/6 hover:text-white focus:outline-hidden focus-visible:border-white/10 focus-visible:bg-white/6 focus-visible:text-white sm:col-span-3',
				)}
				style={
					isPitch && orbit && slot
						? {
								position: 'absolute',
								left: `calc(50% + ${orbit.baseX - slot.size / 2}px)`,
								top: `calc(50% + ${orbit.baseY - slot.size / 2}px)`,
								zIndex: orbit.zIndex,
							}
						: undefined
				}
			>
				<motion.div
					// The playful pop-in belongs to the pitch's opening moment only. A
					// constellation mounted straight into the picker (Back from connect,
					// skip-pitch entries) settles with a barely-there fade instead, and
					// the remount on the view switch must not replay either mid-flight.
					initial={false}
					animate={
						isShaking && !reducedMotion
							? {opacity: 1, scale: 1, x: [0, -4, 4, -3, 3, -2, 2, 0]}
							: entered
								? {opacity: 1, scale: 1, x: 0}
								: mountedAsPitch
									? {opacity: 0, scale: 0.4}
									: {opacity: 0, scale: 0.97}
					}
					onAnimationComplete={() => isShaking && unlock.settleShake()}
					transition={
						isShaking
							? {x: {duration: 0.4, ease: 'easeInOut'}}
							: mountedAsPitch
								? {
										opacity: {duration: 0.4, delay: entranceDelay},
										scale: {type: 'spring', stiffness: 340, damping: 20, delay: entranceDelay},
									}
								: {
										opacity: {duration: 0.25, delay: entranceDelay},
										scale: {type: 'spring', stiffness: 300, damping: 30, delay: entranceDelay},
									}
					}
					className={cn(
						'flex items-center justify-center',
						!isPitch && !isFooter && 'flex-col gap-2',
						isFooter && 'gap-2',
					)}
				>
					<CloudLogoPlate id={entry.id} logo={entry.logo} size={isPitch ? (slot?.size ?? 48) : isFooter ? 16 : 48} />
					{!isPitch && (
						<motion.span
							initial={reducedMotion ? false : {opacity: 0}}
							animate={{opacity: 1}}
							transition={{duration: 0.3, delay: 0.15}}
							className={isFooter ? 'text-13' : 'text-12'}
						>
							{entry.displayName}
						</motion.span>
					)}
					<AnimatePresence initial={false}>
						{!isPitch && isComingSoon && (
							<motion.span
								key='coming-soon'
								exit={reducedMotion ? {opacity: 0} : {opacity: 0, scale: 0.6, y: -6}}
								transition={{duration: 0.25}}
								className='-mt-1 rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] leading-none font-medium text-white/50'
							>
								{t('files-cloud.coming-soon')}
							</motion.span>
						)}
					</AnimatePresence>
				</motion.div>
			</motion.button>
		)
	}

	return (
		<motion.div
			layout
			// Two columns on phones so tile labels stay on one line; three from sm up
			className={cn(isPitch ? 'relative h-[260px]' : 'grid grid-cols-2 gap-2 sm:grid-cols-3', className)}
		>
			{/* The umbrel at the center: the place the clouds come home to. It sits
			    above every satellite z, so orbits pass behind it, never across it. */}
			<AnimatePresence>
				{isPitch && (
					<div key='center' className='pointer-events-none absolute top-1/2 left-1/2 z-30'>
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, scale: 0.7}}
							animate={{opacity: 1, scale: 1}}
							exit={{opacity: 0, scale: 0.7}}
							transition={{type: 'spring', stiffness: 300, damping: 24, delay: mountedAsPitch ? 0.1 : 0}}
							className='-mt-[54px] -ml-[54px]'
						>
							{/* The halo breathes gently so the center feels alive, not lit */}
							<motion.div
								animate={reducedMotion ? undefined : {opacity: [0.75, 1, 0.75], scale: [1, 1.06, 1]}}
								transition={{duration: 7, repeat: Infinity, ease: 'easeInOut'}}
								className='absolute -inset-8 rounded-full bg-brand/30 blur-3xl'
							/>
							<img src='/assets/umbrel-ios.png' alt='' className='relative size-[108px]' draggable={false} />
						</motion.div>
					</div>
				)}
			</AnimatePresence>

			{tiles.map((entry, index) => {
				const slot = CONSTELLATION_IDS.has(entry.id) ? SATELLITE_SLOTS[index] : undefined
				return slot || !isPitch ? satellite(entry, slot, index) : null
			})}

			{webdav &&
				satellite({...webdav, displayName: t('files-cloud.source-webdav')}, WEBDAV_SLOT, SATELLITE_SLOTS.length, true)}
		</motion.div>
	)
}
