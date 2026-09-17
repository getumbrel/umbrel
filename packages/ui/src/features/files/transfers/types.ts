export type TransferKind = 'upload' | 'copy' | 'move'

// Execution lanes, each with its own concurrency. Uploads are browser-bound;
// server copies stream through rsync one at a time, while a move that stays
// on one storage device is a rename and must never wait behind a long copy.
export type TransferLane = 'upload' | 'streamed' | 'instant'

export type TransferState =
	| 'queued'
	| 'running'
	// Every byte has left the browser, so the outcome is now the server's to
	// decide: cancellation is no longer offered
	| 'finishing'
	// A name collision awaits the user's decision
	| 'needs-attention'
	| 'cancelling'
	| 'completed'
	| 'cancelled'
	| 'skipped'
	| 'failed'

export type CollisionDecision = 'replace' | 'keep-both' | 'skip'

export type TransferItem = {
	id: string
	batchId: string
	kind: TransferKind
	lane: TransferLane
	name: string
	// Mime type for uploads, 'directory' or a file type for copies and moves;
	// drives the row icon
	type: string
	// Bytes, when known. A directory copy reports no size.
	size?: number
	// Copy and move only: where the item comes from
	sourcePath?: string
	// Where the item is headed (the destination directory plus, for folder
	// uploads, the file's relative path)
	path: string
	destinationDirectory: string
	state: TransferState
	// 0..100. Byte-based for uploads; the server's percent for copies and moves.
	progress: number
	transferredBytes: number
	bytesPerSecond: number
	secondsRemaining?: number
	// Where the item actually landed: a keep-both resolution renames it
	resultPath?: string
	// The backend's raw error code, mapped to copy in the UI
	error?: string
	// The strategy for the next attempt, once the user has decided
	collision?: Exclude<CollisionDecision, 'skip'>
	// Set while a collision awaits the user. A dismissed dialog leaves the item
	// here until the user picks Resolve, so a batch's other conflicts are kept.
	conflict?: {dismissed: boolean}
	attempts: number
	// When the item reached a terminal state. A just-completed row lingers in
	// the island with its check for a beat before it leaves.
	settledAt?: number
	// The server's listing has shown this completed upload, so the listing
	// no longer needs to hold a row for it
	listed?: boolean
}

export type TransferBatch = {
	id: string
	kind: TransferKind
	destinationDirectory: string
	createdAt: number
	itemIds: string[]
	// "Apply to remaining conflicts in this batch"
	collisionDecision?: CollisionDecision
}

export type TransfersSnapshot = {
	// In creation order
	batches: TransferBatch[]
	items: ReadonlyMap<string, TransferItem>
	// Bumps whenever something deserves the user's eye: a new batch, a
	// conflict, a failure. The island peeks open on each change.
	wake: number
}

const TERMINAL_STATES: ReadonlySet<TransferState> = new Set(['completed', 'cancelled', 'skipped', 'failed'])

export const isTerminalTransferState = (state: TransferState) => TERMINAL_STATES.has(state)
