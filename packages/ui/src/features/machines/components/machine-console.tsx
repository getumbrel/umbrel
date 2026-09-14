import RFB from '@novnc/novnc'
import {VolumeX} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {MachineAgentOverlay} from '@/features/machines/components/machine-agent-overlay'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import {useMachineAgentControls} from '@/features/machines/hooks/use-machines'
import {createMachineAudioSink, type MachineAudioSink} from '@/features/machines/machine-audio'
import {createBrowserUuid} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {trpcClient} from '@/trpc/trpc'

import {setConsoleAgentOwnership} from './console-agent-ownership'

const SUPERSEDED_CLOSE_CODE = 4001
const LAYOUT_SETTLE_DELAY_MS = 350

type ConnectionState = 'connected' | 'disconnected' | 'superseded'

function machineSocketUrl(path: string, machineId: string, sessionId: string, ticket: string) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const port = window.location.port ? `:${window.location.port}` : ''
	return `${protocol}//${window.location.hostname}${port}${path}?machineId=${encodeURIComponent(machineId)}&sessionId=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(ticket)}`
}

export function MachineConsole({machineId, resizeSession}: {machineId: string; resizeSession: boolean}) {
	const root = useRef<HTMLDivElement>(null)
	const screen = useRef<HTMLDivElement>(null)
	const {t} = useTranslation()
	const [connectionState, setConnectionState] = useState<ConnectionState>('connected')
	const [sessionId, setSessionId] = useState(createBrowserUuid)
	const {muted} = useMachineAudioPreference(machineId)
	const [audioContext, setAudioContext] = useState<AudioContext | undefined>()
	const [audioBlocked, setAudioBlocked] = useState(false)

	const [arrivalToken, setArrivalToken] = useState<string>()
	const agentControl = useMachineAgentControls({
		onArrival: (id, token) => {
			if (id === machineId) setArrivalToken(token)
		},
	})[machineId]
	const [takenOver, setTakenOver] = useState(false)
	const agentOwned = !!agentControl && !takenOver
	const rfbRef = useRef<RFB | undefined>(undefined)
	const agentOwnedRef = useRef(agentOwned)
	agentOwnedRef.current = agentOwned

	// A take-over lasts for the agent's turn; the next agent starts watched again
	useEffect(() => {
		if (agentControl) return
		setArrivalToken(undefined)
		setTakenOver(false)
	}, [agentControl])

	useEffect(() => {
		if (rfbRef.current) setConsoleAgentOwnership(rfbRef.current, agentOwned)
	}, [agentOwned])

	useEffect(() => {
		if (!screen.current) return
		let disposed = false
		let retry: ReturnType<typeof setTimeout> | undefined
		let rfb: RFB | undefined
		let socket: WebSocket | undefined
		let closeCode: number | undefined
		let rescaleTimer: ReturnType<typeof setTimeout> | undefined

		const connect = async () => {
			if (disposed || !screen.current) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !screen.current) return
				screen.current.replaceChildren()
				closeCode = undefined
				socket = new WebSocket(machineSocketUrl('/machines/console', machineId, sessionId, ticket), ['binary'])
				socket.addEventListener('close', (event) => {
					closeCode = event.code
				})
				const connectedRfb = new RFB(screen.current, socket, {shared: true})
				rfb = connectedRfb
				rfbRef.current = connectedRfb
				setConsoleAgentOwnership(connectedRfb, agentOwnedRef.current)
				connectedRfb.scaleViewport = true
				connectedRfb.resizeSession = false
				connectedRfb.background = '#000'
				// Motion transforms do not trigger noVNC's ResizeObserver. Reassigning
				// this property makes noVNC remeasure once the Machines morph settles;
				// graphical guests can then start following the settled browser size.
				rescaleTimer = setTimeout(() => {
					if (disposed || rfb !== connectedRfb) return
					connectedRfb.scaleViewport = true
					connectedRfb.resizeSession = resizeSession
				}, LAYOUT_SETTLE_DELAY_MS)
				connectedRfb.addEventListener('connect', () => {
					setConnectionState('connected')
					// noVNC only forwards keyboard input while its canvas has DOM focus,
					// and by default nothing focuses it until the first click. Focus on
					// every (re)connect so an opened machine is immediately interactive.
					rfb?.focus()
				})
				connectedRfb.addEventListener('disconnect', (event: CustomEvent<{clean: boolean}>) => {
					if (disposed) return
					if (rescaleTimer) clearTimeout(rescaleTimer)
					if (closeCode === SUPERSEDED_CLOSE_CODE) {
						setConnectionState('superseded')
						return
					}
					if (event.detail.clean) return
					setConnectionState('disconnected')
					retry = setTimeout(() => void connect(), 1_000)
				})
			} catch {
				setConnectionState('disconnected')
				retry = setTimeout(() => void connect(), 1_000)
			}
		}

		void connect()
		return () => {
			disposed = true
			if (retry) clearTimeout(retry)
			if (rescaleTimer) clearTimeout(rescaleTimer)
			rfb?.disconnect()
			socket?.close()
			if (rfbRef.current === rfb) rfbRef.current = undefined
		}
	}, [machineId, resizeSession, sessionId])

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
		const element = root.current
		if (!element || !audioContext || audioContext.state === 'running') return

		// Browsers require user activation before audible Web Audio playback.
		// Chromium usually honors the earlier click that opened this SPA view,
		// while Safari requires resume() inside a real pointer/key handler. Keep
		// this capture listener tied directly to the console gesture; moving the
		// resume into a plain effect would silently break Safari cold loads.
		const resume = () => {
			element.removeEventListener('pointerdown', resume, true)
			element.removeEventListener('keydown', resume, true)
			void audioContext.resume()
		}
		element.addEventListener('pointerdown', resume, {capture: true})
		element.addEventListener('keydown', resume, {capture: true})
		return () => {
			element.removeEventListener('pointerdown', resume, true)
			element.removeEventListener('keydown', resume, true)
		}
	}, [audioContext])

	useEffect(() => {
		const context = audioContext
		if (!context) return
		let disposed = false
		let sink: MachineAudioSink | undefined
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined

		const connect = async () => {
			if (disposed || !sink) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !sink) return
				socket = new WebSocket(machineSocketUrl('/machines/audio', machineId, sessionId, ticket))
				socket.binaryType = 'arraybuffer'
				socket.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
					if (event.data instanceof ArrayBuffer) sink?.enqueue(event.data)
				})
				socket.addEventListener('close', (event) => {
					if (!disposed && event.code !== SUPERSEDED_CLOSE_CODE) {
						retry = setTimeout(() => void connect(), 1_000)
					}
				})
			} catch {
				if (!disposed) retry = setTimeout(() => void connect(), 1_000)
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
			if (retry) clearTimeout(retry)
			socket?.close()
			sink?.disconnect()
		}
	}, [audioContext, machineId, sessionId])

	return (
		<div
			ref={root}
			className={cn(
				'absolute inset-0 flex items-center justify-center overflow-hidden bg-black',
				agentOwned && 'cursor-none [&_canvas]:cursor-none!',
			)}
		>
			{/* noVNC owns the canvas; scaleViewport keeps the complete framebuffer visible. */}
			<div ref={screen} className='size-full shrink-0 overflow-hidden [&_canvas]:mx-auto [&_canvas]:block' />
			{agentControl && (
				<MachineAgentOverlay
					machineId={machineId}
					animateArrival={arrivalToken === agentControl.agent.tokenId}
					key={agentControl.agent.tokenId}
					agentControl={agentControl}
					takenOver={takenOver}
					root={root}
					screen={screen}
					onTakeOver={() => {
						setTakenOver(true)
						rfbRef.current?.focus()
					}}
				/>
			)}

			{!muted && audioBlocked && (
				<div className='pointer-events-none absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full bg-black/55 text-white/55 backdrop-blur'>
					<VolumeX className='size-3.5' />
				</div>
			)}
			{connectionState === 'disconnected' && (
				<div className='pointer-events-none absolute inset-x-0 bottom-4 flex justify-center'>
					<span className='rounded-full bg-black/70 px-3 py-1.5 text-12 text-white/60 backdrop-blur'>
						{t('machines.console-disconnected')}
					</span>
				</div>
			)}
			{connectionState === 'superseded' && (
				<div className='absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm'>
					<div className='flex max-w-sm flex-col items-center gap-4 px-6 text-center text-white'>
						<p className='text-15 font-medium'>{t('machines.console-controlled-elsewhere')}</p>
						<button
							type='button'
							className='rounded-full bg-white px-4 py-2 text-13 font-medium text-black transition-opacity hover:opacity-80'
							onClick={() => setSessionId(createBrowserUuid())}
						>
							{t('machines.console-take-over')}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
