import type {TFunction} from 'i18next'
import {describe, expect, test, vi} from 'vitest'

import {fileTypeLabel} from './file-type-label'

// Files' type map pulls in every viewer; the audio one reaches the tRPC client
vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))

const t = ((key: string, options?: {extension?: string}) =>
	options?.extension ? `${key}:${options.extension}` : key) as unknown as TFunction

describe('fileTypeLabel', () => {
	test('uses the known name for a known type', () => {
		expect(fileTypeLabel({name: 'report.pdf', type: 'application/pdf'}, t)).toBe('files-type.pdf')
	})

	test('names an unknown type from its extension instead of its MIME type', () => {
		expect(fileTypeLabel({name: 'firmware.bin', type: 'application/octet-stream'}, t)).toBe(
			'files-type.extension-file:BIN',
		)
	})

	test('falls back to a plain label without a usable extension', () => {
		expect(fileTypeLabel({name: 'README', type: 'application/octet-stream'}, t)).toBe('files-type.file')
		expect(fileTypeLabel({name: '.env', type: 'application/octet-stream'}, t)).toBe('files-type.file')
		expect(fileTypeLabel({name: 'notes.final-final', type: ''}, t)).toBe('files-type.file')
	})
})
