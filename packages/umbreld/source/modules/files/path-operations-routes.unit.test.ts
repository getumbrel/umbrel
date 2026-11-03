import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

const contextFor = (files: Record<string, unknown>) =>
	({
		umbreld: {
			auth: {validatePrincipal: vi.fn(async () => {})},
			files,
		} as unknown as Umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'Alice', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	}) as unknown as Context

test('path capabilities authorize before exposing operations', async () => {
	const virtualToSystemPath = vi.fn(async () => '/data/members/Alice/home/Documents')
	const getAllowedOperations = vi.fn(async () => ['copy', 'writable'])
	const caller = routes.createCaller(contextFor({virtualToSystemPath, getAllowedOperations}))

	await expect(caller.pathOperations({path: '/Users/Alice/Documents'})).resolves.toEqual(['copy', 'writable'])
	expect(virtualToSystemPath).toHaveBeenCalledWith('/Users/Alice/Documents', 'Alice')
	expect(getAllowedOperations).toHaveBeenCalledWith('/Users/Alice/Documents', 'Alice')
})

test('path capabilities do not inspect an inaccessible path', async () => {
	const virtualToSystemPath = vi.fn(async () => {
		throw new Error('[forbidden]')
	})
	const getAllowedOperations = vi.fn()
	const caller = routes.createCaller(contextFor({virtualToSystemPath, getAllowedOperations}))

	await expect(caller.pathOperations({path: '/Home/Private'})).rejects.toThrow('[forbidden]')
	expect(getAllowedOperations).not.toHaveBeenCalled()
})
