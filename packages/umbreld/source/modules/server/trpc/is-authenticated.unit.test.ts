import {readFile} from 'node:fs/promises'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../../index.ts'
import Auth, {OWNER_ACCOUNT_ID, type Principal} from '../../auth/auth.ts'
import {BROWSER_SESSION_HTTP_COOKIE_NAME} from '../../auth/browser-session-cookie.ts'
import temporaryDirectory from '../../utilities/temporary-directory.ts'

import type {Context} from './context.ts'
import {isAuthenticated, isOwner} from './is-authenticated.ts'

const nativeClient = {
	id: 'umbrel',
	platform: 'ios',
	deviceClass: 'phone',
	appVersion: '0.1',
	appBuild: '20',
	osVersion: '26.6.1',
} as const

describe('tRPC HTTP authentication', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let auth: Auth
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = {
			dataDirectory: await directory.create(),
			isBackupRestoreFirstStart: false,
			user: {exists: async () => true},
		} as Umbreld
		auth = new Auth(umbreld)
		umbreld.auth = auth
		await auth.start()
	})

	afterEach(async () => {
		await auth.stop()
		await directory.destroyRoot()
	})

	function context(authorization: string, browserSessionToken?: string) {
		return {
			umbreld,
			transport: 'express',
			dangerouslyBypassAuthentication: false,
			logger: {error: vi.fn()},
			request: {
				headers: {authorization},
				cookies: browserSessionToken ? {[BROWSER_SESSION_HTTP_COOKIE_NAME]: browserSessionToken} : {},
				secure: false,
			},
		} as unknown as Context
	}

	const next = async (options?: {ctx: {principal: Principal}}) => options?.ctx.principal

	test('accepts matching dashboard and browser credentials', async () => {
		const session = await auth.createSession()
		await expect(
			isAuthenticated({
				ctx: context(`Bearer ${session.dashboardToken}`, session.browserSessionToken),
				next,
			}),
		).resolves.toEqual(session.principal)
	})

	test('accepts native access credentials without a browser credential', async () => {
		const session = await auth.createNativeSession({nativeClient})
		await expect(isAuthenticated({ctx: context(`Bearer ${session.accessToken}`), next})).resolves.toEqual(
			session.principal,
		)
	})

	test('rejects a dashboard token without its browser credential', async () => {
		const session = await auth.createSession()
		await expect(isAuthenticated({ctx: context(`Bearer ${session.dashboardToken}`), next})).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		})
	})

	test('rejects credentials from different sessions', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()
		await expect(
			isAuthenticated({
				ctx: context(`Bearer ${first.dashboardToken}`, second.browserSessionToken),
				next,
			}),
		).rejects.toMatchObject({code: 'UNAUTHORIZED'})
	})

	test('accepts the local system token without a browser credential', async () => {
		const systemToken = await readFile(auth.systemTokenPath, 'utf8')
		await expect(isAuthenticated({ctx: context(`Bearer ${systemToken}`), next})).resolves.toMatchObject({
			actor: 'system',
		})
	})

	test('validates the session principal again for every WebSocket operation', async () => {
		const session = await auth.createSession()
		const wsContext = {
			umbreld,
			transport: 'ws',
			dangerouslyBypassAuthentication: false,
			principal: session.principal,
		} as unknown as Context

		await expect(isAuthenticated({ctx: wsContext, next})).resolves.toEqual(session.principal)
		await auth.revokeSession(session.principal.sessionId)
		await expect(isAuthenticated({ctx: wsContext, next})).rejects.toMatchObject({code: 'UNAUTHORIZED'})
	})

	test('rejects WebSocket operations without an upgrade principal', async () => {
		const wsContext = {
			umbreld,
			transport: 'ws',
			dangerouslyBypassAuthentication: false,
		} as unknown as Context
		await expect(isAuthenticated({ctx: wsContext, next})).rejects.toMatchObject({code: 'UNAUTHORIZED'})
	})

	test('preserves the trusted internal bypass as a system principal', async () => {
		const bypassContext = {
			umbreld,
			transport: 'express',
			dangerouslyBypassAuthentication: true,
		} as unknown as Context
		await expect(isAuthenticated({ctx: bypassContext, next})).resolves.toMatchObject({actor: 'system'})
		await expect(isOwner({ctx: bypassContext, next})).resolves.toMatchObject({
			accountId: OWNER_ACCOUNT_ID,
			actor: 'system',
		})
	})
})
