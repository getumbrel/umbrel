import {layers, namedFlavor, type Flavor} from '@protomaps/basemaps'
import type {LayerSpecification, Map as MapLibreMap, SourceSpecification, StyleSpecification} from 'maplibre-gl'

import type {OfflineMapData} from '@/features/photos/components/map/atlas'

// The map's look: night, the way Maps draws it — land in the system's
// neutral greys, water a slate blue, parks and woods a green you can see,
// highways a soft amber, and names in crisp white and grey. Still quieter
// than any thumbnail on it: the photographs carry the colour. No points of
// interest, shields or one-way arrows — it is a map of where your photos
// were taken, not of where to get coffee.
const WATER = '#1b2a3d'
// Around the globe, behind its stars: the dark between them, a shade lighter
// towards the middle so the globe has something to hang in
export const SPACE = 'radial-gradient(ellipse at 55% 45%, #0a1020 0%, #060912 50%, #020308 100%)'
const LAND = '#28282b'
const GREEN = {park: '#20372a', wood: '#1f3328', grass: '#25332a'}
const ROAD = {service: '#36363a', minor: '#3d3d41', major: '#4c4c51', link: '#5d523b', highway: '#7a6642'}
const TUNNEL = {minor: '#333336', major: '#3e3e42', highway: '#5a4f3a'}
const LABEL = {bright: '#f2f2f7', soft: '#c7c7cc', muted: '#98989d', faint: '#6e6e73', halo: '#1c1c1e'}
const NIGHT: Flavor = {
	...namedFlavor('dark'),
	background: WATER,
	earth: LAND,
	water: WATER,
	glacier: '#3a3d42',
	sand: '#38352d',
	beach: '#3b382f',
	park_a: GREEN.park,
	park_b: GREEN.park,
	wood_a: GREEN.wood,
	wood_b: GREEN.wood,
	scrub_a: GREEN.grass,
	scrub_b: GREEN.grass,
	hospital: '#2e2c30',
	industrial: '#2b2b2e',
	school: '#2e2d31',
	zoo: GREEN.park,
	military: '#2b2b2e',
	aerodrome: '#2f2f33',
	runway: '#47474b',
	pedestrian: '#303033',
	pier: '#3a3a3d',
	buildings: '#343437',
	other: ROAD.service,
	minor_service: ROAD.service,
	minor_a: ROAD.minor,
	minor_b: ROAD.minor,
	link: ROAD.link,
	major: ROAD.major,
	highway: ROAD.highway,
	minor_service_casing: LAND,
	minor_casing: LAND,
	link_casing: LAND,
	major_casing_early: LAND,
	major_casing_late: LAND,
	highway_casing_early: LAND,
	highway_casing_late: LAND,
	tunnel_other_casing: LAND,
	tunnel_minor_casing: LAND,
	tunnel_link_casing: LAND,
	tunnel_major_casing: LAND,
	tunnel_highway_casing: LAND,
	tunnel_other: TUNNEL.minor,
	tunnel_minor: TUNNEL.minor,
	tunnel_link: TUNNEL.major,
	tunnel_major: TUNNEL.major,
	tunnel_highway: TUNNEL.highway,
	bridges_other_casing: LAND,
	bridges_minor_casing: LAND,
	bridges_link_casing: LAND,
	bridges_major_casing: LAND,
	bridges_highway_casing: LAND,
	bridges_other: ROAD.service,
	bridges_minor: ROAD.minor,
	bridges_link: ROAD.link,
	bridges_major: ROAD.major,
	bridges_highway: ROAD.highway,
	railway: '#3a3a3d',
	boundaries: '#636366',
	roads_label_minor: LABEL.faint,
	roads_label_minor_halo: LAND,
	roads_label_major: LABEL.muted,
	roads_label_major_halo: LAND,
	ocean_label: '#5f7fa3',
	subplace_label: LABEL.muted,
	subplace_label_halo: LABEL.halo,
	city_label: LABEL.bright,
	city_label_halo: LABEL.halo,
	state_label: LABEL.faint,
	state_label_halo: LABEL.halo,
	country_label: LABEL.soft,
	address_label: LABEL.faint,
	address_label_halo: LAND,
	landcover: {
		grassland: GREEN.grass,
		barren: '#2d2c2b',
		urban_area: '#2c2c2f',
		farmland: '#292d29',
		glacier: '#3a3d42',
		scrub: GREEN.grass,
		forest: GREEN.wood,
	},
}

