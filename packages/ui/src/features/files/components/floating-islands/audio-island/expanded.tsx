import {Captions} from 'lucide-react'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {RiPauseFill, RiPlayFill} from 'react-icons/ri'

import {Button} from '@/components/ui/button'
import {MusicEqualizer} from '@/features/files/components/floating-islands/audio-island/equalizer'
import type {TranscriptLine} from '@/features/search/transcript'
import {TranscriptView} from '@/features/search/transcript-view'
import {cn} from '@/lib/utils'

interface ExpandedContentProps {
	fileName: string
	isPlaying: boolean
	currentTime: number
	duration: number
	authorizationFailed: boolean
	isRetryingAuthorization: boolean
	onRetryAuthorization: () => void
	onTogglePlay: (e?: React.MouseEvent) => void
	onProgressChange: (e: React.ChangeEvent<HTMLInputElement>) => void
	analyserNode?: AnalyserNode
	audio: HTMLAudioElement | null
	// What is said in the recording, where Search has transcribed it: shown
	// between the title and the controls (see TranscriptView) unless switched off
	transcript?: readonly TranscriptLine[]
	matched?: readonly string[]
	showTranscript: boolean
	onToggleTranscript: () => void
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
	authorizationFailed,
	isRetryingAuthorization,
	onRetryAuthorization,
	onTogglePlay,
	onProgressChange,
	analyserNode,
	audio,
	transcript,
	matched,
	showTranscript,
	onToggleTranscript,
}) => {
	const {t} = useTranslation()
	const following = transcript !== undefined && showTranscript
	const progressPercentage = duration ? (currentTime / duration) * 100 : 0
	if (authorizationFailed) {
		return (
			<div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
				<p className='text-13 text-white/60'>{t('files-audio-island.auth-error')}</p>
				<Button onClick={onRetryAuthorization} disabled={isRetryingAuthorization}>
					{isRetryingAuthorization ? t('loading') : t('try-again')}
				</Button>
			</div>
		)
	}

	return (
		<div className='flex h-full flex-col'>
			{/* With a transcript the title gives up the air under it to the lines */}
			<div className={cn('flex shrink-0 justify-between pt-10', following ? 'pb-2' : 'pb-6')}>
				<div className='my-auto ml-6 flex-1 overflow-hidden text-left'>
					<p className='mb-0 truncate text-sm text-white/60'>{t('files-audio-island.now-playing')}</p>
					<span className='text-md my-0 block truncate text-white/90'>{fileName}</span>
				</div>
				<div className='relative mt-2 mr-6'>
					<MusicEqualizer isPlaying={isPlaying} analyserNode={analyserNode} />
				</div>
			</div>

			{following && (
				<TranscriptView transcript={transcript} media={audio} matched={matched} variant='island' className='flex-1' />
			)}

			<div className={cn('mb-2 grid shrink-0 grid-cols-8 items-center gap-2 px-6', following && 'mt-2')}>
				<div className='text-left'>
					<p className='text-sm text-white/60'>{formatTime(currentTime)}</p>
				</div>

				<div className='col-span-6'>
					<div className='relative h-2 w-full overflow-hidden rounded-full bg-white/10'>
						<div
							className='absolute top-0 left-0 h-full rounded-full bg-brand'
							style={{width: `${progressPercentage}%`}}
						/>
						<input
							type='range'
							min={0}
							max={duration || 0}
							value={currentTime}
							onChange={onProgressChange}
							className='absolute top-0 left-0 h-full w-full opacity-0'
							style={{margin: 0}}
							aria-label={t('files-audio-island.now-playing')}
						/>
					</div>
				</div>

				<div className='text-right'>
					<p className='text-sm text-white/60'>{formatTime(duration)}</p>
				</div>
			</div>

			<div className='relative my-1 flex shrink-0 items-center justify-center'>
				<button
					onClick={onTogglePlay}
					className='flex items-center justify-center'
					aria-label={isPlaying ? t('files-audio-island.pause') : t('files-audio-island.play')}
				>
					{isPlaying ? <RiPauseFill className='h-5 w-5 text-white' /> : <RiPlayFill className='h-5 w-5 text-white' />}
				</button>
				{/* Only a recording with a transcript has the switch for it */}
				{transcript && (
					<button
						type='button'
						onClick={(event) => {
							event.stopPropagation()
							onToggleTranscript()
						}}
						aria-label={t('photos-item.transcript')}
						title={t('photos-item.transcript')}
						aria-pressed={showTranscript}
						className={cn(
							'absolute right-5 flex size-6 items-center justify-center rounded-full transition-colors',
							showTranscript ? 'bg-white/20 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white',
						)}
					>
						<Captions className='size-3.5' />
					</button>
				)}
			</div>
		</div>
	)
}
