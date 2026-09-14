import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import {Client, StreamableHTTPClientTransport, type CallToolResult} from '@modelcontextprotocol/client'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import runGitServer from '../test-utilities/run-git-server.js'

const appId = 'sparkles-hello-world'
const grantedDirectory = '/Home/mcp-vm-test'

describe('MCP', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let endpoint: URL
	let tokenId: string
	let token: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		gitServer = await runGitServer()
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		endpoint = new URL(`http://127.0.0.1:${umbreld.vm.httpPort}/mcp`)
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await gitServer?.close()
	})

	// This is one stateful lifecycle. Once a step fails, later expectations
	// would only report misleading cascade failures.
	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function connectMcp(candidateToken: string) {
		const client = new Client(
			{name: 'umbreld-mcp-vm', version: '1.0.0'},
			{versionNegotiation: {mode: {pin: '2026-07-28'}}},
		)
		const transport = new StreamableHTTPClientTransport(endpoint, {
			requestInit: {headers: {authorization: `Bearer ${candidateToken}`}},
		})
		try {
			await client.connect(transport)
			return client
		} catch (error) {
			await client.close().catch(() => {})
			throw error
		}
	}

	async function withMcp<T>(candidateToken: string, action: (client: Client) => Promise<T>) {
		const client = await connectMcp(candidateToken)
		try {
			return await action(client)
		} finally {
			await client.close()
		}
	}

	function toolText(result: CallToolResult) {
		const text = result.content.find((content) => content.type === 'text')
		if (!text || text.type !== 'text') throw new Error('Tool result did not contain text')
		return text.text
	}

	async function callTool<T>(client: Client, name: string, args: Record<string, unknown> = {}) {
		const result = await client.callTool({name, arguments: args})
		if (result.isError) throw new Error(toolText(result))
		return JSON.parse(toolText(result)) as T
	}

	async function uploadFile(path: string, contents: string) {
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: contents})
	}

	function transferUrl(direction: 'download' | 'upload', path: string) {
		const url = new URL(`${endpoint.pathname}/files/${direction}`, endpoint.origin)
		url.searchParams.set('path', path)
		return url
	}

	function downloadThroughMcp(path: string) {
		return fetch(transferUrl('download', path), {headers: {authorization: `Bearer ${token}`}})
	}

	function uploadThroughMcp(path: string, contents: Buffer) {
		return fetch(transferUrl('upload', path), {
			method: 'POST',
			headers: {authorization: `Bearer ${token}`},
			body: new Uint8Array(contents),
		})
	}

	async function waitForAppState(client: Client, state: string) {
		await pWaitFor(
			async () => {
				const latest = await callTool<{
					state: string
					lastOperationFailure: {message: string} | null
				}>(client, 'get_app_status', {appId})
				if (latest.lastOperationFailure) throw new Error(latest.lastOperationFailure.message)
				return latest.state === state
			},
			{interval: 1000, timeout: 180_000},
		)
	}

	test.sequential('rejects unauthenticated access and accepts only the issued token when enabled', async () => {
		await expect(umbreld.unauthenticatedClient.mcp.getSettings.query()).rejects.toThrow('Invalid token')
		expect((await fetch(endpoint, {method: 'POST'})).status).toBe(401)
		const credential = await umbreld.client.mcp.enable.mutate({label: 'VM test', agentType: 'generic'})
		if (!credential) throw new Error('Initial MCP enable did not issue a credential')
		;({id: tokenId, token} = credential)
		await expect(umbreld.client.mcp.getSettings.query()).resolves.toMatchObject({
			enabled: true,
			permissions: {
				apps: [],
				appStore: false,
				files: [],
				manageSystem: false,
			},
		})
		await expect(connectMcp('wrong')).rejects.toThrow()
		await withMcp(token, async (client) => {
			await expect(
				callTool<{state: string}>(client, 'get_app_status', {appId: 'not-installed'}),
			).resolves.toMatchObject({
				state: 'not-installed',
			})
		})
	})

	test.sequential('enforces a file grant and revokes it after the grant root is trashed', async () => {
		await umbreld.client.files.createDirectory.mutate({path: grantedDirectory})
		await uploadFile('/Home/mcp-private.txt', 'private')
		await umbreld.client.mcp.setPermissions.mutate({
			apps: [],
			appStore: false,
			files: [grantedDirectory],
			manageSystem: false,
			machines: [],
			createMachines: false,
		})

		await withMcp(token, async (client) => {
			const path = `${grantedDirectory}/round-trip.bin`
			const contents = Buffer.from([0, 1, 2, 3])
			const upload = await uploadThroughMcp(path, contents)
			expect(upload.status).toBe(200)
			await expect(upload.json()).resolves.toStrictEqual({path})

			const download = await downloadThroughMcp(path)
			expect(download.status).toBe(200)
			expect(Buffer.from(await download.arrayBuffer())).toStrictEqual(contents)
			expect((await downloadThroughMcp('/Home/mcp-private.txt')).status).toBe(403)

			await callTool(client, 'trash', {path: grantedDirectory})
		})

		// The grant must be gone when the trash operation completes.
		await expect(umbreld.client.mcp.getSettings.query()).resolves.toMatchObject({permissions: {files: []}})
	})

	test.sequential('installs and controls a real app', async () => {
		// Login becomes available while Apps is still starting. Wait for the shared
		// app framework before MCP asks it to install and start the fixture app.
		await pRetry(() => umbreld.vm.sshAsRoot("docker inspect --format '{{.State.Running}}' tor_proxy | grep -qx true"), {
			retries: 120,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})

		const repositoryUrl = gitServer.url.replace('localhost', '10.0.2.2')
		await umbreld.client.appStore.addRepository.mutate({url: repositoryUrl})
		await pWaitFor(
			async () =>
				(await umbreld.client.appStore.registry.query()).some((repository) =>
					repository.apps.some((app) => app.id === appId),
				),
			{interval: 1000, timeout: 60_000},
		)
		await umbreld.client.mcp.setPermissions.mutate({
			apps: [],
			appStore: true,
			files: [],
			manageSystem: false,
			machines: [],
			createMachines: false,
		})

		await withMcp(token, async (client) => {
			await expect(callTool(client, 'install_app', {appId})).resolves.toMatchObject({accepted: true})
			await waitForAppState(client, 'ready')
		})
		await pWaitFor(
			async () => {
				const {apps} = (await umbreld.client.mcp.getSettings.query()).permissions
				return Array.isArray(apps) && apps.includes(appId)
			},
			{interval: 100, timeout: 10_000},
		)

		await withMcp(token, async (client) => {
			await expect(callTool(client, 'get_app_details', {appId})).resolves.toMatchObject({id: appId, state: 'ready'})
			await callTool(client, 'stop_app', {appId})
			await waitForAppState(client, 'stopped')
			await callTool(client, 'start_app', {appId})
			await waitForAppState(client, 'ready')
		})
	})

	test.sequential('is reachable from an installed app container', async () => {
		const body = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2026-07-28',
				capabilities: {},
				clientInfo: {name: 'umbrel-app-container-test', version: '1.0.0'},
			},
		})
		const script = `
const http = require('http')
const request = http.request({
	host: '10.21.0.1',
	port: 80,
	path: '/mcp',
	method: 'POST',
	headers: {
		authorization: 'Bearer ' + process.env.MCP_TOKEN,
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	},
}, (response) => {
	let body = ''
	response.on('data', (chunk) => (body += chunk))
	response.on('end', () => console.log(JSON.stringify({status: response.statusCode, body})))
})
request.on('error', (error) => { console.error(error); process.exit(1) })
request.setTimeout(10_000, () => request.destroy(new Error('MCP request timed out')))
request.end(${JSON.stringify(body)})
`
		const encodedScript = Buffer.from(script).toString('base64')
		const output = await umbreld.vm.sshAsRoot(
			`docker exec -e MCP_TOKEN='${token}' ${appId}_server_1 node -e "eval(Buffer.from('${encodedScript}', 'base64').toString())"`,
		)
		const result = JSON.parse(output) as {status: number; body: string}

		expect(result.status).toBe(200)
		expect(result.body).toContain('"name":"umbrelOS"')
	})

	test.sequential('uninstalls the app and revokes its grant', async () => {
		await withMcp(token, async (client) => {
			await expect(callTool(client, 'uninstall_app', {appId})).resolves.toMatchObject({accepted: true})
			await waitForAppState(client, 'not-installed')
		})
		await pWaitFor(
			async () => {
				const {apps} = (await umbreld.client.mcp.getSettings.query()).permissions
				return Array.isArray(apps) && !apps.includes(appId)
			},
			{interval: 100, timeout: 10_000},
		)
	})

	test.sequential('exposes machine tools only behind their grants', async () => {
		await umbreld.client.mcp.setPermissions.mutate({
			apps: [],
			appStore: false,
			files: [],
			manageSystem: false,
			machines: 'all',
			createMachines: true,
		})
		await withMcp(token, async (client) => {
			const names = (await client.listTools()).tools.map((tool) => tool.name)
			expect(names).toEqual(
				expect.arrayContaining([
					'list_machines',
					'get_machine_screenshot',
					'control_machine',
					'delete_machine',
					'list_os_images',
					'create_machine',
				]),
			)
			await expect(callTool(client, 'list_machines')).resolves.toStrictEqual([])
			await expect(callTool(client, 'list_os_images')).resolves.toMatchObject({
				host: {architecture: 'amd64'},
				images: expect.any(Array),
			})
			await expect(callTool(client, 'get_machine_screenshot', {machineId: 'missing'})).rejects.toThrow(
				'[machine-not-found]',
			)
		})

		await umbreld.client.mcp.setPermissions.mutate({
			apps: [],
			appStore: false,
			files: [],
			manageSystem: false,
			machines: [],
			createMachines: false,
		})
		await withMcp(token, async (client) => {
			const names = (await client.listTools()).tools.map((tool) => tool.name)
			expect(names).toContain('list_machines')
			expect(names).not.toContain('control_machine')
			expect(names).not.toContain('create_machine')
		})
	})

	test.sequential('revokes one token independently and preserves the other across disable and re-enable', async () => {
		const oldToken = token
		const replacement = await umbreld.client.mcp.createToken.mutate({label: 'Replacement', agentType: 'generic'})
		await expect(umbreld.client.mcp.revokeToken.mutate({id: tokenId})).resolves.toBe(true)
		;({id: tokenId, token} = replacement)
		await expect(connectMcp(oldToken)).rejects.toThrow()
		await withMcp(token, async (client) =>
			expect(client.listTools()).resolves.toMatchObject({tools: expect.any(Array)}),
		)
		await expect(umbreld.client.mcp.listTokens.query()).resolves.toMatchObject([{id: tokenId, label: 'Replacement'}])

		await expect(umbreld.client.mcp.disable.mutate()).resolves.toBe(true)
		await expect(umbreld.client.mcp.getSettings.query()).resolves.toMatchObject({enabled: false})
		await expect(umbreld.client.mcp.listTokens.query()).resolves.toMatchObject([{id: tokenId, label: 'Replacement'}])
		expect(
			(
				await fetch(endpoint, {
					method: 'POST',
					headers: {authorization: `Bearer ${token}`},
				})
			).status,
		).toBe(401)

		// Turning MCP back on reactivates the exact same credential.
		await expect(umbreld.client.mcp.enable.mutate()).resolves.toBeNull()
		await withMcp(token, async (client) =>
			expect(client.listTools()).resolves.toMatchObject({tools: expect.any(Array)}),
		)
	})
})
