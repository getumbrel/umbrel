import {Worker, type WorkerOptions} from 'node:worker_threads'

import {deserializeError} from '../file-index-worker-protocol.js'
import {
	readLane,
	type FileIndexReadArgs,
	type FileIndexReadMethod,
	type FileIndexReaderPaths,
	type FileIndexReadResult,
} from './reader.js'
import type {ReadLane} from './read-database.js'
import type {FileIndexReaderRequest, FileIndexReaderResponse} from './reader-worker.js'

export type FileIndexReaderPoolOptions = {
	size?: number
	reservedReaders?: number
	createWorker?: (url: URL, options: WorkerOptions) => Worker
	startupTimeoutMs?: number
	snapshotTimeoutMs?: number
}

type PrepareSnapshot = (begin: () => Promise<void>) => Promise<void>
type Job = {
	id: number
	method: FileIndexReadMethod
	lane: ReadLane
	priority: number
	args: unknown[]
	prepare: PrepareSnapshot
	result: ReturnType<typeof deferred<unknown>>
	snapshot: ReturnType<typeof deferred<void>>
	sent: boolean
	completed: boolean
}
type Slot = {lane?: ReadLane; worker?: Worker; ready?: ReturnType<typeof deferred<void>>; job?: Job}

// Waiting for a reader happens outside the writer queue. The writer only waits
// for the selected reader to pin both snapshots, then resumes mutations while
// the expensive SELECT runs on another thread.
export default class FileIndexReaderPool {
	#paths: FileIndexReaderPaths
	#slots: Slot[]
	#queue: Job[] = []
	#nextId = 1
	#stopped = false
	#createWorker: NonNullable<FileIndexReaderPoolOptions['createWorker']>
	#startupTimeoutMs: number
	#snapshotTimeoutMs: number

