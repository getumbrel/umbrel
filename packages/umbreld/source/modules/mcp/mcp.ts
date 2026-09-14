import {createHash, timingSafeEqual} from 'node:crypto'
import nodePath from 'node:path'

import {CLIENT_INFO_META_KEY} from '@modelcontextprotocol/server'
import fse from 'fs-extra'

import type Umbreld from '../../index.js'
import {assertSystemPathInsideBase, isPathInsideOrEqual, resolveRealPathForValidation} from '../files/files.js'
import type {FileChangeEvent} from '../files/watcher.js'
import {OWNER_USER_ID} from '../user/constants.js'
import randomToken from '../utilities/random-token.js'
import AsyncBurstCache from '../utilities/async-burst-cache.js'
import createMcpEndpoint, {type McpEndpoint} from './server.js'
import {MCP_PERMISSION_REMEDIATION} from './tools/shared.js'

export type McpPermissions = {
	apps: 'all' | string[]
	appStore: boolean
	files: 'all' | string[]
	manageSystem: boolean
	machines: 'all' | string[]
	createMachines: boolean
}

export type McpTokenMetadata = {
	label: string
	agentType?: string
}

type McpStoredToken = McpTokenMetadata & {
	secretHash: string
	createdAt: number
}

export type McpStoreSettings = {
	enabled: boolean
	tokens: Record<string, McpStoredToken>
	permissions: McpPermissions
}

// The agent's self-declared identity, kept in memory only (like lastRequestAt)
// so the dashboard can say which agent connected, e.g. "Claude Code".
type McpClientInfo = {
	name: string
	title?: string
	version?: string
}

// One agent in the dashboard's connection list: its latest identity plus when
// it last spoke through this credential
type McpClient = McpClientInfo & {lastRequestAt: number}

type AppOperationFailure = {
	operation: string
	message: string
	failedAt: number
}

const TOKEN_PREFIX = 'umbrelmcp_'
const TOKEN_ID_PATTERN = /^[0-9a-f]{32}$/
const TOKEN_PATTERN = /^umbrelmcp_([0-9a-f]{32})_([0-9a-f]{64})$/
const MAX_TOKENS = 20
const MAX_TOKEN_METADATA_LENGTH = 80

// Client identities are display-only, so fields are clamped to a label-sized
// bound instead of letting a request park megabytes in memory
const MAX_CLIENT_FIELD_LENGTH = 80

// Identities are self-declared, so an authenticated client minting a fresh
// name per request must not grow the connection list forever; past this the
// least recently active entry falls off
const MAX_CLIENTS = 10

// Failures linger until that app runs another operation, so a client naming a
// fresh app per call must not grow the map forever; past this the oldest
// failure falls off
const MAX_APP_OPERATION_FAILURES = 10
const WATCHER_SNAPSHOT_TTL_MS = 1000

function defaultPermissions(): McpPermissions {
	return {
		apps: [],
		appStore: false,
		files: [],
		manageSystem: false,
		machines: [],
		createMachines: false,
	}
}

function hashSecret(secret: string) {
	return createHash('sha256').update(secret).digest('hex')
}