// From afar the map is the Earth: its oceans deep, and its forests, deserts
// and ice their own colours, for the light to fall across (see
// globe-light.tsx). Close to, it is the quiet night map above, evenly lit.
// Between these two zooms one becomes the other, as the light dims.
export const EARTH_ZOOM = 2.6
export const MAP_ZOOM = 4
const EARTH = {
	ocean: '#0a2c56',
	land: '#5b673f',
	border: 'rgb(255 255 255 / 0.3)',
	cover: {
		grassland: '#52733f',
		barren: '#b89a68',
		urban_area: '#7d7468',
		farmland: '#6c7a3e',
		glacier: '#eaf2f8',
		scrub: '#84774a',
		forest: '#1e5238',
	},
}
const fromEarth = (earth: string | number, map: string | number) => [
	'interpolate',
	['linear'],
	['zoom'],
	EARTH_ZOOM,
	earth,
	MAP_ZOOM,
	map,
]
function earthly(layer: LayerSpecification): LayerSpecification[] {
	const repainted = (paint: Record<string, unknown>, id = layer.id) =>
		({...layer, id, paint: {...layer.paint, ...paint}}) as LayerSpecification
	if (layer.id === 'background') return [repainted({'background-color': fromEarth(EARTH.ocean, WATER)})]
	if (layer.id === 'water') return [repainted({'fill-color': fromEarth(EARTH.ocean, WATER)})]
	if (layer.id === 'earth') return [repainted({'fill-color': fromEarth(EARTH.land, LAND)})]
	if (layer.id.startsWith('boundaries')) return [repainted({'line-color': fromEarth(EARTH.border, NIGHT.boundaries)})]
	// What covers the land twice over: the map's muted greens, and over them,
	// from afar, the Earth's
	if (layer.id === 'landcover') {
		const {forest, ...kinds} = EARTH.cover
		const colour = ['match', ['get', 'kind'], ...Object.entries(kinds).flat(), forest]
		return [layer, repainted({'fill-color': colour, 'fill-opacity': fromEarth(1, 0)}, 'landcover_earth')]
	}
	return [layer]
}

// Layers that need a sprite we don't ship, or that are noise on this map
const LEFT_OUT = new Set(['pois', 'roads_oneway', 'roads_shields', 'address_label'])
// Places no one lives: OpenStreetMap names fields, passes and lone farms
// too, and in the country they outnumber the villages ten to one
const UNSETTLED = ['locality', 'isolated_dwelling', 'farm']
// The places a spot is named after: not a hamlet down the road
const TOWNS = ['city', 'town', 'village']

// The vector source the basemap's layers draw from
const BASEMAP = 'basemap'
export type Basemap = {available: boolean; maxZoom: number; build?: string}
// The basemap's name for the reader's language: its names are tagged the way
// OpenStreetMap tags them, which for Chinese is by script and for Norwegian
// is the macrolanguage, where the UI's languages are 'zh', 'zh-TW' and 'nb'
const MAP_LANGUAGES: Record<string, string> = {zh: 'zh-Hans', 'zh-TW': 'zh-Hant', nb: 'no'}
export function mapLanguage(language: string): string {
	return MAP_LANGUAGES[language] ?? language.split('-')[0]!
}

