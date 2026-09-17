import {useCallback, useEffect, useRef} from 'react'

import {renditionOnScreen} from '@/features/photos/components/listing/item-thumbnail'
import type {ThumbSize} from '@/features/photos/hooks/use-items'

// The rendition the lightbox draws an item from until its 1280 is up: what
// flies in from the tile, sits beneath the resting image while that loads,
// and is the blurred backdrop. The lightbox never picks a thumbnail of its
// own — every byte it asks for should be the 1280's — so an item is seeded
// from whatever its tile has on screen, which is what the eye just saw and
// is already decoded; and with no tile to ask (a canvas cell, an item the
// grid hasn't mounted, a deep link) from the 192, which the mosaic, the
// filmstrip and the ⌘K tiles all draw from, so it is in the browser's cache
// wherever the item was stepped or jumped to from.
//
// Decided once per item per session, so a tile sharpening behind the
// backdrop can't swap the picture's source under a flight, and a swipe's
// peek pane and the stage it hands over to always agree.
export function useSeedRenditions(open: boolean) {
	const seeds = useRef(new Map<string, ThumbSize>())
	useEffect(() => {
		if (!open) seeds.current.clear()
	}, [open])
	return useCallback((id: string): ThumbSize => {
		let seed = seeds.current.get(id)
		if (seed === undefined) {
			seed = renditionOnScreen(id) ?? 192
			seeds.current.set(id, seed)
		}
		return seed
	}, [])
}
