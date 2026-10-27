import {execFile} from 'node:child_process'
import {once} from 'node:events'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {afterEach, describe, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import {WebSocket, WebSocketServer} from 'ws'

import temporaryDirectory from '../utilities/temporary-directory.ts'
import AppGateway, {pathMatches, readAppGatewayConfig} from './app-gateway.ts'
import {appGatewayErrorPage} from './error-page.ts'

describe('app gateway configuration', () => {
	const directories: Array<ReturnType<typeof temporaryDirectory>> = []

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => directory.destroyRoot()))
	})

	test('reads existing app_proxy settings without adding the service to umbreld', async () => {
		const config = await readAppGatewayConfig(
			'files',
			'/does-not-exist',
			{
				services: {
					app_proxy: {
						environment: {
							APP_HOST: 'files_web_1',
							APP_PORT: 8080,
							PROXY_AUTH_WHITELIST: '/public/*, /health',
							PROXY_AUTH_BLACKLIST: '/public/private/*',
						},
					},
				},
			},
			{name: 'Files', icon: 'https://example.com/files.svg'},
		)

		expect(config).toMatchObject({
			appId: 'files',
			appName: 'Files',
			appIcon: 'https://example.com/files.svg',
			targetProtocol: 'http',
			targetHost: 'files_web_1',
			targetPort: 8080,
			auth: true,
			authWhitelist: ['/public/*', '/health'],
			authBlacklist: ['/public/private/*'],
		})
	})

	test('rejects app_proxy settings without an upstream', async () => {
		await expect(readAppGatewayConfig('files', '/does-not-exist', {services: {app_proxy: {}}})).resolves.toBeNull()
	})

	test('prefers Compose-rendered settings and reads legacy overrides from the app root', async () => {
		const directory = temporaryDirectory()
		directories.push(directory)
		await directory.createRoot()
		const appDirectory = await directory.create()
		await fse.writeJson(`${appDirectory}/app-gateway.json`, {
			APP_HOST: '10.21.21.2',
			APP_PORT: '3000',
			PROXY_AUTH_ADD: 'true',
		})
		await fse.writeFile(`${appDirectory}/.env.app_proxy`, 'APP_PORT=4000\nPROXY_AUTH_ADD=\n')

		const config = await readAppGatewayConfig('files', appDirectory, {
			services: {app_proxy: {environment: {APP_HOST: '$APP_FILES_IP', APP_PORT: '$APP_FILES_PORT'}}},
		})

		expect(config).toMatchObject({targetHost: '10.21.21.2', targetPort: 4000, auth: true})
	})

	test('only disables authentication for an explicit false value', async () => {
		for (const [value, expected] of [
			[undefined, true],
			[null, true],
			['', true],
			['true', true],
			['false', false],
		] as const) {
			const config = await readAppGatewayConfig('files', '/does-not-exist', {
				services: {
					app_proxy: {
						environment: {APP_HOST: 'files_web_1', APP_PORT: 8080, PROXY_AUTH_ADD: value} as any,
					},
				},
			})
			expect(config?.auth).toBe(expected)
		}
	})
})

describe('app gateway path rules', () => {
	test('preserves exact, child, prefix, and wildcard matching', () => {
		expect(pathMatches('/admin', ['/admin'])).toBe(true)
		expect(pathMatches('/admin/user', ['/admin'])).toBe(false)
		expect(pathMatches('/admin/user', ['/admin/*'])).toBe(true)
		expect(pathMatches('/administrator', ['/admin/*'])).toBe(false)
		expect(pathMatches('/administrator', ['/admin*'])).toBe(true)
		expect(pathMatches('/anything', ['*'])).toBe(true)
	})
})

