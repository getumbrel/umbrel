import {lazy} from 'react'
import {RouteObject} from 'react-router-dom'

import {PhotosListing} from '@/features/photos/components/listing'
import {SourcesOverview} from '@/features/photos/components/sources/sources-overview'

const Photos = lazy(() => import('@/features/photos'))
// MapLibre and its worker are only fetched when the map is opened
const PhotosMap = lazy(() => import('@/features/photos/components/map'))

export const photosRoutes: RouteObject[] = [
	{
		path: 'photos',
		element: <Photos />,
		children: [
			// All (everything)
			{
				index: true,
				element: <PhotosListing />,
			},
			// Every source as a tile
			{
				path: 'sources',
				element: <SourcesOverview />,
			},
			// Every located photo on a map. Ahead of :section, which would take
			// 'map' for a section and show the timeline
			{
				path: 'map',
				element: <PhotosMap />,
			},
			// Sidebar sections (favorites, photos, videos, ...). All render the same
			// placeholder listing until each section gets its own view.
			{
				path: ':section',
				element: <PhotosListing />,
			},
			// One album, or one person: the timeline filtered to it. Locations is
			// cut from v1 — its route comes back with the backend:
			// {path: 'locations/:locationId', element: <PhotosListing />},
			{path: 'albums/:albumId', element: <PhotosListing />},
			{path: 'people/:personId', element: <PhotosListing />},
			// A single source (this Umbrel, a phone, a drive, a NAS)
			{
				path: 'source/:sourceId',
				element: <PhotosListing />,
			},
		],
	},
]
