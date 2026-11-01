export type Rect = {x: number; y: number; w: number; h: number}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// Critically damped, so the view arrives without a wobble. The console zooms
// and pans the framebuffer locally: the guest never hears about any of this.
const STIFFNESS = 240
const DAMPING = 2 * Math.sqrt(STIFFNESS)

// How much of the view the pointer may wander before the view follows it
const FOLLOW_MARGIN = 0.2
// A typical desktop context menu, in guest pixels
const MENU_ROOM = {width: 260, height: 300}
// What typing zooms to: about 12 and 9.5 points for a desktop's 13 px text
const NARROW_VIEW = 500
const LEGIBLE_NARROW = 0.92
const LEGIBLE_WIDE = 0.72

export class Camera {
	s = 1
	x = 0
	y = 0
	view: Rect = {x: 0, y: 0, w: 1, h: 1}
	// On a narrow screen a whole desktop is a thumbnail, so it fills the height and
	// the width pans. A laptop's top half is the other way round. Anywhere else the
	// desktop simply fits.
	fill: 'height' | 'width' | undefined
	zoomed = false
	onChange?: () => void

	private target: {s: number; x: number; y: number} | undefined
	private velocity = {s: 0, x: 0, y: 0}
	private frame = 0
	private last = 0
	private saved: {s: number; x: number; y: number; zoomed: boolean; width: number} | undefined

	constructor(
		private element: HTMLElement,
		public guestWidth: number,
		public guestHeight: number,
	) {}

	get fit() {
		return Math.min(this.view.w / this.guestWidth, this.view.h / this.guestHeight)
	}
	get rest() {
		if (!this.fill) return this.fit
		return Math.max(this.fit, this.fill === 'height' ? this.view.h / this.guestHeight : this.view.w / this.guestWidth)
	}
	get max() {
		return Math.max(2.4, this.fit * 3)
	}

	toGuest(px: number, py: number) {
		return {x: (px - this.x) / this.s, y: (py - this.y) / this.s}
	}
	toStage(gx: number, gy: number) {
		return {x: gx * this.s + this.x, y: gy * this.s + this.y}
	}

	private clampPosition(s: number, x: number, y: number) {
		const {view} = this
		const width = this.guestWidth * s
		const height = this.guestHeight * s
		return {
			x: width <= view.w ? view.x + (view.w - width) / 2 : clamp(x, view.x + view.w - width, view.x),
			y: height <= view.h ? view.y + (view.h - height) / 2 : clamp(y, view.y + view.h - height, view.y),
		}
	}

