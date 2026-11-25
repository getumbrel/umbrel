import {Check, Heart, Play} from 'lucide-react'
import {memo, useEffect, useRef, useState} from 'react'

import {ItemThumbnail, tintColor} from '@/features/photos/components/listing/item-thumbnail'
import type {ThumbnailQueue} from '@/features/photos/components/listing/thumbnail-queue'
import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {itemLiveUrl, type Item, type ThumbSize} from '@/features/photos/hooks/use-items'
import {itemLabel} from '@/features/photos/utils/item-label'
import {MomentScrubber} from '@/features/search/moment-scrubber'
import {MomentStill} from '@/features/search/moment-still'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {tw} from '@/utils/tw'

function formatDuration(ms: number) {
	const total = Math.round(ms / 1000)
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The selection circle's corner of a tile: how big a tile must be to show
// it, and the square (from the top-left corner) a click in counts as a click
// on it. The circle is a pseudo-element with no element of its own, so
// TileLayer tells the two clicks apart with this. Mirrored by the classes
// below (`@min-[72px]`, `top-1.5 left-1.5 size-[22px]`).
export const SELECT_CIRCLE = {minTile: 72, hitSize: 36} as const

// The tile's classes, one string per state so a render does no class work.
// The hover wash, the focus ring and the empty circle are the button's
// pseudo-elements: the ring on the button itself would be painted under the photo.
const tileClass = tw`group relative aspect-square w-full overflow-hidden rounded-(--umbrel-photos-tile-radius) outline-hidden focus-visible:before:ring-2 focus-visible:before:ring-white/60 focus-visible:before:ring-inset before:rounded-[inherit] before:pointer-events-none before:absolute before:inset-0 before:z-10 hover:before:bg-white/8 after:pointer-events-none after:absolute after:top-1.5 after:left-1.5 after:z-10 after:hidden after:size-[22px] after:rounded-full after:border-[1.5px] after:border-white/85 after:bg-black/20 after:shadow-[0_1px_3px_rgb(0_0_0/0.35)]`
const tileClassByState = {
	idle: `${tileClass} @min-[72px]:hover:after:block`,
	selectable: `${tileClass} @min-[72px]:after:block`,
	selected: tileClass,
}

// One cell of the grid: thumbnail, kind badges, favorite mark and the
// selection circle. Deliberately just a picture — opening it, selecting it
// and its context menu are handled once for every tile by the layer around
// them (see TileLayer), so mounting a hundred of these at a new zoom stop
// costs no more than the DOM they add. Memoized: the grid re-renders on
// every scroll, reflow and selection change, and only a changed tile matters.
//
// Nothing is added to the DOM for selection until a tile is selected: the
// hover wash and the empty circle (shown on hover, and on every tile while
// `selectable`) are pseudo-elements, and only a selected tile mounts its
// ring and check. Every node here is multiplied by the hundreds of tiles a
// dense zoom stop mounts in one frame, and nothing transitions.
export const ItemTile = memo(function ItemTile({
	item,
	thumbSize = 512,
	warmUntil = 0,
	momentMs,
	momentStill,
	live,
	selected,
	selectable,
	thumbnailQueue,
	thumbnailIndex,
}: {
	item: Item
	// The rendition the tile's size asks for (see thumbSizeForTile) and how
	// long an arriving photograph is shown without its fade (see
	// ItemThumbnail.warmUntil) — both the grid's business, passed through
	thumbSize?: ThumbSize
	warmUntil?: number
	// A search matched this video at a moment (ms in): the tile shows it as a
	// player would, played up to there (see MomentScrubber), in place of the
	// running time
	momentMs?: number
	// … and a picture of the video as it is then, shown in place of its cover
	momentStill?: string
	// A hovered live photo's motion clip (see useLiveHover): 'playing' under
	// the pointer, 'ending' while it lingers out after the pointer has left.
	// A primitive, not an object, so the memo around this tile holds.
	live?: 'playing' | 'ending'
	selected: boolean
	selectable: boolean
	thumbnailQueue?: ThumbnailQueue
	thumbnailIndex?: number
}) {
	const moment = item.kind === 'video' && momentMs !== undefined
	return (
		<button
			type='button'
			data-item-id={item.id}
			aria-label={itemLabel(item)}
			aria-pressed={selectable ? selected : undefined}
			className={tileClassByState[selected ? 'selected' : selectable ? 'selectable' : 'idle']}
		>
			<ItemThumbnail
				item={item}
				size={thumbSize}
				warmUntil={warmUntil}
				requestQueue={thumbnailQueue}
				requestIndex={thumbnailIndex}
				className='h-full w-full'
			/>
			{momentStill && <MomentStill url={momentStill} backdrop={tintColor(item.tint)} />}
			{live && <LiveTileClip id={item.id} active={live === 'playing'} />}
			{/* A video a search matched partway through: the line at every size,
			    the time on it once the tile can carry one. Past the seam the
			    canvas draws the same line (see tile-renderer). */}
			{moment && (
				<MomentScrubber momentMs={momentMs!} durationMs={item.durationMs} pillClassName='hidden @min-[88px]:block' />
			)}
			{/* Below the sizes that carry the full badges, a video still wears a
			    small play mark — the same one the canvas draws past the seam, so
			    crossing it never pops the mark in or out */}
			{item.kind === 'video' && (
				<span
					className={cn(
						'absolute left-1 flex size-3 items-center justify-center rounded-full bg-black/55 text-white @min-[88px]:hidden',
						moment ? 'bottom-1.5' : 'bottom-1',
					)}
				>
					<Play className='size-1.5' fill='currentColor' strokeWidth={0} />
				</span>
			)}
			{/* Badges only once the tile is big enough to carry them (see TileSlot's container).
			    One corner shares them: 360° and duration can coexist on a video, Live is photos-only.
			    A matched moment's pill has the bottom edge, so they sit above it. */}
			{(item.subKind === 'live' || item.subKind === 'spherical' || (item.durationMs !== undefined && !moment)) && (
				<span
					className={cn(
						'absolute left-1.5 hidden items-center gap-1 @min-[88px]:flex',
						moment ? 'bottom-7' : 'bottom-1.5',
					)}
				>
					{item.subKind === 'live' && (
						<span className='flex items-center rounded-full bg-black/55 p-[3px] text-white backdrop-blur-sm'>
							<LivePhotoIcon className='size-3.5' />
						</span>
					)}
					{item.subKind === 'spherical' && (
						<span className='rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm'>
							360°
						</span>
					)}
					{item.kind === 'video' && item.durationMs !== undefined && !moment && (
						<span className='flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm'>
							<Play className='size-2.5' fill='currentColor' strokeWidth={0} />
							{formatDuration(item.durationMs)}
						</span>
					)}
				</span>
			)}
			{item.isFavorite && (
				<span className='absolute top-1.5 right-1.5 hidden text-white drop-shadow @min-[88px]:block'>
					<Heart className='size-3.5' fill='currentColor' strokeWidth={0} />
				</span>
			)}
			{selected && (
				<span className='pointer-events-none absolute inset-0 rounded-(--umbrel-photos-tile-radius) border-2 border-brand'>
					{/* 4px inside the 2px border: where the empty circle sits */}
					<span className='absolute top-1 left-1 hidden size-[22px] items-center justify-center rounded-full bg-brand text-white @min-[72px]:flex'>
						<Check className='size-3.5' strokeWidth={3} />
					</span>
				</span>
			)}
		</button>
	)
})

// A clip that couldn't decode (Apple pairs are often HEVC) stays broken for
// the session: a re-hover must not refetch it just to fail again
const failedClips = new Set<string>()

// The hovered live tile's motion clip, looping muted over the still. Only
// ever one of these in the whole grid — the hover's single slot (see
// useLiveHover) — so its video and fetch cost nothing until a tile is
// actually dwelt on. Fades in only once frames render (`playing`), exactly
// like the lightbox's LivePhoto: a clip the browser can't decode simply
// leaves the still alone. Sound has no place here — hover is not a request
// to hear anything, and unmuted play without a gesture is refused anyway;
// the lightbox's sound toggle is where audio lives. The badges stay
// mounted above it, so the LIVE mark rides the motion the way iOS keeps it.
function LiveTileClip({id, active}: {id: string; active: boolean}) {
	const url = useAuthorizedHttpUrl(itemLiveUrl(id))
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [showing, setShowing] = useState(false)
	// Play follows `active`: the pointer resting (a pending play simply
	// starts when enough has buffered), the linger pausing it to fade out
	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		if (active) {
			video.play().catch(() => {})
		} else {
			video.pause()
			setShowing(false)
		}
	}, [active, url])
	if (failedClips.has(id)) return null
	return url ? (
		<video
			ref={videoRef}
			src={url}
			muted
			playsInline
			loop
			preload='auto'
			aria-hidden='true'
			onPlaying={() => setShowing(true)}
			onError={() => {
				failedClips.add(id)
				setShowing(false)
			}}
			className={cn(
				'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ease-out motion-reduce:transition-none',
				showing ? 'opacity-100 duration-200' : 'opacity-0 duration-200',
			)}
		/>
	) : null
}
