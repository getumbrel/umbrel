import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {NativeSessionRequiredError} from '../auth/auth.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

const principal = {sessionId: 'native-session', accountId: 'Alice', actor: 'account'} as const

function contextFor(auth: Record<string, unknown>, photos: Record<string, unknown>) {
	return {
		umbreld: {
			auth: {authenticateApiCredentials: vi.fn(async () => principal), ...auth},
			photos,
		} as unknown as Umbreld,
		transport: 'express',
		request: {headers: {authorization: 'Bearer native-access'}},
		response: {set: vi.fn()},
		principal,
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context
}

test('creates a source-bound grant only after validating the native session', async () => {
	const source = {
		id: '11111111-1111-4111-8111-111111111111',
		accountId: 'Alice',
		name: 'Pixel 9',
		createdAt: 1,
	}
	const nativeClient = vi.fn(async () => ({
		id: 'umbrel',
		platform: 'android',
		deviceClass: 'phone',
		appVersion: '0.1',
		appBuild: '3',
		osVersion: '16',
	}))
	const createBackupGrant = vi.fn(async () => ({token: 'grant', source}))
	const context = contextFor({nativeClient}, {createBackupGrant})
	const caller = routes.createCaller(context)

	await expect(caller.createBackupGrant({sourceId: source.id, suggestedName: source.name})).resolves.toEqual({
		token: 'grant',
		source,
	})
	expect(nativeClient).toHaveBeenCalledWith(principal)
	// The source records the platform the app reported for this session.
	expect(createBackupGrant).toHaveBeenCalledWith({
		principal,
		sourceId: source.id,
		suggestedName: source.name,
		platform: 'android',
	})
	expect(context.response!.set).toHaveBeenCalledWith('Cache-Control', 'no-store')

	// A phone taking the backup over from another says so
	await caller.createBackupGrant({sourceId: source.id, suggestedName: source.name, continuing: true})
	expect(createBackupGrant).toHaveBeenLastCalledWith({
		principal,
		sourceId: source.id,
		suggestedName: source.name,
		continuing: true,
		platform: 'android',
	})
})

test('rejects browser sessions before registering a backup source', async () => {
	const createBackupGrant = vi.fn()
	const context = contextFor(
		{
			nativeClient: vi.fn(async () => {
				throw new NativeSessionRequiredError()
			}),
		},
		{createBackupGrant},
	)
	const caller = routes.createCaller(context)

	await expect(
		caller.createBackupGrant({
			sourceId: '11111111-1111-4111-8111-111111111111',
			suggestedName: 'Browser source',
		}),
	).rejects.toMatchObject({code: 'FORBIDDEN'})
	expect(createBackupGrant).not.toHaveBeenCalled()
})

test.each(['00000000-0000-0000-0000-000000000000', '11111111-1111-0111-8111-111111111111'])(
	'rejects unsupported backup source id %s at the route boundary',
	async (sourceId) => {
		const createBackupGrant = vi.fn()
		const confirmedBackupResources = vi.fn()
		const caller = routes.createCaller(contextFor({}, {createBackupGrant, confirmedBackupResources}))

		await expect(caller.createBackupGrant({sourceId, suggestedName: 'Phone'})).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		})
		await expect(caller.confirmedBackupResources({sourceId, resources: []})).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		})
		expect(createBackupGrant).not.toHaveBeenCalled()
		expect(confirmedBackupResources).not.toHaveBeenCalled()
	},
)

test('checks a bounded batch of resource receipts within the signed-in account', async () => {
	const sourceId = '11111111-1111-4111-8111-111111111111'
	const resourceKey = 'a'.repeat(64)
	const receipt = {resourceKey, bytes: 5}
	const confirmedBackupResources = vi.fn(async () => [receipt])
	const context = contextFor({}, {confirmedBackupResources})
	const caller = routes.createCaller(context)

	await expect(
		caller.confirmedBackupResources({
			sourceId,
			resources: [{resourceKey, fileExtension: 'heic'}],
		}),
	).resolves.toEqual([receipt])
	expect(confirmedBackupResources).toHaveBeenCalledWith({
		accountId: 'Alice',
		sourceId,
		resources: [{resourceKey, fileExtension: 'heic'}],
	})
})

test('rejects oversized resource receipt batches before touching storage', async () => {
	const confirmedBackupResources = vi.fn()
	const context = contextFor({}, {confirmedBackupResources})
	const caller = routes.createCaller(context)

	await expect(
		caller.confirmedBackupResources({
			sourceId: '11111111-1111-4111-8111-111111111111',
			resources: Array.from({length: 257}, (_, index) => ({
				resourceKey: index.toString(16).padStart(64, '0'),
				fileExtension: 'heic',
			})),
		}),
	).rejects.toMatchObject({code: 'BAD_REQUEST'})
	expect(confirmedBackupResources).not.toHaveBeenCalled()
})

test("lists the signed-in account's backup sources with the server's backup capabilities", async () => {
	const answer = {
		capabilities: ['continue-source'],
		sources: [
			{
				id: '11111111-1111-4111-8111-111111111111',
				name: 'iPhone',
				createdAt: 1,
				lastImportAt: 2,
				lastSeenAt: 3,
				stats: {photos: 1, videos: 0, sizeBytes: 5},
			},
		],
	}
	const backupSources = vi.fn(async () => answer)
	const caller = routes.createCaller(contextFor({}, {backupSources}))

	await expect(caller.backupSources()).resolves.toEqual(answer)
	expect(backupSources).toHaveBeenCalledWith('Alice')
})

test("counts what removing one of the signed-in account's phone backups would move to Trash", async () => {
	const sourceRemovalItemCount = vi.fn(async (_accountId: string, id: string) =>
		id === 'iphone:abc' ? 120 : undefined,
	)
	const caller = routes.createCaller(contextFor({}, {sourceRemovalItemCount}))

	await expect(caller.sources.removalItemCount({id: 'iphone:abc'})).resolves.toBe(120)
	expect(sourceRemovalItemCount).toHaveBeenCalledWith('Alice', 'iphone:abc')
	// Another account's, or the built-in Umbrel source
	await expect(caller.sources.removalItemCount({id: 'umbrel:Alice'})).rejects.toMatchObject({code: 'NOT_FOUND'})
})
