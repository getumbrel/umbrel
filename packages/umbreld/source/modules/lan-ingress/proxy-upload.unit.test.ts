import {execFile} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import {Readable} from 'node:stream'
import {promisify} from 'node:util'

import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'

import AppGateway from '../app-gateway/app-gateway.ts'
import {APP_GATEWAY_HTTP_COOKIE_NAME, APP_GATEWAY_HTTPS_COOKIE_NAME} from '../auth/app-gateway-cookie.ts'
import {BROWSER_SESSION_COOKIE_NAMES} from '../auth/browser-session-cookie.ts'
import LanIngress from './lan-ingress.ts'

type ProxyFactory = {
	createHttpProxyServer(port: number, protocol: 'http'): http.Server
	createHttpsProxyServer(port: number, options?: {includeForwardedFor?: boolean}): Promise<https.Server>
}

const logger = {createChildLogger: () => logger, verbose: () => {}, log: () => {}, error: () => {}}
const servers: http.Server[] = []
const sockets = new Set<net.Socket>()
const chunk = Buffer.alloc(1024, 'upload')
const chunkCount = 20
const routes = [
	{protocol: 'http', gateway: false},
	{protocol: 'https', gateway: false},
	{protocol: 'http', gateway: true},
	{protocol: 'https', gateway: true},
] as const
let directory: string
let ingress: ProxyFactory

beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-upload-'))
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
	vi.restoreAllMocks()
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

async function createProxy(protocol: 'http' | 'https', upstreamPort: number, gateway = false) {
	// Exercise the real Node deadline without a five-minute test. Only shorten
	// the constructor defaults; the production factory must disable the deadline.
	// Scale the header timeout too: Node swaps the deadlines if it is larger.
	const createHttpServer = http.createServer
	const createHttpsServer = https.createServer
	const shortenDeadline = <T extends http.Server>(server: T) =>
		Object.assign(server, {requestTimeout: 1000, headersTimeout: 500, connectionsCheckingInterval: 50})
	const httpSpy = vi
		.spyOn(http, 'createServer')
		.mockImplementation((...args) => shortenDeadline(createHttpServer(...args)))
	const httpsSpy = vi
		.spyOn(https, 'createServer')
		.mockImplementation((...args) => shortenDeadline(createHttpsServer(...args)))
	try {
		if (gateway) {
			const auth = {
				authenticate: async (token: string) => {
					if (token !== 'upload-session') throw new Error('Unauthorized')
					return {accountId: 'owner'}
				},
				authorizeApp: async () => {},
				appAccessRevision: 0,
				registerAppSocket: () => true,
			}
			const server = new AppGateway({logger, auth} as never, {
				appId: 'upload-test',
				appName: 'Upload test',
				appIcon: '',
				targetProtocol: 'http',
				targetHost: '127.0.0.1',
				targetPort: upstreamPort,
				auth: true,
				authWhitelist: [],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 0,
			}).server
			expect(server.headersTimeout).toBe(500)
			// HTTP goes straight to the gateway; HTTPS terminates at LAN ingress first.
			if (protocol === 'http') return server
			upstreamPort = await listen(server)
		}
		return protocol === 'http'
			? ingress.createHttpProxyServer(upstreamPort, 'http')
			: // Match app routes, which don't add X-Forwarded-For in front of the gateway.
				await ingress.createHttpsProxyServer(upstreamPort, {includeForwardedFor: !gateway})
	} finally {
		httpSpy.mockRestore()
		httpsSpy.mockRestore()
	}
}

