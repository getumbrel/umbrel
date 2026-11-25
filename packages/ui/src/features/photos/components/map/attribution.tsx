import {Info} from 'lucide-react'
import type {Map as MapLibreMap} from 'maplibre-gl'
import {useEffect, useState} from 'react'

// How long the credit stays out by itself
const SHOWN_MS = 5000
// Whether it has been out, and put away, since the page was loaded. One taken
// off the screen sooner — the inspector's, as photos are stepped through —
// has not been seen, so the next map has it out again
let credited = false
// The basemap draws its land cover, ESA WorldCover's, only when zoomed out
// further than this: @protomaps/basemaps fades it out from 5 to 7, and the
// tiles carry none deeper. Closer in, nothing of ESA's is on the map
const LAND_COVER_MAX_ZOOM = 7

// The credits the map's data asks for wherever it is drawn: OpenStreetMap's,
// and ESA WorldCover's while its land cover, which colours the globe, is on
// the map. OSM asks for it to be seen without being asked for: the first map
// has it out, until the map is touched or a few seconds have passed. After
// that it is out of the way until wanted. The rest of what the map is made
// with is credited in full in the acknowledgements (Settings > Device info)
export function Attribution({map}: {map: MapLibreMap}) {
	const [open, setOpen] = useState(!credited)
	const landCover = useDrawsLandCover(map)
	useEffect(() => {
		if (credited) return
		const collapse = () => {
			credited = true
			setOpen(false)
		}
		const timer = setTimeout(collapse, SHOWN_MS)
		// The user's own touch of the map, heard on its way down to it: the
		// map's events fire for the camera's moves as well, which it makes by
		// itself, and its gestures let a trackpad's scroll go no further
		const container = map.getContainer()
		const options = {capture: true, passive: true}
		container.addEventListener('pointerdown', collapse, options)
		container.addEventListener('wheel', collapse, options)
		return () => {
			clearTimeout(timer)
			container.removeEventListener('pointerdown', collapse, options)
			container.removeEventListener('wheel', collapse, options)
		}
		// Again once it is put away: there is nothing left to listen for
	}, [map, open])
	return (
		<div className='flex flex-row-reverse items-center gap-1 text-white/40'>
			<button
				type='button'
				aria-label={landCover ? 'OpenStreetMap, ESA WorldCover' : 'OpenStreetMap'}
				aria-expanded={open}
				onClick={() => {
					credited = true
					setOpen(!open)
				}}
				className='rounded-full p-1 transition-colors hover:text-white/75 focus-visible:text-white/75 contrast-more:bg-black/70 contrast-more:text-white'
			>
				<Info className='size-3.5' />
			</button>
			{open && (
				<span className='flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-11 font-medium whitespace-nowrap text-white select-none motion-safe:animate-in motion-safe:fade-in'>
					<Credit href='https://www.openstreetmap.org/copyright'>© OpenStreetMap</Credit>
					{landCover && (
						<>
							<span aria-hidden className='text-white/40'>
								·
							</span>
							<Credit href='https://worldcover2020.esa.int'>© ESA WorldCover</Credit>
						</>
					)}
				</span>
			)}
		</div>
	)
}

const drawsLandCover = (map: MapLibreMap) => map.getZoom() < LAND_COVER_MAX_ZOOM

function useDrawsLandCover(map: MapLibreMap) {
	const [landCover, setLandCover] = useState(() => drawsLandCover(map))
	useEffect(() => {
		const update = () => setLandCover(drawsLandCover(map))
		update()
		map.on('zoom', update)
		return () => void map.off('zoom', update)
	}, [map])
	return landCover
}

function Credit({href, children}: {href: string; children: string}) {
	return (
		<a
			href={href}
			target='_blank'
			rel='noreferrer'
			className='rounded-full outline-hidden transition-colors hover:text-white/75 focus-visible:underline'
		>
			{children}
		</a>
	)
}
