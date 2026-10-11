import {execFile} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'

import AppGateway from '../app-gateway/app-gateway.js'
import {APP_GATEWAY_HTTP_COOKIE_NAME, APP_GATEWAY_HTTPS_COOKIE_NAME} from '../auth/app-gateway-cookie.js'
import LanIngress from './lan-ingress.js'

const routes = [
	{name: 'app gateway', protocol: 'http', gateway: true, ingress: false},
	{name: 'HTTP ingress', protocol: 'http', gateway: false, ingress: true},
	{name: 'HTTPS ingress', protocol: 'https', gateway: false, ingress: true},
	{name: 'HTTP ingress and app gateway', protocol: 'http', gateway: true, ingress: true},
	{name: 'HTTPS ingress and app gateway', protocol: 'https', gateway: true, ingress: true},
] as const
type Route = (typeof routes)[number]
type ProxyFactory = {
	createHttpProxyServer(port: number, protocol: 'http'): http.Server
	createHttpsProxyServer(port: number): Promise<https.Server>
}

const logger = {createChildLogger: () => logger, verbose: () => {}, log: () => {}, error: () => {}}
const servers: http.Server[] = []
const sockets = new Set<net.Socket>()
const websocketServers: WebSocketServer[] = []
let directory: string
let ingress: ProxyFactory

beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-cancellation-'))
	const instance = new LanIngress({dataDirectory: directory, logger} as never)
	await fs.mkdir(instance.directory)
	await promisify(execFile)('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'1',
		'-keyout',
		instance.serverKeyPath,
		'-out',
		instance.serverCertificatePath,
		'-subj',
		'/CN=localhost',
	])
	ingress = instance as unknown as ProxyFactory
})

afterEach(async () => {
	for (const server of websocketServers.splice(0)) {
		for (const socket of server.clients) socket.terminate()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
	for (const socket of sockets) socket.destroy()
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

afterAll(async () => fs.rm(directory, {recursive: true, force: true}))

async function listen(server: http.Server) {
	servers.push(server)
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.once('close', () => sockets.delete(socket))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}

function cookie(route: Route) {
	return `${route.protocol === 'https' ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME}=stream-session`
}

async function createRoute(route: Route, handler: http.RequestListener) {
	const upstreamSockets = new Set<net.Socket>()
	const onUpstreamUnavailable = vi.fn()
	const upstream = http.createServer((request, response) => {
		request.on('error', () => {})
		response.on('error', () => {})
		handler(request, response)
	})
	upstream.on('connection', (socket) => {
		upstreamSockets.add(socket)
		socket.once('close', () => upstreamSockets.delete(socket))
	})
	let port = await listen(upstream)
	if (route.gateway) {
		const principal = {accountId: 'owner', sessionId: 'stream-test', actor: 'account'}
		const auth = {
			appAccessRevision: 0,
			authenticate: async (token: string) => {
				if (token !== 'stream-session') throw new Error('Unauthorized')
				return principal
			},
			authorizeApp: async () => {},
			registerAppSocket: () => true,
		}
		port = await listen(
			new AppGateway(
				{logger, auth} as never,
				{
					appId: 'stream-test',
					appName: 'Stream test',
					appIcon: '',
					targetProtocol: 'http',
					targetHost: '127.0.0.1',
					targetPort: port,
					auth: true,
					authWhitelist: [],
					authBlacklist: [],
					trustUpstream: false,
					timeout: 0,
				},
				{onUpstreamUnavailable},
			).server,
		)
	}
	if (route.ingress) {
		port = await listen(
			route.protocol === 'http'
				? ingress.createHttpProxyServer(port, 'http')
				: await ingress.createHttpsProxyServer(port),
		)
	}
	return {port, upstream, upstreamSockets, onUpstreamUnavailable}
}

function clientOptions(route: Route, port: number) {
	return {
		hostname: '127.0.0.1',
		port,
		agent: false as const,
		rejectUnauthorized: false,
		headers: {cookie: cookie(route)},
	}
}

async function download(route: Route, port: number, headers: http.OutgoingHttpHeaders = {}) {
	return new Promise<{status?: number; headers: http.IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
		const client = route.protocol === 'http' ? http : https
		client
			.get(
				{...clientOptions(route, port), headers: {...clientOptions(route, port).headers, ...headers}},
				(response) => {
					const chunks: Buffer[] = []
					response.on('data', (chunk: Buffer) => chunks.push(chunk))
					response.on('error', reject)
					response.on('end', () =>
						resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}),
					)
				},
			)
			.on('error', reject)
	})
}

test.each(routes)('$name releases upstream sockets after cancelling a streaming response', async (route) => {
	const activeResponses = new Set<http.ServerResponse>()
	const {port, upstreamSockets, onUpstreamUnavailable} = await createRoute(route, (_request, response) => {
		activeResponses.add(response)
		response.writeHead(200, {'content-type': 'video/mp4'})
		const timer = setInterval(() => response.write(Buffer.alloc(64 * 1024)), 10)
		response.once('close', () => {
			clearInterval(timer)
			activeResponses.delete(response)
		})
	})
	for (let attempt = 0; attempt < 3; attempt++) {
		await new Promise<void>((resolve, reject) => {
			const client = route.protocol === 'http' ? http : https
			const request = client.get(clientOptions(route, port), (response) => {
				response.once('data', () => {
					response.destroy()
					request.destroy()
					resolve()
				})
			})
			request.on('error', reject)
		})
		await vi.waitFor(
			() => {
				expect(activeResponses.size).toBe(0)
				expect(upstreamSockets.size).toBe(0)
			},
			{timeout: 1000, interval: 10},
		)
		expect(onUpstreamUnavailable).not.toHaveBeenCalled()
	}
})

