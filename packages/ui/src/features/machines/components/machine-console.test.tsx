// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {MachineConsole} from './machine-console'

type FakeRfb = EventTarget & {
	disconnect: () => void
	sendKey: ReturnType<typeof vi.fn>
	clipboardPasteFrom: ReturnType<typeof vi.fn>
}

const {consoles, sockets, clipboardShared} = vi.hoisted(() => ({
	consoles: [] as FakeRfb[],
	sockets: [] as Array<EventTarget & {url: string; close: () => void}>,
	clipboardShared: {value: true},
}))

vi.mock('@novnc/novnc', () => ({
	default: class extends EventTarget {
		disconnect = vi.fn()
		focus = vi.fn()
		sendKey = vi.fn()
		clipboardPasteFrom = vi.fn()
		constructor() {
			super()
			consoles.push(this as unknown as FakeRfb)
		}
	},
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/trpc/trpc', () => ({
	trpcClient: {
		user: {createWebSocketTicket: {mutate: async () => 'ticket'}},
		machines: {clipboardSharing: {query: async () => clipboardShared.value}},
	},
}))
vi.mock('@/features/machines/hooks/use-machines', () => ({useMachineAgentControls: () => ({})}))
vi.mock('@/features/machines/hooks/use-machine-audio-preference', () => ({
	useMachineAudioPreference: () => ({muted: false}),
}))
vi.mock('@/features/machines/machine-audio', () => ({
	createMachineAudioSink: async () => ({enqueue: vi.fn(), disconnect: vi.fn()}),
}))
vi.mock('@/features/machines/components/machine-agent-overlay', () => ({MachineAgentOverlay: () => null}))
vi.mock('./console-agent-ownership', () => ({setConsoleAgentOwnership: vi.fn()}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class FakeWebSocket extends EventTarget {
	binaryType = 'blob'
	close = vi.fn()
	constructor(readonly url: string) {
		super()
		sockets.push(this)
	}
}

class FakeAudioContext extends EventTarget {
	state = 'running'
	resume = async () => {}
	close = async () => {}
}

let root: Root | undefined

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('WebSocket', FakeWebSocket)
	vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
	clipboardShared.value = true
	if (root) act(() => root?.unmount())
	root = undefined
	document.body.replaceChildren()
	consoles.length = 0
	sockets.length = 0
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

async function settle(ms = 0) {
	await act(() => vi.advanceTimersByTimeAsync(ms))
}

async function renderConsole() {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root?.render(<MachineConsole machineId='machine-1' resizeSession={false} />))
	await settle()
	return container
}

const audioSockets = () => sockets.filter(({url}) => url.includes('/machines/audio'))
const consoleSockets = () => sockets.filter(({url}) => url.includes('/machines/console'))

// What noVNC does when the server closes a live session: the socket reports
// its code, then RFB disconnects "cleanly" whatever that code was
function dropConsole(code: number) {
	consoleSockets()
		.at(-1)!
		.dispatchEvent(Object.assign(new Event('close'), {code}))
	consoles.at(-1)!.dispatchEvent(new CustomEvent('disconnect', {detail: {clean: true}}))
}

const closeAudio = (code: number) =>
	audioSockets()
		.at(-1)!
		.dispatchEvent(Object.assign(new Event('close'), {code}))

it('only streams audio while this tab holds a live console', async () => {
	await renderConsole()
	expect(audioSockets()).toHaveLength(0)

	act(() => consoles[0].dispatchEvent(new Event('connect')))
	await settle()
	expect(audioSockets()).toHaveLength(1)

	act(() => dropConsole(1006))
	await settle()
	expect(audioSockets()[0].close).toHaveBeenCalled()
	// The closed stream does not reconnect on its own; the next console does
	await settle(60_000)
	expect(audioSockets()).toHaveLength(1)
	act(() => consoles.at(-1)!.dispatchEvent(new Event('connect')))
	await settle()
	expect(audioSockets()).toHaveLength(2)
})

it('reconnects a console the server dropped, backing off between attempts', async () => {
	const container = await renderConsole()
	act(() => consoles[0].dispatchEvent(new Event('connect')))

	act(() => dropConsole(1006))
	await settle()
	expect(container.textContent).toContain('machines.console-disconnected')

	await settle(999)
	expect(consoles).toHaveLength(1)
	await settle(1)
	expect(consoles).toHaveLength(2)

	// A failed attempt waits twice as long
	act(() => dropConsole(1005))
	await settle(1_999)
	expect(consoles).toHaveLength(2)
	await settle(1)
	expect(consoles).toHaveLength(3)

	// Connecting resets the backoff and clears the notice
	act(() => consoles[2].dispatchEvent(new Event('connect')))
	await settle()
	expect(container.textContent).not.toContain('machines.console-disconnected')
	act(() => dropConsole(1006))
	await settle(1_000)
	expect(consoles).toHaveLength(4)
})

it('stops at a takeover instead of fighting the other tab', async () => {
	const container = await renderConsole()
	act(() => consoles[0].dispatchEvent(new Event('connect')))
	await settle()

	act(() => dropConsole(4001))
	await settle(60_000)

	expect(container.textContent).toContain('machines.console-controlled-elsewhere')
	expect(consoles).toHaveLength(1)
	expect(audioSockets()).toHaveLength(1)
})

it('retries dropped audio with backoff but treats the superseded code as final', async () => {
	await renderConsole()
	act(() => consoles[0].dispatchEvent(new Event('connect')))
	await settle()

	act(() => closeAudio(1006))
	await settle(999)
	expect(audioSockets()).toHaveLength(1)
	await settle(1)
	expect(audioSockets()).toHaveLength(2)

	act(() => closeAudio(4001))
	await settle(60_000)
	expect(audioSockets()).toHaveLength(2)
})

// noVNC's canvas lives in the console's screen, its first child
const screenOf = (container: HTMLElement) => container.firstElementChild!.firstElementChild!

function pressPaste(container: HTMLElement, text: string) {
	const screen = screenOf(container)
	screen.dispatchEvent(new KeyboardEvent('keydown', {key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true}))
	document.dispatchEvent(Object.assign(new Event('paste'), {clipboardData: {getData: () => text}}))
}

async function connectConsole(container = renderConsole()) {
	const rendered = await container
	act(() => consoles[0].dispatchEvent(new Event('connect')))
	await settle()
	return rendered
}

it('hands the guest the local clipboard before replaying a paste shortcut', async () => {
	const container = await connectConsole()
	const rfb = consoles[0]

	act(() => pressPaste(container, 'hello'))
	await settle()

	expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith('hello')
	expect(rfb.sendKey).toHaveBeenCalledWith(0x76, 'KeyV')
	expect(rfb.clipboardPasteFrom.mock.invocationCallOrder[0]).toBeLessThan(rfb.sendKey.mock.invocationCallOrder[0])
})

it('types a paste in when the guest has no clipboard agent, without forwarding the shortcut', async () => {
	clipboardShared.value = false
	const container = await connectConsole()
	const rfb = consoles[0]

	act(() => pressPaste(container, 'ls'))
	await settle(1_000)

	expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled()
	expect(rfb.sendKey).not.toHaveBeenCalledWith(0x76, 'KeyV')
	// Ctrl comes off before typing, or the guest would read Ctrl+L
	expect(rfb.sendKey).toHaveBeenCalledWith(0xffe3, 'ControlLeft', false)
	expect(rfb.sendKey).toHaveBeenCalledWith(0x6c, null, true)
	expect(rfb.sendKey).toHaveBeenCalledWith(0x73, null, false)
	expect(container.textContent).toBe('')
})

it('lets a long paste be stopped while it types', async () => {
	clipboardShared.value = false
	const container = await connectConsole()

	act(() => pressPaste(container, 'x'.repeat(100)))
	await settle(100)
	expect(container.textContent).toContain('machines.clipboard-typing')

	act(() => container.querySelector('button')!.click())
	await settle(60_000)
	expect(container.textContent).not.toContain('machines.clipboard-typing')
	expect(consoles[0].sendKey.mock.calls.filter(([, code, down]) => code === null && down).length).toBeLessThan(100)
})

it('refuses to type more than the cap', async () => {
	clipboardShared.value = false
	const container = await connectConsole()

	act(() => pressPaste(container, 'x'.repeat(10_001)))
	await settle(1_000)

	expect(container.textContent).toContain('machines.clipboard-too-long')
	expect(consoles[0].sendKey.mock.calls.filter(([, code]) => code === null)).toHaveLength(0)
})

it('notices an agent that connects after the console opened', async () => {
	clipboardShared.value = false
	const container = await connectConsole()
	clipboardShared.value = true

	await settle(5_000)
	act(() => {
		screenOf(container).dispatchEvent(new KeyboardEvent('keydown', {key: 'Control', ctrlKey: true, bubbles: true}))
	})
	await settle()
	act(() => pressPaste(container, 'hello'))
	await settle()

	expect(consoles[0].clipboardPasteFrom).toHaveBeenCalledWith('hello')
})

it('only takes guest copies the user just made, offering a button when the browser refuses the write', async () => {
	const container = await renderConsole()
	act(() => consoles[0].dispatchEvent(new Event('connect')))
	await settle()
	const guestCopies = (text: string) =>
		act(() => consoles[0].dispatchEvent(new CustomEvent('clipboard', {detail: {text}})))

	// The clipboard a guest announces as the console connects stays in the guest
	guestCopies('stale')
	await settle()
	expect(container.textContent).not.toContain('machines.clipboard-copied')

	act(() => {
		screenOf(container).dispatchEvent(new KeyboardEvent('keydown', {key: 'c', ctrlKey: true, bubbles: true}))
	})
	guestCopies('fresh')
	await settle()
	// jsdom has no clipboard to write to, like a browser past its activation window
	expect(container.textContent).toContain('machines.clipboard-copied')
})
