// TODO: use a different library or build a custom component
// as it currently adds doc-level styles to the page (eg. primary button styles change)
import {Video as VideoPlayer} from '@triyanox/react-video'

import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'

interface VideoViewerProps {
	item: FileSystemItem
}

export default function VideoViewer({item}: VideoViewerProps) {
	const previewUrl = `/api/files/view?path=${encodeURIComponent(item.path)}`

	return (
		<ViewerWrapper dontCloseOnSpacebar>
			<div className='bg-black'>
				<VideoPlayer title={item.name} src={previewUrl} autoPlay={true} />
			</div>
		</ViewerWrapper>
	)
}
