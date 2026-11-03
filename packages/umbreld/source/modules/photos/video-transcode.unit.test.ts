import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'

import {
	isBrowserSafeVideoFormat,
	probeVideo,
	VideoTranscoder,
} from './video-transcode.js'

describe('Video transcoding and browser compatibility', () => {
	describe('isBrowserSafeVideoFormat', () => {
		test('identifies browser-safe MP4 / MOV videos', () => {
			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'aac'},
				),
			).toBe(true)

			expect(
				isBrowserSafeVideoFormat(
					'.mov',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuvj420p'},
					{codec_type: 'audio', codec_name: 'mp3'},
				),
			).toBe(true)

			expect(
				isBrowserSafeVideoFormat(
					'.m4v',
					{codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p'},
					undefined,
				),
			).toBe(true)

			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'av1', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'opus'},
				),
			).toBe(true)
		})

		test('identifies browser-safe WebM videos', () => {
			expect(
				isBrowserSafeVideoFormat(
					'.webm',
					{codec_type: 'video', codec_name: 'vp9', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'opus'},
				),
			).toBe(true)

			expect(
				isBrowserSafeVideoFormat(
					'.webm',
					{codec_type: 'video', codec_name: 'vp8'},
					{codec_type: 'audio', codec_name: 'vorbis'},
				),
			).toBe(true)
		})

		test('rejects non-browser-safe containers', () => {
			// MPEG-1, AVI, 3GP, MKV, WMV
			expect(
				isBrowserSafeVideoFormat(
					'.mpg',
					{codec_type: 'video', codec_name: 'mpeg1video'},
					{codec_type: 'audio', codec_name: 'mp2'},
				),
			).toBe(false)

			expect(
				isBrowserSafeVideoFormat(
					'.avi',
					{codec_type: 'video', codec_name: 'mjpeg'},
					{codec_type: 'audio', codec_name: 'pcm_s16le'},
				),
			).toBe(false)

			expect(
				isBrowserSafeVideoFormat(
					'.3gp',
					{codec_type: 'video', codec_name: 'mpeg4'},
					{codec_type: 'audio', codec_name: 'amr_nb'},
				),
			).toBe(false)

			expect(
				isBrowserSafeVideoFormat(
					'.mkv',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'aac'},
				),
			).toBe(false)

			expect(
				isBrowserSafeVideoFormat(
					'.wmv',
					{codec_type: 'video', codec_name: 'wmv3'},
					{codec_type: 'audio', codec_name: 'wmapro'},
				),
			).toBe(false)
		})

		test('rejects unsupported video codecs inside .mp4 and .mov', () => {
			// MPEG-4 Part 2 / DivX in MP4
			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'mpeg4', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'aac'},
				),
			).toBe(false)

			// MJPEG in MOV (old cameras)
			expect(
				isBrowserSafeVideoFormat(
					'.mov',
					{codec_type: 'video', codec_name: 'mjpeg', pix_fmt: 'yuvj420p'},
					{codec_type: 'audio', codec_name: 'pcm_s16le'},
				),
			).toBe(false)

			// MPEG-1/2 in MP4
			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'mpeg2video'},
					{codec_type: 'audio', codec_name: 'aac'},
				),
			).toBe(false)

			// H.264 with non-4:2:0 subsampling (e.g. yuv422p or yuv444p)
			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv422p'},
					{codec_type: 'audio', codec_name: 'aac'},
				),
			).toBe(false)
		})

		test('rejects unsupported audio codecs inside browser containers', () => {
			// AC-3 (Dolby Digital)
			expect(
				isBrowserSafeVideoFormat(
					'.mp4',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'ac3'},
				),
			).toBe(false)

			// Raw PCM audio
			expect(
				isBrowserSafeVideoFormat(
					'.mov',
					{codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p'},
					{codec_type: 'audio', codec_name: 'pcm_s16le'},
				),
			).toBe(false)
		})
	})

	describe('VideoTranscoder lifecycle and caching', () => {
		let directory: string
		const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn()}

		beforeAll(async () => {
			directory = await mkdtemp(nodePath.join(tmpdir(), 'transcoder-test-'))
		})

		afterAll(async () => {
			await rm(directory, {recursive: true, force: true})
		})

		test('serves already existing transcoded video from disk', async () => {
			const hash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
			const cachedPath = nodePath.join(directory, hash.slice(0, 2), `${hash}.mp4`)
			await fse.outputFile(cachedPath, 'mock-transcoded-video-bytes')

			const transcoder = new VideoTranscoder({directory, logger})
			const result = await transcoder.getPlayableVideo('/unused/original.avi', hash)

			expect(result).toEqual({type: 'transcoded', systemPath: cachedPath})
		})

		test('returns cached result on repeated calls without disk lookup', async () => {
			const hash = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
			const cachedPath = nodePath.join(directory, hash.slice(0, 2), `${hash}.mp4`)
			await fse.outputFile(cachedPath, 'cached-bytes')

			const transcoder = new VideoTranscoder({directory, logger})
			const first = await transcoder.getPlayableVideo('/unused/video.avi', hash)
			expect(first).toEqual({type: 'transcoded', systemPath: cachedPath})

			// Remove file from disk; subsequent call must hit memory cache
			await fse.remove(cachedPath)
			const second = await transcoder.getPlayableVideo('/unused/video.avi', hash)
			expect(second).toEqual({type: 'transcoded', systemPath: cachedPath})
		})

		test('probes and determines browser-safe video as original', async () => {
			const transcoder = new VideoTranscoder({directory, logger})
			const safeVideoPath = nodePath.resolve('packages/ui/public/assets/whats-new/photos.mp4')
			const hash = 'feeeddccbbaa99887766554433221100feeeddccbbaa99887766554433221100'

			const result = await transcoder.getPlayableVideo(safeVideoPath, hash)
			expect(result).toEqual({type: 'original'})
		})

		test('transcodes non-browser-safe video to web-compatible MP4', async () => {
			const transcoder = new VideoTranscoder({directory, logger})
			// MKV fixture with yuv422p pixel format
			const sourceVideoPath = nodePath.resolve(
				'packages/umbreld/source/modules/files/fixtures/thumbnails/master-lossless-video.mkv',
			)
			const hash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

			const result = await transcoder.getPlayableVideo(sourceVideoPath, hash)
			expect(result.type).toBe('transcoded')
			if (result.type === 'transcoded') {
				expect(await fse.pathExists(result.systemPath)).toBe(true)
				const fileStat = await stat(result.systemPath)
				expect(fileStat.size).toBeGreaterThan(0)

				// Verify transcoded output is browser-safe
				const probe = await probeVideo(result.systemPath)
				expect(probe.isBrowserSafe).toBe(true)
				expect(probe.videoCodec).toBe('h264')
				expect(probe.pixFmt).toBe('yuv420p')
			}
		})
	})
})