	private apply() {
		this.element.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.s})`
		this.onChange?.()
	}

	stop() {
		cancelAnimationFrame(this.frame)
		this.frame = 0
		this.target = undefined
		this.velocity = {s: 0, x: 0, y: 0}
	}

	jump(s: number, x: number, y: number) {
		this.stop()
		const position = this.clampPosition(s, x, y)
		this.s = s
		this.x = position.x
		this.y = position.y
		this.apply()
	}

	animateTo(s: number, x: number, y: number) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			this.jump(s, x, y)
			return
		}
		const position = this.clampPosition(s, x, y)
		this.target = {s, ...position}
		if (this.frame) return
		this.last = performance.now()
		this.frame = requestAnimationFrame(this.tick)
	}

	private tick = (now: number) => {
		const target = this.target
		if (!target) return
		// Several small steps keep the spring stable through a dropped frame
		const elapsed = Math.min(0.05, (now - this.last) / 1000)
		this.last = now
		const steps = Math.max(1, Math.ceil(elapsed / 0.004))
		const dt = elapsed / steps
		for (let step = 0; step < steps; step++) {
			for (const key of ['s', 'x', 'y'] as const) {
				const acceleration = -STIFFNESS * (this[key] - target[key]) - DAMPING * this.velocity[key]
				this.velocity[key] += acceleration * dt
				this[key] += this.velocity[key] * dt
			}
		}
		const settled =
			Math.abs(this.s - target.s) < 0.0006 && Math.abs(this.x - target.x) < 0.25 && Math.abs(this.y - target.y) < 0.25
		if (settled) {
			this.s = target.s
			this.x = target.x
			this.y = target.y
			this.apply()
			this.stop()
			return
		}
		this.apply()
		this.frame = requestAnimationFrame(this.tick)
	}

	// The glass available to the screen changed: a hinge, the keyboard, a turn
	setView(view: Rect, {animate, pointer}: {animate: boolean; pointer: {x: number; y: number}}) {
		this.view = view
		if (this.saved) return
		const s = this.zoomed ? clamp(this.s, this.fit, this.max) : this.rest
		const x = view.x + view.w / 2 - pointer.x * s
		const y = view.y + view.h / 2 - pointer.y * s
		if (animate) this.animateTo(s, x, y)
		else this.jump(s, x, y)
	}

	// Moves by a finger's travel, and hands back what the view couldn't take so
	// it can scroll the guest instead, the way Safari moves its visual viewport
	// first and then the page
	panBy(dx: number, dy: number) {
		this.stop()
		const position = this.clampPosition(this.s, this.x + dx, this.y + dy)
		const moved = {x: position.x - this.x, y: position.y - this.y}
		this.x = position.x
		this.y = position.y
		if (moved.x || moved.y) this.apply()
		return {x: dx - moved.x, y: dy - moved.y}
	}

	canPan(axis: 'x' | 'y', direction: number) {
		const position = this.clampPosition(
			this.s,
			axis === 'x' ? this.x + direction : this.x,
			axis === 'y' ? this.y + direction : this.y,
		)
		return position[axis] !== this[axis]
	}

	// Past the limits the pinch resists, then springs back on release
	zoomAt(px: number, py: number, ratio: number) {
		this.stop()
		const {fit, max} = this
		let s = this.s * ratio
		if (s < fit) s = fit * (s / fit) ** 0.35
		if (s > max) s = max * (s / max) ** 0.35
		this.x = px - ((px - this.x) * s) / this.s
		this.y = py - ((py - this.y) * s) / this.s
		this.s = s
		this.apply()
	}

	shift(dx: number, dy: number) {
		this.x += dx
		this.y += dy
		this.apply()
	}

	endZoom() {
		const s = clamp(this.s, this.fit, this.max)
		this.zoomed = Math.abs(s - this.rest) > 0.01
		if (!this.zoomed && this.s <= this.rest + 0.01) this.animateTo(this.rest, this.x, this.y)
		else
			this.animateTo(s, this.x + ((this.s - s) * this.guestWidth) / 2, this.y + ((this.s - s) * this.guestHeight) / 2)
	}

	// The whole desktop, however small that leaves it
	showAll() {
		this.zoomed = this.rest !== this.fit
		this.animateTo(this.fit, 0, 0)
	}

	// Keeps a guest point inside the view while the pointer roams, like screen
	// zoom on a Mac
	follow(gx: number, gy: number, margin = FOLLOW_MARGIN) {
		const point = this.toStage(gx, gy)
		const {view} = this
		const marginX = view.w * margin
		const marginY = view.h * margin
		let dx = 0
		let dy = 0
		if (point.x < view.x + marginX) dx = view.x + marginX - point.x
		if (point.x > view.x + view.w - marginX) dx = view.x + view.w - marginX - point.x
		if (point.y < view.y + marginY) dy = view.y + marginY - point.y
		if (point.y > view.y + view.h - marginY) dy = view.y + view.h - marginY - point.y
		if (dx || dy) {
			if (this.target) this.target = undefined
			this.panBy(dx, dy)
		}
	}

	makeRoom(gx: number, gy: number) {
		const point = this.toStage(gx, gy)
		const {view} = this
		const right = Math.min(MENU_ROOM.width * this.s, view.w * 0.72)
		const below = Math.min(MENU_ROOM.height * this.s, view.h * 0.72)
		const dx = Math.min(0, view.x + view.w - right - point.x)
		const dy = Math.min(0, view.y + view.h - below - point.y)
		if (dx || dy) this.animateTo(this.s, this.x + dx, this.y + dy)
	}

	// The keyboard is coming: remember this view, then bring what's being typed
	// into to a readable size, just above the keys
	focusOn(gx: number, gy: number, view: Rect) {
		if (!this.saved) this.saved = {s: this.s, x: this.x, y: this.y, zoomed: this.zoomed, width: this.view.w}
		this.view = view
		const legible = view.w < NARROW_VIEW ? LEGIBLE_NARROW : LEGIBLE_WIDE
		const s = this.s >= legible * 0.9 ? this.s : clamp(legible, this.fit, this.max)
		const point = {x: gx * s + this.x, y: gy * s + this.y}
		const inView =
			point.x >= view.x + view.w * 0.1 &&
			point.x <= view.x + view.w * 0.9 &&
			point.y >= view.y + view.h * 0.1 &&
			point.y <= view.y + view.h * 0.85
		// Readable and above the keys already: then nothing needs to move at all
		if (s === this.s && inView) this.animateTo(s, this.x, this.y)
		else this.animateTo(s, view.x + view.w * 0.36 - gx * s, view.y + view.h * 0.6 - gy * s)
	}

	// Same again as the caret moves along a line, without changing the zoom
	keepInView(gx: number, gy: number) {
		const point = this.toStage(gx, gy)
		const {view} = this
		const right = view.x + view.w * 0.82
		const left = view.x + view.w * 0.14
		const bottom = view.y + view.h * 0.86
		const top = view.y + view.h * 0.14
		let dx = 0
		let dy = 0
		if (point.x > right) dx = right - point.x
		if (point.x < left) dx = left - point.x
		if (point.y > bottom) dy = bottom - point.y
		if (point.y < top) dy = top - point.y
		if (dx || dy) this.animateTo(this.s, this.x + dx, this.y + dy)
	}

	release(view: Rect, pointer: {x: number; y: number}) {
		const saved = this.saved
		this.saved = undefined
		this.view = view
		// The phone may have turned since, and then the old view means nothing
		if (saved && saved.width === view.w) {
			this.zoomed = saved.zoomed
			this.animateTo(saved.s, saved.x, saved.y)
		} else this.setView(view, {animate: true, pointer})
	}
}

// Keeps a flick going after the finger lifts, at the rate iOS decelerates a
// scroll view
export function inertia(vx: number, vy: number, step: (dx: number, dy: number) => void) {
	let frame = 0
	let last = performance.now()
	const tick = (now: number) => {
		const dt = Math.min(48, now - last)
		last = now
		const decay = 0.9975 ** dt
		vx *= decay
		vy *= decay
		step((vx * dt) / 1000, (vy * dt) / 1000)
		if (Math.hypot(vx, vy) > 16) frame = requestAnimationFrame(tick)
	}
	frame = requestAnimationFrame(tick)
	return () => cancelAnimationFrame(frame)
}
