import {cancellableWhileRunning, executeTransfer, laneFor, TRANSFER_CONCURRENCY} from './executors'
import {TransferQueue} from './transfer-queue'

// The one queue for the whole app. Module-scoped, like the Photos uploads, so
// it survives route changes and every surface reads the same state.
export const transfers = new TransferQueue({
	execute: executeTransfer,
	laneFor,
	concurrency: TRANSFER_CONCURRENCY,
	cancellableWhileRunning,
})
