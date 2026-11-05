import {describe, expect, test, vi} from 'vitest'

import Files from './files.ts'

import type Umbreld from '../../index.ts'

const createFiles = () =>
	new Files({
		dataDirectory: '/tmp/umbreld-files-visibility-test',
		logger: {createChildLogger: () => ({})},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)

describe('Files visibility policy', () => {
	test('keeps the established Files-only hidden names', () => {
		const files = createFiles()

		expect(files.isHidden('.DS_Store')).toBe(true)
		expect(files.isHidden('.directory')).toBe(true)
		expect(files.isHidden('.umbrel-watcher-health-check')).toBe(true)
		expect(files.isHidden('partial.umbrel-upload')).toBe(true)
		expect(files.isHidden('claimed.umbrel-trash')).toBe(true)
	})

	test('does not inherit Cloud-only OS-junk names', () => {
		const files = createFiles()

		expect(files.isHidden('Thumbs.db')).toBe(false)
		expect(files.isHidden('desktop.ini')).toBe(false)
		expect(files.isHidden('._photo.jpg')).toBe(false)
	})
})
