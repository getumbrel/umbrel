import fsp from 'node:fs/promises'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import FileStore from '../utilities/file-store.js'
import createLogger from '../utilities/logger.js'

import CloudManager, {
	CLOUD_AUTO_INTERVAL,
	CLOUD_AUTO_JITTER_MAX,
	CLOUD_QUOTA_COOLDOWN,
	CLOUD_RETRY_INITIAL,
	CLOUD_RETRY_MAX,
	CLOUD_SCHEDULER_INTERVAL,
	CLOUD_STARTUP_JITTER_MAX,
	classifyCloudFailure,
	cloudDestinationDetails,
} from './cloud.js'
import {CloudProviderHttpError, OAUTH_SESSION_LIFETIME} from './cloud-auth.js'
import {RcloneAbortedError, RcloneProcessError} from './cloud-rclone.js'
import {
	CLOUD_ACCOUNT_NOT_FOUND_ERROR,
	CLOUD_DESTINATION_MISSING_ERROR,
	CLOUD_INVALID_ACCOUNT_CONFIG_ERROR,
	CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR,
	type Account,
	type CloudSync,
	type CloudStore,
	type DestinationRef,
	type Provider,
} from './cloud-types.js'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const SYNC_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_SYNC_ID = '33333333-3333-4333-8333-333333333333'
const SECOND_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'
const NOW = 1_720_000_000_000
const USER_ID = '0'
const MEMBER_ID = 'Alice'

const ACCOUNT: Account = {
	id: ACCOUNT_ID,
	userId: USER_ID,
	provider: 'webdav',
	identity: 'ada\nhttps://dav.example/',
	displayName: 'Ada · dav.example',
	connection: {
		kind: 'webdav',
		flavor: 'webdav',
		url: 'https://dav.example/',
		username: 'ada',
		tlsMode: 'default',
	},
}

const SECOND_ACCOUNT: Account = {
	...ACCOUNT,
	id: SECOND_ACCOUNT_ID,
	identity: 'grace\nhttps://dav.example/',
	displayName: 'Grace · dav.example',
	connection: {
		kind: 'webdav',
		flavor: 'webdav',
		url: 'https://dav.example/',
		username: 'grace',
		tlsMode: 'default',
	},
}

const MEMBER_ACCOUNT: Account = {
	...ACCOUNT,
	id: SECOND_ACCOUNT_ID,
	userId: MEMBER_ID,
}

const persistedSync = (overrides: Partial<CloudSync> = {}): CloudSync => ({
	id: SYNC_ID,
	accountId: ACCOUNT_ID,
	remote: {path: ''},
	destination: {path: '/Home/Imports/WebDAV'},
	mode: 'auto',
	...overrides,
})

type FakeRcloneOptions = {
	sync?: (parameters: {accountId: string; syncId: string; destination: string; signal?: AbortSignal}) => Promise<void>
	removeTemporaryConfigFiles?: (accountId: string) => Promise<void>
	prepareConfig?: () => Promise<void>
	promoteConfig?: (accountId: string) => Promise<string>
	deletedUserIds?: string[]
	now?: () => number
	random?: () => number
	resolveDestination?: (
		destination: DestinationRef,
		userId: string,
		options?: {requireEmpty?: boolean; checkOnly?: boolean},
	) => Promise<string>
}

const processError = (message: string) =>
	new RcloneProcessError('sync', {code: 1, signal: null}, [{level: 'error', msg: message}])

