import nodePath from 'node:path'

export const PHOTO_KINDS = ['photo', 'video'] as const
export const PHOTO_SUB_KINDS = ['live', 'panorama', 'screenshot', 'spherical'] as const
// Android phones are stored as 'iphone' sources and shown as 'android'; see photoSourceTypeSql.
export const PHOTO_SOURCE_TYPES = ['umbrel', 'iphone', 'android'] as const
export const PHOTO_SCOPE_MODES = ['everything', 'everything-except', 'only'] as const

export type PhotoKind = (typeof PHOTO_KINDS)[number]
export type PhotoSubKind = (typeof PHOTO_SUB_KINDS)[number]
export type PhotoSourceType = (typeof PHOTO_SOURCE_TYPES)[number]
export type PhotoScopeMode = (typeof PHOTO_SCOPE_MODES)[number]

export const PHOTO_EXTENSIONS = new Set([
	'.jpg',
	'.jpeg',
	'.jfif',
	'.jpe',
	'.png',
	'.gif',
	'.webp',
	'.avif',
	'.heic',
	'.heif',
	'.tif',
	'.tiff',
	'.bmp',
	'.dng',
	'.cr2',
	'.cr3',
	'.nef',
	'.arw',
	'.raf',
	'.orf',
	'.rw2',
])
export const VIDEO_EXTENSIONS = new Set([
	'.mp4',
	'.mov',
	'.m4v',
	'.mkv',
	'.webm',
	'.avi',
	'.3gp',
	'.3g2',
	'.mts',
	'.m2ts',
	'.mpg',
	'.mpeg',
	'.wmv',
	'.360',
	'.insv',
])

// macOS writes an AppleDouble `._<name>` sidecar next to a file when it copies
// it to a volume that can't store extended attributes (FAT32/exFAT, SMB/NFS
// shares, archives). It keeps the original's extension but only ever holds
// Finder info, xattrs and the resource fork, never media.
export function isAppleDouble(name: string) {
	return nodePath.basename(name).startsWith('._')
}

export function photoKind(name: string): PhotoKind | undefined {
	if (isAppleDouble(name)) return
	const extension = nodePath.extname(name).toLowerCase()
	if (PHOTO_EXTENSIONS.has(extension)) return 'photo'
	if (VIDEO_EXTENSIONS.has(extension)) return 'video'
}

export function supportsPhotos(name: string) {
	return photoKind(name) !== undefined
}

export type PhotoFilter = {
	query?: string
	kind?: PhotoKind
	subKind?: PhotoSubKind
	favorite?: boolean
	deleted?: boolean
	sourceIds?: string[]
	albumIds?: string[]
	dates?: Array<{from: number; to: number}>
	bounds?: PhotoBounds
}

// A stretch of the map, in degrees. West is east of east when the stretch
// crosses the antimeridian (Fiji, say), the way map libraries report it.
export type PhotoBounds = {west: number; south: number; east: number; north: number}

// The map's wire format (GET /api/photos/map/points), little-endian: how many
// of the selected items have no location (uint32), then a record per located
// item, in the timeline's order — the content hash (32 bytes: the item id as
// bytes), latitude and longitude (float32: a metre or so), takenAt (float64
// ms), flags (uint8, see MAP_POINT_FLAGS) and the tint (RGB, when flags says
// there is one)
export const MAP_POINTS_HEADER_BYTES = 4
export const MAP_POINT_BYTES = 52
export const MAP_POINT_FLAGS = {
	favorite: 1,
	video: 2,
	live: 4,
	panorama: 8,
	screenshot: 16,
	spherical: 32,
	tint: 64,
} as const

export type PhotoItem = {
	id: string
	kind: PhotoKind
	subKind?: PhotoSubKind
	takenAt: number
	takenAtOffsetMinutes?: number
	width: number
	height: number
	durationMs?: number
	isFavorite: boolean
	tint?: number
}

export type PhotoItemDetail = PhotoItem & {
	fileName: string
	sizeBytes: number
	source: {id: string; name: string; type: PhotoSourceType}
	path: string
	createdAt: number
	importedAt: number
	exif?: {
		make?: string
		model?: string
		lens?: string
		focalLength?: string
		aperture?: string
		exposure?: string
		iso?: number
		userComment?: string
	}
	location?: {lat: number; lng: number; altitude?: number}
	albums: Array<{id: string; name: string}>
}

export type PhotoAlbum = {
	id: string
	name: string
	count: number
	coverId?: string
	takenFrom?: number
	takenTo?: number
	createdAt: number
}

export type PhotoSource = {
	id: string
	type: PhotoSourceType
	name: string
	lastImportAt?: number
	createdAt: number
	stats: {photos: number; videos: number; sizeBytes: number}
	scope?: {mode: PhotoScopeMode; paths: string[]}
}

export type PhotoIndexingState =
	| {phase: 'indexing'}
	| {phase: 'enriching'; completed: number; total: number; percentage: number}
	| {phase: 'ready'; completed: number; total: number; percentage: 100}
	| {phase: 'degraded'; completed?: number; total?: number; percentage?: number; error?: string}

export type PhotoIndexingProgress = {accountId: string; state: PhotoIndexingState}

// PhotoKit's iCloud identifier names an asset, not its bytes. The role names the
// asset's component (for example a Live Photo's still or motion), so one asset
// can back several receipts.
export type PhotoBackupCloudIdentity = {cloudIdentifier: string; role: string}

// A currently indexed Home location of a receipt's bytes, with the revision a
// caller must find on disk before trusting it.
export type PhotoBackupLocation = {
	path: string
	bytes: number
	revision: {device: string; inode: string; size: number; modifiedNs: string; ctimeNs: string}
}

export type PhotoSummary = {
	counts: {items: number; favorites: number; photos: number; videos: number; deleted: number}
	sizeBytes: number
	bySubKind: Record<PhotoSubKind, number>
	bySource: Record<string, number>
	months: Array<{year: number; month: number; count: number}>
}
