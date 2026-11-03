import {readFile} from 'node:fs/promises'

import {afterEach, beforeEach, expect, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.ts'
import * as totp from '../utilities/totp.ts'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let dashboardToken = ''

const credentials = {name: 'satoshi', password: 'moneyprintergobrrr'}
const nativeClient = {
	id: 'umbrel',
	platform: 'ios',
	deviceClass: 'phone',
	appVersion: '0.1',
	appBuild: '20',
	osVersion: '26.6.1',
} as const

function trpcResult<T>(body: unknown) {
	return (body as {result?: {data?: T}}).result?.data
}

beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.signup()
	dashboardToken = await umbreld.client.user.login.mutate(credentials)
	umbreld.setAuthToken(dashboardToken)
})

afterEach(async () => await umbreld?.cleanup())

test('dashboard tRPC and uploads require the matching token and browser cookie', async () => {
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})

	const tokenOnly = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(tokenOnly.statusCode).toBe(401)

	const cookieOnly = await umbreld.browserApi.get('../trpc/user.get', {throwHttpErrors: false})
	expect(cookieOnly.statusCode).toBe(401)

	const tokenOnlyUpload = await umbreld.unauthenticatedApi.post('files/upload?path=/Home/token-only.txt', {
		body: 'must not upload',
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(tokenOnlyUpload.statusCode).toBe(401)

	await expect(
		umbreld.api.post('files/upload?path=/Home/paired-upload.txt', {body: 'paired upload'}),
	).resolves.toMatchObject({statusCode: 200})
})

test('file reads require the stable file token and matching browser cookie', async () => {
	await umbreld.api.post('files/upload?path=/Home/file-auth.txt', {body: 'private file'})
	const fileToken = await umbreld.client.user.getHttpApiToken.query()
	const path = `files/view?path=${encodeURIComponent('/Home/file-auth.txt')}`

	const paired = await umbreld.browserApi.get(`${path}&token=${fileToken}`, {responseType: 'text'})
	expect(paired.body).toBe('private file')

	const tokenOnly = await umbreld.unauthenticatedApi.get(`${path}&token=${fileToken}`, {throwHttpErrors: false})
	expect(tokenOnly.statusCode).toBe(401)
	const cookieOnly = await umbreld.browserApi.get(path, {throwHttpErrors: false})
	expect(cookieOnly.statusCode).toBe(401)
	const dashboardCredentials = await umbreld.browserApi.get(path, {
		headers: {Authorization: `Bearer ${dashboardToken}`},
		throwHttpErrors: false,
	})
	expect(dashboardCredentials.statusCode).toBe(401)

	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: credentials})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	expect(secondDashboardToken).toBeTypeOf('string')
	expect(secondBrowserCookie).toBeTypeOf('string')
	const secondTokenResponse = await umbreld.unauthenticatedApi.get('../trpc/user.getHttpApiToken', {
		headers: {
			Authorization: `Bearer ${secondDashboardToken}`,
			cookie: secondBrowserCookie!,
		},
	})
	const secondFileToken = trpcResult<string>(secondTokenResponse.body)
	expect(secondFileToken).toBeTypeOf('string')
	const mismatched = await umbreld.browserApi.get(`${path}&token=${secondFileToken}`, {throwHttpErrors: false})
	expect(mismatched.statusCode).toBe(401)

	const renewedDashboardToken = await umbreld.client.user.renewToken.mutate()
	expect(renewedDashboardToken).toBe(dashboardToken)
	umbreld.setAuthToken(renewedDashboardToken)
	await expect(umbreld.client.user.getHttpApiToken.query()).resolves.toBe(fileToken)
})

test('the local system token remains cookie-free for trusted internal clients', async () => {
	const systemToken = await readFile(umbreld.instance.auth.systemTokenPath, 'utf8')
	const user = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${systemToken}`},
	})
	expect(trpcResult<{name: string}>(user.body)).toMatchObject({name: credentials.name})

	const upload = await umbreld.unauthenticatedApi.post('files/upload?path=/Home/system-upload.txt', {
		body: 'system upload',
		headers: {Authorization: `Bearer ${systemToken}`},
	})
	expect(upload.statusCode).toBe(200)
	const view = await umbreld.unauthenticatedApi.get('files/view?path=/Home/system-upload.txt', {
		headers: {Authorization: `Bearer ${systemToken}`},
		responseType: 'text',
	})
	expect(view.body).toBe('system upload')
})

test('session management lists metadata and account-scoped revocation invalidates the selected login', async () => {
	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {
		json: credentials,
		headers: {'user-agent': 'UmbrelIntegrationSecondary/1.0'},
	})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	if (!secondDashboardToken || !secondBrowserCookie) throw new Error('Second login did not return all credentials')

	const sessions = await umbreld.client.user.listSessions.query()
	const current = sessions.find((session) => session.current)
	const second = sessions.find(
		(session) => session.client.type === 'browser' && session.client.userAgent === 'UmbrelIntegrationSecondary/1.0',
	)
	expect(current).toBeDefined()
	expect(second).toMatchObject({current: false})
	expect(Object.keys(second!).sort()).toEqual(['client', 'createdAt', 'current', 'id', 'lastSeenAt'])

	await expect(umbreld.client.user.revokeSession.mutate({sessionId: second!.id})).resolves.toEqual({
		revoked: true,
		revokedCurrent: false,
	})
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})
	const revokedRequest = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		throwHttpErrors: false,
	})
	expect(revokedRequest.statusCode).toBe(401)
})

test('normal logout revokes only the browser session making the request', async () => {
	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: credentials})
	const secondDashboardToken = trpcResult<string>(secondLogin.body)
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	if (!secondDashboardToken || !secondBrowserCookie) throw new Error('Second login did not return all credentials')

	await expect(
		umbreld.unauthenticatedApi.post('../trpc/user.logout', {
			json: null,
			headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		}),
	).resolves.toMatchObject({statusCode: 200})

	const loggedOutRequest = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${secondDashboardToken}`, cookie: secondBrowserCookie},
		throwHttpErrors: false,
	})
	expect(loggedOutRequest.statusCode).toBe(401)
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})
})

