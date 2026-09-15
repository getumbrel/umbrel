import http from 'node:http'
import net from 'node:net'
import {mkdtemp} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {describe, expect, test, vi} from 'vitest'

const {dockerCommand, execaDollar} = vi.hoisted(() => {
	const dockerCommand = vi.fn()
	return {dockerCommand, execaDollar: vi.fn(() => dockerCommand)}
})

vi.mock('execa', () => ({$: execaDollar}))

import LanIngress, {appAuthDashboardRedirect} from './lan-ingress.js'

describe('LAN ingress shutdown', () => {
	test('drains an active HTTP response while closing an upgraded socket', async () => {
		let releaseResponse = () => {}
		const waitForRelease = new Promise<void>((resolve) => (releaseResponse = resolve))
		let markRequestStarted = () => {}
		const requestStarted = new Promise<void>((resolve) => (markRequestStarted = resolve))
		const server = http.createServer(async (_request, response) => {
			markRequestStarted()
			await waitForRelease
			response.end('accepted')
		})
		server.on('upgrade', (_request, socket) => {
			socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
		})
		const logger = {createChildLogger: () => logger}
		const ingress = new LanIngress({dataDirectory: '/tmp', logger} as never) as unknown as {
			trackServerSockets(server: http.Server): void
			closeServer(server: http.Server, options: {drainActiveResponses: boolean}): Promise<void>
		}
		ingress.trackServerSockets(server)
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
		const upgradedSocket = net.createConnection({host: '127.0.0.1', port: address.port})
		const upgradedSocketClosed = new Promise<void>((resolve) => upgradedSocket.once('close', resolve))
		upgradedSocket.write('GET /events HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
		await new Promise<void>((resolve) => upgradedSocket.once('data', () => resolve()))

		const responsePromise = fetch(`http://127.0.0.1:${address.port}`)
		await requestStarted
		const closeStartedAt = Date.now()
		const closePromise = ingress.closeServer(server, {drainActiveResponses: true})
		releaseResponse()

		const response = await responsePromise
		expect(await response.text()).toBe('accepted')
		await closePromise
		await upgradedSocketClosed
		expect(Date.now() - closeStartedAt).toBeLessThan(1000)
	})
})

describe('app auth navigation redirect', () => {
	test.each([
		{
			name: 'HTTP root',
			input: {protocol: 'http' as const, host: 'umbrel.local:2000', url: '/', method: 'GET', accept: 'text/html'},
			expected: 'http://umbrel.local/',
		},
		{
			name: 'HTTPS dashboard path',
			input: {
				protocol: 'https' as const,
				host: 'umbrel.local:2000',
				url: '/settings?dialog=about',
				method: 'GET',
				accept: 'text/html,application/xhtml+xml',
			},
			expected: 'https://umbrel.local/settings?dialog=about',
		},
		{
			name: 'IPv6 host',
			input: {protocol: 'http' as const, host: '[fd00::1]:2000', url: '/', method: 'GET', accept: 'text/html'},
			expected: 'http://[fd00::1]/',
		},
		{
			name: 'HTTP protocol-relative request target',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '//attacker.example:2000/phish?from=umbrel',
				method: 'GET',
				accept: 'text/html',
			},
			expected: 'http://umbrel.local/phish?from=umbrel',
		},
		{
			name: 'HTTPS protocol-relative request target',
			input: {
				protocol: 'https' as const,
				host: 'umbrel.local:2000',
				url: '//attacker.example:2000/phish?from=umbrel',
				method: 'GET',
				accept: 'text/html',
			},
			expected: 'https://umbrel.local/phish?from=umbrel',
		},
	])('redirects a $name navigation to the main dashboard origin', ({input, expected}) => {
		expect(appAuthDashboardRedirect(input)).toBe(expected)
	})

	test.each([
		{
			name: 'allowed app-auth page',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '/app-auth?app=files',
				method: 'GET',
				accept: 'text/html',
			},
		},
		{
			name: 'Tor auth hidden service',
			input: {
				protocol: 'http' as const,
				host: `${'a'.repeat(56)}.onion`,
				url: '/',
				method: 'GET',
				accept: 'text/html',
			},
		},
		{
			name: 'API request',
			input: {
				protocol: 'http' as const,
				host: 'umbrel.local:2000',
				url: '/unexpected',
				method: 'POST',
				accept: 'application/json',
			},
		},
	])('does not redirect an $name', ({input}) => {
		expect(appAuthDashboardRedirect(input)).toBeUndefined()
	})
})

