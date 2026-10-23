import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import type {CloudSyncActivity} from './cloud-types.ts'
import routes from './routes.ts'

test('Cloud activity snapshots are scoped to the authenticated account', async () => {
	const activity: CloudSyncActivity = {
		syncId: '11111111-1111-4111-8111-111111111111',
		bytesPerSecond: 10,
		transferredFiles: 1,
		transferredBytes: 20,
	}
	const getActivity = vi.fn(() => [activity])
	const assertReady = vi.fn()
	const context = {
		umbreld: {
			auth: {validatePrincipal: vi.fn(async () => {})},
			files: {cloud: {assertReady, getActivity}},
		} as unknown as Umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'Alice', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context

	const caller = routes.createCaller(context)

	await expect(caller.cloud.activity()).resolves.toEqual([activity])
	expect(assertReady).toHaveBeenCalled()
	expect(getActivity).toHaveBeenCalledWith('Alice')
})
