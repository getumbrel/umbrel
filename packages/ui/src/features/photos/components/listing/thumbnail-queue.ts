// A small gate in front of DOM thumbnail <img>s. Without it, mounting a new
// virtualized window gives every image a src at once and the browser builds its
// own FIFO queue in DOM order — including the overscan above the viewport. By
// admitting only a handful at a time, the next free slot can always go to the
// item closest to what is visible now.
//
// The gate is for photographs that have to be fetched. One that has loaded
// before is in the browser's cache and costs no request, so it skips the gate
// (see `remembers`): scrolling back over what was already seen paints at
// once rather than five tiles at a time.

const CAPACITY = 5
const STALL_MS = 20_000
// How many loaded renditions are remembered, most recent first out of a very
// long scroll: what falls off the end just goes through the gate again
const REMEMBERED = 10_000

export type ThumbnailRequestSlot = {
	// The tile left the render window. A waiting request disappears; a granted
	// request frees its admission slot after the caller has cleared the raw
	// <img>'s source, cancelling work that is no longer useful.
	release: () => void
	// The image loaded or failed, so another request may start.
	settle: () => void
}

type Waiting = {index: () => number; grant: () => void}

export class ThumbnailQueue {
	// The run of items on screen (both ends included), which the grid supplies.
	// Read once each time slots are handed out, so scrolling reprioritizes
	// waiting work without causing a React render: what is visible goes before
	// the overscan, nearest the middle of the viewport first. Null holds every
	// waiting request back — the grid is flying past what it has mounted, and
	// a request started now would be for a photograph gone before it arrived
	// (see `resume`).
	visible: () => {start: number; end: number} | null = () => ({start: 0, end: Infinity})

	#capacity: number
	#stallMs: number
	#waiting = new Map<symbol, Waiting>()
	#inFlight = 0
	#scheduled = false
	#loaded = new Set<string>()
	#idle: (() => void)[] = []

	constructor({capacity = CAPACITY, stallMs = STALL_MS}: {capacity?: number; stallMs?: number} = {}) {
		this.#capacity = capacity
		this.#stallMs = stallMs
	}

	enqueue(index: () => number, grant: () => void): ThumbnailRequestSlot {
		const key = Symbol()
		let state: 'waiting' | 'flying' | 'done' = 'waiting'
		let timer: ReturnType<typeof setTimeout> | undefined

		const finish = () => {
			if (state !== 'flying') return
			state = 'done'
			clearTimeout(timer)
			this.#inFlight--
			this.#dispatch()
			this.#settle()
		}
		const start = () => {
			if (state !== 'waiting') return
			state = 'flying'
			this.#inFlight++
			timer = setTimeout(finish, this.#stallMs)
			try {
				grant()
			} catch (error) {
				finish()
				throw error
			}
		}

		this.#waiting.set(key, {index, grant: start})
		// Effects register every tile in one turn. Waiting for the microtask lets
		// the whole visible band enter before choosing the first five, rather than
		// immediately granting the first overscan items mounted in DOM order.
		this.#schedule()

		return {
			release: () => {
				if (state === 'waiting') {
					state = 'done'
					this.#waiting.delete(key)
					this.#settle()
					return
				}
				finish()
			},
			settle: finish,
		}
	}

	// The grid has slowed down: what is mounted now is what there is to fetch
	resume() {
		this.#dispatch()
	}

	// Once nothing is waiting or being fetched: what is on screen has its
	// photographs, and work that would compete with them for the wire can go
	idle() {
		if (this.#waiting.size === 0 && this.#inFlight === 0) return Promise.resolve()
		return new Promise<void>((resolve) => this.#idle.push(resolve))
	}

	#settle() {
		if (this.#idle.length === 0 || this.#waiting.size > 0 || this.#inFlight > 0) return
		for (const resolve of this.#idle.splice(0)) resolve()
	}

	// A URL whose image has loaded is the browser's to serve from its cache
	remember(url: string) {
		if (this.#loaded.has(url)) return
		this.#loaded.add(url)
		if (this.#loaded.size > REMEMBERED) this.#loaded.delete(this.#loaded.values().next().value!)
	}

	remembers(url: string) {
		return this.#loaded.has(url)
	}

	#schedule() {
		if (this.#scheduled) return
		this.#scheduled = true
		queueMicrotask(() => {
			this.#scheduled = false
			this.#dispatch()
		})
	}

	#dispatch() {
		if (this.#inFlight >= this.#capacity || this.#waiting.size === 0) return
		const visible = this.visible()
		if (!visible) return
		const middle = (visible.start + visible.end) / 2
		while (this.#inFlight < this.#capacity && this.#waiting.size > 0) {
			let best: symbol | undefined
			let bestOffscreen = true
			let bestDistance = Infinity
			for (const [key, waiting] of this.#waiting) {
				const index = waiting.index()
				const offscreen = index < visible.start || index > visible.end
				const distance = Math.abs(index - middle)
				if (
					best === undefined ||
					(bestOffscreen && !offscreen) ||
					(offscreen === bestOffscreen && distance < bestDistance)
				) {
					best = key
					bestOffscreen = offscreen
					bestDistance = distance
				}
			}
			const {grant} = this.#waiting.get(best!)!
			this.#waiting.delete(best!)
			grant()
		}
	}
}
