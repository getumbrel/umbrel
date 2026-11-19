import {execFile} from 'node:child_process'
import {lstat, mkdtemp, open, rm, writeFile, type FileHandle} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'

import {sandboxed} from '../utilities/sandbox.ts'
import {
	THUMBNAIL_HEIGHT,
	THUMBNAIL_QUALITY,
	THUMBNAIL_VARIANTS,
	THUMBNAIL_WIDTH,
	parseThumbnailFilename,
	thumbnailFilename,
	type ThumbnailVariant,
} from './thumbnail-support.ts'
import {
	enrichmentQueueConcurrency,
	extractMediaMetadata,
	extractThumbnailTint,
	generateThumbnailFile,
	generateThumbnailFiles,
	hashFileRevision,
	streamableImageCoder,
	THUMBNAIL_GENERATION_TIMEOUT_MS,
} from './file-index-enrichment.ts'

vi.mock('../utilities/sandbox.ts')

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

// Media tools are handed the source as an open descriptor and write each
// thumbnail to one. Their runs are mocked here, so any open file stands in for
// a source, and thumbnails land in a directory of the suite's own.
let source: FileHandle
let data: string

beforeAll(async () => {
	data = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-thumbnail-data-'))
	source = await open(nodePath.join(data, 'source'), 'w+')
})

afterAll(async () => {
	await source.close()
	await rm(data, {recursive: true, force: true})
})

// What the next runs of a tool answer. Tools that run at the same time are
// started in no fixed order, so answers are queued per tool, not per call.
const answers = new Map<string, ReturnType<typeof vi.fn>>()
function tool(command: string) {
	if (!answers.has(command)) answers.set(command, vi.fn())
	vi.mocked(sandboxed).mockImplementation(
		((ran: string, ...rest: unknown[]) => answers.get(ran)?.(ran, ...rest) ?? Promise.resolve({})) as never,
	)
	return answers.get(command)!
}

// The arguments a tool was run with
function argumentsOf(command: string) {
	return vi.mocked(sandboxed).mock.calls.find(([ran]) => ran === command)![1] as string[]
}

function exifMetadata(overrides: Record<string, string | number | undefined> = {}) {
	return {
		stdout: JSON.stringify([
			{
				'File:Image:ImageWidth': 4032,
				'File:Image:ImageHeight': 3024,
				...overrides,
			},
		]),
	}
}

afterEach(async () => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
	answers.clear()
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})))
})

test.each([
	[1, 1, 1],
	[2, 1, 2],
	[4, 1, 3],
	[8, 2, 6],
	[32, 8, 24],
])('sizes enrichment queues for %i available CPU threads', (parallelism, background, onDemand) => {
	expect(enrichmentQueueConcurrency(parallelism)).toStrictEqual({background, onDemand})
})

