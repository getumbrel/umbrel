import {Info} from 'lucide-react'
import type {Map as MapLibreMap} from 'maplibre-gl'
import {useEffect, useState} from 'react'

// How long the credit stays out by itself
const SHOWN_MS = 5000
// Whether it has been out, and put away, since the page was loaded. One taken
// off the screen sooner — the inspector's, as photos are stepped through —
// has not been seen, so the next map has it out again
let credited = false

// The credit OpenStreetMap's licence asks for wherever its map is drawn, and
// asks to be seen without being asked for: the first map has it out, until
// the map is touched or a few seconds have passed. After that it is out of
// the way until wanted
export function Attribution({map}: {map: MapLibreMap}) {
	const [open, setOpen] = useState(!credited)
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
				aria-label='OpenStreetMap'
				aria-expanded={open}
				onClick={() => {
					credited = true
					setOpen(!open)
				}}
				className='rounded-full p-1 transition-colors hover:text-white/75 focus-visible:text-white/75'
			>
				<Info className='size-3.5' />
			</button>
			{open && (
				<a
					href='https://www.openstreetmap.org/copyright'
					target='_blank'
					rel='noreferrer'
					className='rounded-full bg-black/70 px-1.5 py-0.5 text-11 font-medium whitespace-nowrap text-white transition-colors select-none hover:bg-black/70 motion-safe:animate-in motion-safe:fade-in'
				>
					© OpenStreetMap
				</a>
			)}
		</div>
	)
}
