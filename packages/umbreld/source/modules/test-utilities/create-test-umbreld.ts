import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import got from 'got'
import {CookieJar} from 'tough-cookie'
import {$} from 'execa'
import fse from 'fs-extra'
import getPort from 'get-port'
import pWaitFor from 'p-wait-for'

import Umbreld from '../../index.js'
import type {AppRouter} from '../server/trpc/index.js'

import temporaryDirectory from '../utilities/temporary-directory.js'
import runGitServer from './run-git-server.js'

function createTestHelpers(port: number) {
	let jwt = ''
	const setJwt = (newJwt: string) => {
		jwt = newJwt
	}

	const client = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `http://localhost:${port}/trpc`,
				headers: async () => ({
					Authorization: `Bearer ${jwt}`,
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

	const userCredentials = {
		name: 'satoshi',
		password: 'moneyprintergobrrr',
	}

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
			{interval: 1000, timeout: 30_000},
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
			{interval: 2000, timeout: 120_000},
		)
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
	}
}

export default async function createTestUmbreld({autoLogin = false, autoStart = true} = {}) {
	const directory = temporaryDirectory()
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
		cleanup,
	}
}

export async function createTestVm() {
	const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
	const vmScript = path.resolve(currentDirectory, '../../../../os/vm.sh')
	const vmImagePath = path.resolve(currentDirectory, '../../../../os/build/umbrelos-amd64.img')

	if (!(await fse.pathExists(vmImagePath))) {
		throw new Error(
			'No umbrelos image found. Build one with `npm run build:amd64` in packages/os or specify the image path.',
		)
	}

	const directory = temporaryDirectory()
	await directory.createRoot()
	const stateDir = await directory.create()
	const env = {VM_STATE_DIR: stateDir}

	const sshPort = await getPort()
	const httpPort = await getPort()

	let vmProcessPid: number | undefined

	async function powerOn() {
		const vmProcess = $({
			env,
			detached: true,
			stdio: 'ignore',
		})`${vmScript} boot ${vmImagePath} --ssh-port ${sshPort} --http-port ${httpPort}`
		vmProcess.unref()
		vmProcessPid = vmProcess.pid

		await pWaitFor(
			async () => {
				try {
					await unauthenticatedClient.user.exists.query()
					return true
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 120_000},
		)
	}

	async function powerOff() {
		if (vmProcessPid) {
			try {
				process.kill(-vmProcessPid, 'SIGTERM')
			} catch {
				// VM process may already be dead
			}
			vmProcessPid = undefined
		}
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
	} = createTestHelpers(httpPort)

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
		async ssh(command: string) {
			const {stdout} =
				await $`ssh -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null umbrel@localhost ${command}`
			return stdout
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
		cleanup,
	}
}
