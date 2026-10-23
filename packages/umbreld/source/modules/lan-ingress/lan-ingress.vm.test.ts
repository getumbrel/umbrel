// @vm-requires-playwright
import {Readable} from 'node:stream'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import got from 'got'
import pRetry from 'p-retry'
import type {Browser} from 'playwright'
import {WebSocket} from 'ws'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import createVmBrowser from '../test-utilities/create-vm-browser.ts'
import * as totp from '../utilities/totp.ts'

type TestVm = Awaited<ReturnType<typeof createTestVm>>
type TrpcResponse<T> = {result: {data: T}}

describe.sequential('LAN ingress', () => {
	let umbreld: TestVm
	let failed = false
	let httpsPort: number
	let authPort: number
	let appProxyPort: number
	let authenticatedAppPort: number
	let bridgeAppPort: number
	let hostNetworkAppPort: number
	let recreatedAppPort: number
	let caCertificate = ''
	let caFingerprint = ''
	let ingressRefreshHostnameIndex = 0
	let vmBrowser: Awaited<ReturnType<typeof createVmBrowser>> | undefined

	beforeAll(async () => {
		// Cover the fixed LAN ingress listeners plus each app routing shape.
		const forwardedPorts = {
			https: {guestPort: 443},
			auth: {guestPort: 2000},
			appProxy: {guestPort: 9091},
			authenticatedApp: {guestPort: 9094},
			bridgeApp: {guestPort: 9092},
			hostNetworkApp: {guestPort: 9093},
			recreatedApp: {guestPort: 9095},
		}

		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: Object.values(forwardedPorts),
		})
	})

	afterAll(async () => {
		try {
			await vmBrowser?.close()
		} finally {
			await umbreld?.cleanup()
		}
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('boots VM and registers user', async () => {
		await umbreld.vm.powerOn()
		httpsPort = umbreld.vm.getHostPort(443)
		authPort = umbreld.vm.getHostPort(2000)
		appProxyPort = umbreld.vm.getHostPort(9091)
		authenticatedAppPort = umbreld.vm.getHostPort(9094)
		bridgeAppPort = umbreld.vm.getHostPort(9092)
		hostNetworkAppPort = umbreld.vm.getHostPort(9093)
		recreatedAppPort = umbreld.vm.getHostPort(9095)
		await umbreld.registerAndLogin()
	})

	test('reports HTTPS access certificate status', async () => {
		await expect(umbreld.unauthenticatedClient.lanIngress.getCertificateStatus.query()).rejects.toThrow('Invalid token')

		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.caCertificate).toContain('BEGIN CERTIFICATE')
		expect(status.caFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
		expect(new Date(status.caExpiresAt).getTime()).toBeGreaterThan(Date.now())
		expect(status.serverSans.dns).toContain('umbrel.local')
		expect(status.serverSans.ips).toContain('127.0.0.1')
		caCertificate = status.caCertificate
		caFingerprint = status.caFingerprint

		const unauthenticatedDownload = await umbreld.unauthenticatedApi
			.get('../lan-ingress/umbrel-local-ca.crt')
			.catch((error) => error)
		expect(unauthenticatedDownload.response.statusCode).toBe(401)

		const certificateDownload = await umbreld.api.get('../lan-ingress/umbrel-local-ca.crt', {
			responseType: 'text',
		})
		expect(certificateDownload.headers['content-type']).toBe('application/x-x509-ca-cert')
		expect(certificateDownload.body).toBe(caCertificate)

		const unauthenticatedLogs = await umbreld.unauthenticatedApi.get('../logs/', {throwHttpErrors: false})
		expect(unauthenticatedLogs.statusCode).toBe(401)
		const logs = await umbreld.api.get('../logs/', {responseType: 'buffer'})
		expect(logs.headers['content-disposition']).toMatch(/^attachment;filename=umbrel-\d+\.log\.gz$/)
		expect([...logs.rawBody.subarray(0, 2)]).toEqual([0x1f, 0x8b])

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`http://127.0.0.1:${authPort}/`)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('preserves PhotoKit upload responses through HTTPS ingress', async () => {
		type NativeSession = {accessToken: string}
		type PhotoGrant = {token: string}
		const https = {certificateAuthority: caCertificate}
		const nativeLogin = await got.post<TrpcResponse<NativeSession>>(
			`https://127.0.0.1:${httpsPort}/trpc/user.loginNative`,
			{
				json: {
					userId: '0',
					password: 'moneyprintergobrrr',
					client: {
						id: 'umbrel',
						platform: 'ios',
						deviceClass: 'phone',
						appVersion: '0.1',
						appBuild: '20',
						osVersion: '26.6.1',
					},
				},
				https,
				responseType: 'json',
			},
		)
		const accessToken = nativeLogin.body.result.data.accessToken
		const sourceId = '11111111-1111-4111-8111-111111111111'
		const grantResponse = await got.post<TrpcResponse<PhotoGrant>>(
			`https://127.0.0.1:${httpsPort}/trpc/photos.createBackupGrant`,
			{
				json: {sourceId, suggestedName: 'Test iPhone'},
				headers: {Authorization: `Bearer ${accessToken}`},
				https,
				responseType: 'json',
			},
		)
		const grant = grantResponse.body.result.data.token

		const capabilityProbe = await got(`https://127.0.0.1:${httpsPort}/api/photos/upload`, {
			method: 'OPTIONS',
			https,
			throwHttpErrors: false,
		})
		expect(capabilityProbe.statusCode).toBe(501)

		const uploadedKey = 'a'.repeat(64)
		const uploaded = await got.post(`https://127.0.0.1:${httpsPort}/api/photos/upload`, {
			body: 'photo',
			headers: {
				Authorization: `Bearer ${grant}`,
				'X-Umbrel-Photo-Backup-Key': uploadedKey,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				'X-Umbrel-Photo-Original-Filename-Base64': Buffer.from('IMG_1234.HEIC').toString('base64'),
			},
			https,
		})
		expect(uploaded.headers['cache-control']).toBe('no-store')
		expect(uploaded.headers['x-umbrel-photo-backup-key']).toBe(uploadedKey)
		expect(uploaded.headers['x-umbrel-upload-bytes']).toBe('5')
		expect(JSON.parse(uploaded.body)).toEqual({resourceKey: uploadedKey, bytes: 5})

		// Reject before consuming the body, exercising the ingress behavior that
		// previously converted an early 507 into a lost client connection.
		const rejectedKey = 'b'.repeat(64)
		const rejected = await got.post(`https://127.0.0.1:${httpsPort}/api/photos/upload`, {
			body: Readable.from([Buffer.alloc(1024)]),
			headers: {
				Authorization: `Bearer ${grant}`,
				'Content-Length': String(500 * 1024 ** 4),
				'X-Umbrel-Photo-Backup-Key': rejectedKey,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				'X-Umbrel-Photo-Original-Filename-Base64': Buffer.from('IMG_1235.HEIC').toString('base64'),
			},
			https,
			throwHttpErrors: false,
		})
		expect(rejected.statusCode).toBe(507)
		expect(rejected.headers['x-umbrel-photo-backup-error']).toBe('insufficient-storage')
		expect(JSON.parse(rejected.body)).toEqual({error: '[not-enough-space]'})
	})

	test('resets the local CA without breaking dashboard or auth ingress', async () => {
		const status = await umbreld.client.lanIngress.resetCa.mutate()
		expect(status.caCertificate).toContain('BEGIN CERTIFICATE')
		expect(status.caCertificate).not.toBe(caCertificate)
		expect(status.caFingerprint).not.toBe(caFingerprint)
		expect(status.serverSans.dns).toContain('umbrel.local')
		expect(status.serverSans.ips).toContain('127.0.0.1')
		caCertificate = status.caCertificate
		caFingerprint = status.caFingerprint

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('keeps the local CA after umbreld restart', async () => {
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.login()

		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.caCertificate).toBe(caCertificate)
		expect(status.caFingerprint).toBe(caFingerprint)

		await expectIngressResponds(`https://127.0.0.1:${httpsPort}/`, caCertificate)
		await expectIngressResponds(`https://127.0.0.1:${authPort}/`, caCertificate)
	})

	test('sets up test apps', async () => {
		// Login becomes available while the rest of Umbreld is still starting.
		// Wait for the real app environment before attaching fixture containers
		// to its external Docker network.
		await pRetry(() => umbreld.vm.sshAsRoot('docker network inspect umbrel_main_network >/dev/null'), {
			retries: 120,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		// setupTestApps only writes app state over SSH; it does not trigger a LAN ingress
		// refresh. The hostname test below causes the refresh (setHostname awaits it) that
		// creates the app mux listeners and nftables rules the app-port test depends on.
		// If these tests are reordered, trigger a refresh explicitly or the app-port test
		// will race the 1 minute periodic refresh.
		await setupTestApps(umbreld)
	})

	test('updates certificate SANs when hostname changes', async () => {
		const hostname = await changeHostnameAndRefreshIngress(umbreld, ingressRefreshHostnameIndex++)
		const status = await umbreld.client.lanIngress.getCertificateStatus.query()
		expect(status.serverSans.dns).toContain(hostname)
		expect(status.serverSans.dns).toContain(`${hostname}.local`)
	})

	test('keeps each supported app routing shape working over HTTP and HTTPS', async () => {
		await expectAppPortSupportsHttpAndHttps({app: 'app-proxy', port: appProxyPort, caCertificate, gateway: true})
		await expectAppPortSupportsHttpAndHttps({app: 'bridge', port: bridgeAppPort, caCertificate})
		await expectAppPortSupportsHttpAndHttps({app: 'host-network', port: hostNetworkAppPort, caCertificate})
		await expectTextAppPortSupportsHttpAndHttps(recreatedAppPort, caCertificate, 'recreated')
		await expectAppHstsStripped(`https://127.0.0.1:${bridgeAppPort}/bridge/hsts`, caCertificate)

		const nftRules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		expect(nftRules).toContain('redirect to')
		for (const port of [9091, 9092, 9093, 9094, 9095]) {
			expect(nftRules).toContain(`tcp dport ${port}`)
			expect(nftRules).toContain(`ct original proto-dst != ${port} drop`)
		}
	})

	test('re-resolves an app gateway target after an out-of-band container replacement', async () => {
		const [oldAddress, newAddress] = await replaceGatewayTargetContainer(umbreld)
		expect(newAddress).not.toBe(oldAddress)

		const startedAt = Date.now()
		await pRetry(
			async () => {
				const response = await got(`http://127.0.0.1:${recreatedAppPort}/`, {retry: {limit: 0}})
				expect(response.body).toBe('recreated')
			},
			{retries: 30, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		// Recovery is driven by the failed request, not the one-minute periodic refresh.
		expect(Date.now() - startedAt).toBeLessThan(15_000)
		await umbreld.vm.sshAsRoot('docker rm -f lan-ingress-ip-blocker >/dev/null 2>&1 || true')
	})

	test('completes app login in a real browser over HTTP and HTTPS', async () => {
		// Reload the disk-backed fixtures through the Apps module so app-auth sees
		// the authenticated fixture as a normal installed app.
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.login()
		await pRetry(
			async () => {
				const response = await got(`http://127.0.0.1:${authenticatedAppPort}/private`, {
					followRedirect: false,
					retry: {limit: 0},
					throwHttpErrors: false,
				})
				expect(response.statusCode).toBe(302)
			},
			{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		// Keep the real guest ports in browser URLs while routing them through
		// QEMU's random host forwards. This preserves the app -> :2000 -> app
		// redirect chain and sends traffic through the guest's LAN ingress path.
		vmBrowser = await createVmBrowser({
			forwardPorts: [
				{hostPort: authenticatedAppPort, guestPort: 9094},
				{hostPort: authPort, guestPort: 2000},
			],
		})

		try {
			await expectBrowserLoginFlow(vmBrowser.browser, 'http')
			await expectBrowserLoginFlow(vmBrowser.browser, 'https')
		} catch (error) {
			console.error(await umbreld.vm.sshAsRoot('journalctl -u umbrel --no-pager -n 200'))
			throw error
		}
	})

	test('app auth preserves 2FA and creates an app-bound Tor handoff', async () => {
		const totpUri =
			'otpauth://totp/Umbrel?secret=63AU7PMWJX6EQJR6G3KTQFG5RDZ2UE3WVUMP3VFJWHSWJ7MMHTIQ&period=30&digits=6&algorithm=SHA1&issuer=umbrel.local'
		await umbreld.client.apps.setTorEnabled.mutate(true)
		await umbreld.client.user.enable2fa.mutate({totpUri, totpToken: totp.generateToken(totpUri)})

		const query = 'origin=host&app=lan-ingress-auth&path=%2Fprivate'
		const missing2fa = await got.post(`http://127.0.0.1:${authPort}/v1/account/login?${query}`, {
			json: {password: 'moneyprintergobrrr', totpToken: ''},
			throwHttpErrors: false,
			retry: {limit: 0},
		})
		expect(missing2fa.statusCode).toBe(401)
		expect(JSON.parse(missing2fa.body).error.message).toBe('Missing 2FA code')

		const login = await got.post(`http://127.0.0.1:${authPort}/v1/account/login?${query}`, {
			json: {password: 'moneyprintergobrrr', totpToken: totp.generateToken(totpUri)},
			headers: {'user-agent': 'UmbrelAppAuthVm/1.0'},
			retry: {limit: 0},
		})
		const appCookie = (login.headers['set-cookie'] ?? [])
			.find((cookie) => cookie.startsWith('UMBREL_APP_SESSION='))
			?.split(';')[0]
		expect(appCookie).toBeTypeOf('string')
		expect(JSON.parse(login.body).url).toBe('http://127.0.0.1:9094/umbrel_/api/v1/auth/handoff')
		expect(await umbreld.client.user.listSessions.query()).toContainEqual(
			expect.objectContaining({
				client: {type: 'browser', userAgent: 'UmbrelAppAuthVm/1.0'},
				current: false,
			}),
		)

		const torHandoff = await pRetry(
			async () => {
				const response = await got.get(
					`http://127.0.0.1:${authPort}/v1/account/session?origin=tor&app=lan-ingress-auth&path=%2Fprivate`,
					{headers: {cookie: appCookie!}, retry: {limit: 0}},
				)
				const body = JSON.parse(response.body) as {url: string; params: {r: string; handoff: string}}
				expect(body.url).toMatch(/^http:\/\/[a-z2-7]{56}\.onion\/umbrel_\/api\/v1\/auth\/handoff$/)
				expect(body.params.r).toBe('/private')
				expect(body.params.handoff).toBeTypeOf('string')
				return body
			},
			{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
		expect(torHandoff.params).not.toHaveProperty('token')

		await umbreld.client.user.disable2fa.mutate({totpToken: totp.generateToken(totpUri)})
		await umbreld.client.apps.setTorEnabled.mutate(false)
	})

	test('enforces app auth in umbreld and never forwards auth cookies upstream', async () => {
		const privateUrl = `http://127.0.0.1:${authenticatedAppPort}/private`
		const unauthorized = await got(privateUrl, {followRedirect: false, retry: {limit: 0}, throwHttpErrors: false})
		expect(unauthorized.statusCode).toBe(302)
		expect(unauthorized.headers.location).toContain(':2000/app-auth?origin=host&app=lan-ingress-auth')

		const publicResponse = await requestAppEcho(`http://127.0.0.1:${authenticatedAppPort}/public/status`)
		expect(publicResponse.app).toBe('authenticated')
		const blacklisted = await got(`http://127.0.0.1:${authenticatedAppPort}/public/private/status`, {
			followRedirect: false,
			retry: {limit: 0},
			throwHttpErrors: false,
		})
		expect(blacklisted.statusCode).toBe(302)

		const login = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: {password: 'moneyprintergobrrr'}})
		const appSession = (login.headers['set-cookie'] ?? [])
			.find((cookie) => cookie.startsWith('UMBREL_APP_SESSION='))
			?.split(';')[0]
		expect(appSession).toMatch(/^UMBREL_APP_SESSION=umbrel_[0-9a-f]{32}_[0-9a-f]{64}$/)

		const authenticated = await requestAppEcho(privateUrl, undefined, {
			cookie: `${appSession}; UMBREL_BROWSER_SESSION=browser-secret; app-cookie=preserved; UMBREL_PROXY_TOKEN=retired-secret`,
		})
		expect(authenticated.app).toBe('authenticated')
		expect(authenticated.headers.cookie).toBe('app-cookie=preserved')

		await expectWebSocketRejected(`ws://127.0.0.1:${authenticatedAppPort}/socket`)
		const websocket = await connectWebSocket(`ws://127.0.0.1:${authenticatedAppPort}/socket`, {
			Cookie: `${appSession}; UMBREL_BROWSER_SESSION=browser-secret; app-cookie=preserved`,
		})
		expect(websocket.headers.cookie).toBe('app-cookie=preserved')
		const closed = new Promise<void>((resolve) => websocket.socket.once('close', () => resolve()))

		const httpsLogin = await got.post(`https://127.0.0.1:${httpsPort}/trpc/user.login`, {
			json: {password: 'moneyprintergobrrr'},
			https: {certificateAuthority: caCertificate},
		})
		const httpsAppSession = (httpsLogin.headers['set-cookie'] ?? [])
			.find((cookie) => cookie.startsWith('__Host-UMBREL_APP_SESSION_HTTPS='))
			?.split(';')[0]
		expect(httpsAppSession).toBeTypeOf('string')
		const secureWebsocket = await connectWebSocket(
			`wss://127.0.0.1:${authenticatedAppPort}/socket`,
			{Cookie: `${httpsAppSession}; __Host-UMBREL_BROWSER_SESSION_HTTPS=browser-secret; app-cookie=preserved`},
			caCertificate,
		)
		expect(secureWebsocket.headers.cookie).toBe('app-cookie=preserved')
		const secureClosed = new Promise<void>((resolve) => secureWebsocket.socket.once('close', () => resolve()))

		// The app sessions belong to other logins, so revoking other sessions closes both sockets
		await umbreld.client.user.revokeOtherSessions.mutate()
		await expect(
			Promise.all([
				Promise.race([closed, rejectAfter(5000, 'HTTP app WebSocket remained open')]),
				Promise.race([secureClosed, rejectAfter(5000, 'HTTPS app WebSocket remained open')]),
			]),
		).resolves.toEqual([undefined, undefined])
		await umbreld.login()
	})

	test('does not run the removed auth or app-proxy sidecars', async () => {
		const containers = (await umbreld.vm.sshAsRoot("docker ps --format '{{.Names}}'")).split('\n').filter(Boolean)
		expect(containers).not.toContain('auth')
		expect(containers.some((name) => name.includes('_app_proxy_'))).toBe(false)
	})

	test('removes app ingress when the app is no longer installed', async () => {
		await removeTestApps(umbreld)
		await changeHostnameAndRefreshIngress(umbreld, ingressRefreshHostnameIndex++)

		const nftRules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		for (const port of [9091, 9092, 9093, 9094, 9095]) {
			expect(nftRules).not.toContain(`tcp dport ${port}`)
			expect(nftRules).not.toContain(`ct original proto-dst != ${port} drop`)
		}
	})
})

async function expectIngressResponds(url: string, caCertificate?: string) {
	return pRetry(
		async () => {
			const response = await got(url, {
				https: caCertificate ? {certificateAuthority: caCertificate} : undefined,
				retry: {limit: 0},
				throwHttpErrors: false,
			})
			if (response.statusCode >= 500) throw new Error(`Expected ${url} to be available, got ${response.statusCode}`)
			return response
		},
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

async function expectBrowserLoginFlow(browser: Browser, protocol: 'http' | 'https') {
	const context = await browser.newContext({ignoreHTTPSErrors: true})
	try {
		const page = await context.newPage()
		const pageErrors: Error[] = []
		const consoleErrors: string[] = []
		const uiAssets: Array<{url: string; status: number; contentType: string; type: string}> = []
		page.on('pageerror', (error) => pageErrors.push(error))
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text())
		})
		page.on('response', (response) => {
			const type = response.request().resourceType()
			if (!['script', 'stylesheet'].includes(type)) return
			const url = new URL(response.url())
			if (url.hostname !== '127.0.0.1' || url.port !== '2000') return
			uiAssets.push({
				url: response.url(),
				status: response.status(),
				contentType: response.headers()['content-type'] ?? '',
				type,
			})
		})

		const appUrl = `${protocol}://127.0.0.1:9094/private`
		const authNavigation = await page.goto(appUrl)
		await page.getByRole('heading', {name: 'Welcome back, satoshi'}).waitFor()

		const authUrl = new URL(page.url())
		expect(authUrl.protocol).toBe(`${protocol}:`)
		expect(authUrl.hostname).toBe('127.0.0.1')
		expect(authUrl.port).toBe('2000')
		expect(authUrl.pathname).toBe('/app-auth/')
		expect(authUrl.searchParams.get('app')).toBe('lan-ingress-auth')
		expect(authNavigation?.headers()['content-security-policy']).toContain(
			`form-action 'self' ${protocol}://127.0.0.1:*`,
		)
		expect(pageErrors).toEqual([])
		expect(uiAssets.length).toBeGreaterThan(0)
		for (const asset of uiAssets) {
			expect(asset.status, asset.url).toBe(200)
			if (asset.type === 'script') expect(asset.contentType, asset.url).toMatch(/javascript/)
			if (asset.type === 'stylesheet') expect(asset.contentType, asset.url).toMatch(/text\/css/)
		}

		await page.locator('input[type="password"]').fill('moneyprintergobrrr')
		const [loginResponse] = await Promise.all([
			page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/v1/account/login' && response.request().method() === 'POST',
			),
			page.getByRole('button', {name: 'Open LAN Ingress Auth'}).click(),
		])
		if (loginResponse.status() !== 200) {
			throw new Error(`App login returned ${loginResponse.status()}: ${await loginResponse.text()}`)
		}
		try {
			await page.waitForURL(appUrl)
		} catch (error) {
			throw new Error(`${String(error)}\nBrowser console errors:\n${consoleErrors.join('\n')}`)
		}

		const response = JSON.parse(await page.locator('body').innerText()) as {
			app: string
			url: string
			headers: Record<string, string | undefined>
		}
		expect(response.app).toBe('authenticated')
		expect(response.url).toBe('/private')
		expect(response.headers.cookie).toBeUndefined()
		expect(consoleErrors.filter((message) => message.includes('Content Security Policy'))).toEqual([])
	} finally {
		await context.close()
	}
}

// The synthetic app server echoes request metadata so we can assert what
// reached the app after LAN ingress handled the connection.
async function requestAppEcho(url: string, caCertificate?: string, headers?: Record<string, string>) {
	return pRetry(
		() =>
			got(url, {
				https: caCertificate ? {certificateAuthority: caCertificate} : undefined,
				headers,
				retry: {limit: 0},
			}).json<{app: string; url: string; headers: Record<string, string | undefined>}>(),
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

async function expectAppPortSupportsHttpAndHttps({
	app,
	port,
	caCertificate,
	gateway = false,
}: {
	app: string
	port: number
	caCertificate: string
	gateway?: boolean
}) {
	const httpResponse = await requestAppEcho(`http://127.0.0.1:${port}/${app}/http`)
	expect(httpResponse.app).toBe(app)
	expect(httpResponse.url).toBe(`/${app}/http`)
	expect(httpResponse.headers['x-forwarded-proto']).toBe(gateway ? 'http' : undefined)

	const httpsResponse = await requestAppEcho(`https://127.0.0.1:${port}/${app}/https`, caCertificate)
	expect(httpsResponse.app).toBe(app)
	expect(httpsResponse.url).toBe(`/${app}/https`)
	expect(httpsResponse.headers['x-forwarded-proto']).toBe('https')
	// Direct apps retain their original behavior. Apps using the compatibility
	// gateway retain app-proxy's forwarded request metadata.
	expect(httpsResponse.headers['x-forwarded-for'] === undefined).toBe(!gateway)
}

async function expectTextAppPortSupportsHttpAndHttps(port: number, caCertificate: string, expectedBody: string) {
	const httpResponse = await pRetry(() => got(`http://127.0.0.1:${port}/`, {retry: {limit: 0}}), {
		retries: 30,
		factor: 1,
		minTimeout: 1000,
		maxTimeout: 1000,
	})
	expect(httpResponse.body).toBe(expectedBody)
	const httpsResponse = await got(`https://127.0.0.1:${port}/`, {
		https: {certificateAuthority: caCertificate},
		retry: {limit: 0},
	})
	expect(httpsResponse.body).toBe(expectedBody)
}

async function expectWebSocketRejected(url: string) {
	await expect(
		new Promise<void>((resolve, reject) => {
			const socket = new WebSocket(url)
			socket.once('unexpected-response', (_request, response) => {
				response.resume()
				response.once('end', () => (response.statusCode === 401 ? resolve() : reject(new Error('Expected 401'))))
			})
			socket.once('open', () => reject(new Error('Unauthorized WebSocket opened')))
			socket.once('error', () => {})
		}),
	).resolves.toBeUndefined()
}

async function connectWebSocket(url: string, headers: Record<string, string>, ca?: string) {
	return new Promise<{headers: Record<string, string | undefined>; socket: WebSocket}>((resolve, reject) => {
		const socket = new WebSocket(url, {headers, ca})
		socket.once('message', (data) => {
			resolve({headers: JSON.parse(String(data)).headers, socket})
		})
		socket.once('error', reject)
	})
}

function rejectAfter(milliseconds: number, message: string) {
	return new Promise<never>((_resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(message)), milliseconds)
		timeout.unref()
	})
}

async function expectAppHstsStripped(url: string, caCertificate: string) {
	const response = await pRetry(
		() =>
			got(url, {
				https: {certificateAuthority: caCertificate},
				retry: {limit: 0},
			}),
		{retries: 30, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
	expect(response.headers['strict-transport-security']).toBeUndefined()
}

async function changeHostnameAndRefreshIngress(umbreld: TestVm, index: number) {
	const hostname = `umbrel-ingress-${index}`
	await umbreld.client.system.setHostname.mutate({hostname})
	return hostname
}

// Create the smallest installed-app shapes needed to exercise LAN ingress
// routing without pulling real apps from the app store.
async function setupTestApps(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot(`
set -eu

write_app() {
	app_id="$1"
	app_name="$2"
	app_port="$3"
	compose_kind="$4"
	target_port="\${5:-}"
	app_dir="/home/umbrel/umbrel/app-data/$app_id"
	mkdir -p "$app_dir"

	cat > "$app_dir/umbrel-app.yml" <<YAML
manifestVersion: 1.0.0
id: $app_id
name: $app_name
tagline: Test app
category: Development
version: "1.0.0"
port: $app_port
description: Test app
website: https://umbrel.com
support: https://umbrel.com
gallery: []
YAML

	case "$compose_kind" in
		app_proxy)
			cat > "$app_dir/docker-compose.yml" <<YAML
services:
  app_proxy:
    environment:
      APP_HOST: 10.21.0.1
      APP_PORT: $target_port
      PROXY_AUTH_ADD: "false"
YAML
			;;
		recreated)
			cat > "$app_dir/docker-compose.yml" <<'YAML'
services:
  app_proxy:
    image: ghcr.io/getumbrel/tor:0.4.9.14
    environment:
      APP_HOST: lan-ingress-recreated_web_1
      APP_PORT: 18080
      PROXY_AUTH_ADD: "false"
  web:
    image: ghcr.io/getumbrel/tor:0.4.9.14
    container_name: lan-ingress-recreated_web_1
    entrypoint: ["perl", "-MIO::Socket::INET", "-e"]
    command:
      - |
        $$server = IO::Socket::INET->new(LocalPort => 18080, Listen => 5, ReuseAddr => 1) or die $$!;
        while ($$client = $$server->accept()) {
          while (<$$client>) { last if /^\\r?\\n$$/; }
          $$body = "recreated";
          print $$client "HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\nContent-Length: " . length($$body) . "\\r\\nConnection: close\\r\\n\\r\\n$$body";
          close $$client;
        }
networks:
  default:
    name: umbrel_main_network
    external: true
YAML
			;;
		authenticated)
			cat > "$app_dir/docker-compose.yml" <<YAML
services:
  app_proxy:
    environment:
      APP_HOST: 10.21.0.1
      APP_PORT: $target_port
      PROXY_AUTH_ADD: "true"
      PROXY_AUTH_WHITELIST: /public/*
      PROXY_AUTH_BLACKLIST: /public/private/*
  keepalive:
    image: ghcr.io/getumbrel/tor:0.4.9.14
    command: ["sleep", "infinity"]
YAML
			;;
		bridge)
			cat > "$app_dir/docker-compose.yml" <<YAML
services:
  web:
    ports:
      - "$app_port:$app_port"
YAML
			;;
		host)
			cat > "$app_dir/docker-compose.yml" <<'YAML'
services:
  web:
    network_mode: host
YAML
			;;
	esac
}

write_app lan-ingress-app-proxy "LAN Ingress App Proxy" 9091 app_proxy 19091
write_app lan-ingress-bridge "LAN Ingress Bridge" 9092 bridge
write_app lan-ingress-host "LAN Ingress Host" 9093 host
write_app lan-ingress-auth "LAN Ingress Auth" 9094 authenticated 19094
write_app lan-ingress-recreated "LAN Ingress Recreated" 9095 recreated

docker compose --project-name lan-ingress-recreated --file /home/umbrel/umbrel/app-data/lan-ingress-recreated/docker-compose.yml up --detach web >/dev/null

# The authenticated and recreated fixtures need to start when umbreld is
# restarted. The other fixtures use a host-side echo server and have already
# exercised their ingress routes by that point.
for app_id in lan-ingress-app-proxy lan-ingress-bridge lan-ingress-host; do
	printf 'autoStart: false\n' > "/home/umbrel/umbrel/app-data/$app_id/settings.yml"
done

cat > /tmp/lan-ingress-test-server.js <<'JS'
const http = require('http')
const {WebSocketServer} = require('/opt/umbreld/node_modules/ws')

function listen(app, port) {
	const server = http.createServer((request, response) => {
		response.setHeader('content-type', 'application/json')
		if (request.url.includes('/hsts')) response.setHeader('strict-transport-security', 'max-age=31536000')
		response.end(JSON.stringify({
			app,
			url: request.url,
			headers: {
				'x-forwarded-for': request.headers['x-forwarded-for'],
				'x-forwarded-host': request.headers['x-forwarded-host'],
				'x-forwarded-proto': request.headers['x-forwarded-proto'],
				cookie: request.headers.cookie,
			},
		}))
	})
	const sockets = new WebSocketServer({noServer: true})
	sockets.on('connection', (socket, request) => socket.send(JSON.stringify({headers: request.headers})))
	server.on('upgrade', (request, socket, head) => sockets.handleUpgrade(request, socket, head, (ws) => {
		sockets.emit('connection', ws, request)
	}))
	server.listen(port, '0.0.0.0')
}

listen('app-proxy', 19091)
listen('authenticated', 19094)
listen('bridge', 9092)
listen('host-network', 9093)
JS

node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) || {}
store.apps = ['lan-ingress-app-proxy', 'lan-ingress-bridge', 'lan-ingress-host', 'lan-ingress-auth', 'lan-ingress-recreated']
fs.writeFileSync(storePath, yaml.dump(store))
NODE

if [ -f /tmp/lan-ingress-test-server.pid ]; then
	kill "$(cat /tmp/lan-ingress-test-server.pid)" 2>/dev/null || true
fi
nohup node /tmp/lan-ingress-test-server.js >/tmp/lan-ingress-test-server.log 2>&1 &
echo "$!" > /tmp/lan-ingress-test-server.pid
`)
}

async function replaceGatewayTargetContainer(umbreld: TestVm) {
	const addresses = await umbreld.vm.sshAsRoot(`
set -eu
app_dir=/home/umbrel/umbrel/app-data/lan-ingress-recreated
old_address="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' lan-ingress-recreated_web_1)"
docker rm -f lan-ingress-recreated_web_1 >/dev/null
docker rm -f lan-ingress-ip-blocker >/dev/null 2>&1 || true
docker run --detach --name lan-ingress-ip-blocker --network umbrel_main_network --ip "$old_address" --entrypoint sleep ghcr.io/getumbrel/tor:0.4.9.14 infinity >/dev/null
docker compose --project-name lan-ingress-recreated --file "$app_dir/docker-compose.yml" up --detach web >/dev/null
new_address="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' lan-ingress-recreated_web_1)"
printf '%s %s' "$old_address" "$new_address"
`)
	const [oldAddress, newAddress] = addresses.trim().split(/\s+/)
	if (!oldAddress || !newAddress) throw new Error(`Could not read replacement addresses: ${addresses}`)
	return [oldAddress, newAddress]
}

async function removeTestApps(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot(`
set -eu

node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) || {}
store.apps = []
fs.writeFileSync(storePath, yaml.dump(store))
NODE

rm -rf /home/umbrel/umbrel/app-data/lan-ingress-app-proxy
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-bridge
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-host
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-auth
docker compose --project-name lan-ingress-recreated --file /home/umbrel/umbrel/app-data/lan-ingress-recreated/docker-compose.yml down >/dev/null 2>&1 || true
docker rm -f lan-ingress-ip-blocker >/dev/null 2>&1 || true
rm -rf /home/umbrel/umbrel/app-data/lan-ingress-recreated
if [ -f /tmp/lan-ingress-test-server.pid ]; then
	kill "$(cat /tmp/lan-ingress-test-server.pid)" 2>/dev/null || true
	rm -f /tmp/lan-ingress-test-server.pid
fi
`)
}
