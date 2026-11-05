// The rows or the columns of a grid: how big each is and where each starts.
// Most are the default size, so only the others are kept, in order, with a
// running total of how much they add up to over the default: a line's place
// is then a binary search away, for sixteen columns or sixteen million rows.
export class Axis {
	readonly count: number
	readonly defaultSize: number
	readonly #indices: Uint32Array
	readonly #sizes: Float64Array
	// What the sized lines before the k-th one add to the default, in total
	readonly #extra: Float64Array

	// `sizes`: [index, size] pairs in ascending order
	constructor(count: number, defaultSize: number, sizes: ArrayLike<number> = []) {
		this.count = count
		this.defaultSize = defaultSize
		const pairs = Math.floor(sizes.length / 2)
		let kept = 0
		while (kept < pairs && sizes[kept * 2] < count) kept++
		this.#indices = new Uint32Array(kept)
		this.#sizes = new Float64Array(kept)
		this.#extra = new Float64Array(kept + 1)
		for (let k = 0; k < kept; k++) {
			this.#indices[k] = sizes[k * 2]
			this.#sizes[k] = sizes[k * 2 + 1]
			this.#extra[k + 1] = this.#extra[k] + sizes[k * 2 + 1] - defaultSize
		}
	}

	size(i: number): number {
		const k = this.#find(i)
		return k < this.#indices.length && this.#indices[k] === i ? this.#sizes[k] : this.defaultSize
	}

	// Where line i starts; i may be `count`, where the last one ends
	start(i: number): number {
		return i * this.defaultSize + this.#extra[this.#find(i)]
	}

	get total(): number {
		return this.start(this.count)
	}

	// The line under a position: the last one starting at or before it, so a
	// hidden line is never the answer
	at(position: number): number {
		let low = 0
		let high = this.count - 1
		while (low < high) {
			const middle = (low + high + 1) >> 1
			if (this.start(middle) <= position) low = middle
			else high = middle - 1
		}
		return low
	}

	// The k of the first sized line at or after i
	#find(i: number): number {
		let low = 0
		let high = this.#indices.length
		while (low < high) {
			const middle = (low + high) >> 1
			if (this.#indices[middle] < i) low = middle + 1
			else high = middle
		}
		return low
	}
}
