// TODO: Investigate pre-existing issue where large video files fail to play in Safari.
import {Video} from 'react-video-kit'

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
				<Video.Root src={previewUrl} title={item.name} autoPlay hotkeys={{scope: 'global', enabled: true}}>
					<Video.Media />
					<Video.Backdrop />
					<Video.Header>
						<div className='rv-w-full rv-flex'>
							<Video.FullscreenToggle />
							<Video.PipToggle />
						</div>
						<div className='rv-w-full rv-flex rv-justify-end rv-items-center rv-h-fit'>
							<Video.Volume.Button />
							<Video.Volume.Slider />
						</div>
					</Video.Header>
					<Video.Center>
						<Video.SeekBack seconds={10} />
						<Video.PlayPause />
						<Video.SeekForward seconds={10} />
						<Video.Loading />
					</Video.Center>
					<Video.Footer>
						<Video.Title />
						<Video.Timeline />
						<div className='rv-flex rv-justify-between rv-w-full'>
							<Video.Time.Current />
							<Video.Time.Remaining negative />
						</div>
					</Video.Footer>
				</Video.Root>
			</div>
		</ViewerWrapper>
	)
}
