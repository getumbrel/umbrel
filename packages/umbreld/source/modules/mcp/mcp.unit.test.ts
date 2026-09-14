import {createHash} from 'node:crypto'
import {mkdtemp, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import {normalizePath} from '../files/files.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import FileStore from '../utilities/file-store.js'
import Mcp, {type McpStoreSettings} from './mcp.js'

type TestStore = {
	mcp?: McpStoreSettings
}

const cleanups: Array<() => Promise<void>> = []

async function createMcp() {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'mcp-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))

	const roots = {
		Home: nodePath.join(root, 'home'),
		Apps: nodePath.join(root, 'apps'),
		External: nodePath.join(root, 'external'),
		Network: nodePath.join(root, 'network'),
	}
	await Promise.all(Object.values(roots).map((path) => fse.ensureDir(path)))
	await Promise.all([
		fse.ensureDir(nodePath.join(roots.Home, 'Granted')),
		fse.ensureDir(nodePath.join(roots.Home, 'Granted-sibling')),
		fse.ensureDir(nodePath.join(roots.Home, 'Private')),
		fse.ensureDir(nodePath.join(roots.Apps, 'plex')),
		fse.ensureDir(nodePath.join(roots.Apps, 'plex', 'data')),
		fse.ensureDir(nodePath.join(roots.Apps, 'plex', 'hooks')),
		fse.ensureDir(nodePath.join(roots.Apps, 'plex-2')),
	])

	const store = new FileStore<TestStore>({filePath: nodePath.join(root, 'umbrel.yaml')})
	const appIds = ['plex', 'plex-2']
	const machineIds = ['debian', 'windows']
	const fileListeners: Array<(event: {type: 'delete'; path: string}) => Promise<void>> = []
	const virtualToSystemPath = vi.fn(async (virtualPath: string) => {
		const path = normalizePath(virtualPath)
		const [base, ...tail] = path.split('/').filter(Boolean)
		const rootPath = roots[base as keyof typeof roots]
		if (!rootPath) throw new Error('[invalid-base]')
		return nodePath.join(rootPath, ...tail)
	})
	const systemToVirtualPath = (systemPath: string) => {
		for (const [base, rootPath] of Object.entries(roots)) {
			const relative = nodePath.relative(rootPath, systemPath)
			if (relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative))) {
				return normalizePath(`/${base}/${relative}`)
			}
		}
		throw new Error('[invalid-path]')
	}

	const umbreld = {
		apps: {
			instances: appIds.map((id) => ({id})),
			isInstalled: vi.fn(async (appId: string) => appIds.includes(appId)),
			getApp: vi.fn((appId: string) => ({id: appId})),
		},
		eventBus: {
			on: vi.fn((_eventName: string, listener: (event: {type: 'delete'; path: string}) => Promise<void>) => {
				fileListeners.push(listener)
				return () => {
					const index = fileListeners.indexOf(listener)
					if (index !== -1) fileListeners.splice(index, 1)
				}
			}),
		},
		files: {normalizeVirtualPath: normalizePath, systemToVirtualPath, virtualToSystemPath},
		machines: {exists: vi.fn(async (id: string) => machineIds.includes(id))},
		logger: {
			createChildLogger: () => ({error: vi.fn(), log: vi.fn()}),
		},
		server: {
			uploadDiskPreflight: new UploadDiskPreflight({
				getAvailableBytes: async () => Number.MAX_SAFE_INTEGER,
				reserveBytes: 0,
			}),
		},
		store,
	} as unknown as Umbreld

	return {appIds, fileListeners, machineIds, mcp: new Mcp(umbreld), roots, store}
}

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

const tokenMetadata = (label = 'Claude Code', agentType = 'claude-code') => ({label, agentType})
const defaultPermissionsForTest = {
	apps: [] as string[],
	appStore: false,
	files: [] as string[],
	manageSystem: false,
	machines: [],
	createMachines: false,
}

