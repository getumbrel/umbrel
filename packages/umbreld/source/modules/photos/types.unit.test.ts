import {describe, expect, test} from 'vitest'

import {supportsThumbnail} from '../files/thumbnail-support.ts'
import {photoKind, supportsPhotos} from './types.ts'

const photoExtensions = [
	'jpg',
	'jpeg',
	'jfif',
	'jpe',
	'png',
	'gif',
	'webp',
	'avif',
	'heic',
	'heif',
	'tif',
	'tiff',
	'bmp',
	'dng',
	'cr2',
	'cr3',
	'nef',
	'arw',
	'raf',
	'orf',
	'rw2',
]
const videoExtensions = [
	'mp4',
	'mov',
	'm4v',
	'mkv',
	'webm',
	'avi',
	'3gp',
	'3g2',
	'mts',
	'm2ts',
	'mpg',
	'mpeg',
	'wmv',
	'360',
	'insv',
]

describe('media extension support', () => {
	test.each(photoExtensions)('classifies .%s as a thumbnail-capable photo', (extension) => {
		const name = `capture.${extension.toUpperCase()}`
		expect(photoKind(name)).toBe('photo')
		expect(supportsPhotos(name)).toBe(true)
		expect(supportsThumbnail(name)).toBe(true)
	})

	test.each(videoExtensions)('classifies .%s as a thumbnail-capable video', (extension) => {
		const name = `capture.${extension.toUpperCase()}`
		expect(photoKind(name)).toBe('video')
		expect(supportsPhotos(name)).toBe(true)
		expect(supportsThumbnail(name)).toBe(true)
	})

	test('rejects unsupported and extensionless files', () => {
		for (const name of ['notes.txt', 'README', '.dng']) {
			expect(photoKind(name)).toBeUndefined()
			expect(supportsPhotos(name)).toBe(false)
			expect(supportsThumbnail(name)).toBe(false)
		}
	})
})
