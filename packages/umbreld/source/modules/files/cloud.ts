import {randomUUID} from 'node:crypto'
import type {Dirent} from 'node:fs'
import nodePath from 'node:path'

import fse from 'fs-extra'
import PQueue, {AbortError as QueueAbortError} from 'p-queue'
import stripAnsi from 'strip-ansi'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'
import runEvery from '../utilities/run-every.js'

import CloudAuth, {
	CloudProviderHttpError,
	OAUTH_SESSION_LIFETIME,
	type CloudProviderLocations,
	type ConnectedAccount,
	type ICloudChallenge,
	type OAuthSession,
} from './cloud-auth.js'
import CloudRclone, {
	RcloneAbortedError,
	RcloneProcessError,
	buildRcloneRemoteSource,
	type RcloneBrowseResult,
	type RcloneConfigTransaction,
} from './cloud-rclone.js'
import {normalizePath, pathsOverlap} from './files.js'
import {
	CLOUD_ACCOUNT_NOT_FOUND_ERROR,
	CLOUD_DESTINATION_MISSING_ERROR,
	CLOUD_INVALID_ACCOUNT_CONFIG_ERROR,
	CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR,
	CLOUD_PROVIDERS,
	CLOUD_WEBDAV_FLAVOR_IDS,
	UUID_PATTERN,
	createEmptyCloudStore,
	type Account,
	type AccountAttention,
	type CloudSync,
	type CloudSyncActivity,
	type CloudSyncStatus,
	type CloudStore,
	type DestinationRef,
	type CloudSyncAttention,
	type CloudSyncMode,
	type Provider,
	type RemoteRef,
	type WebDavFlavor,
} from './cloud-types.js'

export const CLOUD_SCHEDULER_INTERVAL = 30 * 1000
export const CLOUD_AUTO_INTERVAL = 30 * 60 * 1000
export const CLOUD_AUTO_JITTER_MAX = 5 * 60 * 1000
export const CLOUD_STARTUP_JITTER_MAX = 30 * 60 * 1000
export const CLOUD_RETRY_INITIAL = 60 * 1000
export const CLOUD_RETRY_MAX = 60 * 60 * 1000
export const CLOUD_QUOTA_COOLDOWN = 30 * 60 * 1000
export const CLOUD_HOME_FREE_SPACE_FLOOR = 3n * 1024n * 1024n * 1024n
export const CLOUD_OTHER_FREE_SPACE_FLOOR = 1n * 1024n * 1024n * 1024n

const CLOUD_FAILURE_LOG_RECORDS = 20
const CLOUD_ATTENTION_MESSAGE_MAX_LENGTH = 512

type ResolveDestination = (
	destination: DestinationRef,
	userId: string,
	options?: {requireEmpty?: boolean; checkOnly?: boolean},
) => Promise<string>

type AuthSession =
	| {kind: 'oauth'; oauth: OAuthSession}
	| {
			kind: 'icloud'
			transaction: RcloneConfigTransaction
			appleId: string
			state: string
			expiresAt: number
	  }
	| {kind: 'config'; transaction: RcloneConfigTransaction; expiresAt: number; oauthSessionId?: string}

type AccountState = {kind: 'ready'} | {kind: 'authenticating'; session?: AuthSession} | {kind: 'closed'}
type RunOutcome = 'retained' | 'remove-runtime'
type OAuthCompletionResult = {account: Account; locations: CloudProviderLocations}
type ICloudCompletionResult = {accountId: string} & (
	| {complete: false; challenge: ICloudChallenge}
	| {complete: true; account: Account; locations: CloudProviderLocations}
)
type ActiveAuthCompletion =
	| {kind: 'oauth'; promise: Promise<OAuthCompletionResult>}
	| {kind: 'icloud'; promise: Promise<ICloudCompletionResult>}
export type SharedDestinationDeleteCandidate = {path: string; sync: CloudSync; userId: string}

export type AccountRuntime = {
	accountId: string
	userId: string
	queue: PQueue
	state: AccountState
	activeAuthCompletion?: ActiveAuthCompletion
	activeController?: AbortController
	attention?: AccountAttention
	cooldownUntil?: number
}

export type SyncRuntime = {
	syncId: string
	accountId: string
	userId: string
	destinationPath?: string
	phase: 'idle' | 'queued' | 'running'
	controller?: AbortController
	runPromise?: Promise<void>
	activity?: CloudSyncActivity
	attention?: CloudSyncAttention
	nextRunAt?: number
	retryCount: number
	removing: boolean
	destinationBlockers: Set<symbol>
	destinationUnavailable: boolean
}

export type CloudSyncWithStatus = CloudSync & {status: CloudSyncStatus}
export type CloudAccountWithAttention = Account & {attention?: AccountAttention}

export type CloudFailureKind = 'cancelled' | 'auth' | 'quota' | 'error'

const errorMessages = (error: unknown) => {
	if (error instanceof RcloneProcessError) {
		return error.records.flatMap((record) => {
			const level = record.level?.toLowerCase()
			return (level === 'error' || level === 'critical') && typeof record.msg === 'string'
				? [record.msg.toLowerCase()]
				: []
		})
	}
	return error instanceof Error ? [error.message.toLowerCase()] : []
}

const cloudFailureMessage = (error: unknown) => {
	if (!(error instanceof RcloneProcessError)) return

	for (let index = error.records.length - 1; index >= 0; index -= 1) {
		const record = error.records[index]
		if (record.level?.toLowerCase() !== 'error' || typeof record.msg !== 'string') continue
		const message = stripAnsi(record.msg)
			.replace(/\bhttps?:\/\/\S+/gi, '[redacted-url]')
			.replace(/\p{Cc}+/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim()
		if (message) return message.slice(0, CLOUD_ATTENTION_MESSAGE_MAX_LENGTH)
	}
}

type FailurePatterns = {auth: readonly RegExp[]; quota: readonly RegExp[]}

// These match exact status shapes emitted by rclone's HTTP/WebDAV layers. Keep
// the delimiter checks: rclone messages can contain user-controlled filenames.
const HTTP_FAILURE_PATTERNS: FailurePatterns = {
	auth: [
		/\bhttp(?: error)?\s+401(?:\s+\(401 unauthori[sz]ed\)|$|:\s)/,
		/\b(?:http\s+)?status(?: code)?\s+401(?:$|:\s)/,
		/(?:^|:\s)401 unauthori[sz]ed$/,
	],
	quota: [
		/\bhttp(?: error)?\s+429(?:\s+\(429 too many requests\)|$|:\s)/,
		/\b(?:http\s+)?status(?: code)?\s+429(?:$|:\s)/,
		/(?:^|:\s)429 too many requests$/,
	],
}

// rclone's OAuth token source emits these only while refreshing an existing
// connection. Client/scope errors are intentionally excluded: reconnecting the
// user's account cannot repair Umbrel's OAuth client configuration.
const OAUTH_INVALID_GRANT_PATTERN = /(?:^|:\s)(?:couldn't fetch token:\s+|oauth2:\s+)invalid_grant(?:$|[:;,\s"'])/
const OAUTH_AUTH_FAILURE_PATTERNS = [
	OAUTH_INVALID_GRANT_PATTERN,
	/(?:^|:\s)(?:couldn't fetch token:\s+|oauth2:\s+)(?:interaction_required|login_required|consent_required)(?:$|[:;,\s"'])/,
	/\btoken expired and there's no refresh token - manually refresh with "rclone config reconnect\b/,
]
const DROPBOX_INVALID_ACCESS_TOKEN_PATTERN = /(?:^|:\s)invalid_access_token\/(?:$|[.\s])/

const HTTP_BANDWIDTH_LIMIT_PATTERN = /\bhttp(?: error)?\s+509(?:\s+\(509 bandwidth limit exceeded\)|$|:\s)/
const ONEDRIVE_STORAGE_QUOTA_PATTERNS = [
	/\bhttp(?: error)?\s+507(?:\s+\(507 insufficient storage\)|$|:\s)/,
	/(?:^|:\s)507 insufficient storage$/,
]

// Provider codes and punctuation are pinned to rclone v1.74.4 and the provider
// APIs. Provider scoping prevents a filename resembling another provider's
// error code from blocking an account.
const PROVIDER_FAILURE_PATTERNS = {
	'google-drive': {
		auth: [/\bgoogleapi:\s+error\s+401(?:$|:\s)/],
		quota: [
			/\bgoogleapi:\s+error\s+(?:403|429):[\s\S]*\breason:\s+(?:userratelimitexceeded|ratelimitexceeded|dailylimitexceeded|downloadquotaexceeded|storagequotaexceeded|quotaexceeded)(?:$|,\s*message:)/,
			/\bgoogleapi:\s+error\s+(?:403|429):[^\n]*,\s*(?:userratelimitexceeded|ratelimitexceeded|dailylimitexceeded|downloadquotaexceeded|storagequotaexceeded|quotaexceeded)$/,
		],
	},
	dropbox: {
		auth: [/(?:^|:\s)(?:invalid_access_token|expired_access_token)\/(?:$|[.\s])/],
		quota: [/(?:^|:\s)(?:too_many_requests|too_many_write_operations)\/(?:$|[.\s])/],
	},
	onedrive: {
		auth: [/(?:^|:\s)(?:invalidauthenticationtoken|unauthenticated)(?:$|:\s)/],
		quota: [
			/(?:^|:\s)(?:activitylimitreached|quotalimitreached)(?:$|:\s)/,
			/(?:^|:\s)509 bandwidth limit exceeded$/,
			HTTP_BANDWIDTH_LIMIT_PATTERN,
			...ONEDRIVE_STORAGE_QUOTA_PATTERNS,
		],
	},
	webdav: {
		auth: [],
		quota: [/(?:^|:\s)509 bandwidth limit exceeded$/, HTTP_BANDWIDTH_LIMIT_PATTERN],
	},
	icloud: {
		auth: [
			/\bmissing icloud trust token:\s+try refreshing it with "rclone config reconnect\b/,
			/\btrust token expired, please reauth\b/,
			/(?:^|:\s)authsrpcomplete:\s+sign in failed:\s+incorrect username or password$/,
		],
		quota: [],
	},
} satisfies Record<Provider, FailurePatterns>

