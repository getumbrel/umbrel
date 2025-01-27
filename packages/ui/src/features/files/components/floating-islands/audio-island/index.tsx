import React, {useCallback, useEffect, useRef, useState} from 'react'

import {ExpandedContent} from '@/features/files/components/floating-islands/audio-island/expanded'
import {MinimizedContent} from '@/features/files/components/floating-islands/audio-island/minimized'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {useGlobalFiles} from '@/providers/global-files'

interface PlayerState {
	isPlaying: boolean
	currentTime: number
	duration: number
}

// The actual island component that will be registered
export function AudioIsland() {
	const setViewerItem = useFilesStore((s) => s.setViewerItem)

	const {audio, setAudio} = useGlobalFiles()

	const {path, name} = audio
	const [playerState, setPlayerState] = useState<PlayerState>({
		isPlaying: false,
		currentTime: 0,
		duration: 0,
	})

	const audioRef = useRef<HTMLAudioElement>(null)
	const audioContextRef = useRef<AudioContext>()
	const analyserNodeRef = useRef<AnalyserNode>()
	const sourceNodeRef = useRef<MediaElementAudioSourceNode>()
	const isInitializedRef = useRef(false)

	const downloadUrl = `/api/files/download?path=${encodeURIComponent(path || '')}`
	const fileName = name ? name.split('.').slice(0, -1).join('.') : ''

	// Memoized state update to reduce re-renders
	const updatePlayerState = useCallback((updates: Partial<PlayerState>) => {
		setPlayerState((prev: PlayerState) => ({...prev, ...updates}))
	}, [])

	// Initialize Web Audio API with proper cleanup
	const initAudioContext = useCallback(async () => {
		if (isInitializedRef.current) return
		const audio = audioRef.current
		if (!audio) return

		try {
			if (audioContextRef.current?.state !== 'closed') {
				await audioContextRef.current?.close()
			}

			audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
			const context = audioContextRef.current

			analyserNodeRef.current = context.createAnalyser()
			analyserNodeRef.current.fftSize = 2048

			sourceNodeRef.current = context.createMediaElementSource(audio)
			sourceNodeRef.current.connect(analyserNodeRef.current)
			analyserNodeRef.current.connect(context.destination)

			isInitializedRef.current = true
		} catch (error) {
			console.error('Failed to initialize audio context:', error)
		}
	}, [])

	// Auto-play setup with error handling
	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		const playAudio = async () => {
			try {
				await audio.play()
				updatePlayerState({isPlaying: true})
			} catch (error) {
				console.warn('Auto-play failed:', error)
				updatePlayerState({isPlaying: false})
			}
		}

		const handleLoadedData = () => {
			playAudio()
		}

		audio.addEventListener('loadeddata', handleLoadedData)
		return () => audio.removeEventListener('loadeddata', handleLoadedData)
	}, [updatePlayerState])

	// Initialize Web Audio API
	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		const handleCanPlay = () => {
			if (audioContextRef.current?.state === 'suspended') {
				audioContextRef.current.resume()
			}
			initAudioContext()
		}

		audio.addEventListener('canplay', handleCanPlay)

		return () => {
			audio.removeEventListener('canplay', handleCanPlay)
			const cleanup = async () => {
				if (sourceNodeRef.current) {
					sourceNodeRef.current.disconnect()
				}
				if (analyserNodeRef.current) {
					analyserNodeRef.current.disconnect()
				}
				if (audioContextRef.current?.state !== 'closed') {
					await audioContextRef.current?.close()
				}
				isInitializedRef.current = false
			}
			cleanup()
		}
	}, [initAudioContext])

	const handleTogglePlay = useCallback(
		(e?: React.MouseEvent) => {
			e?.stopPropagation()
			const audio = audioRef.current
			if (!audio) return

			if (audio.paused) {
				audio
					.play()
					.then(() => updatePlayerState({isPlaying: true}))
					.catch((error) => {
						console.error('Failed to play audio:', error)
						updatePlayerState({isPlaying: false})
					})
			} else {
				audio.pause()
				updatePlayerState({isPlaying: false})
			}
		},
		[updatePlayerState],
	)

	const handleProgress = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const audio = audioRef.current
			if (!audio) return

			const time = parseFloat(e.target.value)
			audio.currentTime = time
			updatePlayerState({currentTime: time})
		},
		[updatePlayerState],
	)

	// Handle audio time updates and events with debounced updates
	useEffect(() => {
		const audio = audioRef.current
		if (!audio) return

		let timeUpdateTimeout: number

		const handleTimeUpdate = () => {
			window.clearTimeout(timeUpdateTimeout)
			timeUpdateTimeout = window.setTimeout(() => {
				updatePlayerState({
					currentTime: audio.currentTime,
					duration: audio.duration,
				})
			}, 100)
		}

		const handleEnded = () => {
			updatePlayerState({isPlaying: false})
			audio.currentTime = 0
		}

		const handlePause = () => {
			updatePlayerState({isPlaying: false})
		}

		const handlePlay = () => {
			updatePlayerState({isPlaying: true})
		}

		audio.addEventListener('timeupdate', handleTimeUpdate)
		audio.addEventListener('loadedmetadata', handleTimeUpdate)
		audio.addEventListener('ended', handleEnded)
		audio.addEventListener('pause', handlePause)
		audio.addEventListener('play', handlePlay)

		return () => {
			window.clearTimeout(timeUpdateTimeout)
			audio.removeEventListener('timeupdate', handleTimeUpdate)
			audio.removeEventListener('loadedmetadata', handleTimeUpdate)
			audio.removeEventListener('ended', handleEnded)
			audio.removeEventListener('pause', handlePause)
			audio.removeEventListener('play', handlePlay)
		}
	}, [updatePlayerState])

	const onClose = () => {
		setViewerItem(null)
		setAudio({
			path: null,
			name: null,
		})
	}

	return (
		<>
			<div className='invisible absolute z-[-1]'>
				<audio ref={audioRef} src={downloadUrl} preload='auto' />
			</div>
			<Island id='audio-island' onClose={onClose}>
				<IslandMinimized>
					<MinimizedContent
						fileName={fileName}
						isPlaying={playerState.isPlaying}
						currentTime={playerState.currentTime}
						duration={playerState.duration}
						analyserNode={analyserNodeRef.current}
					/>
				</IslandMinimized>
				<IslandExpanded>
					<ExpandedContent
						fileName={fileName}
						isPlaying={playerState.isPlaying}
						currentTime={playerState.currentTime}
						duration={playerState.duration}
						onTogglePlay={handleTogglePlay}
						onProgressChange={handleProgress}
						analyserNode={analyserNodeRef.current}
					/>
				</IslandExpanded>
			</Island>
		</>
	)
}
