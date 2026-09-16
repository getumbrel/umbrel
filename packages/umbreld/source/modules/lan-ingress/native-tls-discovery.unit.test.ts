import https from 'node:https'
import net from 'node:net'
import {once} from 'node:events'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {AppGatewayConfig} from '../app-gateway/app-gateway.js'
import type {NativeTlsPolicy} from '../apps/native-tls.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import LanIngress from './lan-ingress.js'

type Route = {
	id: string
	publicPort: number
	hiddenPort: number
	gateway?: AppGatewayConfig
	nativeTls?: NativeTlsPolicy
}
type Candidate = Omit<Route, 'hiddenPort'>
type IngressInternals = {
	getAppIngressCandidates(reservedHostnames: string[]): Promise<{routes: Candidate[]; reservedPorts: number[]}>
	getAppRoutes(reservedHostnames: string[]): Promise<Route[]>
	updateAppMuxServers(routes: Route[]): Promise<void>
	createHttpsProxyServer(...args: unknown[]): Promise<https.Server>
	createMuxServer(options: {
		listenPort: number
		httpPort: number
		getHttpsProxyServer: () => https.Server | undefined
		nativeTls?: NativeTlsPolicy
	}): net.Server
	listen(server: net.Server, port: number, host?: string): Promise<void>
}

const hostNetworkCompose = {services: {server: {network_mode: 'host', ports: ['23000:8080']}}}
const nativeTlsHostnameSuffixes = ['plex.direct']
const reservedHostnames = ['localhost', 'umbrel.local']

