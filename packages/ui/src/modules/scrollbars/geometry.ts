// The arithmetic of an overlay scrollbar, kept apart from the DOM (see overlay-scrollbars.ts)

export type Axis = 'x' | 'y'

export type Box = {left: number; top: number; right: number; bottom: number}

// However long the content, the thumb stays long enough to see and to grab
export const MIN_THUMB = 28

// A thumb's length and place along its track, in the track's px. `position` is
// how far the content has scrolled from its start, of the `scroll - client` it can.
// Nothing to draw when the content fits or there is no track.
export function thumbMetrics({
	track,
	client,
	scroll,
	position,
}: {
	track: number
	client: number
	scroll: number
	position: number
}) {
	const range = scroll - client
	if (track <= 0 || client <= 0 || range < 1) return null
	const length = Math.min(track, Math.max(MIN_THUMB, (track * client) / scroll))
	const travel = track - length
	const progress = Math.min(1, Math.max(0, position / range))
	return {length, travel, offset: travel * progress}
}

// How far the content scrolls when the thumb is dragged `delta` px along its track
export function dragToScroll({
	delta,
	travel,
	client,
	scroll,
}: {
	delta: number
	travel: number
	client: number
	scroll: number
}) {
	if (travel <= 0) return 0
	return (delta / travel) * (scroll - client)
}

// What two boxes share, or null when they are apart
export function intersect(a: Box, b: Box): Box | null {
	const box = {
		left: Math.max(a.left, b.left),
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
	}
	return box.right > box.left && box.bottom > box.top ? box : null
}

// How far a track keeps from the end of a scroller whose corner there is
// rounded, so the thumb's cap stays inside the curve
export function cornerInset(radius: number) {
	return Math.min(16, Math.max(0, radius) / 2)
}