test('disable rejects requests while preserving tokens, permissions, and activity for re-enable', async () => {
	const {mcp, store} = await createMcp()

	const credential = await mcp.enable(tokenMetadata())
	await expect(store.get('mcp')).resolves.toMatchObject({
		enabled: true,
		permissions: {
			apps: [],
			appStore: false,
			files: [],
			manageSystem: false,
			machines: [],
			createMachines: false,
		},
	})
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: true})

	const permissions = {
		apps: ['plex'],
		appStore: true,
		files: ['/Home/Granted'],
		manageSystem: true,
		machines: [],
		createMachines: false,
	}
	await mcp.setPermissions(permissions)
	mcp.recordRequest(credential.id, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {clientInfo: {name: 'claude-code', version: '1.0.0'}},
	})
	const beforeDisable = await store.get('mcp')
	await mcp.disable()
	await expect(store.get('mcp')).resolves.toStrictEqual({
		...beforeDisable,
		enabled: false,
	})
	await expect(mcp.authenticateToken(credential.token)).resolves.toBeNull()
	await expect(mcp.createToken(tokenMetadata('Blocked while off'))).rejects.toThrow('[not-enabled]')
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: false, permissions})
	await expect(mcp.listTokens()).resolves.toMatchObject([{id: credential.id, clients: [{name: 'claude-code'}]}])
	await expect(mcp.disable()).resolves.toBe(true)
	await expect(mcp.enable(tokenMetadata('Unexpected new token'))).rejects.toThrow('[tokens-exist]')
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: false})

	await expect(mcp.enable()).resolves.toBeNull()
	await expect(mcp.authenticateToken(credential.token)).resolves.toStrictEqual({tokenId: credential.id})
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: true, permissions})
	await expect(mcp.listTokens()).resolves.toMatchObject([{id: credential.id, clients: [{name: 'claude-code'}]}])
})

test('permission mutations preserve every token and unrelated permissions', async () => {
	const {mcp, store} = await createMcp()
	await mcp.enable(tokenMetadata())
	await mcp.createToken(tokenMetadata('Codex', 'codex'))
	const tokens = (await store.get('mcp')).tokens
	const basePermissions = {
		apps: [] as string[],
		appStore: true,
		files: ['/Home/Granted'],
		manageSystem: true,
		machines: [],
		createMachines: false,
	}

	await mcp.setPermissions(basePermissions)
	await expect(store.get('mcp')).resolves.toStrictEqual({enabled: true, tokens, permissions: basePermissions})

	await mcp.addAppGrant('plex')
	await mcp.addAppGrant('plex')
	await expect(store.get('mcp')).resolves.toStrictEqual({
		enabled: true,
		tokens,
		permissions: {...basePermissions, apps: ['plex']},
	})

	await expect(mcp.removeAppGrant('plex')).resolves.toBe(true)
	await expect(mcp.removeAppGrant('plex')).resolves.toBe(false)
	await expect(mcp.removeFileGrantsWithin('/Home/Granted')).resolves.toBe(true)
	await expect(mcp.removeFileGrantsWithin('/Home/Granted')).resolves.toBe(false)
	await expect(store.get('mcp')).resolves.toStrictEqual({
		enabled: true,
		tokens,
		permissions: {...basePermissions, files: []},
	})
})

