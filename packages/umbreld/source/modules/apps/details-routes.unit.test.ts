import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import {apps as routes} from './routes.ts'

function callerFor(app: Record<string, unknown>, getDependents = vi.fn(async () => ['electrs'])) {
	const context = {
		umbreld: {} as Umbreld,
		apps: {getApp: vi.fn(() => app), getDependents},
		transport: 'express',
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: true,
	} as unknown as Context
	return {caller: routes.createCaller(context), getDependents}
}

test('app details resolves app-owned metadata, credentials, disk usage and dependents', async () => {
	const app = {
		id: 'bitcoin',
		state: 'ready',
		stateProgress: 100,
		readManifest: vi.fn(async () => ({
			name: 'Bitcoin Core',
			version: '28.0',
			tagline: 'Run Bitcoin',
			description: 'A node',
			port: 8332,
			path: 'dashboard',
			requiresHttps: true,
			defaultUsername: 'umbrel',
			defaultPassword: 'default',
			deterministicPassword: true,
		})),
		getDiskUsage: vi.fn(async () => 123),
		deriveDeterministicPassword: vi.fn(async () => 'derived'),
	}
	const {caller, getDependents} = callerFor(app)

	await expect(caller.details({appId: 'bitcoin'})).resolves.toStrictEqual({
		id: 'bitcoin',
		name: 'Bitcoin Core',
		version: '28.0',
		tagline: 'Run Bitcoin',
		description: 'A node',
		state: 'ready',
		progress: 100,
		port: 8332,
		path: 'dashboard',
		requiresHttps: true,
		credentials: {username: 'umbrel', password: 'derived'},
		diskUsage: 123,
		dependents: ['electrs'],
	})
	expect(getDependents).toHaveBeenCalledWith('bitcoin')
})

test('app logs forward the optional output bound to the app module', async () => {
	const getLogs = vi.fn(async () => 'logs')
	const {caller} = callerFor({getLogs})

	await expect(caller.logs({appId: 'bitcoin', maxOutputBytes: 64_000})).resolves.toBe('logs')
	expect(getLogs).toHaveBeenCalledWith(64_000)
})
