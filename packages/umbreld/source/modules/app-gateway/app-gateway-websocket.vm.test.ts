import {setTimeout as sleep} from 'node:timers/promises'

import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import got from 'got'
import pRetry from 'p-retry'
import {WebSocket} from 'ws'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

type TestVm = Awaited<ReturnType<typeof createTestVm>>
type UpstreamStats = {connections: number; open: number; paths: string[]}

const APP_ID = 'gateway-websocket-auth'
const APP_PORT = 9096
const UPSTREAM_PORT = 19096
const UPSTREAM_STATS_PORT = 19097
const OWNER_PASSWORD = 'moneyprintergobrrr'
const MEMBER_PASSWORD = 'runningbitcoin'

// Covers app WebSocket proxying through the app gateway. The gateway proxies
// normal HTTP requests too, so most checks here run after it has already
// proxied HTTP traffic for the app.
describe.sequential('App gateway WebSockets', () => {
	let umbreld: TestVm
	let appPort: number
	let ownerAppCookie: string
	let memberUserId: string
	let memberAppCookie: string

	beforeAll(async () => {
		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: [{guestPort: APP_PORT}],
		})
		await umbreld.vm.powerOn()
		appPort = umbreld.vm.getHostPort(APP_PORT)
		await umbreld.registerAndLogin()

		const member = await umbreld.client.user.createUser.mutate({name: 'hal', password: MEMBER_PASSWORD})
		memberUserId = member.userId

		await setupTestApp(umbreld)
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.waitForStartup()
		await umbreld.login()

		ownerAppCookie = await loginAppCookie({password: OWNER_PASSWORD})
		memberAppCookie = await loginAppCookie({userId: memberUserId, password: MEMBER_PASSWORD})
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	test('proxies owner WebSockets before the gateway has proxied any HTTP request', async () => {
		const socket = await pRetry(() => openAppWebSocket('/socket', ownerAppCookie), {
			retries: 60,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		await expectEcho(socket)
	})

	test('proxies owner HTTP requests and WebSockets without forwarding auth cookies', async () => {
		const response = await got(`http://127.0.0.1:${appPort}/private`, {
			headers: {cookie: `${ownerAppCookie}; app-cookie=preserved`},
			retry: {limit: 0},
		}).json<{url: string; cookie?: string}>()
		expect(response.url).toBe('/private')
		expect(response.cookie).toBe('app-cookie=preserved')

		const socket = await openAppWebSocket('/socket', `${ownerAppCookie}; app-cookie=preserved`)
		expect(socket.upgradeCookie).toBe('app-cookie=preserved')
		await expectEcho(socket)
	})

	test('proxies WebSockets on whitelisted paths without a session', async () => {
		const socket = await openAppWebSocket('/public/socket')
		await expectEcho(socket)
	})

	test('responds 401 to WebSockets without a session', async () => {
		await resetUpstreamStats()
		for (let attempt = 0; attempt < 10; attempt++) {
			await expectWebSocketRejected('/socket')
			await expectWebSocketRejected('/socket', 'UMBREL_APP_SESSION=umbrel_invalid')
		}
		await expectNoAppConnections()
	})

	test('responds 401 to member WebSockets for apps that are not shared with them', async () => {
		await resetUpstreamStats()
		for (let attempt = 0; attempt < 10; attempt++) {
			await expectWebSocketRejected('/socket', memberAppCookie)
		}
		await expectNoAppConnections()
	})

	test('proxies member WebSockets once the app is shared with them', async () => {
		await umbreld.client.apps.addMemberShare.mutate({appId: APP_ID, sharedWith: [memberUserId]})
		const socket = await openAppWebSocket('/socket', memberAppCookie)
		await expectEcho(socket)
	})

	async function loginAppCookie(credentials: {userId?: string; password: string}) {
		const login = await umbreld.unauthenticatedApi.post('../trpc/user.login', {json: credentials})
		const cookie = (login.headers['set-cookie'] ?? [])
			.find((value) => value.startsWith('UMBREL_APP_SESSION='))
			?.split(';')[0]
		if (!cookie) throw new Error('Login did not set UMBREL_APP_SESSION')
		return cookie
	}

	// Resolves once the app has echoed its greeting, which carries the cookie
	// header the app received on the upgrade request
	function openAppWebSocket(path: string, cookie?: string) {
		return new Promise<WebSocket & {upgradeCookie?: string}>((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${appPort}${path}`, {
				headers: cookie ? {cookie} : undefined,
			}) as WebSocket & {upgradeCookie?: string}
			const timeout = setTimeout(() => {
				socket.terminate()
				reject(new Error(`App WebSocket ${path} did not open`))
			}, 10_000)
			socket.once('message', (data) => {
				clearTimeout(timeout)
				socket.upgradeCookie = JSON.parse(String(data)).cookie
				resolve(socket)
			})
			socket.once('unexpected-response', (_request, response) => {
				clearTimeout(timeout)
				response.resume()
				reject(new Error(`App WebSocket ${path} rejected with ${response.statusCode}`))
			})
			socket.once('error', (error) => {
				clearTimeout(timeout)
				reject(error)
			})
		})
	}

	async function expectEcho(socket: WebSocket) {
		const echoed = new Promise<string>((resolve) => socket.once('message', (data) => resolve(String(data))))
		socket.send('ping')
		await expect(echoed).resolves.toBe('echo:ping')
		socket.close()
	}

	async function expectWebSocketRejected(path: string, cookie?: string) {
		await expect(
			new Promise<number | undefined>((resolve, reject) => {
				const socket = new WebSocket(`ws://127.0.0.1:${appPort}${path}`, {
					headers: cookie ? {cookie} : undefined,
				})
				socket.once('unexpected-response', (_request, response) => {
					response.resume()
					response.once('end', () => resolve(response.statusCode))
				})
				socket.once('open', () => {
					socket.terminate()
					reject(new Error(`WebSocket ${path} unexpectedly opened`))
				})
				socket.once('error', () => {})
			}),
		).resolves.toBe(401)
	}

	async function resetUpstreamStats() {
		await umbreld.vm.sshAsRoot(`curl --silent --fail --request POST http://127.0.0.1:${UPSTREAM_STATS_PORT}/reset`)
	}

	// Give upgrades time to settle before reading the app's connection counters
	async function expectNoAppConnections() {
		await sleep(2000)
		const stats = JSON.parse(
			await umbreld.vm.sshAsRoot(`curl --silent --fail http://127.0.0.1:${UPSTREAM_STATS_PORT}/`),
		) as UpstreamStats
		expect(stats).toEqual({connections: 0, open: 0, paths: []})
	}
})

