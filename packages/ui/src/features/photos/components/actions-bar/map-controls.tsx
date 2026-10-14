import * as SliderPrimitive from '@radix-ui/react-slider'
import {List, Minus, Plus, Scan} from 'lucide-react'
import type {Map as MapLibreMap} from 'maplibre-gl'
import {useCallback, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'

import {PillButtonGroup, PillButtonGroupItem} from '@/components/ui/edge-controls'
import {sliderRootClass, sliderThumbClass, sliderTrackClass} from '@/features/photos/components/actions-bar/zoom-slider'
import type {MapControls as MapControlsHandle} from '@/features/photos/components/view-context'

// The map's zoom, the way the grid's is laid out: −, a slider, + — the
// slider following the map however it is zoomed, and the map following the
// slider while it is dragged. Then back to all the photos, and the list.
// `compact` is a phone's title row, beside "Photos": the four glyphs share
// one pill (two would leave a 360px phone no room), and the slider — only
// ever shown from xl — is left out
export function MapControls({controls, compact = false}: {controls: MapControlsHandle; compact?: boolean}) {
	const {t} = useTranslation()
	if (compact) {
		return (
			<PillButtonGroup className='gap-0.5'>
				<div role='group' aria-label={t('photos-map.zoom')} className='contents'>
					<ZoomStep map={controls.map} by={-1} />
					<ZoomStep map={controls.map} by={1} />
				</div>
				<MapActions controls={controls} />
			</PillButtonGroup>
		)
	}
	return (
		<>
			<MapZoom map={controls.map} />
			<PillButtonGroup>
				<MapActions controls={controls} />
			</PillButtonGroup>
		</>
	)
}

// Back to all the photos, and the list (on phones, its sheet)
function MapActions({controls: {showAll, listOpen, setListOpen}}: {controls: MapControlsHandle}) {
	const {t} = useTranslation()
	return (
		<>
			<PillButtonGroupItem icon={Scan} aria-label={t('photos-map.show-all')} onClick={showAll} />
			<PillButtonGroupItem
				icon={List}
				aria-label={t(listOpen ? 'photos-map.hide-list' : 'photos-map.show-list')}
				aria-pressed={listOpen}
				className={listOpen ? 'bg-white/12' : undefined}
				onClick={() => setListOpen(!listOpen)}
			/>
		</>
	)
}

// The map's zoom level, as it changes
function useMapZoom(map: MapLibreMap) {
	const subscribe = useCallback(
		(listener: () => void) => {
			map.on('zoom', listener)
			return () => void map.off('zoom', listener)
		},
		[map],
	)
	const zoom = useSyncExternalStore(subscribe, () => map.getZoom())
	const [min, max] = [map.getMinZoom(), map.getMaxZoom()]
	const zoomBy = (by: number) => map.easeTo({zoom: Math.min(max, Math.max(min, Math.round(zoom) + by)), duration: 250})
	return {zoom, min, max, zoomBy}
}

// A whole level out or in
function ZoomStep({map, by}: {map: MapLibreMap; by: -1 | 1}) {
	const {t} = useTranslation()
	const {zoom, min, max, zoomBy} = useMapZoom(map)
	return (
		<PillButtonGroupItem
			icon={by < 0 ? Minus : Plus}
			aria-label={t(by < 0 ? 'photos-actions.zoom-out' : 'photos-actions.zoom-in')}
			disabled={by < 0 ? zoom <= min : zoom >= max}
			onClick={() => zoomBy(by)}
		/>
	)
}

function MapZoom({map}: {map: MapLibreMap}) {
	const {t} = useTranslation()
	const {zoom, min, max, zoomBy} = useMapZoom(map)

	return (
		<PillButtonGroup role='group' aria-label={t('photos-map.zoom')}>
			<ZoomStep map={map} by={-1} />
			<SliderPrimitive.Root
				className={sliderRootClass}
				min={min}
				max={max}
				step={0.01}
				value={[zoom]}
				onValueChange={([next]) => map.jumpTo({zoom: next})}
				// The arrows step a whole level, as − and + do
				onKeyDown={(event) => {
					const by = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[event.key]
					if (by === undefined) return
					event.preventDefault()
					zoomBy(by)
				}}
			>
				<SliderPrimitive.Track className={sliderTrackClass} />
				<SliderPrimitive.Thumb aria-label={t('photos-map.zoom')} className={sliderThumbClass} />
			</SliderPrimitive.Root>
			<ZoomStep map={map} by={1} />
		</PillButtonGroup>
	)
}
