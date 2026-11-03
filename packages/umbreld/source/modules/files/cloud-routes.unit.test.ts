import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

test('Cloud routes reject requests until protection and runtime startup complete', async () => {
	const cloud = {
		assertReady: vi.fn(() => {
			throw new Error('[cloud-not-ready]')
		}),
		getProviders: vi.fn(),
		create: vi.fn(),
	}
	const umbreld = {
		auth: {validatePrincipal: vi.fn(async () => {})},
		files: {cloud},
	} as unknown as Umbreld
	const context = {
		umbreld,
		transport: 'ws',
		principal: {sessionId: 'owner-session', accountId: '0', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context
	const caller = routes.createCaller(context)

	await expect(caller.cloud.providers()).rejects.toThrow('[cloud-not-ready]')
	await expect(
		caller.cloud.create({
			accountId: '11111111-1111-4111-8111-111111111111',
			remote: {path: ''},
			destination: {path: '/Home/Cloud'},
			mode: 'auto',
		}),
	).rejects.toThrow('[cloud-not-ready]')

	expect(cloud.getProviders).not.toHaveBeenCalled()
	expect(cloud.create).not.toHaveBeenCalled()
})
