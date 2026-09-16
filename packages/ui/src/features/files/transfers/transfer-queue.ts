import {
	isTerminalTransferState,
	type CollisionDecision,
	type TransferBatch,
	type TransferItem,
	type TransferKind,
	type TransferLane,
	type TransfersSnapshot,
	type TransferState,
} from './types'

// The Files transfer queue: one bounded, batch-aware FIFO for uploads, copies
// and moves. It is a plain module-scoped store (no React) so transfers keep
// running across route changes and the floating island can watch them.
//
// The store owns scheduling, batches, state transitions, byte accounting,
// conflict decisions and cancellation. It knows nothing about XHRs or tRPC:
// an executor runs one attempt of one item and reports an outcome, and the
// store decides what that outcome means for the item and its batch.
//
// One user action (a drop, a paste) is one batch. A batch groups progress,
// conflicts, cancellation and results; it is not a transaction.

export type TransferProgressUpdate = {
	transferredBytes?: number
	progress?: number
	bytesPerSecond?: number
	// The browser has handed every byte to the network. The server will now
	// either publish or fail the item, so cancelling would only hide the truth.
	allBytesSent?: boolean
}

export type TransferOutcome =
	| {type: 'completed'; path: string}
	| {type: 'conflict'}
	| {type: 'failed'; error: string}
	| {type: 'cancelled'}

export type TransferAttempt = {
	collision: 'error' | 'replace' | 'keep-both'
	file?: File
	// The batch the item belongs to: a folder upload needs its drop root to
	// know which folders are new
	batch: TransferBatch
	signal: AbortSignal
	onProgress: (update: TransferProgressUpdate) => void
}

export type TransferExecutor = (item: TransferItem, attempt: TransferAttempt) => Promise<TransferOutcome>

export type TransferQueueOptions = {
	execute: TransferExecutor
	laneFor: (item: Pick<TransferItem, 'kind' | 'sourcePath' | 'destinationDirectory'>) => TransferLane
	concurrency: Record<TransferLane, number>
	// A browser upload can be aborted mid-flight. A server copy cannot be
	// stopped safely until the backend stages and cancels it, so its running
	// rows carry no cancel control.
	cancellableWhileRunning: (item: TransferItem) => boolean
}

export type TransferTransitionListener = (item: TransferItem, previous: TransferState) => void

// A dropped file carries its folder path from react-dropzone; one picked
// through a directory input carries it as webkitRelativePath
export type UploadSource = File & {path?: string}

export type ServerTransferSource = {name: string; path: string; type: string; size?: number}

// batchId is null when nothing was enqueued (an empty drop)
export type EnqueueResult = {batchId: string | null; itemIds: string[]}

// A finished batch stays long enough for its last row to land and leave, and
// for the header to read Done, before the section itself goes
const RETIRE_COMPLETED_AFTER_MS = 1600
const RETIRE_ABANDONED_AFTER_MS = 400
// Progress ticks arrive many times a second per running item; the UI needs far fewer
const PROGRESS_INTERVAL_MS = 200

const LANES: TransferLane[] = ['upload', 'instant', 'streamed']