describe('app gateway upstream recovery', () => {
	function unreachableGateway(onUpstreamUnavailable = vi.fn()) {
		const logger = {error: vi.fn()}
		return {
			gateway: new AppGateway(
				{logger, auth: {appAccessRevision: 0}} as never,
				{
					appId: 'files',
					appName: 'Files',
					appIcon: 'https://example.com/files.svg',
					targetProtocol: 'http',
					targetHost: 'files_web_1',
					targetAddress: '127.0.0.1',
					targetPort: 1,
					auth: false,
					authWhitelist: [],
					authBlacklist: [],
					trustUpstream: false,
					timeout: 100,
				},
				{onUpstreamUnavailable},
			),
			logger,
			onUpstreamUnavailable,
		}
	}

	test('returns the branded app error page and notifies LAN ingress when the upstream is unreachable', async () => {
		const {gateway, onUpstreamUnavailable} = unreachableGateway()
		await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve))
		try {
			const address = gateway.server.address()
			if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')
			const response = await fetch(`http://127.0.0.1:${address.port}/`)
			expect(response.status).toBe(502)
			expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
			expect(response.headers.get('cache-control')).toBe('no-store')
			const body = await response.text()
			expect(body).toContain('Oops, there was an error')
			expect(body).toContain('There was an error connecting to Files.')
			expect(body).toContain('Error code: ECONNREFUSED')
			expect(body).toContain('src="https://example.com/files.svg"')
			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(1)
		} finally {
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
	})

	test('closes a failed upstream WebSocket without crashing the gateway', async () => {
		const {gateway, onUpstreamUnavailable} = unreachableGateway()
		await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve))
		try {
			const address = gateway.server.address()
			if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')

			await new Promise<void>((resolve, reject) => {
				const socket = new WebSocket(`ws://127.0.0.1:${address.port}/socket`)
				const timeout = setTimeout(() => {
					socket.terminate()
					reject(new Error('Failed upstream WebSocket did not close'))
				}, 2_000)
				socket.once('open', () => reject(new Error('WebSocket unexpectedly connected to unreachable upstream')))
				socket.once('error', () => {})
				socket.once('close', () => {
					clearTimeout(timeout)
					resolve()
				})
			})

			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(1)
			// A subsequent request proves the asynchronous WebSocket failure did not
			// terminate or wedge the gateway.
			const response = await fetch(`http://127.0.0.1:${address.port}/`)
			expect(response.status).toBe(502)
			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(2)
		} finally {
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
	})
})

