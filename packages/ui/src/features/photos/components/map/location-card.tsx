import {ChevronRight} from 'lucide-react'
import {lazy, Suspense, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import {locationName, useAtlas} from '@/features/photos/components/map/atlas'
import {trpcReact} from '@/trpc/trpc'
import {formatNumberI18n} from '@/utils/number'

// MapLibre stays out of the viewer until there is a map to draw with it
const LocationMap = lazy(() =>
	import('@/features/photos/components/map/location-map').then((m) => ({default: m.LocationMap})),
)

// The name laid over the map's foot: the spot sits centred in what is above it
export const CAPTION = 40
// How long the eye must rest on a photo before its map is built: under a
// held-down arrow key this card is mounted afresh for photo after photo, and
// none of those stops should cost a WebGL context
const REST_MS = 300

// Where a photo was taken, in the inspector: the photo standing on its spot
// the way it does on the Map, the place's name, and a way into the Map —
// over the Map's own map, on a device with a basemap to draw it from.
export function LocationCard({
	item,
	lat,
	lng,
	altitude,
	showing,
	onOpen,
}: {
	item: {id: string; tint?: number}
	lat: number
	lng: number
	altitude?: number
	// Whether the inspector is out: put away, it builds no map and moves none
	showing: boolean
	onOpen: () => void
}) {
	const {t, i18n} = useTranslation()
	const {data: basemap} = trpcReact.photos.map.basemap.useQuery(undefined, {staleTime: Infinity})
	const [rested, setRested] = useState(false)
	useEffect(() => {
		if (!showing) return
		const handle = setTimeout(() => setRested(true), REST_MS)
		return () => clearTimeout(handle)
	}, [showing])

	// No atlas to name it from (null: it couldn't be fetched), and the
	// coordinates say where on their own
	const atlas = useAtlas()
	const place = useMemo(() => atlas && locationName(atlas, lat, lng, i18n.language), [atlas, lat, lng, i18n.language])
	const details = [
		coordinates(lat, lng),
		altitude !== undefined && `${formatNumberI18n({n: altitude, showDecimals: true, locale: i18n.language})} m`,
	]
		.filter(Boolean)
		.join(' · ')

	return (
		<div className='relative isolate h-44 w-full rounded-xl bg-white/6'>
			<button
				type='button'
				onClick={onOpen}
				aria-label={[t('photos-item.show-on-map'), place, details].filter(Boolean).join('. ')}
				className='group relative block size-full overflow-hidden rounded-xl text-left'
			>
				{/* The photo on its spot, as its marker on the Map */}
				<div
					className='absolute left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] bg-[#2a2f35] shadow-[0_1px_2px_rgb(0_0_0/0.4),0_8px_20px_-6px_rgb(0_0_0/0.6)] ring-2 ring-white transition-transform duration-200 ease-out group-hover:scale-[1.07]'
					style={{top: `calc(50% - ${CAPTION / 2}px)`}}
				>
					<ItemThumbnail item={item} size={192} className='size-full' />
				</div>
				{/* Where, over the map's foot as it darkens: enough that the map's own
				    names beneath don't read through the words */}
				<div className='absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-3 pt-12 pb-2.5'>
					<div className='min-w-0 flex-1 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]'>
						{place === undefined ? (
							<p className='h-4 w-36 animate-pulse rounded bg-white/15' />
						) : (
							place !== null && <p className='truncate text-13 font-medium text-white'>{place}</p>
						)}
						<p className='truncate text-[10px] text-white/55 tabular-nums'>{details}</p>
					</div>
					<ChevronRight className='size-4 shrink-0 text-white/50 transition-colors group-hover:text-white' />
				</div>
				{/* A hairline round it, over the map, so its edge holds against the panel */}
				<div
					aria-hidden
					className='pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/[0.12] ring-inset'
				/>
			</button>
			{/* The map, on a device with a basemap: it sinks behind all of that,
			    and no further than this card (isolate). Until it has drawn — and
			    in a browser with no WebGL2 to draw it — the card stands as it is */}
			{basemap?.available && rested && (
				<Suspense fallback={null}>
					<LocationMap lat={lat} lng={lng} showing={showing} />
				</Suspense>
			)}
		</div>
	)
}

function coordinates(lat: number, lng: number) {
	const latitude = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`
	const longitude = `${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`
	return `${latitude}, ${longitude}`
}
