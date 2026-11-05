import RFB from '@novnc/novnc'
import {useEffect, useRef} from 'react'

import {OMARCHY_PASTE_DELAY_MS, USER_COPY_WINDOW_MS} from '@/features/machines/console-clipboard'
import {machineSocketUrl, reconnectDelay, SUPERSEDED_CLOSE_CODE} from '@/features/machines/console-socket'
import {createBrowserUuid} from '@/features/machines/utils'
import {trpcClient} from '@/trpc/trpc'

import type {CursorShape, Guest, GuestFamily, GuestStatus} from './guest'
import {keysymChar, XK} from './keysyms'

const WHEEL_UP = 0x8
const WHEEL_DOWN = 0x10
const WHEEL_LEFT = 0x20
const WHEEL_RIGHT = 0x40
// Guest pixels of finger travel for one wheel notch: three lines on most desktops
const WHEEL_STEP = 44

// How soon after a keypress a small screen update counts as the caret moving
const CARET_WINDOW_MS = 320
const CARET_SETTLE_MS = 40
const CARET_MAX_WIDTH = 120
const CARET_MAX_HEIGHT = 64
const CARET_FRESH_MS = 20_000
const CARET_NEAR_Y = 44
const CARET_LINE_ROUNDING = 8
const CARET_LINE_FORGET_MS = 4_000
const CARET_SCORE_DECAY = 0.6
const CARET_SWITCH_SCORE = 1

// How long a console waits for a guest to take the desktop size it asked for
const RESIZE_WAIT_MS = 1_400
const PROBE_MIN_JUMP = 4
const PROBE_RADIUS = 14
const PROBE_DELAYS_MS = [30, 60, 100, 150, 210, 270, 340, 420, 520, 640, 780]
const PROBE_MIN_DIFFERENCE = 120

// Characters a US keyboard reaches through Shift. QEMU types keysyms through its
// US keymap and expects the client to hold Shift itself.
const SHIFTED = new Set('~!@#$%^&*()_+{}|:"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ')

// noVNC's own touch and pointer handling is bypassed for ours, and these are the
// parts of it the public API doesn't reach
type NoVncInternals = {
	_fbWidth: number
	_fbHeight: number
	_canvas: HTMLCanvasElement
	_sock: unknown
	_screenID: number
	_screenFlags: number
	_supportsSetDesktopSize: boolean
	_FBU: {x: number; y: number; width: number; height: number}
	_sendMouse(x: number, y: number, mask: number): void
	_resize(width: number, height: number): void
	_updateCursor(rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number): void
	_handleDataRect(): boolean
}

type Rfb = RFB & NoVncInternals

// A guest tells us one thing about what's under the pointer: its cursor image.
// An I-beam is a tall, narrow shape centred on its hotspot.
export function classifyCursor(rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number): CursorShape {
	let left = w
	let right = -1
	let top = h
	let bottom = -1
	let opaque = 0
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (rgba[(y * w + x) * 4 + 3] < 96) continue
			opaque++
			left = Math.min(left, x)
			right = Math.max(right, x)
			top = Math.min(top, y)
			bottom = Math.max(bottom, y)
		}
	}
	if (right < 0) return 'arrow'
	const width = right - left + 1
	const height = bottom - top + 1
	const centredX = Math.abs(hotx - (left + right) / 2) <= Math.max(2, width * 0.3)
	const centredY = Math.abs(hoty - (top + bottom) / 2) <= height * 0.25
	const narrow = height >= 11 && width <= 13 && width / height <= 0.62
	const sparse = opaque / (width * height) <= 0.75
	return narrow && sparse && centredX && centredY ? 'ibeam' : 'arrow'
}

