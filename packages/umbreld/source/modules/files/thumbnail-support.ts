import nodePath from 'node:path'

import {isAppleDouble, PHOTO_EXTENSIONS, VIDEO_EXTENSIONS} from '../photos/types.ts'

export const SUPPORTED_THUMBNAIL_EXTENSIONS = new Set([...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS])

export const THUMBNAIL_FORMAT = 'webp'

export const THUMBNAIL_VARIANTS = {
	'preview-192-webp-v1': {width: 192, height: 192, quality: 75, scale: 'short-side', format: THUMBNAIL_FORMAT},
	'preview-512-webp-v2': {width: 512, height: 512, quality: 80, scale: 'short-side', format: THUMBNAIL_FORMAT},
	'preview-1280-webp-v2': {width: 1280, height: 1280, quality: 80, scale: 'short-side', format: THUMBNAIL_FORMAT},
} as const

export type ThumbnailVariant = keyof typeof THUMBNAIL_VARIANTS
export const THUMBNAIL_VARIANT_NAMES = Object.keys(THUMBNAIL_VARIANTS) as [ThumbnailVariant, ...ThumbnailVariant[]]

export const FILES_THUMBNAIL_VARIANT: ThumbnailVariant = 'preview-192-webp-v1'
export const PHOTOS_THUMBNAIL_VARIANTS = [
	'preview-192-webp-v1',
	'preview-512-webp-v2',
	'preview-1280-webp-v2',
] as const satisfies readonly ThumbnailVariant[]

// Compatibility alias for callers that only need the Files preview.
export const THUMBNAIL_VARIANT = FILES_THUMBNAIL_VARIANT
export const THUMBNAIL_WIDTH = THUMBNAIL_VARIANTS[FILES_THUMBNAIL_VARIANT].width
export const THUMBNAIL_HEIGHT = THUMBNAIL_VARIANTS[FILES_THUMBNAIL_VARIANT].height
export const THUMBNAIL_QUALITY = THUMBNAIL_VARIANTS[FILES_THUMBNAIL_VARIANT].quality

export type ThumbnailIdentityKind = 'content' | 'transient'

export type ThumbnailIdentity = {
	kind: ThumbnailIdentityKind
	key: string
	variant: ThumbnailVariant
}

const THUMBNAIL_KEY_PATTERN = /^[a-f0-9]{64}$/

export function supportsThumbnail(name: string) {
	return !isAppleDouble(name) && SUPPORTED_THUMBNAIL_EXTENSIONS.has(nodePath.extname(name).toLowerCase())
}

export function isThumbnailVariant(value: string): value is ThumbnailVariant {
	return Object.hasOwn(THUMBNAIL_VARIANTS, value)
}

export function thumbnailFilename({kind, key, variant}: ThumbnailIdentity) {
	if (!THUMBNAIL_KEY_PATTERN.test(key)) throw new TypeError('Invalid thumbnail identity key')
	return `${kind}-${variant}-${key}.${THUMBNAIL_FORMAT}`
}

export function parseThumbnailFilename(filename: string) {
	const match = new RegExp(
		`^(content|transient)-(preview-[^-]+-webp-v\\d+)-([a-f0-9]{64})\\.${THUMBNAIL_FORMAT}$`,
		'i',
	).exec(filename)
	if (!match) return
	const variant = match[2].toLowerCase()
	if (!isThumbnailVariant(variant)) return
	return {
		kind: match[1].toLowerCase() as ThumbnailIdentityKind,
		variant,
		key: match[3].toLowerCase(),
	}
}

export function thumbnailSystemPath(thumbnailDirectory: string, {kind, key, variant}: ThumbnailIdentity) {
	if (!THUMBNAIL_KEY_PATTERN.test(key)) throw new TypeError('Invalid thumbnail identity key')
	return nodePath.join(thumbnailDirectory, kind, variant, key.slice(0, 2), `${key}.${THUMBNAIL_FORMAT}`)
}