	constructor(
		paths: FileIndexReaderPaths,
		{
			// Default-cache device tests favored two readers for limited RAM:
			// reserving one for quick reads avoided scan-induced thumbnail stalls
			// at roughly half the warmed memory of four. More readers improved
			// some bulk workloads, but did not provide a consistent overall win.
			size = 2,
			reservedReaders = Math.min(1, size - 1),
			createWorker = (url, options) => new Worker(url, options),
			startupTimeoutMs = 30_000,
			snapshotTimeoutMs = 10_000,
		}: FileIndexReaderPoolOptions = {},
	) {
		if (!Number.isInteger(size) || size < 1 || size > 4) throw new TypeError('Expected 1–4 file index readers')
		if (!Number.isInteger(reservedReaders) || reservedReaders < 0 || reservedReaders >= size)
			throw new TypeError('Expected at least one reader available for slow queries')
		this.#paths = paths
		// Reserve capacity for thumbnails and point reads during scan/search bursts.
		// Shared readers also serve quick work whenever no higher-priority job waits.
		// A slow-only reader slightly improved cache hits in device tests, but
		// serializing all quick work on one reader made point-read bursts slower.
		// Visit reserved slots first so quick work leaves shared capacity available.
		this.#slots = Array.from({length: size}, (_, index) => ({
			lane: index < reservedReaders ? 'interactive' : undefined,
		}))
		this.#createWorker = createWorker
		this.#startupTimeoutMs = startupTimeoutMs
		this.#snapshotTimeoutMs = snapshotTimeoutMs
	}

	async start() {
		if (this.#stopped) throw new Error('File index readers are stopped')
		try {
			// Pay worker/module startup before the index accepts requests. SQLite
			// still fills its page caches on demand, using the default cache limit.
			await Promise.all(this.#slots.map((slot) => this.#boot(slot)))
			if (this.#stopped) throw new Error('File index readers are stopped')
		} catch (error) {
			// A partial startup must not leave idle workers holding database files.
			await this.stop()
			throw error
		}
	}

	read<M extends FileIndexReadMethod>(
		method: M,
		args: FileIndexReadArgs<M>,
		prepare: PrepareSnapshot,
		{lane = readLane(method, args), priority = 0}: {lane?: ReadLane; priority?: number} = {},
	) {
		if (this.#stopped)
			return Promise.reject(new Error('File index readers are stopped')) as Promise<FileIndexReadResult<M>>
		// A Files search/listing can fan out to hundreds of thumbnail lookups.
		// Bound execution with worker slots, not admission: rejecting queued reads
		// makes those callers mistake temporary congestion for missing metadata.
		const job: Job = {
			id: this.#nextId++,
			method,
			lane,
			priority,
			args,
			prepare,
			result: deferred<unknown>(),
			snapshot: deferred<void>(),
			sent: false,
			completed: false,
		}
		this.#queue.push(job)
		this.#pump()
		return job.result.promise as Promise<FileIndexReadResult<M>>
	}

	status() {
		return {
			threadIds: this.#slots.flatMap(({worker}) => (worker ? [worker.threadId] : [])),
			active: this.#slots.filter(({job}) => job).length,
			queued: this.#queue.length,
		}
	}

	#pump() {
		if (this.#stopped) return
		for (const slot of this.#slots) {
			if (slot.job) continue
			let selected = -1
			for (let index = 0; index < this.#queue.length; index++) {
				const job = this.#queue[index]!
				if (slot.lane && job.lane !== slot.lane) continue
				if (selected === -1 || job.priority > this.#queue[selected]!.priority) selected = index
			}
			if (selected === -1) continue
			const [job] = this.#queue.splice(selected, 1)
			if (!job) continue
			slot.job = job
			void this.#run(slot, job).finally(() => {
				slot.job = undefined
				this.#pump()
			})
		}
	}

	async #run(slot: Slot, job: Job) {
		try {
			// Reuse the started worker, or replace it after a crash or timeout.
			await this.#boot(slot)
			if (this.#stopped) throw new Error('File index readers are stopped')
			await job.prepare(async () => {
				if (this.#stopped || !slot.worker) throw new Error('File index reader is unavailable')
				const message: FileIndexReaderRequest = {id: job.id, method: job.method, args: job.args}
				job.sent = true
				slot.worker.postMessage(message)
				await withTimeout(job.snapshot.promise, this.#snapshotTimeoutMs, 'File index snapshot timed out')
			})
			await job.result.promise
		} catch (error) {
			if (job.sent && !job.completed) await this.#discard(slot, error)
			job.snapshot.reject(error)
			job.result.reject(error)
		}
	}

	async #boot(slot: Slot) {
		if (slot.worker) return slot.ready!.promise
		const worker = this.#createWorker(new URL('./reader-worker-bootstrap.js', import.meta.url), {
			workerData: this.#paths,
			execArgv: [],
			name: `file-index-reader-${slot.lane ?? 'shared'}`,
		})
		slot.worker = worker
		slot.ready = deferred<void>()
		worker.on('message', (message: FileIndexReaderResponse) => {
			if (slot.worker !== worker) return
			if (message.type === 'ready') return slot.ready!.resolve()
			if (message.type === 'startup-error') return slot.ready!.reject(deserializeError(message.error))
			const job = slot.job
			if (!job || job.id !== message.id) return
			if (message.type === 'snapshot') return job.snapshot.resolve()
			job.completed = true
			if (message.type === 'error') {
				const error = deserializeError(message.error)
				job.snapshot.reject(error)
				job.result.reject(error)
			} else job.result.resolve(message.result)
		})
		worker.on('error', (error) => {
			if (slot.worker === worker) void this.#discard(slot, error)
		})
		worker.once('exit', (code) => {
			if (slot.worker === worker) void this.#discard(slot, new Error(`File index reader exited with code ${code}`))
		})
		try {
			await withTimeout(slot.ready.promise, this.#startupTimeoutMs, 'File index reader startup timed out')
		} catch (error) {
			await this.#discard(slot, error)
			throw error
		}
	}

	async #discard(slot: Slot, error: unknown) {
		const worker = slot.worker
		slot.worker = undefined
		slot.ready?.reject(error)
		slot.job?.snapshot.reject(error)
		slot.job?.result.reject(error)
		await worker?.terminate().catch(() => {})
	}

	async stop() {
		this.#stopped = true
		const error = new Error('File index readers are stopped')
		for (const job of this.#queue.splice(0)) job.result.reject(error)
		await Promise.all(this.#slots.map((slot) => this.#discard(slot, error)))
	}
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	// A worker can fail while its caller is still waiting for writer preparation.
	void promise.catch(() => {})
	return {promise, resolve, reject}
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), milliseconds)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}
