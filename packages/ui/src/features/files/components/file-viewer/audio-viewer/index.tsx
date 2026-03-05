import {useEffect} from 'react'

import {FileSystemItem} from '@/features/files/types'
import {useGlobalFiles} from '@/providers/global-files'

interface AudioViewerProps {
	item: FileSystemItem
}

export const AudioViewer: React.FC<AudioViewerProps> = ({item}) => {
	const {setAudio} = useGlobalFiles()

	// Set the audio file in the global files provider
	// so it can auto-render the audio player island
	// we don't need to clean up because the island has a close button
	// and should be persisted across route changes, different file previews, etc
	useEffect(() => {
		setAudio({
			path: item.path,
			name: item.name,
		})
	}, [item, setAudio])

	return null
}
