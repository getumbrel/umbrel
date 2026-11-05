import {setTimeout} from 'node:timers/promises'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {triggerFactoryReset} from '../test-utilities/rebooting-action.ts'

type LsblkDevice = {
	name: string
	type: string
	tran?: string | null
	mountpoints?: (string | null)[] | null
	children?: LsblkDevice[]
}

type FindmntFileSystem = {
	source?: string
	target?: string
	children?: FindmntFileSystem[]
}

const getMountpoints = (device: LsblkDevice) =>
	device.mountpoints?.filter((mountpoint): mountpoint is string => !!mountpoint) ?? []

const isSystemMountpoint = (mountpoint: string) =>
	mountpoint === '/' ||
	mountpoint === '/boot' ||
	mountpoint === '/data' ||
	mountpoint === '/home' ||
	mountpoint.startsWith('/run/rugix/')

const flattenFileSystems = (fileSystems: FindmntFileSystem[]): FindmntFileSystem[] =>
	fileSystems.flatMap((fileSystem) => [fileSystem, ...flattenFileSystems(fileSystem.children ?? [])])

describe('External storage on USB boot disks', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let raidDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas', bootDisk: 'usb'})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()

		// External storage mounting runs during startup. Give any accidental auto-mounts
		// enough time to appear before asserting they did not happen.
		await setTimeout(5_000)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function getUsbBootDisk() {
		const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,MOUNTPOINTS')) as {
			blockdevices: LsblkDevice[]
		}

		const usbBootDisk = blockdevices.find((device) => {
			const partitions = device.children ?? []
			return (
				device.type === 'disk' &&
				device.tran === 'usb' &&
				partitions.some((partition) => getMountpoints(partition).some((mountpoint) => isSystemMountpoint(mountpoint)))
			)
		})

		expect(usbBootDisk).toBeDefined()
		return usbBootDisk!
	}

	test('boots the generic NAS from a USB transport disk', async () => {
		const usbBootDisk = await getUsbBootDisk()
		const partitions = usbBootDisk.children?.filter((partition) => partition.type === 'part') ?? []

		expect(partitions.length).toBeGreaterThan(1)
		expect(partitions.some((partition) => getMountpoints(partition).length === 0)).toBe(true)
	})

	test('does not detect or mount USB boot disk partitions as external storage', async () => {
		const usbBootDisk = await getUsbBootDisk()
		const usbPartitionSources = (usbBootDisk.children ?? [])
			.filter((partition) => partition.type === 'part')
			.map((partition) => `/dev/${partition.name}`)

		await expect(umbreld.unauthenticatedClient.files.externalDevices.query()).resolves.toEqual([])

		const {filesystems = []} = JSON.parse(await umbreld.vm.ssh('findmnt --json --output SOURCE,TARGET')) as {
			filesystems?: FindmntFileSystem[]
		}
		const usbExternalMounts = flattenFileSystems(filesystems).filter(
			(fileSystem) =>
				fileSystem.source &&
				usbPartitionSources.includes(fileSystem.source) &&
				fileSystem.target?.includes('/external/'),
		)

		expect(usbExternalMounts).toEqual([])
	})

	test('sets up RAID storage on the NVMe device', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		raidDeviceId = devices[0].id!
		expect(raidDeviceId).toBeDefined()

		await umbreld.signup({raidDevices: [raidDeviceId], raidType: 'storage'})
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('does not mount USB boot disk partitions after data moves to RAID', async () => {
		const usbBootDisk = await getUsbBootDisk()
		const usbPartitionSources = (usbBootDisk.children ?? [])
			.filter((partition) => partition.type === 'part')
			.map((partition) => `/dev/${partition.name}`)

		await expect(umbreld.client.files.externalDevices.query()).resolves.toEqual([])

		const {filesystems = []} = JSON.parse(await umbreld.vm.ssh('findmnt --json --output SOURCE,TARGET')) as {
			filesystems?: FindmntFileSystem[]
		}
		const usbExternalMounts = flattenFileSystems(filesystems).filter(
			(fileSystem) =>
				fileSystem.source &&
				usbPartitionSources.includes(fileSystem.source) &&
				fileSystem.target?.includes('/external/'),
		)

		expect(usbExternalMounts).toEqual([])
	})

	test('preserves RAID boot config when the reset data partition is mounted', async () => {
		const mainDataPartition = (
			await umbreld.vm.sshAsRoot(`
for partition in 7 6; do
	device="$(rugix-ctrl utils resolve-partition "$partition" 2>/dev/null | jq -r '.device // empty')"
	if [ -n "$device" ]; then
		printf '%s' "$device"
		break
	fi
done
`)
		).trim()
		expect(mainDataPartition).toMatch(/^\/dev\//)

		const testMount = '/mnt/umbrel-factory-reset-guard-test'
		await umbreld.vm.sshAsRoot(`mkdir -p '${testMount}' && mount '${mainDataPartition}' '${testMount}'`)
		try {
			await expect(umbreld.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'})).rejects.toThrow(
				'Command failed with exit code 1',
			)
			const configState = await umbreld.vm.sshAsRoot(
				`test -f /run/rugix/mounts/config/umbrel.yaml && echo present || echo missing`,
			)
			expect(configState.trim()).toBe('present')
		} finally {
			await umbreld.vm.sshAsRoot(`umount '${testMount}' && rmdir '${testMount}'`)
		}
	})

	test('factory resets the USB-boot RAID install', async () => {
		await triggerFactoryReset(umbreld.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'}))

		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.user.exists.query())
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
	})

	test('returns to onboarding without mounting the USB boot disk and keeps RAID recoverable', async () => {
		await expect(umbreld.unauthenticatedClient.files.externalDevices.query()).resolves.toEqual([])
		await expect(umbreld.unauthenticatedClient.hardware.raid.hasRecoverableInstall.query()).resolves.toBe(true)
	})
})
