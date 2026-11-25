import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'

const appId = 'sparkles-hello-world'
const appDataDirectory = `/home/umbrel/umbrel/app-data/${appId}`

describe.sequential('Uninstalling an app whose app-data files are missing', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		gitServer = await runGitServer()
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await umbreld.client.appStore.addRepository.mutate({url: gitServer.url.replace('localhost', '10.0.2.2')})
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

	const containers = async () =>
		(
			await umbreld.vm.sshAsRoot(
				`docker ps --all --filter label=com.docker.compose.project=${appId} --format '{{.Names}}'`,
			)
		)
			.split('\n')
			.filter(Boolean)

	const installApp = async () => {
		await expect(umbreld.client.apps.install.mutate({appId})).resolves.toBe(true)
		await pRetry(
			async () => {
				await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'ready'})
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
		await expect(containers()).resolves.toEqual([`${appId}_server_1`])
	}

	const expectUninstalled = async () => {
		const installedApps = await umbreld.client.apps.list.query()
		expect(installedApps.some((app) => app.id === appId)).toBe(false)
		await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'not-installed'})
		await expect(containers()).resolves.toEqual([])
		await expect(umbreld.vm.sshAsRoot(`test ! -e '${appDataDirectory}' && echo gone`)).resolves.toBe('gone')
	}

	test('installs the app', async () => {
		await installApp()
	})

	test('uninstalls the app when only its data folder is left in app-data', async () => {
		// Lose the Compose file, manifest, exports and settings but keep data/, as
		// seen on real devices. There's no product path to this state, so use SSH.
		await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${appDataDirectory}/data'
find '${appDataDirectory}' -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
test "$(ls -A '${appDataDirectory}')" = data
`)

		await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toBe(true)
		await expectUninstalled()
	})

	test('reinstalls the app after the data-only uninstall', async () => {
		await installApp()
	})

	test('uninstalls the app when its app-data folder has been deleted', async () => {
		await umbreld.vm.sshAsRoot(`rm -rf '${appDataDirectory}'`)

		await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toBe(true)
		await expectUninstalled()
	})

	test('reinstalls the app after the deleted-folder uninstall', async () => {
		await installApp()
	})

	test('still uninstalls an intact app normally', async () => {
		await expect(umbreld.client.apps.uninstall.mutate({appId})).resolves.toBe(true)
		await expectUninstalled()
	})
})
