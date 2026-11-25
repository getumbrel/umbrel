// The arithmetic of a matched moment drawn on a thumbnail (see MomentScrubber)

// How far into a video or recording a moment is, 0 to 1. Nothing when the
// length is not known: a position cannot be drawn without it.
export function momentFraction(momentMs: number, durationMs: number | undefined) {
	if (durationMs === undefined || !(durationMs > 0) || !Number.isFinite(momentMs)) return undefined
	return Math.min(1, Math.max(0, momentMs / durationMs))
}

// Where a picture sits inside a square box it is fitted into whole
// (`object-contain`), as the CSS insets of the picture's own rectangle: a
// 16:9 thumbnail leaves a band above and below it, and what is drawn on the
// picture's edge must not be drawn on the box's.
export function containInset(width: number, height: number) {
	if (!(width > 0) || !(height > 0)) return {inline: 0, block: 0}
	const aspect = width / height
	return aspect >= 1 ? {inline: 0, block: (1 - 1 / aspect) * 50} : {inline: (1 - aspect) * 50, block: 0}
}
