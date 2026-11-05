import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {piStartupTimeout, waitForUsbDisks, waitForUsbPartitionByUuid} from './pi-storage-test-helpers.ts'

describe('Pi SD installation with ordinary USB storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let dataDeviceId = ''
	let dataUuid = ''

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', bootDisk: 'sdcard', startupTimeout: piStartupTimeout})
		await umbreld.vm.addUsbStorage({slot: 1})
		await umbreld.vm.addUsbStorage({slot: 2})
		await umbreld.vm.powerOn()
	}, piStartupTimeout + 60_000)

	afterAll(async () => await umbreld?.cleanup())

	async function waitForStartupAutomount() {
		await waitForUsbDisks(umbreld, 2)
		// The two identical QEMU disks can swap /dev/sdX names across boots.
		// Follow the formatted filesystem's stable identity instead.
		dataDeviceId = await waitForUsbPartitionByUuid(umbreld, dataUuid)
		await umbreld.login()
		// Files mounts attached disks as it starts, after the file index, watcher
		// and Samba. Under TCG that is several minutes after the API first answers.
		// Restarting Umbreld here would only throw that startup away.
		await waitForExternalMount()
	}

	async function waitForExternalMount() {
		try {
			await pWaitFor(
				async () => {
					const devices = await umbreld.client.files.externalDevices.query()
					return (
						devices
							.find((device) => device.id === dataDeviceId)
							?.partitions.some((partition) => partition.mountpoints.includes('/External/PI-DATA')) ?? false
					)
				},
				{interval: 1000, timeout: 600_000},
			)
		} catch (error) {
			const devices = await umbreld.client.files.externalDevices.query().catch((queryError) => ({queryError}))
			const lsblk = await umbreld.vm.ssh('lsblk --output NAME,TYPE,TRAN,LABEL,UUID,MOUNTPOINTS')
			const mounts = await umbreld.vm.ssh('findmnt --real --output SOURCE,TARGET,FSTYPE || true')
			const logs = await umbreld.vm.sshAsRoot(
				'journalctl -u umbrel.service -u umbrel-external-storage.service --no-pager -n 250 || true',
			)
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\n` +
					`External devices:\n${JSON.stringify(devices, null, 2)}\n` +
					`lsblk:\n${lsblk}\nfindmnt:\n${mounts}\nservice logs:\n${logs}`,
			)
		}
	}

	test(
		'leaves every blank USB disk untouched during first boot',
		async () => {
			const disks = await waitForUsbDisks(umbreld, 2)
			expect(disks.every((disk) => (disk.children ?? []).length === 0)).toBe(true)

			const devices = await umbreld.unauthenticatedClient.files.externalDevices.query()
			expect(devices).toHaveLength(2)
			expect(devices.every((device) => device.partitions.length === 0)).toBe(true)
			;[dataDeviceId] = devices.map((device) => device.id).sort()

			const umbrelSource = await umbreld.vm.ssh('findmnt -n -o SOURCE --target /home/umbrel/umbrel || true')
			expect(umbrelSource).not.toMatch(/\/dev\/sd/)
		},
		piStartupTimeout + 600_000,
	)

	test(
		'creates the account on SD and uses one USB disk through Files',
		async () => {
			await umbreld.registerAndLogin()
			await umbreld.client.files.createDirectory.mutate({path: '/Home/sd-home-marker'})

			await umbreld.client.files.formatExternalDevice.mutate({
				deviceId: dataDeviceId,
				filesystem: 'ext4',
				label: 'PI-DATA',
			})
			// Formatting can finish before QEMU's Pi USB controller exposes the
			// partition metadata to lsblk. Wait until Files can see the new partition
			// before restarting Umbreld to exercise startup automount.
			await pWaitFor(
				async () => {
					const devices = await umbreld.client.files.externalDevices.query()
					return (
						devices
							.find((device) => device.id === dataDeviceId)
							?.partitions.some((partition) => partition.label === 'PI-DATA') ?? false
					)
				},
				{interval: 1000, timeout: 120_000},
			)
			dataUuid = (await umbreld.vm.ssh(`lsblk -no UUID /dev/${dataDeviceId}1`)).trim()
			expect(dataUuid).not.toBe('')
			// QEMU's Pi USB controller does not reliably emit the systemd hotplug
			// event that Files listens for after formatting. Safely eject the disk and
			// power cycle so QEMU reattaches it, then exercise Files' startup automount.
			await umbreld.client.files.unmountExternalDevice.mutate({deviceId: dataDeviceId})
			await umbreld.vm.powerOff()
			await umbreld.vm.powerOn()
			await waitForStartupAutomount()

			await umbreld.client.files.createDirectory.mutate({path: '/External/PI-DATA/external-marker'})
		},
		piStartupTimeout + 600_000,
	)

	test(
		'keeps the SD account and ordinary USB data intact across reboot',
		async () => {
			// QEMU often has to force-kill the emulated Pi during shutdown. Safely
			// eject the removable filesystem first so the forced power-off cannot
			// leave it dirty (Files intentionally does not fsck arbitrary disks).
			await umbreld.client.files.unmountExternalDevice.mutate({deviceId: dataDeviceId})
			await umbreld.vm.powerOff()
			await umbreld.vm.powerOn()
			await waitForStartupAutomount()
			await pWaitFor(
				async () => {
					try {
						const listing = await umbreld.client.files.list.query({path: '/External/PI-DATA'})
						return listing.files.some((file) => file.name === 'external-marker')
					} catch {
						return false
					}
				},
				{interval: 1000, timeout: 120_000},
			)

			const home = await umbreld.client.files.list.query({path: '/Home'})
			expect(home.files).toContainEqual(expect.objectContaining({name: 'sd-home-marker'}))

			expect((await umbreld.vm.ssh(`lsblk -no UUID /dev/${dataDeviceId}1`)).trim()).toBe(dataUuid)
			const devices = await umbreld.client.files.externalDevices.query()
			expect(devices).toHaveLength(2)
			expect(await umbreld.vm.ssh('findmnt -n -o SOURCE --target /home/umbrel/umbrel || true')).not.toMatch(/\/dev\/sd/)
		},
		piStartupTimeout + 600_000,
	)
})
