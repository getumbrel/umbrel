import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

test('exposes the index rebuild as an owner-only mutation', async () => {
	const rebuild = vi.fn(async () => {})
	const caller = routes.createCaller({
		umbreld: {files: {fileIndex: {rebuild}}} as unknown as Umbreld,
		transport: 'express',
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: true,
	} as unknown as Context)

	await expect(caller.rebuildIndex()).resolves.toStrictEqual({status: 'rebuilding'})
	expect(rebuild).toHaveBeenCalledOnce()
})

test('does not allow members to rebuild the global index', async () => {
	const rebuild = vi.fn(async () => {})
	const caller = routes.createCaller({
		umbreld: {
			auth: {validatePrincipal: vi.fn(async () => {})},
			files: {fileIndex: {rebuild}},
		} as unknown as Umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'member', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context)

	await expect(caller.rebuildIndex()).rejects.toMatchObject({code: 'FORBIDDEN'})
	expect(rebuild).not.toHaveBeenCalled()
})