describe.sequential('CloudManager', () => {
	let directory: string
	let manager: CloudManager | undefined

	beforeEach(async () => {
		directory = await fsp.mkdtemp('/tmp/cim-')
	})

	afterEach(async () => {
		await manager?.stop()
		vi.useRealTimers()
		await fsp.rm(directory, {recursive: true, force: true})
	})

	const createManager = async (
		initial: CloudStore,
		{
			sync = async () => {},
			removeTemporaryConfigFiles = async () => {},
			prepareConfig = async () => {},
			promoteConfig = async (accountId) => `${directory}/${accountId}.conf`,
			deletedUserIds = [],
			now = () => NOW,
			random = () => 0,
			resolveDestination: resolve = async (destination) => `/resolved${destination.path}`,
		}: FakeRcloneOptions = {},
	) => {
		const store = new FileStore<any>({filePath: `${directory}/umbrel.yaml`})
		await store.overwrite({files: {cloud: initial}, notifications: []})
		const notifications = {
			add: vi.fn(async () => true),
			clear: vi.fn(async () => true),
			addForAccount: vi.fn(async () => true),
			clearForAccount: vi.fn(async () => true),
			clearAccount: vi.fn(async () => true),
		}
		const browse = vi.fn(async () => ({entries: [], truncated: false}))
		const syncMock = vi.fn(sync)
		const resolveDestination = vi.fn(resolve)
		const configCalls: {method: string; parameters: Record<string, unknown>}[] = []
		const transactions: {
			prepare: ReturnType<typeof vi.fn>
			promote: ReturnType<typeof vi.fn>
			abort: ReturnType<typeof vi.fn>
		}[] = []
		const rclone = {
			rootDirectory: `${directory}/cloud/accounts`,
			removeTemporaryConfigFiles: vi.fn(removeTemporaryConfigFiles),
			hasCanonicalConfig: vi.fn(async () => true),
			browse,
			sync: syncMock,
			refreshOAuthToken: vi.fn(async () => {}),
			removeAccountDirectory: vi.fn(async () => {}),
			getAccountPaths: (accountId: string) => ({config: `${directory}/${accountId}.conf`}),
			beginConfigTransaction: vi.fn(async (accountId: string) => {
				const transaction = {
					accountId,
					configPath: `${directory}/${accountId}.tmp`,
					async call<T = Record<string, never>>(method: string, parameters: Record<string, unknown> = {}) {
						configCalls.push({method, parameters})
						return {} as T
					},
					prepare: vi.fn(prepareConfig),
					promote: vi.fn(() => promoteConfig(accountId)),
					abort: vi.fn(async () => {}),
				}
				transactions.push(transaction)
				return transaction
			}),
		}
		const eventBus = {
			on: vi.fn((_event: string, _listener: () => Promise<void> | void) => () => {}),
		}
		const umbreld = {
			dataDirectory: directory,
			store,
			notifications,
			eventBus,
			logger: createLogger('cloud-test', 'silent'),
			user: {listDeletedMemberIds: vi.fn(async () => deletedUserIds)},
		} as unknown as Umbreld
		manager = new CloudManager({
			umbreld,
			rclone: rclone as never,
			resolveDestination,
			now,
			random,
		})
		return {
			manager,
			store,
			notifications,
			eventBus,
			browse,
			sync: syncMock,
			rclone,
			resolveDestination,
			configCalls,
			transactions,
		}
	}

	test('derives destination category and mount roots from canonical Files paths', () => {
		expect(cloudDestinationDetails({path: '/Home/Imports/Photos'}, USER_ID)).toEqual({
			kind: 'home',
			path: '/Home/Imports/Photos',
		})
		expect(
			cloudDestinationDetails({path: '/External/Archive/Imports/Photos', filesystemUuid: 'filesystem-uuid'}, USER_ID),
		).toEqual({
			kind: 'external',
			path: '/External/Archive/Imports/Photos',
			mountPath: '/External/Archive',
			filesystemUuid: 'filesystem-uuid',
		})
		expect(
			cloudDestinationDetails(
				{path: '/Network/nas.local/Media/Imports/Photos', host: 'nas.local', share: 'Media'},
				USER_ID,
			),
		).toEqual({
			kind: 'network',
			path: '/Network/nas.local/Media/Imports/Photos',
			mountPath: '/Network/nas.local/Media',
			host: 'nas.local',
			share: 'Media',
		})
		expect(cloudDestinationDetails({path: `/Users/${MEMBER_ID}/Imports/Photos`}, MEMBER_ID)).toEqual({
			kind: 'home',
			path: `/Users/${MEMBER_ID}/Imports/Photos`,
		})
		expect(
			cloudDestinationDetails({path: '/Raid/umbrel-md/Imports/Photos', filesystemUuid: 'filesystem-uuid'}, USER_ID),
		).toEqual({
			kind: 'raid',
			path: '/Raid/umbrel-md/Imports/Photos',
			mountPath: '/Raid/umbrel-md',
			filesystemUuid: 'filesystem-uuid',
		})
	})

	test('rejects ambiguous paths and replicated destination state', () => {
		const invalid = [
			{path: '/Apps/Imports'},
			{path: '/Home'},
			{path: `/Users/${MEMBER_ID}/Imports`, filesystemUuid: 'unexpected'},
			{path: `/Users/${MEMBER_ID}/Trash/Cloud`},
			{path: '/External/Archive/Imports'},
			{path: '/Network/nas.local/Media/Imports', host: 'nas.local'},
			{path: '/Network/nas.local/Media/Imports', host: 'nas.local', share: 'Media', mountPath: '/Network/other'},
			{path: '/Raid/umbrel-md/Imports'},
			{path: '/Home/Imports', kind: 'home'},
		] as unknown as DestinationRef[]

		for (const destination of invalid) {
			expect(() => cloudDestinationDetails(destination, USER_ID)).toThrow('[cloud-invalid-destination]')
		}
	})

	test('classifies documented provider authentication and quota failures', () => {
		expect(classifyCloudFailure(new RcloneAbortedError())).toBe('cancelled')

		const cases: {provider: Provider; kind: 'auth' | 'quota'; messages: string[]}[] = [
			{
				provider: 'google-drive',
				kind: 'auth',
				messages: [
					"couldn't fetch token: invalid_grant: maybe token expired?",
					'token expired and there\'s no refresh token - manually refresh with "rclone config reconnect umbrel-cloud:"',
					'googleapi: Error 401: Request had invalid authentication credentials. Reason: authError, Message: Invalid Credentials',
					'oauth2: interaction_required: user interaction is required',
				],
			},
			{
				provider: 'google-drive',
				kind: 'quota',
				messages: [
					'googleapi: Error 403: User Rate Limit Exceeded, userRateLimitExceeded',
					'googleapi: Error 403: Daily Limit Exceeded, dailyLimitExceeded',
					'googleapi: Error 403: download quota exceeded, downloadQuotaExceeded',
					'googleapi: Error 403: Storage quota exceeded\nMore details:\nReason: storageQuotaExceeded, Message: Storage quota exceeded',
					'googleapi: Error 403: Quota exceeded, quotaExceeded',
					'HTTP status code 429: rateLimitExceeded',
				],
			},
			{
				provider: 'dropbox',
				kind: 'auth',
				messages: ['error listing: invalid_access_token/...', 'Failed to copy: expired_access_token/...'],
			},
			{
				provider: 'dropbox',
				kind: 'quota',
				messages: ['error listing: too_many_requests/..', 'error listing: too_many_write_operations/...'],
			},
			{
				provider: 'onedrive',
				kind: 'auth',
				messages: [
					'error listing: InvalidAuthenticationToken: Access token validation failure',
					'error listing: unauthenticated: The caller is not authenticated',
				],
			},
			{
				provider: 'onedrive',
				kind: 'quota',
				messages: [
					'error listing: activityLimitReached: The app or user has been throttled',
					'error listing: quotaLimitReached: The user has reached their quota limit',
					'error listing: 507 Insufficient Storage',
					'error listing: 509 Bandwidth Limit Exceeded',
				],
			},
			{
				provider: 'webdav',
				kind: 'auth',
				messages: ["error listing: couldn't list files: Unauthorized: 401 Unauthorized"],
			},
			{
				provider: 'webdav',
				kind: 'quota',
				messages: [
					"error listing: couldn't list files: Too Many Requests: 429 Too Many Requests",
					'HTTP error 509 (509 Bandwidth Limit Exceeded) returned body: ""',
				],
			},
			{
				provider: 'icloud',
				kind: 'auth',
				messages: [
					'missing icloud trust token: try refreshing it with "rclone config reconnect umbrel-cloud:"',
					'trust token expired, please reauth',
					'authSRPComplete: sign in failed: incorrect username or password',
				],
			},
			{
				provider: 'icloud',
				kind: 'quota',
				messages: ['HTTP error 429 (429 Too Many Requests) returned body: ""'],
			},
		]

		for (const {provider, kind, messages} of cases) {
			for (const message of messages) {
				expect(classifyCloudFailure(processError(message), provider), `${provider}: ${message}`).toBe(kind)
			}
		}

		expect(classifyCloudFailure(new CloudProviderHttpError('google-drive', 401))).toBe('auth')
		expect(classifyCloudFailure(new CloudProviderHttpError('dropbox', 429))).toBe('quota')
		expect(classifyCloudFailure(new CloudProviderHttpError('onedrive', 403))).toBe('error')
		expect(classifyCloudFailure(processError('HTTP status code 403: access denied'), 'webdav')).toBe('error')
		expect(
			classifyCloudFailure(
				new RcloneProcessError('sync', {code: 1, signal: null}, [
					{level: 'notice', msg: 'googleapi: Error 401: Invalid Credentials'},
				]),
				'google-drive',
			),
		).toBe('error')
		expect(classifyCloudFailure(new Error('ENOSPC'))).toBe('error')
	})

	test("does not classify filenames or another provider's codes as account failures", () => {
		const cases: {provider: Provider; messages: string[]}[] = [
			{
				provider: 'google-drive',
				messages: [
					'failed to copy /source/googleapi: Error 401.pdf: input/output error',
					'failed to copy /source/userRateLimitExceeded.txt: input/output error',
					'failed to copy /source/userRateLimitExceeded report.txt: input/output error',
					'failed to copy /source/token has been expired or revoked.txt: input/output error',
					"couldn't fetch token: invalid_client: check the configured client ID",
					'error listing: invalid_access_token/...',
				],
			},
			{
				provider: 'dropbox',
				messages: [
					'failed to copy /source/invalid_access_token/report.txt: input/output error',
					'failed to copy /source/expired_access_token/report.txt: input/output error',
					'failed to copy /source/too_many_requests/report.txt: input/output error',
					'googleapi: Error 401: Invalid Credentials',
					'error listing: user_suspended/...',
					'error listing: missing_scope/...',
				],
			},
			{
				provider: 'onedrive',
				messages: [
					'failed to copy /source/InvalidAuthenticationToken.txt: input/output error',
					'failed to copy /source/activityLimitReached.txt: input/output error',
					'trust token expired, please reauth',
					'error listing: accessDenied: The caller does not have permission',
					'error listing: insufficient_claims: Conditional access challenge',
				],
			},
			{
				provider: 'webdav',
				messages: [
					'failed to copy /source/invoice-401.pdf: input/output error',
					'failed to copy /source/401 unauthorized.txt: input/output error',
					'failed to copy /source/report-429.pdf: connection reset',
					'error listing: InvalidAuthenticationToken: access denied',
				],
			},
			{
				provider: 'icloud',
				messages: [
					'failed to copy /source/trust token expired.txt: input/output error',
					'authSRPInit: connection reset by peer',
					'invalid session token',
					'requestPCS(iclouddrive): server returned success but cookies still missing',
					'error listing: invalid_access_token/...',
				],
			},
		]

		for (const {provider, messages} of cases) {
			for (const message of messages) {
				expect(classifyCloudFailure(processError(message), provider), `${provider}: ${message}`).toBe('error')
			}
		}
	})

	test('uses the account provider when routing a run failure', async () => {
		const account: Account = {
			id: ACCOUNT_ID,
			userId: USER_ID,
			provider: 'onedrive',
			identity: 'microsoft-account-id',
			displayName: 'ada@example.com',
			connection: {kind: 'oauth'},
		}
		const cloud = persistedSync({
			remote: {path: '', folderId: 'folder-id', driveId: 'drive-id', driveType: 'personal'},
		})
		const fixture = await createManager(
			{accounts: [account], syncs: [cloud]},
			{
				sync: async () => {
					throw processError('error listing: InvalidAuthenticationToken: Access token validation failure')
				},
			},
		)
		await fixture.manager.start()

		await (
			fixture.manager as unknown as {
				runSync(syncId: string, signal: AbortSignal): Promise<void>
			}
		).runSync(SYNC_ID, new AbortController().signal)

		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.attention).toEqual({kind: 'auth'})
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.attention).toBeUndefined()
		expect(fixture.notifications.addForAccount).toHaveBeenCalledWith(USER_ID, `cloud-auth:${ACCOUNT_ID}`)
	})

	test.each([
		"error listing: couldn't list files: Too Many Requests: 429 Too Many Requests",
		'HTTP error 509 (509 Bandwidth Limit Exceeded) returned body: ""',
	])('enforces and clears quota cooldowns after a sync failure: %s', async (message) => {
		let now = NOW
		let fail = true
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{
				now: () => now,
				random: () => 0.5,
				sync: async () => {
					if (fail) throw processError(message)
				},
			},
		)
		await fixture.manager.start()

		await fixture.manager.resume(USER_ID, SYNC_ID)
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.sync).toHaveBeenCalledTimes(1)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)).toMatchObject({
			attention: {kind: 'quota'},
			cooldownUntil: NOW + CLOUD_QUOTA_COOLDOWN,
		})
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.nextRunAt).toBe(NOW + CLOUD_QUOTA_COOLDOWN)

		await fixture.manager.resume(USER_ID, SYNC_ID)
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()
		expect(fixture.sync).toHaveBeenCalledTimes(1)

		now += CLOUD_QUOTA_COOLDOWN
		fail = false
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.sync).toHaveBeenCalledTimes(2)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.attention).toBeUndefined()
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.cooldownUntil).toBeUndefined()
	})

	test('routes only explicit account validation codes to authentication attention', async () => {
		const cases = [
			{message: CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR, attention: 'auth'},
			{message: CLOUD_INVALID_ACCOUNT_CONFIG_ERROR, attention: 'auth'},
			{message: CLOUD_ACCOUNT_NOT_FOUND_ERROR, attention: 'auth'},
			{message: '[cloud-accounting-failed]', attention: 'error'},
		] as const

		for (const {message, attention} of cases) {
			const fixture = await createManager(
				{accounts: [ACCOUNT], syncs: [persistedSync()]},
				{
					random: () => 0.5,
					resolveDestination: async (destination, _userId, options) => {
						if (options?.checkOnly) return `/resolved${destination.path}`
						throw new Error(message)
					},
				},
			)
			await fixture.manager.start()

			await (
				fixture.manager as unknown as {
					runSync(syncId: string, signal: AbortSignal): Promise<void>
				}
			).runSync(SYNC_ID, new AbortController().signal)

			if (attention === 'auth') {
				expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.attention).toEqual({kind: 'auth'})
				expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.attention).toBeUndefined()
			} else {
				expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.attention).toBeUndefined()
				expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.attention).toEqual({kind: 'error'})
			}

			await fixture.manager.stop()
			manager = undefined
		}
	})

	test('exposes account attention without requiring a cloud', async () => {
		const fixture = await createManager({accounts: [ACCOUNT], syncs: []})
		await fixture.manager.start()

		fixture.manager.accountRuntimes.get(ACCOUNT_ID)!.attention = {kind: 'quota'}
		expect(await fixture.manager.getAccounts(USER_ID)).toEqual([{...ACCOUNT, attention: {kind: 'quota'}}])

		fixture.manager.accountRuntimes.get(ACCOUNT_ID)!.attention = undefined
		expect(await fixture.manager.getAccounts(USER_ID)).toEqual([ACCOUNT])
	})

	test('strictly scopes accounts, syncs, activity, and mutations to their owning Umbrel user', async () => {
		const ownerCloud = persistedSync({pauseReasons: {user: true}})
		const memberSync = persistedSync({
			id: SECOND_SYNC_ID,
			accountId: SECOND_ACCOUNT_ID,
			destination: {path: `/Users/${MEMBER_ID}/Imports/WebDAV`},
			pauseReasons: {user: true},
		})
		const fixture = await createManager({
			accounts: [ACCOUNT, MEMBER_ACCOUNT],
			syncs: [ownerCloud, memberSync],
		})
		await fixture.manager.start()

		fixture.manager.syncRuntimes.get(SYNC_ID)!.activity = {
			syncId: SYNC_ID,
			bytesPerSecond: 1,
			transferredFiles: 1,
			transferredBytes: 1,
		}
		fixture.manager.syncRuntimes.get(SECOND_SYNC_ID)!.activity = {
			syncId: SECOND_SYNC_ID,
			bytesPerSecond: 2,
			transferredFiles: 2,
			transferredBytes: 2,
		}

		expect(await fixture.manager.getAccounts(USER_ID)).toEqual([ACCOUNT])
		expect(await fixture.manager.getAccounts(MEMBER_ID)).toEqual([MEMBER_ACCOUNT])
		expect((await fixture.manager.getSyncs(USER_ID)).map(({id}) => id)).toEqual([SYNC_ID])
		expect((await fixture.manager.getSyncs(MEMBER_ID)).map(({id}) => id)).toEqual([SECOND_SYNC_ID])
		expect(fixture.manager.getActivity(USER_ID).map(({syncId}) => syncId)).toEqual([SYNC_ID])
		expect(fixture.manager.getActivity(MEMBER_ID).map(({syncId}) => syncId)).toEqual([SECOND_SYNC_ID])

		await expect(fixture.manager.pause(USER_ID, SECOND_SYNC_ID)).rejects.toThrow('[cloud-not-found]')
		await expect(fixture.manager.resume(MEMBER_ID, SYNC_ID)).rejects.toThrow('[cloud-not-found]')
		await expect(fixture.manager.remove(USER_ID, SECOND_SYNC_ID)).rejects.toThrow('[cloud-not-found]')
		await expect(fixture.manager.removeAccount(MEMBER_ID, ACCOUNT_ID, [SYNC_ID])).rejects.toThrow(
			CLOUD_ACCOUNT_NOT_FOUND_ERROR,
		)

		expect((await fixture.store.get('files.cloud')).syncs).toEqual([ownerCloud, memberSync])
	})

	test('allows the same provider identity to be connected independently by different Umbrel users', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()
		const credentials = {
			flavor: 'webdav' as const,
			url: 'https://dav.example/root',
			username: 'ada',
			password: 'password',
			tlsMode: 'default' as const,
		}

		const ownerConnection = await fixture.manager.connectWebDav(USER_ID, credentials)
		const memberConnection = await fixture.manager.connectWebDav(MEMBER_ID, credentials)

		expect(ownerConnection.account).toMatchObject({userId: USER_ID, identity: 'ada\nhttps://dav.example/root/'})
		expect(memberConnection.account).toMatchObject({userId: MEMBER_ID, identity: 'ada\nhttps://dav.example/root/'})
		expect(memberConnection.account.id).not.toBe(ownerConnection.account.id)
		expect((await fixture.store.get('files.cloud')).accounts).toEqual([
			ownerConnection.account,
			memberConnection.account,
		])
	})

	test.each([
		{failure: 'network failure', error: new Error('revocation unavailable')},
		{failure: 'provider outage', error: new CloudProviderHttpError('dropbox', 503)},
	])('refreshes Dropbox before revocation and retains credentials after a $failure', async ({error}) => {
		const dropboxAccount: Account = {
			...ACCOUNT,
			provider: 'dropbox',
			identity: 'dropbox-user',
			displayName: 'Dropbox user',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [dropboxAccount], syncs: []})
		await fixture.manager.start()
		const revoke = vi.spyOn(fixture.manager.auth, 'revoke').mockRejectedValue(error)

		await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).rejects.toBe(error)

		expect(fixture.rclone.refreshOAuthToken).toHaveBeenCalledWith(ACCOUNT_ID, 'dropbox')
		expect(revoke).toHaveBeenCalledWith(ACCOUNT_ID, 'dropbox')
		expect(fixture.rclone.refreshOAuthToken.mock.invocationCallOrder[0]).toBeLessThan(
			revoke.mock.invocationCallOrder[0],
		)
		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [dropboxAccount], syncs: []})
		expect(fixture.rclone.removeAccountDirectory).not.toHaveBeenCalled()
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)).toMatchObject({state: {kind: 'ready'}})
	})

	test.each([
		{provider: 'google-drive' as const, statusCode: 400, providerErrorCode: 'invalid_token'},
		{provider: 'dropbox' as const, statusCode: 401, providerErrorCode: 'invalid_access_token'},
	])(
		'removes an already-revoked $provider grant locally ($providerErrorCode)',
		async ({provider, statusCode, providerErrorCode}) => {
			const account: Account = {
				...ACCOUNT,
				provider,
				identity: `${provider}-user`,
				displayName: `${provider} user`,
				connection: {kind: 'oauth'},
			}
			const fixture = await createManager({accounts: [account], syncs: []})
			await fixture.manager.start()
			const revoke = vi
				.spyOn(fixture.manager.auth, 'revoke')
				.mockRejectedValue(new CloudProviderHttpError(provider, statusCode, {providerErrorCode}))

			await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).resolves.toBeUndefined()

			if (provider === 'dropbox') {
				expect(fixture.rclone.refreshOAuthToken).toHaveBeenCalledWith(ACCOUNT_ID, provider)
			} else {
				expect(fixture.rclone.refreshOAuthToken).not.toHaveBeenCalled()
			}
			expect(revoke).toHaveBeenCalledWith(ACCOUNT_ID, provider)
			expect(await fixture.store.get('files.cloud')).toEqual({accounts: [], syncs: []})
			expect(fixture.rclone.removeAccountDirectory).toHaveBeenCalledWith(ACCOUNT_ID)
			expect(fixture.manager.accountRuntimes.has(ACCOUNT_ID)).toBe(false)
		},
	)

	test.each([
		{provider: 'google-drive' as const, statusCode: 400, providerErrorCode: 'invalid_request'},
		{provider: 'google-drive' as const, statusCode: 503, providerErrorCode: 'invalid_token'},
		{provider: 'dropbox' as const, statusCode: 401, providerErrorCode: 'expired_access_token'},
		{provider: 'dropbox' as const, statusCode: 401, providerErrorCode: 'missing_scope'},
		{provider: 'dropbox' as const, statusCode: 401, providerErrorCode: 'user_suspended'},
		{provider: 'dropbox' as const, statusCode: 503, providerErrorCode: 'invalid_access_token'},
	])(
		'retains a $provider account for non-revocation error $providerErrorCode',
		async ({provider, statusCode, providerErrorCode}) => {
			const account: Account = {
				...ACCOUNT,
				provider,
				identity: `${provider}-user`,
				displayName: `${provider} user`,
				connection: {kind: 'oauth'},
			}
			const fixture = await createManager({accounts: [account], syncs: []})
			await fixture.manager.start()
			const error = new CloudProviderHttpError(provider, statusCode, {providerErrorCode})
			vi.spyOn(fixture.manager.auth, 'revoke').mockRejectedValue(error)

			await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).rejects.toBe(error)

			expect(await fixture.store.get('files.cloud')).toEqual({accounts: [account], syncs: []})
			expect(fixture.rclone.removeAccountDirectory).not.toHaveBeenCalled()
			expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)).toMatchObject({state: {kind: 'ready'}})
		},
	)

	test('does not infer revocation from a provider status without an exact error code', async () => {
		const account: Account = {
			...ACCOUNT,
			provider: 'google-drive',
			identity: 'google-user',
			displayName: 'Google user',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [account], syncs: []})
		await fixture.manager.start()
		const error = new CloudProviderHttpError('google-drive', 400)
		vi.spyOn(fixture.manager.auth, 'revoke').mockRejectedValue(error)

		await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).rejects.toBe(error)

		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [account], syncs: []})
		expect(fixture.rclone.removeAccountDirectory).not.toHaveBeenCalled()
	})

	test('removes Dropbox locally when token refresh reports an already-revoked grant', async () => {
		const dropboxAccount: Account = {
			...ACCOUNT,
			provider: 'dropbox',
			identity: 'dropbox-user',
			displayName: 'Dropbox user',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [dropboxAccount], syncs: []})
		await fixture.manager.start()
		fixture.rclone.refreshOAuthToken.mockRejectedValue(
			processError("couldn't fetch token: invalid_grant: token has been revoked"),
		)
		const revoke = vi.spyOn(fixture.manager.auth, 'revoke').mockResolvedValue()

		await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).resolves.toBeUndefined()

		expect(revoke).not.toHaveBeenCalled()
		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [], syncs: []})
		expect(fixture.rclone.removeAccountDirectory).toHaveBeenCalledWith(ACCOUNT_ID)
		expect(fixture.manager.accountRuntimes.has(ACCOUNT_ID)).toBe(false)
	})

	test('retains Dropbox locally when token refresh reports only an expired access token', async () => {
		const dropboxAccount: Account = {
			...ACCOUNT,
			provider: 'dropbox',
			identity: 'dropbox-user',
			displayName: 'Dropbox user',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [dropboxAccount], syncs: []})
		await fixture.manager.start()
		const error = processError('error listing: expired_access_token/...')
		fixture.rclone.refreshOAuthToken.mockRejectedValue(error)
		const revoke = vi.spyOn(fixture.manager.auth, 'revoke').mockResolvedValue()

		await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [])).rejects.toBe(error)

		expect(revoke).not.toHaveBeenCalled()
		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [dropboxAccount], syncs: []})
		expect(fixture.rclone.removeAccountDirectory).not.toHaveBeenCalled()
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)).toMatchObject({state: {kind: 'ready'}})
	})

	test('does not read persistent Cloud state for ordinary owner hard deletes', async () => {
		const memberSync = persistedSync({
			accountId: SECOND_ACCOUNT_ID,
			destination: {path: '/External/Shared Drive/Alice Cloud', filesystemUuid: 'shared-filesystem'},
			pauseReasons: {user: true},
		})
		const fixture = await createManager({accounts: [MEMBER_ACCOUNT], syncs: [memberSync]})
		await fixture.manager.start()
		const getStore = vi.spyOn(fixture.store, 'get')

		const candidates = await fixture.manager.resolveSharedDestinationDeletesAsOwner(USER_ID, [
			'/Trash/report.txt',
			'/External/Shared Drive/unrelated.txt',
			'/External/Shared Drive/Alice Cloud/child.txt',
			'/Network/nas.local/Media/unrelated.txt',
		])

		expect(candidates.size).toBe(0)
		expect(getStore).not.toHaveBeenCalled()
	})

	test('resolves a batch of member Cloud roots with one persistent-store read', async () => {
		const externalSync = persistedSync({
			accountId: SECOND_ACCOUNT_ID,
			destination: {path: '/External/Shared Drive/Alice Cloud', filesystemUuid: 'shared-filesystem'},
			pauseReasons: {user: true},
		})
		const networkSync = persistedSync({
			id: SECOND_SYNC_ID,
			accountId: SECOND_ACCOUNT_ID,
			destination: {
				path: '/Network/nas.local/Media/Alice Cloud',
				host: 'nas.local',
				share: 'Media',
			},
			pauseReasons: {user: true},
		})
		const fixture = await createManager({
			accounts: [MEMBER_ACCOUNT],
			syncs: [externalSync, networkSync],
		})
		await fixture.manager.start()
		const getStore = vi.spyOn(fixture.store, 'get')

		const candidates = await fixture.manager.resolveSharedDestinationDeletesAsOwner(USER_ID, [
			externalSync.destination.path,
			networkSync.destination.path,
		])

		expect([...candidates.keys()]).toEqual([externalSync.destination.path, networkSync.destination.path])
		expect(getStore).toHaveBeenCalledTimes(1)
		expect(getStore).toHaveBeenCalledWith('files.cloud')
	})

	test('removes only a deleted member private Cloud state', async () => {
		const ownerCloud = persistedSync({pauseReasons: {user: true}})
		const memberSync = persistedSync({
			id: SECOND_SYNC_ID,
			accountId: SECOND_ACCOUNT_ID,
			destination: {path: '/External/Shared Drive/Alice Cloud', filesystemUuid: 'shared-filesystem'},
			pauseReasons: {user: true},
		})
		const fixture = await createManager({
			accounts: [ACCOUNT, MEMBER_ACCOUNT],
			syncs: [ownerCloud, memberSync],
		})
		await fixture.manager.start()
		const revoke = vi.spyOn(fixture.manager.auth, 'revoke').mockResolvedValue()

		await fixture.manager.removeUser(MEMBER_ID)

		expect(await fixture.store.get('files.cloud')).toEqual({
			accounts: [ACCOUNT],
			syncs: [ownerCloud],
		})
		expect(revoke).toHaveBeenCalledWith(SECOND_ACCOUNT_ID, MEMBER_ACCOUNT.provider)
		expect(revoke).not.toHaveBeenCalledWith(ACCOUNT_ID, ACCOUNT.provider)
		expect(fixture.rclone.removeAccountDirectory).toHaveBeenCalledWith(SECOND_ACCOUNT_ID)
		expect(fixture.rclone.removeAccountDirectory).not.toHaveBeenCalledWith(ACCOUNT_ID)
		expect(fixture.notifications.clearAccount).toHaveBeenCalledWith(MEMBER_ID)
		expect(fixture.manager.accountRuntimes.has(SECOND_ACCOUNT_ID)).toBe(false)
		expect(fixture.manager.syncRuntimes.has(SECOND_SYNC_ID)).toBe(false)
		expect(fixture.manager.accountRuntimes.has(ACCOUNT_ID)).toBe(true)
		expect(fixture.manager.syncRuntimes.has(SYNC_ID)).toBe(true)
	})

	test('never restores or schedules Cloud work for a durably deleted member', async () => {
		const memberSync = persistedSync({
			accountId: SECOND_ACCOUNT_ID,
			destination: {path: '/External/Shared Drive/Alice Cloud', filesystemUuid: 'shared-filesystem'},
		})
		const fixture = await createManager(
			{accounts: [MEMBER_ACCOUNT], syncs: [memberSync]},
			{deletedUserIds: [MEMBER_ID]},
		)

		await fixture.manager.start()
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.sync).not.toHaveBeenCalled()
		expect(fixture.rclone.removeTemporaryConfigFiles).not.toHaveBeenCalledWith(SECOND_ACCOUNT_ID)
		expect(fixture.manager.accountRuntimes.has(SECOND_ACCOUNT_ID)).toBe(false)
		expect(fixture.manager.syncRuntimes.has(SYNC_ID)).toBe(false)
	})

	test('prevents an in-flight request from recreating Cloud state after member deletion', async () => {
		let releaseDestination!: () => void
		const destinationPending = new Promise<void>((resolve) => {
			releaseDestination = resolve
		})
		const fixture = await createManager(
			{accounts: [MEMBER_ACCOUNT], syncs: []},
			{
				resolveDestination: async (destination, _userId, options) => {
					if (options?.requireEmpty) await destinationPending
					return `/resolved${destination.path}`
				},
			},
		)
		await fixture.manager.start()

		const creation = fixture.manager.create({
			userId: MEMBER_ID,
			accountId: SECOND_ACCOUNT_ID,
			remote: {path: ''},
			destination: {path: `/Users/${MEMBER_ID}/Imports/Late Cloud`},
			mode: 'auto',
		})
		await vi.waitFor(() =>
			expect(fixture.resolveDestination).toHaveBeenCalledWith(
				expect.objectContaining({path: `/Users/${MEMBER_ID}/Imports/Late Cloud`}),
				MEMBER_ID,
				{requireEmpty: true},
			),
		)

		await fixture.manager.removeUser(MEMBER_ID)
		releaseDestination()

		await expect(creation).rejects.toThrow(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [], syncs: []})
		expect([...fixture.manager.accountRuntimes.values()].some(({userId}) => userId === MEMBER_ID)).toBe(false)
		expect([...fixture.manager.syncRuntimes.values()].some(({userId}) => userId === MEMBER_ID)).toBe(false)
	})

	test('rejects an authentication that promotes credentials during member deletion', async () => {
		let markPromotionStarted!: () => void
		const promotionStarted = new Promise<void>((resolve) => {
			markPromotionStarted = resolve
		})
		let releasePromotion!: () => void
		const promotionPending = new Promise<void>((resolve) => {
			releasePromotion = resolve
		})
		const fixture = await createManager(
			{accounts: [], syncs: []},
			{
				promoteConfig: async (accountId) => {
					markPromotionStarted()
					await promotionPending
					return `${directory}/${accountId}.conf`
				},
			},
		)
		await fixture.manager.start()

		const connection = fixture.manager.connectWebDav(
			MEMBER_ID,
			{
				flavor: 'webdav',
				url: 'https://dav.example/root',
				username: 'ada',
				password: 'password',
				tlsMode: 'default',
			},
			SECOND_ACCOUNT_ID,
		)
		await promotionStarted

		const removal = fixture.manager.removeUser(MEMBER_ID)
		await vi.waitFor(() => expect(fixture.manager.accountRuntimes.get(SECOND_ACCOUNT_ID)?.state.kind).toBe('closed'))
		releasePromotion()

		await expect(connection).rejects.toThrow(CLOUD_ACCOUNT_NOT_FOUND_ERROR)
		await removal
		expect(await fixture.store.get('files.cloud')).toEqual({accounts: [], syncs: []})
		expect(fixture.rclone.removeAccountDirectory).toHaveBeenCalledWith(SECOND_ACCOUNT_ID)
		expect(fixture.manager.accountRuntimes.has(SECOND_ACCOUNT_ID)).toBe(false)
	})

	test('logs each classified run failure with a bounded tail of rclone records', async () => {
		const records = Array.from({length: 25}, (_, index) => ({level: 'error', msg: `failure-${index}`}))
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{
				random: () => 0.5,
				sync: async () => {
					throw new RcloneProcessError('sync', {code: 1, signal: null}, records)
				},
			},
		)
		const errorLog = vi.spyOn(
			(fixture.manager as unknown as {logger: {error: (message: string, details?: unknown) => void}}).logger,
			'error',
		)
		await fixture.manager.start()

		await (
			fixture.manager as unknown as {
				runSync(syncId: string, signal: AbortSignal): Promise<void>
			}
		).runSync(SYNC_ID, new AbortController().signal)

		expect(errorLog).toHaveBeenCalledTimes(1)
		expect(errorLog).toHaveBeenCalledWith('Cloud sync run failed', {
			syncId: SYNC_ID,
			provider: 'webdav',
			classification: 'error',
			records: records.slice(-20),
		})
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.attention).toEqual({
			kind: 'error',
			message: 'failure-24',
		})
	})

	test('exposes a bounded and sanitized final rclone error', async () => {
		const longSuffix = 'x'.repeat(600)
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{
				random: () => 0.5,
				sync: async () => {
					throw new RcloneProcessError('sync', {code: 1, signal: null}, [
						{level: 'error', msg: 'an earlier error'},
						{
							level: 'error',
							msg: `\u001B[31mFailed\nto sync\u001B[0m https://user:secret@provider.example/file?token=secret\u0000 ${longSuffix}`,
						},
						{level: 'notice', msg: 'not an error'},
					])
				},
			},
		)
		await fixture.manager.start()

		await (
			fixture.manager as unknown as {
				runSync(syncId: string, signal: AbortSignal): Promise<void>
			}
		).runSync(SYNC_ID, new AbortController().signal)

		const attention = fixture.manager.syncRuntimes.get(SYNC_ID)?.attention
		expect(attention).toEqual({kind: 'error', message: expect.any(String)})
		const message = attention?.kind === 'error' ? attention.message : undefined
		expect(message).toHaveLength(512)
		expect(message).toMatch(/^Failed to sync \[redacted-url\] x+$/)
		expect(message).not.toContain('secret')
		expect(message).not.toContain('\n')
	})

	test('keeps initial destination maintenance off the blocking startup path', async () => {
		let release!: (path: string) => void
		const destinationReady = new Promise<string>((resolve) => {
			release = resolve
		})
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{resolveDestination: async () => destinationReady},
		)

		await fixture.manager.restoreProtectionState()
		expect(fixture.manager.getDestinationPaths()).toEqual(['/Home/Imports/WebDAV'])
		expect(() => fixture.manager.assertReady()).toThrow('[cloud-not-ready]')

		await expect(fixture.manager.start({background: true})).resolves.toBeUndefined()
		expect(() => fixture.manager.assertReady()).not.toThrow()
		release('/resolved/Home/Imports/WebDAV')
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()
		expect(fixture.sync).toHaveBeenCalledTimes(1)
	})

	test('serializes initial credential cleanup with authentication for the same account', async () => {
		let cleanupStarted!: () => void
		const started = new Promise<void>((resolve) => {
			cleanupStarted = resolve
		})
		let releaseCleanup!: () => void
		const cleanupPending = new Promise<void>((resolve) => {
			releaseCleanup = resolve
		})
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: []},
			{
				removeTemporaryConfigFiles: async () => {
					cleanupStarted()
					await cleanupPending
				},
			},
		)

		await fixture.manager.start({background: true})
		await started
		const connection = fixture.manager.connectWebDav(
			USER_ID,
			{
				flavor: 'webdav',
				url: 'https://dav.example/',
				username: 'ada',
				password: 'password',
				tlsMode: 'default',
			},
			ACCOUNT_ID,
		)
		await Promise.resolve()
		expect(fixture.rclone.beginConfigTransaction).not.toHaveBeenCalled()

		releaseCleanup()
		await connection
		expect(fixture.rclone.beginConfigTransaction).toHaveBeenCalledOnce()
	})

	test('guards a destination throughout cloud creation and releases failed reservations', async () => {
		const destination = {path: '/Home/Imports/Pending'} as const
		let resolveValidation!: (path: string) => void
		let rejectValidation!: (error: Error) => void
		let validation = new Promise<string>((resolve, reject) => {
			resolveValidation = resolve
			rejectValidation = reject
		})
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: []},
			{
				resolveDestination: async (requested, _userId, options) => {
					if (options?.requireEmpty) return validation
					return `/resolved${requested.path}`
				},
			},
		)
		await fixture.manager.start()

		const create = () =>
			fixture.manager.create({
				userId: USER_ID,
				accountId: ACCOUNT_ID,
				remote: {path: ''},
				destination,
				mode: 'auto',
			})
		const failedCreation = create()
		expect(fixture.manager.getDestinationPaths()).toEqual([destination.path])
		rejectValidation(new Error('validation failed'))
		await expect(failedCreation).rejects.toThrow('validation failed')
		expect(fixture.manager.getDestinationPaths()).toEqual([])

		validation = new Promise<string>((resolve, reject) => {
			resolveValidation = resolve
			rejectValidation = reject
		})
		const successfulCreation = create()
		expect(fixture.manager.getDestinationPaths()).toEqual([destination.path])
		resolveValidation(`/resolved${destination.path}`)
		const created = await successfulCreation
		expect(fixture.manager.getDestinationPaths()).toEqual([destination.path])
		expect(fixture.manager.pendingDestinations).toEqual(new Set())
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			{
				id: created.id,
				accountId: ACCOUNT_ID,
				remote: {path: ''},
				destination,
				mode: 'auto',
			},
		])
	})

	test.each([
		{
			name: 'external storage',
			destination: {
				path: '/External/Archive/Imports/Pending',
				filesystemUuid: 'archive-filesystem',
			} satisfies DestinationRef,
			block: (cloud: CloudManager) =>
				cloud.blockExternalStorage([
					{
						filesystemUuid: 'archive-filesystem',
						mountPaths: ['/External/Archive'],
					},
				]),
		},
		{
			name: 'network storage',
			destination: {
				path: '/Network/nas.local/Media/Imports/Pending',
				host: 'nas.local',
				share: 'Media',
			} satisfies DestinationRef,
			block: (cloud: CloudManager) =>
				cloud.blockNetworkStorage({
					host: 'nas.local',
					share: 'Media',
					mountPath: '/Network/nas.local/Media',
				}),
		},
	])('rejects a pending creation if $name changes before commit', async ({destination, block}) => {
		let markBrowseStarted!: () => void
		const browseStarted = new Promise<void>((resolve) => {
			markBrowseStarted = resolve
		})
		let releaseBrowse!: () => void
		const browsePending = new Promise<void>((resolve) => {
			releaseBrowse = resolve
		})
		const fixture = await createManager({accounts: [ACCOUNT], syncs: []})
		fixture.rclone.browse.mockImplementationOnce(async () => {
			markBrowseStarted()
			await browsePending
			return {entries: [], truncated: false}
		})
		await fixture.manager.start()

		const creation = fixture.manager.create({
			userId: USER_ID,
			accountId: ACCOUNT_ID,
			remote: {path: ''},
			destination,
			mode: 'auto',
		})
		await browseStarted
		expect(fixture.manager.getDestinationPaths()).toEqual([destination.path])

		const releaseStorage = await block(fixture.manager)
		releaseBrowse()
		releaseStorage()

		await expect(creation).rejects.toThrow(CLOUD_DESTINATION_MISSING_ERROR)
		expect(fixture.resolveDestination).toHaveBeenCalledTimes(1)
		expect(fixture.manager.getDestinationPaths()).toEqual([])
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([])
	})

	test('makes storage removal wait for the final destination check and observe the committed sync', async () => {
		const destination = {
			path: '/External/Archive/Imports/Pending',
			filesystemUuid: 'archive-filesystem',
		} satisfies DestinationRef
		let markFinalValidationStarted!: () => void
		const finalValidationStarted = new Promise<void>((resolve) => {
			markFinalValidationStarted = resolve
		})
		let releaseFinalValidation!: () => void
		const finalValidationPending = new Promise<void>((resolve) => {
			releaseFinalValidation = resolve
		})
		let validationCount = 0
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: []},
			{
				resolveDestination: async (requested, _userId, options) => {
					if (options?.requireEmpty && ++validationCount === 2) {
						markFinalValidationStarted()
						await finalValidationPending
					}
					return `/resolved${requested.path}`
				},
			},
		)
		await fixture.manager.start()

		const creation = fixture.manager.create({
			userId: USER_ID,
			accountId: ACCOUNT_ID,
			remote: {path: ''},
			destination,
			mode: 'auto',
		})
		await finalValidationStarted

		let storageBlocked = false
		const blocking = fixture.manager
			.blockExternalStorage([
				{
					filesystemUuid: destination.filesystemUuid,
					mountPaths: ['/External/Archive'],
				},
			])
			.then((release) => {
				storageBlocked = true
				return release
			})
		await Promise.resolve()
		expect(storageBlocked).toBe(false)

		releaseFinalValidation()
		const created = await creation
		const releaseStorage = await blocking
		expect(fixture.manager.syncRuntimes.get(created.id)?.destinationBlockers.size).toBe(1)

		releaseStorage()
		expect(fixture.manager.syncRuntimes.get(created.id)?.destinationBlockers.size).toBe(0)
	})

	test('keeps a lifecycle blocker owned while destination access is revalidated', async () => {
		const destination = {
			path: '/External/Archive/Imports/Existing',
			filesystemUuid: 'archive-filesystem',
		} satisfies DestinationRef
		let available = true
		const fixture = await createManager(
			{
				accounts: [ACCOUNT],
				syncs: [persistedSync({destination, lastSuccessfulAt: NOW})],
			},
			{
				resolveDestination: async (requested) => {
					if (!available) throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
					return `/resolved${requested.path}`
				},
			},
		)
		await fixture.manager.start()

		const releaseStorage = await fixture.manager.blockExternalStorage([
			{
				filesystemUuid: destination.filesystemUuid,
				mountPaths: ['/External/Archive'],
			},
		])
		await fixture.manager.revalidateDestinationAccess()
		await fixture.manager.schedulerTick()

		expect(fixture.manager.syncRuntimes.get(SYNC_ID)).toMatchObject({
			phase: 'idle',
			destinationUnavailable: false,
		})
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationBlockers.size).toBe(1)
		expect(fixture.sync).not.toHaveBeenCalled()

		available = false
		await fixture.manager.revalidateDestinationAccess()
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationUnavailable).toBe(true)

		releaseStorage()
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationBlockers.size).toBe(0)
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationUnavailable).toBe(true)
	})

	test('clears transient destination unavailability on a successful scheduler check', async () => {
		let available = false
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{
				resolveDestination: async (destination, _userId, options) => {
					if (options?.checkOnly && !available) throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
					return `/resolved${destination.path}`
				},
			},
		)
		await fixture.manager.start()

		expect(fixture.manager.syncRuntimes.get(SYNC_ID)).toMatchObject({
			phase: 'idle',
			destinationUnavailable: true,
			attention: {kind: 'destination-missing'},
		})
		expect(fixture.sync).not.toHaveBeenCalled()

		available = true
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationUnavailable).toBe(false)
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.attention).toBeUndefined()
		expect(fixture.sync).toHaveBeenCalledOnce()
	})

	test('sweeps abandoned config transactions only during initial maintenance', async () => {
		const fixture = await createManager({accounts: [ACCOUNT], syncs: []})

		await fixture.manager.start()
		expect(fixture.rclone.removeTemporaryConfigFiles).toHaveBeenCalledOnce()
		expect(fixture.rclone.removeTemporaryConfigFiles).toHaveBeenCalledWith(ACCOUNT_ID)

		await fixture.manager.schedulerTick()
		expect(fixture.rclone.removeTemporaryConfigFiles).toHaveBeenCalledOnce()
	})

	test('upserts a verified WebDAV account without persisting its password and pins reauthentication identity', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()

		const connected = await fixture.manager.connectWebDav(USER_ID, {
			flavor: 'nextcloud',
			url: 'https://dav.example/root',
			username: 'ada',
			password: 'body-only-password',
			tlsMode: 'default',
		})

		expect(connected.account.id).toMatch(/^[0-9a-f-]{36}$/)
		expect(fixture.configCalls[0]).toMatchObject({
			method: 'config/create',
			parameters: {parameters: {pass: 'body-only-password', vendor: 'other'}},
		})
		const stored = await fixture.store.get('files.cloud')
		expect(stored.accounts).toHaveLength(1)
		expect(stored.accounts[0].connection).toMatchObject({kind: 'webdav', flavor: 'nextcloud'})
		expect(JSON.stringify(stored)).not.toContain('body-only-password')
		expect(fixture.transactions[0].prepare).toHaveBeenCalledTimes(1)
		expect(fixture.transactions[0].promote).toHaveBeenCalledTimes(1)

		await expect(
			fixture.manager.connectWebDav(
				USER_ID,
				{
					flavor: 'nextcloud',
					url: 'https://dav.example/root',
					username: 'different-user',
					password: 'replacement-password',
					tlsMode: 'default',
				},
				connected.account.id,
			),
		).rejects.toThrow('[cloud-account-identity-mismatch]')
		expect(fixture.transactions[1].abort).toHaveBeenCalledTimes(1)
		expect((await fixture.store.get('files.cloud')).accounts[0].identity).toBe('ada\nhttps://dav.example/root/')
	})

	test('rejects unsupported WebDAV flavors before storing the account', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()

		await expect(
			fixture.manager.connectWebDav(USER_ID, {
				flavor: 'caldav' as 'webdav',
				url: 'https://dav.example/',
				username: 'ada',
				password: 'password',
				tlsMode: 'default',
			}),
		).rejects.toThrow(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)

		expect((await fixture.store.get('files.cloud')).accounts).toEqual([])
		expect(fixture.transactions[0].prepare).not.toHaveBeenCalled()
		expect(fixture.transactions[0].abort).toHaveBeenCalledTimes(1)
	})

	test('prepares account config before entering the global store write lock', async () => {
		let releasePreparation!: () => void
		const preparation = new Promise<void>((resolve) => {
			releasePreparation = resolve
		})
		const fixture = await createManager({accounts: [], syncs: []}, {prepareConfig: () => preparation})
		await fixture.manager.start()
		const writeLock = vi.spyOn(fixture.store, 'getWriteLock')

		const connection = fixture.manager.connectWebDav(USER_ID, {
			flavor: 'webdav',
			url: 'https://dav.example/',
			username: 'ada',
			password: 'password',
			tlsMode: 'default',
		})
		await vi.waitFor(() => expect(fixture.transactions[0]?.prepare).toHaveBeenCalledTimes(1))
		expect(writeLock).not.toHaveBeenCalled()

		releasePreparation()
		await connection
		expect(writeLock).toHaveBeenCalledTimes(1)
		expect(fixture.transactions[0].promote).toHaveBeenCalledTimes(1)
	})

	test('consumes OAuth sessions once', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()
		const beginOAuth = vi.spyOn(fixture.manager.auth, 'beginOAuth').mockImplementation((accountId, provider) => ({
			authorizationUrl: 'https://provider.example/authorize',
			session: {
				kind: 'oauth',
				sessionId: '55555555-5555-4555-8555-555555555555',
				accountId,
				provider: provider as 'google-drive' | 'dropbox' | 'onedrive',
				verifier: 'verifier',
				redirectUrl: 'https://proxy.example/callback',
				expiresAt: NOW + OAUTH_SESSION_LIFETIME,
			},
		}))
		const completeOAuth = vi.spyOn(fixture.manager.auth, 'completeOAuth').mockResolvedValue({
			account: {
				provider: 'google-drive',
				identity: 'google-user',
				displayName: 'Ada',
				connection: {kind: 'oauth'},
			},
			locations: {locations: [], truncated: false},
		})

		const session = await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		expect(session).toMatchObject({expiresInMs: OAUTH_SESSION_LIFETIME})
		expect(session).not.toHaveProperty('expiresAt')
		await expect(fixture.manager.completeOAuth(USER_ID, ACCOUNT_ID, 'copy-code')).resolves.toMatchObject({
			account: {id: ACCOUNT_ID, identity: 'google-user'},
		})
		await expect(fixture.manager.completeOAuth(USER_ID, ACCOUNT_ID, 'copy-code')).rejects.toThrow(
			'[cloud-auth-session-not-found]',
		)
		expect(completeOAuth).toHaveBeenCalledTimes(1)
	})

	test('returns the active result to concurrent OAuth completions', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()
		vi.spyOn(fixture.manager.auth, 'beginOAuth').mockImplementation((accountId, provider) => ({
			authorizationUrl: 'https://provider.example/authorize',
			session: {
				kind: 'oauth',
				sessionId: '55555555-5555-4555-8555-555555555555',
				accountId,
				provider: provider as 'google-drive' | 'dropbox' | 'onedrive',
				verifier: 'verifier',
				redirectUrl: 'https://proxy.example/callback',
				expiresAt: NOW + OAUTH_SESSION_LIFETIME,
			},
		}))
		let started!: () => void
		const didStart = new Promise<void>((resolve) => {
			started = resolve
		})
		let release!: () => void
		const blocked = new Promise<void>((resolve) => {
			release = resolve
		})
		const completeOAuth = vi.spyOn(fixture.manager.auth, 'completeOAuth').mockImplementation(async () => {
			started()
			await blocked
			return {
				account: {
					provider: 'google-drive',
					identity: 'google-user',
					displayName: 'Ada',
					connection: {kind: 'oauth'},
				},
				locations: {locations: [], truncated: false},
			}
		})

		await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		const first = fixture.manager.completeOAuth(USER_ID, ACCOUNT_ID, 'copy-code')
		await didStart
		const duplicate = fixture.manager.completeOAuth(USER_ID, ACCOUNT_ID, 'copy-code')
		release()

		const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
		expect(duplicateResult).toEqual(firstResult)
		expect(completeOAuth).toHaveBeenCalledOnce()
		expect(fixture.transactions[0].promote).toHaveBeenCalledOnce()
	})

	test('cancels only the matching OAuth session and releases reauthentication immediately', async () => {
		const account: Account = {
			...ACCOUNT,
			provider: 'google-drive',
			identity: 'google-user',
			displayName: 'Ada',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [account], syncs: []})
		await fixture.manager.start()

		const first = await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		expect(await fixture.manager.cancelOAuth(MEMBER_ID, ACCOUNT_ID, first.sessionId)).toBe(false)
		expect(await fixture.manager.cancelOAuth(USER_ID, ACCOUNT_ID, '55555555-5555-4555-8555-555555555555')).toBe(false)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('authenticating')

		expect(await fixture.manager.cancelOAuth(USER_ID, ACCOUNT_ID, first.sessionId)).toBe(true)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('ready')

		const second = await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		expect(second.sessionId).not.toBe(first.sessionId)
		expect(await fixture.manager.cancelOAuth(USER_ID, ACCOUNT_ID, first.sessionId)).toBe(false)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('authenticating')
		expect(await fixture.manager.cancelOAuth(USER_ID, ACCOUNT_ID, second.sessionId)).toBe(true)
	})

	test('aborts an in-flight OAuth transaction when its session is cancelled', async () => {
		const account: Account = {
			...ACCOUNT,
			provider: 'google-drive',
			identity: 'google-user',
			displayName: 'Ada',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager({accounts: [account], syncs: []})
		await fixture.manager.start()
		let started!: () => void
		const didStart = new Promise<void>((resolve) => {
			started = resolve
		})
		vi.spyOn(fixture.manager.auth, 'completeOAuth').mockImplementation(
			async (_session, _code, _transaction, signal) => {
				started()
				await new Promise<void>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(new RcloneAbortedError()), {once: true})
				})
				throw new Error('unreachable')
			},
		)

		const session = await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		const completion = fixture.manager.completeOAuth(USER_ID, ACCOUNT_ID, 'copy-code')
		const completionResult = expect(completion).rejects.toThrow('[cloud-cancelled]')
		await didStart

		await expect(fixture.manager.cancelOAuth(USER_ID, ACCOUNT_ID, session.sessionId)).resolves.toBe(true)
		await completionResult
		expect(fixture.transactions[0].abort).toHaveBeenCalled()
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('ready')
		expect((await fixture.store.get('files.cloud')).accounts).toEqual([account])
	})

	test('reserves an account synchronously across concurrent authentication begins', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()

		const attempts = await Promise.allSettled([
			fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID),
			fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID),
		])

		expect(attempts.filter(({status}) => status === 'fulfilled')).toHaveLength(1)
		const rejected = attempts.filter(({status}) => status === 'rejected')
		expect(rejected).toHaveLength(1)
		expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
			expect.objectContaining({message: '[cloud-account-busy]'}),
		)
	})

	test('aborts an expired iCloud 2FA transaction and removes its prospective runtime', async () => {
		let now = NOW
		const fixture = await createManager({accounts: [], syncs: []}, {now: () => now})
		await fixture.manager.start()
		vi.spyOn(fixture.manager.auth, 'beginICloud').mockResolvedValue({
			complete: false,
			challenge: {state: 'choose_2fa', step: 'config_2fa_phone', prompt: 'Choose a trusted device'},
		})
		const continueICloud = vi.spyOn(fixture.manager.auth, 'continueICloud')

		await fixture.manager.beginICloud(USER_ID, {appleId: 'ada@example.com', password: 'password'}, ACCOUNT_ID)
		now += OAUTH_SESSION_LIFETIME
		await expect(fixture.manager.continueICloud(USER_ID, ACCOUNT_ID, '123456')).rejects.toThrow(
			'[cloud-auth-session-expired]',
		)

		expect(continueICloud).not.toHaveBeenCalled()
		expect(fixture.transactions[0].abort).toHaveBeenCalledTimes(1)
		expect(fixture.manager.accountRuntimes.has(ACCOUNT_ID)).toBe(false)
	})

	test('returns the active result to concurrent iCloud challenge submissions', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()
		vi.spyOn(fixture.manager.auth, 'beginICloud').mockResolvedValue({
			complete: false,
			challenge: {state: 'choose_2fa', step: 'config_2fa_phone', prompt: 'Choose a trusted device'},
		})
		let started!: () => void
		const didStart = new Promise<void>((resolve) => {
			started = resolve
		})
		let release!: () => void
		const blocked = new Promise<void>((resolve) => {
			release = resolve
		})
		const continueICloud = vi.spyOn(fixture.manager.auth, 'continueICloud').mockImplementation(async () => {
			started()
			await blocked
			return {
				complete: false,
				challenge: {state: 'enter_code', step: 'config_2fa_sms', prompt: 'Enter the code'},
			}
		})

		await fixture.manager.beginICloud(USER_ID, {appleId: 'ada@example.com', password: 'password'}, ACCOUNT_ID)
		const first = fixture.manager.continueICloud(USER_ID, ACCOUNT_ID, '0')
		await didStart
		const duplicate = fixture.manager.continueICloud(USER_ID, ACCOUNT_ID, '0')
		release()

		const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
		expect(duplicateResult).toEqual(firstResult)
		expect(continueICloud).toHaveBeenCalledOnce()
		expect(fixture.transactions[0].abort).not.toHaveBeenCalled()
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state).toMatchObject({
			kind: 'authenticating',
			session: {kind: 'icloud', state: 'enter_code'},
		})
	})

	test('releases abandoned auth sessions from the next scheduler tick', async () => {
		let now = NOW
		const oauthAccount: Account = {
			...ACCOUNT,
			provider: 'google-drive',
			identity: 'google-user',
			displayName: 'Ada',
			connection: {kind: 'oauth'},
		}
		const fixture = await createManager(
			{
				accounts: [oauthAccount],
				syncs: [persistedSync({remote: {path: '/', folderId: 'root-folder'}})],
			},
			{now: () => now, random: () => 0.5},
		)
		await fixture.manager.start()
		fixture.manager.syncRuntimes.get(SYNC_ID)!.nextRunAt = NOW

		await fixture.manager.beginOAuth(USER_ID, 'google-drive', ACCOUNT_ID)
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('authenticating')
		now += OAUTH_SESSION_LIFETIME + 1

		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.state.kind).toBe('ready')
		expect(fixture.sync).toHaveBeenCalledOnce()
	})

	test('uses a non-mutating destination check during scheduler ticks', async () => {
		const fixture = await createManager({accounts: [ACCOUNT], syncs: [persistedSync()]})

		await fixture.manager.start()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.resolveDestination.mock.calls).toEqual([
			[expect.objectContaining({path: '/Home/Imports/WebDAV'}), USER_ID, {checkOnly: true}],
			[expect.objectContaining({path: '/Home/Imports/WebDAV'}), USER_ID],
		])
	})

	test('runs syncs FIFO within an account', async () => {
		let releaseFirst!: () => void
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		const order: string[] = []
		const fixture = await createManager(
			{
				accounts: [ACCOUNT],
				syncs: [persistedSync(), persistedSync({id: SECOND_SYNC_ID, destination: {path: '/Home/Second'}})],
			},
			{
				sync: async ({syncId}) => {
					order.push(syncId)
					if (syncId === SYNC_ID) await firstBlocked
				},
			},
		)

		await fixture.manager.start()
		await vi.waitFor(() => expect(order).toEqual([SYNC_ID]))
		releaseFirst()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(order).toEqual([SYNC_ID, SECOND_SYNC_ID])
	})

	test('runs only one sync globally across accounts', async () => {
		let releaseFirst!: () => void
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		const order: string[] = []
		const fixture = await createManager(
			{
				accounts: [ACCOUNT, SECOND_ACCOUNT],
				syncs: [
					persistedSync(),
					persistedSync({
						id: SECOND_SYNC_ID,
						accountId: SECOND_ACCOUNT_ID,
						destination: {path: '/Home/Second'},
					}),
				],
			},
			{
				sync: async ({syncId}) => {
					order.push(syncId)
					if (syncId === SYNC_ID) await firstBlocked
				},
			},
		)

		await fixture.manager.start()
		await vi.waitFor(() => expect(order).toEqual([SYNC_ID]))
		releaseFirst()
		await fixture.manager.globalSyncQueue.onIdle()

		expect(order).toEqual([SYNC_ID, SECOND_SYNC_ID])
	})

	test('cancels queued work without letting it pass an active cloud', async () => {
		let started!: () => void
		const didStart = new Promise<void>((resolve) => {
			started = resolve
		})
		const fixture = await createManager(
			{
				accounts: [ACCOUNT],
				syncs: [persistedSync(), persistedSync({id: SECOND_SYNC_ID, destination: {path: '/Home/Second'}})],
			},
			{
				sync: async ({signal}) => {
					started()
					await new Promise<void>((_resolve, reject) => {
						signal?.addEventListener('abort', () => reject(new RcloneAbortedError()), {once: true})
					})
				},
			},
		)
		await fixture.manager.start()
		await didStart

		await fixture.manager.pause(USER_ID, SECOND_SYNC_ID)
		await fixture.manager.pause(USER_ID, SYNC_ID)

		expect(fixture.sync).toHaveBeenCalledTimes(1)
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			expect.objectContaining({id: SYNC_ID, pauseReasons: {user: true}}),
			expect.objectContaining({id: SECOND_SYNC_ID, pauseReasons: {user: true}}),
		])
	})

	test('immediately stops a transfer when the member loses destination access', async () => {
		let hasAccess = true
		let started!: () => void
		const didStart = new Promise<void>((resolve) => {
			started = resolve
		})
		const fixture = await createManager(
			{
				accounts: [MEMBER_ACCOUNT],
				syncs: [
					persistedSync({
						accountId: SECOND_ACCOUNT_ID,
						destination: {path: '/External/Shared Drive/Alice Cloud', filesystemUuid: 'shared-filesystem'},
					}),
				],
			},
			{
				resolveDestination: async (destination) => {
					if (!hasAccess) throw new Error('[cloud-destination-missing]')
					return `/resolved${destination.path}`
				},
				sync: async ({signal}) => {
					started()
					await new Promise<void>((_resolve, reject) => {
						signal?.addEventListener('abort', () => reject(new RcloneAbortedError()), {once: true})
					})
				},
			},
		)
		await fixture.manager.start()
		await didStart

		hasAccess = false
		const shareChangeListener = fixture.eventBus.on.mock.calls.find(
			([event]) => event === 'files:member-shares:change',
		)?.[1]
		expect(shareChangeListener).toBeTypeOf('function')
		await shareChangeListener?.()

		expect(fixture.manager.syncRuntimes.get(SYNC_ID)).toMatchObject({
			phase: 'idle',
			destinationUnavailable: true,
			attention: {kind: 'destination-missing'},
		})
		expect(fixture.manager.getActivity(MEMBER_ID)).toEqual([])
	})

	test('rolls runtime removal state back when store transactions fail', async () => {
		const fixture = await createManager({accounts: [ACCOUNT], syncs: [persistedSync()]})
		await fixture.manager.start()
		await fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.queue.onIdle()
		const writeLock = vi.spyOn(fixture.store, 'getWriteLock')

		writeLock.mockRejectedValueOnce(new Error('store unavailable'))
		await expect(fixture.manager.remove(USER_ID, SYNC_ID)).rejects.toThrow('store unavailable')
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)).toMatchObject({removing: false})
		expect((await fixture.store.get('files.cloud')).syncs).toHaveLength(1)

		writeLock.mockRejectedValueOnce(new Error('store unavailable'))
		await expect(fixture.manager.removeAccount(USER_ID, ACCOUNT_ID, [SYNC_ID])).rejects.toThrow('store unavailable')
		expect(fixture.manager.accountRuntimes.get(ACCOUNT_ID)).toMatchObject({state: {kind: 'ready'}})
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)).toMatchObject({removing: false})
		expect(await fixture.store.get('files.cloud')).toMatchObject({
			accounts: [{id: ACCOUNT_ID}],
			syncs: [{id: SYNC_ID}],
		})
	})

	test('removes Cloud definitions only after a coordinated Rewind restore succeeds', async () => {
		const sync = persistedSync({pauseReasons: {user: true}})
		const fixture = await createManager({accounts: [ACCOUNT], syncs: [sync]})
		await fixture.manager.start()
		let restoreToken: symbol | undefined

		await fixture.manager.restoreForRewind({
			userId: USER_ID,
			confirmedSyncIds: [SYNC_ID],
			targetPaths: [`${sync.destination.path}/restored.txt`],
			restore: async (token) => {
				restoreToken = token
				expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationPath).toBe(sync.destination.path)
				expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationBlockers.size).toBe(1)
				expect(fixture.manager.allowsRewindRestore(token, `${sync.destination.path}/restored.txt`)).toBe(true)
				expect(
					fixture.manager.allowsRewindRestore(
						token,
						`${sync.destination.path}/restored (2).txt`,
						`${sync.destination.path}/restored.txt`,
					),
				).toBe(true)
				expect(
					fixture.manager.allowsRewindRestore(
						token,
						`${sync.destination.path}/other.txt`,
						`${sync.destination.path}/other.txt`,
					),
				).toBe(false)
				expect((await fixture.store.get('files.cloud')).syncs).toEqual([sync])
			},
		})

		expect((await fixture.store.get('files.cloud')).syncs).toEqual([])
		expect(fixture.manager.syncRuntimes.has(SYNC_ID)).toBe(false)
		expect(fixture.manager.allowsRewindRestore(restoreToken, `${sync.destination.path}/restored.txt`)).toBe(false)
	})

	test('restores Cloud protection and definitions when a coordinated Rewind restore fails', async () => {
		const sync = persistedSync({pauseReasons: {user: true}})
		const fixture = await createManager({accounts: [ACCOUNT], syncs: [sync]})
		await fixture.manager.start()
		let restoreToken: symbol | undefined

		await expect(
			fixture.manager.restoreForRewind({
				userId: USER_ID,
				confirmedSyncIds: [SYNC_ID],
				targetPaths: [`${sync.destination.path}/restored.txt`],
				restore: async (token) => {
					restoreToken = token
					expect(fixture.manager.allowsRewindRestore(token, `${sync.destination.path}/restored.txt`)).toBe(true)
					throw new Error('restore failed')
				},
			}),
		).rejects.toThrow('restore failed')

		expect((await fixture.store.get('files.cloud')).syncs).toEqual([sync])
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationPath).toBe(sync.destination.path)
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.destinationBlockers.size).toBe(0)
		expect(fixture.manager.allowsRewindRestore(restoreToken, `${sync.destination.path}/restored.txt`)).toBe(false)
	})

	test('rejects a stale Rewind Cloud confirmation before running restore work', async () => {
		const restore = vi.fn(async () => {})
		const fixture = await createManager({
			accounts: [ACCOUNT],
			syncs: [persistedSync({pauseReasons: {user: true}})],
		})
		await fixture.manager.start()

		await expect(
			fixture.manager.restoreForRewind({
				userId: USER_ID,
				confirmedSyncIds: [SYNC_ID],
				targetPaths: ['/Home/Outside/restored.txt'],
				restore,
			}),
		).rejects.toThrow('[cloud-restore-confirmation-mismatch]')
		expect(restore).not.toHaveBeenCalled()
		expect((await fixture.store.get('files.cloud')).syncs).toHaveLength(1)
	})

	test('aborts authentication and cleans up when the account store transaction fails', async () => {
		const fixture = await createManager({accounts: [], syncs: []})
		await fixture.manager.start()
		vi.spyOn(fixture.store, 'getWriteLock').mockRejectedValueOnce(new Error('store unavailable'))

		await expect(
			fixture.manager.connectWebDav(USER_ID, {
				flavor: 'webdav',
				url: 'https://dav.example/',
				username: 'ada',
				password: 'password',
				tlsMode: 'default',
			}),
		).rejects.toThrow('store unavailable')

		expect(fixture.transactions[0].prepare).toHaveBeenCalledTimes(1)
		expect(fixture.transactions[0].promote).not.toHaveBeenCalled()
		expect(fixture.transactions[0].abort).toHaveBeenCalledTimes(1)
		expect((await fixture.store.get('files.cloud')).accounts).toEqual([])
		expect(fixture.manager.accountRuntimes.size).toBe(0)
	})

	test('progresses and caps exponential retry backoff, then resets it after success', async () => {
		let fail = true
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: []},
			{
				sync: async () => {
					if (fail) throw new Error('transfer failed')
				},
			},
		)
		await fixture.manager.start()
		const created = await fixture.manager.create({
			userId: USER_ID,
			accountId: ACCOUNT_ID,
			remote: {path: ''},
			destination: {path: '/Home/Imports/Retry'},
			mode: 'auto',
		})

		const delays = [1, 2, 4, 8, 16, 32, 60, 60].map((minutes) => minutes * 60 * 1000)
		for (const [index, delay] of delays.entries()) {
			if (index > 0) await fixture.manager.resume(USER_ID, created.id)
			await fixture.manager.globalSyncQueue.onIdle()
			expect(fixture.manager.syncRuntimes.get(created.id)).toMatchObject({
				retryCount: index + 1,
				nextRunAt: NOW + delay,
			})
		}
		expect(delays.at(-1)).toBe(CLOUD_RETRY_MAX)

		fail = false
		await fixture.manager.resume(USER_ID, created.id)
		await fixture.manager.globalSyncQueue.onIdle()
		expect(fixture.manager.syncRuntimes.get(created.id)).toMatchObject({
			retryCount: 0,
			nextRunAt: NOW + CLOUD_AUTO_INTERVAL,
		})

		fail = true
		await fixture.manager.resume(USER_ID, created.id)
		await fixture.manager.globalSyncQueue.onIdle()
		expect(fixture.manager.syncRuntimes.get(created.id)).toMatchObject({
			retryCount: 1,
			nextRunAt: NOW + CLOUD_RETRY_INITIAL,
		})
	})

	test('runs a paused automatic sync once without resuming its schedule', async () => {
		let now = NOW
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync({pauseReasons: {user: true}})]},
			{now: () => now},
		)
		await fixture.manager.start()

		await fixture.manager.runOnce(USER_ID, SYNC_ID)
		await fixture.manager.globalSyncQueue.onIdle()

		expect(fixture.sync).toHaveBeenCalledTimes(1)
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			expect.objectContaining({id: SYNC_ID, pauseReasons: {user: true}, lastSuccessfulAt: NOW}),
		])
		expect(await fixture.manager.getSyncs(USER_ID)).toEqual([
			expect.objectContaining({
				id: SYNC_ID,
				pauseReasons: {user: true},
				status: expect.objectContaining({state: 'paused'}),
			}),
		])

		now += CLOUD_AUTO_INTERVAL
		await fixture.manager.schedulerTick()
		await fixture.manager.globalSyncQueue.onIdle()
		expect(fixture.sync).toHaveBeenCalledTimes(1)
	})

	test('preserves a user pause after acknowledging a restore pause', async () => {
		const fixture = await createManager({
			accounts: [ACCOUNT],
			syncs: [persistedSync({pauseReasons: {user: true}})],
		})
		await fixture.manager.start()

		await fixture.manager.pauseRestoredSyncs()
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			expect.objectContaining({id: SYNC_ID, pauseReasons: {user: true, restore: true}}),
		])

		await fixture.manager.resume(USER_ID, SYNC_ID)
		await fixture.manager.globalSyncQueue.onIdle()
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			expect.objectContaining({id: SYNC_ID, pauseReasons: {user: true}}),
		])
		expect(fixture.sync).not.toHaveBeenCalled()

		await fixture.manager.resume(USER_ID, SYNC_ID)
		await fixture.manager.globalSyncQueue.onIdle()
		expect((await fixture.store.get('files.cloud')).syncs).toEqual([
			expect.not.objectContaining({pauseReasons: expect.anything()}),
		])
		expect(fixture.sync).toHaveBeenCalledTimes(1)
	})

	test('applies startup and automatic jitter and schedules only on the thirty-second cadence', async () => {
		vi.useFakeTimers()
		let now = NOW
		const fixture = await createManager(
			{accounts: [ACCOUNT], syncs: [persistedSync()]},
			{now: () => now, random: () => 0.5},
		)
		await fixture.manager.start()

		const startupDelay = Math.floor(CLOUD_STARTUP_JITTER_MAX * 0.5)
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.nextRunAt).toBe(NOW + startupDelay)
		now += startupDelay
		await vi.advanceTimersByTimeAsync(CLOUD_SCHEDULER_INTERVAL - 1)
		expect(fixture.sync).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await fixture.manager.schedulerTick()
		await fixture.manager.accountRuntimes.get(ACCOUNT_ID)?.queue.onIdle()

		expect(fixture.sync).toHaveBeenCalledTimes(1)
		expect(fixture.manager.syncRuntimes.get(SYNC_ID)?.nextRunAt).toBe(
			now + CLOUD_AUTO_INTERVAL + Math.floor(CLOUD_AUTO_JITTER_MAX * 0.5),
		)
	})
})