// An arrow's hotspot is its tip, so it paints only right of and below that point.
// An I-beam's hotspot is near its middle: it reaches above and below the pointer
// in a narrow column. That's enough to tell them apart in pixels when a guest
// draws its own cursor. Faint changes are ignored, or a hover highlight would count.
export function classifyDrawnCursor(before: ImageData, after: ImageData) {
	const size = before.width
	const centre = (size - 1) / 2
	let left = size
	let right = -1
	let top = size
	let bottom = -1
	let changed = 0
	for (let row = 0; row < size; row++) {
		for (let column = 0; column < size; column++) {
			const index = (row * size + column) * 4
			const difference =
				Math.abs(before.data[index] - after.data[index]) +
				Math.abs(before.data[index + 1] - after.data[index + 1]) +
				Math.abs(before.data[index + 2] - after.data[index + 2])
			if (difference < PROBE_MIN_DIFFERENCE) continue
			changed++
			left = Math.min(left, column)
			right = Math.max(right, column)
			top = Math.min(top, row)
			bottom = Math.max(bottom, row)
		}
	}
	if (changed === 0) return {kind: 'unchanged' as const, changed}
	const width = right - left + 1
	const height = bottom - top + 1
	const spansPointer = top <= centre - 4 && bottom >= centre + 4
	const beam = spansPointer && height >= 12 && height <= 27 && width <= 11 && changed / (width * height) <= 0.5
	return {
		kind: beam ? ('ibeam' as const) : ('arrow' as const),
		changed,
		width,
		height,
		top: top - centre,
		left: left - centre,
	}
}

// Windows ignores a new size while it's running. It's only remembered for the
// wait on opening, so a size that starts working again is simply never asked for.
const FIXED_SIZE_KEY = 'umbrel:machines:fixed-size'
function fixedSizeMachines(): string[] {
	try {
		return JSON.parse(localStorage.getItem(FIXED_SIZE_KEY) ?? '[]')
	} catch {
		return []
	}
}
const keepsItsSize = (machineId: string) => fixedSizeMachines().includes(machineId)
function rememberFixedSize(machineId: string) {
	try {
		localStorage.setItem(FIXED_SIZE_KEY, JSON.stringify([...new Set([...fixedSizeMachines(), machineId])]))
	} catch {
		// Only means waiting a moment again next time
	}
}

// GPUs and their guests' drivers are happier with even dimensions
const evenSize = (width: number, height: number) => ({
	width: Math.floor(width / 2) * 2,
	height: Math.floor(height / 2) * 2,
})

export class RfbGuest implements Guest {
	width = 1280
	height = 720
	x = 640
	y = 360
	cursor: CursorShape = 'arrow'
	status: GuestStatus = 'connecting'
	paced = true
	nativeTouch: boolean
	textOnly: boolean
	family: GuestFamily
	viewScale = 1
	// The last frame, held on the glass through a reconnect. Phones sleep all the
	// time, and a black screen after every unlock reads as something broken.
	poster: HTMLCanvasElement | undefined
	cursorCanvas: HTMLCanvasElement | undefined
	hotx = 0
	hoty = 0
	sessionId = createBrowserUuid()

	private rfb: Rfb | undefined
	private socket: WebSocket | undefined
	private target: HTMLElement | undefined
	private viewOnly = false
	// Bumped on unmount, so a connection still being set up can tell it's stale
	private mounts = 0
	private disposed = false
	private retryTimer: ReturnType<typeof setTimeout> | undefined
	private attempt = 0
	private buttons = 0
	// Until the guest sends a cursor image, assume it's drawing its own
	private softwareCursor = true
	private wheelX = 0
	private wheelY = 0
	private syntheticShift = 0
	private lastKeyAt = -Infinity
	private lastKeyWasReturn = false
	private caretBurst: {x: number; y: number}[] = []
	private caretLines = new Map<number, {seen: Set<number>; score: number; t: number}>()
	private caretTimer: ReturnType<typeof setTimeout> | undefined
	private lastInputAt = -Infinity
	private awaitingFrame = false
	private caretPoint: {x: number; y: number; t: number} | undefined
	private agentConnected: boolean | undefined
	private pointerListeners = new Set<() => void>()
	private resizeListeners = new Set<() => void>()
	private statusListeners = new Set<() => void>()

