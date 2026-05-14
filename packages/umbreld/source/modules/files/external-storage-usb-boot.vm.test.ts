import {setTimeout} from 'node:timers/promises'

import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

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

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas', bootDisk: 'usb'})
		await umbreld.vm.powerOn()

		// External storage mounting runs during startup. Give any accidental auto-mounts
		// enough time to appear before asserting they did not happen.
		await setTimeout(5_000)
	})

	afterAll(async () => await umbreld?.cleanup())

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
})
