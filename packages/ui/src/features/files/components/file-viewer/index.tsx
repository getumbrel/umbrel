import {Component, lazy, Suspense, type ErrorInfo, type ReactNode} from 'react'

import DownloadDialog from '@/features/files/components/file-viewer/downloader'
import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesStore} from '@/features/files/store/use-files-store'

const InfoCardViewer = lazy(() => import('@/features/files/components/file-viewer/info-card-viewer'))

// Error boundary that falls back to download dialog when a lazy-loaded viewer fails
class ViewerErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean}> {
	state = {hasError: false}

	static getDerivedStateFromError() {
		return {hasError: true}
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('Viewer failed to load:', error, errorInfo)
	}

	render() {
		if (this.state.hasError) {
			return <DownloadDialog />
		}
		return this.props.children
	}
}

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

	// render the viewer with error boundary fallback
	return (
		<ViewerErrorBoundary>
			<Suspense>
				<Viewer item={viewerItem} />
			</Suspense>
		</ViewerErrorBoundary>
	)
}
