import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import {X509Certificate} from 'node:crypto'
import {lookup} from 'node:dns/promises'
import {rename} from 'node:fs/promises'

import {$} from 'execa'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {createProxyMiddleware, type RequestHandler} from 'http-proxy-middleware'

import type Umbreld from '../../index.js'
import randomToken from '../utilities/random-token.js'
import {getHostname, getIpAddresses} from '../system/system.js'
import runEvery from '../utilities/run-every.js'
import AppGateway, {readAppGatewayConfig, type AppGatewayConfig} from '../app-gateway/app-gateway.js'

const NFT_BIN = '/usr/sbin/nft'

// This table contains only Umbrel-owned LAN ingress rules. App ports stay
// owned by apps; nftables redirects inbound LAN traffic to hidden Node listeners.
const NFT_TABLE_NAME = 'umbrel_lan_ingress'
const APP_AUTH_PUBLIC_PORT = 2000
const HIDDEN_INGRESS_PORT_START = 23_000
const HIDDEN_INGRESS_PORT_END = 65_535
const APP_TARGET_RECOVERY_RETRY_DELAYS = [0, 250, 1000, 2000]
const APP_TARGET_RECOVERY_COOLDOWN = 10_000
const APP_UPSTREAM_READY_RETRY_DELAYS = [0, 250, 1000, 2000, 4000, 8000, 16_000]
const APP_UPSTREAM_CONNECT_TIMEOUT = 1000
const SERVER_CLOSE_GRACE_MS = 2000
const IDLE_CONNECTION_SWEEP_MS = 100

type AppIngressRoute = {
	id: string
	publicPort: number
	hiddenPort: number
	gateway?: AppGatewayConfig
}

type IngressPortMapping = {
	publicPort: number
	hiddenPort: number
}

type UmbrelProxyOptions = {
	includeForwardedFor?: boolean
	pathPrefix?: string
	redirectUnexpectedAppAuthNavigation?: boolean
}

type AppMuxServer = {
	route: AppIngressRoute
	server: net.Server
	httpsProxyServer?: https.Server
	gatewayServer?: http.Server
}

type ComposeFile = {
	services?: Record<
		string,
		{
			container_name?: unknown
			hostname?: unknown
			network_mode?: unknown
			ports?: unknown
		}
	>
}

export function appAuthDashboardRedirect({
	protocol,
	host,
	url,
	method,
	accept,
}: {
	protocol: 'http' | 'https'
	host?: string
	url?: string
	method?: string
	accept?: string
}) {
	// This is a convenience redirect for browser navigations, not an API rule.
	if (method !== 'GET' || !accept?.toLowerCase().includes('text/html') || !host) return

	try {
		// Never let the request target choose the redirect authority. In particular,
		// a request target beginning with // is a protocol-relative URL to URL().
		const target = new URL(`${protocol}://${host}`)
		// Tor exposes this listener as port 80 on a dedicated hidden service and
		// forwards to port 2000 internally. Only redirect when the browser itself
		// used :2000, otherwise the auth onion would redirect back to itself.
		if (target.port !== APP_AUTH_PUBLIC_PORT.toString()) return

		const requestTarget = new URL(url ?? '/', 'http://request.invalid')
		if (requestTarget.pathname === '/app-auth' || requestTarget.pathname.startsWith('/app-auth/')) return

		target.pathname = requestTarget.pathname
		target.search = requestTarget.search
		target.port = ''
		return target.toString()
	} catch {
		return
	}
}