describe('native TLS installed-app discovery', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let ingress: IngressInternals
	let installedAppIds: string[]
	let instances: Array<{id: string; state: string}>
	let authOverrides: Map<string, boolean>
	const clients: net.Socket[] = []

	beforeEach(async () => {
		directory = temporaryDirectory()
		dataDirectory = await directory.create()
		installedAppIds = []
		instances = []
		authOverrides = new Map()
		const logger = {createChildLogger: () => logger, log: vi.fn(), error: vi.fn(), verbose: vi.fn()}
		ingress = new LanIngress({
			dataDirectory,
			logger,
			store: {get: async () => installedAppIds},
			apps: {
				instances,
				getApp: (id: string) => ({getAppProxyAuthOverride: async () => authOverrides.get(id)}),
			},
		} as never) as unknown as IngressInternals
	})

	afterEach(async () => {
		for (const client of clients.splice(0)) client.destroy()
		await ingress.updateAppMuxServers([])
		vi.restoreAllMocks()
		await directory.destroyRoot()
	})

	async function writeApp({
		id = 'native-app',
		port = 32400,
		metadata = {},
		compose = hostNetworkCompose,
		installed = true,
	}: {id?: string; port?: number; metadata?: Record<string, unknown>; compose?: unknown; installed?: boolean} = {}) {
		const appDirectory = `${dataDirectory}/app-data/${id}`
		await fse.ensureDir(appDirectory)
		await fse.writeFile(`${appDirectory}/umbrel-app.yml`, yaml.dump({id, name: id, port, ...metadata}))
		await fse.writeFile(`${appDirectory}/docker-compose.yml`, yaml.dump(compose))
		if (installed && !installedAppIds.includes(id)) installedAppIds.push(id)
		return appDirectory
	}

	async function connect(server: net.Server) {
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Expected a listening TCP mux')
		const client = net.createConnection({host: '127.0.0.1', port: address.port})
		clients.push(client)
		client.on('error', () => {})
		client.resume()
		await once(client, 'connect')
		return client
	}

	function useEphemeralListeners() {
		// Reconciliation and mux sockets are real; certificate generation and fixed
		// production port ownership are covered by the VM tests instead.
		vi.spyOn(ingress, 'createHttpsProxyServer').mockImplementation(async () => https.createServer())
		const listen = ingress.listen.bind(ingress)
		vi.spyOn(ingress, 'listen').mockImplementation((server) => listen(server, 0, '127.0.0.1'))
		return vi.spyOn(ingress, 'createMuxServer')
	}

	test('keeps native TLS off by default and reserves published ports for hidden-listener allocation', async () => {
		await writeApp()
		const candidates = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(candidates.routes).toEqual([{id: 'native-app', publicPort: 32400}])
		expect(candidates.reservedPorts).toEqual(expect.arrayContaining([32400, 23000]))
		const routes = await ingress.getAppRoutes(reservedHostnames)
		expect(routes).toHaveLength(1)
		expect(candidates.reservedPorts).not.toContain(routes[0].hiddenPort)
	})

	test.each([
		{name: 'host networking', compose: hostNetworkCompose},
		{name: 'a published browser port', compose: {services: {server: {ports: ['32400:8080']}}}},
	])('discovers native TLS from installed metadata for $name', async ({compose}) => {
		await writeApp({compose, metadata: {nativeTlsHostnameSuffixes: ['PLEX.DIRECT', 'plex.direct']}})
		const {routes} = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(routes).toHaveLength(1)
		expect(routes[0]).toMatchObject({
			id: 'native-app',
			publicPort: 32400,
			nativeTls: {hostnameSuffixes: ['plex.direct'], reservedHostnames},
		})
		expect(routes[0].gateway).toBeUndefined()
	})

	test('invalid native metadata preserves the existing route and port reservations', async () => {
		await writeApp()
		const before = await ingress.getAppIngressCandidates(reservedHostnames)
		await writeApp({metadata: {nativeTlsHostnameSuffixes: ['plex.direct', '*.example.com']}})
		expect(await ingress.getAppIngressCandidates(reservedHostnames)).toEqual(before)
	})

	test('invalid native metadata preserves the gateway authentication override', async () => {
		const compose = {
			services: {
				app_proxy: {environment: {APP_HOST: '127.0.0.1', APP_PORT: 8080}},
				server: {ports: ['23000:8080']},
			},
		}
		authOverrides.set('native-app', false)
		await writeApp({compose})
		const before = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(before.routes[0].gateway?.auth).toBe(false)
		await writeApp({compose, metadata: {nativeTlsHostnameSuffixes: ['plex.direct', 'invalid']}})
		expect(await ingress.getAppIngressCandidates(reservedHostnames)).toEqual(before)
	})

	test.each([
		{name: 'null', value: null},
		{name: 'false', value: false},
		{name: 'an empty service', value: {}},
		{name: 'a scalar', value: 'invalid'},
		{name: 'a missing target port', value: {environment: {APP_HOST: '127.0.0.1'}}},
		{
			name: 'disabled gateway authentication',
			value: {environment: {APP_HOST: '127.0.0.1', APP_PORT: 8080, PROXY_AUTH_ADD: 'false'}},
		},
	])('a raw app_proxy key excludes native TLS with $name', async ({value}) => {
		const compose = {services: {...hostNetworkCompose.services, app_proxy: value}}
		const appDirectory = await writeApp({compose})
		const before = await ingress.getAppIngressCandidates(reservedHostnames)
		await writeApp({compose, metadata: {nativeTlsHostnameSuffixes}})
		// Runtime Compose lacks app_proxy; eligibility must use the package declaration.
		await fse.writeFile(`${appDirectory}/docker-compose.umbreld.yml`, yaml.dump(hostNetworkCompose))
		const after = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(after).toEqual(before)
		expect(after.routes.every((route) => route.nativeTls === undefined)).toBe(true)
	})

	test('metadata cannot make an app without a direct listener eligible', async () => {
		await writeApp({metadata: {nativeTlsHostnameSuffixes}, compose: {services: {server: {ports: ['31000:8080']}}}})
		const {routes, reservedPorts} = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(routes).toEqual([])
		expect(reservedPorts).toEqual(expect.arrayContaining([32400, 31000]))
	})

	test('stopped and uninstalling apps retain port reservations while orphaned packages stay unrouted', async () => {
		await writeApp({id: 'stopped-app', port: 32400, metadata: {nativeTlsHostnameSuffixes}})
		await writeApp({id: 'uninstalling-app', port: 32401, metadata: {nativeTlsHostnameSuffixes}})
		await writeApp({id: 'orphan-app', port: 32402, metadata: {nativeTlsHostnameSuffixes}, installed: false})
		await writeApp({id: 'installing-app', port: 32403, metadata: {nativeTlsHostnameSuffixes}, installed: false})
		instances.push(
			{id: 'stopped-app', state: 'stopped'},
			{id: 'uninstalling-app', state: 'uninstalling'},
			{id: 'installing-app', state: 'installing'},
		)
		const {routes, reservedPorts} = await ingress.getAppIngressCandidates(reservedHostnames)
		expect(routes.map((route) => route.id)).toEqual(['installing-app'])
		expect(routes[0].nativeTls?.hostnameSuffixes).toEqual(['plex.direct'])
		expect(reservedPorts).toEqual(expect.arrayContaining([32400, 32401, 32403]))
		expect(reservedPorts).not.toContain(32402)
	})

	test('policy addition, change, invalidation and removal replace the mux and cancel accepted connections', async () => {
		const createMux = useEphemeralListeners()
		await writeApp()
		await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
		let previous = createMux.mock.results.at(-1)!.value
		for (const metadata of [
			{nativeTlsHostnameSuffixes},
			{nativeTlsHostnameSuffixes: ['another.example']},
			{nativeTlsHostnameSuffixes: ['*.invalid.example']},
			{nativeTlsHostnameSuffixes},
			{},
		]) {
			const client = await connect(previous)
			const closed = once(client, 'close')
			await writeApp({metadata})
			await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
			await closed
			expect(previous.listening).toBe(false)
			const replacement = createMux.mock.results.at(-1)!.value
			expect(replacement).not.toBe(previous)
			expect(replacement.listening).toBe(true)
			previous = replacement
		}
		expect(createMux).toHaveBeenCalledTimes(6)
	})

	test('reserved-name changes revoke the native mux without disturbing unrelated routes', async () => {
		const createMux = useEphemeralListeners()
		await writeApp({metadata: {nativeTlsHostnameSuffixes}})
		await writeApp({id: 'ordinary-app', port: 32401})
		await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
		const nativeServer = createMux.mock.results[0].value
		const ordinaryServer = createMux.mock.results[1].value
		const nativeClient = await connect(nativeServer)
		const ordinaryClient = await connect(ordinaryServer)
		const nativeClosed = once(nativeClient, 'close')
		// Periodic refresh with unchanged policy must not disconnect either app.
		await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
		expect(createMux).toHaveBeenCalledTimes(2)
		expect(nativeClient.destroyed).toBe(false)
		await ingress.updateAppMuxServers(await ingress.getAppRoutes([...reservedHostnames, 'new.plex.direct']))
		await nativeClosed
		expect(createMux).toHaveBeenCalledTimes(3)
		expect(nativeServer.listening).toBe(false)
		expect(ordinaryServer.listening).toBe(true)
		expect(ordinaryClient.destroyed).toBe(false)
	})

	test('adding a gateway closes the previous native route even when its metadata remains', async () => {
		const createMux = useEphemeralListeners()
		await writeApp({metadata: {nativeTlsHostnameSuffixes}})
		await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
		const nativeServer = createMux.mock.results[0].value
		const client = await connect(nativeServer)
		const closed = once(client, 'close')
		await writeApp({
			metadata: {nativeTlsHostnameSuffixes},
			compose: {
				services: {
					...hostNetworkCompose.services,
					app_proxy: {environment: {APP_HOST: '127.0.0.1', APP_PORT: 8080}},
				},
			},
		})
		const routes = await ingress.getAppRoutes(reservedHostnames)
		expect(routes[0].nativeTls).toBeUndefined()
		expect(routes[0].gateway?.auth).toBe(true)
		await ingress.updateAppMuxServers(routes)
		await closed
		expect(nativeServer.listening).toBe(false)
		expect(createMux.mock.results.at(-1)!.value.listening).toBe(true)
	})

	test.each(['stopped', 'uninstalling'])(
		'the %s lifecycle state closes the native listener and pending reader',
		async (state) => {
			const createMux = useEphemeralListeners()
			await writeApp({metadata: {nativeTlsHostnameSuffixes}})
			const instance = {id: 'native-app', state: 'ready'}
			instances.push(instance)
			await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
			const server = createMux.mock.results[0].value
			const client = await connect(server)
			const closed = once(client, 'close')
			instance.state = state
			await ingress.updateAppMuxServers(await ingress.getAppRoutes(reservedHostnames))
			await closed
			expect(server.listening).toBe(false)
			expect(createMux).toHaveBeenCalledTimes(1)
		},
	)
})
