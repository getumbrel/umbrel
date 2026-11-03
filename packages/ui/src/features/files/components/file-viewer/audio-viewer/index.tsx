import {useEffect} from 'react'

import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useGlobalFiles} from '@/providers/global-files'

export const AudioViewer: React.FC<ViewerProps> = ({item, mode}) => {
	const {setAudio} = useGlobalFiles()

	// Set the audio file in the global files provider
	// so it can auto-render the audio player island.
	// An opened file isn't cleaned up: the island has a close button
	// and should be persisted across route changes, different file previews, etc.
	// A quick look plays only while it's the one looked at: closing it, or
	// stepping on to another file, ends it.
	useEffect(() => {
		setAudio({
			path: item.path,
			name: item.name,
		})
		if (mode === 'preview') return () => setAudio({path: null, name: null})
	}, [item, mode, setAudio])

	return null
}
