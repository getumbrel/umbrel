import {lazy, Suspense} from 'react'

import DownloadDialog from '@/features/files/components/file-viewer/downloader'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'

const InfoCardViewer = lazy(() => import('@/features/files/components/file-viewer/info-card-viewer'))

export const FileViewer: React.FC = () => {
	const viewerItem = useFilesStore((s) => s.viewerItem)
	const viewerMode = useFilesStore((s) => s.viewerMode)

	if (!viewerItem || !viewerItem.type) return null

	const entry = FILE_TYPE_MAP[viewerItem.type as keyof typeof FILE_TYPE_MAP]
	const Viewer = entry?.viewer

	// If there's no dedicated viewer, show info card in preview mode or download dialog otherwise
	if (!Viewer) {
		if (viewerMode === 'preview') {
			return (
				<Suspense>
					<InfoCardViewer item={viewerItem} />
				</Suspense>
			)
		}
		return <DownloadDialog />
	}

	// render the viewer
	return (
		<Suspense>
			<Viewer item={viewerItem} />
		</Suspense>
	)
}