test('auto-orients before applying short-edge sizing without upscaling', async () => {
	await generateThumbnailFile('/home/photo.jpg', `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd)

	expect(sandboxed).toHaveBeenCalledOnce()
	const arguments_ = argumentsOf('convert')
	expect(arguments_.slice(arguments_.indexOf('-[0]'))).toStrictEqual([
		'-[0]',
		'-auto-orient',
		'(',
		'+clone',
		'-thumbnail',
		`${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}^>`,
		'-quality',
		String(THUMBNAIL_QUALITY),
		'-write',
		'webp:fd:3',
		'+delete',
		')',
		'null:',
	])
})

test('writes every requested rendition from one oriented ImageMagick decode', async () => {
	const outputs = (Object.keys(THUMBNAIL_VARIANTS) as ThumbnailVariant[]).map((variant) => ({
		variant,
		destination: `${data}/${variant}.webp`,
	}))
	await generateThumbnailFiles('/home/photo.jpg', outputs, source.fd)

	expect(sandboxed).toHaveBeenCalledOnce()
	const arguments_ = argumentsOf('convert')
	expect(arguments_.filter((argument) => argument === '-[0]')).toHaveLength(1)
	expect(arguments_.filter((argument) => argument === '-auto-orient')).toHaveLength(1)
	expect(arguments_.filter((argument) => argument === '+clone')).toHaveLength(outputs.length)
	for (const [index, {variant}] of outputs.entries()) {
		const definition = THUMBNAIL_VARIANTS[variant]
		expect(arguments_).toContain(`${definition.width}x${definition.height}^>`)
		expect(arguments_).toContain(`${definition.format}:fd:${3 + index}`)
	}
})

test('hands a media tool the source and every destination as descriptors, and no path', async () => {
	const outputs = (Object.keys(THUMBNAIL_VARIANTS) as ThumbnailVariant[]).map((variant) => ({
		variant,
		destination: `${data}/${variant}.webp`,
	}))
	await generateThumbnailFiles('/home/member/photo.jpg', outputs, source.fd)

	const [, arguments_, sandbox, options] = vi.mocked(sandboxed).mock.calls[0]
	expect(arguments_.join(' ')).not.toMatch(/\/home|\/dev\/fd|thumbnail-data/)
	expect(sandbox).toStrictEqual({
		network: false,
		gpu: false,
		readablePaths: [],
		writablePaths: [],
		memoryLimit: 4 * 1024 ** 3,
		cpuLimit: 1,
	})
	const stdio = (options as {stdio: unknown[]}).stdio
	// The source on standard input, as a descriptor of this run's own, then
	// stdout, stderr and one descriptor per destination
	expect(stdio.slice(1, 3)).toStrictEqual(['pipe', 'pipe'])
	expect(stdio).toHaveLength(3 + outputs.length)
	for (const descriptor of [stdio[0], ...stdio.slice(3)]) {
		expect(descriptor).toBeTypeOf('number')
		expect(descriptor).not.toBe(source.fd)
	}
})

test.each([
	['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10])],
	['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	['GIF', Buffer.from('GIF89a')],
	['WEBP', Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')],
	['TIFF', Buffer.from('II*\x00', 'latin1')],
	['TIFF', Buffer.from('MM\x00*', 'latin1')],
	['BMP', Buffer.from('BM\x36\x00', 'latin1')],
	// HEIC and AVIF decode from a file ImageMagick can name, so are left to it
	[undefined, Buffer.from('\x00\x00\x00\x18ftypheic', 'latin1')],
	[undefined, Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')],
	[undefined, Buffer.from([0xff, 0xd8])],
	[undefined, Buffer.alloc(0)],
])('decodes %s straight from the descriptor when its first bytes say so', async (coder, header) => {
	const path = nodePath.join(data, 'sniffed')
	await writeFile(path, header)
	const image = await open(path, 'r')
	try {
		await expect(streamableImageCoder(image.fd)).resolves.toBe(coder)
		// Named for another format on purpose: only the content decides
		await generateThumbnailFile('/home/photo.png', `${data}/thumbnail.webp`, 'preview-192-webp-v1', image.fd)
		expect(argumentsOf('convert')).toContain(coder ? `${coder}:fd:0[0]` : '-[0]')
	} finally {
		await image.close()
	}
})

test.each([
	['photo.arw', 'ARW'],
	['photo.cr2', 'CR2'],
	['photo.cr3', 'CR3'],
	['photo.dng', 'DNG'],
	['photo.nef', 'NEF'],
	['photo.orf', 'ORF'],
	['photo.raf', 'RAF'],
	['photo.rw2', 'RW2'],
])('preserves the %s coder when a descriptor hides the source extension', async (name, coder) => {
	await generateThumbnailFile(`/home/member/${name}`, `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd)

	expect(argumentsOf('convert')).toContain(`${coder}:-[0]`)
})

