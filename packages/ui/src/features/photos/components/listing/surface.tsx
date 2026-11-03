import type {ReactNode} from 'react'

import {useSearchEngaged} from '@/features/photos/components/search'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'

// The actions bar, in the scroller's coordinates: its height, the gap the
// listing keeps below it (PhotosLayout's gap-3), and how far above it the
// scroller starts — on desktop the bar sits in the sheet's close button's
// row, 10px under the sheet's top edge, and the listing starts at that edge
// (see ActionsBar's top margin and the sheet's top padding in
// layouts/sheet.tsx).
const BAR_HEIGHT = 44
const BAR_GAP = 12
const BAR_TOP = {mobile: 0, desktop: 10}
// Content starts this far below the bar — as far as the bar is from the
// sheet's top edge — and the fade completes there (see .umbrel-photos-scroller)
const FADE_TAIL = 10
// How far below that the bar rests until the listing scrolls: level with the
// sheet's title, as Files' bar is. It rides up with the content and pins at
// BAR_TOP (see .umbrel-photos-actions), driven by the scroller's scroll
// timeline — where a browser has none, it simply stays pinned
const BAR_DROP = 30
const scrollDriven =
	typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()') && CSS.supports('timeline-scope: --a')
export function useBarDrop() {
	return useIsMobile() || !scrollDriven ? 0 : BAR_DROP
}

// The bar's title sits on the bar's bottom edge the way a group header's
// title sits on its row's: a header hands its title to the bar the moment
// the two lines coincide. That is when the header row's top is this far
// above the bar's bottom — the bar's title ends 16px above it (the view line
// is beneath), a header's 8px above its row's bottom, 30px into its
// HEADER_HEIGHT (38px) row: 16 + 30.
const TITLE_HANDOFF = 46

// Where a listing's content sits under the bar floating over it, in the
// scroller's px: `inset` is where it starts (under the bar at rest); what
// scrolls up under the pinned bar dissolves between `fadeFrom` and `fadeTo`
// (see FadedScroller); a group whose header row's top reaches `handoff` is
// the one the bar names (see TimelineGrid)
export type Frame = {inset: number; fadeFrom: number; fadeTo: number; handoff: number}

// The box a listing fills, edge to edge: pulled up under the bar and, on
// desktop, out to the sheet's right edge (countering its padding: see
// layouts/sheet.tsx) and down to its bottom edge beneath the dock — content
// runs from the sidebar to the edge and the bar's controls float over it.
// Phones and tablets keep the sheet's padding on both sides — unless the
// listing `bleed`s: the timeline runs to the sheet's edges there, as iOS
// Photos' grid does, and hands the padding it gave up to whatever inside it
// should still line up with the page's title (its date headers) as
// `--umbrel-photos-gutter`. A flex column, so the box's negative top margin
// can't collapse through.
export function ListingSurface({bleed = false, children}: {bleed?: boolean; children: (frame: Frame) => ReactNode}) {
	const isMobile = useIsMobile()
	const drop = useBarDrop()
	// A phone on its side gives the title row to the listing, until a search takes it back
	const searching = useSearchEngaged()
	const barBottom = (isMobile ? BAR_TOP.mobile : BAR_TOP.desktop) + BAR_HEIGHT
	// Content is hidden up to the pinned bar's top and fades in through the
	// bar (so the glass controls have something to frost), complete just
	// after it; it starts that far under the bar at rest
	const fadeTo = barBottom + FADE_TAIL
	const frame: Frame = {
		fadeFrom: barBottom - BAR_HEIGHT,
		fadeTo,
		inset: fadeTo + drop,
		handoff: barBottom - TITLE_HANDOFF,
	}

	return (
		<div className='relative flex flex-col'>
			{/* Heights: the sheet's height minus where this box naturally starts,
			    plus the pull-up, so the box runs exactly to the sheet's bottom
			    edge, beneath the dock — a box past it makes the sheet's own
			    ScrollArea scrollable, and its scrollbar lands on top of the
			    grid's. Mobile: the sheet is 100dvh−(--sheet-top), bottom-anchored,
			    and above the box sit the column's --page-top, the 44px title row,
			    the gap-5 and the grid's mt-[-0.5rem], plus the 56px pull-up → 112
			    on top of --page-top; a phone on its side has no title row (its
			    header is out of the flow, so no gap either) nor the pull-up → 56.
			    Desktop: sheet
			    100vh−60px, the box starts
			    66px down (bar 10+44, gap 12) plus the pull-up → 134. The right
			    margins mirror the sheet's md/xl padding (layouts/sheet.tsx), and
			    so do a bleeding listing's side margins below lg (its px-3 and
			    md:px-[40px]). */}
			<div
				className={cn(
					'-mt-(--umbrel-photos-inset) h-[calc(100dvh-var(--sheet-top)-var(--page-top)-112px+var(--umbrel-photos-inset))] lg:-mr-10 lg:h-[calc(100vh-134px+var(--umbrel-photos-inset))] xl:-mr-[60px]',
					// While a search has the title row back, the grid keeps its pull-up off
					searching
						? 'phone-side:h-[calc(100dvh-var(--sheet-top)-var(--page-top)-120px+var(--umbrel-photos-inset))]'
						: 'phone-side:h-[calc(100dvh-var(--sheet-top)-var(--page-top)-56px+var(--umbrel-photos-inset))]',
					bleed &&
						'max-lg:-mx-3 max-lg:[--umbrel-photos-gutter:12px] md:max-lg:-mx-10 md:max-lg:[--umbrel-photos-gutter:40px]',
				)}
				style={{['--umbrel-photos-inset' as string]: `${barBottom + BAR_GAP}px`}}
			>
				{children(frame)}
			</div>
		</div>
	)
}
