import {useEffect, useState, type RefObject} from 'react'

import {machineSocketUrl, reconnectDelay, SUPERSEDED_CLOSE_CODE} from '@/features/machines/console-socket'
import {createMachineAudioSink, type MachineAudioSink} from '@/features/machines/machine-audio'
import {trpcClient} from '@/trpc/trpc'

// A touch only counts as a gesture to Safari once it lifts
const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const

// Plays a machine's audio while this tab holds its console. `gestureTarget` is
// the console, whose first touch or keypress is what unlocks audio.
export function useMachineAudio({
	machineId,
	sessionId,
	live,
	muted,
	gestureTarget,
}: {
	machineId: string
	sessionId: string
	live: boolean
	muted: boolean
	gestureTarget: RefObject<HTMLElement | null>
}) {
	const [audioContext, setAudioContext] = useState<AudioContext | undefined>()
	const [audioBlocked, setAudioBlocked] = useState(false)

	useEffect(() => {
		if (muted) {
			setAudioBlocked(false)
			return
		}
		let context: AudioContext
		try {
			// Construct eagerly so Chromium can reuse document-level sticky user
			// activation from opening the machine window. A cold-loaded console will
			// remain suspended until the genuine gesture handler below resumes it.
			context = new AudioContext({sampleRate: 48_000})
		} catch {
			return
		}
		const syncState = () => setAudioBlocked(context.state !== 'running')
		context.addEventListener('statechange', syncState)
		setAudioContext(context)
		syncState()
		void context.resume().then(syncState).catch(syncState)
		return () => {
			context.removeEventListener('statechange', syncState)
			setAudioContext((current) => (current === context ? undefined : current))
			void context.close()
		}
	}, [muted])

	useEffect(() => {
		const element = gestureTarget.current
		if (!element || !audioContext || audioContext.state === 'running') return

		// Browsers require user activation before audible Web Audio playback.
		// Chromium usually honors the earlier click that opened this SPA view,
		// while Safari requires resume() inside a real pointer/key handler. Keep
		// this capture listener tied directly to the console gesture; moving the
		// resume into a plain effect would silently break Safari cold loads.
		const stopListening = () => {
			for (const gesture of GESTURES) element.removeEventListener(gesture, resume, true)
		}
		const resume = () => {
			void audioContext
				.resume()
				.then(() => {
					if (audioContext.state === 'running') stopListening()
				})
				.catch(() => {})
		}
		for (const gesture of GESTURES) element.addEventListener(gesture, resume, {capture: true})
		return stopListening
	}, [audioContext, gestureTarget])

	useEffect(() => {
		const context = audioContext
		// umbreld only streams audio to the session that controls the console, so
		// audio follows this tab's live console: it waits for noVNC to connect,
		// and a dropped or superseded console takes its audio down with it.
		if (!context || !live) return
		let disposed = false
		let sink: MachineAudioSink | undefined
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let attempt = 0

		const reconnect = () => {
			if (disposed) return
			retry = setTimeout(() => void connect(), reconnectDelay(attempt++))
		}

		const connect = async () => {
			if (disposed || !sink) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !sink) return
				socket = new WebSocket(machineSocketUrl('/machines/audio', machineId, sessionId, ticket))
				socket.binaryType = 'arraybuffer'
				socket.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
					attempt = 0
					if (event.data instanceof ArrayBuffer) sink?.enqueue(event.data)
				})
				socket.addEventListener('close', (event) => {
					// Superseded means another console owns audio now; this tab's next
					// console reconnect opens a fresh stream
					if (event.code !== SUPERSEDED_CLOSE_CODE) reconnect()
				})
			} catch {
				reconnect()
			}
		}

		void createMachineAudioSink(context)
			.then((createdSink) => {
				if (disposed) {
					createdSink.disconnect()
					return
				}
				sink = createdSink
				void connect()
			})
			.catch(() => {
				setAudioContext((current) => (current === context ? undefined : current))
				void context.close()
			})

		return () => {
			disposed = true
			clearTimeout(retry)
			socket?.close()
			sink?.disconnect()
		}
	}, [audioContext, live, machineId, sessionId])

	return {audioBlocked}
}
