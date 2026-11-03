import type {ReactNode} from 'react'

import type {Frame} from '@/features/photos/components/listing/surface'

// The grid the photos would fill, sketched behind the listings' stateful
// screens: faint rounded tiles fading out radially, so the message floats in
// the middle of an empty mosaic. Each tile carries one flat opacity from its
// distance to the centre — a gradient mask over a ~4% fill leaves so few
// 8-bit alpha levels that its steps show as contour rings inside the tiles.
// Inline SVG — a data: URI would trip the CSP. Its parent is `relative isolate`.
const GHOST_TILE = 140
const GHOST_COLS = 15
const GHOST_ROWS = 11
export function GhostGrid() {
	const tiles = []
	for (let row = 0; row < GHOST_ROWS; row++) {
		for (let col = 0; col < GHOST_COLS; col++) {
			const dx = (col - (GHOST_COLS - 1) / 2) / (GHOST_COLS / 2)
			const dy = (row - (GHOST_ROWS - 1) / 2) / (GHOST_ROWS / 2)
			const fade = Math.max(0, 1 - Math.hypot(dx, dy) / 0.8)
			const opacity = fade ** 1.8 * 0.02
			if (opacity < 0.004) continue
			tiles.push(
				<rect
					key={`${col}-${row}`}
					x={col * GHOST_TILE + 3}
					y={row * GHOST_TILE + 3}
					width={GHOST_TILE - 6}
					height={GHOST_TILE - 6}
					rx={10}
					fillOpacity={opacity.toFixed(3)}
				/>,
			)
		}
	}
	return (
		<div aria-hidden className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'>
			<svg
				width={GHOST_COLS * GHOST_TILE}
				height={GHOST_ROWS * GHOST_TILE}
				className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 fill-white'
			>
				{tiles}
			</svg>
		</div>
	)
}

// Nothing to show: a title, what would be here and how it gets here, and the
// way forward, centred over the ghost grid. Every empty listing in Photos
// uses this one screen.
export function EmptyScreen({
	frame,
	title,
	description,
	actions,
}: {
	frame: Frame
	title: string
	description?: string
	actions?: ReactNode
}) {
	return (
		<div
			className='relative isolate flex h-full flex-col items-center justify-center gap-1 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<GhostGrid />
			<p className='text-15 font-medium text-white/80'>{title}</p>
			{description && <p className='max-w-sm text-13 text-white/50'>{description}</p>}
			{actions && <div className='mt-3 flex items-center gap-2'>{actions}</div>}
		</div>
	)
}
