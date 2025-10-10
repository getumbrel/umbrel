// This is for the context menu "Restore previous version" action. It's distinct from `useRewind` which powers the internal Rewind overlay behavior

import {useNavigate} from 'react-router-dom'

import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import type {FileSystemItem} from '@/features/files/types'
import {useQueryParams} from '@/hooks/use-query-params'

export function useRewindAction(selectedItems: FileSystemItem[]) {
	const {isBrowsingHome, isBrowsingApps, isBrowsingRecents} = useFilesNavigate()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	const selectedCount = selectedItems.length
	const allUnderSupported = selectedItems.every((i) => i.path.startsWith('/Home') || i.path.startsWith('/Apps'))
	// We only show the action if we are browsing /Home or /Apps, or if we are browsing Recents and all selected items are under /Home or /Apps
	// Recents will be opened to the enclosing folder of the first selected item
	const canShowRewind =
		isBrowsingHome || isBrowsingApps || (isBrowsingRecents && selectedCount > 0 && allUnderSupported)

	const onClick = () => {
		const params: Record<string, string> = {rewind: 'open'}
		if (isBrowsingRecents && selectedCount > 0) {
			if (allUnderSupported) {
				const first = selectedItems[0]
				const lastSlash = first.path.lastIndexOf('/')
				const parentUi = lastSlash > 0 ? first.path.slice(0, lastSlash) : '/Home'
				params.rewindPath = parentUi
			}
		}
		navigate({search: addLinkSearchParams(params)})
	}

	return {canShowRewind, onClick}
}
