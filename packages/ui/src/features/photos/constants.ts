export const BASE_ROUTE_PATH = '/photos' as const

// The presentation tier over photo/video, as the backend derives it at import
// (see umbreld modules/photos/CONTRACT.md)
export type PhotoSubKind = 'live' | 'panorama' | 'screenshot' | 'spherical'

// Sidebar sections. Each maps to a child route under /photos; "all" is the
// index route. 'locations' is cut from v1 (the backend can't ship geo
// clustering in time); its UI is kept but unrouted until it returns.
export const PHOTOS_SECTIONS = [
	'all',
	'favorites',
	'photos',
	'videos',
	'live-photos',
	'panoramas',
	'screenshots',
	'360',
	'deleted',
	'sources',
	'albums',
	'people',
	'map',
] as const

export type PhotosSection = (typeof PHOTOS_SECTIONS)[number]

export function sectionPath(section: PhotosSection) {
	return section === 'all' ? BASE_ROUTE_PATH : `${BASE_ROUTE_PATH}/${section}`
}

// One person's view: /photos/people/<id>
export function personPath(personId: string) {
	return `${BASE_ROUTE_PATH}/people/${personId}`
}

// A source's own view: /photos/source/<id>. This Umbrel itself is the 'my-umbrel' source.
export function sourcePath(sourceId: string) {
	return `${BASE_ROUTE_PATH}/source/${sourceId}`
}

// Sidebar sections that are plain filters over the timeline — each one a
// preset of the API's orthogonal filter predicates. Albums / Sources are
// collection pages instead.
export const SECTION_FILTERS = {
	all: {},
	favorites: {favorite: true},
	photos: {kind: 'photo'},
	videos: {kind: 'video'},
	'live-photos': {subKind: 'live'},
	panoramas: {subKind: 'panorama'},
	screenshots: {subKind: 'screenshot'},
	'360': {subKind: 'spherical'},
	deleted: {deleted: true},
} as const satisfies Record<
	string,
	{kind?: 'photo' | 'video'; subKind?: PhotoSubKind; favorite?: boolean; deleted?: boolean}
>
export type FilterSection = keyof typeof SECTION_FILTERS
export const isFilterSection = (section: string | undefined): section is FilterSection =>
	section !== undefined && section in SECTION_FILTERS

// Albums and People without an id are collection pages, not timelines
// (Locations rejoins this union when it ships)
export type CollectionSection = 'albums' | 'people'
export const isCollectionSection = (section: string | undefined): section is CollectionSection =>
	section === 'albums' || section === 'people'
