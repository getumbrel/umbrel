import {Play} from 'lucide-react'

import {cn} from '@/lib/utils'

import {formatMoment} from './format'
import {momentFraction} from './scrubber'

// The moment a search matched in a video, drawn on its thumbnail the way a
// player draws how far it has played: a hairline along the bottom edge,
// filled in the match colour up to the moment (see --color-match), and the time on a pill resting
// on the line at that point. It says where the match is before the result is
// opened, and opening it starts there. The pill carries the play mark, so a
// tile that wears this needs no other.
//
// The pill follows the moment across the tile without ever leaving it: it is
// shifted back by the same share of its own width as it is moved along, so it
// starts flush left at 0:00, ends flush right at the last second, and is
// centred on the line's end halfway through. A video whose length is not
// known has no line to draw; the pill alone says when.
export function MomentScrubber({
	momentMs,
	durationMs,
	pill = true,
	compact = false,
	pillClassName,
}: {
	momentMs: number
	durationMs?: number
	// Thumbnails too small to carry a time wear the line alone
	pill?: boolean
	// A smaller pill and a finer line, for thumbnails of a few dozen pixels
	compact?: boolean
	pillClassName?: string
}) {
	const fraction = momentFraction(momentMs, durationMs)
	const along = `${(fraction ?? 0) * 100}%`
	return (
		<span aria-hidden='true' className='pointer-events-none absolute inset-x-0 bottom-0 block'>
			{pill && (
				// The rail the pill rides: the tile's width, less a margin either side
				<span
					className={cn(
						'absolute block',
						compact ? 'inset-x-0.5 bottom-1 h-3.5' : 'inset-x-1 h-[18px]',
						!compact && (fraction === undefined ? 'bottom-1' : 'bottom-1.5'),
						pillClassName,
					)}
				>
					<span
						className={cn(
							'absolute top-0 flex h-full items-center rounded-full bg-match leading-none font-semibold whitespace-nowrap text-match-ink tabular-nums shadow-[0_1px_3px_rgb(0_0_0/0.35)]',
							compact ? 'gap-0.5 px-1 text-[9px]' : 'gap-[3px] px-1.5 text-[11px]',
						)}
						style={{left: along, transform: `translateX(-${along})`}}
					>
						<Play className={compact ? 'size-1.5' : 'size-2'} fill='currentColor' strokeWidth={0} />
						{formatMoment(momentMs)}
					</span>
				</span>
			)}
			{fraction !== undefined && (
				<span className={cn('block bg-black/35', compact ? 'h-0.5' : 'h-[3px]')}>
					<span className='block h-full bg-white/35'>
						{/* Never less than a nub: a match in the first second still shows its colour */}
						<span className='block h-full bg-match' style={{width: `max(3px, ${along})`}} />
					</span>
				</span>
			)}
		</span>
	)
}
