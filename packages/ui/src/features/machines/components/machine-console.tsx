import RFB from '@novnc/novnc'
import {VolumeX} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {MachineAgentOverlay} from '@/features/machines/components/machine-agent-overlay'
import {
	clipboardShortcut,
	MAX_TYPED_PASTE_LENGTH,
	OMARCHY_PASTE_DELAY_MS,
	releaseShortcutModifiers,
	sendClipboardShortcut,
	sendDelayedPasteShortcut,
	typeIntoConsole,
	writeLocalClipboard,
} from '@/features/machines/console-clipboard'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import {useMachineAgentControls} from '@/features/machines/hooks/use-machines'
import {createMachineAudioSink, type MachineAudioSink} from '@/features/machines/machine-audio'
import {createBrowserUuid} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {trpcClient} from '@/trpc/trpc'
import {isMac} from '@/utils/misc'

import {setConsoleAgentOwnership} from './console-agent-ownership'

const SUPERSEDED_CLOSE_CODE = 4001
const LAYOUT_SETTLE_DELAY_MS = 350

// Dropped sockets retry after 1 s, doubling to half a minute, so a tab left open
// on a dead connection (a sleeping laptop, a restarted umbrelOS) stays quiet
const reconnectDelay = (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000)

// Browsers let a page write the clipboard only this soon after a keypress or
// click, and a guest copy that late wasn't the user's anyway
const USER_COPY_WINDOW_MS = 5_000
const CLIPBOARD_NOTICE_MS = 8_000
// Rechecked on console input, so an agent that starts with the guest is noticed
// by the time someone pastes
const CLIPBOARD_AGENT_CHECK_MS = 5_000
// Short pastes finish before a notice could be read
const TYPING_NOTICE_MIN_LENGTH = 40

type ConnectionState = 'connected' | 'disconnected' | 'superseded'
type ClipboardNotice = {kind: 'copied' | 'typing' | 'too-long'; text: string}

function machineSocketUrl(path: string, machineId: string, sessionId: string, ticket: string) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const port = window.location.port ? `:${window.location.port}` : ''
	return `${protocol}//${window.location.hostname}${port}${path}?machineId=${encodeURIComponent(machineId)}&sessionId=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(ticket)}`
}

