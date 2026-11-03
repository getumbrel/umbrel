// The info sheet's release rule (see useInfoSheet), apart so it can be
// tested on its own.

// A flick (px/ms) goes on to the next height its way; short of one,
// carrying the sheet this share of the way to the next height commits to it
const FLICK = 0.35
const COMMIT = 0.3

// Where a release sends the sheet, among `stops` (ascending, closed — 0 —
// first), from height `h` with the drag having started at `h0` and the
// finger leaving at `velocity` (of h, px/ms): a flick goes on to the next
// stop its way; otherwise it is the stop the drag started from, unless the
// finger carried the sheet far enough toward a neighbour — so a short, slow
// lift still opens, and a short drag down on an open sheet still closes it
export function releaseTarget(stops: number[], h: number, h0: number, velocity: number) {
	if (Math.abs(velocity) > FLICK) {
		return velocity > 0
			? (stops.find((stop) => stop > h + 1) ?? stops.at(-1)!)
			: ([...stops].reverse().find((stop) => stop < h - 1) ?? stops[0]!)
	}
	const from = stops.reduce((a, b) => (Math.abs(b - h0) < Math.abs(a - h0) ? b : a))
	const dir = h > from ? 1 : -1
	const ahead = dir > 0 ? stops.filter((stop) => stop > from) : stops.filter((stop) => stop < from).reverse()
	// Leaving the starting stop takes COMMIT of the way to the next; each
	// stop beyond that, the finger past the one before by half the gap
	let to = from
	for (const stop of ahead) {
		if ((h - to) * dir < Math.abs(stop - to) * (to === from ? COMMIT : 0.5)) break
		to = stop
	}
	return to
}
