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
	USER_COPY_WINDOW_MS,
	writeLocalClipboard,
} from '@/features/machines/console-clipboard'
import {machineSocketUrl, reconnectDelay, SUPERSEDED_CLOSE_CODE} from '@/features/machines/console-socket'
import {useConsoleAgent} from '@/features/machines/hooks/use-console-agent'
import {useMachineAudio} from '@/features/machines/hooks/use-machine-audio'
import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import {createBrowserUuid} from '@/features/machines/utils'
import {cn} from '@/lib/utils'
import {useLaneStore} from '@/modules/floating-island/lane'
import {trpcClient} from '@/trpc/trpc'
import {isMac} from '@/utils/misc'

import {setConsoleAgentOwnership} from './console-agent-ownership'

const LAYOUT_SETTLE_DELAY_MS = 350
const CLIPBOARD_NOTICE_MS = 8_000
// Rechecked on console input, so an agent that starts with the guest is noticed
// by the time someone pastes
const CLIPBOARD_AGENT_CHECK_MS = 5_000
// Short pastes finish before a notice could be read
const TYPING_NOTICE_MIN_LENGTH = 40

type ConnectionState = 'connected' | 'disconnected' | 'superseded'
type ClipboardNotice = {kind: 'copied' | 'typing' | 'too-long'; text: string}

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
	// Floating islands rest over the screen's bottom edge, just above the dock,
	// so while any are up the status pills sit above them
	const islandsUp = useLaneStore((state) => state.islandCount > 0)
	const statusPillClass = cn(
		'absolute inset-x-0 flex justify-center transition-[bottom] duration-300 motion-reduce:transition-none',
		islandsUp ? 'bottom-14' : 'bottom-4',
	)
	const [sessionId, setSessionId] = useState(createBrowserUuid)
	const {muted} = useMachineAudioPreference(machineId)
	// This tab's console while noVNC is connected, and so holds the session
	// audio is streamed to
	const [liveConsole, setLiveConsole] = useState<RFB>()
	const {audioBlocked} = useMachineAudio({machineId, sessionId, live: !!liveConsole, muted, gestureTarget: root})
	const [clipboardNotice, setClipboardNotice] = useState<ClipboardNotice>()
	const typing = useRef<AbortController>(undefined)

	const {agentControl, arrivalToken, takenOver, takeOver, agentOwned} = useConsoleAgent(machineId)
	const rfbRef = useRef<RFB | undefined>(undefined)
	const agentOwnedRef = useRef(agentOwned)
	agentOwnedRef.current = agentOwned

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
						takeOver()
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
				<div className={cn(statusPillClass, 'px-4')}>
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
				<div className={cn(statusPillClass, 'pointer-events-none')}>
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
