// Whether a change of this session's own that moves items between the
// library and the Trash is still being carried out. The server moves the
// files one at a time — a thousand take it most of half a minute — and says
// so as it goes: a change event every second, each of which would have
// Photos read its counts and its short lists again from a library half-way
// through the change. The tiles the change had already taken off the screen
// came back for as long as their files were still waiting, then drained away
// as the server reached them, the counts stepping down behind.
//
// While such a change runs its events are held (see use-photos-events.ts):
// what is on screen is what the change will come to, and everything is read
// once, when it has finished.
let running = 0
const idleListeners = new Set<() => void>()

export const moveActivity = {
	begin() {
		running++
	},
	end() {
		running = Math.max(0, running - 1)
		if (running === 0) for (const listener of [...idleListeners]) listener()
	},
	isRunning: () => running > 0,
	// Called each time the last change still running finishes
	onIdle(listener: () => void) {
		idleListeners.add(listener)
		return () => {
			idleListeners.delete(listener)
		}
	},
}