export function MachineConsole({
	machineId,
	resizeSession,
	omarchy,
}: {
	machineId: string
	resizeSession: boolean
	omarchy?: boolean
}) {
	const root = useRef<HTMLDivElement>(null)
	const screen = useRef<HTMLDivElement>(null)
	const {t} = useTranslation()
	const [connectionState, setConnectionState] = useState<ConnectionState>('connected')
	const [sessionId, setSessionId] = useState(createBrowserUuid)
	const {muted} = useMachineAudioPreference(machineId)
	const [audioContext, setAudioContext] = useState<AudioContext | undefined>()
	const [audioBlocked, setAudioBlocked] = useState(false)
	// This tab's console while noVNC is connected, and so holds the session
	// audio is streamed to
	const [liveConsole, setLiveConsole] = useState<RFB>()
	const [clipboardNotice, setClipboardNotice] = useState<ClipboardNotice>()
	const typing = useRef<AbortController>(undefined)

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
		let attempt = 0
		let rfb: RFB | undefined
		let socket: WebSocket | undefined
		let rescaleTimer: ReturnType<typeof setTimeout> | undefined

		const reconnect = () => {
			setConnectionState('disconnected')
			clearTimeout(retry)
			retry = setTimeout(() => {
				retry = undefined
				void connect()
			}, reconnectDelay(attempt++))
		}
		// Returning to the tab or regaining the network is when a dropped console
		// is most likely to work again, so skip whatever backoff is left
		const reconnectNow = () => {
			if (disposed || !retry || document.visibilityState !== 'visible') return
			clearTimeout(retry)
			retry = undefined
			attempt = 0
			void connect()
		}

		const connect = async () => {
			if (disposed || !screen.current) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !screen.current) return
				screen.current.replaceChildren()
				const connectionSocket = new WebSocket(machineSocketUrl('/machines/console', machineId, sessionId, ticket), [
					'binary',
				])
				socket = connectionSocket
				let closeCode: number | undefined
				connectionSocket.addEventListener('close', (event) => {
					closeCode = event.code
				})
				const connectedRfb = new RFB(screen.current, connectionSocket, {shared: true})
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
					attempt = 0
					setConnectionState('connected')
					setLiveConsole(connectedRfb)
					// noVNC only forwards keyboard input while its canvas has DOM focus,
					// and by default nothing focuses it until the first click. Focus on
					// every (re)connect so an opened machine is immediately interactive.
					rfb?.focus()
				})
				connectedRfb.addEventListener('disconnect', () => {
					setLiveConsole((current) => (current === connectedRfb ? undefined : current))
					if (disposed) return
					if (rescaleTimer) clearTimeout(rescaleTimer)
					if (closeCode === SUPERSEDED_CLOSE_CODE) {
						setConnectionState('superseded')
						return
					}
					// noVNC reports every server-side close of a live session as clean,
					// network drops included, so anything but our own cleanup or a
					// takeover is a dropout to recover from. Close the socket in case the
					// handshake failed with it open: the next one would supersede it.
					connectionSocket.close()
					reconnect()
				})
			} catch {
				socket?.close()
				reconnect()
			}
		}

		const onVisibilityChange = () => reconnectNow()
		window.addEventListener('online', reconnectNow)
		document.addEventListener('visibilitychange', onVisibilityChange)
		void connect()
		return () => {
			disposed = true
			window.removeEventListener('online', reconnectNow)
			document.removeEventListener('visibilitychange', onVisibilityChange)
			clearTimeout(retry)
			if (rescaleTimer) clearTimeout(rescaleTimer)
			rfb?.disconnect()
			socket?.close()
			if (rfbRef.current === rfb) rfbRef.current = undefined
		}
	}, [machineId, resizeSession, sessionId])

	// Copy and paste between this computer and the guest, which QEMU's vdagent
	// carries to guests running spice-vdagent
	useEffect(() => {
		// The screen, not the whole console, so overlays keep their own shortcuts
		const element = screen.current
		const rfb = liveConsole
		if (!element || !rfb) return
		const mac = isMac()
		let lastInputAt = -Infinity
		let pastedText: string | undefined
		let pendingPaste: {event: KeyboardEvent; replayShortcut: () => void} | undefined
		let pasteFallback: ReturnType<typeof setTimeout> | undefined
		let delayedPaste: ReturnType<typeof setTimeout> | undefined
		let agentConnected: boolean | undefined
		let agentCheckedAt = -Infinity

		const checkClipboardAgent = () => {
			if (performance.now() - agentCheckedAt < CLIPBOARD_AGENT_CHECK_MS) return
			agentCheckedAt = performance.now()
			void trpcClient.machines.clipboardSharing
				.query({id: machineId})
				.then((connected) => (agentConnected = connected))
				.catch(() => {})
		}

		const typeText = (text: string) => {
			if (text.length > MAX_TYPED_PASTE_LENGTH) {
				setClipboardNotice({kind: 'too-long', text})
				return
			}
			typing.current?.abort()
			const controller = new AbortController()
			typing.current = controller
			if (text.length >= TYPING_NOTICE_MIN_LENGTH) setClipboardNotice({kind: 'typing', text})
			void typeIntoConsole(rfb, text, controller.signal).finally(() =>
				setClipboardNotice((current) => (current?.kind === 'typing' ? undefined : current)),
			)
		}

		const finishPaste = (text?: string) => {
			clearTimeout(pasteFallback)
			const paste = pendingPaste
			pendingPaste = undefined
			if (!paste) return
			// With no agent nothing in the guest can take the text, so type it instead
			// of forwarding a shortcut that would paste nothing
			if (text && agentConnected === false) {
				releaseShortcutModifiers(rfb, paste.event)
				typeText(text)
				return
			}
			if (text) {
				pastedText = text
				rfb.clipboardPasteFrom(text)
			}
			paste.replayShortcut()
		}

		const onPointerDown = () => {
			lastInputAt = performance.now()
			checkClipboardAgent()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			lastInputAt = performance.now()
			checkClipboardAgent()
			if (agentOwnedRef.current) return
			const shortcut = clipboardShortcut(event, {mac, omarchy})
			if (!shortcut) return
			// Keep noVNC from forwarding the key; it's replayed below
			event.stopImmediatePropagation()
			if (shortcut.action !== 'paste') {
				event.preventDefault()
				sendClipboardShortcut(rfb, event, shortcut)
				return
			}
			// Without noVNC's preventDefault the browser fires `paste` with the local
			// clipboard, readable even over plain HTTP. The guest gets the shortcut
			// once its clipboard holds that text, or anyway if no paste comes.
			pendingPaste = {
				event,
				replayShortcut: () => {
					if (omarchy) delayedPaste = setTimeout(() => sendDelayedPasteShortcut(rfb, event), OMARCHY_PASTE_DELAY_MS)
					else sendClipboardShortcut(rfb, event, shortcut)
				},
			}
			pasteFallback = setTimeout(() => finishPaste(), 100)
		}
		const onPaste = (event: ClipboardEvent) => {
			if (!pendingPaste) return
			event.preventDefault()
			finishPaste(event.clipboardData?.getData('text/plain'))
		}
		const onGuestCopy = (event: CustomEvent<{text: string}>) => {
			const {text} = event.detail
			// Guests announce their clipboard as the console connects and echo what
			// was pasted into them. Only a copy the user just made belongs here.
			if (text === pastedText || performance.now() - lastInputAt > USER_COPY_WINDOW_MS) return
			void writeLocalClipboard(text).then((copied) => !copied && setClipboardNotice({kind: 'copied', text}))
		}

		element.addEventListener('keydown', onKeyDown, true)
		element.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('paste', onPaste, true)
		rfb.addEventListener('clipboard', onGuestCopy)
		checkClipboardAgent()
		return () => {
			clearTimeout(pasteFallback)
			clearTimeout(delayedPaste)
			element.removeEventListener('keydown', onKeyDown, true)
			element.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('paste', onPaste, true)
			rfb.removeEventListener('clipboard', onGuestCopy)
			typing.current?.abort()
			setClipboardNotice(undefined)
		}
	}, [liveConsole, machineId, omarchy])

	useEffect(() => {
		if (!clipboardNotice || clipboardNotice.kind === 'typing') return
		const timer = setTimeout(() => setClipboardNotice(undefined), CLIPBOARD_NOTICE_MS)
		return () => clearTimeout(timer)
	}, [clipboardNotice])

	const onClipboardNoticeAction = (notice: ClipboardNotice) => {
		const rfb = liveConsole
		if (!rfb) return
		if (notice.kind === 'copied') void writeLocalClipboard(notice.text)
		else typing.current?.abort()
		setClipboardNotice(undefined)
		rfb.focus()
	}

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
		// umbreld only streams audio to the session that controls the console, so
		// audio follows this tab's live console: it waits for noVNC to connect,
		// and a dropped or superseded console takes its audio down with it.
		if (!context || !liveConsole) return
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
	}, [audioContext, liveConsole, machineId, sessionId])

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
			{clipboardNotice && connectionState === 'connected' && (
				<div className='absolute inset-x-0 bottom-4 flex justify-center px-4'>
					<div
						className={cn(
							'flex items-center gap-3 rounded-full bg-black/70 py-1 pl-3.5 text-12 text-white/60 backdrop-blur',
							clipboardNotice.kind === 'too-long' ? 'pr-3.5' : 'pr-1',
						)}
					>
						<span className='py-1'>{t(`machines.clipboard-${clipboardNotice.kind}`)}</span>
						{clipboardNotice.kind !== 'too-long' && (
							<button
								type='button'
								className='rounded-full bg-white/12 px-3 py-1 font-medium text-white transition-colors hover:bg-white/20'
								onClick={() => onClipboardNoticeAction(clipboardNotice)}
							>
								{t(`machines.clipboard-${clipboardNotice.kind}-action`)}
							</button>
						)}
					</div>
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
