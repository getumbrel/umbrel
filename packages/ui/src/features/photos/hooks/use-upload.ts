import {useCallback, useEffect, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {dashboardAuthHeaders} from '@/modules/auth/http-auth'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'

// The Photos upload queue. Module-scoped — one run for the whole app — so
// uploads keep going across route changes and the floating island (mounted
// outside the /photos tree) can watch them. Files go up one at a time over
// XHR (fetch has no upload progress events).
//
// Pause aborts the file on the wire but leaves it at the head of the queue,
// so resume simply re-sends it — the server stages uploads in a temp file, so
// an aborted file leaves nothing behind. A network error pauses the run the
// same way (resume = retry); a server rejection skips just that file, since
// re-sending it would fail again.
//
// One POST per file to /api/photos/upload; bytes land in the account's Photos
// directory and the indexed import pipeline performs content dedupe and album
// assignment.

export type PhotosUploadsSnapshot = {
	status: 'idle' | 'uploading' | 'paused'
	// Files uploaded / expected this run ("2 / 6 added"). Skipped files leave
	// `total`, so it stays the count that will actually be added.
	done: number
	total: number
	// Files the server already had (the upload answered {status: 'duplicate'})
	// this run — "3 already in your library"
	duplicates: number
	// 0..1 across the whole run, weighted by bytes. Monotonic while the run's
	// shape holds: a pause throws away the current file's partial bytes, but
	// the bar freezes where it was and catches up after resume instead of
	// sliding backwards. (New batches still lower it — the run grew.)
	progress: number
	currentName?: string
	// Object URL for the current photo, for the island's thumbnail; unset for
	// files the browser can't preview
	currentPreview?: string
	// Smoothed wire speed in bytes/s, and the seconds it implies for the rest
	// of the run; unset until there is enough signal
	speed?: number
	etaSeconds?: number
	// Monotonic across runs, for the toast/invalidation effects below —
	// and enqueuedBatches, which re-opens the island when a new drop joins
	uploadedTotal: number
	errorsTotal: number
	enqueuedBatches: number
}

type Queued = {file: File; albumId?: string}

// What the library accepts, by extension. This mirrors the server as a
// client-side courtesy; the server remains authoritative.
const MEDIA_EXTENSIONS = new Set([
	...[
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
	],
	...['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', '3gp', '3g2', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', '360', 'insv'],
])
export const PHOTOS_MEDIA_ACCEPT = [
	'image/*',
	'video/*',
	...[...MEDIA_EXTENSIONS].map((extension) => `.${extension}`),
].join(',')
const isMedia = (file: File) => {
	const dot = file.name.lastIndexOf('.')
	// dot > 0: no extensionless files, and no dotfiles (the walk skips those)
	return dot > 0 && MEDIA_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase())
}

// The photos and videos in a pick or drop, apart from everything else (a
// folder drop often carries strays — an archive, a sidecar file)
export function splitMediaFiles(files: File[] | FileList) {
	const media: File[] = []
	const others: File[] = []
	for (const file of files) (isMedia(file) ? media : others).push(file)
	return {media, others}
}

let queue: Queued[] = []
let status: PhotosUploadsSnapshot['status'] = 'idle'
let done = 0
let total = 0
let duplicates = 0
let doneBytes = 0
let totalBytes = 0
let loaded = 0 // bytes of the current file already on the wire
let preview: string | undefined
let previewFile: File | undefined
let request: XMLHttpRequest | undefined
let uploadedTotal = 0
let errorsTotal = 0
let enqueuedBatches = 0
let speed = 0 // bytes/s, exponentially smoothed
let lastSampleAt = 0
let lastTransferred = 0
let shownBytes = 0 // high-water mark of transferred bytes, so the bar never slides back

const listeners = new Set<() => void>()
let snapshot = buildSnapshot()

function buildSnapshot(): PhotosUploadsSnapshot {
	const remaining = totalBytes - doneBytes - loaded
	shownBytes = Math.max(shownBytes, doneBytes + loaded)
	return {
		status,
		done,
		total,
		duplicates,
		progress: totalBytes > 0 ? Math.min(1, shownBytes / totalBytes) : 0,
		currentName: queue[0]?.file.name,
		currentPreview: preview,
		speed: speed > 0 ? speed : undefined,
		etaSeconds: speed > 0 && remaining > 0 ? Math.ceil(remaining / speed) : undefined,
		uploadedTotal,
		errorsTotal,
		enqueuedBatches,
	}
}

function emit() {
	snapshot = buildSnapshot()
	listeners.forEach((listener) => listener())
}

// Progress events arrive far faster than the bar needs to move; the same
// cadence samples the wire speed (smoothed, so the ETA doesn't flicker)
let lastProgressEmit = 0
function emitProgress() {
	const now = Date.now()
	if (now - lastProgressEmit < 150) return
	lastProgressEmit = now
	const transferred = doneBytes + loaded
	if (lastSampleAt) {
		const instant = Math.max(0, ((transferred - lastTransferred) / (now - lastSampleAt)) * 1000)
		speed = speed > 0 ? speed * 0.7 + instant * 0.3 : instant
	}
	lastSampleAt = now
	lastTransferred = transferred
	emit()
}

// The wire went quiet (pause, error, run over): the next run of samples
// starts fresh
function resetSpeed() {
	speed = 0
	lastSampleAt = 0
	lastTransferred = 0
	lastProgressEmit = 0
}

function dropPreview() {
	if (preview) URL.revokeObjectURL(preview)
	preview = undefined
	previewFile = undefined
}

// Keep the island's thumbnail owned by whichever file is at the head of the
// queue (sorting and skipping can change it at any time)
function syncPreview() {
	const file = queue[0]?.file
	if (previewFile === file) return
	dropPreview()
	if (file?.type.startsWith('image/')) {
		preview = URL.createObjectURL(file)
		previewFile = file
	}
}

// The run is over (finished, or cancelled): back to a clean slate
function reset() {
	dropPreview()
	resetSpeed()
	queue = []
	status = 'idle'
	done = 0
	total = 0
	duplicates = 0
	doneBytes = 0
	totalBytes = 0
	loaded = 0
	shownBytes = 0
	request = undefined
	emit()
}

// Send the file at the head of the queue. It stays at the head until it
// succeeds or is skipped, so pause/cancel can simply abort the wire.
function startNext() {
	const next = queue[0]
	if (!next) return reset()
	const {file, albumId} = next
	loaded = 0
	syncPreview()

	const query = new URLSearchParams({name: file.name})
	if (albumId) query.set('album', albumId)
	if (typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)) {
		query.set('lastModified', String(Math.trunc(file.lastModified)))
	}
	const xhr = new XMLHttpRequest()
	request = xhr
	xhr.open('POST', `/api/photos/upload?${query}`)
	if (typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)) {
		xhr.setRequestHeader('X-Umbrel-Photo-Creation-Date-Ms', String(Math.trunc(file.lastModified)))
	}
	const authorization = dashboardAuthHeaders().Authorization
	if (authorization) xhr.setRequestHeader('Authorization', authorization)

	// Every callback guards against being stale: pause/cancel clear `request`
	// before aborting, and a new run means a new xhr
	xhr.upload.onprogress = (event) => {
		if (request !== xhr) return
		loaded = event.loaded
		emitProgress()
	}
	xhr.onload = () => {
		if (request !== xhr) return
		request = undefined
		if (xhr.status >= 200 && xhr.status < 300) {
			// The server's verdict: imported, or already in the library. A
			// duplicate wasn't added, so it leaves `total` like a skip — but it
			// is worth its own count, not an error.
			let verdict: string | undefined
			try {
				verdict = (JSON.parse(xhr.responseText) as {status?: string}).status
			} catch {
				// An unreadable body still 2xx'd: count it as imported
			}
			queue.shift()
			if (verdict === 'duplicate') {
				duplicates++
				total--
				totalBytes -= file.size
				shownBytes = doneBytes
			} else {
				done++
				uploadedTotal++
				doneBytes += file.size
			}
		} else {
			// The server said no; sending the same bytes again would fail again,
			// so drop this file and carry on. Its streamed bytes leave the
			// high-water mark with it, or the bar would overstate — even pin at
			// 100% — for the rest of the run
			errorsTotal++
			queue.shift()
			total--
			totalBytes -= file.size
			shownBytes = doneBytes
		}
		loaded = 0
		startNext()
	}
	xhr.onerror = () => {
		if (request !== xhr) return
		// Network trouble is worth retrying: hold the run with the file still
		// queued, and resume re-sends it
		request = undefined
		errorsTotal++
		loaded = 0
		resetSpeed()
		status = 'paused'
		emit()
	}
	xhr.send(file)
	emit()
}