const OAUTH_PROVIDERS = new Set<Provider>(['google-drive', 'dropbox', 'onedrive'])

const matchesFailurePattern = (messages: string[], patterns: readonly RegExp[]) =>
	messages.some((message) => patterns.some((pattern) => pattern.test(message)))

const AUTH_ACCOUNT_ERROR_CODES = new Set([
	CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR,
	CLOUD_INVALID_ACCOUNT_CONFIG_ERROR,
	CLOUD_ACCOUNT_NOT_FOUND_ERROR,
])

const isPaused = (sync: CloudSync) => Boolean(sync.pauseReasons?.user || sync.pauseReasons?.restore)

const addPauseReason = (sync: CloudSync, reason: 'user' | 'restore'): CloudSync => ({
	...sync,
	pauseReasons: {...sync.pauseReasons, [reason]: true},
})

const resumePause = (sync: CloudSync): CloudSync => {
	const pauseReasons = {...sync.pauseReasons}
	if (pauseReasons.restore) delete pauseReasons.restore
	else delete pauseReasons.user

	const resumed = {...sync}
	if (pauseReasons.user || pauseReasons.restore) resumed.pauseReasons = pauseReasons
	else delete resumed.pauseReasons
	return resumed
}

export const classifyCloudFailure = (error: unknown, provider?: Provider): CloudFailureKind => {
	if (error instanceof RcloneAbortedError || error instanceof QueueAbortError) return 'cancelled'
	if (error instanceof CloudProviderHttpError) {
		if (error.statusCode === 401) return 'auth'
		if (error.statusCode === 429) return 'quota'
		provider = error.provider
	}
	const messages = errorMessages(error)
	if (!provider) return 'error'
	const patterns = PROVIDER_FAILURE_PATTERNS[provider]
	if (
		matchesFailurePattern(messages, HTTP_FAILURE_PATTERNS.auth) ||
		(OAUTH_PROVIDERS.has(provider) && matchesFailurePattern(messages, OAUTH_AUTH_FAILURE_PATTERNS)) ||
		matchesFailurePattern(messages, patterns.auth)
	) {
		return 'auth'
	}
	if (matchesFailurePattern(messages, HTTP_FAILURE_PATTERNS.quota) || matchesFailurePattern(messages, patterns.quota)) {
		return 'quota'
	}
	return 'error'
}

const isAlreadyRevokedOAuthGrant = (error: unknown, provider: Provider) => {
	if (!OAUTH_PROVIDERS.has(provider)) return false
	if (error instanceof CloudProviderHttpError) {
		if (error.provider !== provider) return false
		if (provider === 'google-drive') {
			return error.statusCode === 400 && error.providerErrorCode === 'invalid_token'
		}
		if (provider === 'dropbox') {
			return error.statusCode === 401 && error.providerErrorCode === 'invalid_access_token'
		}
		return false
	}
	return (
		provider === 'dropbox' &&
		matchesFailurePattern(errorMessages(error), [OAUTH_INVALID_GRANT_PATTERN, DROPBOX_INVALID_ACCESS_TOKEN_PATTERN])
	)
}

const validateId = (id: string, error: string) => {
	if (!UUID_PATTERN.test(id)) throw new Error(error)
}

const validateAccount = (account: Account) => {
	validateId(account.id, '[cloud-invalid-account-id]')
	if (!account.userId || account.userId.includes('\0')) throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	if (!CLOUD_PROVIDERS.some(({id}) => id === account.provider) || !account.connection) {
		throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	}
	if (!account.identity || account.identity.length > 4096 || account.identity.includes('\0')) {
		throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	}
	if (!account.displayName || account.displayName.length > 1024 || account.displayName.includes('\0')) {
		throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	}
	if (
		(account.provider === 'webdav' && account.connection.kind !== 'webdav') ||
		(account.provider === 'icloud' && account.connection.kind !== 'icloud') ||
		(!['webdav', 'icloud'].includes(account.provider) && account.connection.kind !== 'oauth')
	) {
		throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	}
	if (account.connection.kind === 'webdav' && !CLOUD_WEBDAV_FLAVOR_IDS.includes(account.connection.flavor)) {
		throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
	}
}

const accountForSync = (store: CloudStore, sync: CloudSync) => store.accounts.find(({id}) => id === sync.accountId)

const validateRemote = (account: Account, remote: RemoteRef) => {
	buildRcloneRemoteSource(account.provider, remote)
}

const normalizedVirtualPath = (value: string) => {
	if (!value.startsWith('/') || value.includes('\0') || value.includes('\\'))
		throw new Error('[cloud-invalid-destination]')
	const normalized = normalizePath(value)
	if (normalized !== value || value.endsWith('/')) throw new Error('[cloud-invalid-destination]')
	return normalized
}

const hasExactlyKeys = (value: object, keys: string[]) => {
	const actual = Object.keys(value).sort()
	return actual.length === keys.length && keys.sort().every((key, index) => actual[index] === key)
}

const validStorageIdentity = (value: string | undefined) =>
	Boolean(value && value === value.trim() && value.length <= 1024 && !value.includes('\0'))

export type CloudDestinationDetails =
	| {kind: 'home'; path: string}
	| {kind: 'external'; path: string; mountPath: string; filesystemUuid: string}
	| {kind: 'network'; path: string; mountPath: string; host: string; share: string}
	| {kind: 'raid'; path: string; mountPath: string; filesystemUuid: string}

export type ExternalStorageLocation = {
	filesystemUuid?: string
	mountPaths: string[]
}

export type NetworkStorageLocation = {
	host: string
	share: string
	mountPath: string
}

export const cloudDestinationDetails = (destination: DestinationRef, userId: string): CloudDestinationDetails => {
	const path = normalizedVirtualPath(destination.path)
	const components = path.split('/').filter(Boolean)

	const expectedHomeRoot = userId === OWNER_USER_ID ? ['Home'] : ['Users', userId]
	if (
		components.length > expectedHomeRoot.length &&
		expectedHomeRoot.every((component, index) => components[index] === component) &&
		(userId === OWNER_USER_ID || components[expectedHomeRoot.length] !== 'Trash')
	) {
		if (!hasExactlyKeys(destination, ['path'])) throw new Error('[cloud-invalid-destination]')
		return {kind: 'home', path}
	}

	if (components[0] === 'External' && components.length >= 3) {
		if (!hasExactlyKeys(destination, ['filesystemUuid', 'path']) || !validStorageIdentity(destination.filesystemUuid)) {
			throw new Error('[cloud-invalid-destination]')
		}
		return {
			kind: 'external',
			path,
			mountPath: `/${components.slice(0, 2).join('/')}`,
			filesystemUuid: destination.filesystemUuid!,
		}
	}

	if (components[0] === 'Network' && components.length >= 4) {
		if (
			!hasExactlyKeys(destination, ['host', 'path', 'share']) ||
			!validStorageIdentity(destination.host) ||
			!validStorageIdentity(destination.share)
		) {
			throw new Error('[cloud-invalid-destination]')
		}
		return {
			kind: 'network',
			path,
			mountPath: `/${components.slice(0, 3).join('/')}`,
			host: destination.host!,
			share: destination.share!,
		}
	}

	// A mounted Linux RAID array (/Raid/<name>/<dir>). The filesystem UUID is the
	// stable identity, mirroring external storage: it survives the array landing
	// on a different /dev/mdN or being renamed.
	if (components[0] === 'Raid' && components.length >= 3) {
		if (!hasExactlyKeys(destination, ['filesystemUuid', 'path']) || !validStorageIdentity(destination.filesystemUuid)) {
			throw new Error('[cloud-invalid-destination]')
		}
		return {
			kind: 'raid',
			path,
			mountPath: `/${components.slice(0, 2).join('/')}`,
			filesystemUuid: destination.filesystemUuid!,
		}
	}

	throw new Error('[cloud-invalid-destination]')
}

export const cloudDestinationPath = (destination: DestinationRef, userId: string) =>
	cloudDestinationDetails(destination, userId).path

const authNotification = (accountId: string) => `cloud-auth:${accountId}`

export default class CloudManager {
	readonly umbreld: Umbreld
	readonly logger: Umbreld['logger']
	readonly rclone: CloudRclone
	readonly auth: CloudAuth
	readonly resolveDestination: ResolveDestination
	readonly accountRuntimes = new Map<string, AccountRuntime>()
	readonly syncRuntimes = new Map<string, SyncRuntime>()
	readonly pendingDestinations = new Set<string>()
	readonly globalSyncQueue = new PQueue({concurrency: 1})

	private readonly now: () => number
	private readonly random: () => number
	private readonly onActivity?: (userId: string, activity: CloudSyncActivity[]) => void
	private readonly accountQueues = new Map<string, PQueue>()
	private readonly pendingDestinationRefs = new Map<string, {destination: DestinationRef; userId: string}>()
	private readonly storageLeases = new Map<string, Promise<void>>()
	private readonly storageGenerations = new Map<string, number>()
	private readonly removingUsers = new Set<string>()
	private readonly rewindRestoreTargets = new Map<symbol, string[]>()
	private protectionState?: Promise<CloudStore>
	private protectionReady = false
	private stopScheduler?: () => void
	private removeMemberSharesListener?: () => void
	private scheduledTick?: Promise<void>
	private initialMaintenance?: Promise<void>
	private stopped = true

	constructor({
		umbreld,
		resolveDestination,
		rclone = new CloudRclone({
			dataDirectory: umbreld.dataDirectory,
			fileOwner: {userId: 1000, groupId: 1000},
		}),
		auth,
		now = Date.now,
		random = Math.random,
		onActivity,
	}: {
		umbreld: Umbreld
		resolveDestination: ResolveDestination
		rclone?: CloudRclone
		auth?: CloudAuth
		now?: () => number
		random?: () => number
		onActivity?: (userId: string, activity: CloudSyncActivity[]) => void
	}) {
		this.umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('cloud')
		this.resolveDestination = resolveDestination
		this.rclone = rclone
		this.auth = auth ?? new CloudAuth({rclone, now})
		this.now = now
		this.random = random
		this.onActivity = onActivity
	}

