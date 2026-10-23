import type {AddressInfo, Socket} from 'node:net'

import {afterEach, expect, test, vi} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'

import {coalesceWrites} from './coalesce-writes.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})

async function connect({coalesce = true} = {}) {
	const wss = new WebSocketServer({port: 0})
	const serverSide = new Promise<WebSocket>((resolve) => wss.on('connection', resolve))
	await new Promise((resolve) => wss.on('listening', resolve))
	const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
	cleanups.push(() => {
		client.terminate()
		wss.close()
	})
	const received: string[] = []
	client.on('message', (data) => received.push(data.toString()))
	await new Promise((resolve) => client.on('open', resolve))
	const ws = await serverSide
	const socket = (ws as unknown as {_socket?: Socket})._socket
	expect(socket, "ws no longer exposes its socket as _socket, so writes can't be coalesced").toBeDefined()
	if (coalesce) coalesceWrites(ws)
	// Count the calls that hand data to the operating system
	const writer = socket as unknown as Record<'_write' | '_writev', (...args: unknown[]) => void>
	const writes = {single: vi.spyOn(writer, '_write'), batched: vi.spyOn(writer, '_writev')}
	return {ws, received, socket: socket!, writes}
}

test('holds writes during a run of sends and flushes them together once it ends', async () => {
	const {ws, received, socket} = await connect()

	for (let i = 0; i < 1000; i++) ws.send(`message ${i}`)
	expect(socket.writableCorked).toBeGreaterThan(0)
	await new Promise(process.nextTick)
	expect(socket.writableCorked).toBe(0)

	await expect.poll(() => received.length).toBe(1000)
	expect(received).toEqual(Array.from({length: 1000}, (_, i) => `message ${i}`))
})

test('sends a run of messages to the socket in one write', async () => {
	const {ws, received, writes} = await connect()

	for (let i = 0; i < 1000; i++) ws.send(`message ${i}`)
	await new Promise(process.nextTick)

	expect(writes.single.mock.calls.length + writes.batched.mock.calls.length).toBe(1)
	expect(writes.batched).toHaveBeenCalledOnce()
	await expect.poll(() => received.length).toBe(1000)
})

test('without coalescing, a run of messages takes many writes', async () => {
	// Shows the write counting above can tell the difference
	const {ws, received, writes} = await connect({coalesce: false})

	for (let i = 0; i < 1000; i++) ws.send(`message ${i}`)
	await expect.poll(() => received.length).toBe(1000)

	expect(writes.single.mock.calls.length + writes.batched.mock.calls.length).toBeGreaterThan(10)
})

test('flushes a lone message straight away', async () => {
	const {ws, received} = await connect()

	ws.send('hello')

	await expect.poll(() => received, {timeout: 1000}).toEqual(['hello'])
})
