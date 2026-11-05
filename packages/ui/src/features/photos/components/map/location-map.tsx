import 'maplibre-gl/dist/maplibre-gl.css'

import {Map as MapLibreMap} from 'maplibre-gl'
import {useEffect, useRef, useState} from 'react'

import {Attribution} from '@/features/photos/components/map/attribution'
import {CAPTION} from '@/features/photos/components/map/location-card'
import {useMapStyle} from '@/features/photos/components/map/use-map-style'

// Close enough to see the neighbourhood
const ZOOM = 12

// The map behind the inspector's location card: the Map's own map, still.
// One map for the card's life: stepping through photos moves it.
export function LocationMap({lat, lng, showing}: {lat: number; lng: number; showing: boolean}) {
	const {style} = useMapStyle()

	const containerRef = useRef<HTMLDivElement>(null)
	const [map, setMap] = useState<MapLibreMap>()
	const ready = style !== undefined
	useEffect(() => {
		if (!style || !containerRef.current) return
		let instance: MapLibreMap
		try {
			instance = new MapLibreMap({
				container: containerRef.current,
				// A flat map however far out it is: there is no globe to turn here
				style: {...style, projection: {type: 'mercator'}},
				center: [lng, lat],
				zoom: ZOOM,
				interactive: false,
				attributionControl: false,
				fadeDuration: 0,
			})
		} catch {
			// A browser without WebGL2 can't draw one: the card stands without it
			return
		}
		instance.setPadding({top: 0, right: 0, bottom: CAPTION, left: 0})
		setMap(instance)
		return () => {
			instance.remove()
			setMap(undefined)
		}
		// Made once; a new photo only moves it
	}, [ready])
	// … and only while the inspector is out: put away, the map asks for no
	// tiles, and is brought to the photo being looked at when it is back
	useEffect(() => {
		if (showing) map?.jumpTo({center: [lng, lat], zoom: ZOOM})
	}, [map, showing, lat, lng])

	return (
		<>
			{/* Beneath the card's own layers, though it follows them: the credit
			    must lie over them. Sized by a wrapper: MapLibre's stylesheet makes
			    its container position: relative, over any class of ours */}
			<div aria-hidden className='absolute inset-0 -z-10 overflow-hidden rounded-xl'>
				<div ref={containerRef} className='size-full' />
			</div>
			{/* The credit, beside the card's button: it can't sit inside one */}
			{map && (
				<div className='absolute top-1 right-1'>
					<Attribution map={map} />
				</div>
			)}
		</>
	)
}