test('tokens are independently authenticated, stored only as hashes, and revoked immediately', async () => {
	const {mcp, store} = await createMcp()

	const first = await mcp.enable(tokenMetadata('Claude Code', 'claude-code'))
	const second = await mcp.createToken(tokenMetadata('Codex', 'codex'))
	expect(first.id).toMatch(/^[0-9a-f]{32}$/)
	expect(first.token).toMatch(new RegExp(`^umbrelmcp_${first.id}_[0-9a-f]{64}$`))
	expect(second.token).not.toBe(first.token)
	const stored = await store.get('mcp')
	expect(Object.keys(stored).sort()).toStrictEqual(['enabled', 'permissions', 'tokens'])
	expect(Object.keys(stored.tokens)).toStrictEqual([first.id, second.id])
	expect(stored.tokens[first.id].secretHash).toMatch(/^[0-9a-f]{64}$/)
	expect(JSON.stringify(stored)).not.toContain(first.token)
	expect(JSON.stringify(stored)).not.toContain(second.token)
	await expect(mcp.authenticateToken(first.token)).resolves.toStrictEqual({tokenId: first.id})
	await expect(mcp.authenticateToken(second.token)).resolves.toStrictEqual({tokenId: second.id})
	await expect(
		mcp.authenticateToken(first.token.replace(/.$/, first.token.endsWith('0') ? '1' : '0')),
	).resolves.toBeNull()
	await expect(mcp.authenticateToken(first.token.slice('umbrelmcp_'.length))).resolves.toBeNull()
	await expect(mcp.authenticateToken(`umbrelmcp_${second.id}_${first.token.split('_').at(-1)}`)).resolves.toBeNull()

	await expect(mcp.revokeToken(first.id)).resolves.toBe(true)
	await expect(mcp.authenticateToken(first.token)).resolves.toBeNull()
	await expect(mcp.authenticateToken(second.token)).resolves.toStrictEqual({tokenId: second.id})
	await expect(mcp.listTokens()).resolves.toMatchObject([{id: second.id, label: 'Codex'}])

	await mcp.disable()
	await expect(mcp.authenticateToken(second.token)).resolves.toBeNull()
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: false})
	await expect(mcp.listTokens()).resolves.toMatchObject([{id: second.id, label: 'Codex'}])
	await expect(mcp.enable()).resolves.toBeNull()
	await expect(mcp.authenticateToken(second.token)).resolves.toStrictEqual({tokenId: second.id})

	await mcp.reset()
	await expect(mcp.authenticateToken(second.token)).resolves.toBeNull()
	await expect(mcp.getSettings()).resolves.toMatchObject({enabled: false, permissions: defaultPermissionsForTest})
	await expect(mcp.listTokens()).resolves.toStrictEqual([])
})

