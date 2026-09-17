import {mkdtemp, readFile, rm} from 'node:fs/promises'
import http from 'node:http'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {promisify} from 'node:util'

import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import express from 'express'
import {afterAll, beforeAll, beforeEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import {normalizePath} from '../files/files.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import {OWNER_USER_ID} from '../user/constants.js'
import type {McpPermissions} from './mcp.js'
import createMcpEndpoint from './server.js'

const tokenId = 'a'.repeat(32)
const token = `umbrelmcp_${tokenId}_${'b'.repeat(64)}`
const noPermissions: McpPermissions = {
	apps: [],
	appStore: false,
	files: [],
	manageSystem: false,
	machines: [],
	createMachines: false,
}
let enabled = true
let uploadRoot = ''
let permissions: McpPermissions = {...noPermissions}

const logger = {error: vi.fn(), log: vi.fn()}
const umbreld = {
	apps: {instances: []},
	dataDirectory: '/tmp/umbrel',
	files: {
		normalizeVirtualPath: vi.fn(normalizePath),
		virtualToSystemPath: vi.fn(async (virtualPath: string) =>
			nodePath.join(uploadRoot, normalizePath(virtualPath).slice(1)),
		),
		authorizeWritableDestinationSystemPath: vi.fn(async (systemPath: string) => systemPath),
		getUniqueName: vi.fn(async (systemPath: string) => systemPath),
		chownSystemPath: vi.fn(async () => {}),
		fileIndex: {movePath: vi.fn(async () => {})},
		isInternalStorageVirtualPath: vi.fn(() => true),
		logger,
		systemToVirtualPath: vi.fn(
			(systemPath: string) => `/${nodePath.relative(uploadRoot, systemPath).split(nodePath.sep).join('/')}`,
		),
	},
	version: '1.2.3',
	versionName: 'umbrelOS 1.2.3',
	machines: {control: vi.fn(), screenshot: vi.fn()},
	mcp: {
		normalizeFilePath: vi.fn(normalizePath),
		assertFileAccess: vi.fn(async (path: string) => ({path})),
		assertFileWriteAccess: vi.fn(async (path: string) => ({path})),
		authenticateToken: vi.fn(async (candidate: string) => (enabled && candidate === token ? {tokenId} : null)),
		describeAgent: vi.fn(async (candidate: string) =>
			candidate === token ? {tokenId, label: 'Claude Code', agentType: 'claude-code'} : undefined,
		),
		getPermissions: vi.fn(async () => permissions),
		logger,
		recordRequest: vi.fn(),
	},
	notifications: {
		getForAccount: vi.fn(async () => ['backups-failing:primary', 'umbrelos-updated']),
	},
} as unknown as Umbreld

const endpoint = createMcpEndpoint(
	umbreld,
	new UploadDiskPreflight({getAvailableBytes: async () => Number.MAX_SAFE_INTEGER, reserveBytes: 0}),
)
const app = express()
app.use('/mcp', endpoint.router)
const httpServer = http.createServer(app)
let endpointUrl: URL

beforeAll(async () => {
	uploadRoot = await mkdtemp(nodePath.join(tmpdir(), 'mcp-server-upload-'))
	const listen = promisify(httpServer.listen.bind(httpServer)) as (port: number, host: string) => Promise<void>
	await listen(0, '127.0.0.1')
	const address = httpServer.address()
	if (!address || typeof address === 'string') throw new Error('Test server did not bind')
	endpointUrl = new URL(`http://127.0.0.1:${address.port}/mcp`)
})

beforeEach(() => {
	enabled = true
	permissions = {...noPermissions}
	vi.clearAllMocks()
	vi.mocked(umbreld.mcp.assertFileAccess).mockImplementation(async (path) => ({path}) as never)
	vi.mocked(umbreld.mcp.assertFileWriteAccess).mockImplementation(async (path) => ({path}) as never)
	vi.mocked(umbreld.mcp.authenticateToken).mockImplementation(async (candidate) =>
		enabled && candidate === token ? {tokenId} : null,
	)
	umbreld.apps.instances.splice(0)
})

afterAll(async () => {
	await endpoint.close()
	await promisify(httpServer.close.bind(httpServer))()
	await rm(uploadRoot, {recursive: true, force: true})
})

function transport() {
	return new StreamableHTTPClientTransport(endpointUrl, {
		requestInit: {headers: {Authorization: `Bearer ${token}`}},
	})
}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>) {
	const content = result.content[0]
	if (!content || content.type !== 'text') throw new Error('Expected a text tool result')
	return JSON.parse(content.text) as unknown
}

