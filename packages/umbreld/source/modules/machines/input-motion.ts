// Browser-safe input vocabulary and geometry, shared by the guest input driver
// and console. No platform dependencies or private input text belong here.
export const MACHINE_INPUT_ACTIONS = [
	'mouse_move',
	'left_click',
	'right_click',
	'middle_click',
	'double_click',
	'triple_click',
	'long_press',
	'left_click_drag',
	'scroll',
	'key',
	'type',
	'wait',
] as const
export type MachineInputActionType = (typeof MACHINE_INPUT_ACTIONS)[number]
export type PointerTarget = {x: number; y: number}
export type PointerMotion = {
	from: PointerTarget
	to: PointerTarget
	control: PointerTarget
	// Chosen once by the driver, then sampled identically by guest and viewer.
	settle?: {near: PointerTarget; control: PointerTarget; reachEnd: number; correctionStart: number}
	startedAt: number
	durationMs: number
}
export type InputFeedback = {
	action: MachineInputActionType
	phase: 'moving' | 'pressed' | 'released' | 'active' | 'complete'
	direction?: 'up' | 'down' | 'left' | 'right'
	durationMs?: number
}
export type InputUpdate = {
	feedback: InputFeedback
	pointer?: PointerTarget
	motion?: PointerMotion
}

export function easeTravel(progress: number) {
	const t = Math.max(0, Math.min(1, progress))
	// Reach briskly, then spend more of the gesture settling onto the target.
	// This monotonic time warp keeps zero velocity at both endpoints.
	const reach = t + 0.14 * Math.sin(Math.PI * t)
	return reach ** 3 * (10 - 15 * reach + 6 * reach ** 2)
}

function minimumJerk(progress: number) {
	const t = Math.max(0, Math.min(1, progress))
	return t * t * t * (10 + t * (-15 + 6 * t))
}

function quadratic(from: PointerTarget, control: PointerTarget, to: PointerTarget, t: number): PointerTarget {
	const u = 1 - t
	return {
		x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
		y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
	}
}

// Every control point was clamped into the framebuffer when the motion was
// created and both blends are convex, so mathematically no sample can leave
// their bounding box. Floating-point rounding can still overshoot an edge by
// an epsilon, which is enough to fail an exact bounds check.
function withinBounds(point: PointerTarget, points: PointerTarget[]): PointerTarget {
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity
	for (const {x, y} of points) {
		minX = Math.min(minX, x)
		maxX = Math.max(maxX, x)
		minY = Math.min(minY, y)
		maxY = Math.max(maxY, y)
	}
	return {x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(minY, Math.min(maxY, point.y))}
}

export function pointOnMotion(motion: PointerMotion, progress: number): PointerTarget {
	if (progress <= 0) return motion.from
	if (progress >= 1) return motion.to
	if (!motion.settle) {
		const point = quadratic(motion.from, motion.control, motion.to, easeTravel(progress))
		return withinBounds(point, [motion.from, motion.control, motion.to])
	}
	const {near, control, reachEnd, correctionStart} = motion.settle
	const reach = quadratic(motion.from, motion.control, near, minimumJerk(progress / reachEnd))
	// The correction begins while the reach is braking. Overlapping the two
	// avoids a stop-and-restart at the join; the final arc settles with zero speed.
	const point = quadratic(reach, control, motion.to, minimumJerk((progress - correctionStart) / (1 - correctionStart)))
	return withinBounds(point, [motion.from, motion.control, near, control, motion.to])
}

export function createPointerMotion(
	from: PointerTarget,
	to: PointerTarget,
	{
		width,
		height,
		straight = false,
		durationMs,
	}: {width: number; height: number; straight?: boolean; durationMs?: number},
): PointerMotion {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const distance = Math.hypot(dx, dy)
	const clamp = (point: PointerTarget) => ({
		x: Math.max(0, Math.min(width - 1, point.x)),
		y: Math.max(0, Math.min(height - 1, point.y)),
	})
	const ux = dx / (distance || 1),
		uy = dy / (distance || 1)
	const side = dx < 0 ? -1 : 1
	const precise = straight || distance < 100
	// Short adjustments need precision, not a flourish. Longer reaches vary in
	// curvature, timing and landing error; randomness never enters the sampler.
	const variation = precise ? 0.5 : Math.random()
	const bend = precise ? 0 : Math.min(75, distance * (0.1 + variation * 0.07))
	const reach = straight ? 0.5 : 0.38 + variation * 0.12
	const control = clamp({x: from.x + dx * reach - uy * bend * side, y: from.y + dy * reach + ux * bend * side})
	let settle: PointerMotion['settle']
	if (!precise) {
		const accuracy = Math.min(1, (distance - 100) / 180)
		const overshoot = Math.random() < 0.35
		const error =
			accuracy *
			(overshoot ? Math.min(18, distance * 0.025) : -Math.min(24, distance * 0.035)) *
			(0.65 + Math.random() * 0.35)
		const lateral = side * accuracy * (3 + variation * 6)
		settle = {
			near: clamp({x: to.x + ux * error - uy * lateral, y: to.y + uy * error + ux * lateral}),
			control: clamp({
				x: to.x + ux * error * 0.16 + uy * lateral * 0.25,
				y: to.y + uy * error * 0.16 - ux * lateral * 0.25,
			}),
			reachEnd: 0.7 + variation * 0.08,
			correctionStart: 0.5 + variation * 0.06,
		}
	}
	return {
		from,
		to,
		control,
		...(settle ? {settle} : {}),
		startedAt: Date.now(),
		durationMs:
			durationMs ??
			(precise
				? Math.min(520, Math.max(120, Math.round((120 + 90 * Math.log2(1 + distance / 80)) / 8) * 8))
				: Math.min(720, Math.round((180 + 110 * Math.log2(1 + distance / 80)) * (0.94 + variation * 0.12)))),
	}
}
