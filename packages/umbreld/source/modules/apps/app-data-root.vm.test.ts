import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {waitForExternalStorage} from '../backups/backups.vm-test-helpers.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'

const appId = 'sparkles-storage'
const externalPath = '/External/AppStorage'
const externalParentPath = `${externalPath}/My Apps`
const externalDataRootPath = `${externalParentPath}/${appId}`
const internalDataRoot = `/home/umbrel/umbrel/app-data/${appId}/data`
const externalSystemRoot = '/home/umbrel/umbrel/external/AppStorage'
const externalDataRoot = `${externalSystemRoot}/My Apps/${appId}`
const dataFile = 'server/persistence.txt'

describe.sequential('App data root storage lifecycle', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false

	// Two boots, a format and waiting for apps can outlast the default hook timeout
	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		gitServer = await runGitServer({additionalApps: [appId]})
		await umbreld.vm.addUsbStorage({slot: 1, size: '8G'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		const devices = await umbreld.client.files.externalDevices.query()
		const usbDevice = devices.find((device) => device.transport === 'usb')
		expect(usbDevice).toBeDefined()
		await expect(
			umbreld.client.files.formatExternalDevice.mutate({
				deviceId: usbDevice!.id,
				filesystem: 'ext4',
				label: 'AppStorage',
			}),
		).resolves.toBe(true)

		// Reboot once after formatting, just as the real product flow does, so all
		// later assertions exercise normal discovery and mounting of the filesystem.
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForExternalStorage(umbreld, {path: externalPath})

		// Login becomes available while Apps is still starting. Wait for the shared
		// app framework before installing the fixture app. After a reboot with
		// external storage on a busy CI runner this has taken over 2 minutes, so
		// allow up to 10, like the other post-boot waits.
		await pRetry(() => umbreld.vm.sshAsRoot("docker inspect --format '{{.State.Running}}' tor_proxy | grep -qx true"), {
			retries: 600,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
	}, 25 * 60_000)

	afterAll(async () => {
		await umbreld?.cleanup()
		await gitServer?.close()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const waitForAppState = async (state: string) => {
		await pRetry(
			async () => {
				await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state})
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	const listedApp = async () => {
		const app = (await umbreld.client.apps.list.query()).find((candidate) => candidate.id === appId)
		if (!app || 'error' in app) throw new Error(`Failed to read installed app ${appId}`)
		return app
	}
	const expectContainerData = () =>
		umbreld.vm.sshAsRoot(`
set -eu
container="$(docker ps -q --filter 'label=com.docker.compose.project=${appId}' --filter 'label=com.docker.compose.service=server')"
test -n "$container"
test "$(docker exec "$container" cat /data/persistence.txt)" = 'persistent app data'
`)

	test('installs a manifest-v1 app with the complete data-root capability', async () => {
		const repositoryUrl = gitServer.url.replace('localhost', '10.0.2.2')
		await umbreld.client.appStore.addRepository.mutate({url: repositoryUrl})
		await pRetry(
			async () => {
				const registry = await umbreld.client.appStore.registry.query()
				expect(registry.some((repository) => repository.apps.some((app) => app.id === appId))).toBe(true)
			},
			{retries: 60, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		await expect(umbreld.client.apps.install.mutate({appId})).resolves.toBe(true)
		await waitForAppState('ready')
		await umbreld.vm.sshAsRoot(`
set -eu
compose='/home/umbrel/umbrel/app-data/${appId}/docker-compose.yml'
grep -Fq 'source: \${APP_DATA_ROOT}/server' "$compose"
grep -Fq 'create_host_path: false' "$compose"
container="$(docker ps -q --filter 'label=com.docker.compose.project=${appId}' --filter 'label=com.docker.compose.service=server')"
test "$(docker inspect --format '{{len .HostConfig.Binds}}' "$container")" = '0'
test "$(docker inspect --format '{{len .HostConfig.Mounts}}' "$container")" = '1'
`)
		expect((await listedApp()).storage?.dataRoot).toMatchObject({
			location: null,
			canMoveExternally: true,
			status: 'available',
		})

		// App data is intentionally protected from ordinary Files writes, so seed a
		// persistent fixture directly in the real VM filesystem.
		await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${internalDataRoot}/server'
printf '%s' 'persistent app data' > '${internalDataRoot}/${dataFile}'
chown -R 1000:1000 '${internalDataRoot}'
`)
		await expectContainerData()
	})

	test('moves the complete data root onto the real external filesystem', async () => {
		// The user chooses where apps should live on the drive. Umbrel owns only the
		// app-specific directory that it creates beneath that selected parent.
		await expect(umbreld.client.files.createDirectory.mutate({path: externalParentPath})).resolves.toMatchObject({
			created: true,
		})
		await expect(
			umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: externalParentPath}),
		).resolves.toBe(true)
		await waitForAppState('ready')
		expect((await listedApp()).storage?.dataRoot).toMatchObject({
			location: externalDataRootPath,
			canMoveExternally: true,
			status: 'available',
		})
		await umbreld.vm.sshAsRoot(`
set -eu
test "$(cat '${externalDataRoot}/${dataFile}')" = 'persistent app data'
test ! -e '${internalDataRoot}'
test "$(findmnt --target '${externalSystemRoot}' --noheadings --output FSTYPE)" = 'ext4'
`)
		await expectContainerData()
	})

	test('keeps the external data root working across a reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForExternalStorage(umbreld, {path: externalPath})
		await waitForAppState('ready')
		expect((await listedApp()).storage?.dataRoot).toMatchObject({location: externalDataRootPath, status: 'available'})
		await umbreld.vm.sshAsRoot(`
set -eu
test "$(cat '${externalDataRoot}/${dataFile}')" = 'persistent app data'
test "$(findmnt --target '${externalSystemRoot}' --noheadings --output FSTYPE)" = 'ext4'
`)
		await expectContainerData()
	})

	test('blocks eject while the app is using the external drive', async () => {
		const devices = await umbreld.client.files.externalDevices.query()
		const usbDevice = devices.find((device) => device.transport === 'usb')
		expect(usbDevice).toBeDefined()
		await expect(umbreld.client.files.unmountExternalDevice.mutate({deviceId: usbDevice!.id})).rejects.toThrow(
			'storage-in-use-by-apps',
		)
	})

	test('prevents a crashed app from falling back to internal storage', async () => {
		// Remove the USB device while the app is still running, then kill only its
		// process. Docker's on-failure policy exercises the real crash-restart path.
		await umbreld.vm.sshAsRoot('sync')
		await umbreld.vm.disconnectUsbStorage({slot: 1})
		await pRetry(() => umbreld.vm.sshAsRoot(`! findmnt --mountpoint '${externalSystemRoot}' >/dev/null 2>&1`), {
			retries: 60,
			factor: 1,
			minTimeout: 500,
			maxTimeout: 500,
		})
		await umbreld.vm.sshAsRoot(`
set -eu
container="$(docker ps -q --filter 'label=com.docker.compose.project=${appId}' --filter 'label=com.docker.compose.service=server')"
test -n "$container"
pid="$(docker inspect --format '{{.State.Pid}}' "$container")"
kill -KILL "$pid"
`)
		await pRetry(
			() =>
				umbreld.vm.sshAsRoot(`
set -eu
container="$(docker ps -aq --filter 'label=com.docker.compose.project=${appId}' --filter 'label=com.docker.compose.service=server')"
test "$(docker inspect --format '{{.State.Running}}' "$container")" = 'false'
test ! -e '${externalDataRoot}'
`),
			{retries: 60, factor: 1, minTimeout: 500, maxTimeout: 500},
		)

		await pRetry(
			async () => {
				expect((await listedApp()).storage?.dataRoot).toMatchObject({
					location: externalDataRootPath,
					status: 'storage-unavailable',
				})
			},
			{retries: 60, factor: 1, minTimeout: 500, maxTimeout: 500},
		)

		// A container crash does not itself update umbreld's cached lifecycle state.
		// An Umbrel-managed start still fails closed and marks the app for the normal
		// storage-reconnect retry path.
		await expect(umbreld.client.apps.start.mutate({appId})).rejects.toThrow('apps-data-root-unavailable')
		await waitForAppState('unknown')

		await umbreld.vm.connectUsbStorage({slot: 1})
		await waitForExternalStorage(umbreld, {path: externalPath})
		await waitForAppState('ready')
		expect((await listedApp()).storage?.dataRoot).toMatchObject({
			location: externalDataRootPath,
			status: 'available',
		})
		await expectContainerData()
	})

	test('moves the complete data root back to internal storage', async () => {
		await expect(umbreld.client.apps.moveDataRoot.mutate({appId, destinationParentPath: null})).resolves.toBe(true)
		await waitForAppState('ready')
		expect((await listedApp()).storage?.dataRoot).toMatchObject({
			location: null,
			canMoveExternally: true,
			status: 'available',
		})
		await umbreld.vm.sshAsRoot(`
set -eu
test "$(cat '${internalDataRoot}/${dataFile}')" = 'persistent app data'
test ! -e '${externalDataRoot}'
`)
		await expectContainerData()
	})
})
