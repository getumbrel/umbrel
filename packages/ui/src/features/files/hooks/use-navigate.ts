import {useLocation, useNavigate as useNavigateReactRouter} from 'react-router-dom'

import {
	APPS_PATH,
	BASE_ROUTE_PATH,
	EXTERNAL_STORAGE_PATH,
	HOME_PATH,
	MACHINES_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	SEARCH_PATH,
} from '@/features/files/constants'
import {useHomePath, useTrashPath} from '@/features/files/hooks/use-home-path'
import {useFilesCapabilities} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getFileViewer} from '@/features/files/utils/get-file-viewer'
import {isDirectoryANetworkShare} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {uiToVirtualPath, virtualToUiPath} from '@/features/files/utils/path-alias'

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
	const config = useFilesCapabilities()
	// Normalize path so '/Network/<host>/' === '/Network/<host>'.
	// This ensures network host-level detection works even if users add a trailing slash,
	// which we rely on to hide write UI when a NAS host is offline.
	const currentPathFromRouter = toFsPath(location.pathname).replace(/\/+$/, '') || '/'
	const uiPath = (config.currentPath ?? currentPathFromRouter) as string
	// Map UI → virtual for internal consumers
	const currentPath = uiToVirtualPath(uiPath, config.pathAliases)
	const setViewerItem = useFilesStore((state) => state.setViewerItem)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)

	const navigateToDirectory = (path: string) => {
		// clear any previous viewer item
		setViewerItem(null)

		// Map virtual → UI for outbound navigation
		const outUi = virtualToUiPath(path, config.pathAliases)

		if (config.onNavigate) {
			config.onNavigate(outUi)
		} else {
			navigate(`${BASE_ROUTE_PATH}${encodePathSegments(outUi)}`)
		}
	}

	// Show a file where it lives: its parent directory with the file selected,
	// without opening the viewer (e.g. "Show in Files" from Photos)
	const revealItem = (item: FileSystemItem) => {
		const lastSlash = item.path.lastIndexOf('/')
		const parentDirectory = lastSlash === 0 ? '' : item.path.slice(0, lastSlash)

		navigateToDirectory(parentDirectory)

		// TODO: This is a hack since we set selected items to []
		// on path change in packages/ui/src/features/files/index.tsx
		// so we wait 500ms for the path change to complete => setSelectedItems([])
		// to execute, and then set the selected item
		setTimeout(() => {
			setSelectedItems([item])
		}, 500)
	}

	const navigateToItem = (item: FileSystemItem) => {
		if (item.isDisconnected && isDirectoryANetworkShare(item.path)) return
		// if the item is a directory, navigate to it
		if (item.type === 'directory') {
			return navigateToDirectory(item.path)
		}

		// for files we navigate to their parent directory with the file selected
		// and trigger the viewer if a viewer is available
		revealItem(item)

		if (getFileViewer(item)) {
			// open viewer via global store (the Files feature will render the viewer
			// component once it sees `viewerItem` being set)
			setViewerItem(item)
		}
	}

	// The current account's home and trash roots (owner: /Home and /Trash,
	// member: /Users/<slug> and /Users/<slug>/Trash)
	const homePath = useHomePath()
	const trashPath = useTrashPath()
	const isBrowsingTrash = currentPath === trashPath || currentPath.startsWith(`${trashPath}/`)

	const isInHome = currentPath === homePath

	// Deliberately the owner's /Home only (not a member's home), this gates
	// owner-only features like Rewind that operate on the owner home snapshots
	const isBrowsingHome = currentPath.startsWith(HOME_PATH)

	const isBrowsingRecents = currentPath.startsWith(RECENTS_PATH)

	const isBrowsingApps = currentPath.startsWith(APPS_PATH)
	const isBrowsingMachines = currentPath.startsWith(MACHINES_PATH)

	const isBrowsingSearch = currentPath.startsWith(SEARCH_PATH)

	const isBrowsingExternalStorage = currentPath.startsWith(EXTERNAL_STORAGE_PATH)

	const isViewingExternalDrives = currentPath === EXTERNAL_STORAGE_PATH

	// Anywhere within /Network
	const isBrowsingNetworkStorage = currentPath.startsWith(NETWORK_STORAGE_PATH)

	// Is at /Network exactly (meaning we are viewing network devices if any)
	const isViewingNetworkDevices = currentPath === NETWORK_STORAGE_PATH

	// Is at /Network/<host> (meaning we are viewing network shares for that host)
	const isViewingNetworkShares =
		currentPath.startsWith(NETWORK_STORAGE_PATH + '/') && currentPath.split('/').length === 3

	// Backups root or any path under it
	const isBrowsingBackups = currentPath.startsWith('/Backups')

	return {
		navigateToDirectory,
		navigateToItem,
		revealItem,
		currentPath,
		// Expose the UI path for components that need UI-space comparisons (e.g., isActive)
		uiPath,
		isBrowsingTrash,
		isInHome,
		isBrowsingHome,
		isBrowsingRecents,
		isBrowsingApps,
		isBrowsingMachines,
		isBrowsingSearch,
		isBrowsingExternalStorage,
		isViewingExternalDrives,
		isBrowsingNetworkStorage,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		isBrowsingBackups,
	}
}
