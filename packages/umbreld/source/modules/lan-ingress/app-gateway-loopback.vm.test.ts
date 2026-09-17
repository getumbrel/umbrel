import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import runGitServer from '../test-utilities/run-git-server.js'

const appId = 'sparkles-hello-world'
const appPort = 4000
const hostAppId = 'sparkles-host-network'
const hostAppPort = 4001

describe.sequential('App gateway behind a host network forwarder', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: [{guestPort: appPort}, {guestPort: hostAppPort}],
		})
		gitServer = await runGitServer({additionalApps: [hostAppId]})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
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

	const loopbackResponse = (https = false) =>
		umbreld.vm.sshAsRoot(
			`curl --silent --show-error --max-time 5 -i ${https ? `--cacert '${umbreld.vm.dataDirectory}/lan-ingress/ca.pem' https` : 'http'}://127.0.0.1:${appPort}/`,
		)

	test('starts a same-port forwarder before installing the app', async () => {
		// Model tailscale serve's socket topology without needing a real tailnet:
		// a host process binds one interface and forwards to the app on loopback.
		// SSH is needed because the product has no API for creating this network.
		await umbreld.vm.sshAsRoot(`
set -eu
ip link add tailnet-test type dummy
ip address add 100.64.0.1/32 dev tailnet-test
ip link set tailnet-test up
cat > /tmp/app-loopback-forwarder.cjs <<'NODE'
const http = require('node:http')
http.createServer((request, response) => {
  response.setHeader('X-Test-Forwarder', 'tailnet')
  const upstream = http.request({hostname: '127.0.0.1', port: ${appPort}, path: request.url, method: request.method, headers: request.headers}, (incoming) => {
    response.writeHead(incoming.statusCode, incoming.headers)
    incoming.pipe(response)
  })
  upstream.on('error', (error) => {
    response.writeHead(502)
    response.end(error.code)
  })
  request.pipe(upstream)
}).listen(${appPort}, '100.64.0.1')
NODE
systemd-run --quiet --unit=app-loopback-forwarder /usr/local/bin/node /tmp/app-loopback-forwarder.cjs
`)
		await pRetry(
			async () => {
				const response = await umbreld.vm.sshAsRoot(
					'curl --silent --show-error --max-time 5 -i http://100.64.0.1:4000/',
				)
				expect(response).toContain('X-Test-Forwarder: tailnet')
				expect(response).toContain('ECONNREFUSED')
			},
			{retries: 30, minTimeout: 1000, maxTimeout: 1000},
		)
	})

	test('installs and restarts the app while the forwarder owns the same port', async () => {
		await umbreld.client.appStore.addRepository.mutate({url: gitServer.url.replace('localhost', '10.0.2.2')})
		await expect(umbreld.client.apps.install.mutate({appId})).resolves.toBe(true)
		await waitForApp()
		await umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: false})
		await umbreld.client.apps.restart.mutate({appId})
		await waitForApp()

		// This is the old report's failing operation. The in-process gateway no
		// longer needs a Docker wildcard publication that competes with serve.
		const containers = await umbreld.vm.sshAsRoot(
			`docker ps -a --filter label=com.docker.compose.project=${appId} --format '{{.Names}}'`,
		)
		expect(containers).toContain(`${appId}_server_1`)
		expect(containers).not.toContain('app_proxy')
		const response = await got(`http://127.0.0.1:${umbreld.vm.getHostPort(appPort)}/`)
		expect(response.body).toBe('Hello world')
	})

	test('serves the app to host-local clients and same-port forwarders', async () => {
		// A successful LAN request alone misses the regression: PREROUTING does
		// not handle connections originating on the Umbrel itself.
		const response = await umbreld.vm.sshAsRoot('curl --silent --show-error --max-time 5 -i http://100.64.0.1:4000/')
		expect(response).toContain('X-Test-Forwarder: tailnet')
		expect(response).toContain('HTTP/1.1 200 OK')
		expect(response).toContain('Hello world')
		await expect(
			umbreld.vm.sshAsRoot('curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4000/'),
		).resolves.toBe('Hello world')
	})

	test('uses the same HTTPS and authentication boundary on loopback', async () => {
		await expect(loopbackResponse(true)).resolves.toContain('Hello world')
		await umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: true})

		// Turning authentication back on must affect both local protocols and
		// requests relayed by the host forwarder, just as it does on the LAN.
		for (const https of [false, true]) {
			const response = await loopbackResponse(https)
			expect(response).toContain('HTTP/1.1 302 Found')
			expect(response).toContain(`${https ? 'https' : 'http'}://127.0.0.1:2000/app-auth?`)
			expect(response).not.toContain('Hello world')
		}
		const forwarded = await umbreld.vm.sshAsRoot('curl --silent --show-error --max-time 5 -i http://100.64.0.1:4000/')
		expect(forwarded).toContain('HTTP/1.1 302 Found')
		expect(forwarded).not.toContain('Hello world')
		await umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: false})
	})

	test('releases stopped app ports and recovers from a conflicting local listener', async () => {
		await umbreld.client.apps.stop.mutate({appId})
		await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'stopped'})
		await expect(loopbackResponse()).rejects.toThrow('exit code 7')
		// An existing loopback owner must not prevent the dashboard or LAN app
		// route from starting. This is a real bind, not a mocked EADDRINUSE.
		await umbreld.vm.sshAsRoot(`
set -eu
cat > /tmp/app-loopback-port-owner.cjs <<'NODE'
require('node:http').createServer((_request, response) => response.end('local port owner')).listen(${appPort}, '127.0.0.1')
NODE
systemd-run --quiet --unit=app-loopback-port-owner /usr/local/bin/node /tmp/app-loopback-port-owner.cjs
`)
		await pRetry(async () => expect(await loopbackResponse()).toContain('local port owner'))
		await umbreld.client.apps.start.mutate({appId})
		await waitForApp()
		await expect(loopbackResponse()).resolves.toContain('local port owner')
		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(true)
		expect((await got(`http://127.0.0.1:${umbreld.vm.getHostPort(appPort)}/`)).body).toBe('Hello world')

		await umbreld.vm.sshAsRoot('systemctl stop app-loopback-port-owner')
		// Normal periodic ingress refresh should recover without restarting the app.
		await pRetry(async () => expect(await loopbackResponse()).toContain('Hello world'), {
			retries: 90,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
	})

	test('restores loopback access after restarting umbreld while the forwarder remains running', async () => {
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.login()
		await waitForApp()
		await expect(loopbackResponse()).resolves.toContain('Hello world')
		await expect(loopbackResponse(true)).resolves.toContain('Hello world')
		const response = await umbreld.vm.sshAsRoot('curl --silent --show-error --max-time 5 -i http://100.64.0.1:4000/')
		expect(response).toContain('X-Test-Forwarder: tailnet')
		expect(response).toContain('Hello world')
	})

	test('preserves a host-network app without creating a Tor sidecar when Tor is enabled', async () => {
		await expect(umbreld.client.apps.install.mutate({appId: hostAppId})).resolves.toBe(true)
		await waitForApp(hostAppId)
		const hostContainer = await umbreld.vm.sshAsRoot(
			`docker ps --filter label=com.docker.compose.project=${hostAppId} --filter label=com.docker.compose.service=server --format '{{.ID}}'`,
		)
		expect(hostContainer).not.toBe('')
		await expect(
			umbreld.vm.sshAsRoot(`docker inspect --format '{{.HostConfig.NetworkMode}}' ${hostContainer}`),
		).resolves.toBe('host')

		// This restarts installed apps through the public product API. Only the
		// proxied app should get a hidden service; a host-network app has no
		// app_proxy target and must continue to serve its own socket.
		await expect(umbreld.client.apps.setTorEnabled.mutate(true)).resolves.toBe(true)
		await waitForApp()
		await waitForApp(hostAppId)
		const torServices = (id: string) =>
			umbreld.vm.sshAsRoot(
				`docker ps -a --filter label=com.docker.compose.project=${id} --filter label=com.docker.compose.service=tor_server --format '{{.State}}'`,
			)
		await expect(torServices(appId)).resolves.toBe('running')
		await expect(torServices(hostAppId)).resolves.toBe('')
		await expect(
			umbreld.vm.sshAsRoot(`curl --fail --silent --show-error --max-time 5 http://127.0.0.1:${hostAppPort}/`),
		).resolves.toBe('Host network app')
		expect((await got(`http://127.0.0.1:${umbreld.vm.getHostPort(hostAppPort)}/`)).body).toBe('Host network app')
		await expect(loopbackResponse()).resolves.toContain('Hello world')
	})
})