describe('LAN ingress app targets', () => {
	test('retries an app gateway upstream until it accepts connections', async () => {
		const dataDirectory = await mkdtemp(path.join(tmpdir(), 'umbreld-lan-ingress-'))
		const appId = 'files'
		const appDataDirectory = path.join(dataDirectory, 'app-data', appId)
		const upstream = net.createServer()
		const portReservation = net.createServer()

		try {
			await new Promise<void>((resolve) => portReservation.listen(0, '127.0.0.1', resolve))
			const address = portReservation.address()
			if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
			await new Promise<void>((resolve, reject) =>
				portReservation.close((error) => (error ? reject(error) : resolve())),
			)

			await fse.ensureDir(appDataDirectory)
			await fse.writeFile(
				path.join(appDataDirectory, 'docker-compose.yml'),
				yaml.dump({services: {app_proxy: {environment: {APP_HOST: '127.0.0.1', APP_PORT: address.port}}}}),
			)

			const logger = {createChildLogger: () => logger, error: vi.fn()}
			const ingress = new LanIngress({dataDirectory, logger, port: 0} as never)
			const internals = ingress as unknown as {
				resolveAppTarget(appId: string, host: string, compose: unknown): Promise<string | null>
			}
			const resolveTarget = vi.spyOn(internals, 'resolveAppTarget')
			setTimeout(() => upstream.listen(address.port, '127.0.0.1'), 100)
			await expect(ingress.waitForAppUpstream(appId)).resolves.toBeUndefined()
			expect(upstream.listening).toBe(true)
			expect(resolveTarget).toHaveBeenCalledTimes(1)

			resolveTarget.mockRejectedValueOnce(new Error('Docker unavailable'))
			await expect(ingress.waitForAppUpstream(appId)).resolves.toBeUndefined()
			expect(logger.error).toHaveBeenCalledTimes(1)
		} finally {
			if (upstream.listening) {
				await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())))
			}
			if (portReservation.listening) {
				await new Promise<void>((resolve, reject) =>
					portReservation.close((error) => (error ? reject(error) : resolve())),
				)
			}
			await fse.remove(dataDirectory)
		}
	})

	test('resolves a compose container on the Umbrel network', async () => {
		dockerCommand.mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({
				umbrel_main_network: {IPAddress: '10.21.0.3'},
				other_network: {IPAddress: '172.18.0.2'},
			}),
		})
		const logger = {createChildLogger: () => logger}
		const ingress = new LanIngress({dataDirectory: '/tmp', logger} as never) as unknown as {
			inspectContainerAddress(container: string): Promise<string | null>
		}

		await expect(ingress.inspectContainerAddress('transmission_server_1')).resolves.toBe('10.21.0.3')
		expect(dockerCommand.mock.calls[0]?.slice(1)).toEqual([
			'{{json .NetworkSettings.Networks}}',
			'transmission_server_1',
		])
	})

	test('coalesces failures and refreshes as soon as a replacement container gets a new IP', async () => {
		const logger = {createChildLogger: () => logger, log: vi.fn(), error: vi.fn()}
		const ingress = new LanIngress({dataDirectory: '/tmp', logger} as never)
		const internals = ingress as unknown as {
			resolveAppTarget(appId: string, host: string, compose: unknown): Promise<string | null>
			requestAppTargetRecovery(config: {
				appId: string
				targetHost: string
				targetAddress: string
			}): Promise<void> | undefined
		}
		const resolveTarget = vi
			.spyOn(internals, 'resolveAppTarget')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('10.21.0.9')
		const refresh = vi.spyOn(ingress, 'refresh').mockResolvedValue()
		const config = {appId: 'files', targetHost: 'files_web_1', targetAddress: '10.21.0.3'}

		const recovery = internals.requestAppTargetRecovery(config)
		expect(internals.requestAppTargetRecovery(config)).toBe(recovery)
		await recovery

		expect(resolveTarget).toHaveBeenCalledTimes(2)
		expect(refresh).toHaveBeenCalledTimes(1)

		// Further failures during the cooldown do not start another Docker probe.
		expect(internals.requestAppTargetRecovery(config)).toBeUndefined()
		expect(resolveTarget).toHaveBeenCalledTimes(2)
	})
})
