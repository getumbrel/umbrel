import {once} from 'node:events'
import http from 'node:http'
import net from 'node:net'

import {afterEach, expect, test, vi} from 'vitest'

import {forwardTcp} from './forward-tcp.js'

const servers: net.Server[] = []
const sockets = new Set<net.Socket>()
async function listen(server: net.Server) {
	servers.push(server)
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.on('close', () => sockets.delete(socket))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}

afterEach(async () => {
	vi.useRealTimers()
	for (const socket of sockets) socket.destroy()
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test('replays a fragmented request once and flushes a large normal response under backpressure', async () => {
	const body = 'request-'.repeat(128 * 1024)
	const responseBody = 'response-'.repeat(256 * 1024)
	const backendPort = await listen(
		http.createServer(async (request, response) => {
			const chunks = []
			for await (const chunk of request) chunks.push(chunk)
			expect(Buffer.concat(chunks).toString()).toBe(body)
			response.setHeader('connection', 'close')
			response.end(responseBody)
		}),
	)
	const released = vi.fn()
	const muxPort = await listen(
		net.createServer((client) => {
			client.once('data', (chunk) => {
				client.pause()
				forwardTcp(client, [chunk.subarray(0, 2), chunk.subarray(2)], backendPort, released)
			})
		}),
	)
	const response = await fetch(`http://127.0.0.1:${muxPort}`, {method: 'POST', body})
	expect(await response.text()).toBe(responseBody)
	expect(released).toHaveBeenCalledTimes(1)
}, 10_000)

test('flushes buffered bytes to a slow backend after the client sends FIN', async () => {
	const body = Buffer.alloc(16 * 1024 * 1024, 'x')
	let received = 0
	let backendClosed!: Promise<void>
	const backend = net.createServer((socket) => {
		backendClosed = new Promise((resolve) => socket.once('close', () => resolve()))
		socket.on('data', (chunk) => (received += chunk.length))
		// Keep replay bytes queued while the client finishes its side.
		socket.pause()
		setTimeout(() => socket.resume(), 100)
	})
	const backendPort = await listen(backend)
	const accepted = once(backend, 'connection')
	const mux = net.createServer((client) => forwardTcp(client, [body], backendPort))
	const muxPort = await listen(mux)
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	sockets.add(client)
	client.once('close', () => sockets.delete(client))
	client.on('error', () => {})
	client.resume()
	await accepted
	client.end()
	await backendClosed
	expect(received).toBe(body.length)
}, 10_000)

test('destroying an accepted client without an error closes the upstream too', async () => {
	const backend = net.createServer()
	const backendPort = await listen(backend)
	const accepted = once(backend, 'connection')
	let acceptedClient!: net.Socket
	const muxPort = await listen(
		net.createServer((client) => {
			acceptedClient = client
			forwardTcp(client, [], backendPort)
		}),
	)
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	client.on('error', () => {})
	const [peer] = (await accepted) as [net.Socket]
	peer.resume()
	const closed = once(peer, 'close')
	acceptedClient.destroy()
	await closed
	client.destroy()
}, 5000)

test('bounds the initial handoff when a connected backend does not read', async () => {
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
	const backend = net.createServer((socket) => socket.pause())
	const backendPort = await listen(backend)
	const backendAccepted = once(backend, 'connection')
	const released = vi.fn()
	let upstreamClosed!: Promise<unknown>
	const muxPort = await listen(
		net.createServer((client) => {
			const upstream = forwardTcp(client, [Buffer.alloc(32 * 1024 * 1024)], backendPort, released)
			upstreamClosed = once(upstream, 'close')
		}),
	)
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	client.on('error', () => {})
	await backendAccepted
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(released).not.toHaveBeenCalled()
	await vi.advanceTimersByTimeAsync(5001)
	await upstreamClosed
	expect(released).toHaveBeenCalledTimes(1)
	client.destroy()
}, 5000)

test('graceful mux shutdown closes an upstream that keeps its response half open', async () => {
	const backend = net.createServer({allowHalfOpen: true}, (socket) => socket.resume())
	const backendPort = await listen(backend)
	const backendAccepted = once(backend, 'connection')
	let acceptedClient!: net.Socket
	let upstream!: net.Socket
	const mux = net.createServer((client) => {
		acceptedClient = client
		upstream = forwardTcp(client, [], backendPort)
		sockets.add(upstream)
		upstream.once('close', () => sockets.delete(upstream))
	})
	const muxPort = await listen(mux)
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	client.on('error', () => {})
	client.resume()
	await backendAccepted
	const upstreamClosed = once(upstream, 'close')
	// Route reconciliation ends accepted sockets before forcing destruction.
	// The client can finish normally even while the backend never sends FIN.
	const muxClosed = new Promise<void>((resolve) => mux.close(() => resolve()))
	acceptedClient.end()
	await muxClosed
	await upstreamClosed
	expect(acceptedClient.destroyed).toBe(true)
	expect(upstream.destroyed).toBe(true)
	client.destroy()
}, 5000)

test('client cancellation before connect releases buffered bytes and cancels the upstream', async () => {
	const backendPort = await listen(net.createServer((socket) => socket.resume()))
	const released = vi.fn()
	let upstreamClosed!: Promise<unknown>
	const mux = net.createServer((client) => {
		const upstream = forwardTcp(client, [Buffer.from('buffered')], backendPort, released)
		upstreamClosed = once(upstream, 'close')
		client.destroy()
	})
	const muxPort = await listen(mux)
	const accepted = once(mux, 'connection')
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	client.on('error', () => {})
	await accepted
	await upstreamClosed
	expect(released).toHaveBeenCalledTimes(1)
	client.destroy()
}, 5000)

test('a refused upstream closes the client and releases the initial data', async () => {
	const unavailable = net.createServer()
	const port = await listen(unavailable)
	await new Promise<void>((resolve) => unavailable.close(() => resolve()))
	const released = vi.fn()
	const muxPort = await listen(net.createServer((client) => forwardTcp(client, [Buffer.from('GET /')], port, released)))
	const client = net.createConnection({host: '127.0.0.1', port: muxPort})
	client.on('error', () => {})
	await once(client, 'close')
	expect(released).toHaveBeenCalledTimes(1)
}, 5000)
