// The lightbox's settles: what a gesture hands over to when the finger lets
// go. Unlike a timed curve, a spring starts at the speed the finger was
// moving — a flick arrives quickly, a slow drag eases in — and it can be
// caught mid-flight: `stop()` leaves every value exactly where the last
// frame put it, for the next gesture to carry on from in that same frame.
// Frames run on rAF and write through `onFrame` (inline styles, a side
// channel), never through React state.

export type SpringConfig = {stiffness: number; damping: number}

// Springs described the way UIKit describes them: `response` is about how
// long the motion takes (the period of the undamped oscillation, in
// seconds), and a `dampingRatio` of 1 comes to rest without overshooting —
// anything less gives it a little swing
export function springConfig(response: number, dampingRatio = 1): SpringConfig {
	const omega = (2 * Math.PI) / response
	return {stiffness: omega * omega, damping: 2 * dampingRatio * omega}
}

// Paging: the strip carrying on to the next photo, or back — quick, and
// clamped (see Axis.clamp), so a page never swings past where it lands
export const PAGE_SPRING = springConfig(0.3)
// A drag let go short of dismissing, coming home with its backdrop
export const RETURN_SPRING = springConfig(0.32)
// The double-tap's zoom, in or out: the eye follows the point it tapped
export const TAP_ZOOM_SPRING = springConfig(0.34)
// A pinch let go past a limit, finding it again — the faintest give
export const ZOOM_SPRING = springConfig(0.36, 0.86)
// An edge pulled past, or glided into, coming back
export const EDGE_SPRING = springConfig(0.36)

// UIScrollView's normal deceleration: 0.998 of the speed kept every ms
const DECELERATION = -Math.log(0.998) * 1000

// One value in motion. With `to` it springs there; without, it glides on
// its velocity, slowing by friction while inside [min, max] and springing
// back to whichever bound it ran past.
export type Axis = {
	value: number
	// Units per second
	velocity: number
	to?: number
	min?: number
	max?: number
	config: SpringConfig
	// How near (in the axis's own units) counts as arrived: px want half a
	// pixel, a scale a thousandth
	precision?: number
	// Rest on reaching `to` rather than swinging through it — paging, where
	// a page that overshoots shows its neighbour
	clamp?: boolean
}

// Each frame is integrated in small fixed steps (semi-implicit Euler), so
// a dropped frame changes nothing but how many steps it takes
const SUBSTEP = 1 / 240
// The longest frame worth integrating: a tab coming back from the
// background resumes the motion, it doesn't teleport to the end
const MAX_FRAME = 1 / 20

// Advances one axis by `dt` seconds; true once it has come to rest (and
// snapped exactly onto where it rests)
export function stepAxis(axis: Axis, dt: number) {
	const precision = axis.precision ?? 0.5
	let anchor = axis.to
	if (anchor === undefined) {
		if (axis.min !== undefined && axis.value < axis.min) anchor = axis.min
		else if (axis.max !== undefined && axis.value > axis.max) anchor = axis.max
	}
	if (anchor === undefined) {
		axis.velocity *= Math.exp(-DECELERATION * dt)
		axis.value += axis.velocity * dt
		const inside =
			(axis.min === undefined || axis.value >= axis.min) && (axis.max === undefined || axis.value <= axis.max)
		if (inside && Math.abs(axis.velocity) < precision * 20) {
			axis.velocity = 0
			return true
		}
		return false
	}
	const before = axis.value - anchor
	const {stiffness, damping} = axis.config
	axis.velocity += (-stiffness * before - damping * axis.velocity) * dt
	axis.value += axis.velocity * dt
	const after = axis.value - anchor
	const crossed = before !== 0 && Math.sign(after) !== Math.sign(before)
	if (
		(axis.clamp && axis.to !== undefined && crossed) ||
		(Math.abs(after) < precision && Math.abs(axis.velocity) < precision * 20)
	) {
		axis.value = anchor
		axis.velocity = 0
		return true
	}
	return false
}

export type Motion = {
	// Freezes everything where the last frame left it; `finished` resolves false
	stop(): void
	// True once every axis has come to rest, false if stopped first
	finished: Promise<boolean>
}

// Runs `axes` together, one rAF frame at a time, handing each frame's values
// to `onFrame` (the axes' own `value`s are kept current too). Under reduced
// motion nothing travels: springs land on their targets and glides stop
// where they are (inside their bounds), in one synchronous frame.
export function animate(axes: Axis[], onFrame: (values: number[]) => void, {reduceMotion = false} = {}): Motion {
	if (reduceMotion) {
		for (const axis of axes) {
			axis.value = axis.to ?? Math.min(Math.max(axis.value, axis.min ?? -Infinity), axis.max ?? Infinity)
			axis.velocity = 0
		}
		onFrame(axes.map((axis) => axis.value))
		return {stop() {}, finished: Promise.resolve(true)}
	}
	let resolve!: (rested: boolean) => void
	const finished = new Promise<boolean>((done) => (resolve = done))
	const resting = axes.map(() => false)
	let done = false
	let frame = 0
	let last = performance.now()
	const tick = (now: number) => {
		// rAF's timestamp is the frame's start, which can fall before the
		// moment the motion began: that first frame still moves one frame's
		// worth, or the hand-over from the finger would stall for a frame
		let elapsed = (now - last) / 1000
		if (elapsed <= 0) elapsed = 1 / 60
		elapsed = Math.min(elapsed, MAX_FRAME)
		last = Math.max(now, last)
		const steps = Math.ceil(elapsed / SUBSTEP)
		for (let i = 0; i < axes.length; i++) {
			if (resting[i]) continue
			for (let n = 0; n < steps; n++) {
				if (stepAxis(axes[i]!, elapsed / steps)) {
					resting[i] = true
					break
				}
			}
		}
		onFrame(axes.map((axis) => axis.value))
		if (resting.every(Boolean)) {
			done = true
			resolve(true)
		} else frame = requestAnimationFrame(tick)
	}
	frame = requestAnimationFrame(tick)
	return {
		stop() {
			if (done) return
			done = true
			cancelAnimationFrame(frame)
			resolve(false)
		},
		finished,
	}
}

// The finger's velocity at release, in px/ms: the travel over the last
// stretch of samples (an average, so one lumpy event can't fling the
// picture), and nothing at all once the finger has been still a moment —
// a drag that stops before letting go means "put it here", not "throw it".
const VELOCITY_WINDOW = 80
const STILL_MS = 60
export function createVelocityTracker() {
	const samples: {t: number; x: number; y: number}[] = []
	return {
		reset() {
			samples.length = 0
		},
		add(t: number, x: number, y: number) {
			samples.push({t, x, y})
			while (samples.length > 2 && t - samples[0]!.t > VELOCITY_WINDOW) samples.shift()
		},
		velocity(now: number) {
			const first = samples[0]
			const last = samples[samples.length - 1]
			if (!first || !last || now - last.t > STILL_MS || last.t <= first.t) return {x: 0, y: 0}
			const dt = last.t - first.t
			return {x: (last.x - first.x) / dt, y: (last.y - first.y) / dt}
		},
	}
}
