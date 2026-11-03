import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

describe.sequential('Network storage lifecycle', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let mountPath: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function createLocalSambaShare(shareName: string) {
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}`})
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}/source-marker`})
		await umbreld.api.post(`files/upload?path=/Home/${shareName}/test-file.txt`, {body: 'test content'})
		await umbreld.client.files.addShare.mutate({path: `/Home/${shareName}`})
	}

	async function mountLocalSambaShare(shareName: string) {
		const sharePassword = await umbreld.client.files.sharePassword.query()

		return pRetry(
			() =>
				umbreld.client.files.addNetworkShare.mutate({
					host: 'localhost',
					share: `${shareName} (Umbrel)`,
					username: 'umbrel',
					password: sharePassword,
				}),
			{retries: 10, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	async function expectMountedShareToContain(name: string) {
		await pRetry(
			async () => {
				await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							mountPath,
							isMounted: true,
						}),
					]),
				)

				const listing = await umbreld.client.files.list.query({path: mountPath})
				expect(listing.files.map((file) => file.name)).toContain(name)
			},
			// The remount watcher retries every 60 seconds. Allow one missed
			// startup mount attempt when Samba is still coming up after reboot.
			{retries: 90, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	const cifsMountCount = async () =>
		Number((await umbreld.vm.ssh(`awk '$3 == "cifs" {count++} END {print count + 0}' /proc/mounts`)).trim())

	test('adds a CIFS share that later lifecycle checks can remount', async () => {
		const shareName = 'network-lifecycle-test'
		await createLocalSambaShare(shareName)

		mountPath = await mountLocalSambaShare(shareName)
		expect(mountPath).toBe(`/Network/localhost/${shareName} (Umbrel)`)
		await expectMountedShareToContain('source-marker')
	})

	test('auto-mounts configured network shares after a VM reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await expectMountedShareToContain('source-marker')
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					mountPath,
					isMounted: true,
				}),
			]),
		)
	})

	test('unmounts CIFS shares when umbreld stops and remounts them on start', async () => {
		await pRetry(
			async () => {
				expect(await cifsMountCount()).toBeGreaterThan(0)
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		// The files API has no endpoint for stopping umbreld while leaving the VM running;
		// restarting the systemd service verifies the real shutdown/startup mount handlers.
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await pRetry(
			async () => {
				expect(await cifsMountCount()).toBe(0)
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		await expectMountedShareToContain('source-marker')
	})

	test('recovers when the SMB server goes offline and then comes back', async () => {
		// There is no product API for simulating a network file server outage. Stopping
		// smbd keeps the client VM alive while exercising the real CIFS recovery path.
		await umbreld.vm.sshAsRoot('systemctl stop smbd')

		await pRetry(
			async () => {
				await expect(
					umbreld.client.files.createDirectory.mutate({path: `${mountPath}/during-outage`}),
				).rejects.toThrow()
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		await umbreld.vm.sshAsRoot('systemctl start smbd')

		// As above: the remount watcher only retries every 60 seconds, so allow a
		// full missed cycle before the share becomes writable again.
		await pRetry(() => umbreld.client.files.createDirectory.mutate({path: `${mountPath}/after-outage`}), {
			retries: 90,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		await expectMountedShareToContain('after-outage')
	})

	test('removes an unmounted configured share while its SMB server is offline', async () => {
		const offlineShareName = 'network-offline-removal-test'
		await createLocalSambaShare(offlineShareName)
		const offlineMountPath = await mountLocalSambaShare(offlineShareName)

		// Stop Umbreld while Samba is healthy so the real shutdown handler cleanly
		// detaches the CIFS filesystem and removes its empty mount directory.
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await pRetry(
			async () => {
				expect(await cifsMountCount()).toBe(0)
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
		// This VM also hosts the Samba fixture, and Umbreld normally starts it
		// for local shares. A runtime mask keeps that simulated remote server
		// offline while allowing Umbreld itself to start.
		await umbreld.vm.sshAsRoot('systemctl mask --runtime smbd')
		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		// The configured share is now offline. Removal must not depend on the
		// server returning or on the timing of internal mount-directory cleanup.
		await pRetry(
			async () => {
				await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							mountPath: offlineMountPath,
							isMounted: false,
						}),
					]),
				)
			},
			{retries: 20, factor: 1, minTimeout: 500, maxTimeout: 500},
		)

		await expect(umbreld.client.files.removeNetworkShare.mutate({mountPath: offlineMountPath})).resolves.toBe(true)
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({mountPath: offlineMountPath})]),
		)

		// Returning the server must not resurrect a share the user removed.
		await umbreld.vm.sshAsRoot('systemctl unmask --runtime smbd')
		await umbreld.vm.sshAsRoot('systemctl start smbd')
		await new Promise((resolve) => setTimeout(resolve, 1000))
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({mountPath: offlineMountPath})]),
		)
	})
})