	async restoreProtectionState() {
		if (this.protectionState) return this.protectionState

		const restoration = (async () => {
			// Account deletion is durably tombstoned before its cross-module
			// cleanup begins. Seed the process-lifetime gate before restoring
			// runtimes so interrupted cleanup cannot revive a member's jobs.
			for (const userId of await this.umbreld.user.listDeletedMemberIds()) this.removingUsers.add(userId)

			const store = await this.readStore()
			this.restoreRuntimes(store)
			this.protectionReady = true
			return store
		})()
		this.protectionState = restoration

		try {
			return await restoration
		} catch (error) {
			if (this.protectionState === restoration) this.protectionState = undefined
			throw error
		}
	}

	assertReady() {
		if (!this.protectionReady || this.stopped) throw new Error('[cloud-not-ready]')
	}

	async start({background = false}: {background?: boolean} = {}) {
		if (!this.stopped) return

		const store = await this.restoreProtectionState()
		this.removeMemberSharesListener = this.umbreld.eventBus.on('files:member-shares:change', async () => {
			await this.revalidateDestinationAccess().catch((error) => {
				this.logger.error(`Failed to revalidate Cloud destination access`, error)
			})
		})
		this.stopped = false
		this.stopScheduler = runEvery(
			`${CLOUD_SCHEDULER_INTERVAL}ms`,
			async () => {
				await this.initialMaintenance
				if (this.stopped) return
				const tick = this.runSchedulerTick()
				this.scheduledTick = tick
				try {
					await tick
				} catch (error) {
					this.logger.error(`Cloud scheduler tick failed`, error)
				} finally {
					if (this.scheduledTick === tick) this.scheduledTick = undefined
				}
			},
			{runInstantly: false},
		)
		const maintenance = this.runInitialMaintenance(store).catch((error) => {
			this.logger.error(`Cloud initial maintenance failed`, error)
		})
		const trackedMaintenance = maintenance.finally(() => {
			if (this.initialMaintenance === trackedMaintenance) this.initialMaintenance = undefined
		})
		this.initialMaintenance = trackedMaintenance
		if (!background) await this.initialMaintenance
	}

	private async runInitialMaintenance(store: CloudStore) {
		await this.removeOrphanedAccountDirectories(store).catch((error) => {
			this.logger.error(`Failed to remove orphaned cloud credentials`, error)
		})
		for (const account of store.accounts) {
			if (this.removingUsers.has(account.userId)) continue
			const runtime = this.accountRuntimes.get(account.id)
			if (!runtime) continue
			await runtime.queue.add(async () => {
				if (this.removingUsers.has(account.userId)) return
				await this.rclone.removeTemporaryConfigFiles(account.id).catch((error) => {
					this.logger.error(`Failed to remove abandoned cloud credentials for account ${account.id}`, error)
				})
				try {
					if (!(await this.rclone.hasCanonicalConfig(account.id, account.provider)))
						await this.setAuthAttention(account.id)
				} catch {
					await this.setAuthAttention(account.id)
				}
			})
		}
		await this.schedulerTick()
	}

	async stop() {
		if (this.stopped) {
			this.protectionReady = false
			this.protectionState = undefined
			return
		}
		this.stopped = true
		this.protectionReady = false
		this.protectionState = undefined
		this.stopScheduler?.()
		this.stopScheduler = undefined
		this.removeMemberSharesListener?.()
		this.removeMemberSharesListener = undefined
		await this.initialMaintenance
		await this.scheduledTick

		for (const runtime of this.accountRuntimes.values()) {
			const state = runtime.state
			runtime.state = {kind: 'closed'}
			runtime.activeController?.abort()
			if (state.kind === 'authenticating' && (state.session?.kind === 'icloud' || state.session?.kind === 'config')) {
				await state.session.transaction.abort().catch(() => {})
			}
		}
		for (const runtime of this.syncRuntimes.values()) runtime.controller?.abort()
		await Promise.all([...this.accountRuntimes.values()].map(({queue}) => queue.onIdle()))
		await this.globalSyncQueue.onIdle()
	}

	getProviders() {
		const available = this.auth.getAvailableProviders()
		return CLOUD_PROVIDERS.filter(({id}) => available.includes(id))
	}

	async getAccounts(userId: string): Promise<CloudAccountWithAttention[]> {
		return (await this.readStore()).accounts
			.filter((account) => account.userId === userId)
			.map((account) => {
				const attention = this.accountRuntimes.get(account.id)?.attention
				return {...account, ...(attention ? {attention} : {})}
			})
	}

	async getSyncs(userId: string): Promise<CloudSyncWithStatus[]> {
		const store = await this.readStore()
		return store.syncs.flatMap((sync) =>
			accountForSync(store, sync)?.userId === userId ? [{...sync, status: this.statusFor(sync)}] : [],
		)
	}

	getActivity(userId: string) {
		return [...this.syncRuntimes.values()].flatMap((runtime) =>
			runtime.userId === userId && runtime.activity ? [runtime.activity] : [],
		)
	}

	getDestinationPaths() {
		return [
			...this.pendingDestinations,
			...[...this.syncRuntimes.values()].flatMap(({destinationPath}) =>
				destinationPath === undefined ? [] : [destinationPath],
			),
		]
	}

	getDestinationAtPath(virtualPath: string) {
		const path = normalizePath(virtualPath)
		const runtime = [...this.syncRuntimes.values()].find(({destinationPath}) => destinationPath === path)
		if (!runtime) return
		return {
			syncId: runtime.syncId,
			userId: runtime.userId,
			accountId: runtime.accountId,
		}
	}

	async beginOAuth(userId: string, provider: Provider, accountId?: string) {
		const {runtime, reservedAccountId} = await this.prepareAuthentication(userId, provider, accountId)
		try {
			const {authorizationUrl, session} = this.auth.beginOAuth(reservedAccountId, provider)
			if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
			runtime.state = {kind: 'authenticating', session: {kind: 'oauth', oauth: session}}
			return {
				accountId: reservedAccountId,
				sessionId: session.sessionId,
				authorizationUrl,
				expiresInMs: Math.max(0, session.expiresAt - this.now()),
			}
		} catch (error) {
			if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
			await this.cleanupProspectiveRuntime(reservedAccountId)
			throw error
		}
	}

	async completeOAuth(userId: string, accountId: string, code: string): Promise<OAuthCompletionResult> {
		await this.sweepExpiredAuthSessions(accountId)
		const runtime = this.requireAccountRuntime(accountId, userId)
		if (runtime.activeAuthCompletion?.kind === 'oauth') return runtime.activeAuthCompletion.promise
		const session = runtime.state.kind === 'authenticating' ? runtime.state.session : undefined
		if (session?.kind !== 'oauth') throw new Error('[cloud-auth-session-not-found]')
		if (session.oauth.expiresAt <= this.now()) {
			runtime.state = {kind: 'ready'}
			await this.cleanupProspectiveRuntime(accountId)
			throw new Error('[cloud-auth-session-expired]')
		}
		const sessionId = session.oauth.sessionId
		const controller = new AbortController()
		runtime.activeController = controller
		const isActive = () => {
			const activeSession = runtime.state.kind === 'authenticating' ? runtime.state.session : undefined
			const activeSessionId =
				activeSession?.kind === 'oauth'
					? activeSession.oauth.sessionId
					: activeSession?.kind === 'config'
						? activeSession.oauthSessionId
						: undefined
			return activeSessionId === sessionId && !controller.signal.aborted
		}
		const assertActive = () => {
			if (!isActive()) throw new RcloneAbortedError()
		}

		const operation = runtime.queue.add(async () => {
			let transaction: RcloneConfigTransaction | undefined
			try {
				assertActive()
				transaction = await this.rclone.beginConfigTransaction(accountId)
				assertActive()
				if (this.stopped) throw new RcloneAbortedError()
				runtime.state = {
					kind: 'authenticating',
					session: {
						kind: 'config',
						transaction,
						expiresAt: session.oauth.expiresAt,
						oauthSessionId: sessionId,
					},
				}
				const result = await this.auth.completeOAuth(session.oauth, code, transaction, controller.signal)
				assertActive()
				const account = await this.commitConnection(userId, accountId, result.account, transaction, assertActive)
				await this.authenticationSucceeded(runtime)
				return {...result, account}
			} catch (error) {
				await transaction?.abort().catch(() => {})
				throw error
			} finally {
				if (runtime.activeController === controller) runtime.activeController = undefined
				if (isActive()) runtime.state = {kind: 'ready'}
			}
		})
		const completion = operation.finally(() => this.cleanupProspectiveRuntime(accountId))
		runtime.activeAuthCompletion = {kind: 'oauth', promise: completion}
		const clearCompletion = () => {
			if (runtime.activeAuthCompletion?.promise === completion) runtime.activeAuthCompletion = undefined
		}
		completion.then(clearCompletion, clearCompletion)
		return completion
	}

	async cancelOAuth(userId: string, accountId: string, sessionId: string) {
		const runtime = this.accountRuntimes.get(accountId)
		if (!runtime || runtime.userId !== userId || runtime.state.kind !== 'authenticating') return false
		const session = runtime.state.session
		const activeSessionId =
			session?.kind === 'oauth'
				? session.oauth.sessionId
				: session?.kind === 'config'
					? session.oauthSessionId
					: undefined
		if (activeSessionId !== sessionId) return false

		runtime.state = {kind: 'ready'}
		runtime.activeController?.abort()
		if (session?.kind === 'config') await session.transaction.abort().catch(() => {})
		await runtime.queue.onIdle()
		await this.cleanupProspectiveRuntime(accountId)
		return true
	}

