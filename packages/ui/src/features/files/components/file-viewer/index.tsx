import {useEffect, useState, useSyncExternalStore} from 'react'

import {QuickLook} from '@/features/files/components/file-viewer/shell/quick-look'
import {ViewerShell} from '@/features/files/components/file-viewer/shell/viewer-shell'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {getFileViewer} from '@/features/files/utils/get-file-viewer'

// Files and the Files embedded in Rewind each mount a viewer host, both
// reading the same store. The viewer is a window-wide dialog, so only the
// host mounted last — the one on top — draws it.
const hosts: symbol[] = []
const hostListeners = new Set<() => void>()
const subscribeHosts = (listener: () => void) => {
	hostListeners.add(listener)
	return () => hostListeners.delete(listener)
}
function useIsTopViewerHost() {
	const [host] = useState(() => Symbol('viewer host'))
	useEffect(() => {
		hosts.push(host)
		hostListeners.forEach((listener) => listener())
		return () => {
			hosts.splice(hosts.indexOf(host), 1)
			hostListeners.forEach((listener) => listener())
		}
	}, [host])
	return useSyncExternalStore(subscribeHosts, () => hosts.at(-1) === host)
}

export function FileViewer() {
	const isTopHost = useIsTopViewerHost()
	const viewerItem = useFilesStore((s) => s.viewerItem)
	const viewerMode = useFilesStore((s) => s.viewerMode)
	const selectedItems = useFilesStore((s) => s.selectedItems)

	// Warm up the viewer for whatever is selected, so opening it doesn't wait on its code
	useEffect(() => {
		if (selectedItems.length === 1)
			void getFileViewer(selectedItems[0])
				?.preload()
				.catch(() => {})
	}, [selectedItems])

	if (!isTopHost || !viewerItem?.type || !viewerMode) return null

	const viewer = getFileViewer(viewerItem)
	// Audio plays in its floating island, over whatever comes next
	if (viewer?.island) return <viewer.Component item={viewerItem} mode={viewerMode} />
	// A quick look is a glance over the listing; an opened file has the window
	if (viewerMode === 'preview') return <QuickLook item={viewerItem} viewer={viewer} />
	return <ViewerShell item={viewerItem} viewer={viewer} />
}
