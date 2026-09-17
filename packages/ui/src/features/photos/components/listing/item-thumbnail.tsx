import {useLayoutEffect, useRef, useState} from 'react'

import type {ThumbnailQueue, ThumbnailRequestSlot} from '@/features/photos/components/listing/thumbnail-queue'
import {itemThumbnailUrl, type Item, type ThumbSize} from '@/features/photos/hooks/use-items'
import {cn} from '@/lib/utils'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'

// The photo's own average colour, as CSS. A tile is its photograph's colour
// from the frame it exists, so a page of them arrives as a picture of the
// library that sharpens rather than as a wall of grey holes — and the
// arriving photograph is a sharpening rather than a change of colour, which
// is why it reads as calm. Items with no tint keep the flat wash.
export const tintColor = (tint: number | undefined) =>
	tint === undefined ? undefined : `#${tint.toString(16).padStart(6, '0')}`

// The rendition a square tile of this many device pixels wants. A rendition
// is scaled until its short edge reaches its size (see CONTRACT.md), and a
// tile crops the centre square — so the 192 covers a tile pixel for pixel
// right up to 192, whatever the photo's shape. It is also the one the canvas
// draws its cells from, so the two renderers either side of the GPU seam
// share the browser's cache and neither crossing refetches what is on
// screen. Above that, the 512.
export const thumbSizeForTile = (devicePx: number): ThumbSize => (devicePx <= 192 ? 192 : 512)

// The finest rendition an item's tile has on screen right now — undefined
// when it has no tile, or one still waiting on its first pixels. Asked of the
// DOM, because only the tile knows: renditions only ever sharpen, so a tile
// zoomed out from 512 keeps it however small the grid has since made it.
export function renditionOnScreen(id: string): ThumbSize | undefined {
	const thumbnail = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"] [data-rendition]`)
	const size = Number(thumbnail?.dataset.rendition)
	return size === 192 || size === 512 || size === 1280 ? size : undefined
}

