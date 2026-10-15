// The lightbox's side channels: values that change every frame of a gesture
// and must reach another part of the viewer without a React render per frame.

// The stage's horizontal travel, in items, for the filmstrip to move in
// lockstep with a swipe. 0 at rest on the current item; +0.4 when the stage is
// 40% of the way to the next one; -1 when the previous one has fully arrived.
// At an end of the list it is the rubber band's (damped) travel, exactly what
// the stage shows. Written by the stage gestures on every move of a horizontal
// drag and every frame of its settle; 0 the rest of the time (←/→, arrows and
// strip taps step without travel).
//
// The hand-over: a committed swipe holds the drive at ±1 until the viewer's
// current id has changed, and resets it to 0 in the layout phase of the very
// commit that renders the new id, before anything paints — so a strip whose
// base index moves on by one while its offset falls from 1 to 0 never shows
// the seam. Subscribers are told synchronously. Mind the order inside that
// commit: children's layout effects run before the viewer's, so a filmstrip
// reading `get()` in its own layout effect for the new id still sees ±1; the
// reset that follows reaches it through `subscribe` before paint.
export type StripDrive = {
	get(): number
	set(value: number): void
	subscribe(listener: (value: number) => void): () => void
}

export function createStripDrive(): StripDrive {
	let value = 0
	const listeners = new Set<(value: number) => void>()
	return {
		get: () => value,
		set(next) {
			if (next === value) return
			value = next
			for (const listener of listeners) listener(next)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}

// An upward drag on the stage (touch), for the phone's info sheet: `move`
// with the finger's travel on every move (dy < 0 is upward, px), then `end`
// once, on release or cancel, with the travel and the release velocity (vy in
// px/ms, negative upward). `cancelled` is a pointercancel, or the stage being
// taken away mid-drag (a close beginning): settle back, don't commit. The
// stage gestures move nothing themselves on this axis — the sheet owns the
// picture's lift as well as its own position.
export type StageLift = {
	move(dy: number): void
	end(dy: number, vy: number, cancelled: boolean): void
	// The sheet is holding the picture up: a downward drag lowers it (the same
	// `move`/`end`, dy > 0) instead of dismissing the viewer
	lifted?(): boolean
}
