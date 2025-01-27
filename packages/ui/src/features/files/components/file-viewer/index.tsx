import {Suspense} from 'react'

import DownloadDialog from '@/features/files/components/file-viewer/downloader'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'

export const FileViewer: React.FC = () => {
	const viewerItem = useFilesStore((s) => s.viewerItem)

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