	constructor(
		private machineId: string,
		private options: {
			family: GuestFamily
			nativeTouch?: boolean
			textOnly?: boolean
			omarchy?: boolean
			desiredSize?: {width: number; height: number}
		},
	) {
		if (options.desiredSize) options.desiredSize = evenSize(options.desiredSize.width, options.desiredSize.height)
		this.family = options.family
		this.nativeTouch = !!options.nativeTouch
		this.textOnly = !!options.textOnly
	}

	setViewScale(scale: number) {
		if (scale === this.viewScale) return
		this.viewScale = scale
		for (const listener of this.pointerListeners) listener()
	}

	onPointer(listener: () => void) {
		this.pointerListeners.add(listener)
		return () => void this.pointerListeners.delete(listener)
	}
	onResize(listener: () => void) {
		this.resizeListeners.add(listener)
		return () => void this.resizeListeners.delete(listener)
	}
	onStatus(listener: () => void) {
		this.statusListeners.add(listener)
		return () => void this.statusListeners.delete(listener)
	}
	private setStatus(status: GuestStatus) {
		this.status = status
		for (const listener of this.statusListeners) listener()
	}

	mount(target: HTMLElement) {
		this.target = target
		this.disposed = false
		void this.connect()
		window.addEventListener('online', this.reconnectNow)
		document.addEventListener('visibilitychange', this.reconnectNow)
	}

	unmount() {
		this.disposed = true
		this.mounts++
		clearTimeout(this.retryTimer)
		window.removeEventListener('online', this.reconnectNow)
		document.removeEventListener('visibilitychange', this.reconnectNow)
		this.rfb?.disconnect()
		this.socket?.close()
	}

	// A sleeping phone drops the socket: coming back is when it can work again
	private reconnectNow = () => {
		if (this.disposed || !this.retryTimer || document.visibilityState !== 'visible') return
		clearTimeout(this.retryTimer)
		this.retryTimer = undefined
		this.attempt = 0
		void this.connect()
	}

