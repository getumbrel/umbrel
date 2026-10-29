import {describe, expect, test, vi} from 'vitest'

import {viewers} from '@/features/files/components/file-viewer/viewers'
import {getFileViewer} from '@/features/files/utils/get-file-viewer'

vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))

const viewerFor = (type: string) => getFileViewer({name: 'file', type})

describe('getFileViewer', () => {
	test('a text type opens in the text viewer, whether Files lists it or not', () => {
		for (const type of ['text/plain', 'text/vtt', 'text/x-lua', 'application/x-httpd-php', 'application/x-sql'])
			expect(viewerFor(type)).toBe(viewers.text)
		// JSON and XML by their suffix: a feed, a GeoJSON file, a .rs that mime-db takes for an RLS services file
		for (const type of ['application/rss+xml', 'application/geo+json', 'application/rls-services+xml'])
			expect(viewerFor(type)).toBe(viewers.text)
	})

	test('a type Files lists keeps its own viewer', () => {
		expect(viewerFor('text/csv')).toBe(viewers.sheet)
		expect(viewerFor('image/svg+xml')).toBe(viewers.image)
	})

	test('a type that doesn’t say what the file holds is left to the text viewer to tell', () => {
		expect(viewerFor('application/octet-stream')).toBe(viewers.text)
		// .ts and .mts: TypeScript, or an MPEG transport stream; .m2ts is only ever video
		expect(getFileViewer({name: 'app.ts', type: 'video/mp2t'})).toBe(viewers.text)
		expect(getFileViewer({name: 'module.MTS', type: 'video/mp2t'})).toBe(viewers.text)
		expect(getFileViewer({name: 'concert.m2ts', type: 'video/mp2t'})).toBeUndefined()
	})

	test('any other type has no viewer', () => {
		expect(viewerFor('application/x-iso9660-image')).toBeUndefined()
		expect(viewerFor('application/x-mspublisher')).toBeUndefined()
	})

	test('FLAC, WAV and AAC play under every type umbreld or a browser gives them', () => {
		for (const type of ['audio/flac', 'audio/x-flac', 'audio/wav', 'audio/wave', 'audio/aac', 'audio/x-aac'])
			expect(viewerFor(type)).toBe(viewers.audio)
	})
})
