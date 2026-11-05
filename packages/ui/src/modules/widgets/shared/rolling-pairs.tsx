import {ReactNode, useEffect, useState} from 'react'
import {useMeasure} from 'react-use'
import {take} from 'remeda'

import {cn} from '@/lib/utils'

// How long each pair of stats stays up before the next one scrolls in
const STAT_CYCLE_MS = 4000

/**
 * Two rows at a time from a longer list, rolling up by one every few seconds
 * so none stays hidden: 1 + 2, 2 + 3, 3 + 4, 4 + 1, and round again. The
 * compact System (three stats) and four-stats widgets share it. With two or
 * fewer it just shows them.
 */
export function RollingPairs<T>({
	items,
	renderRow,
	rowClassName,
	gap = 2,
}: {
	items?: T[]
	renderRow: (item?: T) => ReactNode
	rowClassName: string
	gap?: number
}) {
	const [viewportRef, {height}] = useMeasure<HTMLDivElement>()
	const [start, setStart] = useState(0)
	const [scrolling, setScrolling] = useState(false)
	const count = items?.length ?? 0
	// Hidden (the widget is wider than compact) measures 0: don't roll then
	const rolls = count > 2 && height > 0

	useEffect(() => {
		if (!rolls) return
		const id = setInterval(() => {
			// No scroll animation to wait for, so step straight to the next pair
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
				setStart((start) => (start + 1) % count)
			} else {
				setScrolling(true)
			}
		}, STAT_CYCLE_MS)
		return () => clearInterval(id)
	}, [rolls, count])

	const rowH = Math.max(0, (height - gap) / 2)
	// The two rows on screen, plus the next one waiting below while it rolls
	const rows: {item?: T; index?: number}[] = !items
		? [{}, {}]
		: count > 2
			? [0, 1, 2].map((offset) => ({item: items[(start + offset) % count], index: (start + offset) % count}))
			: take(items, 2).map((item, index) => ({item, index}))

	return (
		<div ref={viewportRef} className='min-h-0 flex-1 overflow-hidden'>
			<div
				className={cn(
					'flex flex-col',
					scrolling && 'transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]',
				)}
				style={{gap, transform: scrolling ? `translateY(-${rowH + gap}px)` : undefined}}
				onTransitionEnd={(e) => {
					if (e.target !== e.currentTarget) return
					// Drop the row that rolled away and reset without animating; the rows
					// are keyed by item, so nothing visibly moves
					setStart((start) => (start + 1) % count)
					setScrolling(false)
				}}
			>
				{rows.map(({item, index}, i) => (
					<div key={index ?? i} className={cn('shrink-0', rowClassName)} style={{height: rowH}}>
						{renderRow(item)}
					</div>
				))}
			</div>
		</div>
	)
}
