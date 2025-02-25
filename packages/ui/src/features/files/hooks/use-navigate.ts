import {useLocation, useNavigate as useNavigateReactRouter} from 'react-router-dom'

import {
	APPS_PATH,
	BASE_ROUTE_PATH,
	EXTERNAL_STORAGE_PATH,
	HOME_PATH,
	RECENTS_PATH,
	TRASH_PATH,
} from '@/features/files/constants'

export function toFsPath(urlPath: string): string {
	return decodeURIComponent(urlPath).replace(BASE_ROUTE_PATH, '')
}

// Encode the URL path to handle special characters that can break URLs in the UI
export function encodePathSegments(fsPath: string): string {
	// We split by slashes and encode each segment individually
	return fsPath
		.split('/')
		.map((segment) => (segment ? encodeURIComponent(segment) : ''))
		.join('/')
}

export const useNavigate = () => {
	const navigate = useNavigateReactRouter()
	const location = useLocation()
	const currentPath = toFsPath(location.pathname)

	const navigateToDirectory = (path: string) => {
		navigate(`${BASE_ROUTE_PATH}${encodePathSegments(path)}`)
	}

	const isBrowsingTrash = currentPath.startsWith(TRASH_PATH)

	const isInHome = currentPath === HOME_PATH

	const isBrowsingRecents = currentPath.startsWith(RECENTS_PATH)

	const isBrowsingApps = currentPath.startsWith(APPS_PATH)

	const isBrowsingExternalStorage = currentPath.startsWith(EXTERNAL_STORAGE_PATH)

	return {
		navigateToDirectory,
		currentPath,
		isBrowsingTrash,
		isInHome,
		isBrowsingRecents,
		isBrowsingApps,
		isBrowsingExternalStorage,
	}
}
