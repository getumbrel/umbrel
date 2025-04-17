import {Suspense, useEffect} from 'react'

import DownloadDialog from '@/features/files/components/file-viewer/downloader'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'

export const FileViewer: React.FC = () => {
	const viewerItem = useFilesStore((s) => s.viewerItem)
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)

	const {currentPath} = useNavigate()
	const {listing} = useListDirectory(currentPath)
	const isTouchDevice = useIsTouchDevice()

	// Helper to get previewable items
	const getPreviewableItems = () => {
		if (!listing) return []
		return listing.items.filter((file) => {
			if (typeof file.type !== 'string') return false
			const isSupported =
				file.type.startsWith('image/') || file.type.startsWith('video/') || file.type === 'application/pdf'
			if (!isSupported) return false
			const entry = FILE_TYPE_MAP[file.type as keyof typeof FILE_TYPE_MAP]
			return Boolean(entry && entry.viewer)
		})
	}

	// Arrow key navigation
	useEffect(() => {
		if (isTouchDevice) return
		const handleKeys = (e: KeyboardEvent) => {
			const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
			const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown'
			if (!isPrev && !isNext) return
			if (!viewerItem) return

			const previewable = getPreviewableItems()
			if (previewable.length === 0) return
			const previewItemIndex = previewable.findIndex((f) => f.path === viewerItem.path)
			if (previewItemIndex === -1) return
			let nextItemIndex = previewItemIndex
			if (isPrev) {
				nextItemIndex = previewItemIndex > 0 ? previewItemIndex - 1 : previewable.length - 1
			} else if (isNext) {
				nextItemIndex = previewItemIndex < previewable.length - 1 ? previewItemIndex + 1 : 0
			}
			e.preventDefault()
			if (nextItemIndex !== previewItemIndex) {
				const nextItem = previewable[nextItemIndex]
				setViewerItem(nextItem)
				setSelectedItems([nextItem])
			}
		}
		window.addEventListener('keydown', handleKeys)
		return () => window.removeEventListener('keydown', handleKeys)
	}, [viewerItem, listing, isTouchDevice])

	if (!viewerItem || !viewerItem.type) return null

	// if there's no matching file type in the map, return download dialog
	if (!FILE_TYPE_MAP[viewerItem.type as keyof typeof FILE_TYPE_MAP]) return <DownloadDialog />

	const Viewer = FILE_TYPE_MAP[viewerItem.type as keyof typeof FILE_TYPE_MAP].viewer

	// if there's no viewer for the file type, return download dialog
	if (!Viewer) return <DownloadDialog />

	// render the viewer
	return (
		<Suspense>
			<Viewer item={viewerItem} />
		</Suspense>
	)
}