function upload(protocol: 'http' | 'https', port: number) {
	return new Promise<{status: number | undefined; body: Buffer}>((resolve, reject) => {
		const client = protocol === 'http' ? http : https
		const request = client.request(
			{
				hostname: '127.0.0.1',
				port,
				method: 'POST',
				agent: false,
				rejectUnauthorized: false,
				headers: {
					'content-length': chunk.length * chunkCount,
					cookie: `${protocol === 'https' ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME}=upload-session`,
				},
			},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (data: Buffer) => chunks.push(data))
				response.on('error', reject)
				response.on('end', () => {
					request.destroy()
					resolve({status: response.statusCode, body: Buffer.concat(chunks)})
				})
			},
		)
		request.on('error', reject)
		request.flushHeaders()
		let sent = 0
		// Keep sending data throughout the upload, so this is a total request
		// deadline regression rather than an idle socket timeout.
		const timer = setInterval(() => {
			request.write(chunk)
			if (++sent === chunkCount) {
				clearInterval(timer)
				request.end()
			}
		}, 100)
		request.once('close', () => clearInterval(timer))
	})
}

test.each(routes)(
	'$protocol proxies an active upload beyond the request deadline (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const upstream = http.createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', (data: Buffer) => chunks.push(data))
			request.on('error', () => {})
			request.on('end', () => response.end(Buffer.concat(chunks)))
		})
		upstream.requestTimeout = 0
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		expect(proxy.headersTimeout).toBe(500)
		const response = await upload(protocol, await listen(proxy))
		expect(response.status).toBe(200)
		expect(response.body).toEqual(Buffer.concat(Array.from({length: chunkCount}, () => chunk)))
	},
)

test.each(routes)(
	'$protocol preserves an upstream upload deadline (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		let upstreamErrorCode: string | undefined
		const upstream = http.createServer({connectionsCheckingInterval: 50}, (request, response) => {
			request.on('error', () => {})
			request.resume()
			request.on('end', () => response.end('completed'))
		})
		upstream.requestTimeout = 500
		upstream.headersTimeout = 250
		upstream.on('clientError', (error, socket) => {
			upstreamErrorCode = (error as NodeJS.ErrnoException).code
			socket.destroy()
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const response = upload(protocol, await listen(proxy))
		if (gateway) {
			// The app gateway translates upstream connection failures into its error page.
			expect((await response).status).toBe(502)
		} else {
			await expect(response).rejects.toMatchObject({code: 'ECONNRESET'})
		}
		expect(upstreamErrorCode).toBe('ERR_HTTP_REQUEST_TIMEOUT')
	},
)

function post(protocol: 'http' | 'https', port: number, headers: http.OutgoingHttpHeaders) {
	return new Promise<{status: number | undefined; body: string}>((resolve, reject) => {
		const client = protocol === 'http' ? http : https
		const request = client.request(
			{hostname: '127.0.0.1', port, method: 'POST', agent: false, rejectUnauthorized: false, headers},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (data: Buffer) => chunks.push(data))
				response.on('error', reject)
				response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString()}))
			},
		)
		request.on('error', reject)
		// Like curl, wait for 100 Continue before sending the body.
		if (headers.expect) request.once('continue', () => request.end(chunk))
		else request.end(chunk)
	})
}

// Only the app session cookie for the original protocol is valid, so the
// gateway must know whether the request arrived over HTTPS to authenticate it.
function sessionCookies(protocol: 'http' | 'https') {
	const sessionCookie = protocol === 'https' ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME
	const otherSessionCookie = protocol === 'https' ? APP_GATEWAY_HTTP_COOKIE_NAME : APP_GATEWAY_HTTPS_COOKIE_NAME
	return [
		`${otherSessionCookie}=stale-session`,
		...BROWSER_SESSION_COOKIE_NAMES.map((name) => `${name}=browser-session`),
		'UMBREL_PROXY_TOKEN=legacy-token',
		`${sessionCookie}=upload-session`,
		'app-cookie=preserved',
	].join('; ')
}

function forwardedHeaders(request: http.IncomingMessage) {
	return JSON.stringify({
		cookie: request.headers.cookie,
		proto: request.headers['x-forwarded-proto'],
		host: request.headers['x-forwarded-host'],
	})
}

