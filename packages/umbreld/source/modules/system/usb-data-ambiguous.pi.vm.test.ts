import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	createLegacyUsbInstall,
	piStartupTimeout,
	rebootIntoLegacyUsbInstall,
	waitForUsbDisks,
} from './pi-storage-test-helpers.ts'

describe('Pi with two legacy USB data installations', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let secondDeviceId = ''
	let secondMountpoint = ''
	let firstUuid = ''

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', bootDisk: 'sdcard', startupTimeout: piStartupTimeout})
		await umbreld.vm.addUsbStorage({slot: 1})
		await umbreld.vm.powerOn()
	}, piStartupTimeout + 60_000)

	afterAll(async () => await umbreld?.cleanup())

	test(
		'creates the first legacy installation through the historical setup path',
		async () => {
			await createLegacyUsbInstall(umbreld)
			firstUuid = (await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()
			expect(firstUuid).not.toBe('')
			await rebootIntoLegacyUsbInstall(umbreld)
			await umbreld.registerAndLogin()
		},
		piStartupTimeout + 600_000,
	)

	test(
		'adds a second disk and gives it an unambiguous second legacy marker',
		async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.addUsbStorage({slot: 2})
			await rebootIntoLegacyUsbInstall(umbreld, 2)
			await umbreld.login()

			const devices = await umbreld.client.files.externalDevices.query()
			expect(devices).toHaveLength(1)
			secondDeviceId = devices[0].id
			await umbreld.client.files.formatExternalDevice.mutate({
				deviceId: secondDeviceId,
				filesystem: 'ext4',
				label: 'PI-SECOND',
			})
			// Files mounts the formatted disk once its startup reaches external
			// storage, after the file index, watcher and Samba. Under TCG that is
			// several minutes after the API first answers following the reboot above.
			await pWaitFor(
				async () => {
					const current = await umbreld.client.files.externalDevices.query()
					return (
						current
							.find((device) => device.id === secondDeviceId)
							?.partitions.some((partition) => partition.mountpoints.includes('/External/PI-SECOND')) ?? false
					)
				},
				{interval: 1000, timeout: 600_000},
			)

			// There is no product API for creating the retired .umbrel marker.
			const mountTargets = (await umbreld.vm.ssh(`findmnt -n -o TARGET --source /dev/${secondDeviceId}1`))
				.trim()
				.split('\n')
				.map((target) => target.trim())
			secondMountpoint = '/home/umbrel/umbrel/external/PI-SECOND'
			expect(mountTargets).toContain(secondMountpoint)
			await umbreld.vm.sshAsRoot(`
				mkdir -p ${secondMountpoint}/umbrel
				touch ${secondMountpoint}/umbrel/.umbrel
				sync
			`)
		},
		piStartupTimeout + 600_000,
	)

	test(
		'refuses to choose between two visible legacy installations without modifying either disk',
		async () => {
			await waitForUsbDisks(umbreld, 2)
			const result = await umbreld.vm.sshAsRoot(`
				set -eu
				sync
				umount /dev/${secondDeviceId}1
				# Stop docker.socket too, otherwise any Docker API call re-activates
				# the daemon and keeps /var/lib/docker busy.
				systemctl stop umbrel.service docker.socket docker.service
				swapoff /swap/swapfile || true
				umount /home/umbrel/umbrel /var/lib/docker /swap /sd-root /mnt/data
				set +e
				output=$(/opt/umbrel-external-storage/umbrel-external-storage 2>&1)
				status=$?
				set -e
				printf 'status=%s\n%s\n' "$status" "$output"
			`)

			expect(result).toContain('status=1')
			expect(result).toContain('Multiple legacy Umbrel data drives found; refusing to choose between them')
			expect(await umbreld.vm.ssh('findmnt -n -o SOURCE --target /home/umbrel/umbrel || true')).not.toMatch(/\/dev\/sd/)
			expect((await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()).toBe(firstUuid)
			expect((await umbreld.vm.ssh(`lsblk -no UUID /dev/${secondDeviceId}1`)).trim()).not.toBe('')
		},
		piStartupTimeout + 600_000,
	)
})