	private reconnect() {
		this.setStatus('reconnecting')
		clearTimeout(this.retryTimer)
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined
			void this.connect()
		}, reconnectDelay(this.attempt++))
	}

	// While an agent drives, nothing here reaches the guest
	setViewOnly(viewOnly: boolean) {
		this.viewOnly = viewOnly
		if (this.rfb) this.rfb.viewOnly = viewOnly
	}

	retry() {
		this.sessionId = createBrowserUuid()
		this.attempt = 0
		this.setStatus('connecting')
		void this.connect()
	}

	private async connect() {
		if (this.disposed || !this.target) return
		const mount = this.mounts
		try {
			const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
			if (this.disposed || mount !== this.mounts || !this.target) return
			this.target.replaceChildren()
			this.requestedSize = undefined
			const socket = new WebSocket(machineSocketUrl('/machines/console', this.machineId, this.sessionId, ticket), [
				'binary',
			])
			this.socket = socket
			let closeCode: number | undefined
			socket.addEventListener('close', (event) => (closeCode = event.code))
			const rfb = new RFB(this.target, socket, {shared: true}) as unknown as Rfb
			this.rfb = rfb
			rfb.scaleViewport = false
			rfb.clipViewport = false
			rfb.resizeSession = false
			rfb.focusOnClick = false
			rfb.background = '#000'
			rfb.viewOnly = this.viewOnly
			this.instrument(rfb)
			rfb.addEventListener('connect', () => {
				this.attempt = 0
				this.awaitingFrame = true
				this.wake(rfb)
				void trpcClient.machines.clipboardSharing
					.query({id: this.machineId})
					.then((connected) => (this.agentConnected = connected))
					.catch(() => {})
			})
			rfb.addEventListener('disconnect', () => {
				if (this.disposed) return
				this.holdLastFrame(rfb)
				if (closeCode === SUPERSEDED_CLOSE_CODE) {
					this.setStatus('superseded')
					return
				}
				socket.close()
				this.reconnect()
			})
			rfb.addEventListener('clipboard', (event) =>
				this.onGuestClipboard((event as CustomEvent<{text: string}>).detail.text),
			)
		} catch {
			this.socket?.close()
			this.reconnect()
		}
	}

	onClipboard: ((text: string) => void) | undefined
	onCaretMove: (() => void) | undefined
	private onGuestClipboard(text: string) {
		// Guests announce their clipboard as a console connects. Only a copy the
		// user just made belongs on their phone.
		if (performance.now() - this.lastInputAt < USER_COPY_WINDOW_MS) this.onClipboard?.(text)
	}

	// A guest left alone has usually blanked its display. Opening it should show
	// the machine, not a black screen waiting for a first touch.
	private wake(rfb: Rfb) {
		for (const delay of [100, 240]) {
			setTimeout(() => {
				rfb._sendMouse(this.x + (delay === 100 ? 1 : 0), this.y, 0)
			}, delay)
		}
		// A text console ignores the pointer; Shift wakes it without typing anything
		if (this.textOnly) rfb.sendKey(XK.Shift, 'ShiftLeft')
	}

	private holdLastFrame(rfb: Rfb) {
		const source = rfb._canvas
		if (!source?.width) return
		const poster = document.createElement('canvas')
		poster.width = source.width
		poster.height = source.height
		poster.getContext('2d')?.drawImage(source, 0, 0)
		this.poster = poster
		for (const listener of this.resizeListeners) listener()
	}

	private instrument(rfb: Rfb) {
		const resize = rfb._resize.bind(rfb)
		rfb._resize = (width, height) => {
			resize(width, height)
			this.width = width
			this.height = height
			for (const listener of this.resizeListeners) listener()
			// The guest only says it can resize in the frame that gives its size
			this.requestDesiredSize(rfb)
			if (this.revealTimer && this.requestedSize === `${width}x${height}`) this.reveal()
		}
		const updateCursor = rfb._updateCursor.bind(rfb)
		rfb._updateCursor = (rgba, hotx, hoty, w, h) => {
			updateCursor(rgba, hotx, hoty, w, h)
			this.setCursorImage(rgba, hotx, hoty, w, h)
		}
		const handleDataRect = rfb._handleDataRect.bind(rfb)
		rfb._handleDataRect = () => {
			const {x, y, width, height} = rfb._FBU
			this.noteDamage(x, y, width, height)
			return handleDataRect()
		}
	}

	private requestedSize: string | undefined
	private revealTimer: ReturnType<typeof setTimeout> | undefined

	private reveal() {
		clearTimeout(this.revealTimer)
		this.revealTimer = undefined
		this.poster = undefined
		this.setStatus('connected')
		for (const listener of this.resizeListeners) listener()
	}

	private requestDesiredSize(rfb: Rfb) {
		const size = this.options.desiredSize
		if (!size || !rfb._supportsSetDesktopSize || (this.width === size.width && this.height === size.height)) return
		if (keepsItsSize(this.machineId)) return
		// Once per size: a guest that can't do it answers with the size it has
		const key = `${size.width}x${size.height}`
		if (this.requestedSize === key) return
		this.requestedSize = key
		;(RFB as unknown as {messages: {setDesktopSize(...args: unknown[]): void}}).messages.setDesktopSize(
			rfb._sock,
			size.width,
			size.height,
			rfb._screenID,
			rfb._screenFlags,
		)
	}

	resizeTo(width: number, height: number) {
		if (!this.options.desiredSize) return
		this.options.desiredSize = evenSize(width, height)
		if (this.rfb && this.status === 'connected') this.requestDesiredSize(this.rfb)
	}

	private setCursorImage(rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number) {
		this.softwareCursor = false
		this.cursor = classifyCursor(rgba, hotx, hoty, w, h)
		const canvas = document.createElement('canvas')
		canvas.width = Math.max(1, w)
		canvas.height = Math.max(1, h)
		if (w > 0 && h > 0) canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
		this.cursorCanvas = canvas
		this.hotx = hotx
		this.hoty = hoty
		for (const listener of this.pointerListeners) listener()
	}

	// VNC says which pixels changed, which is how a console can follow typing with
	// no agent in the guest: right after a keypress, a small change near the last
	// caret is the caret moving. Anything else on screen, like a page loading, is
	// a lot of changes at once somewhere else, and doesn't count.
	private noteDamage(x: number, y: number, w: number, h: number) {
		const now = performance.now()
		if (this.awaitingFrame) {
			this.awaitingFrame = false
			// Decoded on the next tick: the frame is on the canvas by then. A desktop
			// about to change size waits, so the first thing seen is the final one.
			const resizing = this.requestedSize && this.requestedSize !== `${this.width}x${this.height}`
			this.revealTimer = setTimeout(
				() => {
					// It didn't take the size: don't keep it waiting on the next visit
					if (resizing && this.requestedSize !== `${this.width}x${this.height}`) rememberFixedSize(this.machineId)
					this.reveal()
				},
				resizing ? RESIZE_WAIT_MS : 60,
			)
		}
		if (now - this.lastKeyAt <= CARET_WINDOW_MS && w <= CARET_MAX_WIDTH && h <= CARET_MAX_HEIGHT) {
			this.caretBurst.push({x: x + w, y: y + h / 2})
			clearTimeout(this.caretTimer)
			this.caretTimer = setTimeout(() => this.settleCaret(), CARET_SETTLE_MS)
		}
	}

	// Several things can change for one key: the text, and a status bar counting
	// characters or columns. A caret keeps reaching new places, while a counter
	// flickers in the same few, so each line is scored on that. The current line
	// keeps the caret unless another is clearly the one moving.
	private settleCaret() {
		const burst = this.caretBurst
		this.caretBurst = []
		if (!burst.length) return
		const now = performance.now()
		const lines = new Map<number, {x: number; y: number}>()
		for (const rect of burst) {
			const key = Math.round(rect.y / CARET_LINE_ROUNDING)
			const line = lines.get(key)
			if (!line || rect.x > line.x) lines.set(key, {x: rect.x, y: rect.y})
		}
		for (const track of this.caretLines.values()) track.score *= CARET_SCORE_DECAY
		const candidates = [...lines].map(([key, line]) => {
			let track = this.caretLines.get(key)
			if (!track || now - track.t > CARET_LINE_FORGET_MS) {
				track = {seen: new Set(), score: 0, t: now}
				this.caretLines.set(key, track)
			}
			if (!track.seen.has(line.x)) track.score += 1
			track.seen.add(line.x)
			track.t = now
			return {...line, track}
		})
		const current = this.caretPoint ?? {x: this.x, y: this.y}
		const away = (line: {y: number}) => Math.abs(line.y - current.y)
		const onCurrentLine = candidates.filter((line) => away(line) <= CARET_LINE_ROUNDING).sort((a, b) => b.x - a.x)[0]
		const nextLine = candidates
			.filter((line) => line.y > current.y + CARET_LINE_ROUNDING && line.y - current.y <= CARET_NEAR_Y)
			.sort((a, b) => a.y - b.y)[0]
		const busiest = [...candidates].sort((a, b) => b.track.score - a.track.score || away(a) - away(b))[0]
		const held = this.caretPoint && this.caretLines.get(Math.round(this.caretPoint.y / CARET_LINE_ROUNDING))
		let best: {x: number; y: number} | undefined
		if (this.lastKeyWasReturn) best = nextLine ?? onCurrentLine ?? busiest
		else if (!held || busiest.track.score >= held.score + CARET_SWITCH_SCORE) best = busiest
		else best = onCurrentLine
		if (!best) return
		this.caretPoint = {x: best.x, y: best.y, t: now}
		this.onCaretMove?.()
	}

	caret() {
		const point = this.caretPoint
		if (!point || performance.now() - point.t > CARET_FRESH_MS) return
		return {x: point.x, y: point.y}
	}

	pointer(x: number, y: number, buttons: number) {
		const nextX = Math.max(0, Math.min(this.width - 1, Math.round(x)))
		const nextY = Math.max(0, Math.min(this.height - 1, Math.round(y)))
		const jumped = Math.hypot(nextX - this.x, nextY - this.y) > PROBE_MIN_JUMP
		this.lastInputAt = performance.now()
		// A short hop from an I-beam is the same text field, and the old cursor would
		// be in the picture anyway
		const sameField = this.cursor === 'ibeam' && Math.hypot(nextX - this.x, nextY - this.y) < PROBE_RADIUS * 2
		if (this.softwareCursor && jumped && !buttons && !sameField) this.startProbe(nextX, nextY)
		this.x = nextX
		this.y = nextY
		// A click can move focus anywhere, so the caret has to be found again
		if (buttons && !this.buttons) this.caretPoint = undefined
		this.buttons = buttons
		this.rfb?._sendMouse(this.x, this.y, buttons)
		for (const listener of this.pointerListeners) listener()
	}

	// Some guests, Windows among them, draw their cursor into the frame and never
	// report it. So watch it land: take the pixels around where the pointer is
	// going, and compare once the guest has drawn it there.
	private probe: {x: number; y: number; before: ImageData; timers: ReturnType<typeof setTimeout>[]} | undefined

	private readRegion(x: number, y: number) {
		const canvas = this.rfb?._canvas
		const context = canvas?.getContext('2d')
		if (!context) return
		try {
			return context.getImageData(x - PROBE_RADIUS, y - PROBE_RADIUS, PROBE_RADIUS * 2 + 1, PROBE_RADIUS * 2 + 1)
		} catch {
			return undefined
		}
	}

	private startProbe(x: number, y: number) {
		this.probe?.timers.forEach(clearTimeout)
		this.probe = undefined
		if (this.cursor !== 'arrow') this.cursor = 'arrow'
		const before = this.readRegion(x, y)
		if (!before) return
		const timers = PROBE_DELAYS_MS.map((delay) => setTimeout(() => this.finishProbe(), delay))
		this.probe = {x, y, before, timers}
	}

	private finishProbe() {
		const probe = this.probe
		if (!probe) return
		const after = this.readRegion(probe.x, probe.y)
		if (!after) return
		const shape = classifyDrawnCursor(probe.before, after)
		if (shape.kind === 'unchanged') return
		this.probe?.timers.forEach(clearTimeout)
		this.probe = undefined
		this.cursor = shape.kind
		for (const listener of this.pointerListeners) listener()
	}

	private notch(mask: number) {
		this.rfb?._sendMouse(this.x, this.y, this.buttons | mask)
		this.rfb?._sendMouse(this.x, this.y, this.buttons)
	}

	wheel(_x: number, _y: number, dx: number, dy: number) {
		this.wheelX += dx
		this.wheelY += dy
		while (Math.abs(this.wheelY) >= WHEEL_STEP) {
			this.notch(this.wheelY > 0 ? WHEEL_DOWN : WHEEL_UP)
			this.wheelY -= Math.sign(this.wheelY) * WHEEL_STEP
		}
		while (Math.abs(this.wheelX) >= WHEEL_STEP) {
			this.notch(this.wheelX > 0 ? WHEEL_RIGHT : WHEEL_LEFT)
			this.wheelX -= Math.sign(this.wheelX) * WHEEL_STEP
		}
	}

	key(keysym: number, down: boolean) {
		const rfb = this.rfb
		if (!rfb) return
		if (down) {
			this.lastKeyAt = this.lastInputAt = performance.now()
			this.lastKeyWasReturn = keysym === XK.Return
		}
		const character = keysymChar(keysym)
		const shifted = !!character && SHIFTED.has(character)
		if (shifted && down && this.syntheticShift++ === 0) rfb.sendKey(XK.Shift, 'ShiftLeft', true)
		rfb.sendKey(keysym, null as unknown as string, down)
		if (shifted && !down && --this.syntheticShift === 0) rfb.sendKey(XK.Shift, 'ShiftLeft', false)
	}

	// Only the clipboard agent can carry what the US keymap can't type
	paste(text: string) {
		const rfb = this.rfb
		if (!rfb || !this.agentConnected) return
		rfb.clipboardPasteFrom(text)
		const {omarchy} = this.options
		const [modifier, code] = omarchy ? [XK.Super, 'MetaLeft'] : [XK.Control, 'ControlLeft']
		setTimeout(
			() => {
				rfb.sendKey(modifier, code, true)
				rfb.sendKey(0x76, 'KeyV')
				rfb.sendKey(modifier, code, false)
			},
			omarchy ? OMARCHY_PASTE_DELAY_MS : 120,
		)
	}

	drawLoupe(context: CanvasRenderingContext2D, x: number, y: number, scale: number, size: number) {
		const source = this.rfb?._canvas
		context.fillStyle = '#000'
		context.fillRect(0, 0, size, size)
		if (!source) return
		const span = size / scale
		context.imageSmoothingEnabled = scale < 3
		context.drawImage(source, x - span / 2, y - span / 2, span, span, 0, 0, size, size)
		if (this.cursorCanvas) {
			const left = (this.x - this.hotx - (x - span / 2)) * scale
			const top = (this.y - this.hoty - (y - span / 2)) * scale
			context.drawImage(this.cursorCanvas, left, top, this.cursorCanvas.width * scale, this.cursorCanvas.height * scale)
		}
	}

	render() {
		return <RfbScreen guest={this} />
	}
}