test.each(routes)('$name cancels an upstream request before response headers arrive', async (route) => {
	let upstreamRequest: http.IncomingMessage | undefined
	const {port, upstreamSockets, onUpstreamUnavailable} = await createRoute(route, (request) => {
		upstreamRequest = request
	})
	const client = route.protocol === 'http' ? http : https
	const request = client.get(clientOptions(route, port))
	request.on('error', () => {})
	await vi.waitFor(() => expect(upstreamRequest).toBeDefined())
	request.destroy()
	await vi.waitFor(() => expect(upstreamSockets.size).toBe(0), {timeout: 1000, interval: 10})
	expect(onUpstreamUnavailable).not.toHaveBeenCalled()
})

test.each(routes)('$name terminates a downstream response when its upstream stream fails', async (route) => {
	const {port, upstreamSockets} = await createRoute(route, (_request, response) => {
		response.writeHead(200, {'content-length': 1024 * 1024})
		response.write(Buffer.alloc(1024))
		const timer = setTimeout(() => response.destroy(), 30)
		response.once('close', () => clearTimeout(timer))
	})
	await expect(download(route, port)).rejects.toThrow()
	await vi.waitFor(() => expect(upstreamSockets.size).toBe(0), {timeout: 1000, interval: 10})
})

test.each(routes)('$name preserves a completed range response and app headers', async (route) => {
	const body = Buffer.alloc(128 * 1024, 'stream')
	let receivedHeaders: http.IncomingHttpHeaders | undefined
	const {port} = await createRoute(route, (request, response) => {
		receivedHeaders = request.headers
		response.writeHead(206, {
			'content-length': body.length,
			'content-range': `bytes 1024-${body.length + 1023}/${body.length * 2}`,
			'accept-ranges': 'bytes',
			'strict-transport-security': 'max-age=31536000',
		})
		let offset = 0
		const timer = setInterval(() => {
			response.write(body.subarray(offset, (offset += 8192)))
			if (offset >= body.length) {
				clearInterval(timer)
				response.end()
			}
		}, 10)
		response.once('close', () => clearInterval(timer))
	})
	const response = await download(route, port, {
		range: `bytes=1024-${body.length + 1023}`,
		authorization: 'Bearer synthetic-app-token',
		cookie: `${cookie(route)}; app_session=synthetic`,
	})
	expect(response.status).toBe(206)
	expect(response.body).toEqual(body)
	expect(response.headers['accept-ranges']).toBe('bytes')
	expect(receivedHeaders?.range).toBe(`bytes=1024-${body.length + 1023}`)
	expect(receivedHeaders?.authorization).toBe('Bearer synthetic-app-token')
	if (route.gateway) expect(receivedHeaders?.cookie).toBe('app_session=synthetic')
	if (route.ingress) expect(response.headers['strict-transport-security']).toBeUndefined()
})

test.each(routes)('$name closes an interrupted upstream upload', async (route) => {
	let receivedBytes = 0
	const {port, upstreamSockets} = await createRoute(route, (request) => {
		request.on('data', (chunk: Buffer) => {
			receivedBytes += chunk.length
		})
	})
	const client = route.protocol === 'http' ? http : https
	const request = client.request({
		...clientOptions(route, port),
		method: 'POST',
		headers: {
			cookie: cookie(route),
			'content-length': 1024 * 1024,
		},
	})
	request.on('error', () => {})
	request.write(Buffer.alloc(1024))
	await vi.waitFor(() => expect(receivedBytes).toBe(1024))
	request.destroy()
	await vi.waitFor(() => expect(upstreamSockets.size).toBe(0), {timeout: 1000, interval: 10})
})

test.each(routes)('$name preserves WebSocket upgrades and messages', async (route) => {
	const {port, upstream} = await createRoute(route, (_request, response) => response.end('HTTP still works'))
	const websocketServer = new WebSocketServer({server: upstream})
	websocketServers.push(websocketServer)
	websocketServer.on('connection', (socket) => socket.on('message', (data) => socket.send(data)))
	const socket = new WebSocket(`${route.protocol === 'https' ? 'wss' : 'ws'}://127.0.0.1:${port}/socket`, {
		rejectUnauthorized: false,
		headers: {cookie: cookie(route)},
	})
	await once(socket, 'open')
	const received = once(socket, 'message')
	socket.send('stream-test')
	expect((await received)[0].toString()).toBe('stream-test')
	const closed = once(socket, 'close')
	socket.close()
	await closed
	expect((await download(route, port)).body.toString()).toBe('HTTP still works')
})

test.each(routes.filter((route) => route.gateway))('$name still rejects unauthenticated clients', async (route) => {
	const upstreamRequest = vi.fn((_request: http.IncomingMessage, response: http.ServerResponse) => response.end())
	const {port} = await createRoute(route, upstreamRequest)
	const response = await download(route, port, {cookie: ''})
	expect(response.status).toBe(302)
	expect(response.headers.location).toContain('/app-auth?')
	expect(upstreamRequest).not.toHaveBeenCalled()
})
