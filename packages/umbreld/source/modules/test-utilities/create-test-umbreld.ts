import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import path from 'node:path'
import {Buffer} from 'node:buffer'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'
import {createTRPCProxyClient, httpBatchLink, createWSClient, wsLink, splitLink} from '@trpc/client'
import got from 'got'
import {CookieJar} from 'tough-cookie'
import {$} from 'execa'
import getAvailablePort from 'get-port'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'
import {Client as SshClient} from 'ssh2'

import Umbreld from '../../index.ts'
import type {AppRouter} from '../server/trpc/index.ts'
import type {events} from '../event-bus/event-bus.ts'

import temporaryDirectory from '../utilities/temporary-directory.ts'
import runGitServer from './run-git-server.ts'
import {retryVmPortCollisions} from './vm-port-retry.ts'

// Use the data/ directory in the umbreld package root for test temp files
// This avoids filling up RAM-based tmpfs when running many tests in parallel
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const testDataDirectory = path.resolve(currentDirectory, '../../../data')

const userCredentials = {
	name: 'satoshi',
	password: 'moneyprintergobrrr',
}

function createTestHelpers(port: number | (() => number)) {
	const currentPort = typeof port === 'number' ? () => port : port
	const withCurrentPort = (url: string | URL) => {
		const currentUrl = new URL(url)
		currentUrl.port = String(currentPort())
		return currentUrl
	}
	let authToken = ''
	const cookieJar = new CookieJar()
	const setAuthToken = (token: string) => {
		authToken = token
	}
	const setBrowserSession = async (token: string, cookies: string[]) => {
		authToken = token
		await cookieJar.removeAllCookies()
		for (const cookie of cookies) await cookieJar.setCookie(cookie, `http://127.0.0.1:${currentPort()}/`)
	}

	// Node's fetch doesn't retry when a kept-alive connection is closed by the
	// server between requests (e.g. umbreld's HTTP keep-alive timeout racing
	// the query after a startup poll), which intermittently fails tests with
	// 'SocketError: other side closed' (or ECONNRESET, depending on whether the
	// close or the reset arrives first). Retry once — the dead socket is
	// discarded and the retry opens a fresh connection. Don't retry timeouts:
	// umbreld may still be processing that request, and replaying a mutation
	// would hide the hang behind a misleading error like 'already exists'.
	const fetchWithRetry = (async (input: string | URL, init?: RequestInit) => {
		const url = withCurrentPort(input)
		try {
			return await fetch(url, init)
		} catch (error) {
			const code = (error as {cause?: {code?: string}}).cause?.code
			if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') throw error
			return fetch(url, init)
		}
	}) as typeof fetch

	// Node's fetch does not retain cookies. Wrap it with the same cookie jar used
	// by browserApi so tRPC and non-tRPC requests represent one browser session.
	const fetchWithBrowserSession = (async (input: string | URL, init?: RequestInit) => {
		const url = withCurrentPort(input)
		const headers = new Headers()
		new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
		const cookie = await cookieJar.getCookieString(url.toString())
		if (cookie) headers.set('cookie', cookie)

		const response = await fetchWithRetry(url, {...init, headers})
		const setCookies = (response.headers as typeof response.headers & {getSetCookie?: () => string[]}).getSetCookie?.()
		for (const setCookie of setCookies ?? []) await cookieJar.setCookie(setCookie, url.toString())
		return response
	}) as typeof fetch

	const ticketClient = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `http://127.0.0.1:${currentPort()}/trpc`,
				fetch: fetchWithBrowserSession,
				headers: async () => ({Authorization: `Bearer ${authToken}`}),
			}),
		],
	})

	// Create WebSocket client for subscriptions
	// Connect via 127.0.0.1 rather than localhost: umbreld binds IPv4 loopback by
	// default, and localhost can resolve to ::1 first.
	const wsClient = createWSClient({
		url: async () => {
			const ticket = await ticketClient.user.createWebSocketTicket.mutate({target: 'trpc'})
			return `ws://127.0.0.1:${currentPort()}/trpc?ticket=${ticket}`
		},
		retryDelayMs: () => 100,
		// Like the UI, don't open the socket until the first subscription. Minting a
		// ticket fails until the test logs in, so an eager client sits in tRPC's
		// reconnect loop, and a subscription made while that loop is backing off
		// has its fresh socket closed by the next reconnect attempt, failing with
		// "Active connection is not open".
		lazy: {enabled: true, closeMs: 30_000},
	})

	const client = createTRPCProxyClient<AppRouter>({
		links: [
			splitLink({
				condition: (op) => op.type === 'subscription',
				true: wsLink({client: wsClient}),
				false: httpBatchLink({
					url: `http://127.0.0.1:${currentPort()}/trpc`,
					fetch: fetchWithBrowserSession,
					headers: async () => ({
						Authorization: `Bearer ${authToken}`,
					}),
				}),
			}),
		],
	})

	const unauthenticatedClient = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `http://127.0.0.1:${currentPort()}/trpc`,
				fetch: fetchWithRetry,
			}),
		],
	})

	const unauthenticatedApi = got.extend({
		prefixUrl: `http://127.0.0.1:${currentPort()}/api`,
		retry: {limit: 0},
		responseType: 'json',
		hooks: {
			beforeRequest: [
				(options) => {
					if (options.url) options.url = withCurrentPort(options.url)
				},
			],
		},
	})
	// Represents a browser navigation: cookies are retained, but no dashboard
	// Authorization header is added. This is useful for testing URL-authenticated APIs.
	const browserApi = unauthenticatedApi.extend({cookieJar})
	const api = browserApi.extend({
		hooks: {
			beforeRequest: [
				async (options) => {
					if (!options.url) throw new Error('Request URL is missing')
					const url = new URL(options.url)
					const isUrlAuthenticatedRead =
						options.method === 'GET' &&
						(/^\/api\/files\/(?:view|download|thumbnail)(?:\/|$)/.test(url.pathname) ||
							url.pathname === '/logs' ||
							url.pathname === '/logs/' ||
							url.pathname === '/lan-ingress/umbrel-local-ca.crt')
					if (isUrlAuthenticatedRead) {
						// Browser file URLs use the read-only token plus the shared browser cookie,
						// never the more powerful dashboard credential.
						url.searchParams.set('token', await client.user.getHttpApiToken.query())
						options.url = url
					} else if (authToken) {
						options.headers.authorization = `Bearer ${authToken}`
					}
				},
			],
		},
	})

	async function signup({
		raidDevices,
		raidType,
		acceleratorDevices,
		failsafeLayout,
	}: {
		raidDevices?: string[]
		raidType?: 'storage' | 'failsafe'
		acceleratorDevices?: string[]
		failsafeLayout?: 'raidz1' | 'raidz2' | 'mirror'
	} = {}) {
		await unauthenticatedClient.user.register.mutate({
			...userCredentials,
			raidDevices,
			raidType,
			acceleratorDevices,
			failsafeLayout,
		})
	}

	async function login() {
		// Retry login to handle race condition where user exists but password isn't set yet
		await pWaitFor(
			async () => {
				try {
					const token = await client.user.login.mutate(userCredentials)
					setAuthToken(token)
					return true
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		return true
	}

	async function registerAndLogin() {
		await signup()
		await login()
		return true
	}

	async function waitForStartup({waitForUser = false} = {}) {
		await pWaitFor(
			async () => {
				try {
					const exists = await unauthenticatedClient.user.exists.query()
					return waitForUser ? exists : true
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 300_000},
		)
	}

	// Subscribe to events over WebSocket and collect them.
	// `started` resolves once the server acknowledges the subscription. Await it
	// before triggering the action under test, otherwise events emitted while
	// the subscription is still being established are silently missed.
	function subscribeToEvents<T>(
		event: (typeof events)[number],
		{authToken: subscriptionAuthToken}: {authToken?: string} = {},
	) {
		const scopedTicketClient = subscriptionAuthToken
			? createTRPCProxyClient<AppRouter>({
					links: [
						httpBatchLink({
							url: `http://127.0.0.1:${currentPort()}/trpc`,
							fetch: fetchWithBrowserSession,
							headers: {Authorization: `Bearer ${subscriptionAuthToken}`},
						}),
					],
				})
			: undefined
		const scopedWsClient = scopedTicketClient
			? createWSClient({
					url: async () => {
						const ticket = await scopedTicketClient.user.createWebSocketTicket.mutate({target: 'trpc'})
						return `ws://127.0.0.1:${currentPort()}/trpc?ticket=${ticket}`
					},
					retryDelayMs: () => 100,
				})
			: undefined
		const subscriptionClient = scopedWsClient
			? createTRPCProxyClient<AppRouter>({links: [wsLink({client: scopedWsClient})]})
			: client
		const collected: T[] = []
		let resolveStarted = () => {}
		let rejectStarted = (_error: unknown) => {}
		let subscriptionStarted = false
		const started = new Promise<void>((resolve, reject) => {
			resolveStarted = resolve
			rejectStarted = reject
		})
		const subscription = subscriptionClient.eventBus.listen.subscribe(
			{event},
			{
				onStarted: () => {
					subscriptionStarted = true
					resolveStarted()
				},
				onData: (data) => collected.push(data as T),
				onError: (error) => {
					if (!subscriptionStarted) rejectStarted(error)
					else console.error(`Subscription error for ${event}:`, error)
				},
			},
		)
		return {
			collected,
			started,
			unsubscribe: () => {
				subscription.unsubscribe()
				scopedWsClient?.close()
			},
		}
	}

	return {
		client,
		unauthenticatedClient,
		api,
		browserApi,
		unauthenticatedApi,
		setAuthToken,
		setBrowserSession,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	}
}

export default async function createTestUmbreld({
	autoLogin = false,
	autoStart = true,
}: {autoLogin?: boolean; autoStart?: boolean} = {}) {
	const directory = temporaryDirectory({parentDirectory: testDataDirectory})
	await directory.createRoot()

	const gitServer = await runGitServer()

	const dataDirectory = await directory.create()
	const umbreld = new Umbreld({
		dataDirectory,
		port: 0,
		logLevel: 'silent',
		defaultAppStoreRepo: gitServer.url,
	})
	if (autoStart) await umbreld.start()

	const {
		client,
		unauthenticatedClient,
		api,
		browserApi,
		unauthenticatedApi,
		setAuthToken,
		setBrowserSession,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	} = createTestHelpers(() => umbreld.server.port!)

	async function cleanup() {
		await umbreld.stop()
		await gitServer.close()
		await directory.destroyRoot()
	}

	if (autoLogin) {
		await signup()
		await login()
	}

	return {
		instance: umbreld,
		client,
		unauthenticatedClient,
		api,
		browserApi,
		unauthenticatedApi,
		setAuthToken,
		setBrowserSession,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
		cleanup,
	}
}

// The controller a VM drive bay is attached to: the motherboard's SATA (AHCI) controller,
// or a SAS HBA. HDD tests run against both via describe.each(driveBuses).
export type DriveBus = 'sata' | 'sas'
export const driveBuses: DriveBus[] = ['sata', 'sas']

type TestVm = Awaited<ReturnType<typeof createTestVm>>['vm']

// The kinds of drive a raidz failsafe array can be built from. Raidz tests run against all of
// them via describe.each(raidzDrives), so HDD raidz arrays get the same coverage as SSD ones.
// Each kind knows which VM to boot, how to fit and pull its drives, how to pick a drive out of
// getDevices() by the slot it was fitted in, and which failsafe layout to register with.
export const raidzDrives = [
	{
		name: 'NVMe SSD',
		type: 'ssd' as const,
		device: 'umbrel-pro' as const,
		// SSD arrays are raidz1 without asking
		failsafeLayout: undefined,
		add: (vm: TestVm, options: {slot: number; size?: string}) => vm.addNvme(options),
		remove: (vm: TestVm, options: {slot: number}) => vm.removeNvme(options),
		disconnect: (vm: TestVm, options: {slot: number}) => vm.disconnectNvme(options),
		inSlot: (slot: number) => (device: {serial: string}) => device.serial.startsWith(`nvme${slot}-`),
	},
	...driveBuses.map((bus) => ({
		name: `${bus.toUpperCase()} HDD`,
		type: 'hdd' as const,
		device: 'nas' as const,
		// HDD arrays are mirrors unless raidz1 is asked for
		failsafeLayout: 'raidz1' as const,
		// VM HDDs default to 1T, so default to the NVMe size to keep sizes the same for every kind
		add: (vm: TestVm, {slot, size = '64G'}: {slot: number; size?: string}) => vm.addHdd({slot, size, bus}),
		remove: (vm: TestVm, {slot}: {slot: number}) => vm.removeHdd({slot, bus}),
		disconnect: (vm: TestVm, {slot}: {slot: number}) => vm.disconnectHdd({slot, bus}),
		inSlot: (slot: number) => (device: {serial: string}) =>
			device.serial.startsWith(`${bus === 'sas' ? 'sashdd' : 'hdd'}${slot}-`),
	})),
]

// Serves the models umbrelOS fetches once it is running (see files/models.ts)
// from where `scripts/download-models` puts them, in the layout the download
// server has them in, with range requests like it. VMs reach it at
// http://10.0.2.2:<port>.
async function serveModels() {
	const directory = path.resolve(currentDirectory, '../../../../os/build/models')
	if (!fs.existsSync(directory)) {
		throw new Error(`No models at ${directory}: run scripts/download-models from the repository root first`)
	}
	const server = http.createServer((request, response) => {
		const file = path.join(directory, path.normalize(decodeURIComponent(request.url ?? '/')))
		const size = file.startsWith(`${directory}${path.sep}`) && fs.statSync(file, {throwIfNoEntry: false})?.size
		if (!size) return response.writeHead(404).end()
		const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '')
		const start = range ? Number(range[1]) : 0
		response.writeHead(range ? 206 : 200, {
			'content-length': size - start,
			...(range ? {'content-range': `bytes ${start}-${size - 1}/${size}`} : {}),
		})
		pipeline(fs.createReadStream(file, {start}), response).catch(() => {})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	return {
		port: (server.address() as AddressInfo).port,
		async close() {
			server.closeAllConnections()
			await new Promise((resolve) => server.close(resolve))
		},
	}
}

export async function createTestVm({
	device,
	bootDisk,
	image,
	memory,
	cores,
	models = false,
	forwardPorts = [],
	startupTimeout = 300_000,
	stateDirectoryName,
}: {
	device?: 'umbrel-pro' | 'umbrel-home' | 'nas' | 'pi'
	bootDisk?: 'default' | 'emmc' | 'nvme' | 'usb' | 'sdcard' | 'none'
	image?: string
	memory?: number
	cores?: number
	// Whether the VM can fetch the models that read the library, from this
	// machine. Without it there is nowhere for it to fetch them from: a test
	// that doesn't ask for them never has a VM download them from the internet.
	models?: boolean
	forwardPorts?: Array<{hostPort?: number; guestPort: number}>
	startupTimeout?: number
	stateDirectoryName?: string
} = {}) {
	const vmScript = path.resolve(currentDirectory, '../../../../os/vm.sh')
	// A shutdown that lands while umbreld is still starting (e.g. right after a
	// restart) can take over 30s. The emulated Pi measured 42-125s across 20 clean
	// shutdowns in CI, and some shutdowns with legacy USB installs attached took
	// longer than 3 minutes. Running out of time force-kills the VM, leaving its
	// filesystems dirty.
	const cleanShutdownTimeout = device === 'pi' ? 300_000 : 60_000

	const directory = temporaryDirectory({parentDirectory: testDataDirectory})
	await directory.createRoot()
	const generatedStateDirectory = await directory.create()
	if (
		stateDirectoryName !== undefined &&
		(!stateDirectoryName ||
			stateDirectoryName === '.' ||
			stateDirectoryName === '..' ||
			path.basename(stateDirectoryName) !== stateDirectoryName)
	) {
		throw new Error('stateDirectoryName must be a single directory name')
	}
	const stateDir = stateDirectoryName ? path.join(generatedStateDirectory, stateDirectoryName) : generatedStateDirectory
	const env = {VM_STATE_DIR: stateDir}
	const modelsServer = models ? await serveModels() : undefined
	// Port 1 has nothing listening, so a VM that asks is refused at once
	const modelsUrl = `http://10.0.2.2:${modelsServer?.port ?? 1}`

	let sshPort = 0
	let httpPort = 0
	const allocatedForwardPorts = forwardPorts.map(({hostPort, guestPort}) => ({
		hostPort: hostPort ?? 0,
		guestPort,
		dynamic: hostPort === undefined,
	}))

	async function refreshDynamicPorts() {
		const allocated = new Set(
			allocatedForwardPorts.filter((forward) => !forward.dynamic).map((forward) => forward.hostPort),
		)
		const allocate = async () => {
			let port: number
			do port = await getAvailablePort({host: '127.0.0.1'})
			while (allocated.has(port))
			allocated.add(port)
			return port
		}

		sshPort = await allocate()
		httpPort = await allocate()
		for (const forward of allocatedForwardPorts) {
			if (forward.dynamic) forward.hostPort = await allocate()
		}
	}

	await refreshDynamicPorts()

	const {
		client,
		unauthenticatedClient,
		api,
		browserApi,
		unauthenticatedApi,
		setAuthToken,
		setBrowserSession,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	} = createTestHelpers(() => httpPort)

	let vmProcessPid: number | undefined

	// Boots the VM and waits for umbreld to respond. With `cdrom` an ISO is
	// attached as the primary boot device (e.g. the USB installer). With
	// `bootNvmeSlot` the VM boots from the NVMe device in that slot, with
	// `bootSataSlot` from the SATA drive in that slot, and with `bootUfs` from
	// the UFS storage (e.g. after the USB installer flashed them). With `waitForShutdown` it instead waits
	// for the VM to power itself off, for boots that are expected to complete
	// and shut down on their own (e.g. the USB installer auto-flashing a
	// device).
	async function powerOnOnce({
		cdrom,
		bootNvmeSlot,
		bootSataSlot,
		bootUfs = false,
		waitForShutdown = false,
	}: {
		cdrom?: string
		bootNvmeSlot?: number
		bootSataSlot?: number
		bootUfs?: boolean
		waitForShutdown?: boolean
	} = {}) {
		let vmOutput = ''
		let vmExited = false
		let vmExitCode: number | null = null

		const deviceArgs = device ? ['--device', device] : []
		const bootDiskArgs = bootDisk ? ['--boot-disk', bootDisk] : []
		const imageArgs = image ? [image] : []
		const memoryArgs = memory ? ['--memory', String(memory)] : []
		const coreArgs = cores ? ['--cores', String(cores)] : []
		const cdromArgs = cdrom ? ['--cdrom', cdrom] : []
		const bootNvmeSlotArgs = bootNvmeSlot ? ['--boot-nvme-slot', String(bootNvmeSlot)] : []
		const bootSataSlotArgs = bootSataSlot ? ['--boot-sata-slot', String(bootSataSlot)] : []
		const bootUfsArgs = bootUfs ? ['--boot-ufs'] : []
		const forwardPortArgs = allocatedForwardPorts.flatMap(({hostPort, guestPort}) => [
			'--forward-port',
			`${hostPort}:${guestPort}`,
		])
		const vmProcess = $({
			env,
			detached: true,
		})`${vmScript} boot ${imageArgs} ${deviceArgs} ${bootDiskArgs} ${memoryArgs} ${coreArgs} ${cdromArgs} ${bootNvmeSlotArgs} ${bootSataSlotArgs} ${bootUfsArgs} ${forwardPortArgs} --credential ${`umbrel.models-url=${modelsUrl}`} --ssh-port ${sshPort} --http-port ${httpPort}`
		vmProcessPid = vmProcess.pid

		// Capture output and track if process exits
		vmProcess.stdout?.on('data', (data: Buffer) => (vmOutput += data.toString()))
		vmProcess.stderr?.on('data', (data: Buffer) => (vmOutput += data.toString()))
		// Observe the process promise rather than only attaching an exit listener:
		// a port collision can make QEMU exit before listeners are registered.
		// Waiting for execa to settle also ensures all QEMU output is captured.
		const vmExit = vmProcess
			.then(
				(result) => result.exitCode,
				(error: unknown) => {
					const exitCode = (error as {exitCode?: unknown}).exitCode
					return typeof exitCode === 'number' ? exitCode : null
				},
			)
			.then((exitCode) => {
				vmExited = true
				vmExitCode = exitCode
				return exitCode
			})

		// Unref so the process doesn't block Node from exiting
		vmProcess.unref()

		// Include the VM console output in timeout errors so boot failures are
		// debuggable from CI logs
		const withVmOutputOnTimeout = async (waitForCondition: Promise<void>) => {
			try {
				await waitForCondition
			} catch (error) {
				if (error instanceof Error && error.name === 'TimeoutError') {
					throw new Error(`${error.message}, VM output:\n${vmOutput}`)
				}
				throw error
			}
		}

		if (waitForShutdown) {
			await withVmOutputOnTimeout(pWaitFor(() => vmExited, {interval: 1000, timeout: startupTimeout}))
			vmProcessPid = undefined
			const exitCode = vmExitCode ?? (await vmExit)
			if (exitCode !== 0) {
				throw new Error(`VM process exited with code ${exitCode}:\n${vmOutput}`)
			}
			return
		}

		await withVmOutputOnTimeout(
			pWaitFor(
				async () => {
					const outcome = await Promise.race([
						vmExit.then(() => ({exited: true as const, ready: false})),
						unauthenticatedClient.user.exists.query().then(
							() => ({exited: false as const, ready: true}),
							() => ({exited: false as const, ready: false}),
						),
					])
					if (outcome.exited) {
						vmProcessPid = undefined
						throw new Error(`VM process exited unexpectedly:\n${vmOutput}`)
					}
					return outcome.ready
				},
				{interval: 2000, timeout: startupTimeout},
			),
		)
	}

	async function powerOn(
		options: {
			cdrom?: string
			bootNvmeSlot?: number
			bootSataSlot?: number
			bootUfs?: boolean
			waitForShutdown?: boolean
		} = {},
	) {
		await retryVmPortCollisions({
			attempt: () => powerOnOnce(options),
			refreshPorts: refreshDynamicPorts,
			isDynamicPort: (port) =>
				port === sshPort ||
				port === httpPort ||
				allocatedForwardPorts.some((forward) => forward.dynamic && forward.hostPort === port),
			onRetry: ({port, retry, maxRetries}) =>
				console.warn(
					`QEMU host port ${port} was claimed before startup; retrying with new ports (${retry}/${maxRetries})`,
				),
		})
	}

	function isRunning() {
		if (!vmProcessPid) return false
		try {
			process.kill(vmProcessPid, 0)
			return true
		} catch {
			return false
		}
	}

	async function powerOff() {
		if (!vmProcessPid) return

		// Try graceful shutdown via tRPC (triggers clean umbreld shutdown)
		try {
			// The shutdown calls can reject even though the shutdown was triggered,
			// because the connection drops while the system is going down. Ignore
			// call errors and judge success by the VM process actually exiting.
			try {
				await client.system.shutdown.mutate()
			} catch {
				await unauthenticatedClient.system.shutdown.mutate().catch(() => {})
			}

			// Wait for graceful shutdown
			await pWaitFor(() => !isRunning(), {interval: 100, timeout: cleanShutdownTimeout})
			vmProcessPid = undefined
			return
		} catch {
			// Graceful shutdown failed, fall through to force kill
		}

		// Force kill if still running. QEMU runs as root on Linux (vm.sh boots
		// it with sudo) so an unprivileged process.kill() can't terminate it,
		// fall back to sudo kill.
		console.log('VM did not shut down cleanly, force killing process')
		for (const signal of ['TERM', 'KILL'] as const) {
			try {
				process.kill(-vmProcessPid!, `SIG${signal}`)
			} catch {
				await $`sudo kill -${signal} -- ${-vmProcessPid!}`.catch(() => {})
			}
			try {
				// Wait up to 10 seconds for the kill to take effect
				await pWaitFor(() => !isRunning(), {interval: 100, timeout: 10_000})
				vmProcessPid = undefined
				return
			} catch {
				// Process still running, escalate to the next signal
			}
		}
		throw new Error('Failed to kill VM process')
	}

	async function forcePowerOff() {
		if (!vmProcessPid) return
		const pid = vmProcessPid
		if (process.platform === 'linux') {
			// vm.sh launches QEMU through sudo on Linux. Signalling the process
			// group as the test user can report success after killing only the
			// unprivileged wrapper, leaving the root-owned QEMU process alive. That
			// is not a power cut, so always signal the complete group through sudo.
			await $`sudo kill -KILL -- ${-pid}`
		} else {
			process.kill(-pid, 'SIGKILL')
		}
		await pWaitFor(() => !isRunning(), {interval: 100, timeout: 10_000})
		vmProcessPid = undefined
	}

	async function addNvme({slot, size}: {slot: number; size?: string}) {
		if (size) {
			await $({env})`${vmScript} nvme add ${slot} --size ${size}`
		} else {
			await $({env})`${vmScript} nvme add ${slot}`
		}
	}

	async function removeNvme({slot}: {slot: number}) {
		await $({env})`${vmScript} nvme destroy ${slot}`
	}

	// Onboard UFS storage, as fitted to some mini PCs. Like real UFS it has 4096
	// byte logical blocks and lsblk reports no transport for it.
	async function addUfs({size}: {size?: string} = {}) {
		await $({env})`${vmScript} ufs add ${size ? ['--size', size] : []}`
	}

	async function removeUfs() {
		await $({env})`${vmScript} ufs destroy`
	}

	async function addBayDrive({
		bus,
		slot,
		type,
		size,
	}: {
		bus: DriveBus
		slot: number
		type: 'hdd' | 'ssd'
		size?: string
	}) {
		if (size) {
			await $({env})`${vmScript} ${bus} add ${slot} --size ${size} --type ${type}`
		} else {
			await $({env})`${vmScript} ${bus} add ${slot} --type ${type}`
		}
	}

	// HDDs go in SATA bays on the motherboard's AHCI controller by default, or in SAS bays
	// behind an LSI SAS HBA
	async function addHdd({slot, size, bus = 'sata'}: {slot: number; size?: string; bus?: DriveBus}) {
		await addBayDrive({bus, slot, type: 'hdd', size})
	}

	// SATA or SAS SSD in a drive bay (NVMe SSDs use addNvme)
	async function addSsd({slot, size, bus}: {slot: number; size?: string; bus: DriveBus}) {
		await addBayDrive({bus, slot, type: 'ssd', size})
	}

	async function removeHdd({slot, bus = 'sata'}: {slot: number; bus?: DriveBus}) {
		await $({env})`${vmScript} ${bus} destroy ${slot}`
	}

	// A USB drive. QEMU can't mark a USB port as external the way a real
	// computer's firmware does, so the OS sees the drive as one it can't tell
	// from a built-in disk. `removable` makes it report removable media instead,
	// as a USB flash drive does, for code that looks for a drive plugged in from
	// outside.
	async function addUsbStorage({slot, size, removable}: {slot: number; size?: string; removable?: boolean}) {
		const options = [...(size ? ['--size', size] : []), ...(removable ? ['--removable'] : [])]
		await $({env})`${vmScript} usb add ${slot} ${options}`
	}

	async function removeUsbStorage({slot}: {slot: number}) {
		await $({env})`${vmScript} usb destroy ${slot}`
	}

	async function disconnectUsbStorage({slot}: {slot: number}) {
		await $({env})`${vmScript} usb disconnect ${slot}`
	}

	async function connectUsbStorage({slot}: {slot: number}) {
		await $({env})`${vmScript} usb connect ${slot}`
	}

	// An FTDI USB serial adapter (0403:6001) on its own xHCI controller,
	// plugged into the port matching its slot. Without a serial number each
	// adapter reports a distinct one; give several the same to model identical
	// devices that can only be told apart by port.
	async function addUsbSerial({slot, serial}: {slot: number; serial?: string}) {
		if (serial) {
			await $({env})`${vmScript} usb-serial add ${slot} --serial ${serial}`
		} else {
			await $({env})`${vmScript} usb-serial add ${slot}`
		}
	}

	async function removeUsbSerial({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-serial remove ${slot}`
	}

	async function disconnectUsbSerial({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-serial disconnect ${slot}`
	}

	async function connectUsbSerial({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-serial connect ${slot}`
	}

	// Replace the adapter in a slot with a QEMU USB keyboard (0627:0001) in the
	// same port, or the keyboard with the adapter, as a device that reconnects as
	// a different model once its firmware loads would
	async function swapUsbSerial({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-serial swap ${slot}`
	}

	// A USB Ethernet adapter (0525:a4a2) on its own xHCI controller, plugged into
	// the port matching its slot, on a network of its own with a DHCP server
	async function addUsbNet({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-net add ${slot}`
	}

	async function disconnectUsbNet({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-net disconnect ${slot}`
	}

	async function connectUsbNet({slot}: {slot: number}) {
		await $({env})`${vmScript} usb-net connect ${slot}`
	}

	async function disconnectNvme({slot}: {slot: number}) {
		await $({env})`${vmScript} nvme disconnect ${slot}`
	}

	async function disconnectHdd({slot, bus = 'sata'}: {slot: number; bus?: DriveBus}) {
		await $({env})`${vmScript} ${bus} disconnect ${slot}`
	}

	async function connectHdd({slot, bus = 'sata'}: {slot: number; bus?: DriveBus}) {
		await $({env})`${vmScript} ${bus} connect ${slot}`
	}

	async function connectNvme({slot}: {slot: number}) {
		await $({env})`${vmScript} nvme connect ${slot}`
	}

	async function moveNvme({fromSlot, toSlot}: {fromSlot: number; toSlot: number}) {
		await $({env})`${vmScript} nvme move ${fromSlot} ${toSlot}`
	}

	async function moveHdd({fromSlot, toSlot, bus = 'sata'}: {fromSlot: number; toSlot: number; bus?: DriveBus}) {
		await $({env})`${vmScript} ${bus} move ${fromSlot} ${toSlot}`
	}

	async function reflash() {
		await $({env})`${vmScript} reflash`
	}

	// Sends an ACPI power button event, like pressing the physical button
	async function pressPowerButton() {
		await $({env})`${vmScript} power-button`
	}

	// Types text on the keyboard, e.g. to answer the USB installer's prompts.
	// Supports lowercase letters, digits, spaces and \n for Enter.
	async function typeText(text: string) {
		await $({env})`${vmScript} type ${text}`
	}

	async function cleanup() {
		await powerOff()
		await modelsServer?.close()
		await directory.destroyRoot()
	}

	async function waitForShutdown() {
		await pWaitFor(() => !isRunning(), {interval: 100, timeout: cleanShutdownTimeout})
		vmProcessPid = undefined
	}

	// The password that most recently authenticated over SSH (see ssh() below)
	let likelySshPassword = 'umbrel'

	async function ssh(command: string) {
		const attemptSsh = (password: string) =>
			new Promise<string>((resolve, reject) => {
				const conn = new SshClient()
				conn.on('ready', () => {
					conn.exec(command, (err, stream) => {
						if (err) {
							conn.end()
							return reject(err)
						}
						let stdout = ''
						stream.on('data', (data: Buffer) => (stdout += data.toString()))
						stream.stderr.on('data', () => {})
						stream.on('close', () => {
							conn.end()
							resolve(stdout)
						})
					})
				})
				conn.on('error', reject)
				conn.connect({
					host: 'localhost',
					port: sshPort,
					username: 'umbrel',
					password,
					// A TCG-emulated guest under peak load (e.g. a Pi VM right after
					// first boot with docker, umbreld and SquashFS decompression all
					// competing for the emulated cores) can take minutes to complete
					// the SSH key exchange — ssh2's default 20s readyTimeout flakes
					// there, so give each attempt a much bigger budget.
					readyTimeout: 60_000,
				})
			})

		// Try the password that last worked first, fall back to the other one and
		// remember it (registration syncs the user's password over the default
		// 'umbrel' one). Always leading with 'umbrel' meant every post-registration
		// call burned a failed auth attempt, and sshd's PerSourcePenalties
		// (default-on in OpenSSH 9.8+) eventually refuses connections from a
		// source that keeps failing auth — ssh-heavy tests flaked with
		// "Connection lost before handshake" once the accumulated penalty tripped.
		// 9 attempts x (60s handshake budget + 2s wait) stays just inside the
		// 10 minute test timeout.
		return pRetry(
			async () => {
				const fallbackPassword = likelySshPassword === 'umbrel' ? userCredentials.password : 'umbrel'
				try {
					return await attemptSsh(likelySshPassword)
				} catch (error) {
					if ((error as {level?: string}).level === 'client-authentication') {
						const output = await attemptSsh(fallbackPassword)
						likelySshPassword = fallbackPassword
						return output
					}
					throw error
				}
			},
			{retries: 8, minTimeout: 2000, maxTimeout: 2000},
		)
	}

	async function sshAsRoot(command: string) {
		const encodedCommand = Buffer.from(command).toString('base64')
		const exitMarker = '__umbrel_vm_ssh_as_root_exit__'
		const authFailureMarker = '__umbrel_vm_ssh_as_root_auth_failed__'
		const output = await pRetry(
			async () => {
				const output = await ssh(`
set -u
encoded_command='${encodedCommand}'
for password in '${userCredentials.password}' 'umbrel'; do
	if printf '%s\\n' "$password" | sudo -S -p '' true >/dev/null 2>&1; then
		set +e
		printf '%s\\n' "$password" | sudo -S -p '' sh -c "printf '%s' '$encoded_command' | base64 -d | sh" 2>&1
		status=$?
		printf '\\n${exitMarker}%s\\n' "$status"
		exit 0
	fi
done
printf '\\n${authFailureMarker}\\n'
`)

				// Registration changes both the login and sudo password. There is a
				// brief window while that change is being applied where neither the old
				// nor new sudo password works, even though SSH itself is available.
				// Retry only this pre-command authentication failure; command failures
				// are parsed below and are never re-executed.
				if (output.trim() === authFailureMarker) {
					throw new Error('Root SSH authentication was temporarily unavailable')
				}

				return output
			},
			{retries: 8, minTimeout: 2000, maxTimeout: 2000},
		)
		const match = output.match(new RegExp(`\\n?${exitMarker}(\\d+)\\n?$`))
		if (!match) throw new Error(`Root SSH command did not report an exit status:\n${output}`)

		const stdout = output.slice(0, match.index).trimEnd()
		const exitCode = Number(match[1])
		if (exitCode !== 0) throw new Error(`Root SSH command failed with exit code ${exitCode}:\n${stdout}`)

		return stdout
	}

	function getHostPort(guestPort: number) {
		const forward = allocatedForwardPorts.find((forward) => forward.guestPort === guestPort)
		if (!forward) throw new Error(`Guest port ${guestPort} is not forwarded`)
		return forward.hostPort
	}

	const vm = {
		// Matches --data-directory in the OS image's umbrel.service
		dataDirectory: '/home/umbrel/umbrel',
		stateDir,
		get sshPort() {
			return sshPort
		},
		get httpPort() {
			return httpPort
		},
		get pid() {
			return vmProcessPid
		},
		getHostPort,
		isRunning,
		waitForShutdown,
		powerOn,
		powerOff,
		forcePowerOff,
		addNvme,
		removeNvme,
		addUfs,
		removeUfs,
		disconnectNvme,
		connectNvme,
		disconnectHdd,
		connectHdd,
		moveNvme,
		moveHdd,
		addHdd,
		addSsd,
		removeHdd,
		addUsbStorage,
		removeUsbStorage,
		disconnectUsbStorage,
		connectUsbStorage,
		addUsbSerial,
		removeUsbSerial,
		disconnectUsbSerial,
		connectUsbSerial,
		swapUsbSerial,
		addUsbNet,
		disconnectUsbNet,
		connectUsbNet,
		reflash,
		pressPowerButton,
		typeText,
		ssh,
		sshAsRoot,
	}

	return {
		vm,
		client,
		unauthenticatedClient,
		api,
		browserApi,
		unauthenticatedApi,
		setAuthToken,
		setBrowserSession,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
		cleanup,
	}
}
