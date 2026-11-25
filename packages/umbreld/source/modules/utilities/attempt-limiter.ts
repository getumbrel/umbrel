// Limits how quickly one client can guess a secret such as a password or a 2FA
// code. A client gets a few free attempts for typos. After that every further
// failure blocks it for twice as long as the last one, so sustained guessing
// settles at one attempt per longest block.

const FREE_ATTEMPTS = 10
const FIRST_BLOCK_MS = 60_000
const LONGEST_BLOCK_MS = 60 * 60_000
// Longer than the longest block, so waiting to be forgotten is never quicker
// than waiting out a block.
const FORGET_AFTER_MS = 24 * 60 * 60_000
// Client keys can be chosen by whoever is guessing, so cap what is remembered.
// Past the cap, the client with the fewest failures is forgotten.
const MAX_CLIENTS = 10_000

export class TooManyAttemptsError extends Error {
	retryAfterMs: number

	constructor(retryAfterMs: number) {
		const minutes = Math.ceil(retryAfterMs / 60_000)
		super(`Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`)
		this.retryAfterMs = retryAfterMs
	}
}

export default class AttemptLimiter {
	// Ordered by last counted attempt, oldest first
	#clients = new Map<string, {failures: number; lastAttemptAt: number; blockedUntil: number}>()

	// Call before checking a client's guess. Throws if the client is blocked.
	// The attempt counts as failed straight away, so guesses sent in parallel
	// can't all be checked before the first one is counted.
	start(client: string) {
		const now = performance.now()
		let entry = this.#clients.get(client)
		if (entry && now - entry.lastAttemptAt > FORGET_AFTER_MS) entry = undefined
		if (entry && now < entry.blockedUntil) throw new TooManyAttemptsError(entry.blockedUntil - now)

		entry ??= {failures: 0, lastAttemptAt: now, blockedUntil: 0}
		const blockedUntilBefore = entry.blockedUntil
		entry.failures++
		entry.lastAttemptAt = now
		if (entry.failures >= FREE_ATTEMPTS) {
			entry.blockedUntil = now + Math.min(FIRST_BLOCK_MS * 2 ** (entry.failures - FREE_ATTEMPTS), LONGEST_BLOCK_MS)
		}
		this.#clients.delete(client)
		this.#clients.set(client, entry)
		if (this.#clients.size > MAX_CLIENTS) this.#forgetLeastFailed()

		return {
			// The guess was right, so forget the client's earlier failures.
			succeeded: () => void this.#clients.delete(client),
			// The attempt turned out not to be a guess, so undo it. Earlier
			// failures still stand.
			withdraw: () => {
				if (this.#clients.get(client) !== entry) return
				entry.failures--
				entry.blockedUntil = blockedUntilBefore
				if (entry.failures === 0) this.#clients.delete(client)
			},
		}
	}

	// Forgetting the client that has failed least, and the least recently seen
	// of those, means a flood of new clients pushes each other out rather than
	// clearing the block of a client that has been guessing.
	#forgetLeastFailed() {
		let leastFailed: string | undefined
		let leastFailures = Infinity
		for (const [client, {failures}] of this.#clients) {
			if (failures >= leastFailures) continue
			leastFailed = client
			leastFailures = failures
		}
		if (leastFailed !== undefined) this.#clients.delete(leastFailed)
	}
}