	async connectWebDav(
		userId: string,
		input: {
			flavor: WebDavFlavor
			url: string
			username: string
			password: string
			tlsMode: 'default' | 'insecure'
		},
		accountId?: string,
	) {
		const {runtime, reservedAccountId} = await this.prepareAuthentication(userId, 'webdav', accountId)
		const operation = runtime.queue.add(async () => {
			let transaction: RcloneConfigTransaction | undefined
			try {
				if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				transaction = await this.rclone.beginConfigTransaction(reservedAccountId)
				if (this.stopped || runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				runtime.state = {
					kind: 'authenticating',
					session: {kind: 'config', transaction, expiresAt: this.now() + OAUTH_SESSION_LIFETIME},
				}
				const result = await this.auth.connectWebDav(transaction, input)
				const account = await this.commitConnection(userId, reservedAccountId, result.account, transaction)
				await this.authenticationSucceeded(runtime)
				return {...result, account}
			} catch (error) {
				await transaction?.abort().catch(() => {})
				throw error
			} finally {
				if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
			}
		})
		return operation.finally(() => this.cleanupProspectiveRuntime(reservedAccountId))
	}

	async beginICloud(userId: string, input: {appleId: string; password: string}, accountId?: string) {
		const {runtime, reservedAccountId} = await this.prepareAuthentication(userId, 'icloud', accountId)
		const operation = runtime.queue.add(async () => {
			let transaction: RcloneConfigTransaction | undefined
			try {
				if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				transaction = await this.rclone.beginConfigTransaction(reservedAccountId)
				if (this.stopped || runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				runtime.state = {
					kind: 'authenticating',
					session: {kind: 'config', transaction, expiresAt: this.now() + OAUTH_SESSION_LIFETIME},
				}
				const result = await this.auth.beginICloud(transaction, input)
				if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				if (!result.complete) {
					runtime.state = {
						kind: 'authenticating',
						session: {
							kind: 'icloud',
							transaction,
							appleId: input.appleId.trim(),
							state: result.challenge.state,
							expiresAt: this.now() + OAUTH_SESSION_LIFETIME,
						},
					}
					return {accountId: reservedAccountId, ...result}
				}
				const account = await this.commitConnection(userId, reservedAccountId, result.account, transaction)
				await this.authenticationSucceeded(runtime)
				if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
				return {accountId: reservedAccountId, ...result, account}
			} catch (error) {
				await transaction?.abort().catch(() => {})
				if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
				throw error
			}
		})
		return operation.finally(() => this.cleanupProspectiveRuntime(reservedAccountId))
	}

	async continueICloud(userId: string, accountId: string, result: string): Promise<ICloudCompletionResult> {
		await this.sweepExpiredAuthSessions(accountId)
		const runtime = this.requireAccountRuntime(accountId, userId)
		if (runtime.activeAuthCompletion?.kind === 'icloud') return runtime.activeAuthCompletion.promise
		const session = runtime.state.kind === 'authenticating' ? runtime.state.session : undefined
		if (session?.kind !== 'icloud') throw new Error('[cloud-auth-session-not-found]')
		if (session.expiresAt <= this.now()) {
			runtime.state = {kind: 'ready'}
			await session.transaction.abort().catch(() => {})
			await this.cleanupProspectiveRuntime(accountId)
			throw new Error('[cloud-auth-session-expired]')
		}
		runtime.state = {
			kind: 'authenticating',
			session: {kind: 'config', transaction: session.transaction, expiresAt: session.expiresAt},
		}

		const operation = runtime.queue.add(async () => {
			try {
				if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				const step = await this.auth.continueICloud(session.transaction, session.appleId, session.state, result)
				if (runtime.state.kind !== 'authenticating') throw new RcloneAbortedError()
				if (!step.complete) {
					runtime.state = {
						kind: 'authenticating',
						session: {...session, state: step.challenge.state},
					}
					return {accountId, ...step}
				}
				const account = await this.commitConnection(userId, accountId, step.account, session.transaction)
				await this.authenticationSucceeded(runtime)
				if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
				return {accountId, ...step, account}
			} catch (error) {
				await session.transaction.abort().catch(() => {})
				if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
				throw error
			}
		})
		const completion = operation.finally(() => this.cleanupProspectiveRuntime(accountId))
		runtime.activeAuthCompletion = {kind: 'icloud', promise: completion}
		const clearCompletion = () => {
			if (runtime.activeAuthCompletion?.promise === completion) runtime.activeAuthCompletion = undefined
		}
		completion.then(clearCompletion, clearCompletion)
		return completion
	}

	async browse(userId: string, accountId: string, remote: RemoteRef, maxEntries = 500): Promise<RcloneBrowseResult> {
		const store = await this.readStore()
		const account = store.accounts.find(({id, userId: ownerId}) => id === accountId && ownerId === userId)
		if (!account) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		validateRemote(account, remote)
		const runtime = this.requireAccountRuntime(accountId, userId)
		if (runtime.attention?.kind === 'auth') throw new Error('[cloud-account-auth-required]')
		if (runtime.state.kind !== 'ready' || runtime.queue.pending > 0 || runtime.queue.size > 0) {
			throw new Error('[cloud-account-busy]')
		}
		const controller = new AbortController()
		return runtime.queue.add(async () => {
			runtime.activeController = controller
			try {
				const listing = await this.rclone.browse({
					accountId,
					provider: account.provider,
					remote,
					maxEntries,
					signal: controller.signal,
				})
				if (account.provider === 'dropbox' || account.provider === 'webdav' || account.provider === 'icloud') {
					const names = listing.entries.map(({name}) => name)
					if (new Set(names).size !== names.length) throw new Error('[cloud-ambiguous-remote-name]')
				}
				return listing
			} finally {
				if (runtime.activeController === controller) runtime.activeController = undefined
			}
		})
	}

	async getLocations(userId: string, accountId: string): Promise<CloudProviderLocations> {
		const store = await this.readStore()
		const account = store.accounts.find(({id, userId: ownerId}) => id === accountId && ownerId === userId)
		if (!account) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		const runtime = this.requireAccountRuntime(accountId, userId)
		if (runtime.attention?.kind === 'auth') throw new Error('[cloud-account-auth-required]')
		if (runtime.state.kind !== 'ready' || runtime.queue.pending > 0 || runtime.queue.size > 0) {
			throw new Error('[cloud-account-busy]')
		}

		const controller = new AbortController()
		return runtime.queue.add(async () => {
			runtime.activeController = controller
			try {
				if (!(await this.rclone.hasCanonicalConfig(accountId, account.provider))) {
					await this.setAuthAttention(accountId)
					throw new Error('[cloud-account-auth-required]')
				}
				await this.rclone.refreshOAuthToken(accountId, account.provider, controller.signal)
				return await this.auth.getLocations(account, controller.signal)
			} catch (error) {
				const failure = classifyCloudFailure(error, account.provider)
				if (failure === 'auth') {
					await this.setAuthAttention(accountId)
				} else if (failure === 'quota') {
					runtime.attention = {kind: 'quota'}
					runtime.cooldownUntil = this.now() + CLOUD_QUOTA_COOLDOWN
				}
				throw error
			} finally {
				if (runtime.activeController === controller) runtime.activeController = undefined
			}
		})
	}

	async create({
		userId,
		accountId,
		remote,
		destination,
		mode,
	}: {
		userId: string
		accountId: string
		remote: RemoteRef
		destination: DestinationRef
		mode: CloudSyncMode
	}) {
		if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		const destinationPath = cloudDestinationPath(destination, userId)
		const storageKeys = this.storageKeysForDestination(destination, userId)
		const storageGeneration = this.storageGeneration(storageKeys)
		if ([...this.pendingDestinations].some((pending) => pathsOverlap(destinationPath, pending))) {
			throw new Error('[cloud-destination-overlap]')
		}
		this.pendingDestinations.add(destinationPath)
		this.pendingDestinationRefs.set(destinationPath, {destination, userId})
		try {
			await this.resolveDestination(destination, userId, {requireEmpty: true})
			await this.browse(userId, accountId, remote, 1)

			const sync: CloudSync = {
				id: randomUUID(),
				accountId,
				remote: {...remote},
				destination: {...destination},
				mode,
			}
			const commit = async () => {
				if (!this.storageGenerationMatches(storageGeneration)) {
					throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
				}
				if (storageKeys.length > 0) {
					await this.resolveDestination(destination, userId, {requireEmpty: true})
				}
				await this.umbreld.store.getWriteLock(async ({get, set}) => {
					if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
					const store = (await get('files.cloud')) ?? createEmptyCloudStore()
					const account = store.accounts.find(({id, userId: ownerId}) => id === accountId && ownerId === userId)
					if (!account) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
					for (const existing of store.syncs) {
						const existingAccount = accountForSync(store, existing)
						if (!existingAccount) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
						if (pathsOverlap(destinationPath, cloudDestinationPath(existing.destination, existingAccount.userId))) {
							throw new Error('[cloud-destination-overlap]')
						}
					}
					store.syncs.push(sync)
					await set('files.cloud', store)
				})
			}

			const releaseStorage = await this.acquireStorageLeases(storageKeys)
			try {
				await commit()
			} finally {
				releaseStorage()
			}

			if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
			const runtime = this.createSyncRuntime(sync, userId, false)
			this.syncRuntimes.set(sync.id, runtime)
			this.queueSync(sync.id)
			return {...sync, status: this.statusFor(sync)}
		} finally {
			this.pendingDestinations.delete(destinationPath)
			this.pendingDestinationRefs.delete(destinationPath)
		}
	}

	async pause(userId: string, syncId: string) {
		const sync = await this.updateSync(userId, syncId, (current) => addPauseReason(current, 'user'))
		const runtime = this.requireSyncRuntime(syncId, userId)
		await this.cancelRuntime(runtime)
		return {...sync, status: this.statusFor(sync)}
	}

	async resume(userId: string, syncId: string) {
		const sync = await this.updateSync(userId, syncId, resumePause)
		const runtime = this.requireSyncRuntime(syncId, userId)
		if (!isPaused(sync)) {
			// Manual work bypasses the cloud's ordinary retry/schedule timing. The
			// account-level auth and quota gates remain enforced by queueSync().
			runtime.nextRunAt = this.now()
			this.queueSync(syncId)
		}
		return {...sync, status: this.statusFor(sync)}
	}

	async runOnce(userId: string, syncId: string) {
		const store = await this.readStore()
		const sync = store.syncs.find(({id}) => id === syncId)
		if (!sync || accountForSync(store, sync)?.userId !== userId) throw new Error('[cloud-not-found]')
		const runtime = this.requireSyncRuntime(syncId, userId)
		// A one-shot run bypasses only the persisted pause. Account attention,
		// destination blockers, and an already active run remain authoritative.
		runtime.nextRunAt = this.now()
		this.queueSync(syncId, {allowPaused: true})
		return {...sync, status: this.statusFor(sync)}
	}

	allowsRewindRestore(token: symbol | undefined, virtualPath: string, requestedTarget?: string) {
		if (!token) return false
		const path = normalizePath(virtualPath)
		const targets = this.rewindRestoreTargets.get(token)
		if (!targets) return false

		if (requestedTarget) {
			const target = normalizePath(requestedTarget)
			return targets.includes(target) && (path === target || nodePath.dirname(path) === nodePath.dirname(target))
		}

		return targets.some((target) => path === target || target.startsWith(`${path}/`))
	}

	async restoreForRewind({
		userId,
		confirmedSyncIds,
		targetPaths,
		restore,
	}: {
		userId: string
		confirmedSyncIds: string[]
		targetPaths: string[]
		restore: (token: symbol) => Promise<void>
	}) {
		const confirmedIds = new Set(confirmedSyncIds)
		if (confirmedIds.size !== confirmedSyncIds.length) {
			throw new Error('[cloud-restore-confirmation-mismatch]')
		}
		const targets = targetPaths.map(normalizePath)
		const matchingSyncs = (store: CloudStore) =>
			store.syncs.filter((sync) => {
				const account = accountForSync(store, sync)
				if (!account || account.userId !== userId) return false
				const destinationPath = cloudDestinationPath(sync.destination, userId)
				return targets.some((target) => pathsOverlap(target, destinationPath))
			})
		const store = await this.readStore()
		const affected = matchingSyncs(store)
		if (affected.length !== confirmedIds.size || !affected.every(({id}) => confirmedIds.has(id))) {
			throw new Error('[cloud-restore-confirmation-mismatch]')
		}
		const affectedDestinationPaths = affected.map(({destination}) => cloudDestinationPath(destination, userId))
		const authorizedTargets = targets.filter((target) =>
			affectedDestinationPaths.some((destinationPath) => pathsOverlap(target, destinationPath)),
		)

		const blocker = Symbol('rewind-restore')
		const runtimes = affected.map(({id}) => this.requireSyncRuntime(id, userId))
		for (const runtime of runtimes) runtime.destinationBlockers.add(blocker)

		try {
			await Promise.all(runtimes.map((runtime) => this.cancelRuntime(runtime)))
			this.rewindRestoreTargets.set(blocker, authorizedTargets)
			await restore(blocker)
			await this.umbreld.store.getWriteLock(async ({get, set}) => {
				const current = (await get('files.cloud')) ?? createEmptyCloudStore()
				const currentAffected = matchingSyncs(current)
				if (currentAffected.length !== confirmedIds.size || !currentAffected.every(({id}) => confirmedIds.has(id))) {
					throw new Error('[cloud-restore-confirmation-mismatch]')
				}
				current.syncs = current.syncs.filter(({id}) => !confirmedIds.has(id))
				await set('files.cloud', current)
			})
		} catch (error) {
			for (const runtime of runtimes) {
				runtime.destinationBlockers.delete(blocker)
				runtime.nextRunAt = this.now()
				this.queueSync(runtime.syncId)
			}
			throw error
		} finally {
			this.rewindRestoreTargets.delete(blocker)
		}

		for (const runtime of runtimes) this.syncRuntimes.delete(runtime.syncId)
	}

	async remove(userId: string, syncId: string) {
		const runtime = this.requireSyncRuntime(syncId, userId)
		runtime.removing = true
		await this.cancelRuntime(runtime)
		try {
			await this.umbreld.store.getWriteLock(async ({get, set}) => {
				const store = (await get('files.cloud')) ?? createEmptyCloudStore()
				const sync = store.syncs.find(({id}) => id === syncId)
				if (!sync || accountForSync(store, sync)?.userId !== userId) return
				store.syncs = store.syncs.filter(({id}) => id !== syncId)
				await set('files.cloud', store)
			})
		} catch (error) {
			runtime.removing = false
			throw error
		}
		this.syncRuntimes.delete(syncId)
	}

	async removeAccount(userId: string, accountId: string, confirmedSyncIds: string[]) {
		const runtime = this.requireAccountRuntime(accountId, userId)
		const store = await this.readStore()
		const account = store.accounts.find(({id, userId: ownerId}) => id === accountId && ownerId === userId)
		if (!account) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		const syncIds = store.syncs.filter((item) => item.accountId === accountId).map(({id}) => id)
		const affectedRuntimes = syncIds.flatMap((id) => {
			const syncRuntime = this.syncRuntimes.get(id)
			return syncRuntime ? [syncRuntime] : []
		})
		if (syncIds.length !== confirmedSyncIds.length || !syncIds.every((id) => confirmedSyncIds.includes(id))) {
			throw new Error('[cloud-account-removal-confirmation-mismatch]')
		}

		const state = runtime.state
		runtime.state = {kind: 'closed'}
		if (state.kind === 'authenticating' && (state.session?.kind === 'icloud' || state.session?.kind === 'config')) {
			await state.session.transaction.abort().catch(() => {})
		}
		await Promise.all(
			syncIds.map(async (id) => {
				const syncRuntime = this.syncRuntimes.get(id)
				if (!syncRuntime) return
				syncRuntime.removing = true
				await this.cancelRuntime(syncRuntime)
			}),
		)
		runtime.activeController?.abort()
		await runtime.queue.onIdle()

		const restoreAfterFailure = () => {
			runtime.state = {kind: 'ready'}
			for (const syncRuntime of affectedRuntimes) {
				syncRuntime.removing = false
				syncRuntime.nextRunAt = this.now()
				this.queueSync(syncRuntime.syncId)
			}
		}

		// Dropbox revocation accepts only a current access token. Let rclone use
		// the stored refresh token first. An auth failure means the provider no
		// longer accepts the grant, which is already the desired remote state;
		// retryable and unknown failures retain the account and credentials.
		try {
			await runtime.queue.add(async () => {
				try {
					if (account.provider === 'dropbox') {
						await this.rclone.refreshOAuthToken(accountId, account.provider)
					}
					await this.auth.revoke(accountId, account.provider)
				} catch (error) {
					if (!isAlreadyRevokedOAuthGrant(error, account.provider)) throw error
				}
			})
		} catch (error) {
			restoreAfterFailure()
			throw error
		}

		try {
			await this.umbreld.store.getWriteLock(async ({get, set}) => {
				const current = (await get('files.cloud')) ?? createEmptyCloudStore()
				if (!current.accounts.some(({id, userId: ownerId}) => id === accountId && ownerId === userId)) {
					throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
				}
				const currentSyncIds = current.syncs.filter((item) => item.accountId === accountId).map(({id}) => id)
				if (
					currentSyncIds.length !== confirmedSyncIds.length ||
					!currentSyncIds.every((id) => confirmedSyncIds.includes(id))
				) {
					throw new Error('[cloud-account-removal-confirmation-mismatch]')
				}
				current.accounts = current.accounts.filter(({id, userId: ownerId}) => id !== accountId || ownerId !== userId)
				current.syncs = current.syncs.filter((item) => item.accountId !== accountId)
				await set('files.cloud', current)
			})
		} catch (error) {
			restoreAfterFailure()
			throw error
		}

		await this.rclone.removeAccountDirectory(accountId).catch((error) => {
			this.logger.error(`Failed to remove cloud account credentials`, error)
		})
		await this.umbreld.notifications.clearForAccount(userId, authNotification(accountId)).catch(() => {})
		for (const id of syncIds) this.syncRuntimes.delete(id)
		this.accountRuntimes.delete(accountId)
	}

	// Resolve owner hard-delete candidates from live destinations before
	// reading persistent state. Ordinary Trash/shared-storage deletes never
	// touch the Cloud store, while a batch of plausible member destinations
	// verifies all of its candidates with one store read.
	async resolveSharedDestinationDeletesAsOwner(requesterUserId: string, virtualPaths: string[]) {
		const candidates = new Map<string, SharedDestinationDeleteCandidate>()
		if (requesterUserId !== OWNER_USER_ID) return candidates
		const destinations = new Map(
			[...this.syncRuntimes.values()].flatMap((runtime) =>
				runtime.destinationPath === undefined ? [] : [[runtime.destinationPath, runtime] as const],
			),
		)
		const plausible = [...new Set(virtualPaths.map(normalizePath))].flatMap((path) => {
			if (!path.startsWith('/External/') && !path.startsWith('/Network/') && !path.startsWith('/Raid/')) return []
			const runtime = destinations.get(path)
			return runtime && runtime.userId !== OWNER_USER_ID ? [{path, runtime}] : []
		})
		if (plausible.length === 0) return candidates

		const store = await this.readStore()
		const syncs = new Map(store.syncs.map((sync) => [sync.id, sync]))
		const accounts = new Map(store.accounts.map((account) => [account.id, account]))
		for (const {path, runtime} of plausible) {
			const sync = syncs.get(runtime.syncId)
			const account = sync ? accounts.get(sync.accountId) : undefined
			if (!sync || !account || account.userId !== runtime.userId || account.userId === OWNER_USER_ID) {
				throw new Error('[cloud-read-only]')
			}
			const destination = cloudDestinationDetails(sync.destination, account.userId)
			if (destination.kind === 'home' || destination.path !== path) throw new Error('[cloud-read-only]')
			candidates.set(path, {path, sync, userId: account.userId})
		}
		return candidates
	}

	// Delete a previously resolved member-owned Cloud destination on
	// owner-controlled shared storage. The transfer is stopped before the
	// filesystem mutation and the sync record is removed only after it succeeds.
	async deleteSharedDestinationAsOwner(
		requesterUserId: string,
		candidate: SharedDestinationDeleteCandidate,
		deleteDestination: () => Promise<void>,
	) {
		if (requesterUserId !== OWNER_USER_ID) throw new Error('[operation-not-allowed]')
		const indexed = this.getDestinationAtPath(candidate.path)
		if (
			!indexed ||
			indexed.syncId !== candidate.sync.id ||
			indexed.userId !== candidate.userId ||
			indexed.userId === OWNER_USER_ID
		) {
			throw new Error('[cloud-read-only]')
		}
		const runtime = this.requireSyncRuntime(candidate.sync.id, candidate.userId)
		runtime.removing = true
		await this.cancelRuntime(runtime)
		try {
			await deleteDestination()
			await this.umbreld.store.getWriteLock(async ({get, set}) => {
				const current = (await get('files.cloud')) ?? createEmptyCloudStore()
				current.syncs = current.syncs.filter(({id}) => id !== candidate.sync.id)
				await set('files.cloud', current)
			})
			this.syncRuntimes.delete(candidate.sync.id)
			return true
		} catch (error) {
			runtime.removing = false
			runtime.nextRunAt = this.now()
			this.queueSync(candidate.sync.id)
			throw error
		}
	}

	// Remove all private Cloud state for a deleted member. Downloaded data on
	// shared external/network storage is intentionally left in place; the
	// member's Home is removed by the user module after this cleanup completes.
	async removeUser(userId: string) {
		if (userId === OWNER_USER_ID) throw new Error('Refusing to remove owner Cloud state')
		// User ids are permanent security identities and are never reused. Keep
		// this gate for the process lifetime so an in-flight request authenticated
		// before deletion cannot commit new credentials, jobs, or runtimes after
		// cleanup takes its initial snapshot.
		this.removingUsers.add(userId)
		const store = await this.readStore()
		const accounts = store.accounts.filter((account) => account.userId === userId)
		const accountIds = new Set(accounts.map(({id}) => id))
		const syncRuntimes = [...this.syncRuntimes.values()].filter((runtime) => runtime.userId === userId)
		const accountRuntimes = [...this.accountRuntimes.values()].filter((runtime) => runtime.userId === userId)

		for (const runtime of syncRuntimes) {
			runtime.removing = true
			await this.cancelRuntime(runtime)
		}
		for (const runtime of accountRuntimes) {
			const state = runtime.state
			runtime.state = {kind: 'closed'}
			runtime.activeController?.abort()
			if (state.kind === 'authenticating' && (state.session?.kind === 'icloud' || state.session?.kind === 'config')) {
				await state.session.transaction.abort().catch(() => {})
			}
			await runtime.queue.onIdle()
			accountIds.add(runtime.accountId)
		}

		for (const account of accounts) {
			await this.auth.revoke(account.id, account.provider).catch(() => {})
		}
		for (const accountId of accountIds) {
			await this.rclone.removeAccountDirectory(accountId)
		}
		await this.umbreld.notifications.clearAccount(userId)

		await this.umbreld.store.getWriteLock(async ({get, set}) => {
			const current = (await get('files.cloud')) ?? createEmptyCloudStore()
			current.accounts = current.accounts.filter((account) => account.userId !== userId)
			current.syncs = current.syncs.filter((sync) => !accountIds.has(sync.accountId))
			await set('files.cloud', current)
		})

		for (const runtime of syncRuntimes) this.syncRuntimes.delete(runtime.syncId)
		for (const accountId of accountIds) this.accountRuntimes.delete(accountId)
		this.emitActivity(userId)
	}

	async blockExternalStorage(locations: ExternalStorageLocation[]) {
		const filesystemUuids = new Set(locations.flatMap(({filesystemUuid}) => (filesystemUuid ? [filesystemUuid] : [])))
		const mountPaths = new Set(locations.flatMap(({mountPaths}) => mountPaths.map(normalizePath)))
		const storageKeys = [
			...[...filesystemUuids].map((filesystemUuid) => this.externalStorageKey(filesystemUuid)),
			...[...mountPaths].map((mountPath) => this.mountPathStorageKey(mountPath)),
		]
		return this.blockForDestination(
			(destination) =>
				(destination.filesystemUuid !== undefined && filesystemUuids.has(destination.filesystemUuid)) ||
				[...mountPaths].some(
					(mountPath) => destination.path === mountPath || destination.path.startsWith(`${mountPath}/`),
				),
			storageKeys,
		)
	}

	async blockNetworkStorage({host, share, mountPath}: NetworkStorageLocation) {
		const normalizedMountPath = normalizePath(mountPath)
		return this.blockForDestination(
			(destination) =>
				(destination.host === host && destination.share === share) ||
				destination.path === normalizedMountPath ||
				destination.path.startsWith(`${normalizedMountPath}/`),
			[this.networkStorageKey(host, share), this.mountPathStorageKey(normalizedMountPath)],
		)
	}

	async blockRaidStorage({filesystemUuid, mountPaths}: ExternalStorageLocation) {
		const mountPathSet = new Set(mountPaths.map(normalizePath))
		const storageKeys = [
			...(filesystemUuid ? [this.raidStorageKey(filesystemUuid)] : []),
			...[...mountPathSet].map((mountPath) => this.mountPathStorageKey(mountPath)),
		]
		return this.blockForDestination(
			(destination) =>
				(destination.filesystemUuid !== undefined && destination.filesystemUuid === filesystemUuid) ||
				[...mountPathSet].some(
					(mountPath) => destination.path === mountPath || destination.path.startsWith(`${mountPath}/`),
				),
			storageKeys,
		)
	}

	private async blockForDestination(predicate: (destination: DestinationRef) => boolean, storageKeys: string[]) {
		const initialStore = await this.readStore()
		for (const sync of initialStore.syncs) {
			if (!predicate(sync.destination)) continue
			const account = accountForSync(initialStore, sync)
			if (account) storageKeys.push(...this.storageKeysForDestination(sync.destination, account.userId))
		}
		for (const {destination, userId} of this.pendingDestinationRefs.values()) {
			if (predicate(destination)) storageKeys.push(...this.storageKeysForDestination(destination, userId))
		}

		const keys = [...new Set(storageKeys)].sort()
		const releaseStorage = await this.acquireStorageLeases(keys)
		const blocker = Symbol('storage-lifecycle')
		const blockedRuntimes: SyncRuntime[] = []
		try {
			for (const key of keys) this.storageGenerations.set(key, (this.storageGenerations.get(key) ?? 0) + 1)

			const store = await this.readStore()
			const affected = store.syncs.filter(({destination}) => predicate(destination))
			await Promise.all(
				affected.map(async ({id}) => {
					const runtime = this.syncRuntimes.get(id)
					if (!runtime) return
					runtime.destinationBlockers.add(blocker)
					blockedRuntimes.push(runtime)
					await this.cancelRuntime(runtime)
				}),
			)
			return () => {
				for (const runtime of blockedRuntimes) runtime.destinationBlockers.delete(blocker)
				releaseStorage()
			}
		} catch (error) {
			for (const runtime of blockedRuntimes) runtime.destinationBlockers.delete(blocker)
			releaseStorage()
			throw error
		}
	}

	private storageKeysForDestination(destination: DestinationRef, userId: string) {
		const details = cloudDestinationDetails(destination, userId)
		if (details.kind === 'home') return []
		if (details.kind === 'external') {
			return [this.externalStorageKey(details.filesystemUuid), this.mountPathStorageKey(details.mountPath)]
		}
		if (details.kind === 'raid') {
			return [this.raidStorageKey(details.filesystemUuid), this.mountPathStorageKey(details.mountPath)]
		}
		return [this.networkStorageKey(details.host, details.share), this.mountPathStorageKey(details.mountPath)]
	}

	private externalStorageKey(filesystemUuid: string) {
		return JSON.stringify(['external', filesystemUuid])
	}

	private raidStorageKey(filesystemUuid: string) {
		return JSON.stringify(['raid', filesystemUuid])
	}

	private networkStorageKey(host: string, share: string) {
		return JSON.stringify(['network', host, share])
	}

	private mountPathStorageKey(mountPath: string) {
		return JSON.stringify(['mount', normalizePath(mountPath)])
	}

	private storageGeneration(storageKeys: string[]) {
		return new Map(storageKeys.map((key) => [key, this.storageGenerations.get(key) ?? 0]))
	}

	private storageGenerationMatches(generation: Map<string, number>) {
		for (const [key, value] of generation) {
			if ((this.storageGenerations.get(key) ?? 0) !== value) return false
		}
		return true
	}

	private async acquireStorageLeases(storageKeys: string[]) {
		const releases: (() => void)[] = []
		for (const key of [...new Set(storageKeys)].sort()) {
			const previous = this.storageLeases.get(key) ?? Promise.resolve()
			let release!: () => void
			const current = new Promise<void>((resolve) => {
				release = resolve
			})
			this.storageLeases.set(key, current)
			await previous
			releases.push(() => {
				release()
				if (this.storageLeases.get(key) === current) this.storageLeases.delete(key)
			})
		}
		return () => {
			for (const release of releases.reverse()) release()
		}
	}

	async revalidateDestinationAccess() {
		const store = await this.readStore()
		const affectedUsers = new Set<string>()
		for (const sync of store.syncs) {
			const runtime = this.syncRuntimes.get(sync.id)
			if (!runtime || runtime.removing) continue
			const account = accountForSync(store, sync)
			if (!account) {
				runtime.attention = {kind: 'error'}
				continue
			}
			const wasUnavailable = runtime.destinationUnavailable
			const previousAttention = runtime.attention?.kind
			try {
				await this.resolveDestination(sync.destination, account.userId, {checkOnly: true})
				runtime.destinationUnavailable = false
				if (runtime.attention?.kind === 'destination-missing') runtime.attention = undefined
				if (wasUnavailable && runtime.destinationBlockers.size === 0 && !isPaused(sync)) {
					runtime.nextRunAt = this.now()
					this.queueSync(sync.id)
				}
			} catch {
				runtime.destinationUnavailable = true
				runtime.attention = {kind: 'destination-missing'}
				await this.cancelRuntime(runtime)
			}
			if (wasUnavailable !== runtime.destinationUnavailable || previousAttention !== runtime.attention?.kind) {
				affectedUsers.add(account.userId)
			}
		}
		for (const userId of affectedUsers) this.emitActivity(userId)
	}

	async schedulerTick() {
		return this.runSchedulerTick()
	}

	private async runSchedulerTick() {
		await this.sweepExpiredAuthSessions()
		const store = await this.readStore()
		this.restoreMissingRuntimes(store)
		const now = this.now()
		for (const account of store.accounts) {
			if (this.removingUsers.has(account.userId)) continue
			const runtime = this.accountRuntimes.get(account.id)
			if (runtime?.attention?.kind === 'quota' && (runtime.cooldownUntil ?? 0) <= now) {
				runtime.attention = undefined
				runtime.cooldownUntil = undefined
			}
		}

		for (const sync of store.syncs) {
			const account = accountForSync(store, sync)
			if (!account) {
				const runtime = this.syncRuntimes.get(sync.id)
				if (runtime) runtime.attention = {kind: 'error'}
				continue
			}
			if (this.removingUsers.has(account.userId)) continue
			const runtime = this.requireSyncRuntime(sync.id)
			const wasUnavailable = runtime.destinationUnavailable
			try {
				await this.resolveDestination(sync.destination, account.userId, {checkOnly: true})
				runtime.destinationUnavailable = false
				if (runtime.attention?.kind === 'destination-missing') runtime.attention = undefined
				if (wasUnavailable && runtime.destinationBlockers.size === 0 && !isPaused(sync)) {
					runtime.nextRunAt = now
				}
			} catch (error) {
				runtime.destinationUnavailable = true
				runtime.attention =
					error instanceof Error && error.message === CLOUD_DESTINATION_MISSING_ERROR
						? {kind: 'destination-missing'}
						: {kind: 'error'}
				continue
			}
			if (isPaused(sync) || runtime.removing || this.destinationBlocked(runtime)) continue
			if ((runtime.nextRunAt ?? now) <= now) this.queueSync(sync.id)
		}
	}

	private queueSync(syncId: string, {allowPaused = false}: {allowPaused?: boolean} = {}) {
		if (this.stopped) return
		const runtime = this.requireSyncRuntime(syncId)
		if (runtime.phase !== 'idle' || runtime.removing || this.destinationBlocked(runtime)) return
		const accountId = this.currentSyncAccountId(syncId)
		if (!accountId) return
		const accountRuntime = this.accountRuntimes.get(accountId)
		if (!accountRuntime || accountRuntime.state.kind !== 'ready') return
		if (accountRuntime.attention?.kind === 'auth') return
		if (
			accountRuntime.attention?.kind === 'quota' &&
			(accountRuntime.cooldownUntil ?? Number.POSITIVE_INFINITY) > this.now()
		) {
			return
		}
		if (runtime.nextRunAt !== undefined && runtime.nextRunAt > this.now()) return

		const controller = new AbortController()
		runtime.controller = controller
		runtime.phase = 'queued'
		// p-queue 7 does not release its pending counter when a signalled task is
		// aborted before starting, so cancellation is checked inside both tasks.
		const queued = this.globalSyncQueue.add(async () => {
			if (controller.signal.aborted) return 'retained'
			return accountRuntime.queue.add(async () => {
				if (controller.signal.aborted) return 'retained'
				accountRuntime.activeController = controller
				try {
					return await this.runSync(syncId, controller.signal, allowPaused)
				} finally {
					if (accountRuntime.activeController === controller) accountRuntime.activeController = undefined
				}
			})
		})
		runtime.runPromise = queued
			.catch((error) => {
				if (classifyCloudFailure(error) !== 'cancelled') {
					this.logger.error(`Cloud sync run failed`, error)
				}
				return 'retained' as const
			})
			.then((outcome) => {
				if (runtime.controller === controller) runtime.controller = undefined
				runtime.phase = 'idle'
				runtime.activity = undefined
				runtime.runPromise = undefined
				this.emitActivity(runtime.userId)
				if (outcome === 'remove-runtime') this.syncRuntimes.delete(syncId)
			})
	}

	private async runSync(syncId: string, signal: AbortSignal, allowPaused = false): Promise<RunOutcome> {
		const store = await this.readStore()
		const sync = store.syncs.find(({id}) => id === syncId)
		if (!sync) return 'retained'
		const account = accountForSync(store, sync)
		const runtime = this.requireSyncRuntime(syncId)
		if (!account) {
			this.applySyncError(runtime)
			return 'retained'
		}
		const accountRuntime = this.requireAccountRuntime(sync.accountId, account.userId)
		if (
			(isPaused(sync) && !allowPaused) ||
			runtime.removing ||
			this.destinationBlocked(runtime) ||
			accountRuntime.state.kind === 'closed'
		) {
			return 'retained'
		}

		let destination: string
		try {
			if (!(await this.rclone.hasCanonicalConfig(account.id, account.provider))) {
				await this.setAuthAttention(account.id)
				return 'retained'
			}
			destination = await this.resolveDestination(sync.destination, account.userId)
			runtime.destinationUnavailable = false
			if (signal.aborted || this.destinationBlocked(runtime)) return 'retained'
		} catch (error) {
			if (error instanceof Error && error.message === CLOUD_DESTINATION_MISSING_ERROR) {
				runtime.destinationUnavailable = true
				runtime.attention = {kind: 'destination-missing'}
			} else if (error instanceof Error && AUTH_ACCOUNT_ERROR_CODES.has(error.message)) {
				await this.setAuthAttention(account.id)
			} else {
				this.applySyncError(runtime)
			}
			return 'retained'
		}

		try {
			runtime.phase = 'running'
			await this.rclone.sync({
				accountId: account.id,
				provider: account.provider,
				syncId,
				remote: sync.remote,
				destination,
				minimumFreeBytes:
					cloudDestinationDetails(sync.destination, account.userId).kind === 'home'
						? CLOUD_HOME_FREE_SPACE_FLOOR
						: CLOUD_OTHER_FREE_SPACE_FLOOR,
				signal,
				onActivity: (activity) => {
					runtime.activity = activity
					this.emitActivity(runtime.userId)
				},
			})
			return await this.syncSucceeded(sync, runtime, accountRuntime)
		} catch (error) {
			const kind = classifyCloudFailure(error, account.provider)
			if (kind === 'cancelled') return 'retained'
			this.logger.error(`Cloud sync run failed`, {
				syncId,
				provider: account.provider,
				classification: kind,
				records: error instanceof RcloneProcessError ? error.records.slice(-CLOUD_FAILURE_LOG_RECORDS) : [],
			})
			if (kind === 'auth') await this.setAuthAttention(account.id)
			else if (kind === 'quota') {
				accountRuntime.attention = {kind: 'quota'}
				accountRuntime.cooldownUntil = this.now() + CLOUD_QUOTA_COOLDOWN
				runtime.nextRunAt = accountRuntime.cooldownUntil
			} else this.applySyncError(runtime, cloudFailureMessage(error))
			return 'retained'
		}
	}

	private async syncSucceeded(
		sync: CloudSync,
		runtime: SyncRuntime,
		accountRuntime: AccountRuntime,
	): Promise<RunOutcome> {
		const completedAt = this.now()
		await this.umbreld.store.getWriteLock(async ({get, set}) => {
			const store = (await get('files.cloud')) ?? createEmptyCloudStore()
			const current = store.syncs.find(({id}) => id === sync.id)
			if (!current) return
			if (current.mode === 'one-time') store.syncs = store.syncs.filter(({id}) => id !== current.id)
			else current.lastSuccessfulAt = completedAt
			await set('files.cloud', store)
		})
		runtime.attention = undefined
		runtime.retryCount = 0
		runtime.nextRunAt = completedAt + CLOUD_AUTO_INTERVAL + this.jitter(CLOUD_AUTO_JITTER_MAX)
		if (accountRuntime.attention?.kind === 'quota') {
			accountRuntime.attention = undefined
			accountRuntime.cooldownUntil = undefined
		}
		if (sync.mode === 'one-time') {
			runtime.removing = true
			return 'remove-runtime'
		}
		return 'retained'
	}

	private applySyncError(runtime: SyncRuntime, message?: string) {
		runtime.attention = {kind: 'error', ...(message ? {message} : {})}
		runtime.retryCount += 1
		const delay = Math.min(CLOUD_RETRY_MAX, CLOUD_RETRY_INITIAL * 2 ** (runtime.retryCount - 1))
		runtime.nextRunAt = this.now() + delay
	}

	private destinationBlocked(runtime: SyncRuntime) {
		return runtime.destinationUnavailable || runtime.destinationBlockers.size > 0
	}

	private statusFor(sync: CloudSync): CloudSyncStatus {
		const runtime = this.syncRuntimes.get(sync.id)
		const accountRuntime = this.accountRuntimes.get(sync.accountId)
		const attention = accountRuntime?.attention ?? runtime?.attention
		const state = isPaused(sync)
			? 'paused'
			: runtime?.phase === 'running'
				? 'running'
				: runtime?.phase === 'queued'
					? 'queued'
					: attention
						? 'needs-attention'
						: 'idle'
		const nextRunAt = accountRuntime?.cooldownUntil ?? runtime?.nextRunAt
		return {
			state,
			...(attention ? {attention} : {}),
			...(nextRunAt !== undefined ? {nextRunAt} : {}),
			...(runtime?.activity ? {activity: runtime.activity} : {}),
		}
	}

	private createAccountRuntime(accountId: string, userId: string): AccountRuntime {
		return {
			accountId,
			userId,
			queue: this.accountQueue(accountId),
			state: {kind: 'ready'},
		}
	}

	private accountQueue(accountId: string) {
		let queue = this.accountQueues.get(accountId)
		if (!queue) {
			queue = new PQueue({concurrency: 1})
			this.accountQueues.set(accountId, queue)
		}
		return queue
	}

	private createSyncRuntime(sync: CloudSync, userId: string, startup: boolean): SyncRuntime {
		const now = this.now()
		let nextRunAt = now
		if (startup) {
			const scheduled = (sync.lastSuccessfulAt ?? 0) + CLOUD_AUTO_INTERVAL + this.jitter(CLOUD_AUTO_JITTER_MAX)
			nextRunAt = scheduled <= now ? now + this.jitter(CLOUD_STARTUP_JITTER_MAX) : scheduled
		}
		return {
			syncId: sync.id,
			accountId: sync.accountId,
			userId,
			destinationPath: this.destinationPathForRuntime(sync.destination, userId),
			phase: 'idle',
			nextRunAt,
			retryCount: 0,
			removing: false,
			destinationBlockers: new Set(),
			destinationUnavailable: false,
		}
	}

	private destinationPathForRuntime(destination: DestinationRef, userId: string) {
		try {
			return cloudDestinationPath(destination, userId)
		} catch {
			// resolveDestination re-validates at run time. Keep a runtime for invalid sync entries
			// so they can report attention without preventing manager startup.
			return undefined
		}
	}

	private restoreRuntimes(store: CloudStore) {
		this.accountRuntimes.clear()
		this.syncRuntimes.clear()
		this.accountQueues.clear()
		for (const account of store.accounts) {
			if (this.removingUsers.has(account.userId)) continue
			this.accountRuntimes.set(account.id, this.createAccountRuntime(account.id, account.userId))
		}
		for (const sync of store.syncs) {
			const account = accountForSync(store, sync)
			if (!account || this.removingUsers.has(account.userId)) continue
			this.syncRuntimes.set(sync.id, this.createSyncRuntime(sync, account.userId, true))
		}
	}

	private restoreMissingRuntimes(store: CloudStore) {
		for (const account of store.accounts) {
			if (this.removingUsers.has(account.userId)) continue
			if (!this.accountRuntimes.has(account.id)) {
				this.accountRuntimes.set(account.id, this.createAccountRuntime(account.id, account.userId))
			}
		}
		for (const sync of store.syncs) {
			const account = accountForSync(store, sync)
			if (!account || this.removingUsers.has(account.userId)) continue
			if (!this.syncRuntimes.has(sync.id)) {
				this.syncRuntimes.set(sync.id, this.createSyncRuntime(sync, account.userId, true))
			}
		}
	}

	private async prepareAuthentication(userId: string, provider: Provider, requestedAccountId?: string) {
		if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		const reservedAccountId = requestedAccountId ?? randomUUID()
		validateId(reservedAccountId, '[cloud-invalid-account-id]')
		let runtime = this.accountRuntimes.get(reservedAccountId)
		if (!runtime) {
			runtime = this.createAccountRuntime(reservedAccountId, userId)
			this.accountRuntimes.set(reservedAccountId, runtime)
		}
		if (runtime.userId !== userId) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)

		let expiredSession: AuthSession | undefined
		if (runtime.state.kind === 'authenticating') {
			const session = runtime.state.session
			const expired =
				session?.kind === 'oauth'
					? session.oauth.expiresAt <= this.now()
					: session?.kind === 'icloud'
						? session.expiresAt <= this.now()
						: false
			if (expired) {
				expiredSession = session
				runtime.state = {kind: 'ready'}
			}
		}
		if (runtime.state.kind !== 'ready') throw new Error('[cloud-account-busy]')
		runtime.state = {kind: 'authenticating'}

		try {
			if (expiredSession?.kind === 'icloud') await expiredSession.transaction.abort().catch(() => {})
			const store = await this.readStore()
			if (store.accounts.some(({id, userId: ownerId}) => id === reservedAccountId && ownerId !== userId)) {
				throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
			}
			const existing = store.accounts.find(({id, userId: ownerId}) => id === reservedAccountId && ownerId === userId)
			if (existing && existing.provider !== provider) {
				throw new Error('[cloud-provider-mismatch]')
			}
			for (const sync of store.syncs.filter(({accountId}) => accountId === reservedAccountId)) {
				const syncRuntime = this.syncRuntimes.get(sync.id)
				if (syncRuntime) await this.cancelRuntime(syncRuntime)
			}
			runtime.activeController?.abort()
			await runtime.queue.onIdle()
			return {runtime, reservedAccountId}
		} catch (error) {
			if (runtime.state.kind === 'authenticating') runtime.state = {kind: 'ready'}
			await this.cleanupProspectiveRuntime(reservedAccountId)
			throw error
		}
	}

	private async commitConnection(
		userId: string,
		accountId: string,
		connected: ConnectedAccount,
		transaction: RcloneConfigTransaction,
		assertActive?: () => void,
	): Promise<Account> {
		const account = {id: accountId, userId, ...connected}
		validateAccount(account)
		assertActive?.()
		await transaction.prepare()
		assertActive?.()
		await this.umbreld.store.getWriteLock(async ({get, set}) => {
			assertActive?.()
			if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
			const store = (await get('files.cloud')) ?? createEmptyCloudStore()
			if (store.accounts.some(({id, userId: ownerId}) => id === accountId && ownerId !== userId)) {
				throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
			}
			const existing = store.accounts.find(({id, userId: ownerId}) => id === accountId && ownerId === userId)
			if (existing && existing.provider !== account.provider) throw new Error('[cloud-provider-mismatch]')
			if (existing && existing.identity !== account.identity) throw new Error('[cloud-account-identity-mismatch]')
			if (
				store.accounts.some(
					(candidate) =>
						candidate.id !== accountId &&
						candidate.userId === userId &&
						candidate.provider === account.provider &&
						candidate.identity === account.identity,
				)
			) {
				throw new Error('[cloud-account-already-exists]')
			}
			await transaction.promote()
			assertActive?.()
			// Promotion is intentionally inside the store transaction, but it is
			// still asynchronous. A member deletion can tombstone the account
			// while it is in flight; do not publish a connection authenticated
			// before that deletion began. removeUser() waits for this account queue
			// and then removes the promoted credential directory.
			if (this.removingUsers.has(userId)) throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
			const index = store.accounts.findIndex(({id, userId: ownerId}) => id === accountId && ownerId === userId)
			if (index === -1) store.accounts.push(account)
			else store.accounts[index] = account
			await set('files.cloud', store)
		})
		return account
	}

	private async authenticationSucceeded(runtime: AccountRuntime) {
		runtime.attention = undefined
		runtime.cooldownUntil = undefined
		await this.umbreld.notifications
			.clearForAccount(runtime.userId, authNotification(runtime.accountId))
			.catch(() => {})
	}

	private async setAuthAttention(accountId: string) {
		const runtime = this.accountRuntimes.get(accountId)
		if (!runtime) return
		const shouldNotify = runtime.attention?.kind !== 'auth'
		runtime.attention = {kind: 'auth'}
		runtime.cooldownUntil = undefined
		if (shouldNotify) {
			await this.umbreld.notifications.addForAccount(runtime.userId, authNotification(accountId)).catch(() => {})
		}
	}

	private async sweepExpiredAuthSessions(exceptAccountId?: string) {
		const now = this.now()
		for (const runtime of this.accountRuntimes.values()) {
			if (runtime.accountId === exceptAccountId) continue
			const session = runtime.state.kind === 'authenticating' ? runtime.state.session : undefined
			if (!session || session.kind === 'config' || (session.kind === 'oauth' && session.oauth.expiresAt > now)) continue
			if (session.kind === 'icloud' && session.expiresAt > now) continue
			runtime.state = {kind: 'ready'}
			if (session.kind === 'icloud') await session.transaction.abort().catch(() => {})
			await this.cleanupProspectiveRuntime(runtime.accountId)
		}
	}

	private async cleanupProspectiveRuntime(accountId: string) {
		const runtime = this.accountRuntimes.get(accountId)
		if (!runtime || runtime.state.kind !== 'ready' || runtime.queue.pending > 0 || runtime.queue.size > 0) return
		let store: CloudStore
		try {
			store = await this.readStore()
		} catch (error) {
			this.logger.error(`Failed to inspect a prospective cloud account`, error)
			return
		}
		if (store.accounts.some(({id}) => id === accountId)) return
		await this.rclone.removeAccountDirectory(accountId).catch(() => {})
		this.accountRuntimes.delete(accountId)
	}

	private async cancelRuntime(runtime: SyncRuntime) {
		const wasRunning = runtime.phase === 'running'
		runtime.controller?.abort()
		// PQueue does not remove an aborted pending task until it reaches the
		// front of the queue. Waiting for that task here can deadlock behind the
		// active sync that the caller intends to cancel next. Only a transfer
		// that actually entered rclone needs to be joined.
		if (wasRunning) await runtime.runPromise?.catch(() => {})
	}

	private async updateSync(userId: string, syncId: string, update: (current: CloudSync) => CloudSync) {
		let updated: CloudSync | undefined
		await this.umbreld.store.getWriteLock(async ({get, set}) => {
			const store = (await get('files.cloud')) ?? createEmptyCloudStore()
			const index = store.syncs.findIndex(({id}) => id === syncId)
			if (index === -1) throw new Error('[cloud-not-found]')
			if (accountForSync(store, store.syncs[index])?.userId !== userId) throw new Error('[cloud-not-found]')
			updated = update(store.syncs[index])
			store.syncs[index] = updated
			await set('files.cloud', store)
		})
		return updated as CloudSync
	}

	private currentSyncAccountId(syncId: string) {
		return this.syncRuntimes.get(syncId)?.accountId
	}

	private requireAccountRuntime(accountId: string, userId?: string) {
		const runtime = this.accountRuntimes.get(accountId)
		if (!runtime || (userId !== undefined && (runtime.userId !== userId || this.removingUsers.has(userId)))) {
			throw new Error(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		}
		return runtime
	}

	private requireSyncRuntime(syncId: string, userId?: string) {
		const runtime = this.syncRuntimes.get(syncId)
		if (!runtime || (userId !== undefined && (runtime.userId !== userId || this.removingUsers.has(userId)))) {
			throw new Error('[cloud-not-found]')
		}
		return runtime
	}

	private async readStore() {
		return (await this.umbreld.store.get('files.cloud')) ?? createEmptyCloudStore()
	}

	async pauseRestoredSyncs() {
		await this.umbreld.store.getWriteLock(async ({get, set}) => {
			const store = (await get('files.cloud')) ?? createEmptyCloudStore()
			store.syncs = store.syncs.map((sync) => addPauseReason(sync, 'restore'))
			await set('files.cloud', store)
		})
	}

	private async removeOrphanedAccountDirectories(store: CloudStore) {
		let entries: Dirent[]
		try {
			entries = await fse.readdir(this.rclone.rootDirectory, {withFileTypes: true})
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
			throw error
		}
		for (const entry of entries) {
			if (!UUID_PATTERN.test(entry.name) || store.accounts.some(({id}) => id === entry.name)) continue
			await this.accountQueue(entry.name).add(async () => {
				// Authentication may have claimed this id after the directory
				// scan. Revalidate inside the same keyed queue before deleting.
				const current = await this.readStore()
				if (current.accounts.some(({id}) => id === entry.name)) return
				await this.rclone.removeAccountDirectory(entry.name)
			})
		}
	}

	private jitter(maximum: number) {
		return Math.floor(Math.max(0, Math.min(0.999999999, this.random())) * maximum)
	}

	private emitActivity(userId: string) {
		this.onActivity?.(
			userId,
			[...this.syncRuntimes.values()].flatMap((runtime) =>
				runtime.userId === userId && runtime.activity ? [runtime.activity] : [],
			),
		)
	}
}
