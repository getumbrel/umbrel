import {createHash} from 'node:crypto'
import {inspect} from 'node:util'
import type {Input, Options} from 'ky'
import {describe, expect, test} from 'vitest'

import CloudAuth, {CLOUD_OAUTH_SCOPES, OAUTH_SESSION_LIFETIME, type OAuthSession} from './cloud-auth.ts'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const NOW = 1_720_000_000_000

const ENVIRONMENT = {
	UMBREL_OAUTH_PROXY_URL: 'https://proxy.example/base',
	UMBREL_CLOUD_GOOGLE_CLIENT_ID: 'google-client',
	UMBREL_CLOUD_GOOGLE_CLIENT_SECRET: 'google-secret',
	UMBREL_CLOUD_DROPBOX_CLIENT_ID: 'dropbox-client',
	UMBREL_CLOUD_DROPBOX_CLIENT_SECRET: 'dropbox-secret',
	UMBREL_CLOUD_ONEDRIVE_CLIENT_ID: 'onedrive-client',
	UMBREL_CLOUD_ONEDRIVE_CLIENT_SECRET: 'ignored-onedrive-secret',
}

type ConfigCall = {method: string; parameters: Record<string, unknown>}
type AuthFetch = (input: Input, init?: RequestInit) => Promise<Response>

const createTransaction = (outputs: Record<string, unknown>[] = []) => {
	const calls: ConfigCall[] = []
	return {
		calls,
		transaction: {
			accountId: ACCOUNT_ID,
			configPath: '/tmp/cloud-test.conf',
			async call<T = Record<string, never>>(method: string, parameters: Record<string, unknown> = {}) {
				calls.push({method, parameters})
				return (outputs.shift() ?? {}) as T
			},
		},
	}
}

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})

const fetchResponse =
	(response: Response): AuthFetch =>
	async (input) => {
		if (input instanceof Request && input.body) await input.text()
		return response
	}

const createHarness = (fetch: AuthFetch = async () => jsonResponse({})) => {
	const browseCalls: Record<string, unknown>[] = []
	const rclone = {
		async browse(parameters: Record<string, unknown>) {
			browseCalls.push(parameters)
			return {entries: [], truncated: false}
		},
		getAccountPaths(accountId: string) {
			return {config: `/tmp/${accountId}.conf`}
		},
	}
	return {
		auth: new CloudAuth({rclone, fetch, now: () => NOW, environment: ENVIRONMENT}),
		browseCalls,
	}
}

const oauthSession = (provider: OAuthSession['provider']): OAuthSession => ({
	kind: 'oauth',
	sessionId: '22222222-2222-4222-8222-222222222222',
	accountId: ACCOUNT_ID,
	provider,
	verifier: 'test-verifier',
	redirectUrl: 'https://proxy.example/callback',
	expiresAt: NOW + OAUTH_SESSION_LIFETIME,
})

const tokenResponse = () =>
	jsonResponse({
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		token_type: 'Bearer',
		expires_in: 3600,
	})

