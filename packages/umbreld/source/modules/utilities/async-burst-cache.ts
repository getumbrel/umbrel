// Share one asynchronous load across a burst of callers, then retain the
// resolved snapshot briefly. In-flight loads never expire: under resource
// pressure, starting duplicate reads because the first one is slow would
// recreate the problem this cache is intended to prevent.
export default class AsyncBurstCache<T> {
	#entry?: {promise: Promise<T>; expiresAt?: number}
	readonly #load: () => Promise<T>
	readonly #ttlMs: number

	constructor(load: () => Promise<T>, ttlMs: number) {
		this.#load = load
		this.#ttlMs = ttlMs
	}

	get(): Promise<T> {
		const now = Date.now()
		if (this.#entry && (this.#entry.expiresAt === undefined || this.#entry.expiresAt > now)) {
			return this.#entry.promise
		}

		const promise = this.#load()
		const entry = {promise} as {promise: Promise<T>; expiresAt?: number}
		this.#entry = entry
		void promise.then(
			() => {
				if (this.#entry === entry) entry.expiresAt = Date.now() + this.#ttlMs
			},
			() => {
				if (this.#entry === entry) this.#entry = undefined
			},
		)
		return promise
	}

	clear() {
		this.#entry = undefined
	}
}