// The style for what the device has. With a basemap: its tiles, every zoom
// of them from the device, magnified past the deepest. Without one: the
// atlas's countries and the sea, which is enough to place photos on, and
// works with no connection.
export function mapStyle({
	basemap,
	atlas,
	lang,
	authorize,
}: {
	basemap: Basemap | undefined
	atlas: OfflineMapData | undefined
	lang: string
	// Makes a same-origin URL template carry the session's API token
	authorize: (url: string) => string
}): StyleSpecification {
	const base = {version: 8 as const, projection}
	if (!basemap?.available) {
		return {
			...base,
			sources: atlas ? {atlas: atlasSource(atlas)} : {},
			layers: [
				{id: 'background', type: 'background', paint: {'background-color': WATER}},
				...(atlas
					? ([
							{id: 'atlas-land', type: 'fill', source: 'atlas', paint: {'fill-color': LAND}},
							{
								id: 'atlas-borders',
								type: 'line',
								source: 'atlas',
								paint: {'line-color': NIGHT.boundaries, 'line-width': 0.6},
							},
						] satisfies LayerSpecification[])
					: []),
			],
		}
	}
	return {
		...base,
		sources: {
			[BASEMAP]: {
				type: 'vector',
				// Under its build, which the browser keeps what it is sent of for good
				tiles: [
					authorize(
						`${location.origin}/api/photos/map/tiles/{z}/{x}/{y}?build=${encodeURIComponent(basemap.build ?? '')}`,
					),
				],
				maxzoom: basemap.maxZoom,
			},
		},
		layers: layers(BASEMAP, NIGHT, {lang})
			.filter((layer) => !LEFT_OUT.has(layer.id))
			.flatMap(earthly)
			.map((layer) => oneName(withoutIcons(settled(layer)), lang)),
	}
}

// From afar the world is a globe hanging among the stars — the way the whole
// of one's photos looks best, and the way a place is found on one: by turning
// it. Up to this zoom it is fully round, with a far side
export const GLOBE_ZOOM = 3.5
// … and from this one on it is the flat map, having unrolled in between
export const FLAT_ZOOM = 5.5
const projection = {
	type: ['interpolate', ['linear'], ['zoom'], GLOBE_ZOOM, 'vertical-perspective', FLAT_ZOOM, 'mercator'],
} as unknown as StyleSpecification['projection']
// One name per place, in the reader's language where the map knows it —
// not the basemap's default of that and the local script stacked beneath —
// in the UI's own type
function oneName(layer: LayerSpecification, lang: string): LayerSpecification {
	if (layer.type !== 'symbol' || !layer.layout?.['text-field']) return layer
	return {
		...layer,
		layout: {
			...layer.layout,
			'text-field': ['coalesce', ['get', `name:${lang}`], ['get', 'name:en'], ['get', 'name']],
			'text-font': inLabelFont(layer.layout['text-font'] ?? ['Noto Sans Medium']),
		},
	} as LayerSpecification
}

// Labels are in the Inter the page already loads (inter-ui names it 'Inter
// var'), drawn by the browser itself: a style with no glyphs URL has MapLibre
// draw each one with the stack as a CSS font list, so a script Inter lacks
// falls to the device's own fonts, and there are no glyph files to fetch.
// Chinese and Japanese ask for the system faces made for them by name, ahead
// of whatever the browser would pick
const LABEL_FONT = 'Inter var'
const CJK_FONTS = ['PingFang SC', 'Hiragino Sans', 'Noto Sans CJK SC']
// The basemap's fonts, by the weight or style MapLibre reads out of the first
// name in a stack
const NOTO_SANS = /^Noto Sans (Regular|Medium|Italic)$/
// Each of the basemap's font names, wherever it is in a layer's text-font —
// in a plain stack or deep in an expression's `literal` — as Inter in its
// weight, then Inter itself and the CJK faces
function inLabelFont(font: unknown): unknown {
	if (!Array.isArray(font)) return font
	return font.flatMap((part) => {
		const weight = typeof part === 'string' ? NOTO_SANS.exec(part)?.[1] : undefined
		return weight ? [`${LABEL_FONT} ${weight}`, LABEL_FONT, ...CJK_FONTS] : [inLabelFont(part)]
	})
}