describe('app gateway client lifetime', () => {
	async function createGateway(
		upstream: net.Server,
		{auth = true, authenticate = async () => ({accountId: 'owner'})} = {},
	) {
		upstream.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		const upstreamAddress = upstream.address() as net.AddressInfo
		const logger = {error: vi.fn()}
		const onUpstreamUnavailable = vi.fn()
		const authService = {
			authenticate,
			authorizeApp: async () => {},
			appAccessRevision: 0,
			registerAppSocket: () => true,
		}
		const gateway = new AppGateway(
			{logger, auth: authService} as never,
			{
				appId: 'lifetime',
				appName: 'Lifetime',
				appIcon: '',
				targetProtocol: 'http',
				targetHost: '127.0.0.1',
				targetPort: upstreamAddress.port,
				auth,
				authWhitelist: [],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 0,
			},
			{onUpstreamUnavailable},
		)
		gateway.server.listen(0, '127.0.0.1')
		await once(gateway.server, 'listening')
		const client = net.connect((gateway.server.address() as net.AddressInfo).port, '127.0.0.1')
		client.on('error', () => {})
		await once(client, 'connect')
		const close = async () => {
			client.destroy()
			gateway.server.closeAllConnections()
			upstream.close()
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
		return {client, logger, onUpstreamUnavailable, close}
	}

	test('does not treat a client dropping a WebSocket as an upstream failure', async () => {
		const upstream = http.createServer()
		const webSocketServer = new WebSocketServer({server: upstream})
		webSocketServer.on('connection', (socket) => {
			socket.on('error', () => {})
			socket.send('connected')
		})
		const {client, logger, onUpstreamUnavailable, close} = await createGateway(upstream)
		try {
			client.write(
				'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
			)
			const [data] = await once(client, 'data')
			expect(data.toString()).toMatch(/^HTTP\/1\.1 101 /)
			client.resetAndDestroy()
			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(logger.error).not.toHaveBeenCalled()
			expect(onUpstreamUnavailable).not.toHaveBeenCalled()
		} finally {
			webSocketServer.close()
			await close()
		}
	})

	test('closes the response without treating an upstream that cuts it short as unavailable', async () => {
		const upstream = net.createServer((socket) => {
			socket.on('error', () => {})
			socket.once('data', () => {
				socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\npartial')
				setTimeout(() => socket.destroy(), 50)
			})
		})
		const {client, logger, onUpstreamUnavailable, close} = await createGateway(upstream, {auth: false})
		try {
			client.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
			let received = ''
			client.on('data', (data) => (received += data))
			await once(client, 'close')
			expect(received).toMatch(/^HTTP\/1\.1 200 OK\r\n[\s\S]*\r\n\r\npartial$/)
			expect(logger.error).not.toHaveBeenCalled()
			expect(onUpstreamUnavailable).not.toHaveBeenCalled()
		} finally {
			await close()
		}
	})

	test('does not treat a client dropping a WebSocket before the app accepts it as an upstream failure', async () => {
		const upstream = http.createServer()
		upstream.on('upgrade', (_request, socket) => {
			socket.on('error', () => {})
			setTimeout(() => socket.destroy(), 500)
		})
		const {client, logger, onUpstreamUnavailable, close} = await createGateway(upstream)
		try {
			client.write(
				'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
			)
			await new Promise((resolve) => setTimeout(resolve, 100))
			client.resetAndDestroy()
			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(logger.error).not.toHaveBeenCalled()
			expect(onUpstreamUnavailable).not.toHaveBeenCalled()
		} finally {
			await close()
		}
	})

	// The proxy only releases the upstream when the client leaves after proxying
	// has started.
	test('does not open an upstream connection for a client that left during authorization', async () => {
		let upstreamConnections = 0
		const upstream = net.createServer((socket) => {
			upstreamConnections++
			socket.on('error', () => {})
		})
		let authorized!: () => void
		const authorization = new Promise<void>((resolve) => (authorized = resolve))
		const {client, close} = await createGateway(upstream, {
			authenticate: async () => {
				await authorization
				return {accountId: 'owner'}
			},
		})
		try {
			client.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
			await new Promise((resolve) => setTimeout(resolve, 50))
			client.destroy()
			await new Promise((resolve) => setTimeout(resolve, 50))
			authorized()
			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(upstreamConnections).toBe(0)
		} finally {
			await close()
		}
	})
})

describe('app gateway request targets', () => {
	test('sends the upstream the path the authorization check read', async () => {
		const upstreamTargets: string[] = []
		const upstream = http.createServer((request, response) => {
			upstreamTargets.push(request.url!)
			response.end('ok')
		})
		upstream.on('upgrade', (request, socket) => {
			upstreamTargets.push(request.url!)
			socket.destroy()
		})
		upstream.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		const gateway = new AppGateway(
			{
				logger: {error: vi.fn()},
				auth: {
					authenticate: async () => {
						throw new Error('Not logged in')
					},
					appAccessRevision: 0,
				},
			} as never,
			{
				appId: 'targets',
				appName: 'Targets',
				appIcon: '',
				targetProtocol: 'http',
				targetHost: '127.0.0.1',
				targetPort: (upstream.address() as net.AddressInfo).port,
				auth: true,
				authWhitelist: ['/api/*'],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 0,
			},
		)
		gateway.server.listen(0, '127.0.0.1')
		await once(gateway.server, 'listening')
		const send = async (request: string) => {
			const client = net.connect((gateway.server.address() as net.AddressInfo).port, '127.0.0.1')
			client.on('error', () => {})
			client.write(request)
			let data = ''
			client.on('data', (chunk) => (data += chunk))
			await once(client, 'close')
			return data.split('\r\n')[0]
		}
		try {
			for (const target of [
				'/api/x#/../../admin',
				'/api\\x?q=\\',
				'http://other/api/x?y=1',
				'//api//x',
				'foo://h/api\\x',
				'/api//[',
				'/api/http://other//x',
			]) {
				expect(await send(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 200 OK')
			}
			for (const target of ['/api//../admin', '/api/\\../admin', 'foo://h/\\admin/api/x', '/api/http:/../../admin']) {
				expect(await send(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 302 Found')
			}
			await send(
				'GET //api/socket#/../../admin HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
			)
			expect(upstreamTargets).toEqual([
				'/api/x',
				'/api/x?q=\\',
				'/api/x?y=1',
				'/api/x',
				'/api/x',
				'/api/[',
				'/api/http://other/x',
				'/api/socket',
			])
		} finally {
			gateway.server.closeAllConnections()
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
			upstream.closeAllConnections()
			await new Promise<void>((resolve) => upstream.close(() => resolve()))
		}
	})
})

describe('app gateway HTTPS upstreams', () => {
	test('connects to an HTTPS upstream addressed by IP', async () => {
		const directory = temporaryDirectory()
		await directory.createRoot()
		try {
			const keyPath = nodePath.join(await directory.create(), 'key.pem')
			const certificatePath = `${keyPath}.crt`
			await promisify(execFile)('openssl', [
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-days',
				'1',
				'-keyout',
				keyPath,
				'-out',
				certificatePath,
				'-subj',
				'/CN=127.0.0.1',
			])
			const upstream = https.createServer({key: await fse.readFile(keyPath), cert: await fse.readFile(certificatePath)})
			const connections: unknown[] = []
			upstream.on('connection', (socket) => connections.push(socket))
			upstream.on('tlsClientError', () => {})
			upstream.listen(0, '127.0.0.1')
			await once(upstream, 'listening')
			const upstreamAddress = upstream.address()
			if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('Upstream did not listen on TCP')
			const gateway = new AppGateway({logger: {error: vi.fn()}, auth: {appAccessRevision: 0}} as never, {
				appId: 'secure',
				appName: 'Secure',
				appIcon: '',
				targetProtocol: 'https',
				targetHost: '127.0.0.1',
				targetAddress: '127.0.0.1',
				targetPort: upstreamAddress.port,
				auth: false,
				authWhitelist: [],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 1000,
			})
			gateway.server.listen(0, '127.0.0.1')
			await once(gateway.server, 'listening')
			try {
				const address = gateway.server.address()
				if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')
				// The self-signed certificate is rejected, but only after connecting.
				// Node.js 25+ throws before connecting if given an IP as the TLS server name.
				await fetch(`http://127.0.0.1:${address.port}/`)
				expect(connections).toHaveLength(1)
			} finally {
				await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
				upstream.closeAllConnections()
				await new Promise<void>((resolve) => upstream.close(() => resolve()))
			}
		} finally {
			await directory.destroyRoot()
		}
	})
})

describe('app gateway malformed upstream responses', () => {
	test('closes the response without crashing when the upstream sends data after its declared body', async () => {
		// Like Collabora's PHP proxy, answer /malformed with a Connection: close
		// response followed by a second response in the same write. Node's parser
		// fails on the extra bytes after the first response has started piping.
		const upstream = net.createServer((socket) => {
			socket.on('error', () => {})
			socket.once('data', (data) => {
				const body = 'x'.repeat(1000)
				const response = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`
				const extra = data.toString().startsWith('GET /malformed ')
					? 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nextra'
					: ''
				socket.end(response + extra)
			})
		})
		upstream.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		const upstreamAddress = upstream.address()
		if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('Upstream did not listen on TCP')
		const gateway = new AppGateway({logger: {error: vi.fn()}, auth: {appAccessRevision: 0}} as never, {
			appId: 'nextcloud',
			appName: 'Nextcloud',
			appIcon: '',
			targetProtocol: 'http',
			targetHost: 'nextcloud_web_1',
			targetAddress: '127.0.0.1',
			targetPort: upstreamAddress.port,
			auth: false,
			authWhitelist: [],
			authBlacklist: [],
			trustUpstream: false,
			timeout: 1000,
		})
		const uncaughtErrors: unknown[] = []
		const onUncaughtError = (error: unknown) => uncaughtErrors.push(error)
		process.on('uncaughtException', onUncaughtError)
		gateway.server.listen(0, '127.0.0.1')
		await once(gateway.server, 'listening')
		try {
			const address = gateway.server.address()
			if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')

			await expect(
				fetch(`http://127.0.0.1:${address.port}/malformed`).then((response) => response.text()),
			).rejects.toThrow()

			// A subsequent request proves the failure did not terminate or wedge the gateway.
			const response = await fetch(`http://127.0.0.1:${address.port}/`)
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('x'.repeat(1000))
			expect(uncaughtErrors).toEqual([])
		} finally {
			process.off('uncaughtException', onUncaughtError)
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
			await new Promise<void>((resolve) => upstream.close(() => resolve()))
		}
	})
})

describe('app gateway error page', () => {
	test('escapes app metadata and error codes before rendering them as HTML', () => {
		const body = appGatewayErrorPage({
			appName: '<script>alert(1)</script>',
			appIcon: 'https://example.com/icon.svg" onerror="alert(1)',
			errorCode: '<BAD>',
		})

		expect(body).not.toContain('<script>')
		expect(body).not.toContain('onerror="alert(1)')
		expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
		expect(body).toContain('icon.svg&quot; onerror=&quot;alert(1)')
		expect(body).toContain('Error code: &lt;BAD&gt;')
	})
})
