import {setWorkerUrl, type StyleSpecification} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'

import {useAtlas} from '@/features/photos/components/map/atlas'
import {mapLanguage, mapStyle} from '@/features/photos/components/map/map-style'
import {useHttpUrlAuthorizer} from '@/modules/auth/http-url-authorizer'
import {trpcReact} from '@/trpc/trpc'

// MapLibre's worker, from our own origin: the CSP allows no blob: workers
setWorkerUrl(workerUrl)

// The map's style, once it can be made: the basemap's answer is in, URLs
// can be authorized, and without a basemap, the atlas has come (or failed
// to). Shared by the map and the inspector's, so the two are one map
export function useMapStyle() {
	const {i18n} = useTranslation()
	const lang = mapLanguage(i18n.language)
	const loaded = useAtlas()
	// One that couldn't be fetched holds the map up no longer: without it the
	// map is the sea, with the photos on it
	const atlas = loaded ?? undefined
	const {data: basemap, isPending} = trpcReact.photos.map.basemap.useQuery(undefined, {staleTime: Infinity})
	const authorize = useHttpUrlAuthorizer()
	const token = authorize('/')
	const ready = !isPending && token !== undefined && (basemap?.available || loaded !== undefined)
	const style = useMemo<StyleSpecification | undefined>(
		() => (ready ? mapStyle({basemap, atlas, lang, authorize: (url) => authorize(url)!}) : undefined),
		// The token, not the authorizer: it is what the URLs carry
		[ready, basemap, atlas, lang, token],
	)
	return {style, basemap, atlas}
}
