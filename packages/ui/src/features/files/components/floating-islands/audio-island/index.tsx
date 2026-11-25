import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useWindowSize} from 'react-use'

import {ExpandedContent} from '@/features/files/components/floating-islands/audio-island/expanded'
import {MinimizedContent} from '@/features/files/components/floating-islands/audio-island/minimized'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {snippetTerms} from '@/features/search/snippet'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'
import {Island, IslandExpanded, IslandMinimized, type IslandSizes} from '@/modules/floating-island/bare-island'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact} from '@/trpc/trpc'

// The island as it is for any audio, and as it stands when the recording has
// a transcript to follow: the same pill, the same player, grown upwards by
// the height of a few lines
const PLAIN_SIZES: IslandSizes = {
	minimized: {width: 150, height: 40, borderRadius: 22},
	expanded: {width: 371, height: 180, borderRadius: 32},
}
const TRANSCRIPT_SIZES: IslandSizes = {...PLAIN_SIZES, expanded: {width: 371, height: 388, borderRadius: 32}}
// The window height below which an island that tall would crowd the screen
// (a phone held sideways): there it stays the plain player
const TRANSCRIPT_ROOM = 560

// Whether a recording's transcript is shown with it. On unless turned off:
// the words are why a recording found by search was opened, and nobody
// finds a view they have to switch on first. The choice is kept.
const TRANSCRIPT_KEY = 'files:audio-transcript'
function readShowTranscript() {
	try {
		return localStorage.getItem(TRANSCRIPT_KEY) !== 'off'
	} catch {
		return true
	}
}

interface PlayerState {
	isPlaying: boolean
	currentTime: number
	duration: number
}

// The actual island component that will be registered
export function AudioIsland() {
	const setViewerItem = useFilesStore((s) => s.setViewerItem)

	const {audio, setAudio} = useGlobalFiles()

	const {path, name, startSeconds, matched} = audio
	// What is said in it, when Search has transcribed it. Most audio has no
	// transcript, and Search may not be running at all: then this is simply
	// absent and the island is the one it always was.
	const {data: insights} = trpcReact.search.insights.useQuery(
		{path: path ?? ''},
		{enabled: Boolean(path), retry: false, refetchOnWindowFocus: false, staleTime: 60_000},
	)
	const roomy = useWindowSize().height >= TRANSCRIPT_ROOM
	const transcript =
		roomy && path && insights?.transcript && insights.transcript.length > 0 ? insights.transcript : undefined
	const matchedTerms = useMemo(() => snippetTerms(matched), [matched])
	const [showTranscript, setShowTranscript] = useState(readShowTranscript)
	const toggleTranscript = useCallback(() => {
		setShowTranscript((shown) => {
			try {
				localStorage.setItem(TRANSCRIPT_KEY, shown ? 'off' : 'on')
			} catch {
				// Not kept, then; it still applies to this session
			}
			return !shown
		})
	}, [])
	const [playerState, setPlayerState] = useState<PlayerState>({
		isPlaying: false,
		currentTime: 0,
		duration: 0,
	})

	const audioRef = useRef<HTMLAudioElement>(null)
	// … and as state, for what follows it from a render
	const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
	const audioContextRef = useRef<AudioContext | undefined>(undefined)
	const analyserNodeRef = useRef<AnalyserNode | undefined>(undefined)
	const sourceNodeRef = useRef<MediaElementAudioSourceNode | undefined>(undefined)
	const isInitializedRef = useRef(false)

	const downloadUrl = useAuthorizedHttpUrlQuery(
		path ? `/api/files/download?path=${encodeURIComponent(path)}` : undefined,
	)
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

	// Begin at the requested moment, once the duration is known. Keyed on the
	// audio state itself: picking the same recording at another moment seeks
	// the element already loaded.
	useEffect(() => {
		const element = audioRef.current
		if (!element || !startSeconds) return
		const seek = () => {
			element.currentTime = startSeconds
		}
		if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return seek()
		element.addEventListener('loadedmetadata', seek, {once: true})
		return () => element.removeEventListener('loadedmetadata', seek)
	}, [audio, startSeconds])

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
				<audio
					ref={(element) => {
						audioRef.current = element
						setAudioElement(element)
					}}
					src={downloadUrl.url}
					preload='auto'
				/>
			</div>
			<Island id='audio-island' onClose={onClose} sizes={transcript && showTranscript ? TRANSCRIPT_SIZES : PLAIN_SIZES}>
				<IslandMinimized>
					<MinimizedContent
						fileName={fileName}
						isPlaying={playerState.isPlaying}
						currentTime={playerState.currentTime}
						duration={playerState.duration}
						analyserNode={analyserNodeRef.current}
						authorizationFailed={downloadUrl.status === 'error'}
					/>
				</IslandMinimized>
				<IslandExpanded>
					<ExpandedContent
						fileName={fileName}
						isPlaying={playerState.isPlaying}
						currentTime={playerState.currentTime}
						duration={playerState.duration}
						authorizationFailed={downloadUrl.status === 'error'}
						isRetryingAuthorization={downloadUrl.isRetrying}
						onRetryAuthorization={downloadUrl.retry}
						onTogglePlay={handleTogglePlay}
						onProgressChange={handleProgress}
						analyserNode={analyserNodeRef.current}
						audio={audioElement}
						transcript={transcript}
						matched={matchedTerms}
						showTranscript={showTranscript}
						onToggleTranscript={toggleTranscript}
					/>
				</IslandExpanded>
			</Island>
		</>
	)
}