export default class LanIngress {
	#umbreld: Umbreld
	#stopPeriodicRefresh?: () => void
	#refreshPromise?: Promise<void>
	#refreshQueued = false
	#appTargetRecoveries = new Map<string, Promise<void>>()
	#nextAppTargetRecoveryAt = new Map<string, number>()
	#isStopped = true
	#dashboardHttpServer?: http.Server
	#dashboardHttpsServer?: https.Server
	#appAuthMuxServer?: net.Server
	#appAuthHttpProxyServer?: http.Server
	#appAuthHttpsProxyServer?: https.Server
	#appMuxServers = new Map<string, AppMuxServer>()
	// Track sockets at the TCP layer because Node's HTTP force-close helper does not cover
	// upgraded/raw sockets, and the mux servers are plain net.Server instances.
	#activeSocketsByServer = new WeakMap<net.Server | http.Server, Set<net.Socket>>()
	#upgradedSocketsByServer = new WeakMap<net.Server | http.Server, Set<net.Socket>>()
	logger: Umbreld['logger']
	directory: string
	caCertificatePath: string
	caKeyPath: string
	serverCertificatePath: string
	serverKeyPath: string
	serverSansPath: string

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.directory = `${umbreld.dataDirectory}/lan-ingress`
		this.caCertificatePath = `${this.directory}/ca.pem`
		this.caKeyPath = `${this.directory}/ca.key`
		this.serverCertificatePath = `${this.directory}/server.pem`
		this.serverKeyPath = `${this.directory}/server.key`
		this.serverSansPath = `${this.directory}/server-sans.json`
	}

	async start() {
		// LAN ingress starts before the internal server binds, so it can only proxy to a
		// fixed, known server port. Port 0 means an ephemeral port (used by integration
		// tests), where there is no knowable upstream and binding public ports or
		// applying nftables rules is not wanted.
		if (this.#umbreld.port === 0) {
			this.logger.log('Skipping LAN ingress; umbreld is using an ephemeral server port')
			return
		}
		this.logger.log('Starting LAN ingress')
		this.#isStopped = false
		try {
			// Umbreld starts LAN ingress before the internal server/apps. Do the
			// first refresh synchronously so public listeners, certs, and app-port
			// nftables rules exist before browser/app traffic starts flowing.
			await this.refresh()
			if (this.#isStopped) return

			// Keep cert SANs and app-port routes converged even when IPs, Avahi names,
			// or app state change outside the normal app lifecycle hooks.
			this.#stopPeriodicRefresh = runEvery(
				'1 minute',
				async () => {
					try {
						await this.refresh()
					} catch (error) {
						this.logger.error('Failed to refresh LAN ingress', error)
					}
				},
				{runInstantly: false},
			)
		} catch (error) {
			// Initial refresh is required for LAN reachability. If it fails, we clean up
			// any partial listeners/nftables rules and let umbreld startup fail.
			await this.stop()
			throw error
		}
	}

	async stop() {
		// Nothing to clean up when LAN ingress never started (e.g. ephemeral server port).
		if (this.#isStopped) return
		this.logger.log('Stopping LAN ingress')
		this.#isStopped = true
		this.#stopPeriodicRefresh?.()
		this.#stopPeriodicRefresh = undefined
		this.#nextAppTargetRecoveryAt.clear()
		// Let any in-flight refresh finish before cleanup. Otherwise a refresh could
		// re-create listeners or re-apply nftables after stop() has cleared them.
		await this.#refreshPromise?.catch((error) =>
			this.logger.error('Failed to finish LAN ingress refresh before stop', error),
		)
		await this.closeAllServers()
		await this.applyNftRuleset([]).catch((error) =>
			this.logger.error('Failed to clear LAN ingress nftables rules', error),
		)
	}

	async resetCa() {
		// Removing the CA invalidates any certificate users have installed.
		// The next refresh creates a fresh CA and server certificate pair.
		await Promise.all([
			fse.remove(this.caCertificatePath),
			fse.remove(this.caKeyPath),
			fse.remove(`${this.directory}/ca.srl`),
			fse.remove(this.serverCertificatePath),
			fse.remove(this.serverKeyPath),
			fse.remove(this.serverSansPath),
		])
		await this.refresh()
		return this.getCertificateStatus()
	}

	async getCertificateStatus() {
		const caCertificate = await this.getCaCertificate().catch(() => '')
		let caFingerprint = ''
		let caExpiresAt = ''
		if (caCertificate) {
			try {
				const parsedCertificate = new X509Certificate(caCertificate)
				caFingerprint = parsedCertificate.fingerprint256
				const date = new Date(parsedCertificate.validTo)
				caExpiresAt = Number.isNaN(date.getTime()) ? '' : date.toISOString()
			} catch {
				// Leave the fields empty if the certificate on disk is unparseable
			}
		}
		// DNS names/IPs the server certificate is valid for.
		const serverSans = await this.getServerSans()

		return {
			caCertificate,
			caExpiresAt,
			caFingerprint,
			serverSans,
		}
	}

	async getCaCertificate() {
		return fse.readFile(this.caCertificatePath, 'utf8')
	}

	// Queue a refresh of LAN ingress state; callers share the running refresh promise.
	async refresh() {
		if (this.#isStopped) return
		this.#refreshQueued = true
		this.#refreshPromise ??= this.drainRefreshRequests().finally(() => {
			this.#refreshPromise = undefined
		})
		return this.#refreshPromise
	}

	async waitForAppUpstream(appId: string) {
		try {
			const appDataDirectory = `${this.#umbreld.dataDirectory}/app-data/${appId}`
			const compose = await fse
				.readFile(`${appDataDirectory}/docker-compose.yml`, 'utf8')
				.then((contents) => yaml.load(contents) as ComposeFile | null)
			const gateway = compose ? await readAppGatewayConfig(appId, appDataDirectory, compose as any) : null

			// Apps without the app-proxy contract have no generic internal upstream to probe.
			if (!gateway) return

			let targetAddress: string | null = null
			for (const retryDelay of APP_UPSTREAM_READY_RETRY_DELAYS) {
				if (retryDelay) await new Promise((resolve) => setTimeout(resolve, retryDelay))
				targetAddress ??= await this.resolveAppTarget(appId, gateway.targetHost, compose)
				if (targetAddress && (await this.isTcpPortOpen(targetAddress, gateway.targetPort))) return
			}

			this.logger.verbose(`App gateway upstream for ${appId} is still unavailable`)
		} catch (error) {
			this.logger.error(`Failed to wait for app gateway upstream for ${appId}`, error)
		}
	}

	// Many app lifecycle events can request a refresh at the same time during boot. Running every
	// request would repeatedly recreate listeners/nftables rules with short-lived intermediate app states.
	// applyCurrentState() always rebuilds the full desired state from disk/current app state, so concurrent
	// requests can share the running refresh. If any request arrives while a refresh is running, we run
	// one trailing refresh afterwards to converge on changes that happened after the first snapshot.
	private async drainRefreshRequests() {
		let lastError: unknown
		do {
			if (this.#isStopped) return
			this.#refreshQueued = false
			try {
				await this.applyCurrentState()
				lastError = undefined
			} catch (error) {
				lastError = error
			}
		} while (this.#refreshQueued && !this.#isStopped)
		if (lastError) throw lastError
	}

	// Rebuild certs, routes, nftables rules, and listeners from current state.
	private async applyCurrentState() {
		await fse.ensureDir(this.directory)
		await this.ensureServerCertificate()

		const nextAppRoutes = this.removeConflictingAppRoutes(await this.getAppRoutes())
		const currentAppRoutes = [...this.#appMuxServers.values()].map((entry) => entry.route)
		const guardedPortMappings = this.mergePortMappingsByHiddenPort(currentAppRoutes, nextAppRoutes)
		// Hidden Node listeners bind on wildcard addresses so nftables can redirect LAN
		// traffic to them. Protect both old and new hidden ports before changing listeners.
		await this.applyNftRuleset(nextAppRoutes, guardedPortMappings)
		await this.updateListeners(nextAppRoutes)
		await this.applyNftRuleset(nextAppRoutes)
	}

	private async getServerSans() {
		const names = new Set(['umbrel.local', 'localhost'])
		const hostname = await getHostname().catch(() => 'umbrel')
		if (hostname) {
			names.add(hostname)
			names.add(`${hostname}.local`)
		}
		// Avahi can publish a collision-resolved name like umbrel-2.local even if
		// /etc/hostname is still umbrel. Include the actual advertised name too.
		const avahiHostname = await this.getAvahiHostnameFqdn()
		if (avahiHostname) names.add(avahiHostname)
		if (this.#umbreld.developmentMode) names.add('umbrel-dev.local')

		// Only include IPv4 addresses here. Hostname certs still cover IPv6 hostname access,
		// while direct LAN IPv6 literals are intentionally not first-class due to address churn,
		// link-local zone IDs, and poor UX. Note this includes VPN/tunnel interface IPs
		// (e.g. Tailscale's 100.64.0.0/10 address in kernel TUN mode), which is deliberate:
		// ingress listens on all interfaces, so users who install the Umbrel CA get valid
		// HTTPS over VPN access too.
		const ips = new Set(['127.0.0.1', ...getIpAddresses()])

		return {
			dns: [...names].sort(),
			ips: [...ips].sort(),
		}
	}

	private async getAvahiHostnameFqdn() {
		const {exitCode, stdout} = await $({
			reject: false,
		})`busctl call org.freedesktop.Avahi / org.freedesktop.Avahi.Server GetHostNameFqdn`
		if (exitCode !== 0) return ''

		const hostname = stdout.match(/^s "(.+)"$/)?.[1]?.replace(/\.$/, '')
		return hostname && /^[a-z0-9.-]+$/i.test(hostname) ? hostname : ''
	}

	private async ensureCa() {
		await fse.ensureDir(this.directory)
		if ((await fse.pathExists(this.caCertificatePath)) && (await fse.pathExists(this.caKeyPath))) return

		const subject = '/O=Umbrel/CN=Umbrel Local HTTPS CA'
		await $`openssl req -x509 -newkey rsa:4096 -nodes -keyout ${this.caKeyPath} -out ${this.caCertificatePath} -days 3650 -sha256 -subj ${subject} -addext basicConstraints=critical,CA:TRUE,pathlen:0 -addext keyUsage=critical,keyCertSign,cRLSign -addext subjectKeyIdentifier=hash`
		await fse.chmod(this.caKeyPath, 0o600)
		await fse.chmod(this.caCertificatePath, 0o644)
	}

	private async ensureServerCertificate() {
		await this.ensureCa()

		const sans = await this.getServerSans()
		const previousSans = await fse.readJson(this.serverSansPath).catch(() => null)
		const serverCertificateExists =
			(await fse.pathExists(this.serverCertificatePath)) && (await fse.pathExists(this.serverKeyPath))
		const serverCertificateFresh = serverCertificateExists
			? await this.isCertificateValidFor(this.serverCertificatePath, 7 * 24 * 60 * 60).catch(() => false)
			: false
		// Server certs are cheap and short-lived. Reissue when the hostname/IP SANs
		// change or when the current cert is within a week of expiry.
		if (serverCertificateFresh && JSON.stringify(previousSans) === JSON.stringify(sans)) return

		const tempPrefix = `${this.directory}/server-${randomToken(16)}`
		const extPath = `${tempPrefix}.conf`
		const csrPath = `${tempPrefix}.csr`
		const keyPath = `${tempPrefix}.key`
		const certPath = `${tempPrefix}.pem`
		const sanEntries = [...sans.dns.map((name) => `DNS:${name}`), ...sans.ips.map((ip) => `IP:${ip}`)].join(',')

		try {
			await fse.writeFile(
				extPath,
				[
					'[req]',
					'distinguished_name = req_distinguished_name',
					'req_extensions = v3_req',
					'prompt = no',
					'',
					'[req_distinguished_name]',
					'O = Umbrel',
					'CN = umbrel.local',
					'',
					'[v3_req]',
					'keyUsage = critical, digitalSignature, keyEncipherment',
					'extendedKeyUsage = serverAuth',
					`subjectAltName = ${sanEntries}`,
					'',
				].join('\n'),
			)

			await $`openssl genrsa -out ${keyPath} 2048`
			await $`openssl req -new -key ${keyPath} -out ${csrPath} -config ${extPath}`
			await $`openssl x509 -req -in ${csrPath} -CA ${this.caCertificatePath} -CAkey ${this.caKeyPath} -CAcreateserial -out ${certPath} -days 30 -sha256 -extensions v3_req -extfile ${extPath}`

			await rename(keyPath, this.serverKeyPath)
			await rename(certPath, this.serverCertificatePath)
			// Record SANs only after the key/cert pair is in place. If we crash before
			// this write, the next refresh regenerates instead of trusting a partial update.
			await fse.writeJson(this.serverSansPath, sans, {spaces: 2})
			await fse.chmod(this.serverKeyPath, 0o600)
			await fse.chmod(this.serverCertificatePath, 0o644)
		} finally {
			// Always remove leftover temporary files. A persistent openssl failure would
			// otherwise leak new files on every periodic refresh. Successful renames
			// already moved the key/cert, and fse.remove ignores missing paths.
			await Promise.all([extPath, csrPath, keyPath, certPath].map((path) => fse.remove(path).catch(() => {})))
		}
	}

	// Whether the certificate is still valid for at least the given number of seconds.
	// Throws on an unreadable/unparseable certificate; callers treat that as invalid.
	private async isCertificateValidFor(certificatePath: string, seconds: number) {
		const certificate = await fse.readFile(certificatePath, 'utf8')
		const validTo = new Date(new X509Certificate(certificate).validTo).getTime()
		return Number.isFinite(validTo) && validTo - Date.now() > seconds * 1000
	}

	// Read app manifests/compose files once, returning app routes plus every
	// app-published port we must not use for hidden ingress listeners.
	private async getAppIngressCandidates(): Promise<{
		routes: Array<Pick<AppIngressRoute, 'id' | 'publicPort'>>
		reservedPorts: number[]
	}> {
		const appDataDirectory = `${this.#umbreld.dataDirectory}/app-data`
		const installedAppIds = (await this.#umbreld.store.get('apps')) ?? []
		const activeAppIds = this.#umbreld.apps.instances.map((app) => app.id)
		// Include installed apps from the store and in-flight app instances. Ignore orphaned
		// app-data directories so failed installs do not leave stale routes behind.
		const appIds = [...new Set([...installedAppIds, ...activeAppIds])]
		const results = await Promise.all(
			appIds.map(async (appId) => {
				// A single app with corrupt on-disk YAML (e.g. a partial write during power loss)
				// must not fail the whole refresh; the initial refresh failing aborts umbreld startup.
				try {
					const app = this.#umbreld.apps.instances.find((instance) => instance.id === appId)
					const manifestPath = `${appDataDirectory}/${appId}/umbrel-app.yml`
					const manifest = await fse.readFile(manifestPath, 'utf8').catch(() => '')
					if (!manifest) return null
					const parsed = yaml.load(manifest) as {port?: unknown; name?: unknown; icon?: unknown} | null
					const publicPort = Number(parsed?.port)
					if (!Number.isInteger(publicPort) || publicPort <= 0 || publicPort > 65_535) return null

					const composePath = `${appDataDirectory}/${appId}/docker-compose.yml`
					const composeText = await fse.readFile(composePath, 'utf8').catch(() => '')
					const compose = yaml.load(composeText) as ComposeFile | null
					const publishedPorts = this.getPublishedPorts(compose)
					// Host-network apps can bind ports without declaring them. We can only reserve the
					// manifest port and rendered compose-published ports until apps expose richer port metadata.
					const reservedPorts = [publicPort, ...publishedPorts]
					// Uninstalling apps have already stopped their containers, so drop their
					// routes early too while the uninstall is still removing images/data.
					if (app?.state === 'stopped' || app?.state === 'uninstalling') return {reservedPorts, route: null}

					const gateway = compose
						? await readAppGatewayConfig(appId, `${appDataDirectory}/${appId}`, compose as any, {
								name: typeof parsed?.name === 'string' ? parsed.name : undefined,
								icon: typeof parsed?.icon === 'string' ? parsed.icon : undefined,
							})
						: null
					if (gateway) {
						// The user can override the app's default gateway authentication in
						// app settings. Applied here so an auth change takes effect on the
						// next ingress refresh without restarting the app.
						const authOverride = await this.getAppProxyAuthOverride(appId)
						if (typeof authOverride === 'boolean') gateway.auth = authOverride

						const targetAddress = await this.resolveAppTarget(appId, gateway.targetHost, compose)
						if (!targetAddress) {
							this.logger.verbose(`Skipping LAN ingress route for ${appId}; app gateway target is unavailable`)
							return {reservedPorts, route: null}
						}
						return {
							reservedPorts,
							route: {id: appId, publicPort, gateway: {...gateway, targetAddress}},
						}
					}

					if (!this.canRouteAppDirectly(compose, publicPort, publishedPorts)) {
						this.logger.verbose(`Skipping LAN ingress route for ${appId}; app has no internal HTTP upstream`)
						return {reservedPorts, route: null}
					}

					return {
						reservedPorts,
						route: {
							id: appId,
							publicPort,
						},
					}
				} catch (error) {
					this.logger.error(`Skipping LAN ingress route for ${appId}; failed to read app state`, error)
					return null
				}
			}),
		)
		return {
			routes: results.flatMap((result) => (result?.route ? [result.route] : [])),
			reservedPorts: results.flatMap((result) => result?.reservedPorts ?? []),
		}
	}

	private async getAppRoutes(): Promise<AppIngressRoute[]> {
		const {routes, reservedPorts} = await this.getAppIngressCandidates()
		const allocations = this.allocateAppIngressPorts(routes, reservedPorts)
		return routes.map((route) => ({...route, hiddenPort: allocations[route.id].hiddenPort}))
	}

	private mergePortMappingsByHiddenPort(...mappingGroups: IngressPortMapping[][]) {
		const mappingsByHiddenPort = new Map<number, IngressPortMapping>()
		for (const mapping of mappingGroups.flat()) {
			mappingsByHiddenPort.set(mapping.hiddenPort, mapping)
		}
		return [...mappingsByHiddenPort.values()]
	}

	private canRouteAppDirectly(compose: ComposeFile | null, publicPort: number, publishedPorts: number[]) {
		if (!compose?.services) return false
		// Some apps publish their UI port directly without app_proxy.
		if (publishedPorts.includes(publicPort)) return true

		// Host-network apps own their ports themselves, but nftables can still
		// intercept LAN traffic before it reaches the app-owned socket.
		const hasHostNetworkService = Object.values(compose.services).some((service) => service.network_mode === 'host')
		return hasHostNetworkService
	}

	// Read the app's saved auth override through the app-owned settings API. Kept safe
	// against missing app instances since routes rebuild during install and
	// uninstall.
	private async getAppProxyAuthOverride(appId: string) {
		try {
			return await this.#umbreld.apps.getApp(appId).getAppProxyAuthOverride()
		} catch {
			return undefined
		}
	}

	private async resolveAppTarget(appId: string, host: string, compose: ComposeFile | null) {
		if (net.isIP(host)) return host

		const directAddress = await this.inspectContainerAddress(host)
		if (directAddress) return directAddress

		const matchingService = Object.entries(compose?.services ?? {}).find(([serviceName, service]) => {
			if (serviceName === host || service.container_name === host || service.hostname === host) return true
			return host === `${appId}_${serviceName}_1`
		})?.[0]
		if (matchingService) {
			const container = await $({
				reject: false,
			})`docker ps --filter label=com.docker.compose.project=${appId} --filter label=com.docker.compose.service=${matchingService} --format {{.ID}}`
			const containerId = container.stdout.trim().split('\n')[0]
			if (container.exitCode === 0 && containerId) {
				const serviceAddress = await this.inspectContainerAddress(containerId)
				if (serviceAddress) return serviceAddress
			}
		}

		return lookup(host)
			.then(({address}) => address)
			.catch(() => null)
	}

	private isTcpPortOpen(host: string, port: number) {
		return new Promise<boolean>((resolve) => {
			const socket = net.createConnection({host, port})
			let settled = false
			const finish = (isOpen: boolean) => {
				if (settled) return
				settled = true
				socket.destroy()
				resolve(isOpen)
			}

			socket.unref()
			socket.setTimeout(APP_UPSTREAM_CONNECT_TIMEOUT)
			socket.once('connect', () => finish(true))
			socket.once('error', () => finish(false))
			socket.once('timeout', () => finish(false))
		})
	}

	// A gateway normally keeps using its resolved container IP. If Docker replaces a
	// container outside umbreld's lifecycle that IP can change, so probe again after
	// an upstream connection error and refresh the route as soon as a new IP appears.
	// Concurrent failures share one recovery and repeated failures are rate-limited.
	private requestAppTargetRecovery(config: AppGatewayConfig) {
		const existingRecovery = this.#appTargetRecoveries.get(config.appId)
		if (existingRecovery) return existingRecovery
		if (Date.now() < (this.#nextAppTargetRecoveryAt.get(config.appId) ?? 0)) return

		this.#nextAppTargetRecoveryAt.set(config.appId, Date.now() + APP_TARGET_RECOVERY_COOLDOWN)
		const recovery = this.recoverAppTarget(config)
			.catch((error) => this.logger.error(`Failed to recover app gateway target for ${config.appId}`, error))
			.finally(() => this.#appTargetRecoveries.delete(config.appId))
		this.#appTargetRecoveries.set(config.appId, recovery)
		return recovery
	}

	private async recoverAppTarget(config: AppGatewayConfig) {
		for (const retryDelay of APP_TARGET_RECOVERY_RETRY_DELAYS) {
			if (retryDelay) await new Promise((resolve) => setTimeout(resolve, retryDelay))

			const composePath = `${this.#umbreld.dataDirectory}/app-data/${config.appId}/docker-compose.yml`
			const compose = await fse
				.readFile(composePath, 'utf8')
				.then((contents) => yaml.load(contents) as ComposeFile | null)
				.catch(() => null)
			const targetAddress = await this.resolveAppTarget(config.appId, config.targetHost, compose)
			if (!targetAddress) continue
			if (targetAddress === config.targetAddress) return

			this.logger.log(
				`App gateway target for ${config.appId} moved from ${config.targetAddress ?? 'unknown'} to ${targetAddress}; refreshing LAN ingress`,
			)
			await this.refresh()
			return
		}
	}

	private async inspectContainerAddress(container: string) {
		// Interpolate the Go template so Execa passes it as one argument. Quotes in an
		// Execa command template are literal (there is no shell to remove them), which
		// would wrap Docker's JSON output in single quotes and make it unparsable.
		const networksFormat = '{{json .NetworkSettings.Networks}}'
		const inspection = await $({
			reject: false,
		})`docker inspect --format ${networksFormat} -- ${container}`
		if (inspection.exitCode !== 0) return null
		try {
			const networks = JSON.parse(inspection.stdout) as Record<string, {IPAddress?: unknown}>
			const addresses = [networks.umbrel_main_network, ...Object.values(networks)]
				.map((network) => network?.IPAddress)
				.filter((address): address is string => typeof address === 'string')
			return addresses.find((address) => net.isIP(address)) ?? null
		} catch {
			return null
		}
	}

	private getPublishedPorts(compose: ComposeFile | null) {
		return Object.values(compose?.services ?? {}).flatMap((service) => {
			if (!Array.isArray(service.ports)) return []
			return service.ports.flatMap((publishedPort) => {
				const port = this.getPublishedPort(publishedPort)
				return port ? [port] : []
			})
		})
	}

	private getPublishedPort(port: unknown) {
		if (typeof port === 'number') return this.isValidPort(port) ? port : null
		if (typeof port === 'object' && port !== null && 'published' in port) {
			const parsed = Number(port.published)
			return this.isValidPort(parsed) ? parsed : null
		}
		if (typeof port !== 'string') return null

		// Docker compose port strings can be "80", "8080:80", "127.0.0.1:8080:80",
		// and may include "/tcp" or "/udp". We only need the published host port.
		const withoutProtocol = port.trim().replace(/\/(tcp|udp)$/i, '')
		const parts = withoutProtocol.split(':')
		const published = parts.length === 1 ? parts[0] : parts.at(-2)
		const parsed = Number(published)
		return this.isValidPort(parsed) ? parsed : null
	}

	// Keep existing hidden ports stable across syncs so adding an app does not briefly
	// point an existing public port at a different app's old listener.
	private allocateAppIngressPorts(
		routes: Array<Pick<AppIngressRoute, 'id' | 'publicPort'>>,
		reservedAppPorts: number[],
		existingRoutes = [...this.#appMuxServers.values()].map((entry) => entry.route),
	) {
		// Hidden ingress listeners are real host ports, so avoid Umbrel-owned ports
		// and every app-published port we discovered from compose.
		const reservedPorts = new Set([80, 443, APP_AUTH_PUBLIC_PORT, this.#umbreld.port, ...reservedAppPorts])
		const allocatedHiddenPorts = new Set<number>()
		const allocations: Record<string, {publicPort: number; hiddenPort: number}> = {}
		const sortedRoutes = [...routes].sort((a, b) => a.id.localeCompare(b.id))
		const existingRoutesById = new Map(existingRoutes.map((route) => [route.id, route]))

		// Reuse existing hidden ports first so a refresh cannot briefly point an
		// app's public port at a different app's old listener.
		for (const route of sortedRoutes) {
			const existingRoute = existingRoutesById.get(route.id)
			if (
				existingRoute &&
				!reservedPorts.has(existingRoute.hiddenPort) &&
				!allocatedHiddenPorts.has(existingRoute.hiddenPort)
			) {
				allocations[route.id] = {publicPort: route.publicPort, hiddenPort: existingRoute.hiddenPort}
				allocatedHiddenPorts.add(existingRoute.hiddenPort)
			}
		}

		// Allocate remaining ports in app-id order so the result is stable even if
		// callers pass routes in a different order.
		for (const route of sortedRoutes) {
			if (allocations[route.id]) continue

			const hiddenPort = this.findAvailableHiddenPort(reservedPorts, allocatedHiddenPorts)
			allocations[route.id] = {publicPort: route.publicPort, hiddenPort}
			allocatedHiddenPorts.add(hiddenPort)
		}

		return allocations
	}

	private isValidPort(port: unknown): port is number {
		return Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535
	}

	private findAvailableHiddenPort(reservedPorts: Set<number>, allocatedHiddenPorts: Set<number>) {
		// Use a high fixed range so hidden listeners stay away from typical app ports.
		for (let port = HIDDEN_INGRESS_PORT_START; port <= HIDDEN_INGRESS_PORT_END; port++) {
			if (reservedPorts.has(port) || allocatedHiddenPorts.has(port)) continue
			return port
		}
		throw new Error('No available LAN ingress hidden ports')
	}

	private removeConflictingAppRoutes(appRoutes: AppIngressRoute[]) {
		const usedPublicPorts = new Set([80, 443, APP_AUTH_PUBLIC_PORT])
		const routes: AppIngressRoute[] = []

		for (const route of appRoutes) {
			if (usedPublicPorts.has(route.publicPort)) {
				this.logger.error(`Skipping LAN ingress route for ${route.id}; port ${route.publicPort} is already used`)
				continue
			}
			usedPublicPorts.add(route.publicPort)
			routes.push(route)
		}

		return routes
	}

	// Ensure fixed Umbrel listeners exist, then reconcile the app mux listeners.
	private async updateListeners(appRoutes: AppIngressRoute[]) {
		await this.loadSecureContext()
		await this.ensureDashboardHttpServer()
		await this.ensureDashboardHttpsServer()
		await this.ensureAppAuthMuxServer()
		await this.updateAppMuxServers(appRoutes)
	}

	private async loadSecureContext() {
		const options = {
			cert: await fse.readFile(this.serverCertificatePath),
			key: await fse.readFile(this.serverKeyPath),
		}
		this.#dashboardHttpsServer?.setSecureContext(options)
		this.#appAuthHttpsProxyServer?.setSecureContext(options)
		for (const entry of this.#appMuxServers.values()) entry.httpsProxyServer?.setSecureContext(options)
	}

	private async ensureDashboardHttpServer() {
		if (this.#dashboardHttpServer) return
		this.#dashboardHttpServer = this.createHttpProxyServer(this.#umbreld.port, 'http')
		await this.listen(this.#dashboardHttpServer, 80)
	}

	private async ensureDashboardHttpsServer() {
		if (this.#dashboardHttpsServer) return
		this.#dashboardHttpsServer = await this.createHttpsProxyServer(this.#umbreld.port)
		await this.listen(this.#dashboardHttpsServer, 443)
	}

	private async ensureAppAuthMuxServer() {
		if (!this.#appAuthHttpProxyServer) {
			this.#appAuthHttpProxyServer = this.createHttpProxyServer(this.#umbreld.port, 'http', {
				pathPrefix: '/app-auth',
				redirectUnexpectedAppAuthNavigation: true,
			})
			await this.listen(this.#appAuthHttpProxyServer, 0, '127.0.0.1')
		}
		if (!this.#appAuthHttpsProxyServer) {
			this.#appAuthHttpsProxyServer = await this.createHttpsProxyServer(this.#umbreld.port, {
				pathPrefix: '/app-auth',
				redirectUnexpectedAppAuthNavigation: true,
			})
			// The mux owns the public port. TLS requests are forwarded to this
			// loopback-only HTTPS server so Node handles the normal TLS lifecycle.
			await this.listen(this.#appAuthHttpsProxyServer, 0, '127.0.0.1')
		}
		if (this.#appAuthMuxServer) return
		// App auth is still browser-facing during app login redirects
		// (`<app-port>` -> `:2000` -> `<app-port>/umbrel_/api/v1/auth/handoff`),
		// so it needs the same HTTP/HTTPS muxing as app ports. Unlike app
		// ports, `:2000` is Umbrel-owned infrastructure, so Node can bind it
		// directly instead of relying on nftables redirection.
		this.#appAuthMuxServer = this.createMuxServer({
			listenPort: APP_AUTH_PUBLIC_PORT,
			httpPort: this.serverPort(this.#appAuthHttpProxyServer),
			getHttpsProxyServer: () => this.#appAuthHttpsProxyServer,
		})
		await this.listen(this.#appAuthMuxServer, APP_AUTH_PUBLIC_PORT)
	}

	private async updateAppMuxServers(appRoutes: AppIngressRoute[]) {
		for (const [id, entry] of this.#appMuxServers) {
			const nextRoute = appRoutes.find((route) => route.id === id)
			if (
				nextRoute &&
				nextRoute.publicPort === entry.route.publicPort &&
				nextRoute.hiddenPort === entry.route.hiddenPort &&
				JSON.stringify(nextRoute.gateway) === JSON.stringify(entry.route.gateway)
			) {
				continue
			}
			await Promise.all([
				this.closeServer(entry.server),
				this.closeServer(entry.httpsProxyServer),
				this.closeServer(entry.gatewayServer),
			])
			this.#appMuxServers.delete(id)
		}

		for (const route of appRoutes) {
			if (this.#appMuxServers.has(route.id)) continue
			let gatewayServer: http.Server | undefined
			let upstreamPort = route.publicPort
			if (route.gateway) {
				gatewayServer = new AppGateway(this.#umbreld, route.gateway, {
					onUpstreamUnavailable: () => void this.requestAppTargetRecovery(route.gateway!),
				}).server
				await this.listen(gatewayServer, 0, '127.0.0.1')
				upstreamPort = this.serverPort(gatewayServer)
			}
			const httpsProxyServer = await this.createHttpsProxyServer(upstreamPort, {includeForwardedFor: false})
			// The public app port still belongs to the app. nftables redirects LAN
			// traffic to the mux, and TLS requests go to this loopback HTTPS proxy.
			await this.listen(httpsProxyServer, 0, '127.0.0.1')
			const server = this.createMuxServer({
				listenPort: route.hiddenPort,
				httpPort: upstreamPort,
				getHttpsProxyServer: () => httpsProxyServer,
			})
			await this.listen(server, route.hiddenPort)
			this.#appMuxServers.set(route.id, {route, server, httpsProxyServer, gatewayServer})
		}
	}

	// Peek the first bytes so one app port can carry both plain HTTP and TLS.
	private createMuxServer({
		listenPort,
		httpPort,
		getHttpsProxyServer,
	}: {
		listenPort: number
		httpPort: number
		getHttpsProxyServer: () => https.Server | undefined
	}) {
		const server = net.createServer((socket) => {
			const chunks: Buffer[] = []
			let length = 0
			const classify = (chunk: Buffer) => {
				chunks.push(chunk)
				length += chunk.length
				// A TLS record header needs three bytes to distinguish it from HTTP.
				// TCP is a byte stream, so even these first bytes may be fragmented.
				if (length < 3) return
				socket.off('data', classify)
				// Pause immediately after peeking. Request bodies can arrive in
				// later chunks, and those bytes must wait until the upstream pipe
				// exists or POST requests can hang waiting for a body we already lost.
				socket.pause()
				const firstChunk = Buffer.concat(chunks, length)
				if (this.isTlsClientHello(firstChunk)) {
					this.handleTlsSocket(socket, firstChunk, getHttpsProxyServer())
					return
				}
				this.forwardTcp(socket, firstChunk, httpPort)
			}
			socket.on('data', classify)
			socket.setTimeout(5000, () => socket.destroy())
			socket.on('error', (error) => this.logger.verbose(`LAN ingress mux socket error on ${listenPort}: ${error}`))
		})
		return server
	}

	private handleTlsSocket(socket: net.Socket, firstChunk: Buffer, httpsProxyServer?: https.Server) {
		if (!httpsProxyServer) {
			socket.destroy()
			return
		}
		const address = httpsProxyServer.address()
		if (typeof address === 'string' || address === null) {
			socket.destroy()
			return
		}
		this.forwardTcp(socket, firstChunk, address.port)
	}

	// Forward the peeked first chunk, then pipe the rest after both sockets are ready.
	private forwardTcp(clientSocket: net.Socket, firstChunk: Buffer, upstreamPort: number) {
		clientSocket.setTimeout(0)
		const upstreamSocket = net.createConnection({host: '127.0.0.1', port: upstreamPort}, () => {
			upstreamSocket.write(firstChunk)
			clientSocket.pipe(upstreamSocket)
			upstreamSocket.pipe(clientSocket)
			// Resume only after both pipes exist so buffered bytes flow upstream.
			clientSocket.resume()
		})
		const destroyBoth = () => {
			clientSocket.destroy()
			upstreamSocket.destroy()
		}
		clientSocket.on('error', destroyBoth)
		upstreamSocket.on('error', destroyBoth)
	}

	private isTlsClientHello(chunk: Buffer) {
		// TLS records start with 0x16 for handshake, followed by the protocol version.
		// Plain HTTP starts with ASCII request bytes like "GET" or "POST".
		return chunk.length >= 3 && chunk[0] === 0x16 && chunk[1] === 0x03
	}

	private createHttpProxyServer(
		upstreamPort: number,
		originalProtocol: 'http' | 'https',
		options: UmbrelProxyOptions = {},
	) {
		const middleware = this.createProxyMiddleware(upstreamPort, originalProtocol, options)
		const server = http.createServer((request, response) => {
			if (options.redirectUnexpectedAppAuthNavigation) {
				const redirect = appAuthDashboardRedirect({
					protocol: originalProtocol,
					host: request.headers.host,
					url: request.url,
					method: request.method,
					accept: request.headers.accept,
				})
				if (redirect) {
					response.writeHead(302, {location: redirect})
					response.end()
					return
				}
			}
			middleware(request as any, response as any, (error?: unknown) => {
				// Reset instead of an error response for the same reason as onError above.
				this.logger.verbose(`LAN ingress proxy error to ${upstreamPort}: ${error}`)
				response.destroy()
			})
		})
		this.attachProxyUpgradeHandler(server, middleware)
		return server
	}

	private async createHttpsProxyServer(upstreamPort: number, options: UmbrelProxyOptions = {}) {
		const {includeForwardedFor = true, pathPrefix} = options
		const middleware = this.createProxyMiddleware(upstreamPort, 'https', {includeForwardedFor, pathPrefix})
		const server = https.createServer(
			{
				cert: await fse.readFile(this.serverCertificatePath),
				key: await fse.readFile(this.serverKeyPath),
			},
			(request, response) => {
				if (options.redirectUnexpectedAppAuthNavigation) {
					const redirect = appAuthDashboardRedirect({
						protocol: 'https',
						host: request.headers.host,
						url: request.url,
						method: request.method,
						accept: request.headers.accept,
					})
					if (redirect) {
						response.writeHead(302, {location: redirect})
						response.end()
						return
					}
				}
				middleware(request as any, response as any, (error?: unknown) => {
					// Reset instead of an error response for the same reason as onError above.
					this.logger.verbose(`LAN ingress proxy error to ${upstreamPort}: ${error}`)
					response.destroy()
				})
			},
		)
		this.attachProxyUpgradeHandler(server, middleware)
		return server
	}

	private createProxyMiddleware(
		upstreamPort: number,
		originalProtocol: 'http' | 'https',
		{includeForwardedFor = true, pathPrefix}: UmbrelProxyOptions = {},
	): RequestHandler {
		const rewritePath = pathPrefix
			? (path: string) =>
					path === pathPrefix || path.startsWith(`${pathPrefix}/`) || path.startsWith(`${pathPrefix}?`)
						? path
						: `${pathPrefix}${path}`
			: undefined
		return createProxyMiddleware({
			target: `http://127.0.0.1:${upstreamPort}`,
			changeOrigin: false,
			ws: true,
			pathRewrite: rewritePath,
			// Umbrel-owned upstreams (dashboard, app-auth) get X-Forwarded-For since they
			// only trust it from loopback. App upstreams must not: some apps reject any
			// X-Forwarded-For from an unconfigured proxy (Home Assistant returns 400),
			// and the plain-HTTP raw forward path never carried it either.
			xfwd: includeForwardedFor,
			logProvider: () => ({
				log: this.logger.verbose,
				debug: this.logger.verbose,
				info: this.logger.verbose,
				warn: this.logger.log,
				error: this.logger.error,
			}),
			onProxyReq: (proxyRequest, request) => {
				// The upstream target is always HTTP. Tell umbreld/app-auth/app-proxy
				// whether the original browser request used HTTP or HTTPS.
				proxyRequest.setHeader('x-forwarded-proto', originalProtocol)
				if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
			},
			onProxyReqWs: (proxyRequest, request) => {
				// WebSocket upgrade requests bypass onProxyReq, so mirror the same
				// forwarded headers for ws:// and wss:// traffic.
				proxyRequest.setHeader('x-forwarded-proto', originalProtocol)
				if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
			},
			onProxyRes: (proxyResponse) => {
				// Do not let apps pin local origins to HTTPS; HSTS can remove browser warning bypass
				// and HTTP fallback paths that are important for private local certs.
				delete proxyResponse.headers['strict-transport-security']
			},
			onError: (error, _request, response) => {
				// Destroy the connection instead of answering with an error body. An
				// unreachable upstream means umbreld or an app is still starting (or has
				// crashed), and before LAN ingress existed clients saw connection refused
				// in those windows. Existing retry loops (UI polling, tRPC websocket
				// reconnects, companion apps) treat a reset the same way, while an error
				// body breaks JSON clients mid-poll. The plain-HTTP raw forward path
				// already resets on upstream failure, so this also keeps HTTP and HTTPS
				// behavior consistent on the same port.
				this.logger.verbose(`LAN ingress proxy error to ${upstreamPort}: ${error}`)
				response.destroy()
			},
		})
	}

	private attachProxyUpgradeHandler(server: http.Server, middleware: RequestHandler) {
		server.on('upgrade', (request, socket, head) => middleware.upgrade?.(request as any, socket as net.Socket, head))
	}

	private serverPort(server: net.Server | http.Server) {
		const address = server.address()
		if (typeof address === 'string' || address === null) throw new Error('LAN ingress server is not listening')
		return address.port
	}

	// Attach tracking before listen() so shutdown can close accepted sockets explicitly.
	private listen(server: net.Server | http.Server, port: number, host?: string) {
		this.trackServerSockets(server)
		return new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				server.off('listening', onListening)
				reject(error)
			}
			const onListening = () => {
				server.off('error', onError)
				resolve()
			}
			server.once('error', onError)
			server.once('listening', onListening)
			server.listen(port, host)
		})
	}

	private trackServerSockets(server: net.Server | http.Server) {
		if (this.#activeSocketsByServer.has(server)) return

		const activeSockets = new Set<net.Socket>()
		this.#activeSocketsByServer.set(server, activeSockets)
		server.on('connection', (socket) => {
			activeSockets.add(socket)
			socket.on('close', () => activeSockets.delete(socket))
		})

		const httpServer = server as http.Server
		if (typeof httpServer.closeIdleConnections === 'function') {
			const upgradedSockets = new Set<net.Socket>()
			this.#upgradedSocketsByServer.set(server, upgradedSockets)
			httpServer.on('upgrade', (_request, socket) => {
				const upgradedSocket = socket as net.Socket
				upgradedSockets.add(upgradedSocket)
				upgradedSocket.on('close', () => upgradedSockets.delete(upgradedSocket))
			})
		}
	}

	private closeServer(
		server?: net.Server | http.Server,
		{drainActiveResponses = false}: {drainActiveResponses?: boolean} = {},
	) {
		return new Promise<void>((resolve) => {
			if (!server) return resolve()
			if (!server.listening) {
				this.destroyServerSockets(server)
				return resolve()
			}
			if (!drainActiveResponses) {
				server.close(() => resolve())
				this.endServerSockets(server)
				return
			}

			// Stop accepting new connections while active HTTP responses finish. The
			// power-action acknowledgement may still be crossing this proxy when
			// umbreld begins shutdown, so ending its socket here loses the response.
			let idleConnectionSweep: ReturnType<typeof setInterval> | undefined
			const forceClose = setTimeout(() => this.destroyServerSockets(server), SERVER_CLOSE_GRACE_MS)
			forceClose.unref()
			server.close(() => {
				if (idleConnectionSweep) clearInterval(idleConnectionSweep)
				clearTimeout(forceClose)
				resolve()
			})

			const closeIdleConnections = (server as http.Server).closeIdleConnections
			if (typeof closeIdleConnections === 'function') {
				const closeIdle = () => {
					closeIdleConnections.call(server)
					this.destroyUpgradedSockets(server)
				}
				closeIdle()
				idleConnectionSweep = setInterval(closeIdle, IDLE_CONNECTION_SWEEP_MS)
				idleConnectionSweep.unref()
			} else this.endServerSockets(server)
		})
	}

	private endServerSockets(server: net.Server | http.Server) {
		const activeSockets = this.#activeSocketsByServer.get(server)
		if (!activeSockets) return
		for (const socket of activeSockets) {
			socket.end()
			const forceDestroy = setTimeout(() => socket.destroy(), SERVER_CLOSE_GRACE_MS)
			forceDestroy.unref()
			socket.once('close', () => clearTimeout(forceDestroy))
		}
		activeSockets.clear()
	}

	private destroyUpgradedSockets(server: net.Server | http.Server) {
		const upgradedSockets = this.#upgradedSocketsByServer.get(server)
		if (!upgradedSockets) return
		for (const socket of upgradedSockets) socket.destroy()
		upgradedSockets.clear()
	}

	private destroyServerSockets(server: net.Server | http.Server) {
		const activeSockets = this.#activeSocketsByServer.get(server)
		if (!activeSockets) return
		for (const socket of activeSockets) socket.destroy()
		activeSockets.clear()
	}

	private async closeAllServers() {
		await Promise.all([
			this.closeServer(this.#dashboardHttpServer, {drainActiveResponses: true}).then(
				() => (this.#dashboardHttpServer = undefined),
			),
			this.closeServer(this.#dashboardHttpsServer, {drainActiveResponses: true}).then(
				() => (this.#dashboardHttpsServer = undefined),
			),
			this.closeServer(this.#appAuthMuxServer).then(() => (this.#appAuthMuxServer = undefined)),
			this.closeServer(this.#appAuthHttpProxyServer),
			this.closeServer(this.#appAuthHttpsProxyServer),
			...Array.from(this.#appMuxServers.values()).flatMap((entry) => [
				this.closeServer(entry.server),
				this.closeServer(entry.httpsProxyServer),
				this.closeServer(entry.gatewayServer),
			]),
		])
		this.#appAuthHttpProxyServer = undefined
		this.#appAuthHttpsProxyServer = undefined
		this.#appMuxServers.clear()
	}

	// Apply a complete generated table; passing the ruleset over stdin avoids
	// nft shell quoting issues without writing a temp file on every refresh.
	private async applyNftRuleset(
		redirectRoutes: IngressPortMapping[],
		hiddenPortRoutes: IngressPortMapping[] = redirectRoutes,
	) {
		const nftRuleset = this.buildNftRuleset(redirectRoutes, hiddenPortRoutes)
		await $({input: nftRuleset})`${NFT_BIN} -f -`
	}

	// Generate public-port redirects plus hidden-port guard rules.
	private buildNftRuleset(redirectRoutes: IngressPortMapping[], hiddenPortRoutes: IngressPortMapping[]) {
		const redirectRules = redirectRoutes.map(
			(route) =>
				`add rule inet ${NFT_TABLE_NAME} prerouting fib daddr type local iifname != "lo" tcp dport ${route.publicPort} redirect to :${route.hiddenPort}`,
		)
		const hiddenPortDropRules = hiddenPortRoutes.map(
			(route) =>
				`add rule inet ${NFT_TABLE_NAME} input iifname != "lo" tcp dport ${route.hiddenPort} ct original proto-dst != ${route.publicPort} drop`,
		)
		// Use nft's named priority offsets to make the ordering explicit: app-port
		// redirects run just before Docker's dstnat port-publishing rules, and
		// hidden-port drops run just before the standard filter priority.
		return [
			`add table inet ${NFT_TABLE_NAME}`,
			`flush table inet ${NFT_TABLE_NAME}`,
			`add chain inet ${NFT_TABLE_NAME} prerouting { type nat hook prerouting priority dstnat - 1; policy accept; }`,
			`add chain inet ${NFT_TABLE_NAME} input { type filter hook input priority filter - 1; policy accept; }`,
			...redirectRules,
			...hiddenPortDropRules,
			'',
		].join('\n')
	}
}