test('token lifecycle validates metadata, enforces the cap, and supports an enabled server with no tokens', async () => {
	const {mcp, store} = await createMcp()

	await expect(mcp.createToken(tokenMetadata())).rejects.toThrow('[not-enabled]')
	await expect(mcp.enable({label: ' '})).rejects.toThrow('[invalid-token-metadata]')
	await expect(mcp.enable({label: 'x'.repeat(81)})).rejects.toThrow('[invalid-token-metadata]')
	await expect(mcp.enable({label: 'Valid', agentType: ' '})).rejects.toThrow('[invalid-token-metadata]')
	const first = await mcp.enable({label: '  Claude Code  ', agentType: ' claude-code '})
	await expect(mcp.enable(tokenMetadata())).rejects.toThrow('[already-enabled]')

	for (let i = 1; i < 20; i++) await mcp.createToken({label: `Agent ${i}`})
	await expect(mcp.createToken({label: 'One too many'})).rejects.toThrow('[token-limit]')
	const tokens = await mcp.listTokens()
	expect(tokens).toHaveLength(20)
	expect(tokens[0]).toMatchObject({id: first.id, label: 'Claude Code', agentType: 'claude-code'})
	expect(tokens.every(({lastRequestAt, clients}) => lastRequestAt === null && clients.length === 0)).toBe(true)

	await expect(mcp.revokeToken('0'.repeat(32))).rejects.toThrow('[token-not-found]')
	await expect(mcp.revokeToken('invalid')).rejects.toThrow('[token-not-found]')
	await mcp.setPermissions({
		...defaultPermissionsForTest,
		appStore: true,
		manageSystem: true,
		machines: [],
		createMachines: false,
	})
	await mcp.revokeToken(tokens[0].id)
	await expect(mcp.getSettings()).resolves.toMatchObject({
		enabled: true,
		permissions: {
			...defaultPermissionsForTest,
			appStore: true,
			manageSystem: true,
			machines: [],
			createMachines: false,
		},
	})
	for (const token of tokens.slice(1)) await mcp.revokeToken(token.id)
	await expect(mcp.getSettings()).resolves.toMatchObject({
		enabled: true,
		permissions: {
			...defaultPermissionsForTest,
			appStore: true,
			manageSystem: true,
			machines: [],
			createMachines: false,
		},
	})
	await expect(store.get('mcp')).resolves.toStrictEqual({
		enabled: true,
		tokens: {},
		permissions: {
			...defaultPermissionsForTest,
			appStore: true,
			manageSystem: true,
			machines: [],
			createMachines: false,
		},
	})
	const replacement = await mcp.createToken(tokenMetadata('Replacement'))
	await expect(mcp.authenticateToken(replacement.token)).resolves.toStrictEqual({tokenId: replacement.id})
	await mcp.revokeToken(replacement.id)
	await mcp.disable()
	await expect(mcp.enable()).rejects.toThrow('[no-tokens]')
	await expect(mcp.enable(tokenMetadata('New agent'))).resolves.toMatchObject({
		token: expect.stringMatching(/^umbrelmcp_/),
	})
	await expect(mcp.getSettings()).resolves.toMatchObject({
		enabled: true,
		permissions: {
			...defaultPermissionsForTest,
			appStore: true,
			manageSystem: true,
			machines: [],
			createMachines: false,
		},
	})
})

test('client identities and activity are isolated per token, bounded, and cleared on revoke', async () => {
	const {mcp} = await createMcp()
	const first = await mcp.enable(tokenMetadata('Claude Code', 'claude-code'))
	const second = await mcp.createToken(tokenMetadata('Codex', 'codex'))
	const baseAt = 1_785_400_000_000
	const dateNow = vi.spyOn(Date, 'now').mockReturnValue(baseAt)
	mcp.recordRequest(first.id, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {protocolVersion: '2025-06-18', clientInfo: {name: 'claude-code', version: '2.1.0'}},
	})
	dateNow.mockReturnValue(baseAt + 1000)
	mcp.recordRequest(second.id, {
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
		params: {_meta: {'io.modelcontextprotocol/clientInfo': {name: 'codex', title: 'Codex', version: '0.9.0'}}},
	})
	dateNow.mockReturnValue(baseAt + 2000)
	mcp.recordRequest(first.id, {
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/list',
		params: {_meta: {'io.modelcontextprotocol/clientInfo': {name: 'claude-code', version: '2.2.0'}}},
	})
	await expect(mcp.listTokens()).resolves.toMatchObject([
		{
			id: first.id,
			lastRequestAt: baseAt + 2000,
			clients: [{name: 'claude-code', version: '2.2.0', lastRequestAt: baseAt + 2000}],
		},
		{
			id: second.id,
			lastRequestAt: baseAt + 1000,
			clients: [{name: 'codex', title: 'Codex', version: '0.9.0', lastRequestAt: baseAt + 1000}],
		},
	])

	// Partial identities are ignored, while untrusted display fields and the
	// total client list stay bounded.
	mcp.recordRequest(first.id, {
		jsonrpc: '2.0',
		id: 4,
		method: 'tools/list',
		params: {_meta: {'io.modelcontextprotocol/clientInfo': {name: 'versionless'}}},
	})
	dateNow.mockReturnValue(baseAt + 3000)
	mcp.recordRequest(first.id, {
		jsonrpc: '2.0',
		id: 5,
		method: 'tools/list',
		params: {_meta: {'io.modelcontextprotocol/clientInfo': {name: 'x'.repeat(10_000), version: '1.0.0'}}},
	})
	const [afterUntrustedInput] = await mcp.listTokens()
	expect(afterUntrustedInput.clients.map(({name}) => name)).not.toContain('versionless')
	expect(afterUntrustedInput.clients[0]?.name).toBe('x'.repeat(80))

	for (let i = 0; i < 10; i++) {
		dateNow.mockReturnValue(baseAt + 4000 + i)
		mcp.recordRequest(first.id, {
			jsonrpc: '2.0',
			id: i + 6,
			method: 'tools/list',
			params: {_meta: {'io.modelcontextprotocol/clientInfo': {name: `agent-${i}`, version: '1.0.0'}}},
		})
	}
	dateNow.mockRestore()

	const [beforeRevoke] = await mcp.listTokens()
	expect(beforeRevoke.clients).toHaveLength(10)
	expect(beforeRevoke.clients.map(({name}) => name)).not.toContain('versionless')
	expect(beforeRevoke.clients[0]?.name).toBe('agent-9')

	await mcp.revokeToken(first.id)
	await expect(mcp.listTokens()).resolves.toMatchObject([{id: second.id, clients: [{name: 'codex'}]}])
})

