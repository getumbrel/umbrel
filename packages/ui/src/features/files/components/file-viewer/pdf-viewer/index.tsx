import {useEffect, useState} from 'react'

import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'
import {useIsMobile} from '@/hooks/use-is-mobile'

interface PdfViewerProps {
	item: FileSystemItem
}

export default function PdfViewer({item}: PdfViewerProps) {
	const [dimensions, setDimensions] = useState({width: 0, height: 0})
	const encodedPath = encodeURIComponent(item.path)
	const downloadUrl = `/api/files/download?path=${encodedPath}`
	const previewUrl = `/api/files/view?path=${encodedPath}`
	const isMobile = useIsMobile()

	useEffect(() => {
		if (isMobile) {
			// redirect to download page in a new tab
			window.open(downloadUrl, '_blank')
			return
		}

		const updateDimensions = () => {
			const width = window.innerWidth - 300
			const height = window.innerHeight - 200

			if (width > 1024) {
				setDimensions({width: 1024, height: 800})
			} else {
				setDimensions({width, height})
			}
		}
		updateDimensions()
		window.addEventListener('resize', updateDimensions)

		return () => window.removeEventListener('resize', updateDimensions)
	}, [])

	return (
		<ViewerWrapper>
			<iframe
				src={previewUrl}
				height='100%'
				width='100%'
				style={{
					width: `${dimensions.width}px`,
					height: `${dimensions.height}px`,
				}}
				className='mx-auto block rounded-lg border-none'
				title={item.name}
			/>
		</ViewerWrapper>
	)
}
