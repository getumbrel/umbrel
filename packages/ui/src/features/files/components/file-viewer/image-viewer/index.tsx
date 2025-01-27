import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'

interface ImageViewerProps {
	item: FileSystemItem
}

export default function ImageViewer({item}: ImageViewerProps) {
	const previewUrl = `/api/files/view?path=${encodeURIComponent(item.path)}`

	return (
		<ViewerWrapper>
			<img
				src={previewUrl}
				alt={item.name}
				className='absolute left-1/2 top-1/2 max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 object-contain md:max-h-[80%] md:max-w-[90%] md:rounded-lg'
			/>
		</ViewerWrapper>
	)
}