test('disabled and unauthorized requests return indistinguishable authentication failures', async () => {
	const request = {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}
	enabled = false
	const disabled = await fetch(endpointUrl, request)
	expect(disabled.status).toBe(401)
	expect(disabled.headers.get('www-authenticate')).toBe('Bearer')
	const disabledBody = await disabled.json()

	enabled = true
	const unauthorized = await fetch(endpointUrl, {
		...request,
		headers: {...request.headers, Authorization: 'Bearer invalid'},
	})
	expect(unauthorized.status).toBe(401)
	expect(unauthorized.headers.get('www-authenticate')).toBe('Bearer')
	await expect(unauthorized.json()).resolves.toStrictEqual(disabledBody)
	expect(disabledBody).toStrictEqual({
		jsonrpc: '2.0',
		error: {code: -32001, message: 'Unauthorized'},
		id: null,
	})
})

test('revocation during body upload is rechecked before dispatch', async () => {
	const authenticateToken = vi.mocked(umbreld.mcp.authenticateToken)
	authenticateToken.mockResolvedValueOnce({tokenId}).mockResolvedValueOnce(null)
	const revoked = await fetch(endpointUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${token}`,
		},
		body: '42',
	})
	expect(revoked.status).toBe(401)
	expect(authenticateToken).toHaveBeenCalledTimes(2)
	expect(umbreld.mcp.recordRequest).not.toHaveBeenCalled()

	authenticateToken.mockImplementation(async (candidate) => (candidate === token ? {tokenId} : null))
	const dispatched = await fetch(endpointUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${token}`,
		},
		body: '42',
	})
	expect(dispatched.status).toBe(400)
	expect(umbreld.mcp.recordRequest).toHaveBeenLastCalledWith(tokenId, 42)
})

test('file operations recheck revocation before evaluating grants', async () => {
	const authenticateToken = vi.mocked(umbreld.mcp.authenticateToken)
	authenticateToken.mockResolvedValueOnce({tokenId}).mockResolvedValueOnce(null)
	const response = await fetch(`${endpointUrl}/files/download?path=/Home/Shared/file.txt`, {
		headers: {Authorization: `Bearer ${token}`},
	})
	expect(response.status).toBe(401)
	expect(umbreld.mcp.assertFileAccess).not.toHaveBeenCalled()
	expect(umbreld.mcp.recordRequest).not.toHaveBeenCalled()
})

