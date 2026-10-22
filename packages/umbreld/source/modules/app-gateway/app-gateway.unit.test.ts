import {execFile} from 'node:child_process'
import {once} from 'node:events'
import https from 'node:https'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {afterEach, describe, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import {WebSocket} from 'ws'

import temporaryDirectory from '../utilities/temporary-directory.js'
import AppGateway, {pathMatches, readAppGatewayConfig} from './app-gateway.js'
import {appGatewayErrorPage} from './error-page.js'

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