// A hardware cursor is ours to draw, so it stays a usable size however far the
// desktop is zoomed out
const CURSOR_MIN_ON_SCREEN = 0.9

function RfbScreen({guest}: {guest: RfbGuest}) {
	const target = useRef<HTMLDivElement>(null)
	const cursor = useRef<HTMLDivElement>(null)
	const poster = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!target.current) return
		guest.mount(target.current)
		return () => guest.unmount()
	}, [guest])

	useEffect(() => {
		const update = () => {
			const element = poster.current
			if (!element) return
			element.replaceChildren(...(guest.poster ? [guest.poster] : []))
			element.style.opacity = guest.status === 'connected' ? '0' : '0.55'
		}
		update()
		const stopResize = guest.onResize(update)
		const stopStatus = guest.onStatus(update)
		return () => {
			stopResize()
			stopStatus()
		}
	}, [guest])

	useEffect(() => {
		let image: HTMLCanvasElement | undefined
		const update = () => {
			const element = cursor.current
			if (!element || guest.nativeTouch) return
			if (guest.cursorCanvas !== image) {
				image = guest.cursorCanvas
				element.replaceChildren(...(image ? [image] : []))
				element.style.transformOrigin = `${guest.hotx}px ${guest.hoty}px`
			}
			const scale = Math.max(1, CURSOR_MIN_ON_SCREEN / guest.viewScale)
			element.style.transform = `translate3d(${guest.x - guest.hotx}px, ${guest.y - guest.hoty}px, 0) scale(${scale})`
		}
		update()
		return guest.onPointer(update)
	}, [guest])

	return (
		<div className='relative size-full overflow-hidden bg-black'>
			<div ref={target} className='absolute inset-0 [&_canvas]:!m-0 [&>div]:!overflow-hidden' />
			<div ref={poster} className='pointer-events-none absolute inset-0 [&_canvas]:size-full' />
			<div ref={cursor} className='pointer-events-none absolute top-0 left-0' />
		</div>
	)
}
