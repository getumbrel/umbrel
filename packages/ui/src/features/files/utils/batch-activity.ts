// Whether a batch of this session's own requests is running: a selection
// being trashed or restored, one request per item, a few at a time. While it
// runs, the changes it makes are not each a reason to read listings again.
// The server reads a whole folder for every listing, however long the folder
// is, so reading them every second for as long as a batch of thousands took
// left it listing instead of doing the batch. The listings are read once it
// has finished: the rows leave at once either way, optimistically.
let running = 0
const idleListeners = new Set<() => void>()

export const batchActivity = {
	begin() {
		running++
	},
	end() {
		running = Math.max(0, running - 1)
		if (running === 0) for (const listener of [...idleListeners]) listener()
	},
	isRunning: () => running > 0,
	// Called each time the last running batch finishes
	onIdle(listener: () => void) {
		idleListeners.add(listener)
		return () => {
			idleListeners.delete(listener)
		}
	},
}