describe('CloudAuth', () => {
	test('uses the production OAuth registrations by default and environment values as development overrides', () => {
		const rclone = {
			async browse() {
				return {entries: [], truncated: false}
			},
			getAccountPaths(accountId: string) {
				return {config: `/tmp/${accountId}.conf`}
			},
		}
		const defaults = new CloudAuth({rclone, environment: {}})
		expect(defaults.oauthClients).toEqual({
			'google-drive': {
				clientId: '568816885459-ussmuppkfkbh6afhbrivkoc2vv2j1qgp.apps.googleusercontent.com',
				clientSecret: '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',
			},
			dropbox: {clientId: 'xzqtv5jfn61fkhd', clientSecret: '17jzl4nnwqjpznd'},
			onedrive: {clientId: 'de8e3af2-9274-4e9d-bbc5-b9c2191a2493'},
		})
		expect(defaults.redirectUrl).toBe('https://cloudoauth.umbrel.com/callback')

		const overrides = new CloudAuth({rclone, environment: ENVIRONMENT})
		expect(overrides.oauthClients).toEqual({
			'google-drive': {clientId: 'google-client', clientSecret: 'google-secret'},
			dropbox: {clientId: 'dropbox-client', clientSecret: 'dropbox-secret'},
			onedrive: {clientId: 'onedrive-client'},
		})
		expect(overrides.redirectUrl).toBe('https://proxy.example/callback')
	})

	test('creates local ten-minute PKCE sessions with exact read-only scopes', () => {
		const {auth} = createHarness()
		expect(CLOUD_OAUTH_SCOPES['google-drive']).toEqual([
			'openid',
			'email',
			'https://www.googleapis.com/auth/drive.readonly',
		])

		expect(auth.getAvailableProviders()).toEqual(['google-drive', 'dropbox', 'onedrive', 'webdav', 'icloud'])
		for (const provider of ['google-drive', 'dropbox', 'onedrive'] as const) {
			const {authorizationUrl, session} = auth.beginOAuth(ACCOUNT_ID, provider)
			const url = new URL(authorizationUrl)
			const challenge = createHash('sha256').update(session.verifier).digest('base64url')

			expect(url.searchParams.get('scope')).toBe(CLOUD_OAUTH_SCOPES[provider].join(' '))
			expect(url.searchParams.get('redirect_uri')).toBe('https://proxy.example/callback')
			expect(url.searchParams.get('code_challenge')).toBe(challenge)
			expect(url.searchParams.get('code_challenge_method')).toBe('S256')
			expect(url.searchParams.get('state')).toBe(provider)
			expect(authorizationUrl).not.toContain(ACCOUNT_ID)
			expect(authorizationUrl).not.toContain('secret')
			expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/)
			expect(session.expiresAt).toBe(NOW + OAUTH_SESSION_LIFETIME)
		}
	})

	test('exchanges a Google code, discovers My Drive and shared drives, and validates the temporary config', async () => {
		const requests: {url: string; body?: string}[] = []
		const fetch = async (input: Input, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(input, init)
			const url = request.url
			const body = request.body ? await request.text() : undefined
			requests.push({url, body})
			if (url.endsWith('/token')) return tokenResponse()
			if (url.includes('/userinfo')) {
				return jsonResponse({
					sub: '\u001B[31mgoogle-user\u001B[0m\u0007',
					name: 'Ada',
					email: '\u001B[32mada@example.com\u001B[0m\u0000',
				})
			}
			if (url.includes('/files/root')) return jsonResponse({id: 'root-folder', name: 'Root'})
			if (url.includes('/drives?')) {
				return jsonResponse({
					nextPageToken: 'more',
					drives: [{id: 'shared-id', name: '\u001B[34mEngineering\u001B[0m\u0007'}],
				})
			}
			throw new Error(`Unexpected request: ${url}`)
		}
		const {auth, browseCalls} = createHarness(fetch)
		const {transaction, calls} = createTransaction()

		const result = await auth.completeOAuth(oauthSession('google-drive'), ' copy-code ', transaction)

		const tokenRequest = requests.find(({url}) => url.endsWith('/token'))
		expect(Object.fromEntries(new URLSearchParams(tokenRequest?.body))).toMatchObject({
			client_id: 'google-client',
			client_secret: 'google-secret',
			code: 'copy-code',
			code_verifier: 'test-verifier',
			redirect_uri: 'https://proxy.example/callback',
		})
		expect(result.account).toEqual({
			provider: 'google-drive',
			identity: 'google-user',
			displayName: 'ada@example.com',
			connection: {kind: 'oauth'},
		})
		expect(result.locations.locations.map(({id}) => id)).toEqual(['my-drive', 'shared-id'])
		expect(result.locations.locations[1].displayName).toBe('Engineering')
		expect(result.locations.truncated).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			method: 'config/create',
			parameters: {
				name: 'cloud',
				type: 'drive',
				parameters: {client_id: 'google-client', client_secret: 'google-secret', scope: 'drive.readonly'},
			},
		})
		expect(JSON.stringify(calls[0])).toContain('refresh-token')
		expect(browseCalls[0]).toMatchObject({accountId: ACCOUNT_ID, configPath: '/tmp/cloud-test.conf'})
	})

	test('rejects expired or mismatched OAuth sessions before contacting a provider', async () => {
		let requests = 0
		const {auth} = createHarness(async () => {
			requests += 1
			return tokenResponse()
		})
		const expired = {...oauthSession('google-drive'), expiresAt: NOW}
		await expect(auth.completeOAuth(expired, 'code', createTransaction().transaction)).rejects.toThrow(
			'[cloud-auth-session-expired]',
		)
		const mismatch = {...createTransaction().transaction, accountId: '22222222-2222-4222-8222-222222222222'}
		await expect(auth.completeOAuth(oauthSession('google-drive'), 'code', mismatch)).rejects.toThrow(
			'[cloud-auth-session-mismatch]',
		)
		expect(requests).toBe(0)
	})

	test('validates copy codes before starting an OAuth exchange', async () => {
		let requests = 0
		const {auth} = createHarness(async () => {
			requests += 1
			return tokenResponse()
		})
		const transaction = createTransaction().transaction

		await expect(auth.completeOAuth(oauthSession('google-drive'), '   ', transaction)).rejects.toThrow(
			'[cloud-invalid-authorization-code]',
		)
		await expect(auth.completeOAuth(oauthSession('google-drive'), 'x'.repeat(16_385), transaction)).rejects.toThrow(
			'[cloud-invalid-authorization-code]',
		)
		expect(requests).toBe(0)
	})

	test('bounds provider response bodies and preserves HTTP status failures', async () => {
		const oversized = createHarness(fetchResponse(new Response('x'.repeat(2 * 1024 * 1024 + 1))))
		await expect(
			oversized.auth.completeOAuth(oauthSession('google-drive'), 'code', createTransaction().transaction),
		).rejects.toMatchObject({
			message: '[cloud-provider-request-failed]',
			provider: 'google-drive',
			statusCode: 200,
		})

		const unavailable = createHarness(fetchResponse(jsonResponse({}, 503)))
		await expect(
			unavailable.auth.completeOAuth(oauthSession('google-drive'), 'code', createTransaction().transaction),
		).rejects.toMatchObject({
			message: '[cloud-provider-request-failed]',
			provider: 'google-drive',
			statusCode: 503,
		})
	})

	test.each([
		{
			provider: 'google-drive' as const,
			statusCode: 400,
			body: {error: 'invalid_token', error_description: 'planted-provider-description'},
			expectedCode: 'invalid_token',
		},
		{
			provider: 'dropbox' as const,
			statusCode: 401,
			body: {
				error_summary: 'invalid_access_token/planted-provider-description',
				error: {'.tag': 'invalid_access_token'},
			},
			expectedCode: 'invalid_access_token',
		},
		{
			provider: 'google-drive' as const,
			statusCode: 400,
			body: {error: 'invalid_token planted-provider-description'},
			expectedCode: undefined,
		},
	])(
		'retains only a safe $provider error code from HTTP failures',
		async ({provider, statusCode, body, expectedCode}) => {
			const {auth} = createHarness(fetchResponse(jsonResponse(body, statusCode)))
			const request = (
				auth as unknown as {
					request(provider: 'google-drive' | 'dropbox', input: Input, options?: Options): Promise<Response>
				}
			).request.bind(auth)

			let thrown: unknown
			try {
				await request(provider, 'https://provider.example/revoke')
			} catch (error) {
				thrown = error
			}

			expect(thrown).toMatchObject({
				name: 'CloudProviderHttpError',
				provider,
				statusCode,
			})
			expect((thrown as {providerErrorCode?: string}).providerErrorCode).toBe(expectedCode)
			expect(inspect(thrown, {depth: 20})).not.toContain('planted-provider-description')
		},
	)

	test('redacts provider request secrets from logged HTTP errors', async () => {
		const secrets = {
			bearer: 'planted-bearer-token',
			code: 'planted-authorization-code',
			verifier: 'planted-pkce-verifier',
			clientSecret: 'planted-client-secret',
			refreshToken: 'planted-refresh-token',
		}
		const {auth} = createHarness(
			fetchResponse(jsonResponse({error: secrets, responseSecret: secrets.refreshToken}, 429)),
		)
		const request = (
			auth as unknown as {
				request(provider: 'google-drive', input: Input, options?: Options): Promise<Response>
			}
		).request.bind(auth)

		let thrown: unknown
		try {
			await request('google-drive', 'https://provider.example/token', {
				method: 'POST',
				headers: {authorization: `Bearer ${secrets.bearer}`, 'x-client-secret': secrets.clientSecret},
				body: new URLSearchParams({
					code: secrets.code,
					code_verifier: secrets.verifier,
					client_secret: secrets.clientSecret,
					refresh_token: secrets.refreshToken,
				}),
			})
		} catch (error) {
			thrown = error
		}

		expect(thrown).toMatchObject({
			name: 'CloudProviderHttpError',
			provider: 'google-drive',
			statusCode: 429,
		})
		const logged = inspect(thrown, {depth: 20})
		for (const secret of Object.values(secrets)) expect(logged).not.toContain(secret)

		const invalidJson = createHarness(fetchResponse(new Response(`not-json-${secrets.refreshToken}`, {status: 200})))
		let parseFailure: unknown
		try {
			await invalidJson.auth.completeOAuth(oauthSession('google-drive'), secrets.code, createTransaction().transaction)
		} catch (error) {
			parseFailure = error
		}
		expect(parseFailure).toMatchObject({provider: 'google-drive', statusCode: 200})
		expect(inspect(parseFailure, {depth: 20})).not.toContain(secrets.refreshToken)

		const networkSecret = 'planted-network-error-message'
		const network = createHarness(async () => {
			throw Object.assign(new Error(networkSecret), {name: 'TimeoutError', code: 'ECONNREFUSED'})
		})
		const networkRequest = (
			network.auth as unknown as {
				request(provider: 'google-drive', input: Input, options?: Options): Promise<Response>
			}
		).request.bind(network.auth)
		let networkFailure: unknown
		try {
			await networkRequest('google-drive', 'https://provider.example/token')
		} catch (error) {
			networkFailure = error
		}
		expect(networkFailure).toMatchObject({
			upstreamErrorName: 'TimeoutError',
			upstreamErrorCode: 'ECONNREFUSED',
		})
		expect(inspect(networkFailure, {depth: 20})).not.toContain(networkSecret)
	})

	test('exposes sanitized iCloud challenge steps without changing opaque values', async () => {
		const {auth} = createHarness()
		const {transaction} = createTransaction([
			{
				State: 'opaque-state',
				Option: {
					Name: '\u001B[31mconfig_2fa\u0007\u001B[0m',
					Help: '\u001B[31mEnter code\u0007\u001B[0m',
					Examples: [{Value: 'opaque-choice', Help: '\u001B[32mUse trusted device\u0000\u001B[0m'}],
				},
			},
		])

		await expect(auth.beginICloud(transaction, {appleId: 'ada@example.com', password: 'secret'})).resolves.toEqual({
			complete: false,
			challenge: {
				state: 'opaque-state',
				step: 'config_2fa',
				prompt: 'Enter code',
				choices: [{value: 'opaque-choice', displayName: 'Use trusted device'}],
			},
		})
	})
})