// http-proxy skips onProxyReq for requests with an Expect header, so check
// what reaches the upstream both with and without one.
test.each(routes.flatMap((route) => [false, true].map((expectContinue) => ({...route, expectContinue}))))(
	'$protocol forwards the original protocol and strips Umbrel cookies (app gateway: $gateway, Expect: $expectContinue)',
	async ({protocol, gateway, expectContinue}) => {
		const upstream = http.createServer((request, response) => {
			request.resume()
			request.on('end', () => response.end(forwardedHeaders(request)))
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const port = await listen(proxy)
		const response = await post(protocol, port, {
			'content-length': chunk.length,
			cookie: sessionCookies(protocol),
			...(expectContinue ? {expect: '100-continue'} : {}),
		})

		expect(response.status).toBe(200)
		const received = JSON.parse(response.body)
		expect(received.proto).toBe(protocol)
		expect(received.host).toBe(`127.0.0.1:${port}`)
		if (gateway) expect(received.cookie).toBe('app-cookie=preserved')
	},
)

test.each(routes)(
	'$protocol forwards the original protocol and strips Umbrel cookies from WebSockets (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const upstream = http.createServer((request, response) => {
			request.resume()
			request.on('end', () => response.end())
		})
		const webSocketServer = new WebSocketServer({server: upstream})
		webSocketServer.on('connection', (socket, request) => socket.send(forwardedHeaders(request)))
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const port = await listen(proxy)
		const cookie = sessionCookies(protocol)

		const openWebSocket = async () => {
			const socket = new WebSocket(`${protocol === 'https' ? 'wss' : 'ws'}://127.0.0.1:${port}/`, {
				headers: {cookie},
				rejectUnauthorized: false,
			})
			socket.on('error', () => {})
			const [message] = await once(socket, 'message')
			socket.terminate()
			const received = JSON.parse(message.toString())
			// The gateway doesn't add forwarded headers to upgrades, but it can only
			// authenticate an HTTPS one if LAN ingress forwarded the original protocol.
			if (gateway) {
				expect(received.cookie).toBe('app-cookie=preserved')
			} else {
				expect(received.proto).toBe(protocol)
				expect(received.host).toBe(`127.0.0.1:${port}`)
			}
		}

		await openWebSocket()
		// http-proxy-middleware would subscribe its own upgrade listener once a proxy
		// has served an HTTP request, so check upgrades after one as well.
		expect((await post(protocol, port, {'content-length': chunk.length, cookie})).status).toBe(200)
		await openWebSocket()
		webSocketServer.close()
	},
)

