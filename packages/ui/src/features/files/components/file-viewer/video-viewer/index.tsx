// TODO: use a different library or build a custom component
// as it currently adds doc-level styles to the page (eg. primary button styles change)
// also lacks built-in keyboard controls for spacebar play/pause, so we polyfill manually below.
import {Video as VideoPlayer} from '@triyanox/react-video'
import {useEffect, useRef} from 'react'

import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'

interface VideoViewerProps {
	item: FileSystemItem
}

export default function VideoViewer({item}: VideoViewerProps) {
	const previewUrl = `/api/files/view?path=${encodeURIComponent(item.path)}`

	// wrapperRef used to find the underlying <video> element inside VideoPlayer
	const wrapperRef = useRef<HTMLDivElement>(null)

	// Listen globally for spacebar to toggle video playback,
	// because @triyanox/react-video has no built-in spacebar play/pause support.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.code === 'Space') {
				e.preventDefault()
				const videoEl = wrapperRef.current?.querySelector('video')
				if (videoEl) {
					if (videoEl.paused) videoEl.play()
					else videoEl.pause()
				}
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [])

	return (
		<ViewerWrapper dontCloseOnSpacebar>
			<div className='bg-black' ref={wrapperRef}>
				<VideoPlayer title={item.name} src={previewUrl} autoPlay={true} />
			</div>
		</ViewerWrapper>
	)
}
