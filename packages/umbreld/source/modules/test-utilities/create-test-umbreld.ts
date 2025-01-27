import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'

import Umbreld from '../../index.js'
import type {AppRouter} from '../server/trpc/index.js'

import temporaryDirectory from '../utilities/temporary-directory.js'
import runGitServer from './run-git-server.js'

export default async function createTestUmbreld() {
	const directory = temporaryDirectory()
	await directory.create()
	let jwt = ''

	function setJwt(newJwt: string) {
		jwt = newJwt
	}

	const gitServer = await runGitServer()

	const dataDirectory = await directory.createInner()
	const umbreld = new Umbreld({
		dataDirectory,
		port: 0,
		logLevel: 'silent',
		defaultAppStoreRepo: gitServer.url,
	})
	await umbreld.start()

	const client = createTRPCProxyClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `http://localhost:${umbreld.server.port}/trpc`,
				headers: async () => ({
					Authorization: `Bearer ${jwt}`,
				}),
			}),
		],
	})

	const userCredentials = {
		name: 'satoshi',
		password: 'moneyprintergobrrr',
	}

	async function registerAndLogin() {
		await client.user.register.mutate(userCredentials)
		const token = await client.user.login.mutate(userCredentials)
		setJwt(token)

		return true
	}

	async function ensureLoggedIn() {
		await client.user.register.mutate(userCredentials).catch(() => {})
		const token = await client.user.login.mutate(userCredentials)
		setJwt(token)

		return true
	}

	async function ensureLoggedOut() {
		await client.user.logout.mutate().catch(() => {})
		setJwt('')

		return true
	}

	async function cleanup() {
		await gitServer.close()
		await directory.destroy()
	}

	return {
		instance: umbreld,
		client,
		setJwt,
		registerAndLogin,
		ensureLoggedIn,
		ensureLoggedOut,
		cleanup,
	}
}
