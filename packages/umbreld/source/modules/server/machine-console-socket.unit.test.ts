import {EventEmitter} from 'node:events'

import {beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'

import {MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_SUPERSEDED_REASON} from './machine-console-sessions.ts'
import MachineConsoleSessions from './machine-console-sessions.ts'
import createMachineConsoleWebSocketHandler, {
	CONSOLE_BACKPRESSURE_HIGH_WATER_BYTES,
	MAX_BUFFERED_CONSOLE_BYTES,
} from './machine-console-socket.ts'

const netMocks = vi.hoisted(() => ({createConnection: vi.fn()}))

vi.mock('node:net', () => ({default: {createConnection: netMocks.createConnection}}))

class TestDisplaySocket extends EventEmitter {
	pause = vi.fn()
	resume = vi.fn()
	destroy = vi.fn()
	write = vi.fn()
}

beforeEach(() => netMocks.createConnection.mockReset())

function fakeWebSocket() {
	return {
		OPEN: 1,
		readyState: 1,
		close: vi.fn(),
	} as any
}

describe('machine console ownership', () => {
	test('the newest console supersedes the existing console for the same machine', () => {
		const active = new MachineConsoleSessions()
		const first = fakeWebSocket()
		const second = fakeWebSocket()

		active.claimConsole('machine-1', 'session-1', first)
		active.claimConsole('machine-1', 'session-2', second)

		expect(first.close).toHaveBeenCalledWith(MACHINE_CONSOLE_SUPERSEDED_CODE, MACHINE_CONSOLE_SUPERSEDED_REASON)
		expect(second.close).not.toHaveBeenCalled()
		expect(active.hasConsole('machine-1', 'session-2')).toBe(true)
	})

	test('releasing a superseded console cannot release its replacement', () => {
		const active = new MachineConsoleSessions()
		const first = fakeWebSocket()
		const second = fakeWebSocket()

		active.claimConsole('machine-1', 'session-1', first)
		active.claimConsole('machine-1', 'session-2', second)
		active.releaseConsole('machine-1', 'session-1', first)

		expect(active.hasConsole('machine-1', 'session-2')).toBe(true)
	})

	test('consoles for different machines do not affect each other', () => {
		const active = new MachineConsoleSessions()
		const first = fakeWebSocket()
		const second = fakeWebSocket()

		active.claimConsole('machine-1', 'session-1', first)
		active.claimConsole('machine-2', 'session-2', second)

		expect(first.close).not.toHaveBeenCalled()
		expect(active.hasConsole('machine-1', 'session-1')).toBe(true)
		expect(active.hasConsole('machine-2', 'session-2')).toBe(true)
	})

	test('audio only attaches to the controlling console and closes with it', () => {
		const active = new MachineConsoleSessions()
		const console = fakeWebSocket()
		const audio = fakeWebSocket()

		active.claimConsole('machine-1', 'session-1', console)
		expect(active.attachAudio('machine-1', 'wrong-session', audio)).toBe(false)
		expect(active.attachAudio('machine-1', 'session-1', audio)).toBe(true)

		active.releaseConsole('machine-1', 'session-1', console)
		expect(audio.close).toHaveBeenCalledWith(MACHINE_CONSOLE_SUPERSEDED_CODE, expect.any(String))
	})
})

describe('machine console socket cleanup', () => {
	test('does not claim a console when the WebSocket closes during socket lookup', async () => {
		let resolveSocket!: (path: string) => void
		const consoleSocket = vi.fn(() => new Promise<string>((resolve) => (resolveSocket = resolve)))
		const sessions = {
			claimConsole: vi.fn(),
			releaseConsole: vi.fn(),
		}
		const handler = createMachineConsoleWebSocketHandler({
			umbreld: {machines: {consoleSocket}} as unknown as Umbreld,
			logger: {error: vi.fn()} as any,
			sessions: sessions as any,
		})
		const ws = new EventEmitter() as any
		ws.OPEN = 1
		ws.readyState = 1
		ws.close = vi.fn()

		const handling = handler(ws, {url: '/?machineId=machine-1&sessionId=session-1'} as any)
		ws.emit('close')
		resolveSocket('/run/umbrel-machines/machine-1/display.sock')
		await handling

		expect(consoleSocket).toHaveBeenCalledWith('machine-1')
		expect(sessions.claimConsole).not.toHaveBeenCalled()
		expect(sessions.releaseConsole).not.toHaveBeenCalled()
	})

	test('pauses display reads until queued WebSocket output drains without dropping bytes', async () => {
		const display = new TestDisplaySocket()
		netMocks.createConnection.mockReturnValue(display)
		const sessions = {claimConsole: vi.fn(), releaseConsole: vi.fn()}
		const logger = {error: vi.fn()}
		const callbacks: Array<(error?: Error) => void> = []
		const ws = new EventEmitter() as any
		ws.OPEN = 1
		ws.readyState = 1
		ws.close = vi.fn()
		ws.terminate = vi.fn()
		ws.send = vi.fn((_data, _options, callback) => callbacks.push(callback))
		const handler = createMachineConsoleWebSocketHandler({
			umbreld: {machines: {consoleSocket: vi.fn(async () => '/display.sock')}} as unknown as Umbreld,
			logger: logger as any,
			sessions: sessions as any,
		})

		await handler(ws, {url: '/?machineId=machine-1&sessionId=session-1'} as any)
		const frame = Buffer.alloc(CONSOLE_BACKPRESSURE_HIGH_WATER_BYTES)
		display.emit('data', frame)

		expect(ws.send).toHaveBeenCalledWith(frame, {binary: true}, expect.any(Function))
		expect(display.pause).toHaveBeenCalledOnce()
		expect(display.resume).not.toHaveBeenCalled()

		callbacks[0]()
		expect(display.resume).toHaveBeenCalledOnce()
		expect(ws.terminate).not.toHaveBeenCalled()
	})

	test('terminates a console client before its output queue can grow without bound', async () => {
		const display = new TestDisplaySocket()
		netMocks.createConnection.mockReturnValue(display)
		const sessions = {claimConsole: vi.fn(), releaseConsole: vi.fn()}
		const logger = {error: vi.fn()}
		const ws = new EventEmitter() as any
		ws.OPEN = 1
		ws.readyState = 1
		ws.close = vi.fn()
		ws.terminate = vi.fn()
		ws.send = vi.fn()
		const handler = createMachineConsoleWebSocketHandler({
			umbreld: {machines: {consoleSocket: vi.fn(async () => '/display.sock')}} as unknown as Umbreld,
			logger: logger as any,
			sessions: sessions as any,
		})

		await handler(ws, {url: '/?machineId=machine-1&sessionId=session-1'} as any)
		display.emit('data', Buffer.alloc(MAX_BUFFERED_CONSOLE_BYTES))
		display.emit('data', Buffer.alloc(1))

		expect(ws.terminate).toHaveBeenCalledOnce()
		expect(display.destroy).toHaveBeenCalledOnce()
		expect(sessions.releaseConsole).toHaveBeenCalledWith('machine-1', 'session-1', ws)
		expect(logger.error).toHaveBeenCalledWith(
			'Machine console machine-1',
			expect.objectContaining({message: '[machine-console-client-too-slow]'}),
		)
	})
})
