import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {PHOTOS_MEDIA_ACCEPT, photosUploads, splitMediaFiles} from '@/features/photos/hooks/use-upload'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('react-router-dom', () => ({useParams: () => ({})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/modules/auth/http-auth', () => ({dashboardAuthHeaders: () => ({})}))
vi.mock('@/providers/confirmation', () => ({useConfirmation: () => vi.fn()}))
vi.mock('@/trpc/trpc', () => ({trpcReact: {}}))

// A hand-cranked XMLHttpRequest: tests drive progress/load/error on the
// most recent instance
class FakeXHR {
	static instances: FakeXHR[] = []
	upload: {onprogress?: (event: {loaded: number}) => void} = {}
	onload?: () => void
	onerror?: () => void
	status = 0
	url = ''
	sent: unknown
	aborted = false
	responseText = ''

	constructor() {
		FakeXHR.instances.push(this)
	}
	open(_method: string, url: string) {
		this.url = url
	}
	setRequestHeader() {}
	send(body: unknown) {
		this.sent = body
	}
	abort() {
		this.aborted = true
	}
	// Test helpers
	progress(loaded: number) {
		this.upload.onprogress?.({loaded})
	}
	respond(status: number, body = '') {
		this.status = status
		this.responseText = body
		this.onload?.()
	}
}

const last = () => FakeXHR.instances.at(-1)!
const makeFile = (name: string, size: number, type = 'image/png') => new File([new Uint8Array(size)], name, {type})

// The progress emitter throttles to ~150ms; step past it before each event
const tick = () => vi.advanceTimersByTime(200)

const revoked: string[] = []

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('XMLHttpRequest', FakeXHR)
	vi.stubGlobal('URL', {
		createObjectURL: (file: File) => `blob:${file.name}`,
		revokeObjectURL: (url: string) => revoked.push(url),
	})
	photosUploads.cancel()
	FakeXHR.instances = []
	revoked.length = 0
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('photosUploads', () => {
	it('sends each file modification date, including when retrying an upload', () => {
		const first = new File(['first'], 'first.png', {lastModified: 946684800000})
		const second = new File(['second'], 'second.png', {lastModified: -315619200000})
		photosUploads.enqueue([first, second])
		expect(last().url).toContain(`lastModified=${first.lastModified}`)
		photosUploads.pause()
		photosUploads.resume()
		expect(last().url).toContain(`lastModified=${first.lastModified}`)
		last().respond(200)
		expect(last().url).toContain(`lastModified=${second.lastModified}`)
	})

	it('uploads sequentially with bytes-weighted progress', () => {
		photosUploads.enqueue([makeFile('a.png', 100), makeFile('b.png', 300)])
		expect(photosUploads.snapshot()).toMatchObject({status: 'uploading', done: 0, total: 2, progress: 0})
		expect(FakeXHR.instances).toHaveLength(1)
		expect(last().url).toContain('name=a.png')

		tick()
		last().progress(50)
		expect(photosUploads.snapshot().progress).toBeCloseTo(50 / 400)

		last().respond(200)
		expect(photosUploads.snapshot()).toMatchObject({done: 1, total: 2})
		expect(photosUploads.snapshot().progress).toBeCloseTo(100 / 400)
		// The next file went out by itself
		expect(FakeXHR.instances).toHaveLength(2)
		expect(last().url).toContain('name=b.png')

		last().respond(200)
		expect(photosUploads.snapshot()).toMatchObject({status: 'idle', done: 0, total: 0, progress: 0})
	})

	it('sends the album along and previews the current image', () => {
		photosUploads.enqueue([makeFile('a.png', 100)], 'a-iceland')
		expect(last().url).toContain('album=a-iceland')
		expect(photosUploads.snapshot().currentPreview).toBe('blob:a.png')
		last().respond(200)
		expect(revoked).toContain('blob:a.png')
	})

	it('pause freezes the bar and re-sends the file on resume', () => {
		photosUploads.enqueue([makeFile('a.png', 100)])
		tick()
		last().progress(60)
		const first = last()

		photosUploads.pause()
		expect(first.aborted).toBe(true)
		// The partial bytes are gone, but the bar holds where it was
		expect(photosUploads.snapshot()).toMatchObject({status: 'paused', done: 0, total: 1})
		expect(photosUploads.snapshot().progress).toBeCloseTo(0.6)

		photosUploads.resume()
		expect(FakeXHR.instances).toHaveLength(2)
		expect(last().url).toContain('name=a.png')
		// The re-send starts from zero; the bar stays put until it catches up
		tick()
		last().progress(30)
		expect(photosUploads.snapshot().progress).toBeCloseTo(0.6)
		tick()
		last().progress(80)
		expect(photosUploads.snapshot().progress).toBeCloseTo(0.8)
		last().respond(200)
		expect(photosUploads.snapshot().status).toBe('idle')
	})

	it('a server rejection skips just that file and carries on', () => {
		const errorsBefore = photosUploads.snapshot().errorsTotal
		photosUploads.enqueue([makeFile('bad.png', 100), makeFile('good.png', 100)])
		last().respond(400)
		expect(photosUploads.snapshot()).toMatchObject({status: 'uploading', done: 0, total: 1})
		expect(photosUploads.snapshot().errorsTotal).toBe(errorsBefore + 1)
		expect(last().url).toContain('name=good.png')
		last().respond(200)
		expect(photosUploads.snapshot().status).toBe('idle')
	})

	it('a skipped file releases its bytes from the bar', () => {
		photosUploads.enqueue([makeFile('big.png', 900)])
		photosUploads.enqueue([makeFile('small.png', 100)]) // joins behind the in-flight big one
		tick()
		last().progress(900)
		expect(photosUploads.snapshot().progress).toBeCloseTo(0.9)

		// The server rejects big.png after it streamed: its dead bytes must
		// leave both sides of the fraction, not pin the bar near 100%
		last().respond(500)
		expect(photosUploads.snapshot()).toMatchObject({done: 0, total: 1})
		expect(photosUploads.snapshot().progress).toBeCloseTo(0)
		tick()
		last().progress(50)
		expect(photosUploads.snapshot().progress).toBeCloseTo(0.5)
		last().respond(200)
		expect(photosUploads.snapshot().status).toBe('idle')
	})

	it('a duplicate counts itself, not as added and not as an error', () => {
		const errorsBefore = photosUploads.snapshot().errorsTotal
		photosUploads.enqueue([makeFile('again.png', 100), makeFile('new.png', 100)])
		last().respond(200, JSON.stringify({status: 'duplicate'}))
		// It leaves the run's total (nothing was added) and frees its bytes
		expect(photosUploads.snapshot()).toMatchObject({status: 'uploading', done: 0, total: 1, duplicates: 1})
		expect(photosUploads.snapshot().errorsTotal).toBe(errorsBefore)
		expect(last().url).toContain('name=new.png')
		last().respond(200, JSON.stringify({status: 'imported'}))
		expect(photosUploads.snapshot().status).toBe('idle')
	})

	it('a network error pauses the run for a retry', () => {
		photosUploads.enqueue([makeFile('a.png', 100)])
		last().onerror?.()
		expect(photosUploads.snapshot()).toMatchObject({status: 'paused', total: 1})

		photosUploads.resume()
		last().respond(200)
		expect(photosUploads.snapshot().status).toBe('idle')
	})

	it('uploads smaller files first, without disturbing the file on the wire', () => {
		photosUploads.enqueue([makeFile('big.png', 900), makeFile('small.png', 100), makeFile('mid.png', 500)])
		// big.png went on the wire before the batch could be known to be sorted?
		// No — sorting happens before the first send: small goes first
		expect(last().url).toContain('name=small.png')

		// A batch joining mid-run sorts in behind the in-flight file
		photosUploads.enqueue([makeFile('tiny.png', 10)])
		last().respond(200) // small done; tiny is next despite arriving last
		expect(last().url).toContain('name=tiny.png')
		last().respond(200)
		expect(last().url).toContain('name=mid.png')
	})

	it('samples wire speed into an ETA', () => {
		photosUploads.enqueue([makeFile('a.png', 4000)])
		tick()
		last().progress(1000)
		tick()
		last().progress(2000)
		const {speed, etaSeconds} = photosUploads.snapshot()
		// 1000 bytes over the 200ms between samples = 5000 B/s
		expect(speed).toBeGreaterThan(0)
		expect(etaSeconds).toBeGreaterThan(0)

		// Pausing forgets the pace (the wire is quiet now)
		photosUploads.pause()
		expect(photosUploads.snapshot().speed).toBeUndefined()
	})

	it('files enqueued mid-run join the queue; while paused they wait', () => {
		const batchesBefore = photosUploads.snapshot().enqueuedBatches
		photosUploads.enqueue([makeFile('a.png', 100)])
		photosUploads.enqueue([makeFile('b.png', 100)])
		expect(photosUploads.snapshot().total).toBe(2)
		// Each drop counts once — the island re-opens per batch, not per file
		expect(photosUploads.snapshot().enqueuedBatches).toBe(batchesBefore + 2)
		expect(FakeXHR.instances).toHaveLength(1)

		photosUploads.pause()
		photosUploads.enqueue([makeFile('c.png', 100)])
		expect(photosUploads.snapshot()).toMatchObject({status: 'paused', total: 3})
		expect(FakeXHR.instances).toHaveLength(1)
	})

	it('splits photos and videos from everything else, by extension', () => {
		const supported = [
			...['jpg', 'jpeg', 'jfif', 'jpe', 'png', 'gif', 'webp', 'avif', 'heic', 'heif'],
			...['tif', 'tiff', 'bmp', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2'],
			...['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', '3gp', '3g2'],
			...['mts', 'm2ts', 'mpg', 'mpeg', 'wmv', '360', 'insv'],
		].map((extension, index) => makeFile(`media-${index}.${extension.toUpperCase()}`, 10, ''))
		const files = [
			...supported,
			makeFile('backup.zip', 10, 'application/zip'),
			// A photo the picker mislabels still counts; extensionless never does
			makeFile('scan.png', 10, 'application/octet-stream'),
			makeFile('README', 10, ''),
			makeFile('.heic', 10, ''),
		]
		const {media, others} = splitMediaFiles(files)
		expect(media.map((file) => file.name)).toEqual([...supported.map((file) => file.name), 'scan.png'])
		expect(others.map((file) => file.name)).toEqual(['backup.zip', 'README', '.heic'])
	})

	it('advertises explicit picker filters for formats browsers do not classify consistently', () => {
		expect(PHOTOS_MEDIA_ACCEPT.split(',')).toEqual(
			expect.arrayContaining(['image/*', 'video/*', '.dng', '.cr3', '.mts', '.360', '.insv']),
		)
	})

	it('cancel aborts and clears the whole run', () => {
		photosUploads.enqueue([makeFile('a.png', 100), makeFile('b.png', 100)])
		const first = last()
		photosUploads.cancel()
		expect(first.aborted).toBe(true)
		expect(photosUploads.snapshot()).toMatchObject({status: 'idle', done: 0, total: 0, progress: 0})
		expect(revoked).toContain('blob:a.png')
	})
})