test('endpoint failures keep their JSON-RPC classification', async () => {
	const post = (body?: string) =>
		fetch(endpointUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${token}`,
			},
			...(body === undefined ? {} : {body}),
		})

	for (const [body, code] of [
		['{nope', -32700],
		['42', -32600],
		[undefined, -32700],
	] as const) {
		const response = await post(body)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({error: {code}})
	}

	const plainText = (body: string) =>
		fetch(endpointUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				Accept: 'application/json, text/event-stream',
				Authorization: `Bearer ${token}`,
			},
			body,
		})
	const oversized = await plainText('x'.repeat(5 * 1024 * 1024))
	expect(oversized.status).toBe(413)

	vi.mocked(umbreld.mcp.authenticateToken).mockRejectedValueOnce(new Error('store exploded'))
	const failure = await post('{}')
	expect(failure.status).toBe(500)
	await expect(failure.json()).resolves.toMatchObject({error: {code: -32603}})
})

test('file transfer routes inherit bearer auth and enforce every requested grant', async () => {
	const download = new URL(`${endpointUrl}/files/download`)
	download.searchParams.append('path', '/Home/Shared/allowed.txt')
	download.searchParams.append('path', '/Home/Private/denied.txt')

	await expect(fetch(download, {headers: {Authorization: 'Bearer invalid'}})).resolves.toMatchObject({status: 401})

	const assertFileAccess = vi.mocked(umbreld.mcp.assertFileAccess)
	assertFileAccess.mockImplementationOnce(async (path) => ({path}) as never)
	assertFileAccess.mockRejectedValueOnce(new Error('[permission-denied]'))
	const denied = await fetch(download, {headers: {Authorization: `Bearer ${token}`}})
	expect(denied.status).toBe(403)
	await expect(denied.json()).resolves.toStrictEqual({
		error: 'permission denied. The device owner can grant access in Settings → AI agents (MCP).',
	})
	expect(assertFileAccess).toHaveBeenNthCalledWith(1, '/Home/Shared/allowed.txt')
	expect(assertFileAccess).toHaveBeenNthCalledWith(2, '/Home/Private/denied.txt')
})

test('uploads are contained to the directory they write into', async () => {
	const assertFileAccess = vi.mocked(umbreld.mcp.assertFileAccess)
	const assertFileWriteAccess = vi.mocked(umbreld.mcp.assertFileWriteAccess)
	assertFileAccess.mockImplementation(async (path) => {
		if (path !== '/Home/photos' && !path.startsWith('/Home/photos/')) throw new Error('[permission-denied]')
		return {path} as never
	})
	const upload = (query: string) =>
		fetch(`${endpointUrl}/files/upload?${query}`, {
			method: 'POST',
			headers: {Authorization: `Bearer ${token}`},
			body: 'contents',
		})
	try {
		// Keep-both renames to a sibling, so uploading onto the grant itself would
		// write '/Home/photos (2)' into the grant's parent
		const escape = await upload('path=/Home/photos&collision=keep-both')
		expect(escape.status).toBe(403)
		expect(assertFileAccess).toHaveBeenCalledWith('/Home')

		// Uploads into the grant are unaffected
		const allowed = await upload('path=/Home/photos/holiday.jpg&collision=keep-both')
		expect(allowed.status).toBe(200)
		expect(assertFileWriteAccess).toHaveBeenCalledWith('/Home/photos/holiday.jpg')
		await expect(allowed.json()).resolves.toStrictEqual({path: '/Home/photos/holiday.jpg'})
		await expect(readFile(nodePath.join(uploadRoot, 'Home/photos/holiday.jpg'), 'utf8')).resolves.toBe('contents')

		// MCP never exposes permanent replacement, even though the shared Files API
		// supports it for owner-driven UI flows.
		const replace = await upload('path=/Home/photos/holiday.jpg&collision=replace')
		expect(replace.status).toBe(400)
		await expect(replace.json()).resolves.toMatchObject({error: expect.stringContaining('not available through MCP')})
	} finally {
		assertFileAccess.mockImplementation(async (path) => ({path}) as never)
		assertFileWriteAccess.mockImplementation(async (path) => ({path}) as never)
	}
})

test('uploads enforce MCP write restrictions before accepting a body', async () => {
	vi.mocked(umbreld.mcp.assertFileWriteAccess).mockRejectedValueOnce(new Error('[permission-denied]'))
	const response = await fetch(`${endpointUrl}/files/upload?path=/Apps/plex/docker-compose.yml`, {
		method: 'POST',
		headers: {Authorization: `Bearer ${token}`},
		body: 'services: {}',
	})
	expect(response.status).toBe(403)
	expect(umbreld.mcp.assertFileWriteAccess).toHaveBeenCalledWith('/Apps/plex/docker-compose.yml')
})

test('the official modern client connects and calls a tool', async () => {
	const client = new Client({name: 'umbreld-test', version: '1.0.0'}, {versionNegotiation: {mode: {pin: '2026-07-28'}}})
	try {
		await client.connect(transport())
		expect(client.getProtocolEra()).toBe('modern')
		expect(client.getServerVersion()).toStrictEqual({name: 'umbrelOS', version: '1.2.3'})
		expect((await client.listTools()).tools.map(({name}) => name)).toContain('get_notifications')
		const notifications = await client.callTool({name: 'get_notifications', arguments: {}})
		expect(parseToolResult(notifications)).toStrictEqual(['backups-failing:primary', 'umbrelos-updated'])
		expect(umbreld.notifications.getForAccount).toHaveBeenCalledWith(OWNER_USER_ID)
	} finally {
		await client.close()
	}
})

test('the same endpoint serves the default legacy client statelessly', async () => {
	const client = new Client({name: 'umbreld-legacy-test', version: '1.0.0'})
	try {
		await client.connect(transport())
		expect(client.getProtocolEra()).toBe('legacy')
		expect(client.getServerVersion()).toStrictEqual({name: 'umbrelOS', version: '1.2.3'})
		await expect(client.ping()).resolves.toBeDefined()
	} finally {
		await client.close()
	}

	await expect(fetch(endpointUrl, {headers: {Authorization: `Bearer ${token}`}})).resolves.toMatchObject({status: 405})
})

test('instructions are regenerated from the current grants', async () => {
	permissions = {...noPermissions, apps: ['plex'], appStore: true, files: ['/Home/Shared']}
	const client = new Client(
		{name: 'umbreld-instructions-test', version: '1.0.0'},
		{versionNegotiation: {mode: {pin: '2026-07-28'}}},
	)
	try {
		await client.connect(transport())
		const instructions = client.getInstructions()
		expect(instructions).toContain('App control access: plex')
		expect(instructions).toContain('File access: /Home/Shared')
		expect(instructions).toContain('App Store access: granted')
		expect(instructions).toContain('System management: not granted')
		expect(instructions).toContain('MCP never replaces an existing file')
		expect(instructions).toContain('App root entries and lifecycle hooks are read-only')
		expect(instructions).toContain('Uninstalling an app permanently deletes its app data')
		const filesUrl = `${endpointUrl.origin}/mcp/files`
		expect(instructions).toContain(`Download URL: ${filesUrl}/download?path=/Home/file.bin`)
		expect(instructions).toContain(`Upload URL: ${filesUrl}/upload?path=/Home/file.bin`)
		expect(instructions).not.toContain(token)
	} finally {
		await client.close()
	}
})

test('transfer URLs honor the forwarded scheme and host from ingress', async () => {
	permissions = {...noPermissions, files: ['/Home/Shared']}
	const client = new Client({name: 'umbreld-forwarded-test', version: '1.0.0'})
	// TLS terminates at lan-ingress, which stamps these headers onto every
	// proxied request — the raw request the adapter sees is always http
	const forwardedTransport = new StreamableHTTPClientTransport(endpointUrl, {
		requestInit: {
			headers: {
				Authorization: `Bearer ${token}`,
				'x-forwarded-proto': 'https',
				'x-forwarded-host': 'home.local',
			},
		},
	})
	try {
		await client.connect(forwardedTransport)
		expect(client.getInstructions()).toContain('Download URL: https://home.local/mcp/files/download')
		expect(client.getInstructions()).not.toContain('http://')
	} finally {
		await client.close()
	}
})

test('file search is advertised only for full Home access', async () => {
	async function hasSearch() {
		const client = new Client({name: 'umbreld-file-search-test', version: '1.0.0'})
		try {
			await client.connect(transport())
			return (await client.listTools()).tools.some(({name}) => name === 'search_files')
		} finally {
			await client.close()
		}
	}

	await expect(hasSearch()).resolves.toBe(false)
	permissions = {...noPermissions, files: ['/Home']}
	await expect(hasSearch()).resolves.toBe(true)
})

test('system management tools are registered with the system grant', async () => {
	permissions = {...noPermissions, manageSystem: true}
	const client = new Client(
		{name: 'umbreld-system-tools-test', version: '1.0.0'},
		{versionNegotiation: {mode: {pin: '2026-07-28'}}},
	)
	try {
		await client.connect(transport())
		const toolNames = (await client.listTools()).tools.map(({name}) => name)
		expect(toolNames).toEqual(
			expect.arrayContaining([
				'install_os_update',
				'get_os_update_status',
				'restart_device',
				'set_hostname',
				'set_release_channel',
				'get_network_settings',
				'get_system_logs',
			]),
		)
		expect(toolNames).not.toContain('set_wallpaper')
	} finally {
		await client.close()
	}
})
