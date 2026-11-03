import {useEffect, useRef} from 'react'

import {loadAtlas} from '@/features/photos/components/map/atlas'
import {itemThumbnailUrl} from '@/features/photos/hooks/use-items'
import {withHttpApiToken} from '@/modules/auth/authorized-url'
import {trpcReact} from '@/trpc/trpc'

// How long the eye must rest on an item before its neighbours are fetched:
// flicking through the strip visits many items for a moment each, and none
// of those stops should cost two full-size downloads
const DWELL_MS = 300

// Warm the two items a step would land on, so ←/→ (and a swipe) shows the
// resting image at once: their detail — the file name the header shows, and
// everything the info panel tells (EXIF, albums, location) — and, for
// stills, the 1280 rendition's bytes, through a detached <img> the stage's
// own <img> then picks up from the browser's cache. Videos are never
// prefetched: the player streams what it needs once it is actually looked
// at, where a skipped-over video would have sunk a file of any size — their
// warmed detail only spares a step onto one the detail round trip (the
// stage's rest gate still holds).
//
// Prefetching starts only once the item being looked at is `settled` — its
// own original on screen — so it never competes for the wire with what the
// eye is on, and only after a beat of rest. A step retargets it, and a leap
// somewhere else abandons whatever is still in flight.
// The info panel's location card names places from the atlas, and on a
// device with a basemap draws its map from a lazy chunk; both are
// session-wide singletons, so warming is idempotent and a repeat call costs
// nothing
const warmLocationMap = (utils: ReturnType<typeof trpcReact.useUtils>) =>
	Promise.all([
		loadAtlas(),
		utils.photos.map.basemap.ensureData().then((basemap) => {
			if (basemap.available) return import('@/features/photos/components/map/location-map')
		}),
	]).catch(() => undefined)

export function useNeighborPrefetch({
	open,
	settled,
	currentId,
	prevId,
	nextId,
	deleted,
	infoShowing,
}: {
	open: boolean
	settled: boolean
	currentId: string | undefined
	prevId: string | undefined
	nextId: string | undefined
	// Whether the lightbox is in Recently Deleted — the detail must be asked
	// for with the same flag the stage's own query carries, or it lands in a
	// cache entry the step never reads
	deleted: boolean
	// The map is worth its bytes only when the open inspector would actually
	// show it on arrival
	infoShowing: boolean
}) {
	const utils = trpcReact.useUtils()
	// Prefetches by item id — held while loading so they can be abandoned,
	// and once loaded so a re-run doesn't start the same fetch again
	const prefetches = useRef(new Map<string, HTMLImageElement>())
	useEffect(() => {
		// An item no longer beside the user is not worth finishing: clearing
		// src abandons a load in flight (and is a no-op on a finished one).
		// The current item stays: a step arrives on its own prefetch.
		const wanted = new Set(open ? [currentId, prevId, nextId] : [])
		for (const [id, image] of prefetches.current) {
			if (wanted.has(id)) continue
			image.src = ''
			prefetches.current.delete(id)
		}
		if (!open || !settled) return
		let stale = false
		const handle = setTimeout(async () => {
			// Next first: the likelier direction of travel
			for (const id of [nextId, prevId]) {
				if (!id) continue
				// Cache-served once fetched, so asking again for an item whose
				// image is already in hand (below) costs nothing
				const detail = await utils.photos.items.get.ensureData({id, deleted}).catch(() => undefined)
				if (stale) return
				if (!detail) continue
				// A located neighbour with the inspector open: the step will
				// want the atlas, and the map's chunk if there is a basemap
				// (videos included)
				if (infoShowing && detail.location) void warmLocationMap(utils)
				if (prefetches.current.has(id) || detail.kind === 'video') continue
				const token = await utils.user.getHttpApiToken.ensureData().catch(() => undefined)
				if (stale) return
				if (!token) continue
				const image = new Image()
				image.src = withHttpApiToken(itemThumbnailUrl(id, 1280), token)
				prefetches.current.set(id, image)
			}
		}, DWELL_MS)
		return () => {
			stale = true
			clearTimeout(handle)
		}
	}, [open, settled, currentId, prevId, nextId, deleted, infoShowing, utils])

	return {
		// Whether an item's original is already in hand — its prefetch holds the
		// bytes — so the stage can show it without waiting out its rest gate
		warm: (id: string) => {
			const image = prefetches.current.get(id)
			return Boolean(image && image.complete && image.naturalWidth > 0)
		},
	}
}
