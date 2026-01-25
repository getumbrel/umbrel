import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createTRPCProxyClient, httpBatchLink, createWSClient, wsLink, splitLink} from '@trpc/client'
import got from 'got'
import {CookieJar} from 'tough-cookie'
import {$} from 'execa'
import fse from 'fs-extra'
import getPort from 'get-port'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'
import {Client as SshClient} from 'ssh2'

import Umbreld from '../../index.js'
import type {AppRouter} from '../server/trpc/index.js'
import type {events} from '../event-bus/event-bus.js'

import temporaryDirectory from '../utilities/temporary-directory.js'
import runGitServer from './run-git-server.js'

// Use the data/ directory in the umbreld package root for test temp files
// This avoids filling up RAM-based tmpfs when running many tests in parallel
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const testDataDirectory = path.resolve(currentDirectory, '../../../data')

const userCredentials = {
	name: 'satoshi',
	password: 'moneyprintergobrrr',
}

function createTestHelpers(port: number) {
	let jwt = ''
	const setJwt = (newJwt: string) => {
		jwt = newJwt
	}

	// Create WebSocket client for subscriptions
	const wsClient = createWSClient({
		url: () => `ws://localhost:${port}/trpc?token=${jwt}`,
		retryDelayMs: () => 100,
	})

	const client = createTRPCProxyClient<AppRouter>({
		links: [
			splitLink({
				condition: (op) => op.type === 'subscription',
				true: wsLink({client: wsClient}),
				false: httpBatchLink({
					url: `http://localhost:${port}/trpc`,
					headers: async () => ({
						Authorization: `Bearer ${jwt}`,
					}),
				}),
			}),
		],
	})

	const unauthenticatedClient = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `http://localhost:${port}/trpc`,
			}),
		],
	})

	const unauthenticatedApi = got.extend({
		prefixUrl: `http://localhost:${port}/api`,
		retry: {limit: 0},
		responseType: 'json',
	})
	const cookieJar = new CookieJar()
	const api = unauthenticatedApi.extend({cookieJar})

	async function signup({raidDevices, raidType}: {raidDevices?: string[]; raidType?: 'storage' | 'failsafe'} = {}) {
		await unauthenticatedClient.user.register.mutate({...userCredentials, raidDevices, raidType})
	}

	async function login() {
		// Retry login to handle race condition where user exists but password isn't set yet
		await pWaitFor(
			async () => {
				try {
					const token = await client.user.login.mutate(userCredentials)
					setJwt(token)
					await api.post('../trpc/user.login', {json: userCredentials})
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

	// Subscribe to events over WebSocket and collect them
	function subscribeToEvents<T>(event: (typeof events)[number]) {
		const collected: T[] = []
		const subscription = client.eventBus.listen.subscribe(
			{event},
			{
				onData: (data) => collected.push(data as T),
				onError: (error) => console.error(`Subscription error for ${event}:`, error),
			},
		)
		return {
			collected,
			unsubscribe: () => subscription.unsubscribe(),
		}
	}

	return {
		client,
		unauthenticatedClient,
		api,
		unauthenticatedApi,
		setJwt,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	}
}

export default async function createTestUmbreld({autoLogin = false, autoStart = true} = {}) {
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
		unauthenticatedApi,
		setJwt,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	} = createTestHelpers(umbreld.server.port!)

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
		unauthenticatedApi,
		setJwt,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
		cleanup,
	}
}

export async function createTestVm() {
	const vmScript = path.resolve(currentDirectory, '../../../../os/vm.sh')
	const vmImagePath = path.resolve(currentDirectory, '../../../../os/build/umbrelos-amd64.img')

	if (!(await fse.pathExists(vmImagePath))) {
		throw new Error(
			'No umbrelos image found. Build one with `npm run build:amd64` in packages/os or specify the image path.',
		)
	}

	const directory = temporaryDirectory({parentDirectory: testDataDirectory})
	await directory.createRoot()
	const stateDir = await directory.create()
	const env = {VM_STATE_DIR: stateDir}

	const sshPort = await getPort()
	const httpPort = await getPort()

	const {
		client,
		unauthenticatedClient,
		api,
		unauthenticatedApi,
		setJwt,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
	} = createTestHelpers(httpPort)

	let vmProcessPid: number | undefined

	async function powerOn() {
		let vmOutput = ''
		let vmExited = false

		const vmProcess = $({
			env,
			detached: true,
		})`${vmScript} boot ${vmImagePath} --ssh-port ${sshPort} --http-port ${httpPort}`
		vmProcessPid = vmProcess.pid

		// Capture output and track if process exits
		vmProcess.stdout?.on('data', (data: Buffer) => (vmOutput += data.toString()))
		vmProcess.stderr?.on('data', (data: Buffer) => (vmOutput += data.toString()))
		vmProcess.on('exit', () => (vmExited = true))

		// Unref so the process doesn't block Node from exiting
		vmProcess.unref()

		await pWaitFor(
			async () => {
				// Check if VM process died
				if (vmExited) {
					throw new Error(`VM process exited unexpectedly:\n${vmOutput}`)
				}
				try {
					await unauthenticatedClient.user.exists.query()
					return true
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 300_000},
		)
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
			await client.system.shutdown.mutate().catch(() => unauthenticatedClient.system.shutdown.mutate())
			// Wait up to 30 seconds for graceful shutdown
			await pWaitFor(() => !isRunning(), {interval: 100, timeout: 30_000})
			vmProcessPid = undefined
			return
		} catch {
			// Graceful shutdown failed, fall through to force kill
		}

		// Force kill if still running
		try {
			process.kill(-vmProcessPid!, 'SIGTERM')
			console.log('VM did not shut down cleanly, sending SIGTERM to process')
		} catch {
			// Already dead
		}

		// Wait up to 10 seconds for force kill to take effect
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

	async function disconnectNvme({slot}: {slot: number}) {
		await $({env})`${vmScript} nvme disconnect ${slot}`
	}

	async function connectNvme({slot}: {slot: number}) {
		await $({env})`${vmScript} nvme connect ${slot}`
	}

	async function moveNvme({fromSlot, toSlot}: {fromSlot: number; toSlot: number}) {
		await $({env})`${vmScript} nvme move ${fromSlot} ${toSlot}`
	}

	async function reflash() {
		await $({env})`${vmScript} reflash`
	}

	async function cleanup() {
		await powerOff()
		await directory.destroyRoot()
	}

	const vm = {
		dataDirectory: '/data/umbrel',
		stateDir,
		sshPort,
		httpPort,
		get pid() {
			return vmProcessPid
		},
		powerOn,
		powerOff,
		addNvme,
		removeNvme,
		disconnectNvme,
		connectNvme,
		moveNvme,
		reflash,
		async ssh(command: string) {
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
					})
				})

			// Try default 'umbrel' password first, fall back to user password if already synced
			// Retry up to 10 times with 1 second wait between attempts
			return pRetry(
				async () => {
					try {
						return await attemptSsh('umbrel')
					} catch (error) {
						if ((error as {level?: string}).level === 'client-authentication') {
							return await attemptSsh(userCredentials.password)
						}
						throw error
					}
				},
				{retries: 10, minTimeout: 1000, maxTimeout: 1000},
			)
		},
	}

	return {
		vm,
		client,
		unauthenticatedClient,
		api,
		unauthenticatedApi,
		setJwt,
		signup,
		login,
		registerAndLogin,
		waitForStartup,
		subscribeToEvents,
		cleanup,
	}
}
