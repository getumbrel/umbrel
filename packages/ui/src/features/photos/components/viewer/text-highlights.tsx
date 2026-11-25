import {useMemo, type CSSProperties} from 'react'

import {
	lineRegions,
	matchRegions,
	quadPath,
	restingStrength,
	type TextFocus,
	type TextLine,
} from '@/features/photos/components/viewer/text-regions'

// The picture's user space: a thousand units wide, as tall as its shape
// makes it. Only a scale; the drawing is vector at any size.
const WIDTH = 1000
// How much later each match arrives than the one before it, and how many of
// them take turns before the rest arrive together
const STAGGER_MS = 45
const STAGGER_MAX = 6

// The picture's text, pointed at on the picture itself. Two layers of one
// drawing:
//
//   matches  the words a search found the picture by, in the brand tint, as
//            shapes that follow each line's own tilt. They arrive once — a
//            beat brighter and larger, settling onto the word — and then
//            rest as a wash the letters read through (`.picture-text-match`
//            in index.css).
//   lines    every line that has a place, outlined in white, unseen until
//            the inspector points: at one line, or at all of them.
//
// Like FaceOutlines it is a child of the picture's own box, which is exactly
// the displayed picture, so the drawing is laid over it by the box alone and
// goes wherever the picture goes — the stage resizing as the inspector
// opens, a drag, the window — with nothing measured and nothing redrawn.
// React renders this when what is pointed at changes, and never for motion.
// Every shape is stroked in its own colour with a width that does not scale:
// that rounds its corners, stands it a little off the letters, and keeps the
// highlight of a line a few pixels tall from thinning to nothing.
export function TextHighlights({
	lines,
	aspect,
	matched,
	focus,
}: {
	lines: readonly TextLine[]
	// The picture's width over its height
	aspect: number
	// The words a search found the picture by (see snippetTerms)
	matched: readonly string[]
	focus: TextFocus
}) {
	const height = WIDTH / aspect
	const matches = useMemo(() => matchRegions(lines, matched), [lines, matched])
	const all = useMemo(() => lineRegions(lines), [lines])
	if (matches.length === 0 && all.length === 0) return null
	return (
		<svg
			aria-hidden='true'
			viewBox={`0 0 ${WIDTH} ${height}`}
			preserveAspectRatio='none'
			className='pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible'
			style={{'--picture-text-rest': 0.45 * restingStrength(matches.length)} as CSSProperties}
		>
			{matches.map((region, index) => (
				<path
					key={index}
					d={quadPath(region.quad, WIDTH, height)}
					className='picture-text-match'
					style={{animationDelay: `${Math.min(index, STAGGER_MAX) * STAGGER_MS}ms`}}
				/>
			))}
			{/* Light on any picture: the white line is given a dark hairline */}
			<g className='picture-text-lines'>
				{all.map((region) => (
					<path
						key={region.line}
						d={quadPath(region.quad, WIDTH, height)}
						className='picture-text-line'
						// An attribute, not a second class: merging class names would take
						// two that begin `text-` for rival utilities and keep one
						data-lit={focus === 'all' || (focus !== null && focus.line === region.line) ? '' : undefined}
					/>
				))}
			</g>
		</svg>
	)
}