test.each(routes)(
	'$protocol closes an upgrade request that has a body without crashing (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const upstream = http.createServer((request, response) => {
			request.resume()
			request.on('end', () => response.end())
		})
		const webSocketServer = new WebSocketServer({server: upstream})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const port = await listen(proxy)
		const cookie = sessionCookies(protocol)
		expect((await post(protocol, port, {'content-length': chunk.length, cookie})).status).toBe(200)

		// Node.js 26 hands upgrade listeners a stream wrapper rather than the socket
		// when the request declares a body that hasn't arrived yet. http-proxy can't
		// proxy that and used to crash umbreld with an unhandled rejection.
		const socket =
			protocol === 'https'
				? tls.connect({host: '127.0.0.1', port, rejectUnauthorized: false})
				: net.connect({host: '127.0.0.1', port})
		socket.on('error', () => {})
		await once(socket, protocol === 'https' ? 'secureConnect' : 'connect')
		socket.write(
			`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
				`Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: ${cookie}\r\n` +
				'Content-Length: 1\r\n\r\n',
		)
		await once(socket, 'close')

		// The proxy is still serving
		expect((await post(protocol, port, {'content-length': chunk.length, cookie})).status).toBe(200)
		webSocketServer.close()
	},
)

function* endless() {
	while (true) yield chunk
}

function request(
	protocol: 'http' | 'https',
	port: number,
	expectContinue: boolean,
	onResponse: (request: http.ClientRequest, response: http.IncomingMessage) => void,
) {
	const client = protocol === 'http' ? http : https
	const clientRequest = client.request(
		{
			hostname: '127.0.0.1',
			port,
			method: 'POST',
			agent: false,
			rejectUnauthorized: false,
			headers: {
				'content-length': chunk.length,
				cookie: sessionCookies(protocol),
				...(expectContinue ? {expect: '100-continue'} : {}),
			},
		},
		(response) => onResponse(clientRequest, response),
	)
	if (expectContinue) clientRequest.once('continue', () => clientRequest.end(chunk))
	else clientRequest.end(chunk)
	return clientRequest
}

// http-proxy only aborts the upstream when the client request emits 'aborted',
// which Node doesn't emit once the request body has been read. An abandoned
// download must not leave the upstream response paused forever, or count as an
// upstream failure.
test.each(routes.flatMap((route) => [false, true].map((expectContinue) => ({...route, expectContinue}))))(
	'$protocol releases the upstream when a client abandons a response (app gateway: $gateway, Expect: $expectContinue)',
	async ({protocol, gateway, expectContinue}) => {
		const errors = vi.spyOn(logger, 'error')
		let upstreamClosed!: Promise<boolean>
		const upstream = http.createServer((request, response) => {
			upstreamClosed = once(response, 'close').then(() => response.writableFinished)
			request.resume()
			// Stream until the proxy stops reading, like a large file or media response.
			request.on('end', () => Readable.from(endless()).pipe(response))
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const port = await listen(proxy)

		await new Promise<void>((resolve, reject) => {
			request(protocol, port, expectContinue, (clientRequest, response) => {
				expect(response.statusCode).toBe(200)
				let received = 0
				response.on('data', (data: Buffer) => {
					received += data.length
					if (received < 1024 * 1024) return
					clientRequest.destroy()
					resolve()
				})
			}).on('error', reject)
		})

		await expect(upstreamClosed).resolves.toBe(false)
		expect(errors).not.toHaveBeenCalled()
	},
	5000,
)

// Requests with an Expect header aren't covered until upstream replies, since
// http-proxy skips onProxyReq for them. http-proxy reports the cancelled upstream
// request as a client reset, which must not count as an upstream failure.
test.each(routes)(
	'$protocol releases the upstream when a client gives up before it replies (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const errors = vi.spyOn(logger, 'error')
		const verbose = vi.spyOn(logger, 'verbose')
		let received!: (request: http.IncomingMessage) => void
		const upstreamRequest = new Promise<http.IncomingMessage>((resolve) => (received = resolve))
		const upstream = http.createServer((request) => {
			request.resume()
			received(request)
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const clientRequest = request(protocol, await listen(proxy), false, () => {})
		clientRequest.on('error', () => {})

		const {socket} = await upstreamRequest
		clientRequest.destroy()
		await once(socket, 'close')
		expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('App gateway upstream error'), expect.anything())
		expect(verbose).not.toHaveBeenCalledWith(expect.stringContaining('LAN ingress proxy error'))
	},
	5000,
)

test.each(routes)(
	'$protocol closes the client when the upstream response is cut short (app gateway: $gateway)',
	async ({protocol, gateway}) => {
		const upstream = http.createServer((request, response) => {
			request.resume()
			request.on('end', () => {
				response.writeHead(200, {'content-length': chunk.length * 2})
				response.write(chunk, () => response.socket?.destroy())
			})
		})
		const proxy = await createProxy(protocol, await listen(upstream), gateway)
		const port = await listen(proxy)

		const closed = new Promise<boolean>((resolve) => {
			request(protocol, port, false, (_request, response) => {
				response.resume()
				response.on('error', () => {})
				response.on('close', () => resolve(response.complete))
			}).on('error', () => {})
		})
		await expect(closed).resolves.toBe(false)
	},
	5000,
)
