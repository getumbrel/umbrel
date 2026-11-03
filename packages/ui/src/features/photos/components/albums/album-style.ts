import {capitalizeDate} from '@/utils/date-time'

// The typographic personality of an album's cover: a small curated set of
// display faces, one chosen per album by hashing its id. Deterministic and
// stateless, so the same album looks the same on every device and after
// every reload without storing anything — an explicit choice can override the
// hash later. Also the date line under the title.

export type AlbumStyle = {
	// A full font-family stack: the display face first, then something that
	// carries the same feel for scripts the face doesn't cover (per-glyph
	// fallback keeps "Tokyo 東京" half in the face, half in the system font)
	family: string
	weight: number
	italic?: boolean
	uppercase?: boolean
	tracking?: string
	// Optical correction: these faces differ a lot in x-height and width, so
	// one px size reads very differently between them
	scale: number
}

const SERIF_FALLBACK = 'ui-serif, Georgia, serif'
const SANS_FALLBACK = "'Inter', system-ui, sans-serif"

export type AlbumStyleId = 'serif' | 'serif-italic' | 'display' | 'condensed' | 'bungee' | 'marker' | 'script' | 'plain'

export const ALBUM_STYLES: Record<AlbumStyleId, AlbumStyle> = {
	serif: {family: `'Instrument Serif', ${SERIF_FALLBACK}`, weight: 400, scale: 1.12},
	'serif-italic': {family: `'Instrument Serif', ${SERIF_FALLBACK}`, weight: 400, italic: true, scale: 1.12},
	display: {family: `'Playfair Display', ${SERIF_FALLBACK}`, weight: 700, scale: 1.04},
	condensed: {family: `'Bebas Neue', ${SANS_FALLBACK}`, weight: 400, uppercase: true, tracking: '0.04em', scale: 1.18},
	bungee: {family: `'Bungee', ${SANS_FALLBACK}`, weight: 400, uppercase: true, tracking: '0.02em', scale: 0.94},
	marker: {family: `'Permanent Marker', ${SANS_FALLBACK}`, weight: 400, scale: 0.98},
	script: {family: `'Caveat', ${SANS_FALLBACK}`, weight: 700, scale: 1.28},
	plain: {family: SANS_FALLBACK, weight: 700, tracking: '-0.01em', scale: 0.98},
}

const STYLE_IDS = Object.keys(ALBUM_STYLES) as AlbumStyleId[]

// FNV-1a: cheap, well spread over short ids
function hash(input: string) {
	let h = 0x811c9dc5
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h
}

export function albumStyleId(albumId: string): AlbumStyleId {
	return STYLE_IDS[hash(albumId) % STYLE_IDS.length]!
}

/** The font shorthand `document.fonts.load` understands, for a style */
export function fontSpec(style: AlbumStyle) {
	return `${style.italic ? 'italic ' : ''}${style.weight} 1em ${style.family}`
}

// ── Date line ─────────────────────────────────────────────────────────────

// Calendar months an album's photos touch, before it stops reading as "a trip"
// and becomes "a year"
const RANGE_MAX_MONTHS = 4

/**
 * When an album's photos were taken, as briefly as the range allows: a day,
 * a month, a run of months in one year, a year, or a span of years. Single
 * dates come straight from Intl; ranges are composed from two of them, in the
 * locale's own order (year first in Japanese, Chinese, Korean), because ICU's
 * range patterns for months fall back to numerals in those locales — and
 * differ between the ICU in Node and the one in Chrome.
 */
export function formatAlbumDates(from: number | undefined, to: number | undefined, language: string) {
	if (from === undefined || to === undefined) return undefined
	const a = new Date(Math.min(from, to))
	const b = new Date(Math.max(from, to))
	const format = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(language, {...options, timeZone: 'UTC'})
	const year = format({year: 'numeric'})
	const month = format({month: 'short'})
	const monthYear = format({month: 'short', year: 'numeric'})
	const span = (first: string, last: string) => `${capitalizeDate(first, language)}\u2009–\u2009${last}`
	if (a.getUTCFullYear() !== b.getUTCFullYear()) return span(year.format(a), year.format(b))
	const months = b.getUTCMonth() - a.getUTCMonth() + 1
	if (months > RANGE_MAX_MONTHS) return year.format(a)
	if (months > 1) {
		const parts = monthYear.formatToParts(a).map((part) => part.type)
		const yearFirst = parts.indexOf('year') < parts.indexOf('month')
		return yearFirst ? span(monthYear.format(a), month.format(b)) : span(month.format(a), monthYear.format(b))
	}
	if (a.getUTCDate() !== b.getUTCDate())
		return capitalizeDate(format({month: 'long', year: 'numeric'}).format(a), language)
	return format({day: 'numeric', month: 'short', year: 'numeric'}).format(a)
}