// Install an app_proxy app with auth enabled whose upstream is a host-side
// WebSocket echo server, without pulling a real app from the app store. The
// server exposes its connection counters on a separate loopback-only port.
async function setupTestApp(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot(`
set -eu

app_dir="/home/umbrel/umbrel/app-data/${APP_ID}"
mkdir -p "$app_dir"

cat > "$app_dir/umbrel-app.yml" <<YAML
manifestVersion: 1.0.0
id: ${APP_ID}
name: Gateway WebSocket Auth
tagline: Test app
category: Development
version: "1.0.0"
port: ${APP_PORT}
description: Test app
website: https://umbrel.com
support: https://umbrel.com
gallery: []
YAML

cat > "$app_dir/docker-compose.yml" <<YAML
services:
  app_proxy:
    environment:
      APP_HOST: 10.21.0.1
      APP_PORT: ${UPSTREAM_PORT}
      PROXY_AUTH_ADD: "true"
      PROXY_AUTH_WHITELIST: /public/*
  keepalive:
    image: ghcr.io/getumbrel/tor:0.4.9.14
    command: ["sleep", "infinity"]
YAML

cat > /tmp/gateway-websocket-test-server.js <<'JS'
const http = require('http')
const {WebSocketServer} = require('/opt/umbreld/node_modules/ws')

let stats = {connections: 0, open: 0, paths: []}

const server = http.createServer((request, response) => {
	response.setHeader('content-type', 'application/json')
	response.end(JSON.stringify({url: request.url, cookie: request.headers.cookie}))
})
const sockets = new WebSocketServer({noServer: true})
server.on('upgrade', (request, socket, head) => {
	sockets.handleUpgrade(request, socket, head, (websocket) => {
		stats.connections++
		stats.open++
		stats.paths.push(request.url)
		websocket.once('close', () => stats.open--)
		websocket.on('message', (data) => websocket.send('echo:' + data))
		websocket.send(JSON.stringify({cookie: request.headers.cookie}))
	})
})
server.listen(${UPSTREAM_PORT}, '0.0.0.0')

http
	.createServer((request, response) => {
		if (request.method === 'POST') stats = {connections: 0, open: stats.open, paths: []}
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify(stats))
	})
	.listen(${UPSTREAM_STATS_PORT}, '127.0.0.1')
JS

node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) || {}
store.apps = ['${APP_ID}']
fs.writeFileSync(storePath, yaml.dump(store))
NODE

nohup node /tmp/gateway-websocket-test-server.js >/tmp/gateway-websocket-test-server.log 2>&1 &
`)
}
