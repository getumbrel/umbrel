import {authorizedHttpUrl, dashboardAuthHeaders} from '@/modules/auth/http-auth'
import {trpcClient} from '@/trpc/trpc'

import type {TransferAttempt, TransferExecutor, TransferOutcome} from './transfer-queue'
import type {TransferBatch, TransferItem, TransferLane} from './types'

// How each kind of transfer actually runs. The queue decides when and with
// which collision strategy; these decide how.

export const UPLOAD_NETWORK_ERROR = '[network-error]'
export const UPLOAD_FAILED_ERROR = '[upload-failed]'

// Wire speed is sampled every half second and smoothed, so the row's figure
// reads as a pace rather than a jitter
const SPEED_SAMPLE_MS = 500
const SPEED_SMOOTHING = 0.4

// One raw POST per file, exactly as before. The server stages the bytes in a
// hidden temporary file and only publishes a complete upload, so an aborted
// request leaves nothing behind. The response carries the stored path, which
// differs from the requested one after a keep-both.
export const uploadExecutor: TransferExecutor = async (item, attempt) => {
	const {file, batch, signal} = attempt
	if (!file) return {type: 'failed', error: UPLOAD_FAILED_ERROR}
	// A dropped folder's path exists only in the browser until its folders are
	// created; createDirectory also gives them their proper owner
	try {
		const prepared = await prepareDirectories(batch.destinationDirectory, item.destinationDirectory, {batch, signal})
		if (prepared === 'cancelled') return {type: 'cancelled'}
	} catch (error) {
		return {type: 'failed', error: error instanceof Error ? error.message : String(error)}
	}
	return sendUpload(item, attempt)
}

// The folders a dropped file needs, from the one just below the drop root down
// to its own, created in that order because the server creates one level at a
// time. A folder is created once per batch (a later drop into the same place
// must create it again: it may have been deleted since, and the server would
// otherwise recreate it as root), and uploads that arrive while a folder is
// still being created share that request instead of racing it. A cancel ends
// the wait at once and schedules no deeper folder.
const createdForBatch = new WeakMap<TransferBatch, Set<string>>()
const creationsInFlight = new Map<string, Promise<void>>()

export async function prepareDirectories(
	root: string,
	directory: string,
	{batch, signal}: {batch: TransferBatch; signal: AbortSignal},
): Promise<'prepared' | 'cancelled'> {
	const prefix = root === '/' ? '/' : `${root}/`
	if (directory === root || !directory.startsWith(prefix)) return 'prepared'
	const chain: string[] = []
	for (let current = directory; current !== root; current = current.substring(0, current.lastIndexOf('/')) || '/') {
		chain.unshift(current)
	}
	let created = createdForBatch.get(batch)
	if (!created) createdForBatch.set(batch, (created = new Set()))
	for (const path of chain) {
		if (signal.aborted) return 'cancelled'
		if (created.has(path)) continue
		let creation = creationsInFlight.get(path)
		if (!creation) {
			creation = trpcClient.files.createDirectory.mutate({path}).then(() => undefined)
			creationsInFlight.set(path, creation)
			creation.finally(() => creationsInFlight.delete(path)).catch(() => {})
		}
		const settled = await Promise.race([creation.then(() => 'created' as const), whenAborted(signal)])
		if (settled !== 'created') return 'cancelled'
		created.add(path)
	}
	return 'prepared'
}