test('native login refreshes and revokes access without weakening browser sessions', async () => {
	type NativeSession = {
		accountId: string
		accessToken: string
		accessExpiresAt: number
		deviceToken: string
	}
	const login = await umbreld.unauthenticatedApi.post('../trpc/user.loginNative', {
		json: {...credentials, client: nativeClient},
		headers: {'user-agent': 'UmbrelNativeIntegration/1.0'},
	})
	const native = trpcResult<NativeSession>(login.body)
	if (!native) throw new Error('Native login did not return credentials')
	expect(login.headers['cache-control']).toBe('no-store')
	expect(native.accountId).toBe('0')

	const nativeUser = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${native.accessToken}`},
	})
	expect(trpcResult<{name: string}>(nativeUser.body)).toMatchObject({name: credentials.name})
	const sourceId = '11111111-1111-4111-8111-111111111111'
	type PhotoBackupGrant = {
		token: string
		source: {id: string; accountId: string; name: string}
	}
	const grantResponse = await umbreld.unauthenticatedApi.post('../trpc/photos.createBackupGrant', {
		json: {sourceId, suggestedName: "Nate's iPhone"},
		headers: {Authorization: `Bearer ${native.accessToken}`},
	})
	const grant = trpcResult<PhotoBackupGrant>(grantResponse.body)
	if (!grant) throw new Error('Photo backup grant was not returned')
	expect(grantResponse.headers['cache-control']).toBe('no-store')
	expect(grant.source).toMatchObject({id: sourceId, accountId: '0', name: "Nate's iPhone"})
	await expect(umbreld.instance.auth.authenticatePhotoBackupGrant(grant.token)).resolves.toMatchObject({sourceId})
	await expect(
		umbreld.client.photos.createBackupGrant.mutate({sourceId, suggestedName: 'Browser source'}),
	).rejects.toThrow('Native session required')
	await expect(umbreld.client.photos.revokeBackupGrant.mutate()).rejects.toThrow('Native session required')
	const browserRenewalWithNativeAccess = await umbreld.unauthenticatedApi.post('../trpc/user.renewToken', {
		json: null,
		headers: {Authorization: `Bearer ${native.accessToken}`},
		throwHttpErrors: false,
	})
	expect(browserRenewalWithNativeAccess.statusCode).toBe(403)
	const browserFileTokenWithNativeAccess = await umbreld.unauthenticatedApi.get('../trpc/user.getHttpApiToken', {
		headers: {Authorization: `Bearer ${native.accessToken}`},
		throwHttpErrors: false,
	})
	expect(browserFileTokenWithNativeAccess.statusCode).toBe(403)
	const webSocketTicketWithNativeAccess = await umbreld.unauthenticatedApi.post('../trpc/user.createWebSocketTicket', {
		json: {target: 'trpc'},
		headers: {Authorization: `Bearer ${native.accessToken}`},
		throwHttpErrors: false,
	})
	expect(webSocketTicketWithNativeAccess.statusCode).toBe(403)

	const refresh = await umbreld.unauthenticatedApi.post('../trpc/user.refreshNativeAccess', {
		json: {deviceToken: native.deviceToken, client: nativeClient},
	})
	const renewed = trpcResult<Pick<NativeSession, 'accessToken' | 'accessExpiresAt'>>(refresh.body)
	if (!renewed) throw new Error('Native refresh did not return credentials')
	expect(refresh.headers['cache-control']).toBe('no-store')
	expect(renewed.accessToken).not.toBe(native.accessToken)
	const refreshRetry = await umbreld.unauthenticatedApi.post('../trpc/user.refreshNativeAccess', {
		json: {deviceToken: native.deviceToken, client: nativeClient},
	})
	const retried = trpcResult<Pick<NativeSession, 'accessToken' | 'accessExpiresAt'>>(refreshRetry.body)
	if (!retried) throw new Error('Native refresh retry did not return credentials')
	expect(retried.accessToken).not.toBe(renewed.accessToken)
	const oldAccess = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${native.accessToken}`},
		throwHttpErrors: false,
	})
	expect(oldAccess.statusCode).toBe(401)

	await umbreld.unauthenticatedApi.post('../trpc/user.logout', {
		json: null,
		headers: {Authorization: `Bearer ${retried.accessToken}`},
	})
	const revokedAccess = await umbreld.unauthenticatedApi.get('../trpc/user.get', {
		headers: {Authorization: `Bearer ${retried.accessToken}`},
		throwHttpErrors: false,
	})
	expect(revokedAccess.statusCode).toBe(401)
	await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: credentials.name})
})

test('native login preserves the HTTP 401 and message used to request a 2FA code', async () => {
	const totpUri = await umbreld.client.user.generateTotpUri.query()
	await umbreld.client.user.enable2fa.mutate({totpUri, totpToken: totp.generateToken(totpUri)})

	const response = await umbreld.unauthenticatedApi.post('../trpc/user.loginNative', {
		json: {userId: '0', password: credentials.password, client: nativeClient},
		throwHttpErrors: false,
	})

	expect(response.statusCode).toBe(401)
	expect(response.body).toMatchObject({error: {message: 'Missing 2FA code'}})
})