export const photosUploads = {
	enqueue(files: File[] | FileList, albumId?: string) {
		const added = [...files]
		if (added.length === 0) return
		for (const file of added) queue.push({file, albumId})
		total += added.length
		totalBytes += added.reduce((sum, file) => sum + file.size, 0)
		enqueuedBatches++
		// Smallest first: the count climbs and photos appear in the timeline
		// right away, and one big video can't hold everything else hostage. The
		// file on the wire keeps its place; the rest re-sorts as batches join.
		const inFlight = status === 'uploading' ? 1 : 0
		queue = [...queue.slice(0, inFlight), ...queue.slice(inFlight).sort((a, b) => a.file.size - b.file.size)]
		if (status === 'idle') {
			status = 'uploading'
			startNext()
		} else {
			// Joins the running (or paused) queue; sorting may have changed
			// whose thumbnail the island shows
			syncPreview()
			emit()
		}
	},
	pause() {
		if (status !== 'uploading') return
		const xhr = request
		request = undefined
		xhr?.abort()
		// The current file's partial bytes are gone; it re-sends on resume
		loaded = 0
		resetSpeed()
		status = 'paused'
		emit()
	},
	resume() {
		if (status !== 'paused') return
		status = 'uploading'
		startNext()
	},
	cancel() {
		const xhr = request
		request = undefined
		xhr?.abort()
		reset()
	},
	subscribe(listener: () => void) {
		listeners.add(listener)
		return () => void listeners.delete(listener)
	},
	snapshot: () => snapshot,
}