let idSequence = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++idSequence).toString(36)}`

const dirname = (path: string) => path.substring(0, path.lastIndexOf('/')) || '/'

export class TransferQueue {
	#options: TransferQueueOptions
	#items = new Map<string, TransferItem>()
	#batches = new Map<string, TransferBatch>()
	// Upload payloads live outside the snapshot; released as soon as the item settles
	#files = new Map<string, File>()
	#objectUrls = new Map<string, string>()
	#controllers = new Map<string, AbortController>()
	// Running items and the lane slot each one occupies
	#active = new Map<string, TransferLane>()
	// Queued item ids per lane, front to back
	#lanes: Record<TransferLane, string[]> = {upload: [], instant: [], streamed: []}
	#lastProgressAt = new Map<string, number>()
	#retireTimers = new Map<string, ReturnType<typeof setTimeout>>()
	// Per-batch counts kept as items change state, so deciding whether a batch
	// may retire never rescans it (a large drop would make that quadratic)
	#unfinished = new Map<string, number>()
	#failed = new Map<string, number>()
	// A bulk cancel defers lane cleanup and retirement until it is done
	#bulk = false
	#retirementsDue = new Set<string>()
	#listeners = new Set<() => void>()
	#transitionListeners = new Set<TransferTransitionListener>()
	#pendingTransitions: Array<[TransferItem, TransferState]> = []
	#snapshot: TransfersSnapshot | undefined
	#wake = 0
	#mutationDepth = 0
	#dirty = false

	constructor(options: TransferQueueOptions) {
		this.#options = options
	}

	// --- Subscription -------------------------------------------------------

	subscribe = (listener: () => void) => {
		this.#listeners.add(listener)
		return () => void this.#listeners.delete(listener)
	}

	// Stable until the next mutation, so useSyncExternalStore and memoised
	// selectors only redo work when something changed
	snapshot = (): TransfersSnapshot => {
		if (!this.#snapshot) {
			this.#snapshot = {batches: [...this.#batches.values()], items: new Map(this.#items), wake: this.#wake}
		}
		return this.#snapshot
	}

	// Fires after every state change of every item, once the change is visible
	// in the snapshot. Used to refresh listings and pending treatments.
	onTransition = (listener: TransferTransitionListener) => {
		this.#transitionListeners.add(listener)
		return () => void this.#transitionListeners.delete(listener)
	}

	item = (id: string) => this.#items.get(id)

	// An object URL for an image upload's preview, created on first request
	// and revoked when the item settles, so a drop of thousands of photos
	// never decodes more than the rows on screen
	thumbnailUrl = (id: string) => {
		const existing = this.#objectUrls.get(id)
		if (existing) return existing
		const file = this.#files.get(id)
		if (!file || !file.type.startsWith('image/')) return undefined
		const url = URL.createObjectURL(file)
		this.#objectUrls.set(id, url)
		return url
	}

	// --- Enqueue ------------------------------------------------------------

	enqueueUploads(files: Iterable<UploadSource>, destinationDirectory: string): EnqueueResult {
		const sources = [...files]
		if (sources.length === 0) return {batchId: null, itemIds: []}
		const destination = destinationDirectory.replace(/\/+$/, '') || '/'
		const itemIds: string[] = []
		let batch!: TransferBatch
		this.#mutate(() => {
			batch = this.#createBatch('upload', destination)
			for (const file of sources) {
				// Dropped folders arrive as files with their relative path; the
				// upload creates the intermediate folders before it sends
				const within = file.path || file.webkitRelativePath || file.name
				const relative = within.startsWith('/') ? within : `/${within}`
				const path = `${destination === '/' ? '' : destination}${relative}`
				const item = this.#createItem({
					batchId: batch.id,
					kind: 'upload',
					name: file.name,
					type: file.type || 'file',
					size: file.size,
					path,
					destinationDirectory: dirname(path),
				})
				this.#files.set(item.id, file)
				itemIds.push(item.id)
			}
			batch.itemIds = itemIds
			this.#wake++
		})
		this.#pump()
		return {batchId: batch.id, itemIds}
	}

	enqueueServer(
		kind: Exclude<TransferKind, 'upload'>,
		sources: ServerTransferSource[],
		destinationDirectory: string,
	): EnqueueResult {
		if (sources.length === 0) return {batchId: null, itemIds: []}
		const destination = destinationDirectory.replace(/\/+$/, '') || '/'
		const itemIds: string[] = []
		let batch!: TransferBatch
		this.#mutate(() => {
			batch = this.#createBatch(kind, destination)
			for (const source of sources) {
				const item = this.#createItem({
					batchId: batch.id,
					kind,
					name: source.name,
					type: source.type,
					size: source.size,
					sourcePath: source.path,
					path: `${destination === '/' ? '' : destination}/${source.name}`,
					destinationDirectory: destination,
				})
				itemIds.push(item.id)
			}
			batch.itemIds = itemIds
			this.#wake++
		})
		this.#pump()
		return {batchId: batch.id, itemIds}
	}

	#createBatch(kind: TransferKind, destinationDirectory: string): TransferBatch {
		const batch: TransferBatch = {id: nextId('batch'), kind, destinationDirectory, createdAt: Date.now(), itemIds: []}
		this.#batches.set(batch.id, batch)
		this.#dirty = true
		return batch
	}

	#createItem(
		fields: Pick<
			TransferItem,
			'batchId' | 'kind' | 'name' | 'type' | 'size' | 'sourcePath' | 'path' | 'destinationDirectory'
		>,
	) {
		const item: TransferItem = {
			id: nextId('transfer'),
			lane: this.#options.laneFor(fields),
			state: 'queued',
			progress: 0,
			transferredBytes: 0,
			bytesPerSecond: 0,
			attempts: 0,
			...fields,
		}
		this.#items.set(item.id, item)
		this.#unfinished.set(item.batchId, (this.#unfinished.get(item.batchId) ?? 0) + 1)
		this.#lanes[item.lane].push(item.id)
		this.#dirty = true
		return item
	}

	// --- Scheduling ---------------------------------------------------------

	#pump() {
		this.#mutate(() => {
			for (const lane of LANES) {
				const queue = this.#lanes[lane]
				while (this.#runningIn(lane) < this.#options.concurrency[lane]) {
					const id = queue.shift()
					if (id === undefined) break
					const item = this.#items.get(id)
					// Cancelled while waiting: the slot goes to the next item
					if (!item || item.state !== 'queued') continue
					this.#start(item)
				}
			}
		})
	}

	#runningIn(lane: TransferLane) {
		let count = 0
		for (const active of this.#active.values()) if (active === lane) count++
		return count
	}

	#start(item: TransferItem) {
		const controller = new AbortController()
		this.#controllers.set(item.id, controller)
		this.#active.set(item.id, item.lane)
		const attempts = item.attempts + 1
		const collision = item.collision ?? 'error'
		const started = this.#set(item.id, {
			state: 'running',
			attempts,
			progress: 0,
			transferredBytes: 0,
			bytesPerSecond: 0,
			secondsRemaining: undefined,
			error: undefined,
		})
		const onProgress = (update: TransferProgressUpdate) => this.#progress(item.id, attempts, update)
		// The attempt promise settles from the executor's own completion
		// handlers, never from merely having started; that is what makes the
		// lane's concurrency real
		this.#options
			.execute(started, {
				collision,
				file: this.#files.get(item.id),
				batch: this.#batches.get(item.batchId)!,
				signal: controller.signal,
				onProgress,
			})
			.catch((error: unknown): TransferOutcome => ({type: 'failed', error: errorMessage(error)}))
			.then((outcome) => this.#settle(item.id, attempts, outcome))
	}

	#progress(id: string, attempts: number, update: TransferProgressUpdate) {
		const item = this.#items.get(id)
		if (!item || item.attempts !== attempts || !this.#active.has(id)) return
		// A cancel in flight freezes the row; the outcome will settle it
		if (item.state !== 'running' && item.state !== 'finishing') return
		const patch: Partial<TransferItem> = {}
		if (update.transferredBytes !== undefined) patch.transferredBytes = update.transferredBytes
		if (update.progress !== undefined) patch.progress = Math.min(100, Math.max(0, update.progress))
		if (update.bytesPerSecond !== undefined) patch.bytesPerSecond = Math.max(0, update.bytesPerSecond)
		if (update.allBytesSent && item.state === 'running') patch.state = 'finishing'
		const now = Date.now()
		const last = this.#lastProgressAt.get(id) ?? 0
		if (patch.state === undefined && now - last < PROGRESS_INTERVAL_MS) return
		this.#lastProgressAt.set(id, now)
		this.#mutate(() => void this.#set(id, patch))
	}

	#settle(id: string, attempts: number, outcome: TransferOutcome) {
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (!item || item.attempts !== attempts || !this.#active.has(id)) return
			this.#active.delete(id)
			this.#controllers.delete(id)
			this.#lastProgressAt.delete(id)
			const cancelling = item.state === 'cancelling'
			switch (outcome.type) {
				case 'completed':
					// A cancel that raced the server's success is reported as the
					// success it was: the file exists, saying otherwise would lie
					this.#finish(item, {
						state: 'completed',
						resultPath: outcome.path,
						progress: 100,
						transferredBytes: item.size ?? item.transferredBytes,
						bytesPerSecond: 0,
						secondsRemaining: undefined,
					})
					break
				case 'conflict':
					if (cancelling) this.#finish(item, {state: 'cancelled'})
					else this.#conflict(item)
					break
				case 'failed':
					// An abort surfaces as a failure on some paths; the user asked
					// for the stop, and nothing was published
					if (cancelling) this.#finish(item, {state: 'cancelled'})
					else this.#finish(item, {state: 'failed', error: outcome.error})
					break
				case 'cancelled':
					this.#finish(item, {state: 'cancelled'})
					break
			}
		})
		this.#pump()
	}

	#conflict(item: TransferItem) {
		const batch = this.#batches.get(item.batchId)
		const decision = batch?.collisionDecision
		if (decision) return this.#applyDecision(item, decision)
		this.#wake++
		this.#set(item.id, {
			state: 'needs-attention',
			conflict: {dismissed: false},
			progress: 0,
			transferredBytes: 0,
			bytesPerSecond: 0,
			secondsRemaining: undefined,
		})
	}

	#applyDecision(item: TransferItem, decision: CollisionDecision) {
		if (decision === 'skip') return this.#finish(item, {state: 'skipped'})
		this.#set(item.id, {state: 'queued', collision: decision, conflict: undefined})
		// The user's answer takes effect next, ahead of work that hasn't started
		this.#lanes[item.lane].unshift(item.id)
	}

	#finish(item: TransferItem, patch: Partial<TransferItem> & {state: TransferState}) {
		this.#set(item.id, {
			bytesPerSecond: 0,
			secondsRemaining: undefined,
			...patch,
			conflict: undefined,
			collision: undefined,
			settledAt: Date.now(),
		})
		// A failed upload keeps its payload so Retry has something to send;
		// every other ending releases it
		if (patch.state === 'failed') {
			this.#controllers.delete(item.id)
			this.#lastProgressAt.delete(item.id)
		} else {
			this.#release(item.id)
		}
		this.#scheduleRetirement(item.batchId)
	}

	#release(id: string) {
		this.#files.delete(id)
		const url = this.#objectUrls.get(id)
		if (url) {
			URL.revokeObjectURL(url)
			this.#objectUrls.delete(id)
		}
		this.#controllers.delete(id)
		this.#lastProgressAt.delete(id)
	}

	// A batch whose every item settled leaves on its own unless something
	// failed; failures stay actionable until the user retries or dismisses
	#scheduleRetirement(batchId: string) {
		if (this.#bulk) {
			this.#retirementsDue.add(batchId)
			return
		}
		const batch = this.#batches.get(batchId)
		if (!batch || !this.#mayRetire(batchId)) return
		clearTimeout(this.#retireTimers.get(batchId))
		const anyCompleted = batch.itemIds.some((id) => this.#items.get(id)?.state === 'completed')
		const delay = anyCompleted ? RETIRE_COMPLETED_AFTER_MS : RETIRE_ABANDONED_AFTER_MS
		this.#retireTimers.set(
			batchId,
			setTimeout(() => {
				this.#retireTimers.delete(batchId)
				this.#mutate(() => {
					// A retry since then keeps the batch on screen
					if (this.#batches.has(batchId) && this.#mayRetire(batchId)) this.#removeBatch(batchId)
				})
			}, delay),
		)
	}

	#mayRetire(batchId: string) {
		return (this.#unfinished.get(batchId) ?? 0) === 0 && (this.#failed.get(batchId) ?? 0) === 0
	}

	#removeBatch(batchId: string) {
		const batch = this.#batches.get(batchId)
		if (!batch) return
		for (const id of batch.itemIds) {
			this.#release(id)
			this.#items.delete(id)
		}
		this.#batches.delete(batchId)
		this.#unfinished.delete(batchId)
		this.#failed.delete(batchId)
		this.#dirty = true
	}

	// --- Controls -----------------------------------------------------------

	// Cancels one item. Queued and waiting items simply never start; a running
	// upload aborts and settles through its own handlers. Returns whether the
	// request was accepted.
	cancel(id: string) {
		let accepted = false
		this.#mutate(() => {
			accepted = this.#cancelOne(id)
		})
		this.#pump()
		return accepted
	}

	#cancelOne(id: string) {
		const item = this.#items.get(id)
		if (!item) return false
		switch (item.state) {
			case 'queued':
				// In bulk the lanes are rebuilt once afterwards
				if (!this.#bulk) this.#dequeue(item)
				this.#finish(item, {state: 'cancelled'})
				return true
			case 'needs-attention':
				this.#finish(item, {state: 'cancelled'})
				return true
			case 'running':
				if (!this.#options.cancellableWhileRunning(item)) return false
				this.#set(id, {state: 'cancelling', bytesPerSecond: 0, secondsRemaining: undefined})
				this.#controllers.get(id)?.abort()
				return true
			default:
				return false
		}
	}

	// The set to cancel is captured first, so work enqueued while a
	// confirmation was open never inherits an older "cancel" decision
	cancelBatch(batchId: string) {
		const batch = this.#batches.get(batchId)
		if (!batch) return 0
		return this.#cancelMany(batch.itemIds)
	}

	cancelAll() {
		return this.#cancelMany([...this.#items.keys()])
	}

	// Thousands of queued items cancel in one pass: no per-item lane search,
	// and each touched batch is considered for retirement once at the end
	#cancelMany(ids: string[]) {
		const targets = ids.filter((id) => this.isCancellable(id))
		let count = 0
		this.#mutate(() => {
			this.#bulk = true
			try {
				for (const id of targets) if (this.#cancelOne(id)) count++
			} finally {
				this.#bulk = false
			}
			for (const lane of LANES) {
				this.#lanes[lane] = this.#lanes[lane].filter((id) => this.#items.get(id)?.state === 'queued')
			}
			const due = [...this.#retirementsDue]
			this.#retirementsDue.clear()
			for (const batchId of due) this.#scheduleRetirement(batchId)
		})
		this.#pump()
		return count
	}

	isCancellable(id: string) {
		const item = this.#items.get(id)
		if (!item) return false
		return (
			item.state === 'queued' ||
			item.state === 'needs-attention' ||
			(item.state === 'running' && this.#options.cancellableWhileRunning(item))
		)
	}

	#dequeue(item: TransferItem) {
		const queue = this.#lanes[item.lane]
		const index = queue.indexOf(item.id)
		if (index !== -1) queue.splice(index, 1)
	}

	// Answers a collision. Ignored when the item is no longer waiting, so an
	// old dialog can never resurrect a cancelled item or batch.
	resolveConflict(id: string, decision: CollisionDecision, applyToBatch = false) {
		let accepted = false
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (!item || item.state !== 'needs-attention') return
			accepted = true
			const batch = this.#batches.get(item.batchId)
			if (applyToBatch && batch) {
				batch.collisionDecision = decision
				this.#dirty = true
				for (const otherId of batch.itemIds) {
					const other = this.#items.get(otherId)
					if (other && other.id !== id && other.state === 'needs-attention') this.#applyDecision(other, decision)
				}
			}
			this.#applyDecision(item, decision)
		})
		this.#pump()
		return accepted
	}

	// The dialog was closed without a choice: the item waits, visibly, for Resolve
	dismissConflict(id: string) {
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (item?.state === 'needs-attention') this.#set(id, {conflict: {dismissed: true}})
		})
	}

	reopenConflict(id: string) {
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (item?.state !== 'needs-attention') return
			this.#wake++
			this.#set(id, {conflict: {dismissed: false}})
		})
	}

	// A fresh attempt through the same queue, for an item that failed
	retry(id: string) {
		let accepted = false
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (!item || item.state !== 'failed') return
			// An upload whose payload is gone (the page reloaded, the session
			// ended) cannot be resent; nothing to retry with
			if (item.kind === 'upload' && !this.#files.has(id)) return
			accepted = true
			this.#set(id, {state: 'queued', error: undefined, progress: 0, transferredBytes: 0})
			this.#lanes[item.lane].push(id)
		})
		this.#pump()
		return accepted
	}

	retryFailed(batchId: string) {
		const batch = this.#batches.get(batchId)
		if (!batch) return 0
		let count = 0
		for (const id of batch.itemIds) if (this.retry(id)) count++
		return count
	}

	// Removes a settled item, or a batch with nothing left running
	dismiss(id: string) {
		let batchId: string | undefined
		this.#mutate(() => {
			const item = this.#items.get(id)
			if (!item || !isTerminalTransferState(item.state)) return
			const batch = this.#batches.get(item.batchId)
			this.#release(id)
			this.#items.delete(id)
			if (item.state === 'failed') this.#failed.set(item.batchId, (this.#failed.get(item.batchId) ?? 1) - 1)
			if (batch) {
				batch.itemIds = batch.itemIds.filter((other) => other !== id)
				if (batch.itemIds.length === 0) this.#removeBatch(batch.id)
				else batchId = batch.id
			}
			this.#dirty = true
		})
		if (batchId) this.#scheduleRetirement(batchId)
	}

	// The server's listing now shows these completed uploads; the listing can
	// let go of the rows it was holding for them
	acknowledgeListed(ids: string[]) {
		this.#mutate(() => {
			for (const id of ids) {
				const item = this.#items.get(id)
				if (item?.state === 'completed' && !item.listed) this.#set(id, {listed: true})
			}
		})
	}

	dismissBatch(batchId: string) {
		this.#mutate(() => {
			const batch = this.#batches.get(batchId)
			if (!batch) return
			const unfinished = batch.itemIds.some((id) => {
				const item = this.#items.get(id)
				return item && !isTerminalTransferState(item.state)
			})
			if (unfinished) return
			clearTimeout(this.#retireTimers.get(batchId))
			this.#retireTimers.delete(batchId)
			this.#removeBatch(batchId)
		})
	}

	// Ends the session's transfers: aborts what is running, drops the rest and
	// releases every payload. Work accepted under one account must never run
	// under another.
	reset() {
		this.#mutate(() => {
			for (const controller of this.#controllers.values()) controller.abort()
			for (const timer of this.#retireTimers.values()) clearTimeout(timer)
			this.#retireTimers.clear()
			for (const id of [...this.#items.keys()]) this.#release(id)
			this.#items.clear()
			this.#batches.clear()
			this.#unfinished.clear()
			this.#failed.clear()
			this.#retirementsDue.clear()
			this.#active.clear()
			this.#lanes = {upload: [], instant: [], streamed: []}
			this.#dirty = true
		})
	}

	// --- Internals ----------------------------------------------------------

	#set(id: string, patch: Partial<TransferItem>) {
		const item = this.#items.get(id)!
		const next = {...item, ...patch}
		this.#items.set(id, next)
		this.#dirty = true
		if (patch.state !== undefined && patch.state !== item.state) {
			this.#pendingTransitions.push([next, item.state])
			const wasTerminal = isTerminalTransferState(item.state)
			const isTerminal = isTerminalTransferState(next.state)
			if (wasTerminal !== isTerminal) {
				this.#unfinished.set(item.batchId, (this.#unfinished.get(item.batchId) ?? 0) + (isTerminal ? -1 : 1))
			}
			if ((item.state === 'failed') !== (next.state === 'failed')) {
				this.#failed.set(item.batchId, (this.#failed.get(item.batchId) ?? 0) + (next.state === 'failed' ? 1 : -1))
			}
		}
		return next
	}

	// Groups the changes of one operation into one notification, delivered
	// once the snapshot already reflects all of them
	#mutate(run: () => void) {
		this.#mutationDepth++
		try {
			run()
		} finally {
			this.#mutationDepth--
		}
		if (this.#mutationDepth > 0) return
		if (this.#dirty) {
			this.#dirty = false
			this.#snapshot = undefined
			for (const listener of this.#listeners) listener()
		}
		if (this.#pendingTransitions.length > 0) {
			const transitions = this.#pendingTransitions
			this.#pendingTransitions = []
			for (const [item, previous] of transitions) {
				for (const listener of this.#transitionListeners) listener(item, previous)
			}
		}
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
