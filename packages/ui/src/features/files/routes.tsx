import {lazy} from 'react'
import {Navigate, RouteObject} from 'react-router-dom'

import {ErrorBoundaryComponentFallback} from '@/components/ui/error-boundary-component-fallback'
import {AppsListing} from '@/features/files/components/listing/apps-listing'
import {DirectoryListing} from '@/features/files/components/listing/directory-listing'
import {RecentsListing} from '@/features/files/components/listing/recents-listing'
import {SearchListing} from '@/features/files/components/listing/search-listing'
import {TrashListing} from '@/features/files/components/listing/trash-listing'
import {BASE_ROUTE_PATH, HOME_PATH} from '@/features/files/constants'

const Files = lazy(() => import('@/features/files'))

export const filesRoutes: RouteObject[] = [
	{
		path: 'files',
		element: <Files />,
		ErrorBoundary: ErrorBoundaryComponentFallback,
		children: [
			// if the user navigates to /files, redirect to /files/<HOME_PATH>
			{
				index: true,
				element: <Navigate to={`${BASE_ROUTE_PATH}${HOME_PATH}`} replace />,
			},
			// "Recents" and not "Recents/*" because folders aren't tracked in the recents by the server
			{
				path: 'Recents',
				element: <RecentsListing />,
			},
			{
				// "Search" and not "Search/*" because folders aren't tracked in the search by the server
				path: 'Search',
				element: <SearchListing />,
			},
			{
				// "Apps" and not "Apps/*" because we want to allow uploads, new folders, etc. in "Apps/<app-data>/*""
				// which would instead be rendered by the DirectoryListing component
				path: 'Apps',
				element: <AppsListing />,
			},
			{
				// "Trash/*" and not "Trash" because we want to disable new folder, upload, etc.
				// in the entire Trash directory and its subdirectories
				path: 'Trash/*',
				element: <TrashListing />,
			},
			{
				path: '*',
				element: <DirectoryListing />,
			},
		],
	},
]
