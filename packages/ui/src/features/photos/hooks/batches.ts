// How many items one request names.
//
// The server builds a single SQL statement holding every id it is given —
// twice over for a delete or a restore — and SQLite takes 32,766 variables in
// a statement: a delete of more than 16,382 items was refused outright (which
// is everything in a library of twenty thousand, selected with ⌘A), and a
// favourite of more than 32,765 would be. A request of this size is also well
// inside what the socket carries (see trpc/socket-limit.ts), and the socket
// is where a change the server spends minutes on belongs: it is kept alive
// there, where a browser gives up on an HTTP request that long without an
// answer.
export const IDS_PER_REQUEST = 2_500

export function batchesOf(ids: readonly string[], size = IDS_PER_REQUEST): string[][] {
	const batches: string[][] = []
	for (let from = 0; from < ids.length; from += size) batches.push(ids.slice(from, from + size))
	return batches
}

// One change the user asked for, sent as however many requests it takes, one
// after another. The first to fail ends it: what the server did before that
// stands, and the caller reads the lists again to show it.
export async function inBatches<T>(ids: readonly string[], send: (batch: string[]) => Promise<T>): Promise<T[]> {
	const results: T[] = []
	for (const batch of batchesOf(ids)) results.push(await send(batch))
	return results
}

// How many items a refused change is narrowed down to before giving up on
// telling which they are
const ISOLATED_MAX = 20

// The same, for a change the server makes one item at a time and abandons at
// the first item it cannot change — a photo in a read-only cloud folder
// cannot be moved to the Trash, and the request that names it is refused
// with everything after it left undone. Asked again, the whole selection
// would stop at that photo for ever. So a batch that is refused is asked for
// again in halves, down to the items that are the cause: everything that can
// be changed is, and what cannot is handed back. (What a refused request did
// get done before it stopped is no longer there to be changed the second
// time, which the server takes in its stride.)
//
// Past a few such items it stops narrowing: a selection that cannot be
// changed at all (a whole read-only folder, the server gone) is refused a
// batch at a time rather than an item at a time.
export async function inBatchesIsolating(
	ids: readonly string[],
	send: (batch: string[]) => Promise<unknown>,
): Promise<{failed: string[]; error?: unknown}> {
	const failed: string[] = []
	let error: unknown
	const attempt = async (batch: string[]): Promise<void> => {
		try {
			await send(batch)
		} catch (refused) {
			error = refused
			if (batch.length === 1 || failed.length >= ISOLATED_MAX) {
				failed.push(...batch)
				return
			}
			const half = Math.ceil(batch.length / 2)
			await attempt(batch.slice(0, half))
			await attempt(batch.slice(half))
		}
	}
	for (const batch of batchesOf(ids)) await attempt(batch)
	return {failed, error}
}
