// A switch to one- or two-drive protection restarts umbrelOS by itself, half way through.
// umbreld announces it a few seconds ahead, and the restarting screen says why, so nobody
// takes it for a crash. Kept outside React, since that screen is drawn while nothing answers.

// Long enough for the slowest restart, short enough that a restart someone asks for later
// isn't blamed on FailSafe
const WINDOW_MS = 20 * 60_000

let announcedAt = 0

export function noteFailsafeRestart() {
	announcedAt = Date.now()
}

export function isFailsafeRestart() {
	return announcedAt > 0 && Date.now() - announcedAt < WINDOW_MS
}
