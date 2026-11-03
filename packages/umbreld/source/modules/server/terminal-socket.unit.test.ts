import {EventEmitter} from 'node:events'
import type http from 'node:http'

import {beforeEach, describe, expect, test, vi} from 'vitest'
import {WebSocket} from 'ws'

const {$, spawn} = vi.hoisted(() => ({
	$: vi.fn(),
	spawn: vi.fn(),
}))

vi.mock('execa', () => ({$}))
vi.mock('node-pty', () => ({default: {spawn}}))

import createTerminalWebSocketHandler from './terminal-socket.ts'

class TestWebSocket extends EventEmitter {
	readyState: number = WebSocket.OPEN
	send = vi.fn()
	close = vi.fn(() => {
		this.readyState = WebSocket.CLOSING
	})
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise))
	return {promise, resolve}
}

describe('terminal WebSocket lifecycle', () => {
	let ptyProcess: {
		onData: ReturnType<typeof vi.fn>
		write: ReturnType<typeof vi.fn>
		kill: ReturnType<typeof vi.fn>
	}
	let onPtyData: (data: string) => void

	beforeEach(() => {
		onPtyData = () => {}
		ptyProcess = {
			onData: vi.fn((listener: (data: string) => void) => {
				onPtyData = listener
			}),
			write: vi.fn(),
			kill: vi.fn(),
		}
		spawn.mockReset().mockReturnValue(ptyProcess)
		$.mockReset().mockResolvedValue({stdout: 'umbrel'})
	})

	test('does not spawn a PTY after the socket disconnects during asynchronous setup', async () => {
		const manifest = deferred<{defaultShell: string}>()
		const compose = deferred<{services: {web: {container_name: string; image: string}}}>()
		const app = {
			id: 'files',
			readManifest: vi.fn(() => manifest.promise),
			readCompose: vi.fn(() => compose.promise),
		}
		const handler = createTerminalWebSocketHandler({
			umbreld: {apps: {getApp: () => app}} as never,
			logger: {error: vi.fn()} as never,
		})
		const socket = new TestWebSocket()
		const handling = handler(
			socket as unknown as WebSocket,
			{url: '/terminal?appId=files&cols=80&rows=24'} as http.IncomingMessage,
		)
		await vi.waitFor(() => expect(app.readCompose).toHaveBeenCalled())

		socket.readyState = WebSocket.CLOSED
		socket.emit('close')
		manifest.resolve({defaultShell: 'web'})
		compose.resolve({services: {web: {container_name: 'files_web_1', image: 'files'}}})
		await handling

		expect(spawn).not.toHaveBeenCalled()
	})

	test('rejects terminal input from a peer that keeps sending after revocation begins', async () => {
		const app = {
			id: 'files',
			readManifest: async () => ({defaultShell: 'web'}),
			readCompose: async () => ({services: {web: {container_name: 'files_web_1', image: 'files'}}}),
		}
		const handler = createTerminalWebSocketHandler({
			umbreld: {apps: {getApp: () => app}} as never,
			logger: {error: vi.fn()} as never,
		})
		const socket = new TestWebSocket()
		await handler(
			socket as unknown as WebSocket,
			{url: '/terminal?appId=files&cols=80&rows=24'} as http.IncomingMessage,
		)

		socket.emit('message', Buffer.from('before revocation'))
		expect(ptyProcess.write).toHaveBeenCalledTimes(1)
		expect(ptyProcess.write).toHaveBeenLastCalledWith('before revocation')
		onPtyData('visible output')
		expect(socket.send).toHaveBeenCalledTimes(1)
		expect(socket.send).toHaveBeenLastCalledWith('visible output')

		// Model a hostile peer that ignores a graceful close and continues sending.
		// The socket can still emit buffered frames, but none may reach the PTY.
		socket.readyState = WebSocket.CLOSING
		socket.emit('message', Buffer.from('after revocation'))
		onPtyData('late output')
		expect(ptyProcess.write).toHaveBeenCalledTimes(1)
		expect(socket.send).toHaveBeenCalledTimes(1)

		socket.emit('close')
		expect(ptyProcess.kill).toHaveBeenCalledTimes(1)
	})
})
