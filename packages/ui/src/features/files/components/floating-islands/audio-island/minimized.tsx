import React from 'react'
import {RiPauseFill, RiPlayFill} from 'react-icons/ri'

import {MusicEqualizer} from '@/features/files/components/floating-islands/audio-island/equalizer'
import {CircularProgress} from '@/features/files/components/shared/circular-progress'

interface MinimizedContentProps {
	fileName: string
	isPlaying: boolean
	currentTime: number
	duration: number
	analyserNode?: AnalyserNode
}

export const MinimizedContent: React.FC<MinimizedContentProps> = ({
	fileName,
	isPlaying,
	currentTime,
	duration,
	analyserNode,
}) => {
	const progress = duration ? (currentTime / duration) * 100 : 0

	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={progress} size={20}>
				{isPlaying ? <RiPauseFill className='h-3 w-3' /> : <RiPlayFill className='ml-0.5 h-3 w-3' />}
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-xs text-white/90'>{fileName}</span>
			</div>
			<MusicEqualizer isPlaying={isPlaying} analyserNode={analyserNode} />
		</div>
	)
}