test('permission updates validate installed apps and owner folder grant roots', async () => {
	const {mcp} = await createMcp()

	await expect(
		mcp.setPermissions({
			apps: ['plex', 'plex'],
			appStore: true,
			files: ['/Home/Granted/', '/Home/Granted'],
			manageSystem: false,
			machines: [],
			createMachines: false,
		}),
	).resolves.toStrictEqual({
		apps: ['plex'],
		appStore: true,
		files: ['/Home/Granted'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})

	await expect(
		mcp.setPermissions({
			apps: ['missing'],
			appStore: false,
			files: [],
			manageSystem: false,
			machines: [],
			createMachines: false,
		}),
	).rejects.toThrow('app-not-installed')
	await expect(
		mcp.setPermissions({
			apps: [],
			appStore: false,
			files: ['/Apps/plex'],
			manageSystem: false,
			machines: [],
			createMachines: false,
		}),
	).rejects.toThrow('invalid-base')
	await expect(
		mcp.setPermissions({
			apps: [],
			appStore: false,
			files: ['/Home/Missing'],
			manageSystem: false,
			machines: [],
			createMachines: false,
		}),
	).rejects.toThrow('does-not-exist')
})

test('missing grants explain how the device owner can grant access', async () => {
	const {mcp} = await createMcp()
	await mcp.setPermissions({
		apps: [],
		appStore: false,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	const remediation = 'The device owner can grant access in Settings → AI agents (MCP).'

	await expect(mcp.assertAppAccess('plex')).rejects.toThrow(remediation)
	await expect(mcp.assertAppAccess('missing')).rejects.toThrow('app-not-installed')
	await expect(mcp.assertAppStoreAccess()).rejects.toThrow(remediation)
	await expect(mcp.assertSystemAccess()).rejects.toThrow(remediation)
	await expect(mcp.assertFileAccess('/Home/Private/note.txt')).rejects.toThrow(remediation)
})

test('file grants combine explicit folders and app data without leaking sibling prefixes', async () => {
	const {mcp} = await createMcp()
	await mcp.setPermissions({
		apps: ['plex'],
		appStore: false,
		files: ['/Home/Granted'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})

	await expect(mcp.assertFileAccess('/Home/Granted/note.txt')).resolves.toMatchObject({grant: '/Home/Granted'})
	await expect(mcp.assertFileAccess('/Apps/plex/config.yml')).resolves.toMatchObject({grant: '/Apps/plex'})
	await expect(mcp.assertFileAccess('/Home/Granted-sibling/note.txt')).rejects.toMatchObject({
		message:
			"[permission-denied] File path '/Home/Granted-sibling/note.txt' is not granted. The device owner can grant access in Settings → AI agents (MCP).",
	})
	await expect(mcp.assertFileAccess('/Apps/plex-2/config.yml')).rejects.toMatchObject({
		message:
			"[permission-denied] File path '/Apps/plex-2/config.yml' is not granted. The device owner can grant access in Settings → AI agents (MCP).",
	})
})

test('file grant containment rejects symlinks that escape a granted subtree', async () => {
	const {mcp, roots} = await createMcp()
	await symlink(nodePath.join(roots.Home, 'Private'), nodePath.join(roots.Home, 'Granted', 'escape'))
	await mcp.setPermissions({
		apps: [],
		appStore: false,
		files: ['/Home/Granted'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})

	await expect(mcp.assertFileAccess('/Home/Granted/escape/secret.txt')).rejects.toMatchObject({
		message:
			"[permission-denied] File path '/Home/Granted/escape/secret.txt' is not safely contained in '/Home/Granted'",
	})
})

test('app grants keep framework files and hooks read-only while allowing nested app data writes', async () => {
	const {mcp, roots} = await createMcp()
	await mcp.setPermissions({
		apps: ['plex'],
		appStore: false,
		files: ['/Home/Granted'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})

	// Protected paths remain readable.
	await expect(mcp.assertFileAccess('/Apps/plex/docker-compose.yml')).resolves.toMatchObject({grant: '/Apps/plex'})
	await expect(mcp.assertFileAccess('/Apps/plex/hooks/pre-start')).resolves.toMatchObject({grant: '/Apps/plex'})

	for (const path of [
		'/Apps/plex',
		'/Apps/plex/docker-compose.yml',
		'/Apps/plex/exports.sh',
		'/Apps/plex/data',
		'/Apps/plex/hooks/pre-start',
		'/Apps/plex/missing/file.txt',
	]) {
		await expect(mcp.assertFileWriteAccess(path)).rejects.toThrow('read-only through MCP')
	}

	await expect(mcp.assertFileWriteAccess('/Apps/plex/data/config.json')).resolves.toMatchObject({grant: '/Apps/plex'})
	await expect(mcp.assertFileWriteAccess('/Home/Granted/new.txt')).resolves.toMatchObject({grant: '/Home/Granted'})

	// A symlink inside writable data cannot disguise a write into hooks.
	await symlink(nodePath.join(roots.Apps, 'plex', 'hooks'), nodePath.join(roots.Apps, 'plex', 'data', 'hook-alias'))
	await expect(mcp.assertFileWriteAccess('/Apps/plex/data/hook-alias/pre-start')).rejects.toThrow(
		'read-only through MCP',
	)
})

test('all grants cover folder categories and current and future app data', async () => {
	const {appIds, mcp} = await createMcp()
	await mcp.setPermissions({
		apps: 'all',
		appStore: false,
		files: 'all',
		manageSystem: true,
		machines: [],
		createMachines: false,
	})

	await expect(mcp.assertFileAccess('/Home/file.txt')).resolves.toMatchObject({grant: '/Home'})
	await expect(mcp.assertFileAccess('/External/disk/file.txt')).resolves.toMatchObject({grant: '/External'})
	appIds.push('future-app')
	await expect(mcp.assertFileAccess('/Apps/future-app/config')).resolves.toMatchObject({grant: '/Apps'})
	await expect(mcp.hasFullHomeAccess()).resolves.toBe(true)
	await expect(mcp.assertSystemAccess()).resolves.toBeUndefined()
})

test('only Home deletion events remove file grants', async () => {
	const {fileListeners, mcp, roots, store} = await createMcp()
	await fse.ensureDir(nodePath.join(roots.Home, 'Granted', 'Nested'))
	await mcp.start()
	expect(fileListeners).toHaveLength(0)
	await mcp.enable(tokenMetadata())
	expect(fileListeners).toHaveLength(1)
	await mcp.setPermissions({
		apps: [],
		appStore: false,
		files: ['/Home/Granted', '/Home/Granted/Nested', '/Home/Private'],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
	const getWriteLock = vi.spyOn(store, 'getWriteLock')

	await fileListeners[0]({type: 'delete', path: nodePath.join(roots.Apps, 'plex', 'cache')})
	expect(getWriteLock).not.toHaveBeenCalled()

	const get = vi.spyOn(store, 'get')
	get.mockClear()
	await Promise.all(
		Array.from({length: 100}, (_, index) =>
			fileListeners[0]({type: 'delete', path: nodePath.join(roots.Home, 'Unrelated', String(index))}),
		),
	)
	expect(get).toHaveBeenCalledOnce()
	expect(getWriteLock).not.toHaveBeenCalled()

	await fileListeners[0]({type: 'delete', path: nodePath.join(roots.Home, 'Granted')})
	expect(getWriteLock).toHaveBeenCalledTimes(1)

	await expect(store.get('mcp')).resolves.toMatchObject({
		permissions: {files: ['/Home/Private']},
	})
	await mcp.disable()
	expect(fileListeners).toHaveLength(0)
	await fse.remove(nodePath.join(roots.Home, 'Private'))
	await mcp.enable()
	expect(fileListeners).toHaveLength(1)
	await expect(mcp.getSettings()).resolves.toMatchObject({permissions: {files: []}})
	await mcp.stop()
	expect(fileListeners).toHaveLength(0)
})

test('startup removes stale Home grants while retaining existing grants', async () => {
	const {fileListeners, mcp, store} = await createMcp()
	await store.set('mcp', {
		enabled: true,
		tokens: {
			['a'.repeat(32)]: {
				label: 'Claude Code',
				agentType: 'claude-code',
				secretHash: 'b'.repeat(64),
				createdAt: 1_785_400_000_000,
			},
		},
		permissions: {
			apps: [],
			appStore: false,
			files: ['/Home/Granted', '/Home/Missing', '/External'],
			manageSystem: false,
			machines: [],
			createMachines: false,
		},
	})

	await mcp.start()
	expect(fileListeners).toHaveLength(1)

	await expect(store.get('mcp')).resolves.toStrictEqual({
		enabled: true,
		tokens: {
			['a'.repeat(32)]: {
				label: 'Claude Code',
				agentType: 'claude-code',
				secretHash: 'b'.repeat(64),
				createdAt: 1_785_400_000_000,
			},
		},
		permissions: {
			apps: [],
			appStore: false,
			files: ['/Home/Granted', '/External'],
			manageSystem: false,
			machines: [],
			createMachines: false,
		},
	})
	await mcp.stop()
	expect(fileListeners).toHaveLength(0)
})

test('startup keeps saved credentials inactive while MCP is disabled', async () => {
	const {fileListeners, mcp, store} = await createMcp()
	const id = 'a'.repeat(32)
	const secret = 'b'.repeat(64)
	const token = `umbrelmcp_${id}_${secret}`
	await store.set('mcp', {
		enabled: false,
		tokens: {
			[id]: {
				label: 'Claude Code',
				agentType: 'claude-code',
				secretHash: createHash('sha256').update(secret).digest('hex'),
				createdAt: 1_785_400_000_000,
			},
		},
		permissions: {...defaultPermissionsForTest, appStore: true},
	})

	await mcp.start()
	expect(fileListeners).toHaveLength(0)
	await expect(mcp.getSettings()).resolves.toStrictEqual({
		enabled: false,
		permissions: {...defaultPermissionsForTest, appStore: true},
	})
	await expect(mcp.listTokens()).resolves.toMatchObject([{id, label: 'Claude Code'}])
	await expect(mcp.authenticateToken(token)).resolves.toBeNull()

	await expect(mcp.enable()).resolves.toBeNull()
	expect(fileListeners).toHaveLength(1)
	await expect(mcp.authenticateToken(token)).resolves.toStrictEqual({tokenId: id})
	await mcp.stop()
})

test('background app failures are recorded, cleared by newer work, and bounded', async () => {
	const {mcp} = await createMcp()
	mcp.startAppOperation('plex', 'start', async () => {
		throw new Error('container failed')
	})
	await vi.waitFor(() => {
		expect(mcp.getAppOperationFailure('plex')).toMatchObject({
			operation: 'start',
			message: 'container failed',
		})
	})

	mcp.startAppOperation('plex', 'restart', async () => {})

	expect(mcp.getAppOperationFailure('plex')).toBeNull()
	for (let i = 0; i <= 10; i++) {
		mcp.startAppOperation(`app-${i}`, 'start', async () => {
			throw new Error('container failed')
		})
	}

	await vi.waitFor(() => {
		expect(mcp.getAppOperationFailure('app-10')).toMatchObject({operation: 'start'})
	})
	expect(mcp.getAppOperationFailure('app-0')).toBeNull()
	expect(mcp.getAppOperationFailure('app-1')).toMatchObject({operation: 'start'})
})

test('machine grants are validated, deduplicated, dropped with their machine, and gated like apps', async () => {
	const {machineIds, mcp} = await createMcp()
	const remediation = 'The device owner can grant access in Settings → AI agents (MCP).'

	await expect(mcp.setPermissions({...defaultPermissionsForTest, machines: ['ghost']})).rejects.toThrow(
		'[machine-not-found]',
	)
	await expect(
		mcp.setPermissions({...defaultPermissionsForTest, machines: ['debian', 'debian'], createMachines: true}),
	).resolves.toMatchObject({machines: ['debian'], createMachines: true})

	await expect(mcp.assertMachineAccess('debian')).resolves.toBeUndefined()
	await expect(mcp.assertMachineAccess('windows')).rejects.toThrow(
		`[permission-denied] Machine 'windows' is not granted. ${remediation}`,
	)
	await expect(mcp.assertMachineAccess('ghost')).rejects.toThrow('[machine-not-found]')
	await expect(mcp.assertMachineCreateAccess()).resolves.toBeUndefined()

	// Granting twice is idempotent, like install_app granting an app
	await mcp.addMachineGrant('windows')
	await mcp.addMachineGrant('windows')
	await expect(mcp.getPermissions()).resolves.toMatchObject({machines: ['debian', 'windows']})

	// A machine deleted out from under its grant no longer appears
	machineIds.splice(machineIds.indexOf('debian'), 1)
	await expect(mcp.getPermissions()).resolves.toMatchObject({machines: ['windows']})
	await expect(mcp.removeMachineGrant('windows')).resolves.toBe(true)
	await expect(mcp.removeMachineGrant('windows')).resolves.toBe(false)
	await expect(mcp.assertMachineAccess('windows')).rejects.toThrow('[permission-denied]')

	await mcp.setPermissions({...defaultPermissionsForTest, machines: 'all'})
	await expect(mcp.assertMachineAccess('windows')).resolves.toBeUndefined()
	await expect(mcp.removeMachineGrant('windows')).resolves.toBe(false)
	await expect(mcp.getPermissions()).resolves.toMatchObject({machines: 'all'})
	await expect(mcp.assertMachineCreateAccess()).rejects.toThrow(
		`[permission-denied] Creating machines is not granted. ${remediation}`,
	)
})

test('stores written before machine grants existed read back with those grants off', async () => {
	const {mcp, store} = await createMcp()
	await store.set('mcp', {
		enabled: true,
		tokens: {},
		permissions: {
			apps: ['plex'],
			appStore: true,
			files: [],
			manageSystem: false,
		} as unknown as McpStoreSettings['permissions'],
	})
	await expect(mcp.getPermissions()).resolves.toStrictEqual({
		apps: ['plex'],
		appStore: true,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	})
})
