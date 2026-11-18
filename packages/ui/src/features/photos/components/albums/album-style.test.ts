import {describe, expect, it} from 'vitest'

import {ALBUM_STYLES, albumStyleId, fontSpec, formatAlbumDates} from './album-style'

const at = (iso: string) => new Date(iso).getTime()
// Ranges set their en dash in thin spaces, as Intl does
const range = (a: string, b: string) => `${a}\u2009–\u2009${b}`

describe('albumStyleId', () => {
	it('is a stable function of the id, and every style gets used', () => {
		expect(albumStyleId('a-iceland')).toBe(albumStyleId('a-iceland'))
		const seen = new Set(Array.from({length: 200}, (_, i) => albumStyleId(`album-${i}`)))
		expect(seen.size).toBe(Object.keys(ALBUM_STYLES).length)
	})

	it('describes a style the way document.fonts.load wants it', () => {
		expect(fontSpec(ALBUM_STYLES.serif)).toBe("400 1em 'Instrument Serif', ui-serif, Georgia, serif")
		expect(fontSpec(ALBUM_STYLES['serif-italic'])).toMatch(/^italic 400 1em 'Instrument Serif'/)
		expect(fontSpec(ALBUM_STYLES.script)).toMatch(/^700 1em 'Caveat'/)
	})
})

describe('formatAlbumDates', () => {
	it('shows the day when everything was taken on one day', () => {
		expect(formatAlbumDates(at('2026-08-27T09:00Z'), at('2026-08-27T22:00Z'), 'en')).toBe('Aug 27, 2026')
	})

	it('shows the month when everything was taken in one month', () => {
		expect(formatAlbumDates(at('2026-08-02'), at('2026-08-27'), 'en')).toBe('August 2026')
	})

	it('shows a run of months within a year, up to four of them', () => {
		expect(formatAlbumDates(at('2026-07-20'), at('2026-08-03'), 'en')).toBe(range('Jul', 'Aug 2026'))
		expect(formatAlbumDates(at('2026-03-01'), at('2026-06-30'), 'en')).toBe(range('Mar', 'Jun 2026'))
	})

	it('collapses a longer run within a year to just the year', () => {
		expect(formatAlbumDates(at('2026-01-05'), at('2026-08-27'), 'en')).toBe('2026')
		expect(formatAlbumDates(at('2026-03-01'), at('2026-07-01'), 'en')).toBe('2026')
	})

	it('shows a span of years', () => {
		expect(formatAlbumDates(at('2023-11-01'), at('2025-02-01'), 'en')).toBe(range('2023', '2025'))
		expect(formatAlbumDates(at('2025-12-31'), at('2026-01-01'), 'en')).toBe(range('2025', '2026'))
	})

	it('uses the same UTC calendar boundaries as the Photos timeline', () => {
		expect(formatAlbumDates(at('2025-01-01T00:30:00Z'), at('2025-01-01T01:00:00Z'), 'en')).toBe('Jan 1, 2025')
		expect(formatAlbumDates(at('2025-12-31T23:30:00Z'), at('2026-01-01T00:30:00Z'), 'en')).toBe(range('2025', '2026'))
	})

	it('reads the range either way round, and is empty without one', () => {
		expect(formatAlbumDates(at('2026-08-27'), at('2026-07-20'), 'en')).toBe(range('Jul', 'Aug 2026'))
		expect(formatAlbumDates(undefined, at('2026-08-27'), 'en')).toBeUndefined()
	})

	it('speaks the locale, year first where the locale does', () => {
		expect(formatAlbumDates(at('2026-07-20'), at('2026-08-03'), 'de')).toBe(range('Jul', 'Aug. 2026'))
		expect(formatAlbumDates(at('2026-08-02'), at('2026-08-27'), 'ja')).toBe('2026年8月')
		expect(formatAlbumDates(at('2026-07-20'), at('2026-08-03'), 'ja')).toBe(range('2026年7月', '8月'))
		expect(formatAlbumDates(at('2026-07-20'), at('2026-08-03'), 'zh')).toBe(range('2026年7月', '8月'))
		expect(formatAlbumDates(at('2026-07-20'), at('2026-08-03'), 'ko')).toBe(range('2026년 7월', '8월'))
		expect(formatAlbumDates(at('2023-11-01'), at('2025-02-01'), 'ja')).toBe(range('2023年', '2025年'))
	})
})
