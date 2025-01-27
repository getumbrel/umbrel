import React from 'react'
import {RiPauseFill, RiPlayFill} from 'react-icons/ri'

import {MusicEqualizer} from '@/features/files/components/floating-islands/audio-island/equalizer'
import {t} from '@/utils/i18n'

interface ExpandedContentProps {
	fileName: string
	isPlaying: boolean
	currentTime: number
	duration: number
	onTogglePlay: (e?: React.MouseEvent) => void
	onProgressChange: (e: React.ChangeEvent<HTMLInputElement>) => void
	analyserNode?: AnalyserNode
}

const formatTime = (time: number) => {
	const minutes = Math.floor(time / 60)
	const seconds = Math.floor(time % 60)
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const ExpandedContent: React.FC<ExpandedContentProps> = ({
	fileName,
	isPlaying,
	currentTime,
	duration,
	onTogglePlay,
	onProgressChange,
	analyserNode,
}) => {
	const progressPercentage = duration ? (currentTime / duration) * 100 : 0

	return (
		<>
			<div className='flex justify-between py-6 pt-10'>
				<div className='my-auto ml-6 flex-1 overflow-hidden text-left'>
					<p className='mb-0 truncate text-sm text-white/60'>{t('files-audio-island.now-playing')}</p>
					<span className='text-md my-0 block truncate text-white/90'>{fileName}</span>
				</div>
				<div className='relative mr-6 mt-2'>
					<MusicEqualizer isPlaying={isPlaying} analyserNode={analyserNode} />
				</div>
			</div>

			<div className='mb-2 grid grid-cols-8 items-center gap-2 px-6'>
				<div className='text-left'>
					<p className='text-sm text-white/60'>{formatTime(currentTime)}</p>
				</div>

				<div className='col-span-6'>
					<div className='relative h-2 w-full overflow-hidden rounded-full bg-white/10'>
						<div
							className='absolute left-0 top-0 h-full rounded-full bg-brand'
							style={{width: `${progressPercentage}%`}}
						/>
						<input
							type='range'
							min={0}
							max={duration || 0}
							value={currentTime}
							onChange={onProgressChange}
							className='absolute left-0 top-0 h-full w-full cursor-pointer opacity-0'
							style={{margin: 0}}
							aria-label={t('files-audio-island.now-playing')}
						/>
					</div>
				</div>

				<div className='text-right'>
					<p className='text-sm text-white/60'>{formatTime(duration)}</p>
				</div>
			</div>

			<div className='my-1 flex items-center justify-center'>
				<button
					onClick={onTogglePlay}
					className='flex items-center justify-center'
					aria-label={isPlaying ? t('files-audio-island.pause') : t('files-audio-island.play')}
				>
					{isPlaying ? <RiPauseFill className='h-5 w-5 text-white' /> : <RiPlayFill className='h-5 w-5 text-white' />}
				</button>
			</div>
		</>
	)
}
