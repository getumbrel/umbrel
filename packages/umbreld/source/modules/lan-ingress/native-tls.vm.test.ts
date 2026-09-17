import {X509Certificate} from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'

import {$} from 'execa'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import pRetry from 'p-retry'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import {WebSocket} from 'ws'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import runGitServer from '../test-utilities/run-git-server.js'

const appId = 'sparkles-native-tls'
const appPort = 4002
const gatewayId = 'sparkles-hello-world'
const gatewayPort = 4000
const nativeHostname = '192-168-1-100.server.native.example'
const hiddenPorts = [23000, 23001]
type Echo = {encrypted: boolean; peer: string}
type Connection = {port: number; ca?: string; servername?: string; expectedIdentity?: string; timeout?: number}

describe.sequential('Installed apps with native TLS', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let repositoryUrl: string
	let nativeCertificate: string
	let nativeFingerprint: string
	let umbrelCa: string
	let version = 0
	let failed = false
	const openWebSockets = new Set<WebSocket>()

	beforeAll(async () => {
		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: [appPort, gatewayPort, ...hiddenPorts].map((guestPort) => ({guestPort})),
		})
		gitServer = await runGitServer({additionalApps: [appId]})
		repositoryUrl = gitServer.url.replace('localhost', '10.0.2.2')

		// Generate disposable trust material in the isolated app repository. The
		// certificate is deliberately unrelated to Umbrel's local certificate.
		const fixtureDirectory = path.join(gitServer.directory, appId)
		await $({
			cwd: fixtureDirectory,
		})`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 -subj /CN=native.example -addext ${`subjectAltName=DNS:native.example,DNS:${nativeHostname},DNS:changed.example`} -keyout key.pem -out cert.pem`
		nativeCertificate = await fse.readFile(path.join(fixtureDirectory, 'cert.pem'), 'utf8')
		nativeFingerprint = new X509Certificate(nativeCertificate).fingerprint256

		// Start without opt-in to exercise an existing installation receiving the
		// capability through a normal package update. Also put the declaration on
		// an app_proxy package to prove gateway exclusion after real discovery.
		await writeMetadata(appId, undefined)
		await writeMetadata(gatewayId, ['native.example'])
		await commitRepository()
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		umbrelCa = (await umbreld.client.lanIngress.getCertificateStatus.query()).caCertificate
	})

	afterAll(async () => {
		for (const socket of openWebSockets) socket.terminate()
		try {
			await umbreld?.cleanup()
		} finally {
			await gitServer?.close()
		}
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})
	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const waitForApp = (id = appId) =>
		pRetry(
			async () => {
				await expect(umbreld.client.apps.state.query({appId: id})).resolves.toMatchObject({state: 'ready'})
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

	const nativeConnection = (servername = nativeHostname): Connection => ({
		port: umbreld.vm.getHostPort(appPort),
		ca: nativeCertificate,
		servername,
	})
	const umbrelConnection = (servername = 'umbrel.local', port = appPort): Connection => ({
		port: umbreld.vm.getHostPort(port),
		ca: umbrelCa,
		servername,
		// Unknown/no SNI intentionally gets Umbrel's certificate. Validate its
		// actual identity independently of the hostname supplied for routing.
		expectedIdentity: 'umbrel.local',
	})
	const expectEcho = (connection: Connection, encrypted: boolean) =>
		pRetry(
			async () => {
				const response = await request(connection)
				expect(response.status).toBe(200)
				expect(JSON.parse(response.body)).toMatchObject({encrypted})
				return response
			},
			{retries: 30, factor: 1, minTimeout: 100, maxTimeout: 100},
		)

	async function writeMetadata(id: string, nativeTlsHostnameSuffixes: unknown) {
		const manifestPath = path.join(gitServer.directory, id, 'umbrel-app.yml')
		const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as Record<string, unknown>
		if (nativeTlsHostnameSuffixes === undefined) delete manifest.nativeTlsHostnameSuffixes
		else manifest.nativeTlsHostnameSuffixes = nativeTlsHostnameSuffixes
		manifest.version = `1.0.${version}`
		await fse.writeFile(manifestPath, yaml.dump(manifest))
	}

	async function commitRepository() {
		const git = $({cwd: gitServer.directory})
		await git`git add .`
		await git`git commit -m ${`Native TLS fixture revision ${version}`}`
	}

	async function updateMetadata(nativeTlsHostnameSuffixes: unknown) {
		version++
		await writeMetadata(appId, nativeTlsHostnameSuffixes)
		await commitRepository()
		// Re-adding the repository uses the public refresh path without waiting
		// five minutes for periodic app-store updates or editing installed state.
		await umbreld.client.appStore.removeRepository.mutate({url: repositoryUrl})
		await umbreld.client.appStore.addRepository.mutate({url: repositoryUrl})
		await expect(umbreld.client.apps.update.mutate({appId})).resolves.toBe(true)
		await waitForApp()
	}

	test('installs ordinary and gateway packages through the app store', async () => {
		await umbreld.client.appStore.addRepository.mutate({url: repositoryUrl})
		for (const id of [appId, gatewayId]) {
			await expect(umbreld.client.apps.install.mutate({appId: id})).resolves.toBe(true)
			await waitForApp(id)
		}
		const response = await pRetry(() => request({port: umbreld.vm.getHostPort(appPort)}), {
			retries: 30,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		const echo = JSON.parse(response.body) as Echo
		expect(echo.encrypted).toBe(false)
		await expectEcho(umbrelConnection(nativeHostname), false)
	})

	test('activates native TLS through a package update and verifies its certificate and hostname', async () => {
		await updateMetadata(['native.example'])
		const response = await expectEcho(nativeConnection(), true)
		expect(response.fingerprint).toBe(nativeFingerprint)
		// This records the proxy's source-address behavior, not Plex's auth or
		// LAN classification. Those still require a claimed Plex server.
		expect(JSON.parse(response.body).peer).toBe('127.0.0.1')
		await expectEcho(nativeConnection('native.example'), true)
	})

	test('keeps HTTP, Umbrel HTTPS, and WebSockets working on the same public port', async () => {
		const plain = {port: umbreld.vm.getHostPort(appPort)}
		await expectEcho(plain, false)
		for (const hostname of ['umbrel.local', 'unrelated.example', 'evilnative.example', 'native.example.evil', '']) {
			const response = await expectEcho(umbrelConnection(hostname), false)
			expect(response.fingerprint).not.toBe(nativeFingerprint)
		}
		for (const [connection, encrypted] of [
			[plain, false],
			[umbrelConnection(), false],
			[nativeConnection(), true],
		] as const) {
			const {echo, socket} = await connectWebSocket(connection)
			expect(echo).toMatchObject({encrypted})
			socket.terminate()
		}
	})

	test('uses the real firewall redirect and blocks direct access to hidden ingress ports', async () => {
		const rules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		const hiddenPort = Number(rules.match(new RegExp(`tcp dport ${appPort} redirect to :(\\d+)`))?.[1])
		expect(hiddenPorts).toContain(hiddenPort)
		expect(rules).toContain(`tcp dport ${hiddenPort} ct original proto-dst != ${appPort} drop`)
		await expect(
			request({...nativeConnection(), port: umbreld.vm.getHostPort(hiddenPort), timeout: 1500}),
		).rejects.toThrow()
		await expectEcho(nativeConnection(), true)
	})

	test('excludes app_proxy packages even when their authentication is disabled', async () => {
		const connection = umbrelConnection(nativeHostname, gatewayPort)
		const protectedResponse = await request(connection)
		expect(protectedResponse.status).toBe(302)
		expect(protectedResponse.body).not.toContain('Hello world')

		await umbreld.client.apps.setSettings.mutate({appId: gatewayId, appProxyAuthEnabled: false})
		const publicResponse = await request(connection)
		expect(publicResponse.status).toBe(200)
		expect(publicResponse.body).toBe('Hello world')
		expect(publicResponse.fingerprint).not.toBe(nativeFingerprint)
		await expectEcho(nativeConnection(), true)
	})

	test('closes incomplete native handshakes while ordinary app requests remain available', async () => {
		const socket = net.createConnection({host: '127.0.0.1', port: umbreld.vm.getHostPort(appPort)})
		const closed = waitForClose(socket, 7000)
		// Two bytes are insufficient even to classify the initial TLS record.
		socket.write(Buffer.from([0x16, 0x03]))
		try {
			await Promise.all([
				closed,
				expectEcho({port: umbreld.vm.getHostPort(appPort)}, false),
				request({port: umbreld.vm.getHostPort(gatewayPort)}).then((response) => {
					expect(response.body).toBe('Hello world')
				}),
			])
		} finally {
			socket.destroy()
		}
	})

	test('replaces and removes native policy through package updates', async () => {
		await updateMetadata(['changed.example'])
		await expectEcho(umbrelConnection(nativeHostname), false)
		await expectEcho(nativeConnection('changed.example'), true)

		await updateMetadata(undefined)
		await expectEcho(umbrelConnection('changed.example'), false)
		await expectEcho({port: umbreld.vm.getHostPort(appPort)}, false)
		expect((await request({port: umbreld.vm.getHostPort(gatewayPort)})).body).toBe('Hello world')
	})

	test('supports a directly published Docker port as well as host networking', async () => {
		const composePath = path.join(gitServer.directory, appId, 'docker-compose.yml')
		const compose = yaml.load(await fse.readFile(composePath, 'utf8')) as {
			services: {server: {network_mode?: string; ports?: string[]}}
		}
		delete compose.services.server.network_mode
		compose.services.server.ports = [`${appPort}:${appPort}`]
		await fse.writeFile(composePath, yaml.dump(compose))
		await updateMetadata(['native.example'])
		await expectEcho(nativeConnection(), true)
		await expectEcho(umbrelConnection(), false)
		await umbreld.client.apps.restart.mutate({appId})
		await waitForApp()
		await expectEcho(nativeConnection(), true)
	})

	test('releases stopped routes and restores them after start and reboot', async () => {
		const {socket} = await connectWebSocket(nativeConnection())
		await Promise.all([waitForClose(socket, 10000), umbreld.client.apps.stop.mutate({appId})])
		const stoppedRules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		expect(stoppedRules).not.toContain(`tcp dport ${appPort} redirect to`)
		await expect(request({...nativeConnection(), timeout: 1500})).rejects.toThrow()
		await umbreld.client.apps.start.mutate({appId})
		await waitForApp()
		await expectEcho(nativeConnection(), true)

		// Use a real reboot so persisted package metadata and app-owned listeners
		// are rediscovered during the normal OS startup sequence.
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForApp()
		await waitForApp(gatewayId)
		await expectEcho(nativeConnection(), true)
		await expectEcho(umbrelConnection(), false)
	})

	test('removes only the uninstalled app route', async () => {
		await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toBe(true)
		const rules = await umbreld.vm.sshAsRoot('nft list table inet umbrel_lan_ingress')
		expect(rules).not.toContain(`tcp dport ${appPort} redirect to`)
		expect(rules).toContain(`tcp dport ${gatewayPort} redirect to`)
		expect((await request({port: umbreld.vm.getHostPort(gatewayPort)})).body).toBe('Hello world')
	})

	async function connectWebSocket(connection: Connection) {
		return new Promise<{socket: WebSocket; echo: Echo}>((resolve, reject) => {
			const socket = new WebSocket(`${connection.ca ? 'wss' : 'ws'}://127.0.0.1:${connection.port}/socket`, {
				...tlsOptions(connection),
				handshakeTimeout: 5000,
			})
			openWebSockets.add(socket)
			const timeout = setTimeout(() => {
				socket.terminate()
				reject(new Error('App WebSocket did not send request metadata'))
			}, 5000)
			socket.once('close', () => {
				clearTimeout(timeout)
				openWebSockets.delete(socket)
				reject(new Error('App WebSocket closed before sending request metadata'))
			})
			socket.once('error', reject)
			socket.once('message', (data) => {
				clearTimeout(timeout)
				try {
					resolve({socket, echo: JSON.parse(String(data)) as Echo})
				} catch (error) {
					socket.terminate()
					reject(error)
				}
			})
		})
	}
})

function tlsOptions({ca, servername, expectedIdentity}: Connection): tls.ConnectionOptions {
	return {
		ca,
		servername,
		...(expectedIdentity
			? {checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(expectedIdentity, certificate)}
			: {}),
	}
}

function request(connection: Connection) {
	return new Promise<{status: number; body: string; fingerprint?: string}>((resolve, reject) => {
		const get = connection.ca ? https.get : http.get
		const request = get(
			{host: '127.0.0.1', port: connection.port, path: '/', agent: false, ...tlsOptions(connection)},
			(response) => {
				const fingerprint = connection.ca
					? (response.socket as tls.TLSSocket).getPeerCertificate().fingerprint256
					: undefined
				let body = ''
				response.setEncoding('utf8')
				response.on('data', (chunk) => (body += chunk))
				response.once('error', reject)
				response.once('end', () => resolve({status: response.statusCode!, body, fingerprint}))
			},
		)
		const timeout = setTimeout(() => request.destroy(new Error('App request timed out')), connection.timeout ?? 5000)
		request.once('close', () => clearTimeout(timeout))
		request.once('error', reject)
	})
}

function waitForClose(socket: net.Socket | WebSocket, timeoutMs: number) {
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Connection remained open')), timeoutMs)
		socket.once('error', () => {})
		socket.once('close', () => {
			clearTimeout(timeout)
			resolve()
		})
	})
}