// A thumbnail <img> for an item. The URL is derived from the id — every
// rendition always exists (see CONTRACT.md); `size` picks the one this
// surface needs. Eager by default: every list that renders these windows its
// own items, and a tile that springs into view during a reflow must already
// be fetching.
export function ItemThumbnail({
	item,
	size = 512,
	className,
	alt = '',
	loading = 'eager',
	warmUntil = 0,
	onLoad,
	requestQueue,
	requestIndex,
}: {
	item: Pick<Item, 'id' | 'tint'>
	size?: ThumbSize
	className?: string
	alt?: string
	loading?: 'eager' | 'lazy'
	// Until this moment (performance.now()), an arriving photograph is shown
	// at once rather than faded in from tint: the caller expects the pixels
	// in the browser's cache — the other renderer at the GPU seam just showed
	// them — and what was on screen a breath ago must not flash back through
	// its colour on the way in.
	warmUntil?: number
	// The loaded, decoded image — for reading its pixels
	onLoad?: (img: HTMLImageElement) => void
	// The timeline grid gates its DOM images so the current viewport is admitted
	// before overscan. Other surfaces omit these and retain their direct <img>
	// behavior.
	requestQueue?: ThumbnailQueue
	requestIndex?: number
}) {
	// Renditions only ever sharpen. `fine` is the one being shown or fetched;
	// when `size` steps up, the loaded image stays mounted beneath as `coarse`
	// until the finer one arrives, so an upgrade never passes back through the
	// tint. A step down is ignored — the finer pixels already here cover it.
	const [fine, setFine] = useState(() => ({size, warmUntil}))
	const [coarse, setCoarse] = useState<ThumbSize | null>(null)
	const [loaded, setLoaded] = useState<'none' | 'instant' | 'fade'>('none')
	if (size > fine.size) {
		if (loaded !== 'none') setCoarse(fine.size)
		// A sharpening is instant — and the coarse layer hides the wait anyway
		setFine({size, warmUntil: Infinity})
		setLoaded('none')
	}
	const authorizedUrl = useSharedAuthorizedHttpUrl(itemThumbnailUrl(item.id, fine.size))
	const authorizedCoarseUrl = useSharedAuthorizedHttpUrl(
		coarse === null ? undefined : itemThumbnailUrl(item.id, coarse),
	)
	const [queuedUrl, setQueuedUrl] = useState<string>()
	const fineImgRef = useRef<HTMLImageElement>(null)
	const queuedRequest = useRef<{url: string; slot: ThumbnailRequestSlot; settled: boolean} | undefined>(undefined)
	const requestIndexRef = useRef(requestIndex)
	requestIndexRef.current = requestIndex
	// Crossing up from the canvas mounts DOM images whose 192px renditions the
	// canvas just displayed. Preserve that instant cache handoff instead of
	// revealing it five tiles at a time through the request gate.
	const [warmCacheHandoff] = useState(() => performance.now() < warmUntil)
	const usesRequestQueue = requestQueue !== undefined && requestIndex !== undefined && !warmCacheHandoff
	useLayoutEffect(() => {
		if (!requestQueue || !usesRequestQueue || !authorizedUrl) return
		const request = {
			url: authorizedUrl,
			slot: requestQueue.enqueue(
				() => requestIndexRef.current!,
				() => setQueuedUrl(authorizedUrl),
			),
			settled: false,
		}
		queuedRequest.current = request
		return () => {
			// Removing an img alone does not promise to stop its network request.
			// Clear the selected source while the node is still mounted, then free
			// the queue slot, so repeated jumps cannot leave detached requests
			// consuming the browser's connection pool.
			const img = fineImgRef.current
			if (!request.settled && img?.getAttribute('src') === request.url) {
				img.removeAttribute('src')
			}
			request.slot.release()
			if (queuedRequest.current === request) queuedRequest.current = undefined
		}
	}, [authorizedUrl, requestQueue, usesRequestQueue])
	const fineUrl = usesRequestQueue ? (queuedUrl === authorizedUrl ? authorizedUrl : undefined) : authorizedUrl

	return (
		<div
			// What is painted, not what is wanted (see renditionOnScreen)
			data-rendition={loaded !== 'none' ? fine.size : (coarse ?? undefined)}
			className={cn('relative overflow-hidden', item.tint === undefined && 'bg-white/6', className)}
			style={{backgroundColor: tintColor(item.tint)}}
		>
			{/* Keyed by rendition, so on an upgrade this is the element that was
			    `fine` a render ago — same node, same decoded pixels, no reload */}
			{coarse !== null && authorizedCoarseUrl && (
				<img
					key={coarse}
					src={authorizedCoarseUrl}
					alt=''
					aria-hidden
					draggable={false}
					decoding='async'
					className='absolute inset-0 h-full w-full object-cover'
				/>
			)}
			{authorizedUrl && (
				<img
					ref={fineImgRef}
					key={fine.size}
					src={fineUrl}
					alt={alt}
					draggable={false}
					decoding='async'
					fetchPriority={usesRequestQueue ? 'auto' : 'low'}
					loading={loading}
					onLoad={(event) => {
						const img = event.currentTarget
						settleQueuedRequest(authorizedUrl)
						setLoaded(performance.now() < fine.warmUntil ? 'instant' : 'fade')
						// The coarse layer goes once the finer pixels can truly
						// paint; dropping it at the load event races the async decode
						if (coarse !== null) img.decode().then(dropCoarse, dropCoarse)
						onLoad?.(img)
					}}
					onError={() => settleQueuedRequest(authorizedUrl)}
					className={cn(
						'absolute inset-0 h-full w-full object-cover',
						loaded === 'fade' && 'transition-opacity duration-300',
						loaded === 'none' ? 'opacity-0' : 'opacity-100',
					)}
				/>
			)}
		</div>
	)

	function dropCoarse() {
		setCoarse(null)
	}

	function settleQueuedRequest(url: string) {
		const request = queuedRequest.current
		if (request?.url === url) {
			request.settled = true
			request.slot.settle()
		}
	}
}