test.each(['video.360', 'video.insv', 'video.mkv', 'video.mov', 'video.mp4', 'video.mts', 'video.webm', 'video.wmv'])(
	'renders %s from the frame FFmpeg cuts from it',
	async (name) => {
		tool('ffprobe').mockResolvedValue({
			stdout: JSON.stringify({streams: [{codec_type: 'video', width: 1920, height: 1080}]}),
		})
		await generateThumbnailFile(`/home/member/${name}`, `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd)

		// One sandbox holds both: FFmpeg reads the descriptor and ImageMagick the frame
		const [, script, , ...convert] = argumentsOf('sh')
		expect(script).toMatch(/^ffmpeg .* -i fd: .* - \| exec "\$@"$/)
		expect(convert[0]).toBe('convert')
		expect(convert).toContain('webp:-[0]')
	},
)

test.each([
	['square pixels', {sample_aspect_ratio: '1:1'}, undefined],
	['an unknown sample aspect ratio', {sample_aspect_ratio: '0:1'}, undefined],
	['anamorphic pixels', {sample_aspect_ratio: '24:11'}, `${(24 / 11) * 100}%x100%`],
	[
		'rotated anamorphic pixels',
		{sample_aspect_ratio: '24:11', side_data_list: [{rotation: -90}]},
		`100%x${(24 / 11) * 100}%`,
	],
])('stretches a video frame with %s to its display shape', async (_name, stream, resize) => {
	tool('ffprobe').mockResolvedValue({
		stdout: JSON.stringify({streams: [{codec_type: 'video', width: 352, height: 576, ...stream}]}),
	})
	await generateThumbnailFile('/home/member/video.mp4', `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd)

	expect(argumentsOf('ffprobe')).toContain('fd:')
	const arguments_ = argumentsOf('sh')
	const resizeIndex = arguments_.indexOf('-resize')
	if (resize === undefined) return expect(resizeIndex).toBe(-1)
	expect(arguments_[resizeIndex + 1]).toBe(resize)
	// The stretch applies once to the decoded frame, before any rendition is cut.
	expect(resizeIndex).toBeLessThan(arguments_.indexOf('+clone'))
})