const sendUpload = (item: TransferItem, {collision, file, signal, onProgress}: TransferAttempt) =>
	new Promise<TransferOutcome>((resolve) => {
		if (!file) return resolve({type: 'failed', error: UPLOAD_FAILED_ERROR})
		const xhr = new XMLHttpRequest()
		xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(item.path)}&collision=${collision}`)
		const authorization = dashboardAuthHeaders().Authorization
		if (authorization) xhr.setRequestHeader('Authorization', authorization)

		let sampledAt = Date.now()
		let sampledLoaded = 0
		let bytesPerSecond = 0
		xhr.upload.onprogress = (event) => {
			if (!event.lengthComputable) return
			const now = Date.now()
			const elapsed = now - sampledAt
			if (elapsed >= SPEED_SAMPLE_MS) {
				const instant = ((event.loaded - sampledLoaded) / elapsed) * 1000
				bytesPerSecond = bytesPerSecond === 0 ? instant : bytesPerSecond + SPEED_SMOOTHING * (instant - bytesPerSecond)
				sampledAt = now
				sampledLoaded = event.loaded
			}
			onProgress({
				transferredBytes: event.loaded,
				progress: event.total > 0 ? (event.loaded / event.total) * 100 : 100,
				bytesPerSecond,
				allBytesSent: event.loaded >= event.total,
			})
		}
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve({type: 'completed', path: storedPath(xhr.responseText) ?? item.path})
				return
			}
			const error = errorCode(xhr.responseText)
			if (error?.includes('[destination-already-exists]')) resolve({type: 'conflict'})
			else resolve({type: 'failed', error: error ?? UPLOAD_FAILED_ERROR})
		}
		xhr.onerror = () => resolve(outcomeOfNetworkError(item, collision, signal))
		xhr.onabort = () => resolve({type: 'cancelled'})
		signal.addEventListener('abort', () => xhr.abort(), {once: true})
		xhr.send(file)
	})

// The server rejects a name collision before reading the body and closes the
// connection. On a fast link the browser can be mid-send at that moment and
// report a connection reset instead of the 400. When the attempt was the
// collision-checked kind, a destination that exists now is that rejection.
// Existence is asked of the view endpoint, which answers 404 for a missing
// path for owner and member alike. The endpoint only authorizes GET, so the
// probe asks for the first byte rather than sending a HEAD. An empty file
// answers that a range cannot be satisfied and a folder answers that it
// cannot be viewed: both are there, and both collide with an upload of that
// name. Anything less certain stays a network error, and a cancel while the
// lookup is out ends it at once.
const PRESENT_STATUSES = new Set([200, 206, 416, 400])

async function outcomeOfNetworkError(
	item: TransferItem,
	collision: TransferAttempt['collision'],
	signal: AbortSignal,
): Promise<TransferOutcome> {
	if (collision !== 'error') return {type: 'failed', error: UPLOAD_NETWORK_ERROR}
	const lookup = async (): Promise<TransferOutcome> => {
		try {
			const url = await authorizedHttpUrl(`/api/files/view?path=${encodeURIComponent(item.path)}`)
			if (signal.aborted) return {type: 'cancelled'}
			const response = await fetch(url, {headers: {Range: 'bytes=0-0'}, signal})
			await response.body?.cancel().catch(() => {})
			if (PRESENT_STATUSES.has(response.status)) return {type: 'conflict'}
		} catch {
			// Unreachable server, or aborted: settled below
		}
		return signal.aborted ? {type: 'cancelled'} : {type: 'failed', error: UPLOAD_NETWORK_ERROR}
	}
	if (signal.aborted) return {type: 'cancelled'}
	return Promise.race([lookup(), whenAborted(signal)])
}

function whenAborted(signal: AbortSignal) {
	return new Promise<TransferOutcome>((resolve) => {
		signal.addEventListener('abort', () => resolve({type: 'cancelled'}), {once: true})
	})
}

function storedPath(responseText: string) {
	try {
		const body: unknown = JSON.parse(responseText)
		if (typeof body === 'object' && body !== null && 'path' in body && typeof body.path === 'string') return body.path
	} catch {
		// A 2xx without a JSON body: the requested path is the best we know
	}
	return undefined
}

function errorCode(responseText: string) {
	try {
		const body: unknown = JSON.parse(responseText)
		if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string')
			return body.error
	} catch {
		// Non-JSON error bodies fall through to the generic message
	}
	return undefined
}

// Copies and moves are single server mutations. The request is awaited to its
// end so the lane's slot stays taken for the whole operation; progress arrives
// separately through the operation-progress stream. Cancellation is not
// possible mid-flight yet (see cancellableWhileRunning), so the signal is
// deliberately ignored: aborting the request would leave the server copying
// while the UI claimed otherwise.
export const serverExecutor: TransferExecutor = async (item, {collision}) => {
	if (!item.sourcePath) return {type: 'failed', error: '[source-not-exists]'}
	const input = {path: item.sourcePath, toDirectory: item.destinationDirectory, collision}
	try {
		const path =
			item.kind === 'move' ? await trpcClient.files.move.mutate(input) : await trpcClient.files.copy.mutate(input)
		return {type: 'completed', path}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('[destination-already-exists]')) return {type: 'conflict'}
		return {type: 'failed', error: message}
	}
}

export const executeTransfer: TransferExecutor = (item, attempt) =>
	item.kind === 'upload' ? uploadExecutor(item, attempt) : serverExecutor(item, attempt)

// Which storage device a virtual path lives on, as far as the browser can
// tell. Everything internal is one pool; each external drive and each
// network share is its own.
export function storageRoot(path: string) {
	const segments = path.split('/').filter(Boolean)
	if (segments[0] === 'External') return segments.slice(0, 2).join('/')
	if (segments[0] === 'Network') return segments.slice(0, 3).join('/')
	return 'internal'
}

// A move within one device is a rename on the server: instant, and it must
// not wait behind a streaming copy. Getting this wrong only means the item
// shares the disk with a copy, which is what happened before queueing.
export function laneFor({
	kind,
	sourcePath,
	destinationDirectory,
}: Pick<TransferItem, 'kind' | 'sourcePath' | 'destinationDirectory'>): TransferLane {
	if (kind === 'upload') return 'upload'
	if (kind === 'move' && sourcePath && storageRoot(sourcePath) === storageRoot(destinationDirectory)) return 'instant'
	return 'streamed'
}

export const TRANSFER_CONCURRENCY: Record<TransferLane, number> = {upload: 2, instant: 1, streamed: 1}

export const cancellableWhileRunning = (item: TransferItem) => item.kind === 'upload'