function secretsMatch(actual: string, expected: string) {
	if (!/^[0-9a-f]{64}$/.test(actual) || !/^[0-9a-f]{64}$/.test(expected)) return false
	return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

export default class Mcp {
	#umbreld: Umbreld
	#endpoint: McpEndpoint
	#removeFileChangeListener?: () => void
	#watcherPermissions: AsyncBurstCache<McpPermissions>
	#appOperationFailures = new Map<string, AppOperationFailure>()
	#appOperationTickets = new Map<string, symbol>()
	// Activity is intentionally memory-only. Each credential has an independent
	// connection history so revoking one agent does not disturb the others.
	#tokenActivity = new Map<string, {lastRequestAt: number; clients: Map<string, McpClient>}>()
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.#watcherPermissions = new AsyncBurstCache(() => this.getPermissions(), WATCHER_SNAPSHOT_TTL_MS)
		this.logger = umbreld.logger.createChildLogger('mcp')
		this.#endpoint = createMcpEndpoint(umbreld, umbreld.server.uploadDiskPreflight)
	}

	async start() {
		let enabled = false
		await this.#umbreld.store.getWriteLock(async ({get}) => {
			const settings = await get('mcp')
			enabled = settings?.enabled === true
			if (enabled) this.#listenForFileChanges()
		})
		if (!enabled) return
		await this.#removeStaleFileGrants().catch((error) => this.logger.error('Failed to remove stale file grants', error))
	}

	#listenForFileChanges() {
		if (this.#removeFileChangeListener) return
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)
	}

	#stopListeningForFileChanges() {
		this.#removeFileChangeListener?.()
		this.#removeFileChangeListener = undefined
	}

	async stop() {
		this.#stopListeningForFileChanges()
		await this.#endpoint.close()
	}

	get router() {
		return this.#endpoint.router
	}

	async #storedSettings(): Promise<McpStoreSettings> {
		const settings = await this.#umbreld.store.get('mcp')
		return {
			enabled: settings?.enabled ?? false,
			tokens: settings?.tokens ?? {},
			// Grants added after MCP shipped are absent from older stores and
			// default to not granted
			permissions: {...defaultPermissions(), ...settings?.permissions},
		}
	}

	// No URL here: agents and the dashboard reach this device via whatever host
	// works for them (LAN hostname, raw IP, Tailscale), so the UI derives the
	// endpoint URL from the address the browser is already using.
	async getSettings() {
		const settings = await this.#storedSettings()
		return {
			enabled: settings.enabled,
			permissions: await this.getPermissions(),
		}
	}

	#normalizeTokenMetadata(metadata: McpTokenMetadata): McpTokenMetadata {
		const label = metadata.label.trim()
		const agentType = metadata.agentType?.trim()
		if (!label || label.length > MAX_TOKEN_METADATA_LENGTH) throw new Error('[invalid-token-metadata]')
		if (agentType !== undefined && (!agentType || agentType.length > MAX_TOKEN_METADATA_LENGTH)) {
			throw new Error('[invalid-token-metadata]')
		}
		return {label, ...(agentType ? {agentType} : {})}
	}

	#mintToken(tokens: Record<string, McpStoredToken>, metadata: McpTokenMetadata) {
		let id = randomToken(128)
		while (tokens[id]) id = randomToken(128)
		const secret = randomToken(256)
		return {
			credential: {id, token: `${TOKEN_PREFIX}${id}_${secret}`},
			stored: {...metadata, secretHash: hashSecret(secret), createdAt: Date.now()},
		}
	}

	async enable(metadata: McpTokenMetadata): Promise<{id: string; token: string}>
	async enable(): Promise<null>
	async enable(metadata?: McpTokenMetadata): Promise<{id: string; token: string} | null> {
		const normalized = metadata ? this.#normalizeTokenMetadata(metadata) : undefined
		let credential: {id: string; token: string} | null = null
		// File roots may have disappeared while MCP was off and its watcher was
		// detached. Remove those stale grants before credentials become live again.
		await this.#removeStaleFileGrants()
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const current = (await get('mcp')) ?? {enabled: false, tokens: {}, permissions: defaultPermissions()}
			if (current.enabled) throw new Error('[already-enabled]')

			let tokens = current.tokens
			if (Object.keys(tokens).length === 0) {
				if (!normalized) throw new Error('[no-tokens]')
				const minted = this.#mintToken({}, normalized)
				credential = minted.credential
				tokens = {[minted.credential.id]: minted.stored}
			} else if (normalized) {
				throw new Error('[tokens-exist]')
			}

			await set('mcp', {
				...current,
				enabled: true,
				tokens,
			})
			this.#listenForFileChanges()
		})
		return credential
	}

	async createToken(metadata: McpTokenMetadata) {
		const normalized = this.#normalizeTokenMetadata(metadata)
		let credential: {id: string; token: string} | undefined
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const current = await get('mcp')
			const tokens = current?.tokens ?? {}
			if (!current?.enabled) throw new Error('[not-enabled]')
			if (Object.keys(tokens).length >= MAX_TOKENS) throw new Error('[token-limit]')

			const minted = this.#mintToken(tokens, normalized)
			credential = minted.credential
			await set('mcp', {
				...current,
				tokens: {...tokens, [minted.credential.id]: minted.stored},
			})
		})
		return credential!
	}

	async listTokens() {
		const {tokens} = await this.#storedSettings()
		return Object.entries(tokens)
			.map(([id, token]) => {
				const activity = this.#tokenActivity.get(id)
				return {
					id,
					label: token.label,
					...(token.agentType ? {agentType: token.agentType} : {}),
					createdAt: token.createdAt,
					lastRequestAt: activity?.lastRequestAt ?? null,
					clients: [...(activity?.clients.values() ?? [])]
						.sort((a, b) => b.lastRequestAt - a.lastRequestAt)
						.map((client) => ({...client})),
				}
			})
			.sort((a, b) => a.createdAt - b.createdAt)
	}

	async revokeToken(id: string) {
		if (!TOKEN_ID_PATTERN.test(id)) throw new Error('[token-not-found]')
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const current = await get('mcp')
			if (!current?.tokens?.[id]) throw new Error('[token-not-found]')

			const tokens = {...current.tokens}
			delete tokens[id]
			await set('mcp', {
				...current,
				tokens,
			})
		})
		this.#tokenActivity.delete(id)
		return true
	}

	async disable() {
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const current = await get('mcp')
			if (!current?.enabled) {
				this.#stopListeningForFileChanges()
				return
			}
			await set('mcp', {
				...current,
				enabled: false,
			})
			this.#stopListeningForFileChanges()
		})
		return true
	}

	// Backup restore is a distinct security boundary: restored credentials must
	// never become valid on a different installation. Unlike the user-facing
	// power switch, this deliberately destroys all MCP state.
	async reset() {
		await this.#umbreld.store.getWriteLock(async ({set}) => {
			await set('mcp', {
				enabled: false,
				tokens: {},
				permissions: defaultPermissions(),
			})
		})
		this.#stopListeningForFileChanges()
		this.#tokenActivity.clear()
	}

	async authenticateToken(token: string) {
		const match = TOKEN_PATTERN.exec(token)
		if (!match) return null
		const [, id, secret] = match

		const settings = await this.#storedSettings()
		if (!settings.enabled) return null
		const stored = settings.tokens[id]
		if (!stored || !secretsMatch(hashSecret(secret), stored.secretHash)) return null
		return {tokenId: id}
	}

	// Names the agent behind a credential for the machine console: the label
	// and agent type chosen in settings, plus the client's own most recent name
	async describeAgent(token: string) {
		const match = TOKEN_PATTERN.exec(token)
		if (!match) return undefined
		const tokenId = match[1]
		const stored = (await this.#storedSettings()).tokens[tokenId]
		if (!stored) return undefined
		let latest: McpClient | undefined
		for (const client of this.#tokenActivity.get(tokenId)?.clients.values() ?? []) {
			if (!latest || client.lastRequestAt > latest.lastRequestAt) latest = client
		}
		return {
			tokenId,
			label: stored.label,
			...(stored.agentType ? {agentType: stored.agentType} : {}),
			...(latest ? {clientName: latest.name} : {}),
		}
	}

	// Remember which agents are talking to us so the dashboard can list
	// "Claude Code · 2 minutes ago" per agent. Modern (2026-07-28) clients
	// identify themselves on every request via the _meta envelope, so their
	// entries stay live for free; 2025-era clients identify only during the
	// initialize handshake, so identity-less messages are credited to the most
	// recently active agent — always right while a lone legacy-era agent is at
	// work, and never triggered by modern agents.
	recordRequest(tokenId: string, body?: unknown) {
		const now = Date.now()
		const activity = this.#tokenActivity.get(tokenId) ?? {lastRequestAt: now, clients: new Map<string, McpClient>()}
		activity.lastRequestAt = now
		this.#tokenActivity.set(tokenId, activity)
		if (body === undefined) return

		const clients = activity.clients
		let sawMessage = false
		let sawIdentity = false
		for (const message of Array.isArray(body) ? body : [body]) {
			if (!message || typeof message !== 'object') continue
			const {jsonrpc, method, params} = message as {
				jsonrpc?: unknown
				method?: unknown
				params?: {_meta?: Record<string, unknown>; clientInfo?: unknown}
			}
			// Only well-enveloped JSON-RPC messages update the list — no id
			// check, since notifications legitimately carry none and modern
			// clients ride _meta identity on them too
			if (jsonrpc !== '2.0' || typeof method !== 'string') continue
			sawMessage = true
			const client = params?._meta?.[CLIENT_INFO_META_KEY] ?? (method === 'initialize' ? params?.clientInfo : undefined)
			if (!client || typeof client !== 'object') continue
			const {name, title, version} = client as Record<string, unknown>
			// MCP's Implementation shape requires name and version; partial
			// identities never create or update an entry
			if (typeof name !== 'string' || name === '') continue
			if (typeof version !== 'string' || version === '') continue
			sawIdentity = true
			const key = name.slice(0, MAX_CLIENT_FIELD_LENGTH)
			clients.set(key, {
				name: key,
				...(typeof title === 'string' && title !== '' ? {title: title.slice(0, MAX_CLIENT_FIELD_LENGTH)} : {}),
				version: version.slice(0, MAX_CLIENT_FIELD_LENGTH),
				lastRequestAt: now,
			})
		}

		// A well-formed body with no identity is a legacy-era agent mid-session
		if (sawMessage && !sawIdentity) {
			let latest: McpClient | undefined
			for (const client of clients.values()) {
				if (!latest || client.lastRequestAt > latest.lastRequestAt) latest = client
			}
			if (latest) latest.lastRequestAt = now
		}

		while (clients.size > MAX_CLIENTS) {
			let oldest: McpClient | undefined
			for (const client of clients.values()) {
				if (!oldest || client.lastRequestAt < oldest.lastRequestAt) oldest = client
			}
			if (!oldest) break
			clients.delete(oldest.name)
		}
	}

	async getPermissions(): Promise<McpPermissions> {
		const {permissions} = await this.#storedSettings()
		const installedAppIds = new Set(this.#umbreld.apps.instances.map((app) => app.id))
		const apps =
			permissions.apps === 'all' ? 'all' : [...new Set(permissions.apps)].filter((appId) => installedAppIds.has(appId))
		const machines =
			permissions.machines === 'all' ? 'all' : await this.#existingMachineIds([...new Set(permissions.machines)])
		return {...permissions, apps, machines}
	}

	async #existingMachineIds(ids: string[]) {
		const existing: string[] = []
		for (const id of ids) if (await this.#umbreld.machines.exists(id)) existing.push(id)
		return existing
	}

	async #updatePermissions(update: (permissions: McpPermissions) => McpPermissions | undefined) {
		let updated = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const settings = (await get('mcp')) ?? {enabled: false, tokens: {}, permissions: defaultPermissions()}
			const permissions = update(settings.permissions)
			if (!permissions) return
			await set('mcp', {
				enabled: settings.enabled ?? false,
				tokens: settings.tokens ?? {},
				permissions,
			})
			updated = true
		})
		if (updated) this.#watcherPermissions.clear()
		return updated
	}

	async setPermissions(permissions: McpPermissions) {
		let apps: McpPermissions['apps']
		if (permissions.apps === 'all') {
			apps = 'all'
		} else {
			apps = [...new Set(permissions.apps)]
			for (const appId of apps) {
				if (!(await this.#umbreld.apps.isInstalled(appId))) throw new Error(`[app-not-installed] '${appId}'`)
			}
		}

		let files: McpPermissions['files']
		if (permissions.files === 'all') {
			files = 'all'
		} else {
			files = []
			for (const virtualPath of permissions.files) {
				const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
				const segments = path.split('/').filter(Boolean)
				if (
					segments[0] !== 'Home' &&
					!((segments[0] === 'External' || segments[0] === 'Network') && segments.length === 1)
				) {
					throw new Error('[invalid-base] Only Home, External and Network folders can be granted')
				}

				const systemPath = await this.#umbreld.files.virtualToSystemPath(path, OWNER_USER_ID)
				const stats = await fse.stat(systemPath).catch(() => {
					throw new Error(`[does-not-exist] '${path}'`)
				})
				if (!stats.isDirectory()) throw new Error(`[not-a-directory] '${path}'`)
				files.push(path)
			}
			files = [...new Set(files)]
		}

		let machines: McpPermissions['machines']
		if (permissions.machines === 'all') {
			machines = 'all'
		} else {
			machines = [...new Set(permissions.machines)]
			for (const id of machines) {
				if (!(await this.#umbreld.machines.exists(id))) throw new Error(`[machine-not-found] '${id}'`)
			}
		}

		const normalized: McpPermissions = {
			apps,
			appStore: permissions.appStore,
			files,
			manageSystem: permissions.manageSystem,
			machines,
			createMachines: permissions.createMachines,
		}
		await this.#updatePermissions(() => normalized)
		return normalized
	}

	async assertAppAccess(appId: string) {
		if (!(await this.#umbreld.apps.isInstalled(appId))) {
			throw new Error(`[app-not-installed] App '${appId}' is not installed`)
		}
		const permissions = await this.getPermissions()
		if (permissions.apps !== 'all' && !permissions.apps.includes(appId)) {
			throw new Error(`[permission-denied] App '${appId}' is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}
	}

	async assertAppStoreAccess() {
		if (!(await this.getPermissions()).appStore) {
			throw new Error(`[permission-denied] App Store access is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}
	}

	async assertSystemAccess() {
		if (!(await this.getPermissions()).manageSystem) {
			throw new Error(`[permission-denied] System management is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}
	}

	async assertMachineAccess(id: string) {
		if (!(await this.#umbreld.machines.exists(id))) {
			throw new Error(`[machine-not-found] Machine '${id}' does not exist`)
		}
		const permissions = await this.getPermissions()
		if (permissions.machines !== 'all' && !permissions.machines.includes(id)) {
			throw new Error(`[permission-denied] Machine '${id}' is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}
	}

	async assertMachineCreateAccess() {
		if (!(await this.getPermissions()).createMachines) {
			throw new Error(`[permission-denied] Creating machines is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}
	}

	async addMachineGrant(id: string) {
		await this.#updatePermissions((permissions) => {
			if (permissions.machines === 'all' || permissions.machines.includes(id)) return
			return {...permissions, machines: [...permissions.machines, id]}
		})
	}

	async removeMachineGrant(id: string) {
		return this.#updatePermissions((permissions) => {
			if (permissions.machines === 'all') return
			const machines = permissions.machines.filter((candidate) => candidate !== id)
			if (machines.length === permissions.machines.length) return
			return {...permissions, machines}
		})
	}

	async allowedFileGrants(permissions?: McpPermissions) {
		permissions ??= await this.getPermissions()
		const grants = permissions.files === 'all' ? ['/Home', '/External', '/Network'] : [...permissions.files]

		if (permissions.apps === 'all') grants.push('/Apps')
		else grants.push(...permissions.apps.map((appId) => `/Apps/${appId}`))

		return [...new Set(grants)]
	}

	async #fileGrantFor(virtualPath: string, permissions?: McpPermissions) {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		const grants = await this.allowedFileGrants(permissions)
		const matching = grants.filter((grant) => path === grant || path.startsWith(`${grant}/`))
		return matching.sort((first, second) => second.length - first.length)[0]
	}

	normalizeFilePath(virtualPath: string) {
		return this.#umbreld.files.normalizeVirtualPath(virtualPath)
	}

	async assertFileAccess(virtualPath: string) {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		const grant = await this.#fileGrantFor(path)
		if (!grant) {
			throw new Error(`[permission-denied] File path '${path}' is not granted. ${MCP_PERMISSION_REMEDIATION}`)
		}

		try {
			const [systemPath, grantSystemPath] = await Promise.all([
				this.#umbreld.files.virtualToSystemPath(path, OWNER_USER_ID),
				this.#umbreld.files.virtualToSystemPath(grant, OWNER_USER_ID),
			])
			const grantRealPath = await fse.realpath(grantSystemPath)
			await assertSystemPathInsideBase(systemPath, grantRealPath, {virtualPath: path, baseLabel: grant})
			return {path, systemPath, grant}
		} catch {
			throw new Error(`[permission-denied] File path '${path}' is not safely contained in '${grant}'`)
		}
	}

	async assertFileWriteAccess(virtualPath: string) {
		const access = await this.assertFileAccess(virtualPath)
		const segments = access.path.split('/').filter(Boolean)
		if (segments[0] !== 'Apps') return access

		const appId = segments[1]
		const appPath = segments.slice(2)
		const deny = (): never => {
			throw new Error(
				`[permission-denied] App framework path '${access.path}' is read-only through MCP. Write inside an existing app data directory instead.`,
			)
		}

		// MCP may read the app root, but must not create, replace, rename, or
		// remove its direct entries. These include docker-compose.yml, exports.sh,
		// umbrel-app.yml, settings.yml, templates, and the data directories
		// themselves. Existing directories below this level remain writable.
		if (!appId || appPath.length <= 1) deny()

		const appRootSystemPath = await this.#umbreld.files.virtualToSystemPath(`/Apps/${appId}`, OWNER_USER_ID)
		const {baseRealPath: appRootRealPath, candidateRealPath} = await assertSystemPathInsideBase(
			access.systemPath,
			appRootSystemPath,
			{virtualPath: access.path, baseLabel: `/Apps/${appId}`},
		)
		const realRelativePath = nodePath.relative(appRootRealPath, candidateRealPath)
		const realSegments = realRelativePath.split(nodePath.sep).filter(Boolean)

		// Apply the same rule after resolving symlinks so a writable-looking path
		// cannot alias a protected root entry or anything under hooks. Lifecycle
		// hooks execute on the host, outside app containers.
		if (realSegments.length <= 1 || realSegments[0] === 'hooks') deny()

		// Uploads can create missing parent directories. Requiring the first real
		// app directory to already exist prevents a nested upload from implicitly
		// creating a new direct child in the read-only app root.
		const topLevelDirectory = nodePath.join(appRootRealPath, realSegments[0])
		const topLevelDirectoryExists = await fse
			.stat(topLevelDirectory)
			.then((stats) => stats.isDirectory())
			.catch(() => false)
		if (!topLevelDirectoryExists || !isPathInsideOrEqual(appRootRealPath, topLevelDirectory)) deny()

		// Resolve a prospective hooks path even when the directory does not exist,
		// covering aliases through an existing symlink as well as normal installs.
		const hooksRealPath = await resolveRealPathForValidation(nodePath.join(appRootSystemPath, 'hooks'))
		if (isPathInsideOrEqual(hooksRealPath, candidateRealPath)) deny()

		return access
	}

	async hasFullHomeAccess() {
		const permissions = await this.getPermissions()
		return permissions.files === 'all' || permissions.files.includes('/Home')
	}

	async addAppGrant(appId: string) {
		await this.#updatePermissions((permissions) => {
			if (permissions.apps === 'all' || permissions.apps.includes(appId)) return
			return {...permissions, apps: [...permissions.apps, appId]}
		})
	}

	startAppOperation(appId: string, operation: string, task: () => Promise<void>) {
		const ticket = Symbol(operation)
		this.#appOperationTickets.set(appId, ticket)
		this.#appOperationFailures.delete(appId)
		void Promise.resolve()
			.then(task)
			.catch((error) => {
				if (this.#appOperationTickets.get(appId) !== ticket) return
				const message = error instanceof Error ? error.message : String(error)
				this.#appOperationFailures.set(appId, {operation, message, failedAt: Date.now()})
				this.logger.error(`Background app operation '${operation}' failed for '${appId}'`, error)

				// A newer operation deletes its app's failure before this can
				// re-record it, so map order is failure order
				while (this.#appOperationFailures.size > MAX_APP_OPERATION_FAILURES) {
					const [oldest] = this.#appOperationFailures.keys()
					this.#appOperationFailures.delete(oldest)
				}
			})
			.finally(() => {
				if (this.#appOperationTickets.get(appId) === ticket) this.#appOperationTickets.delete(appId)
			})
	}

	getAppOperationFailure(appId: string) {
		const failure = this.#appOperationFailures.get(appId)
		return failure
			? {...failure, message: failure.message.replaceAll(this.#umbreld.dataDirectory, '<data-directory>')}
			: null
	}

	async removeAppGrant(appId: string) {
		return this.#updatePermissions((permissions) => {
			if (permissions.apps === 'all') return
			const apps = permissions.apps.filter((candidate) => candidate !== appId)
			if (apps.length === permissions.apps.length) return
			return {...permissions, apps}
		})
	}

	async removeFileGrantsWithin(virtualPath: string) {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		return this.#updatePermissions((permissions) => {
			if (permissions.files === 'all') return
			const files = permissions.files.filter((grant) => grant !== path && !grant.startsWith(`${path}/`))
			if (files.length === permissions.files.length) return
			return {...permissions, files}
		})
	}

	async #handleFileChange(event: FileChangeEvent) {
		if (event.type !== 'delete') return
		const path = this.#umbreld.files.systemToVirtualPath(event.path)
		if (path !== '/Home' && !path.startsWith('/Home/')) return
		const {files} = await this.#watcherPermissions.get()
		if (files === 'all' || !files.some((grant) => grant === path || grant.startsWith(`${path}/`))) return
		await this.removeFileGrantsWithin(path)
	}

	async #removeStaleFileGrants() {
		const {files} = await this.getPermissions()
		if (files === 'all') return
		for (const path of files) {
			if (path !== '/Home' && !path.startsWith('/Home/')) continue
			const exists = await this.#umbreld.files
				.virtualToSystemPath(path, OWNER_USER_ID)
				.then((systemPath) => fse.pathExists(systemPath))
				.catch(() => false)
			if (!exists) {
				this.logger.log(`Removing stale file grant '${path}'`)
				await this.removeFileGrantsWithin(path)
			}
		}
	}
}
