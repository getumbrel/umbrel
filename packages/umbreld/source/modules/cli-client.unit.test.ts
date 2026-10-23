import {createServer as createHttpServer} from 'node:http'
import {createServer, type AddressInfo} from 'node:net'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

let dataDir: string

// A port with nothing listening on it
async function closedPort() {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const {port} = server.address() as AddressInfo
	await new Promise((resolve) => server.close(resolve))
	return port
}

// The client reads its config and connects at import time, so each test gets a fresh module
async function importCliClient(port?: number) {
	vi.resetModules()
	vi.stubEnv('UMBREL_DATA_DIR', dataDir)
	vi.stubEnv('UMBREL_TRPC_ENDPOINT', `http://127.0.0.1:${port ?? (await closedPort())}/trpc`)
	const {cliClient} = await import('./cli-client.ts')
	return cliClient
}

beforeEach(async () => {
	dataDir = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbreld-cli-client-'))
})

afterEach(async () => {
	vi.unstubAllEnvs()
	await fse.remove(dataDir)
})

test(
	'a WebSocket mutation fails instead of hanging when the system token is unreadable',
	{timeout: 10_000},
	async () => {
		const cliClient = await importCliClient()
		await expect(cliClient({query: 'apps.update.mutate', args: ['--appId', 'example']})).rejects.toThrow(/system-token/)
	},
)

test('a subscription fails instead of hanging when the system token is unreadable', {timeout: 10_000}, async () => {
	const cliClient = await importCliClient()
	await expect(
		cliClient({query: 'eventBus.listen.subscribe', args: ['--event', 'files:watcher:change']}),
	).rejects.toThrow(/system-token/)
})

test('a WebSocket mutation fails instead of hanging when umbreld is unreachable', {timeout: 10_000}, async () => {
	await fse.outputFile(nodePath.join(dataDir, 'secrets/auth/system-token'), 'token')
	const cliClient = await importCliClient()
	await expect(cliClient({query: 'apps.update.mutate', args: ['--appId', 'example']})).rejects.toThrow(/fetch failed/)
})

test('an HTTP-only command is not failed by the WebSocket failing to connect', {timeout: 10_000}, async () => {
	await fse.outputFile(nodePath.join(dataDir, 'secrets/auth/system-token'), 'token')
	// Reject WebSocket tickets straight away, but answer the HTTP-only command after the WS client has given up
	const server = createHttpServer((request, response) => {
		response.setHeader('Content-Type', 'application/json')
		if (request.url?.startsWith('/trpc/user.createWebSocketTicket')) {
			response.statusCode = 401
			return response.end(
				JSON.stringify({error: {message: 'UNAUTHORIZED', code: -32001, data: {code: 'UNAUTHORIZED'}}}),
			)
		}
		setTimeout(() => response.end(JSON.stringify({result: {data: 'running'}})), 300)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	try {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		const cliClient = await importCliClient((server.address() as AddressInfo).port)
		await cliClient({query: 'system.status.query', args: []})
		expect(log).toHaveBeenCalledWith('"running"')
	} finally {
		vi.restoreAllMocks()
		server.closeAllConnections()
		await new Promise((resolve) => server.close(resolve))
	}
})
