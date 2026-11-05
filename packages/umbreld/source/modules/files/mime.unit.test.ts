import {expect, test} from 'vitest'

import {lookupMimeType} from './mime.ts'

test.each([
	['photo.jfif', 'image/jpeg'],
	['photo.dng', 'image/x-adobe-dng'],
	['photo.cr2', 'image/x-canon-cr2'],
	['photo.cr3', 'image/x-canon-cr3'],
	['photo.nef', 'image/x-nikon-nef'],
	['photo.arw', 'image/x-sony-arw'],
	['photo.raf', 'image/x-fuji-raf'],
	['photo.orf', 'image/x-olympus-orf'],
	['photo.rw2', 'image/x-panasonic-rw2'],
	['video.mts', 'video/mp2t'],
	['video.m2ts', 'video/mp2t'],
	['video.360', 'video/mp4'],
	['video.insv', 'video/mp4'],
])('overrides the MIME type for %s', (name, expected) => {
	expect(lookupMimeType(name)).toBe(expected)
	expect(lookupMimeType(name.toUpperCase())).toBe(expected)
})

test('falls back to mime-types for standard and unknown extensions', () => {
	expect(lookupMimeType('photo.jpg')).toBe('image/jpeg')
	expect(lookupMimeType('video.wmv')).toBe('video/x-ms-wmv')
	expect(lookupMimeType('unknown.invalid-extension')).toBe(false)
})