// The queue's state, live. Safe to use anywhere (the island lives outside the
// /photos tree). Re-renders on every progress tick — for components that show
// the progress.
export function usePhotosUploads() {
	return useSyncExternalStore(photosUploads.subscribe, photosUploads.snapshot)
}

// Just the queue's status. Always-mounted consumers (the island container)
// subscribe to this primitive instead, so progress ticks don't re-render the
// whole floating-island stack seven times a second for the run's duration.
export function usePhotosUploadsStatus() {
	return useSyncExternalStore(photosUploads.subscribe, () => photosUploads.snapshot().status)
}

// Upload into the Photos library — and into the current route's album, when
// it is on one. Returns immediately; the floating island takes it from there.
// Anything that isn't a photo or video is left out of the queue and explained
// in a dialog instead (pointing at Files), so a folder drop with a stray
// archive in it neither fails nor loses the stray silently.
export function useUpload() {
	const {t} = useTranslation()
	const {albumId} = useParams()
	const confirm = useConfirmation()

	const upload = useCallback(
		(files: File[] | FileList) => {
			const {media, others} = splitMediaFiles(files)
			if (media.length > 0) photosUploads.enqueue(media, albumId)
			if (others.length > 0) {
				confirm({
					title: t('photos-upload.not-media-title', {count: others.length, name: others[0]!.name}),
					message: [
						// Lead with reassurance when the rest of the drop is going up
						...(media.length > 0 ? [t('photos-upload.not-media-rest')] : []),
						t('photos-upload.not-media-description'),
					].join(' '),
					actions: [{label: t('ok'), value: 'ok', variant: 'primary'}],
				}).catch(() => {}) // dismissing is acknowledging
			}
		},
		[albumId, confirm, t],
	)

	return {upload}
}

// Side effects of the queue, mounted once in FloatingIslandContainer (always
// on, unlike the island itself): a toast per failure, and marking Photos
// queries stale as files land. No refetching here — on a Photos page the
// server's photos:change events drive the careful in-place refresh
// (use-photos-events.ts); everywhere else stale queries refetch on return.
export function usePhotosUploadsFeedback() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	// Primitive subscriptions: this hook lives in the always-mounted island
	// container, which must not re-render per progress tick
	const status = usePhotosUploadsStatus()
	const uploadedTotal = useSyncExternalStore(photosUploads.subscribe, () => photosUploads.snapshot().uploadedTotal)
	const errorsTotal = useSyncExternalStore(photosUploads.subscribe, () => photosUploads.snapshot().errorsTotal)

	// Leaving the page would kill the queue (paused or not) — have the
	// browser ask first
	useEffect(() => {
		if (status === 'idle') return
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			// Legacy engines need returnValue set for the prompt to show
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [status])

	useEffect(() => {
		if (uploadedTotal > 0) utils.photos.invalidate(undefined, {refetchType: 'none'})
	}, [uploadedTotal, utils])

	useEffect(() => {
		// One reused id so a burst of failures doesn't stack toasts
		if (errorsTotal > 0) toast.error(t('photos-upload.failed'), {id: 'photos-upload-failed', area: 'photos'})
	}, [errorsTotal, t])
}
