import nodePath from 'node:path'
import fse from 'fs-extra'
import {execa} from 'execa'

export type VideoProbeStream = {
	codec_type?: string
	codec_name?: string
	pix_fmt?: string
}

export type VideoProbeResult = {
	isBrowserSafe: boolean
	videoCodec?: string
	pixFmt?: string
	audioCodec?: string
	hasAudio: boolean
}

export type PlayableVideoResult =
	| {type: 'original'}
	| {type: 'transcoded'; systemPath: string}

const BROWSER_SAFE_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov'])

const BROWSER_SAFE_MP4_VIDEO_CODECS = new Set(['h264', 'hevc', 'av1'])
const BROWSER_SAFE_WEBM_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1'])

const BROWSER_SAFE_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p'])

const BROWSER_SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])

/**
 * Checks whether a video format and codec combination is natively decodable by modern web browsers
 * in an HTML5 <video> element without transcoding.
 */
export function isBrowserSafeVideoFormat(
	extension: string,
	videoStream?: VideoProbeStream,
	audioStream?: VideoProbeStream,
): boolean {
	const normalizedExt = extension.toLowerCase()
	if (!BROWSER_SAFE_VIDEO_EXTENSIONS.has(normalizedExt)) {
		return false
	}

	if (!videoStream?.codec_name) {
		return false
	}

	const videoCodec = videoStream.codec_name.toLowerCase()
	const pixFmt = videoStream.pix_fmt?.toLowerCase()

	if (normalizedExt === '.webm') {
		if (!BROWSER_SAFE_WEBM_VIDEO_CODECS.has(videoCodec)) {
			return false
		}
	} else {
		// .mp4, .m4v, .mov
		if (!BROWSER_SAFE_MP4_VIDEO_CODECS.has(videoCodec)) {
			return false
		}
		// H.264 / HEVC / AV1 must have 4:2:0 chroma subsampling for browser playback
		if (pixFmt && !BROWSER_SAFE_PIXEL_FORMATS.has(pixFmt)) {
			return false
		}
	}

	// If there is an audio stream, verify it uses a browser-supported audio codec
	if (audioStream?.codec_name) {
		const audioCodec = audioStream.codec_name.toLowerCase()
		if (!BROWSER_SAFE_AUDIO_CODECS.has(audioCodec)) {
			return false
		}
	}

	return true
}

export async function probeVideo(systemPath: string): Promise<VideoProbeResult> {
	const {stdout} = await execa(
		'ffprobe',
		[
			'-v',
			'error',
			'-show_entries',
			'stream=codec_type,codec_name,pix_fmt',
			'-of',
			'json',
			systemPath,
		],
		{timeout: 15_000},
	)

	const probe = JSON.parse(stdout) as {streams?: VideoProbeStream[]}
	const streams = probe.streams ?? []
	const videoStream = streams.find(({codec_type}) => codec_type === 'video')
	const audioStream = streams.find(({codec_type}) => codec_type === 'audio')
	const extension = nodePath.extname(systemPath)

	const isBrowserSafe = isBrowserSafeVideoFormat(extension, videoStream, audioStream)

	return {
		isBrowserSafe,
		videoCodec: videoStream?.codec_name?.toLowerCase(),
		pixFmt: videoStream?.pix_fmt?.toLowerCase(),
		audioCodec: audioStream?.codec_name?.toLowerCase(),
		hasAudio: Boolean(audioStream),
	}
}

export async function transcodeVideo(
	systemPath: string,
	destinationPath: string,
	probe: VideoProbeResult,
): Promise<void> {
	await fse.ensureDir(nodePath.dirname(destinationPath))
	const tmpDestination = `${destinationPath}.tmp.${process.pid}.${Date.now()}`

	try {
		const arguments_: string[] = ['-v', 'error', '-y', '-i', systemPath]

		// Video stream handling:
		// If video is already H.264 in yuv420p, stream copy instead of re-encoding.
		const canCopyVideo =
			probe.videoCodec === 'h264' &&
			(!probe.pixFmt || BROWSER_SAFE_PIXEL_FORMATS.has(probe.pixFmt))

		if (canCopyVideo) {
			arguments_.push('-c:v', 'copy')
		} else {
			arguments_.push(
				'-c:v',
				'libx264',
				'-pix_fmt',
				'yuv420p',
				'-preset',
				'veryfast',
				'-crf',
				'23',
				'-vf',
				"scale='min(1920,iw)':-2",
			)
		}

		// Audio stream handling:
		if (!probe.hasAudio) {
			arguments_.push('-an')
		} else if (probe.audioCodec === 'aac') {
			arguments_.push('-c:a', 'copy')
		} else {
			arguments_.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2')
		}

		// Move moov atom to beginning of file for instant web playback / seeking
		arguments_.push('-movflags', '+faststart', tmpDestination)

		await execa('ffmpeg', arguments_, {timeout: 300_000})

		const stats = await fse.stat(tmpDestination)
		if (!stats.isFile() || stats.size === 0) {
			throw new Error('Transcoded video is empty')
		}

		await fse.move(tmpDestination, destinationPath, {overwrite: true})
	} catch (error) {
		await fse.remove(tmpDestination).catch(() => {})
		throw error
	}
}

export type VideoTranscoderLogger = {
	log(message?: string): void
	verbose(message: string): void
	error(message: string, error?: unknown): void
}

export class VideoTranscoder {
	readonly directory: string
	readonly logger: VideoTranscoderLogger
	readonly #inFlight = new Map<string, Promise<void>>()
	readonly #cache = new Map<string, PlayableVideoResult>()

	constructor(options: {directory: string; logger: VideoTranscoderLogger}) {
		this.directory = options.directory
		this.logger = options.logger
	}

	async start() {
		await fse.ensureDir(this.directory)
	}

	async getPlayableVideo(systemPath: string, contentHash: string): Promise<PlayableVideoResult> {
		// 1. In-memory cache hit
		const cached = this.#cache.get(contentHash)
		if (cached) return cached

		// 2. Transcoded file on disk
		const destination = nodePath.join(this.directory, contentHash.slice(0, 2), `${contentHash}.mp4`)
		try {
			if (await fse.pathExists(destination)) {
				const stats = await fse.stat(destination)
				if (stats.size > 0) {
					const result: PlayableVideoResult = {type: 'transcoded', systemPath: destination}
					this.#cache.set(contentHash, result)
					return result
				}
			}
		} catch {
			// Continue to probe/transcode if stat fails
		}

		// 3. Probe video to check if natively browser-safe
		let probe: VideoProbeResult
		try {
			probe = await probeVideo(systemPath)
		} catch (error) {
			this.logger.error(`Failed to probe video '${systemPath}'`, error)
			// Fallback to original
			return {type: 'original'}
		}

		if (probe.isBrowserSafe) {
			const result: PlayableVideoResult = {type: 'original'}
			this.#cache.set(contentHash, result)
			return result
		}

		// 4. Video needs transcoding: deduplicate in-flight jobs
		let transcodePromise = this.#inFlight.get(contentHash)
		if (!transcodePromise) {
			transcodePromise = transcodeVideo(systemPath, destination, probe)
			this.#inFlight.set(contentHash, transcodePromise)
			transcodePromise.finally(() => {
				this.#inFlight.delete(contentHash)
			})
		}

		try {
			await transcodePromise
			const result: PlayableVideoResult = {type: 'transcoded', systemPath: destination}
			this.#cache.set(contentHash, result)
			return result
		} catch (error) {
			this.logger.error(`Failed to transcode video '${systemPath}'`, error)
			return {type: 'original'}
		}
	}
}