test('still renders a video frame when its stream cannot be probed', async () => {
	tool('ffprobe').mockRejectedValue(new Error('probe failed'))
	await generateThumbnailFile('/home/member/video.mp4', `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd)

	expect(argumentsOf('sh')).not.toContain('-resize')
})

test.each(Object.entries(THUMBNAIL_VARIANTS))(
	'uses the registered dimensions and quality for %s',
	async (variant, definition) => {
		await generateThumbnailFile('/home/photo.jpg', `${data}/thumbnail.webp`, variant as ThumbnailVariant, source.fd)

		const arguments_ = argumentsOf('convert')
		expect(arguments_).toContain(`${definition.width}x${definition.height}^>`)
		expect(arguments_).toContain(String(definition.quality))
	},
)

test.each(Object.keys(THUMBNAIL_VARIANTS))('round-trips the versioned %s artifact name', (variant) => {
	const identity = {kind: 'content' as const, key: 'ab'.repeat(32), variant: variant as ThumbnailVariant}
	expect(parseThumbnailFilename(thumbnailFilename(identity))).toStrictEqual(identity)
})

test('kills the complete ImageMagick process group after a timeout', async () => {
	const timeout = Object.assign(new Error('conversion timed out'), {timedOut: true})
	vi.mocked(sandboxed).mockImplementation((() => Object.assign(Promise.reject(timeout), {pid: 4321})) as never)
	const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

	await expect(
		generateThumbnailFile('/home/photo.jpg', `${data}/thumbnail.webp`, 'preview-192-webp-v1', source.fd),
	).rejects.toThrow('conversion timed out')
	expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL')
})

test('rejects a FIFO thumbnail source without blocking its hash lane', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-thumbnail-fifo-'))
	temporaryDirectories.push(directory)
	const fifo = nodePath.join(directory, 'camera.jpg')
	await execFileAsync('mkfifo', [fifo])
	const stats = await lstat(fifo, {bigint: true})

	await expect(
		hashFileRevision(fifo, {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
		}),
	).rejects.toThrow('File revision no longer matches the index')
})

test('extracts oriented photo metadata, capture offset, GPS, and Apple live identifier', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-photo-metadata-'))
	temporaryDirectories.push(directory)
	const photo = nodePath.join(directory, 'IMG_0001.heic')
	await writeFile(photo, 'photo')
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'IFD0:Image:Orientation': 6,
			'ExifIFD:Time:DateTimeOriginal': '2025:08:21 14:03:04',
			'ExifIFD:Time:OffsetTimeOriginal': '+02:30',
			'IFD0:Camera:Make': 'Apple',
			'IFD0:Camera:Model': 'iPhone 16 Pro',
			'ExifIFD:Image:LensModel': 'iPhone lens',
			'ExifIFD:Camera:FocalLength': '24/1',
			'ExifIFD:Image:FNumber': '18/10',
			'ExifIFD:Image:ExposureTime': '1/125',
			'ExifIFD:Image:PhotographicSensitivity': 100,
			'GPS:Location:GPSLatitude': 13.75,
			'GPS:Location:GPSLongitude': 100.5,
			'GPS:Location:GPSAltitude': 62.5,
			'Apple:Image:ContentIdentifier': 'live-photo-id',
		}) as never,
	)

	await expect(extractMediaMetadata(photo, source.fd)).resolves.toMatchObject({
		kind: 'photo',
		width: 3024,
		height: 4032,
		takenAtOffsetMinutes: 150,
		cameraMake: 'Apple',
		cameraModel: 'iPhone 16 Pro',
		focalLength: '24mm',
		aperture: 'ƒ/1.8',
		exposure: '1/125',
		iso: 100,
		latitude: 13.75,
		longitude: 100.5,
		altitude: 62.5,
		liveIdentifier: 'live-photo-id',
	})
	expect(sandboxed).toHaveBeenCalledOnce()
	// ExifTool opens the source by path, so it is shown the open file at one
	// and runs as root to be able to open it
	expect(sandboxed).toHaveBeenCalledWith(
		'exiftool',
		expect.arrayContaining(['-j', '-n', '-G1:2', '-a', '/source']),
		{
			network: false,
			gpu: false,
			readablePaths: [],
			writablePaths: [],
			memoryLimit: 4 * 1024 ** 3,
			cpuLimit: 1,
			user: 'root',
			readableFile: {descriptor: 3, path: '/source'},
		},
		{
			detached: true,
			timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
			killSignal: 'SIGKILL',
			stdio: ['ignore', 'pipe', 'pipe', expect.any(Number)],
		},
	)
	const arguments_ = vi.mocked(sandboxed).mock.calls[0]![1] as string[]
	expect(arguments_).toEqual(
		expect.arrayContaining([
			'-ImageWidth',
			'-ImageSize',
			'-DateTimeOriginal',
			'-GPSLatitude',
			'-GPSLatitudeRef',
			'-GPSLongitudeRef',
			'-GPSAltitudeRef',
			'-ProjectionType',
			'-ContentIdentifier',
			'-UserComment',
		]),
	)
	expect(arguments_).toEqual(expect.arrayContaining(['-api', 'IgnoreTags=all']))
})

test('prefers signed Composite GPS values over unsigned EXIF storage values', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'GPS:Location:GPSLatitude': 33.8688,
			'Composite:Location:GPSLatitude': -33.8688,
			'GPS:Location:GPSLongitude': 118.2437,
			'Composite:Location:GPSLongitude': -118.2437,
			'GPS:Location:GPSAltitude': 62.5,
			'Composite:Location:GPSAltitude': -62.5,
			'GPS:Location:GPSLatitudeRef': 'S',
			'GPS:Location:GPSLongitudeRef': 'W',
			'GPS:Location:GPSAltitudeRef': 1,
		}) as never,
	)

	await expect(extractMediaMetadata('/home/photo.jpg', source.fd)).resolves.toMatchObject({
		latitude: -33.8688,
		longitude: -118.2437,
		altitude: -62.5,
	})
})

test.each([
	['PhotographicSensitivity', {'ExifIFD:Image:PhotographicSensitivity': 640}, 640],
	['ISO', {'ExifIFD:Image:ISO': 320}, 320],
	['PhotographicSensitivity precedence', {'ExifIFD:Image:PhotographicSensitivity': 800, 'ExifIFD:Image:ISO': 200}, 800],
])('extracts %s', async (_name, values, expected) => {
	vi.mocked(sandboxed).mockResolvedValueOnce(exifMetadata(values) as never)
	await expect(extractMediaMetadata('/home/photo.jpg', source.fd)).resolves.toMatchObject({iso: expected})
})

test('extracts standard ExifTool metadata from camera RAW photos', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'IFD0:Image:ImageWidth': 8,
			'SubIFD:Image:ImageWidth': 3516,
			'IFD0:Image:ImageHeight': 8,
			'SubIFD:Image:ImageHeight': 2328,
			'Composite:Image:ImageSize': '3516 2328',
			'XMP:Time:CreationDate': '2008:01:01 15:29:46+02:30',
			'IFD0:Camera:Make': 'Sony',
			'IFD0:Camera:Model': 'DSLR-A700',
			'ExifIFD:Image:LensModel': '20-200mm f/4-6',
			'ExifIFD:Camera:FocalLength': '2e+02',
			'ExifIFD:Image:FNumber': '8',
			'ExifIFD:Image:ExposureTime': '1/1e+03',
			'ExifIFD:Image:ISO': '2e+02',
			'GPS:Location:GPSLatitude': 13.75,
			'GPS:Location:GPSLongitude': 100.5,
			'GPS:Location:GPSAltitude': 62.5,
		}) as never,
	)

	await expect(extractMediaMetadata('/home/photo.dng', source.fd)).resolves.toMatchObject({
		kind: 'photo',
		width: 3516,
		height: 2328,
		takenAt: Date.parse('2008-01-01T15:29:46+02:30'),
		takenAtOffsetMinutes: 150,
		cameraMake: 'Sony',
		cameraModel: 'DSLR-A700',
		lens: '20-200mm f/4-6',
		focalLength: '200mm',
		aperture: 'ƒ/8',
		exposure: '1/1000',
		iso: 200,
		latitude: 13.75,
		longitude: 100.5,
		altitude: 62.5,
	})
	const arguments_ = vi.mocked(sandboxed).mock.calls[0]![1] as string[]
	expect(arguments_).not.toContain('IgnoreTags=all')
})

test('rejects photo metadata without valid dimensions', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce({stdout: JSON.stringify([{SourceFile: '/home/broken.jpg'}])} as never)

	await expect(extractMediaMetadata('/home/broken.jpg', source.fd)).rejects.toThrow(
		'Photo has no valid image dimensions',
	)
})

test('ignores zero GPS, invalid dates, and unknown-lens sentinels', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'ExifIFD:Time:DateTimeOriginal': '2008:02:30 15:29:46',
			'ExifIFD:Image:LensModel': '0-0mm f/0-0',
			'GPS:Location:GPSLatitude': 0,
			'GPS:Location:GPSLongitude': 0,
			'GPS:Location:GPSAltitude': 0,
		}) as never,
	)

	const metadata = await extractMediaMetadata('/home/photo.dng', source.fd)
	expect(metadata).not.toHaveProperty('takenAt')
	expect(metadata).not.toHaveProperty('lens')
	expect(metadata).not.toHaveProperty('latitude')
	expect(metadata).not.toHaveProperty('longitude')
})

test.each([
	[
		'DateTimeOriginal and its offset',
		{
			'ExifIFD:Time:DateTimeOriginal': '2024:01:02 03:04:05',
			'ExifIFD:Time:OffsetTimeOriginal': '+02:30',
			'Keys:Time:CreationDate': '2023:01:02 03:04:05-04:00',
			'ExifIFD:Time:CreateDate': '2022:01:02 03:04:05',
		},
		Date.UTC(2024, 0, 2, 0, 34, 5),
		150,
	],
	[
		'CreationDate with its inline offset',
		{
			'Keys:Time:CreationDate': '2023:02:03 04:05:06-04:00',
			'ExifIFD:Time:CreateDate': '2022:01:02 03:04:05',
		},
		Date.UTC(2023, 1, 3, 8, 5, 6),
		-240,
	],
	[
		'CreateDate and OffsetTimeDigitized',
		{'ExifIFD:Time:CreateDate': '2022:03:04 05:06:07', 'ExifIFD:Time:OffsetTimeDigitized': '+05:45'},
		Date.UTC(2022, 2, 3, 23, 21, 7),
		345,
	],
	[
		'MediaCreateDate without an offset as UTC',
		{'Track1:Time:MediaCreateDate': '2021:04:05 06:07:08'},
		Date.UTC(2021, 3, 5, 6, 7, 8),
		undefined,
	],
	[
		'ModifyDate and OffsetTime',
		{'IFD0:Time:ModifyDate': '2020:05:06 07:08:09', 'ExifIFD:Time:OffsetTime': '+01:00'},
		Date.UTC(2020, 4, 6, 6, 8, 9),
		60,
	],
] as const)('selects %s', async (_name, values, takenAt, offsetMinutes) => {
	vi.mocked(sandboxed).mockResolvedValueOnce(exifMetadata(values) as never)
	const metadata = await extractMediaMetadata('/home/photo.jpg', source.fd)
	expect(metadata.takenAt).toBe(takenAt)
	expect(metadata.takenAtOffsetMinutes).toBe(offsetMinutes)
})

test('falls through an invalid higher-priority photo date without borrowing its offset', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'ExifIFD:Time:DateTimeOriginal': '2024:02:30 12:00:00',
			'ExifIFD:Time:OffsetTimeOriginal': '+09:00',
			'Keys:Time:CreationDate': '2023:05:06 07:08:09-03:00',
		}) as never,
	)
	await expect(extractMediaMetadata('/home/photo.jpg', source.fd)).resolves.toMatchObject({
		takenAt: Date.UTC(2023, 4, 6, 10, 8, 9),
		takenAtOffsetMinutes: -180,
	})
})

test.each([
	['above sea level', 62.5],
	['below sea level', -62.5],
])('extracts signed ExifTool GPS altitude %s', async (_name, altitude) => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'GPS:Location:GPSLatitude': 13.75,
			'Composite:Location:GPSLatitude': 13.75,
			'GPS:Location:GPSLongitude': 100.5,
			'Composite:Location:GPSLongitude': 100.5,
			'GPS:Location:GPSAltitude': Math.abs(altitude),
			'Composite:Location:GPSAltitude': altitude,
		}) as never,
	)
	await expect(extractMediaMetadata('/home/photo.jpg', source.fd)).resolves.toMatchObject({altitude})
})

test('uses ExifTool-decoded UserComment metadata and normalizes it', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({'ExifIFD:Image:UserComment': '  Cafe\u0301 東京の夜  \0'}) as never,
	)

	await expect(extractMediaMetadata('/home/photo.jpg', source.fd)).resolves.toMatchObject({
		userComment: 'Café 東京の夜',
	})
	expect(sandboxed).toHaveBeenCalledOnce()
})

test('prefers spherical metadata over the panorama aspect-ratio heuristic', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce(
		exifMetadata({
			'File:Image:ImageWidth': 6000,
			'File:Image:ImageHeight': 2000,
			'XMP-GPano:Image:ProjectionType': 'equirectangular',
		}) as never,
	)

	await expect(extractMediaMetadata('/home/panorama.jpg', source.fd)).resolves.toMatchObject({subKind: 'spherical'})
})

test('combines descriptor-backed FFprobe structure with ExifTool video semantics', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbrel-video-metadata-'))
	temporaryDirectories.push(directory)
	const video = nodePath.join(directory, 'IMG_0001.mov')
	await writeFile(video, 'video')
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [
				{
					codec_type: 'video',
					width: 1920,
					height: 1080,
					duration: 'N/A',
					side_data_list: [{rotation: 90}, {crop_left: 10, crop_right: 20, crop_top: 2, crop_bottom: 8}],
					tags: {rotate: '0'},
				},
			],
			format: {duration: '3.25'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce(
		exifMetadata({
			'Keys:Time:CreationDate': '2025:08:21 14:30:00+02:30',
			'Keys:Video:ProjectionType': 'equirectangular',
			'Keys:Other:ContentIdentifier': 'live-photo-id',
		}) as never,
	)

	await expect(extractMediaMetadata(video, source.fd)).resolves.toMatchObject({
		kind: 'video',
		subKind: 'spherical',
		width: 1070,
		height: 1890,
		durationMs: 3250,
		takenAt: Date.parse('2025-08-21T14:30:00+02:30'),
		takenAtOffsetMinutes: 150,
		liveIdentifier: 'live-photo-id',
	})
	expect(sandboxed).toHaveBeenCalledWith('ffprobe', expect.arrayContaining(['fd:']), expect.anything(), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
		stdio: [expect.any(Number), 'pipe', 'pipe'],
	})
	const ffprobeArguments = argumentsOf('ffprobe')
	const showEntries = ffprobeArguments[ffprobeArguments.indexOf('-show_entries') + 1]
	expect(showEntries).toBe(
		'stream=codec_type,width,height,sample_aspect_ratio,duration:stream_tags=rotate:stream_side_data=rotation,crop_top,crop_bottom,crop_left,crop_right:format=duration',
	)
	expect(showEntries).not.toMatch(/creation|projection|identifier|color|audio|dolby/i)
	expect(sandboxed).toHaveBeenCalledWith('exiftool', expect.arrayContaining(['-G1:2', '/source']), expect.anything(), {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
		stdio: ['ignore', 'pipe', 'pipe', expect.any(Number)],
	})
	const exifToolArguments = argumentsOf('exiftool')
	expect(exifToolArguments).toEqual(
		expect.arrayContaining([
			'-a',
			'-CreationDate',
			'-ProjectionType',
			'-ContentIdentifier',
			'-GPSCoordinates',
			'-FocalLengthIn35mmFormat',
			'-CameraLensIrisfnumber',
		]),
	)
	expect(exifToolArguments).not.toContain('IgnoreTags=all')
	expect(exifToolArguments).not.toContain('-ee')
})

test.each([
	['anamorphic', {sample_aspect_ratio: '24:11'}, {width: 768, height: 576}],
	['rotated anamorphic', {sample_aspect_ratio: '24:11', side_data_list: [{rotation: 90}]}, {width: 576, height: 768}],
	['unknown aspect', {sample_aspect_ratio: '0:1'}, {width: 352, height: 576}],
	['missing aspect', {}, {width: 352, height: 576}],
])('records %s video at its display dimensions', async (_name, stream, dimensions) => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({streams: [{codec_type: 'video', width: 352, height: 576, ...stream}]}),
	} as never)
	tool('exiftool').mockResolvedValueOnce(exifMetadata() as never)

	await expect(extractMediaMetadata('/home/camcorder.mp4', source.fd)).resolves.toMatchObject(dimensions)
})

test('extracts common iPhone MOV location, focal length, aperture, and lens VideoKeys', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 1920, height: 1440}],
			format: {duration: '1.25'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce({
		stdout: JSON.stringify([
			{
				'Keys:Location:GPSCoordinates': '13.7237 100.5223 10.528',
				'VideoKeys:Camera:FocalLengthIn35mmFormat': 26,
				'VideoKeys:Audio:CameraLensIrisfnumber': 'F1.60',
				'VideoKeys:Camera:LensModel': 'iPhone Air back camera 5.96mm f/1.6',
			},
		]),
	} as never)

	await expect(extractMediaMetadata('/home/iphone.mov', source.fd)).resolves.toMatchObject({
		latitude: 13.7237,
		longitude: 100.5223,
		altitude: 10.528,
		focalLength: '26mm',
		aperture: 'ƒ/1.6',
		lens: 'iPhone Air back camera 5.96mm f/1.6',
	})
})

test('keeps signed QuickTime GPSCoordinates altitude over its absolute composite', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 1920, height: 1440}],
			format: {duration: '1.25'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce(
		exifMetadata({
			'Composite:Location:GPSLatitude': -33.8688,
			'Composite:Location:GPSLongitude': -118.2437,
			'Composite:Location:GPSAltitude': 62.5,
			'Keys:Location:GPSCoordinates': '-33.8688 -118.2437 -62.5',
		}) as never,
	)

	await expect(extractMediaMetadata('/home/iphone.mov', source.fd)).resolves.toMatchObject({
		latitude: -33.8688,
		longitude: -118.2437,
		altitude: -62.5,
	})
})

test('recognizes numeric Matroska equirectangular projection metadata', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 4096, height: 2048}],
			format: {duration: '2'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce(exifMetadata({'Matroska:Video:ProjectionType': 1}) as never)

	await expect(extractMediaMetadata('/home/sphere.mkv', source.fd)).resolves.toMatchObject({subKind: 'spherical'})
})

test('merges camera-classified QuickTime metadata without accepting non-camera groups', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 1920, height: 1080}],
			format: {duration: '1'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce({
		stdout: JSON.stringify([
			{
				'ICC-header:Image:Make': 'Colour profile vendor',
				'ICC-header:Image:Model': 'Colour profile model',
				'Keys:Camera:Make': 'Apple',
				'Keys:Camera:Model': 'iPhone Air',
				'VideoKeys:Camera:LensModel': 'iPhone Air front camera 2.715mm f/1.9',
				'VideoKeys:Camera:FocalLength': 2.715,
				'VideoKeys:Camera:FNumber': 1.9,
				'VideoKeys:Camera:ExposureTime': 0.005,
				'VideoKeys:Camera:ISO': 80,
			},
		]),
	} as never)

	await expect(extractMediaMetadata('/home/iphone.mov', source.fd)).resolves.toMatchObject({
		cameraMake: 'Apple',
		cameraModel: 'iPhone Air',
		lens: 'iPhone Air front camera 2.715mm f/1.9',
		focalLength: '2.7mm',
		aperture: 'ƒ/1.9',
		exposure: '1/200',
		iso: 80,
	})
})

test('accepts Android camera identity keys from the QuickTime video group', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({streams: [{codec_type: 'video', width: 1920, height: 1080}]}),
	} as never)
	tool('exiftool').mockResolvedValueOnce({
		stdout: JSON.stringify([
			{
				'Keys:Video:AndroidMake': 'Google',
				'Keys:Video:AndroidModel': 'Pixel 10 Pro',
			},
		]),
	} as never)

	await expect(extractMediaMetadata('/home/pixel.mp4', source.fd)).resolves.toMatchObject({
		cameraMake: 'Google',
		cameraModel: 'Pixel 10 Pro',
	})
})

test('extracts embedded Insta360 trailer metadata only for INSV videos', async () => {
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 1920, height: 1920}],
			format: {duration: '61'},
		}),
	} as never)
	tool('exiftool').mockResolvedValueOnce({
		stdout: JSON.stringify([
			{
				'Insta360:Camera:Model': 'Insta360 X4',
				'Insta360:Camera:ExposureTime': 0.00499681429937482,
			},
		]),
	} as never)

	await expect(extractMediaMetadata('/home/video.insv', source.fd)).resolves.toMatchObject({
		cameraModel: 'Insta360 X4',
		exposure: '1/200',
	})
	const arguments_ = argumentsOf('exiftool')
	expect(arguments_).toContain('-ee')
	expect(arguments_).toContain('IgnoreTags=all')
})

test('keeps playable video metadata when optional ExifTool extraction fails', async () => {
	const onOptionalMetadataFailure = vi.fn()
	const optionalMetadataError = new Error('Unsupported vendor trailer')
	tool('ffprobe').mockResolvedValueOnce({
		stdout: JSON.stringify({
			streams: [{codec_type: 'video', width: 1280, height: 720}],
			format: {duration: '2'},
		}),
	} as never)
	tool('exiftool').mockRejectedValueOnce(optionalMetadataError)

	await expect(extractMediaMetadata('/home/video.mp4', source.fd, onOptionalMetadataFailure)).resolves.toMatchObject({
		kind: 'video',
		width: 1280,
		height: 720,
		durationMs: 2000,
	})
	expect(onOptionalMetadataFailure).toHaveBeenCalledOnce()
	expect(onOptionalMetadataFailure).toHaveBeenCalledWith(optionalMetadataError)
})

test('waits for every tool reading the source before a failed probe is reported', async () => {
	// A tool reopens the held descriptor when it starts. If the caller closed
	// it as soon as one tool failed, another could reopen whatever file was
	// given that descriptor number next.
	let finished = false
	tool('ffprobe').mockRejectedValueOnce(new Error('probe failed'))
	tool('exiftool').mockImplementationOnce(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50))
		finished = true
		return exifMetadata()
	})

	await expect(extractMediaMetadata('/home/video.mp4', source.fd)).rejects.toThrow('probe failed')
	expect(finished).toBe(true)
})

test('packs the average thumbnail colour as 0xRRGGBB', async () => {
	vi.mocked(sandboxed).mockResolvedValueOnce({stdout: '18,52,86'} as never)
	const thumbnail = nodePath.join(data, 'tint.webp')
	await writeFile(thumbnail, 'thumbnail')
	await expect(extractThumbnailTint(thumbnail)).resolves.toBe(0x123456)
	// Read from standard input, like any other media
	expect(argumentsOf('convert')[0]).toBe('webp:-')
})
