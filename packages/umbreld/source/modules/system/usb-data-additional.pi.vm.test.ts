import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	createLegacyUsbInstall,
	expectLegacySystemMounts,
	piStartupTimeout,
	rebootIntoLegacyUsbInstall,
	waitForUsbPartition,
} from './pi-storage-test-helpers.ts'

describe('Pi legacy USB data installation with an additional USB disk', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let additionalDeviceId = ''

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', bootDisk: 'sdcard', startupTimeout: piStartupTimeout})
		// Put the legacy disk in the later USB slot. The ordinary disk added
		// below can then enumerate first without hiding a slower legacy disk.
		await umbreld.vm.addUsbStorage({slot: 2})
		await umbreld.vm.powerOn()
	}, piStartupTimeout + 60_000)

	afterAll(async () => await umbreld?.cleanup())

	async function rebootIntoLegacyWithAdditionalStorage() {
		await rebootIntoLegacyUsbInstall(umbreld, 2)
		await waitForUsbPartition(umbreld, additionalDeviceId, 'PI-EXTRA')
		// QEMU's Pi USB controller does not reliably emit the systemd disk
		// event for the additional drive. Restart with both disks visible to
		// exercise Files' normal startup automount path deterministically.
		await umbreld.vm.sshAsRoot('systemctl restart umbrel.service')
		await umbreld.waitForStartup()
		await umbreld.login()
		// Files mounts attached disks as it starts, after the file index, watcher
		// and Samba. Under TCG that is several minutes after the API first answers.
		await pWaitFor(
			async () => {
				try {
					const listing = await umbreld.client.files.list.query({path: '/External/PI-EXTRA'})
					return listing.files.some((file) => file.name === 'additional-marker')
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
	}

	test(
		'creates and boots an authentic legacy installation before adding another disk',
		async () => {
			await createLegacyUsbInstall(umbreld)
			await rebootIntoLegacyUsbInstall(umbreld)
			await expectLegacySystemMounts(umbreld)

			await umbreld.registerAndLogin()
			await umbreld.client.files.createDirectory.mutate({path: '/Home/legacy-home-marker'})
		},
		piStartupTimeout + 600_000,
	)

	test(
		'mounts the legacy installation when a second blank USB disk is attached',
		async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.addUsbStorage({slot: 1})
			await rebootIntoLegacyUsbInstall(umbreld, 2)
			await expectLegacySystemMounts(umbreld)
			await umbreld.login()

			const home = await umbreld.client.files.list.query({path: '/Home'})
			expect(home.files).toContainEqual(expect.objectContaining({name: 'legacy-home-marker'}))

			const devices = await umbreld.client.files.externalDevices.query()
			expect(devices).toHaveLength(1)
			expect(devices[0].partitions).toHaveLength(0)
			additionalDeviceId = devices[0].id
		},
		piStartupTimeout + 600_000,
	)

	test('uses the additional disk through Files without changing the legacy system disk', async () => {
		await umbreld.client.files.formatExternalDevice.mutate({
			deviceId: additionalDeviceId,
			filesystem: 'ext4',
			label: 'PI-EXTRA',
		})
		await pWaitFor(
			async () => {
				const devices = await umbreld.client.files.externalDevices.query()
				return (
					devices
						.find((device) => device.id === additionalDeviceId)
						?.partitions.some((partition) => partition.mountpoints.includes('/External/PI-EXTRA')) ?? false
				)
			},
			{interval: 1000, timeout: 120_000},
		)
		await umbreld.client.files.createDirectory.mutate({path: '/External/PI-EXTRA/additional-marker'})
		await expectLegacySystemMounts(umbreld)
	})

	test(
		'preserves both legacy system data and additional Files data across reboot',
		async () => {
			await umbreld.client.files.unmountExternalDevice.mutate({deviceId: additionalDeviceId})
			await rebootIntoLegacyWithAdditionalStorage()

			const home = await umbreld.client.files.list.query({path: '/Home'})
			expect(home.files).toContainEqual(expect.objectContaining({name: 'legacy-home-marker'}))
			await expectLegacySystemMounts(umbreld)
		},
		piStartupTimeout + 600_000,
	)
})