function settled(layer: LayerSpecification): LayerSpecification {
	if (layer.id !== 'places_locality' || !('filter' in layer)) return layer
	return {...layer, filter: ['all', layer.filter, ['!in', 'kind_detail', ...UNSETTLED]]} as LayerSpecification
}

// The land, its roads and its borders, held back while a new map's first
// tiles are on their way, and faded up together once every tile under the
// camera is in, rather than coming a tile at a time. The sea and the sky are
// there from the start, and the names fade in by themselves. Until then a
// globe is all ocean, which the photos can land on before the basemap has
// come. Returns what stops waiting.
const LAND_FADE_MS = 600
const LAND_OPACITY = {fill: 'fill-opacity', line: 'line-opacity'} as const
export function fadeInLand(map: MapLibreMap) {
	const held = map
		.getStyle()
		.layers.flatMap((layer) =>
			(layer.type === 'fill' || layer.type === 'line') && layer.source === BASEMAP
				? [{id: layer.id, property: LAND_OPACITY[layer.type]}]
				: [],
		)
	const values = held.map(({id, property}) => map.getPaintProperty(id, property) ?? 1)
	for (const {id, property} of held) {
		map.setPaintProperty(id, `${property}-transition`, {duration: 0, delay: 0})
		map.setPaintProperty(id, property, 0)
	}
	// A tile come in (or every tile there is to come having come, or failed)
	const reveal = (event?: {tile?: unknown}) => {
		if ((event && !event.tile) || !map.areTilesLoaded()) return
		stop()
		held.forEach(({id, property}, index) => {
			map.setPaintProperty(id, `${property}-transition`, {duration: LAND_FADE_MS, delay: 0})
			map.setPaintProperty(id, property, values[index])
		})
	}
	const onIdle = () => reveal()
	const stop = () => {
		map.off('sourcedata', reveal)
		map.off('idle', onIdle)
	}
	map.on('sourcedata', reveal)
	map.on('idle', onIdle)
	return stop
}

// The town or village a spot is in, from the basemap's own names — finer
// than the atlas, which knows only the bigger places — or nothing where the
// map has none loaded there
const SETTLEMENT_KM = 12
export function settlementNear(map: MapLibreMap, lng: number, lat: number, lang: string) {
	if (!map.getSource(BASEMAP)) return
	let nearest: {name: string; distance: number} | undefined
	for (const {properties, geometry} of map.querySourceFeatures(BASEMAP, {sourceLayer: 'places'})) {
		if (properties.kind !== 'locality' || !TOWNS.includes(properties.kind_detail) || geometry.type !== 'Point') continue
		const [placeLng, placeLat] = geometry.coordinates as [number, number]
		const across = (placeLng - lng) * Math.cos((lat * Math.PI) / 180)
		const distance = Math.hypot(across, placeLat - lat) * 111.2
		if (distance > SETTLEMENT_KM || (nearest && nearest.distance <= distance)) continue
		const name = properties[`name:${lang}`] ?? properties['name:en'] ?? properties.name
		if (typeof name === 'string') nearest = {name, distance}
	}
	return nearest?.name
}

// Place labels draw a dot from the sprite; the name alone is enough
function withoutIcons(layer: LayerSpecification): LayerSpecification {
	if (layer.type !== 'symbol' || !layer.layout || !('icon-image' in layer.layout)) return layer
	const layout = Object.fromEntries(Object.entries(layer.layout).filter(([key]) => !key.startsWith('icon-')))
	return {...layer, layout} as LayerSpecification
}

function atlasSource(atlas: OfflineMapData): SourceSpecification {
	return {
		type: 'geojson',
		data: {
			type: 'FeatureCollection',
			features: atlas.c.map(([name, iso2, , rings]) => ({
				type: 'Feature',
				properties: {name, iso2},
				// A country is several rings — islands as often as holes — and each is
				// drawn as its own shape
				geometry: {type: 'MultiPolygon', coordinates: rings.map((ring) => [ring])},
			})),
		},
	}
}
