import {once} from 'node:events'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import got, {type Response} from 'got'
import {WebSocket} from 'ws'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

type TestVm = Awaited<ReturnType<typeof createTestVm>>

type BrowserSession = {
	dashboardToken: string
	appCookie: string
	browserCookie: string
	appSetCookie: string
	browserSetCookie: string
	fileToken?: string
}

const password = 'moneyprintergobrrr'
const credentialPattern = /^umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/

describe.sequential('Browser authentication', () => {
	let umbreld: TestVm
	const currentOrigin = () => `http://127.0.0.1:${umbreld.vm.httpPort}`
	let failed = false
	let primary: BrowserSession
	let secondary: BrowserSession
	let trpcSocket: WebSocket | undefined
	let terminalSocket: WebSocket | undefined
	let secondarySocket: WebSocket | undefined

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.signup()
	})

	afterAll(async () => {
		trpcSocket?.terminate()
		terminalSocket?.terminate()
		secondarySocket?.terminate()
		await umbreld?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('login creates separate host-only app and browser credentials', async () => {
		primary = await login('UmbrelPrimary/1.0')

		expect(primary.dashboardToken).toMatch(credentialPattern)
		expect(cookieToken(primary.appCookie)).toMatch(credentialPattern)
		expect(cookieToken(primary.browserCookie)).toMatch(credentialPattern)
		expect(cookieToken(primary.appCookie)).not.toBe(primary.dashboardToken)
		expect(cookieToken(primary.browserCookie)).not.toBe(primary.dashboardToken)
		expect(cookieToken(primary.browserCookie)).not.toBe(cookieToken(primary.appCookie))

		for (const cookie of [primary.appSetCookie, primary.browserSetCookie]) {
			expect(cookie).toContain('; Path=/')
			expect(cookie).toContain('; HttpOnly')
			expect(cookie).toContain('; SameSite=Lax')
			expect(cookie).toContain('; Expires=')
			expect(cookie).not.toContain('; Secure')
			expect(cookie).not.toContain('Domain=')
		}
	})

	test('dashboard tRPC and uploads require both credentials from the same session', async () => {
		secondary = await login('UmbrelSecondary/2.0')

		await expectTrpcStatus('user.get', 200, primary)
		await expectTrpcStatus('user.get', 401, {...primary, browserCookie: ''})
		await expectTrpcStatus('user.get', 401, {...primary, dashboardToken: ''})
		await expectTrpcStatus('user.get', 401, {...primary, browserCookie: secondary.browserCookie})
		await expectTrpcStatus('user.get', 401, {...primary, browserCookie: primary.appCookie})

		const uploadPath = '/Home/auth-vm-paired-upload.txt'
		const pairedUpload = await request(`/api/files/upload?path=${encodeURIComponent(uploadPath)}`, {
			method: 'POST',
			session: primary,
			body: 'paired upload',
		})
		expect(pairedUpload.statusCode).toBe(200)

		const mismatchedUpload = await request('/api/files/upload?path=/Home/auth-vm-mismatch.txt', {
			method: 'POST',
			session: {...primary, browserCookie: secondary.browserCookie},
			body: 'must not upload',
			throwHttpErrors: false,
		})
		expect(mismatchedUpload.statusCode).toBe(401)
		await expect(
			umbreld.vm.ssh('test ! -e /home/umbrel/umbrel/home/auth-vm-mismatch.txt && printf missing'),
		).resolves.toBe('missing')
	})

	test('active sessions expose only account-scoped display metadata and identify the caller', async () => {
		const response = await trpc('user.listSessions', {session: primary})
		const sessions = trpcData<
			Array<{
				id: string
				createdAt: number
				lastSeenAt: number
				client: {type: 'browser'; userAgent?: string}
				current: boolean
			}>
		>(response)

		expect(sessions).toHaveLength(2)
		expect(sessions[0]).toMatchObject({client: {userAgent: 'UmbrelPrimary/1.0'}, current: true})
		expect(sessions[1]).toMatchObject({client: {userAgent: 'UmbrelSecondary/2.0'}, current: false})
		for (const session of sessions) {
			expect(session.id).toMatch(/^[0-9a-f]{32}$/)
			expect(session.createdAt).toBeLessThanOrEqual(Date.now())
			expect(session.lastSeenAt).toBeGreaterThanOrEqual(session.createdAt)
			expect(session.lastSeenAt).toBeLessThanOrEqual(Date.now())
			expect(Object.keys(session).sort()).toEqual(['client', 'createdAt', 'current', 'id', 'lastSeenAt'])
		}

		const unauthenticated = await request('/trpc/user.listSessions', {throwHttpErrors: false})
		expect(unauthenticated.statusCode).toBe(401)
	})

	test('file, log, and CA reads use the stable URL token plus browser cookie', async () => {
		const fileTokenResponse = await trpc('user.getHttpApiToken', {session: primary})
		expect(fileTokenResponse.statusCode).toBe(200)
		expect(fileTokenResponse.headers['cache-control']).toBe('no-store')
		primary.fileToken = trpcData<string>(fileTokenResponse)
		expect(primary.fileToken).toMatch(credentialPattern)

		const secondaryTokenResponse = await trpc('user.getHttpApiToken', {session: secondary})
		secondary.fileToken = trpcData<string>(secondaryTokenResponse)

		const filePath = encodeURIComponent('/Home/auth-vm-paired-upload.txt')
		const view = await request(`/api/files/view?path=${filePath}&token=${primary.fileToken}`, {
			cookie: primary.browserCookie,
			responseType: 'text',
		})
		expect(view.body).toBe('paired upload')
		expect(view.headers['referrer-policy']).toBe('no-referrer')

		const ca = await request(`/lan-ingress/umbrel-local-ca.crt?token=${primary.fileToken}`, {
			cookie: primary.browserCookie,
			responseType: 'text',
		})
		expect(ca.body).toContain('BEGIN CERTIFICATE')
		expect(ca.headers['content-type']).toBe('application/x-x509-ca-cert')
		expect(ca.headers['referrer-policy']).toBe('no-referrer')

		const logs = await request(`/logs?token=${primary.fileToken}`, {
			cookie: primary.browserCookie,
			responseType: 'buffer',
		})
		expect(logs.statusCode).toBe(200)
		expect(logs.headers['content-disposition']).toMatch(/^attachment;filename=umbrel-\d+\.log\.gz$/)
		expect([...logs.rawBody.subarray(0, 2)]).toEqual([0x1f, 0x8b])

		const readPath = `/api/files/view?path=${filePath}&token=${primary.fileToken}`
		expect((await request(readPath, {responseType: 'text', throwHttpErrors: false})).statusCode).toBe(401)
		expect(
			(await request(`/api/files/view?path=${filePath}`, {cookie: primary.browserCookie, throwHttpErrors: false}))
				.statusCode,
		).toBe(401)
		expect(
			(
				await request(`/api/files/view?path=${filePath}&token=${secondary.fileToken}`, {
					cookie: primary.browserCookie,
					throwHttpErrors: false,
				})
			).statusCode,
		).toBe(401)
		expect(
			(
				await request(`/api/files/view?path=${filePath}`, {
					session: primary,
					throwHttpErrors: false,
				})
			).statusCode,
		).toBe(401)
	})

	test('the system credential remains a cookie-free exception for trusted local clients', async () => {
		const systemToken = (await umbreld.vm.sshAsRoot('cat /home/umbrel/umbrel/secrets/auth/system-token')).trim()
		expect(systemToken).toMatch(/^[0-9a-f]{64}$/)

		const user = await request('/trpc/user.get', {authorization: systemToken, responseType: 'json'})
		expect(trpcData<{name: string}>(user).name).toBe('satoshi')

		const upload = await request('/api/files/upload?path=/Home/auth-vm-system-upload.txt', {
			method: 'POST',
			authorization: systemToken,
			body: 'system upload',
		})
		expect(upload.statusCode).toBe(200)

		const view = await request('/api/files/view?path=/Home/auth-vm-system-upload.txt', {
			authorization: systemToken,
			responseType: 'text',
		})
		expect(view.body).toBe('system upload')

		const ca = await request('/lan-ingress/umbrel-local-ca.crt', {
			authorization: systemToken,
			responseType: 'text',
		})
		expect(ca.body).toContain('BEGIN CERTIFICATE')
	})

	test('renewal keeps every credential stable and extends only matching cookies', async () => {
		const originalAppExpiry = cookieExpiry(primary.appSetCookie)
		const originalBrowserExpiry = cookieExpiry(primary.browserSetCookie)
		const lastSeenBefore = trpcData<Array<{current: boolean; lastSeenAt: number}>>(
			await trpc('user.listSessions', {session: primary}),
		).find((session) => session.current)?.lastSeenAt
		await new Promise((resolve) => setTimeout(resolve, 1100))

		const renewal = await trpc('user.renewToken', {method: 'POST', session: primary, includeAppCookie: true})
		expect(trpcData<string>(renewal)).toBe(primary.dashboardToken)
		const renewedCookies = renewal.headers['set-cookie'] ?? []
		const renewedApp = requiredCookie(renewedCookies, 'UMBREL_APP_SESSION')
		const renewedBrowser = requiredCookie(renewedCookies, 'UMBREL_BROWSER_SESSION')
		expect(serializedCookie(renewedApp)).toBe(primary.appCookie)
		expect(serializedCookie(renewedBrowser)).toBe(primary.browserCookie)
		expect(cookieExpiry(renewedApp).getTime()).toBeGreaterThan(originalAppExpiry.getTime())
		expect(cookieExpiry(renewedBrowser).getTime()).toBeGreaterThan(originalBrowserExpiry.getTime())
		const lastSeenAfter = trpcData<Array<{current: boolean; lastSeenAt: number}>>(
			await trpc('user.listSessions', {session: primary}),
		).find((session) => session.current)?.lastSeenAt
		expect(lastSeenAfter).toBeGreaterThan(lastSeenBefore!)

		const fileTokenAfter = trpcData<string>(await trpc('user.getHttpApiToken', {session: primary}))
		expect(fileTokenAfter).toBe(primary.fileToken)

		const concurrent = await Promise.all([
			trpc('user.renewToken', {method: 'POST', session: primary, includeAppCookie: true}),
			trpc('user.renewToken', {method: 'POST', session: primary, includeAppCookie: true}),
		])
		expect(concurrent.map((response) => trpcData<string>(response))).toEqual([
			primary.dashboardToken,
			primary.dashboardToken,
		])

		const mismatchedBrowser = await trpc('user.renewToken', {
			method: 'POST',
			session: {...primary, browserCookie: secondary.browserCookie},
			throwHttpErrors: false,
		})
		expect(mismatchedBrowser.statusCode).toBe(401)

		const mismatchedApp = await trpc('user.renewToken', {
			method: 'POST',
			session: primary,
			cookie: `${primary.browserCookie}; ${secondary.appCookie}`,
		})
		expect(mismatchedApp.statusCode).toBe(200)
		expect((mismatchedApp.headers['set-cookie'] ?? []).some((cookie) => cookie.startsWith('UMBREL_APP_SESSION='))).toBe(
			false,
		)
		expect(
			(mismatchedApp.headers['set-cookie'] ?? []).some((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION=')),
		).toBe(true)
	})

	test('all session credentials survive an umbreld restart', async () => {
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.waitForStartup({waitForUser: true})

		await expectTrpcStatus('user.get', 200, primary)
		const fileTokenAfter = trpcData<string>(await trpc('user.getHttpApiToken', {session: primary}))
		expect(fileTokenAfter).toBe(primary.fileToken)
		const ca = await request(`/lan-ingress/umbrel-local-ca.crt?token=${primary.fileToken}`, {
			cookie: primary.browserCookie,
			responseType: 'text',
		})
		expect(ca.body).toContain('BEGIN CERTIFICATE')

		const sessions = trpcData<Array<{client: {type: 'browser'; userAgent?: string}; current: boolean}>>(
			await trpc('user.listSessions', {session: primary}),
		)
		expect(sessions).toEqual([
			expect.objectContaining({client: {type: 'browser', userAgent: 'UmbrelPrimary/1.0'}, current: true}),
			expect.objectContaining({client: {type: 'browser', userAgent: 'UmbrelSecondary/2.0'}, current: false}),
		])
	})

	test('real tRPC and terminal WebSockets require a single-use ticket from the paired session', async () => {
		const tokenOnlyTicket = await trpc('user.createWebSocketTicket', {
			method: 'POST',
			session: {...primary, browserCookie: ''},
			input: {target: 'trpc'},
			throwHttpErrors: false,
		})
		expect(tokenOnlyTicket.statusCode).toBe(401)
		const mismatchedTicket = await trpc('user.createWebSocketTicket', {
			method: 'POST',
			session: {...primary, browserCookie: secondary.browserCookie},
			input: {target: 'trpc'},
			throwHttpErrors: false,
		})
		expect(mismatchedTicket.statusCode).toBe(401)

		const trpcTicket = trpcData<string>(
			await trpc('user.createWebSocketTicket', {method: 'POST', session: primary, input: {target: 'trpc'}}),
		)
		trpcSocket = await openWebSocket(`/trpc?ticket=${encodeURIComponent(trpcTicket)}`)
		await expectWebSocketRejected(`/trpc?ticket=${encodeURIComponent(trpcTicket)}`)
		await expectWebSocketRejected('/trpc')
		await expectWebSocketRejected('/trpc?ticket=invalid')

		const terminalTicket = trpcData<string>(
			await trpc('user.createWebSocketTicket', {method: 'POST', session: primary, input: {target: 'terminal'}}),
		)
		terminalSocket = await openWebSocket(
			`/terminal?rows=24&cols=80&appId=&ticket=${encodeURIComponent(terminalTicket)}`,
		)
	})

	test('individual revocation closes the target session while preserving the caller', async () => {
		const secondaryTicket = trpcData<string>(
			await trpc('user.createWebSocketTicket', {method: 'POST', session: secondary, input: {target: 'trpc'}}),
		)
		secondarySocket = await openWebSocket(`/trpc?ticket=${encodeURIComponent(secondaryTicket)}`)
		const secondaryClosed = once(secondarySocket, 'close')
		const sessions = trpcData<Array<{id: string; client: {type: 'browser'; userAgent?: string}}>>(
			await trpc('user.listSessions', {session: primary}),
		)
		const secondaryId = sessions.find((session) => session.client.userAgent === 'UmbrelSecondary/2.0')?.id
		if (!secondaryId) throw new Error('Secondary session was not listed')
		expect(secondaryId).toMatch(/^[0-9a-f]{32}$/)

		const revoked = trpcData<{revoked: boolean; revokedCurrent: boolean}>(
			await trpc('user.revokeSession', {method: 'POST', session: primary, input: {sessionId: secondaryId}}),
		)
		expect(revoked).toEqual({revoked: true, revokedCurrent: false})
		await secondaryClosed
		await expectTrpcStatus('user.get', 401, secondary)
		await expectTrpcStatus('user.get', 200, primary)
		expect(
			trpcData<Array<{client: {type: 'browser'; userAgent?: string}}>>(
				await trpc('user.listSessions', {session: primary}),
			).map((session) => session.client.userAgent),
		).toEqual(['UmbrelPrimary/1.0'])
	})

	test('revoking other sessions preserves only the caller and tears down their connections', async () => {
		secondary = await login('UmbrelSecondaryAgain/3.0')
		const third = await login('UmbrelThird/4.0')
		const secondaryTicket = trpcData<string>(
			await trpc('user.createWebSocketTicket', {method: 'POST', session: secondary, input: {target: 'trpc'}}),
		)
		secondarySocket = await openWebSocket(`/trpc?ticket=${encodeURIComponent(secondaryTicket)}`)
		const secondaryClosed = once(secondarySocket, 'close')

		const result = trpcData<{revokedCount: number}>(
			await trpc('user.revokeOtherSessions', {method: 'POST', session: primary}),
		)
		expect(result).toEqual({revokedCount: 2})
		await secondaryClosed
		await expectTrpcStatus('user.get', 200, primary)
		await expectTrpcStatus('user.get', 401, secondary)
		await expectTrpcStatus('user.get', 401, third)
		expect(trpcData<Array<{current: boolean}>>(await trpc('user.listSessions', {session: primary}))).toEqual([
			expect.objectContaining({current: true}),
		])
	})

	test('revoking the current session clears local cookies and invalidates every credential in it', async () => {
		const self = await login('UmbrelSelfRevoke/5.0')
		const selfSessions = trpcData<Array<{id: string; current: boolean}>>(
			await trpc('user.listSessions', {session: self}),
		)
		const selfId = selfSessions.find((session) => session.current)?.id
		if (!selfId) throw new Error('Current session was not listed')
		expect(selfId).toMatch(/^[0-9a-f]{32}$/)

		const response = await trpc('user.revokeSession', {
			method: 'POST',
			session: self,
			includeAppCookie: true,
			input: {sessionId: selfId},
		})
		expect(trpcData<{revoked: boolean; revokedCurrent: boolean}>(response)).toEqual({
			revoked: true,
			revokedCurrent: true,
		})
		expectClearedSessionCookies(response)
		await expectTrpcStatus('user.get', 401, self)
	})

	test('a full logout closes live sockets and revokes every session audience but the system credential', async () => {
		// The individual flows are asserted above; this test only cares about the end
		// state after the full logout the sessions UI composes: "log out other
		// devices" followed by revoking the current session.
		secondary = await login('UmbrelFinalSecondary/6.0')
		const trpcClosed = once(trpcSocket!, 'close')
		const terminalClosed = once(terminalSocket!, 'close')

		await trpc('user.revokeOtherSessions', {method: 'POST', session: primary})
		const primarySessions = trpcData<Array<{id: string; current: boolean}>>(
			await trpc('user.listSessions', {session: primary}),
		)
		const primaryId = primarySessions.find((session) => session.current)?.id
		if (!primaryId) throw new Error('Current session was not listed')
		const logout = await trpc('user.revokeSession', {
			method: 'POST',
			session: primary,
			includeAppCookie: true,
			input: {sessionId: primaryId},
		})
		await Promise.all([trpcClosed, terminalClosed])
		expectClearedSessionCookies(logout)

		await expectTrpcStatus('user.get', 401, primary)
		await expectTrpcStatus('user.get', 401, secondary)
		expect(
			(
				await request(`/lan-ingress/umbrel-local-ca.crt?token=${primary.fileToken}`, {
					cookie: primary.browserCookie,
					throwHttpErrors: false,
				})
			).statusCode,
		).toBe(401)

		const appSession = await request('/app-auth/v1/account/session?origin=host&app=missing-app&path=%2F', {
			cookie: primary.appCookie,
			throwHttpErrors: false,
		})
		expect(appSession.statusCode).toBe(401)

		const systemToken = (await umbreld.vm.sshAsRoot('cat /home/umbrel/umbrel/secrets/auth/system-token')).trim()
		const systemRequest = await request('/trpc/user.get', {authorization: systemToken, responseType: 'json'})
		expect(trpcData<{name: string}>(systemRequest).name).toBe('satoshi')
	})

	async function login(userAgent = 'UmbrelTest/1.0') {
		const response = await request('/trpc/user.login', {
			method: 'POST',
			json: {password},
			userAgent,
			responseType: 'json',
		})
		const cookies = response.headers['set-cookie'] ?? []
		const appSetCookie = requiredCookie(cookies, 'UMBREL_APP_SESSION')
		const browserSetCookie = requiredCookie(cookies, 'UMBREL_BROWSER_SESSION')
		return {
			dashboardToken: trpcData<string>(response),
			appCookie: serializedCookie(appSetCookie),
			browserCookie: serializedCookie(browserSetCookie),
			appSetCookie,
			browserSetCookie,
		}
	}

	async function expectTrpcStatus(path: string, status: number, session: BrowserSession) {
		const response = await trpc(path, {session, throwHttpErrors: false})
		expect(response.statusCode).toBe(status)
	}

	async function trpc(
		path: string,
		{
			method = 'GET',
			session,
			includeAppCookie = false,
			cookie,
			input,
			throwHttpErrors = true,
		}: {
			method?: 'GET' | 'POST'
			session: BrowserSession
			includeAppCookie?: boolean
			cookie?: string
			input?: unknown
			throwHttpErrors?: boolean
		},
	): Promise<Response<any>> {
		return request(`/trpc/${path}`, {
			method,
			session,
			json: method === 'POST' ? (input ?? null) : undefined,
			cookie:
				cookie ??
				[session.browserCookie, includeAppCookie ? session.appCookie : ''].filter((value) => value).join('; '),
			responseType: 'json',
			throwHttpErrors,
		})
	}

	async function request(
		path: string,
		{
			method = 'GET',
			session,
			authorization = session?.dashboardToken,
			cookie = session?.browserCookie,
			body,
			json,
			userAgent,
			responseType = 'json',
			throwHttpErrors = true,
		}: {
			method?: 'GET' | 'POST'
			session?: BrowserSession
			authorization?: string
			cookie?: string
			body?: string
			json?: unknown
			userAgent?: string
			responseType?: 'json' | 'text' | 'buffer'
			throwHttpErrors?: boolean
		} = {},
	): Promise<Response<any>> {
		return got(`${currentOrigin()}${path}`, {
			method,
			headers: {
				...(authorization ? {authorization: `Bearer ${authorization}`} : {}),
				...(cookie ? {cookie} : {}),
				...(userAgent ? {'user-agent': userAgent} : {}),
			},
			body,
			json,
			responseType,
			throwHttpErrors,
			retry: {limit: 0},
		}) as Promise<Response<any>>
	}

	function expectClearedSessionCookies(response: Response<unknown>) {
		const clearedCookies = response.headers['set-cookie'] ?? []
		for (const name of [
			'UMBREL_APP_SESSION',
			'__Host-UMBREL_APP_SESSION_HTTPS',
			'UMBREL_BROWSER_SESSION',
			'__Host-UMBREL_BROWSER_SESSION_HTTPS',
		]) {
			const cookie = requiredCookie(clearedCookies, name)
			expect(serializedCookie(cookie)).toBe(`${name}=`)
			expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
		}
	}

	async function openWebSocket(path: string) {
		return new Promise<WebSocket>((resolve, reject) => {
			const socket = new WebSocket(`${currentOrigin().replace('http:', 'ws:')}${path}`)
			const timeout = setTimeout(() => {
				socket.terminate()
				reject(new Error(`Timed out opening ${path}`))
			}, 5000)
			socket.once('open', () => {
				clearTimeout(timeout)
				resolve(socket)
			})
			socket.once('error', (error) => {
				clearTimeout(timeout)
				reject(error)
			})
		})
	}

	async function expectWebSocketRejected(path: string) {
		await expect(
			new Promise<void>((resolve, reject) => {
				const socket = new WebSocket(`${currentOrigin().replace('http:', 'ws:')}${path}`)
				const timeout = setTimeout(() => {
					socket.terminate()
					reject(new Error(`Unauthorized WebSocket remained open for ${path}`))
				}, 5000)
				socket.once('open', () => {
					clearTimeout(timeout)
					socket.terminate()
					reject(new Error(`Unauthorized WebSocket opened for ${path}`))
				})
				socket.once('error', () => {
					clearTimeout(timeout)
					resolve()
				})
				socket.once('close', () => {
					clearTimeout(timeout)
					resolve()
				})
			}),
		).resolves.toBeUndefined()
	}
})

function trpcData<T>(response: Response<unknown>) {
	return (response.body as {result?: {data?: T}}).result?.data as T
}

function requiredCookie(cookies: string[], name: string) {
	const cookie = cookies.find((value) => value.startsWith(`${name}=`))
	if (!cookie) throw new Error(`Missing ${name} cookie`)
	return cookie
}

function serializedCookie(setCookie: string) {
	return setCookie.split(';')[0]!
}

function cookieToken(cookie: string) {
	return cookie.slice(cookie.indexOf('=') + 1)
}

function cookieExpiry(cookie: string) {
	const expires = cookie
		.split(';')
		.map((value) => value.trim())
		.find((value) => value.startsWith('Expires='))
	if (!expires) throw new Error('Cookie has no expiry')
	return new Date(expires.slice('Expires='.length))
}
