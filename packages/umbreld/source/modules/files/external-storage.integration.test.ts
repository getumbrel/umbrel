import {expect, test, describe, beforeEach, afterEach, vi} from 'vitest'
import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// These tests are not great, they're heavily coupled to the implementation and rely on
// heavy mocking to simulate external devices in our test environment. In the future if
// we have some kind of QEMU wrapper to test against real umbrelOS in a VM we should
// rewrite these tests to not use mocking and test against virtual USB block devices
// being attached/removed from the VM.

// Mock isUmbrelHome for testing
let isRaspberryPiMockValue = false
afterEach(() => (isRaspberryPiMockValue = false))
vi.mock('../system/system.js', async () => {
	const original = (await vi.importActual('../system/system.js')) as any
	return {
		...original,
		isRaspberryPi: vi.fn(() => isRaspberryPiMockValue),
	}
})

// Mock fse.writeFile for testing
const nullWriteFile = (path: string, data: string) => {}
let mockWriteFile = nullWriteFile
afterEach(() => (mockWriteFile = nullWriteFile))
vi.mock('fs-extra', async () => {
	const originalModule = (await vi.importActual('fs-extra')) as any
	return {
		...originalModule,
		default: {
			...originalModule.default,
			writeFile: vi.fn((path: string, data: any) => {
				// Test if we have a mock that wants to override this command
				const mockResult = mockWriteFile(path, data) as any
				if (mockResult) return Promise.resolve(typeof mockResult === 'string' ? {stdout: mockResult} : mockResult)

				// Otherwise fall back to default execa behaviour
				return originalModule.writeFile(path, data)
			}),
		},
	}
})

// Generic command mocker we can overwrite for each test
const nullMock = (command: string) => {}
let mockCommand = nullMock
afterEach(() => (mockCommand = nullMock))
vi.mock('execa', async () => {
	const originalModule = (await vi.importActual('execa')) as any
	return {
		...originalModule,
		// Mock $ from execa
		$: vi.fn(function () {
			// Grab all arguments and pull out the command
			const args = Array.from(arguments)
			const command = args[0]?.[0] ?? ''

			// Test if we have a mock that wants to override this command
			const mockResult = mockCommand(command) as any
			if (mockResult) return Promise.resolve(typeof mockResult === 'string' ? {stdout: mockResult} : mockResult)

			// Otherwise fall back to default execa behaviour
			return originalModule.$.apply(originalModule, args)
		}),
	}
})

// Setup umbreld once for all tests
beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})
// Cleanup after all tests
afterEach(() => umbreld.cleanup())

describe('enabled', () => {
	test('is enabled on Umbrel Home and amd64', async () => {
		await expect(umbreld.instance.files.externalStorage.supported()).resolves.toBe(true)
	})

	test('is disabled on Raspberry Pi', async () => {
		isRaspberryPiMockValue = true
		await expect(umbreld.instance.files.externalStorage.supported()).resolves.toBe(false)
	})
})

describe('file permissions', () => {
	test('allows hard deletion of external files', async () => {
		// Create test directory
		const testFile = `${umbreld.instance.dataDirectory}/external/My Portable SSD/file.txt`
		await fse.ensureFile(testFile)

		// Attempt to delete the directory
		await expect(
			umbreld.client.files.delete.mutate({path: '/External/My Portable SSD/file.txt'}),
		).resolves.not.toThrow()
	})

	test('does not allow soft trash of external files', async () => {
		// Create test directory
		const testFile = `${umbreld.instance.dataDirectory}/external/My Portable SSD/file.txt`
		await fse.ensureFile(testFile)

		// Attempt to delete the directory
		await expect(umbreld.client.files.trash.mutate({path: '/External/My Portable SSD/file.txt'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('mount points are protected paths', async () => {
		// Create test directory
		const testFile = `${umbreld.instance.dataDirectory}/external/My Portable SSD/file.txt`
		await fse.ensureFile(testFile)

		// Trash
		await expect(umbreld.client.files.trash.mutate({path: '/External/My Portable SSD'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
		// Delete
		await expect(umbreld.client.files.delete.mutate({path: '/External/My Portable SSD'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
		// Move
		await expect(
			umbreld.client.files.move.mutate({path: '/External/My Portable SSD', toDirectory: '/Home'}),
		).rejects.toThrow('[operation-not-allowed]')
		// Rename
		await expect(
			umbreld.client.files.rename.mutate({path: '/External/My Portable SSD', newName: 'My Renamed SSD'}),
		).rejects.toThrow('[operation-not-allowed]')
	})
})

describe('files.mountedExternalDevices', () => {
	test('throws unauthorized error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.mountedExternalDevices.query()).rejects.toThrow('Invalid token')
	})

	test('returns empty array when no external devices are attached', async () => {
		// Mock lsblk command to return a valid response for no external disks
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_NO_EXTERNAL_DISK)
		}

		const mountedExternalDevices = await umbreld.client.files.mountedExternalDevices.query()
		await expect(mountedExternalDevices).toEqual([])
	})

	test('returns empty array when external devices are attached but not mounted', async () => {
		// Mock lsblk command to return a valid response for a mounted external disk
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_EXTERNAL_DISK_ATTACHED)
		}

		const mountedExternalDevices = await umbreld.client.files.mountedExternalDevices.query()
		await expect(mountedExternalDevices).toEqual([])
	})

	test('returns mounted external devices', async () => {
		// Mock lsblk command to return a valid response for a mounted external disk
		mockCommand = (command: string) => {
			// We need to replace any /home/umbrel/umbrel paths with the current instances
			// data directory so the internal logic finds mountpath matches in `/External`
			if (command.startsWith('lsblk'))
				return JSON.stringify(LSBLK_EXTERNAL_DISK_MOUNTED).replaceAll(
					'/home/umbrel/umbrel',
					umbreld.instance.dataDirectory,
				)
		}

		const mountedExternalDevices = await umbreld.client.files.mountedExternalDevices.query()
		await expect(mountedExternalDevices).toEqual([
			{
				id: 'sda',
				name: 'Samsung Portable SSD T5',
				transport: 'usb',
				size: 1000204886016,
				partitions: [
					{
						id: 'sda2',
						label: 'Red T5',
						type: 'Microsoft basic data',
						size: 999993376768,
						mountpoints: ['/External/Red T5'],
					},
				],
			},
		])

		// We need to set the mock back to not show mounted devices so the shutdown process doesn't try to unmount them and fail
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_NO_EXTERNAL_DISK)
		}
	})
})

describe('files.unmountExternalDevice', () => {
	test('throws unauthorized error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.unmountExternalDevice.mutate({deviceId: 'sda'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws error on invalid device id', async () => {
		// Mock lsblk command to return a valid response for a mounted external disk
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk'))
				return JSON.stringify(LSBLK_EXTERNAL_DISK_MOUNTED).replaceAll(
					'/home/umbrel/umbrel',
					umbreld.instance.dataDirectory,
				)
		}

		// Missing device
		await expect(umbreld.client.files.unmountExternalDevice.mutate({deviceId: 'sdz'})).rejects.toThrow(
			'[invalid-device-id]',
		)

		// Passed partition id instead of device id
		await expect(umbreld.client.files.unmountExternalDevice.mutate({deviceId: 'sda2'})).rejects.toThrow(
			'[invalid-device-id]',
		)
	})

	test('unmounts external device', async () => {
		// Mock lsblk command to return a valid response for no external disks
		// Mock umount to not actually unmount (this breaks GitHub Actions)
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk'))
				return JSON.stringify(LSBLK_EXTERNAL_DISK_MOUNTED).replaceAll(
					'/home/umbrel/umbrel',
					umbreld.instance.dataDirectory,
				)
			if (command.startsWith('umount')) return 'fake umount worked'
		}

		// Mock fse.writeFile to not actually delete the device
		mockWriteFile = (path: string, data: string) => {
			if (path === '/sys/block/sda/device/delete') return '1'
		}

		// Create mountpoint
		const mountPoint = `${umbreld.instance.dataDirectory}/external/Red T5`
		await fse.ensureDir(mountPoint)

		// Check mountpoint exists
		await expect(fse.pathExists(mountPoint)).resolves.toBe(true)

		// Unmount it
		// This fails at the last point in the test env because /sys/block/sda/device/delete doesn't actually exist
		// However all the other logic should have been run through successfully
		await expect(umbreld.client.files.unmountExternalDevice.mutate({deviceId: 'sda'})).resolves.toBe(true)

		// Check mountpoint was removed
		await expect(fse.pathExists(mountPoint)).resolves.toBe(false)
	})
})

describe('files.isExternalDeviceConnectedOnUnsupportedDevice', () => {
	test('throws unauthorized error without auth token', async () => {
		await expect(
			umbreld.unauthenticatedClient.files.isExternalDeviceConnectedOnUnsupportedDevice.query(),
		).rejects.toThrow('Invalid token')
	})

	test('returns false when on Umbrel Home and amd64 but no external devices connected', async () => {
		// Mock lsblk to show an external USB device
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_NO_EXTERNAL_DISK)
			if (command.startsWith('df')) return {stdout: 'Filesystem\n/dev/nvme0n1p4'}
		}

		// Check the result
		const result = await umbreld.client.files.isExternalDeviceConnectedOnUnsupportedDevice.query()
		expect(result).toBe(false)
	})

	test('returns false when on Umbrel Home and amd64 and external devices connected', async () => {
		// Mock lsblk to show an external USB device
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_EXTERNAL_DISK_ATTACHED)
			if (command.startsWith('df')) return {stdout: 'Filesystem\n/dev/nvme0n1p4'}
		}

		// Check the result
		const result = await umbreld.client.files.isExternalDeviceConnectedOnUnsupportedDevice.query()
		expect(result).toBe(false)
	})

	test('returns false when on Raspberry Pi but no external devices are connected', async () => {
		// Set isRaspberryPi to return false
		isRaspberryPiMockValue = true

		// Mock lsblk to show no external USB devices
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_NO_EXTERNAL_DISK)
			if (command.startsWith('df')) return {stdout: 'Filesystem\n/dev/nvme0n1p4'}
		}

		// Check the result
		const result = await umbreld.client.files.isExternalDeviceConnectedOnUnsupportedDevice.query()
		expect(result).toBe(false)
	})

	test('returns true when on Raspberry Pi and external devices connected', async () => {
		// Set isRaspberryPi to return false
		isRaspberryPiMockValue = true

		// Mock lsblk to show external USB devices and df to show system disk is not USB
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_EXTERNAL_DISK_ATTACHED)
			if (command.startsWith('df')) return {stdout: 'Filesystem\n/dev/nvme0n1p4'}
		}

		// Check the result
		const result = await umbreld.client.files.isExternalDeviceConnectedOnUnsupportedDevice.query()
		expect(result).toBe(true)
	})

	test('excludes external devices that contain the data directory (to avoid USB Pi false positives)', async () => {
		// Set isRaspberryPi to return false
		isRaspberryPiMockValue = true

		// Mock lsblk to show external USB devices but df to show system disk is USB
		mockCommand = (command: string) => {
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_EXTERNAL_DISK_ATTACHED)
			if (command.startsWith('df')) return {stdout: 'Filesystem\n/dev/sda2'}
		}

		// Check the result - should be false as the system disk is on the USB device
		const result = await umbreld.client.files.isExternalDeviceConnectedOnUnsupportedDevice.query()
		expect(result).toBe(false)
	})
})

describe('externalstorage.#cleanLeftOverMountPoints()', () => {
	test('cleans up any left over mount points on startup', async () => {
		// Stop umbreld
		await umbreld.instance.stop()

		// Create dummy left over mount point
		const leftoverMountPoint = `${umbreld.instance.dataDirectory}/external/My Portable SSD`
		await fse.ensureDir(leftoverMountPoint)

		// Check that the mount point exists
		await expect(fse.exists(leftoverMountPoint)).resolves.toBe(true)

		// Start umbreld
		await umbreld.instance.start()

		// Check that the mount point was cleaned up
		await expect(fse.exists(leftoverMountPoint)).resolves.toBe(false)
	})
})

describe('externalstorage.#mountExternalDevices', () => {
	test('does nothing when no external devices are attached', async () => {
		mockCommand = (command: string) => {
			// Mock lsblk command to return a valid response for no external disks
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_NO_EXTERNAL_DISK)
			// Mock mountpoint command to return nonzero exit code so unused mount paths don't get cleaned up
			if (command.startsWith('mountpoint')) return {exitCode: 1}
		}

		// Simulate disk event
		await umbreld.instance.eventBus.emit('system:disk:change')

		// Wait for event to be handled
		await delay(500)

		// Check that the mount point was not created
		const mountPoint = `${umbreld.instance.dataDirectory}/external/Red T5`
		const exists = await fse.pathExists(mountPoint)
		expect(exists).toBe(false)
	})

	test('mounts a new external disk when it is attached', async () => {
		mockCommand = (command: string) => {
			// Mock lsblk command to return a valid response for no external disks
			if (command.startsWith('lsblk')) return JSON.stringify(LSBLK_EXTERNAL_DISK_ATTACHED)
			// Mock mountpoint command to return nonzero exit code so unused mount paths don't get cleaned up
			if (command.startsWith('mountpoint')) return {exitCode: 1}
		}

		// Simulate disk event
		await umbreld.instance.eventBus.emit('system:disk:change')

		// Wait for event to be handled
		await delay(500)

		// Check that the mount point was not created
		const mountPoint = `${umbreld.instance.dataDirectory}/external/Red T5`
		const exists = await fse.pathExists(mountPoint)
		expect(exists).toBe(true)
	})
})

describe('filesystem permissions', () => {
	test('/External cannot have new user created directories', async () => {
		await expect(umbreld.client.files.createDirectory.mutate({path: '/External/test'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('/External cannot have directories copied directly into it', async () => {
		await expect(umbreld.client.files.copy.mutate({path: '/Home/Documents', toDirectory: '/External'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('/External cannot have directories moved directly into it', async () => {
		await expect(umbreld.client.files.move.mutate({path: '/Home/Documents', toDirectory: '/External'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})
})

// Mock lsblk output constants
// Taken from a physical Umbrel Home with:
//   lsblk --output-all --json --bytes

const LSBLK_NO_EXTERNAL_DISK = {
	blockdevices: [
		{
			alignment: 0,
			'disc-aln': 0,
			dax: false,
			'disc-gran': 512,
			'disc-max': 2199023255040,
			'disc-zero': false,
			fsavail: null,
			fsroots: [null],
			fssize: null,
			fstype: null,
			fsused: null,
			'fsuse%': null,
			fsver: null,
			group: 'disk',
			hctl: null,
			hotplug: false,
			kname: 'nvme0n1',
			label: null,
			'log-sec': 512,
			'maj:min': '259:0',
			'min-io': 512,
			mode: 'brw-rw----',
			model: 'PCIe SSD',
			name: 'nvme0n1',
			'opt-io': 0,
			owner: 'root',
			partflags: null,
			partlabel: null,
			parttype: null,
			parttypename: null,
			partuuid: null,
			path: '/dev/nvme0n1',
			'phy-sec': 512,
			pkname: null,
			pttype: 'gpt',
			ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
			ra: 128,
			rand: false,
			rev: null,
			rm: false,
			ro: false,
			rota: false,
			'rq-size': 1023,
			sched: 'none',
			serial: '3EE50743172100007264',
			size: 2048408248320,
			start: null,
			state: 'live',
			subsystems: 'block:nvme:pci',
			mountpoint: null,
			mountpoints: [null],
			tran: 'nvme',
			type: 'disk',
			uuid: null,
			vendor: null,
			wsame: 0,
			wwn: 'eui.6479a78e1a306219',
			zoned: 'none',
			'zone-sz': 0,
			'zone-wgran': 0,
			'zone-app': 0,
			'zone-nr': 0,
			'zone-omax': 0,
			'zone-amax': 0,
			children: [
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 161460224,
					fsroots: ['/', '/'],
					fssize: 209489920,
					fstype: 'vfat',
					fsused: 48029696,
					'fsuse%': '23%',
					fsver: 'FAT16',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p1',
					label: 'ESP',
					'log-sec': 512,
					'maj:min': '259:1',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p1',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'ESP',
					parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
					parttypename: 'EFI System',
					partuuid: '14a31e9d-a8d7-4da0-9eb2-f268dd9d7ad9',
					path: '/dev/nvme0n1p1',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 209715200,
					start: 16384,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/boot/efi',
					mountpoints: ['/mnt/root/boot/efi', '/boot/efi'],
					tran: 'nvme',
					type: 'part',
					uuid: '8C09-5015',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 6095024128,
					fsroots: ['/', '/'],
					fssize: 10297585664,
					fstype: 'ext4',
					fsused: 3711803392,
					'fsuse%': '36%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p2',
					label: null,
					'log-sec': 512,
					'maj:min': '259:2',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p2',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: '2fe5a278-9b55-4266-8220-6665aa96940b',
					path: '/dev/nvme0n1p2',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 425984,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root',
					mountpoints: ['/mnt/root', '/'],
					tran: 'nvme',
					type: 'part',
					uuid: 'f30a5ab4-4925-4ef2-919e-baa907acc271',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'ext4',
					fsused: null,
					'fsuse%': null,
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p3',
					label: null,
					'log-sec': 512,
					'maj:min': '259:3',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p3',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'f5e6d27c-4a25-447b-8e08-a9d2e738345a',
					path: '/dev/nvme0n1p3',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 21037056,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: 'nvme',
					type: 'part',
					uuid: 'a45fe9d9-9fb4-44f1-aaee-95b55beff174',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 1860365219840,
					fsroots: [
						'/umbrel-os/var/log',
						'/umbrel-os/var/log',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/home',
						'/umbrel-os/home',
						'/',
						'/',
					],
					fssize: 1963188352000,
					fstype: 'ext4',
					fsused: 40008793088,
					'fsuse%': '2%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p4',
					label: null,
					'log-sec': 512,
					'maj:min': '259:4',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p4',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'd1d36e34-2753-4dc7-96eb-3c9b5584e867',
					path: '/dev/nvme0n1p4',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 2027084386304,
					start: 41648128,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/data',
					mountpoints: [
						'/mnt/root/var/log',
						'/var/log',
						'/mnt/root/var/lib/systemd/timesync',
						'/var/lib/systemd/timesync',
						'/mnt/root/var/lib/docker',
						'/var/lib/docker',
						'/mnt/root/home',
						'/home',
						'/mnt/root/data',
						'/data',
					],
					tran: 'nvme',
					type: 'part',
					uuid: '5e29c50c-6b77-48af-bd31-ed97b2c36ea4',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
			],
		},
	],
}

const LSBLK_EXTERNAL_DISK_ATTACHED = {
	blockdevices: [
		{
			alignment: 0,
			'disc-aln': 0,
			dax: false,
			'disc-gran': 0,
			'disc-max': 0,
			'disc-zero': false,
			fsavail: null,
			fsroots: [null],
			fssize: null,
			fstype: null,
			fsused: null,
			'fsuse%': null,
			fsver: null,
			group: 'disk',
			hctl: '2:0:0:0',
			hotplug: true,
			kname: 'sda',
			label: null,
			'log-sec': 512,
			'maj:min': '8:0',
			'min-io': 512,
			mode: 'brw-rw----',
			model: 'Samsung Portable SSD T5',
			name: 'sda',
			'opt-io': 33553920,
			owner: 'root',
			partflags: null,
			partlabel: null,
			parttype: null,
			parttypename: null,
			partuuid: null,
			path: '/dev/sda',
			'phy-sec': 512,
			pkname: null,
			pttype: 'gpt',
			ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
			ra: 65532,
			rand: false,
			rev: '0   ',
			rm: false,
			ro: false,
			rota: false,
			'rq-size': 60,
			sched: 'mq-deadline',
			serial: 'S50ZNV0MB00594H',
			size: 1000204886016,
			start: null,
			state: 'running',
			subsystems: 'block:scsi:usb:pci',
			mountpoint: null,
			mountpoints: [null],
			tran: 'usb',
			type: 'disk',
			uuid: null,
			vendor: 'Samsung ',
			wsame: 0,
			wwn: '0x5002538e00000000',
			zoned: 'none',
			'zone-sz': 0,
			'zone-wgran': 0,
			'zone-app': 0,
			'zone-nr': 0,
			'zone-omax': 0,
			'zone-amax': 0,
			children: [
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 0,
					'disc-max': 0,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'vfat',
					fsused: null,
					'fsuse%': null,
					fsver: 'FAT32',
					group: 'disk',
					hctl: null,
					hotplug: true,
					kname: 'sda1',
					label: 'EFI',
					'log-sec': 512,
					'maj:min': '8:1',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'sda1',
					'opt-io': 33553920,
					owner: 'root',
					partflags: null,
					partlabel: 'EFI System Partition',
					parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
					parttypename: 'EFI System',
					partuuid: '96ae826e-6062-4990-821d-303a632ef496',
					path: '/dev/sda1',
					'phy-sec': 512,
					pkname: 'sda',
					pttype: 'gpt',
					ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
					ra: 65532,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 60,
					sched: 'mq-deadline',
					serial: null,
					size: 209715200,
					start: 40,
					state: null,
					subsystems: 'block:scsi:usb:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: null,
					type: 'part',
					uuid: '67E3-17ED',
					vendor: null,
					wsame: 0,
					wwn: '0x5002538e00000000',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 0,
					'disc-max': 0,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'exfat',
					fsused: null,
					'fsuse%': null,
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: true,
					kname: 'sda2',
					label: 'Red T5',
					'log-sec': 512,
					'maj:min': '8:2',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'sda2',
					'opt-io': 33553920,
					owner: 'root',
					partflags: null,
					partlabel: null,
					parttype: 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',
					parttypename: 'Microsoft basic data',
					partuuid: '686e6e14-5994-4906-93fb-e986c1caafb0',
					path: '/dev/sda2',
					'phy-sec': 512,
					pkname: 'sda',
					pttype: 'gpt',
					ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
					ra: 65532,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 60,
					sched: 'mq-deadline',
					serial: null,
					size: 999993376768,
					start: 411648,
					state: null,
					subsystems: 'block:scsi:usb:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: null,
					type: 'part',
					uuid: '67F5-306E',
					vendor: null,
					wsame: 0,
					wwn: '0x5002538e00000000',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
			],
		},
		{
			alignment: 0,
			'disc-aln': 0,
			dax: false,
			'disc-gran': 512,
			'disc-max': 2199023255040,
			'disc-zero': false,
			fsavail: null,
			fsroots: [null],
			fssize: null,
			fstype: null,
			fsused: null,
			'fsuse%': null,
			fsver: null,
			group: 'disk',
			hctl: null,
			hotplug: false,
			kname: 'nvme0n1',
			label: null,
			'log-sec': 512,
			'maj:min': '259:0',
			'min-io': 512,
			mode: 'brw-rw----',
			model: 'PCIe SSD',
			name: 'nvme0n1',
			'opt-io': 0,
			owner: 'root',
			partflags: null,
			partlabel: null,
			parttype: null,
			parttypename: null,
			partuuid: null,
			path: '/dev/nvme0n1',
			'phy-sec': 512,
			pkname: null,
			pttype: 'gpt',
			ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
			ra: 128,
			rand: false,
			rev: null,
			rm: false,
			ro: false,
			rota: false,
			'rq-size': 1023,
			sched: 'none',
			serial: '3EE50743172100007264',
			size: 2048408248320,
			start: null,
			state: 'live',
			subsystems: 'block:nvme:pci',
			mountpoint: null,
			mountpoints: [null],
			tran: 'nvme',
			type: 'disk',
			uuid: null,
			vendor: null,
			wsame: 0,
			wwn: 'eui.6479a78e1a306219',
			zoned: 'none',
			'zone-sz': 0,
			'zone-wgran': 0,
			'zone-app': 0,
			'zone-nr': 0,
			'zone-omax': 0,
			'zone-amax': 0,
			children: [
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 161460224,
					fsroots: ['/', '/'],
					fssize: 209489920,
					fstype: 'vfat',
					fsused: 48029696,
					'fsuse%': '23%',
					fsver: 'FAT16',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p1',
					label: 'ESP',
					'log-sec': 512,
					'maj:min': '259:1',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p1',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'ESP',
					parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
					parttypename: 'EFI System',
					partuuid: '14a31e9d-a8d7-4da0-9eb2-f268dd9d7ad9',
					path: '/dev/nvme0n1p1',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 209715200,
					start: 16384,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/boot/efi',
					mountpoints: ['/mnt/root/boot/efi', '/boot/efi'],
					tran: 'nvme',
					type: 'part',
					uuid: '8C09-5015',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 6095048704,
					fsroots: ['/', '/'],
					fssize: 10297585664,
					fstype: 'ext4',
					fsused: 3711778816,
					'fsuse%': '36%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p2',
					label: null,
					'log-sec': 512,
					'maj:min': '259:2',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p2',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: '2fe5a278-9b55-4266-8220-6665aa96940b',
					path: '/dev/nvme0n1p2',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 425984,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root',
					mountpoints: ['/mnt/root', '/'],
					tran: 'nvme',
					type: 'part',
					uuid: 'f30a5ab4-4925-4ef2-919e-baa907acc271',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'ext4',
					fsused: null,
					'fsuse%': null,
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p3',
					label: null,
					'log-sec': 512,
					'maj:min': '259:3',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p3',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'f5e6d27c-4a25-447b-8e08-a9d2e738345a',
					path: '/dev/nvme0n1p3',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 21037056,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: 'nvme',
					type: 'part',
					uuid: 'a45fe9d9-9fb4-44f1-aaee-95b55beff174',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 1860441555968,
					fsroots: [
						'/umbrel-os/var/log',
						'/umbrel-os/var/log',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/home',
						'/umbrel-os/home',
						'/',
						'/',
					],
					fssize: 1963188352000,
					fstype: 'ext4',
					fsused: 39932456960,
					'fsuse%': '2%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p4',
					label: null,
					'log-sec': 512,
					'maj:min': '259:4',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p4',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'd1d36e34-2753-4dc7-96eb-3c9b5584e867',
					path: '/dev/nvme0n1p4',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 2027084386304,
					start: 41648128,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/data',
					mountpoints: [
						'/mnt/root/var/log',
						'/var/log',
						'/mnt/root/var/lib/systemd/timesync',
						'/var/lib/systemd/timesync',
						'/mnt/root/var/lib/docker',
						'/var/lib/docker',
						'/mnt/root/home',
						'/home',
						'/mnt/root/data',
						'/data',
					],
					tran: 'nvme',
					type: 'part',
					uuid: '5e29c50c-6b77-48af-bd31-ed97b2c36ea4',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
			],
		},
	],
}

const LSBLK_EXTERNAL_DISK_MOUNTED = {
	blockdevices: [
		{
			alignment: 0,
			'disc-aln': 0,
			dax: false,
			'disc-gran': 0,
			'disc-max': 0,
			'disc-zero': false,
			fsavail: null,
			fsroots: [null],
			fssize: null,
			fstype: null,
			fsused: null,
			'fsuse%': null,
			fsver: null,
			group: 'disk',
			hctl: '2:0:0:0',
			hotplug: true,
			kname: 'sda',
			label: null,
			'log-sec': 512,
			'maj:min': '8:0',
			'min-io': 512,
			mode: 'brw-rw----',
			model: 'Samsung Portable SSD T5',
			name: 'sda',
			'opt-io': 33553920,
			owner: 'root',
			partflags: null,
			partlabel: null,
			parttype: null,
			parttypename: null,
			partuuid: null,
			path: '/dev/sda',
			'phy-sec': 512,
			pkname: null,
			pttype: 'gpt',
			ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
			ra: 65532,
			rand: false,
			rev: '0   ',
			rm: false,
			ro: false,
			rota: false,
			'rq-size': 60,
			sched: 'mq-deadline',
			serial: 'S50ZNV0MB00594H',
			size: 1000204886016,
			start: null,
			state: 'running',
			subsystems: 'block:scsi:usb:pci',
			mountpoint: null,
			mountpoints: [null],
			tran: 'usb',
			type: 'disk',
			uuid: null,
			vendor: 'Samsung ',
			wsame: 0,
			wwn: '0x5002538e00000000',
			zoned: 'none',
			'zone-sz': 0,
			'zone-wgran': 0,
			'zone-app': 0,
			'zone-nr': 0,
			'zone-omax': 0,
			'zone-amax': 0,
			children: [
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 0,
					'disc-max': 0,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'vfat',
					fsused: null,
					'fsuse%': null,
					fsver: 'FAT32',
					group: 'disk',
					hctl: null,
					hotplug: true,
					kname: 'sda1',
					label: 'EFI',
					'log-sec': 512,
					'maj:min': '8:1',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'sda1',
					'opt-io': 33553920,
					owner: 'root',
					partflags: null,
					partlabel: 'EFI System Partition',
					parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
					parttypename: 'EFI System',
					partuuid: '96ae826e-6062-4990-821d-303a632ef496',
					path: '/dev/sda1',
					'phy-sec': 512,
					pkname: 'sda',
					pttype: 'gpt',
					ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
					ra: 65532,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 60,
					sched: 'mq-deadline',
					serial: null,
					size: 209715200,
					start: 40,
					state: null,
					subsystems: 'block:scsi:usb:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: null,
					type: 'part',
					uuid: '67E3-17ED',
					vendor: null,
					wsame: 0,
					wwn: '0x5002538e00000000',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 0,
					'disc-max': 0,
					'disc-zero': false,
					fsavail: 999946059776,
					fsroots: ['/', '/', '/', '/'],
					fssize: 999960870912,
					fstype: 'exfat',
					fsused: 14811136,
					'fsuse%': '0%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: true,
					kname: 'sda2',
					label: 'Red T5',
					'log-sec': 512,
					'maj:min': '8:2',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'sda2',
					'opt-io': 33553920,
					owner: 'root',
					partflags: null,
					partlabel: null,
					parttype: 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',
					parttypename: 'Microsoft basic data',
					partuuid: '686e6e14-5994-4906-93fb-e986c1caafb0',
					path: '/dev/sda2',
					'phy-sec': 512,
					pkname: 'sda',
					pttype: 'gpt',
					ptuuid: 'fcca3f2a-e019-4f4d-8385-2b660c1d7eec',
					ra: 65532,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 60,
					sched: 'mq-deadline',
					serial: null,
					size: 999993376768,
					start: 411648,
					state: null,
					subsystems: 'block:scsi:usb:pci',
					mountpoint: '/mnt/root/home/umbrel/umbrel/external/Red T5',
					mountpoints: [
						'/mnt/root/home/umbrel/umbrel/external/Red T5',
						'/mnt/root/data/umbrel-os/home/umbrel/umbrel/external/Red T5',
						'/data/umbrel-os/home/umbrel/umbrel/external/Red T5',
						'/home/umbrel/umbrel/external/Red T5',
					],
					tran: null,
					type: 'part',
					uuid: '67F5-306E',
					vendor: null,
					wsame: 0,
					wwn: '0x5002538e00000000',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
			],
		},
		{
			alignment: 0,
			'disc-aln': 0,
			dax: false,
			'disc-gran': 512,
			'disc-max': 2199023255040,
			'disc-zero': false,
			fsavail: null,
			fsroots: [null],
			fssize: null,
			fstype: null,
			fsused: null,
			'fsuse%': null,
			fsver: null,
			group: 'disk',
			hctl: null,
			hotplug: false,
			kname: 'nvme0n1',
			label: null,
			'log-sec': 512,
			'maj:min': '259:0',
			'min-io': 512,
			mode: 'brw-rw----',
			model: 'PCIe SSD',
			name: 'nvme0n1',
			'opt-io': 0,
			owner: 'root',
			partflags: null,
			partlabel: null,
			parttype: null,
			parttypename: null,
			partuuid: null,
			path: '/dev/nvme0n1',
			'phy-sec': 512,
			pkname: null,
			pttype: 'gpt',
			ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
			ra: 128,
			rand: false,
			rev: null,
			rm: false,
			ro: false,
			rota: false,
			'rq-size': 1023,
			sched: 'none',
			serial: '3EE50743172100007264',
			size: 2048408248320,
			start: null,
			state: 'live',
			subsystems: 'block:nvme:pci',
			mountpoint: null,
			mountpoints: [null],
			tran: 'nvme',
			type: 'disk',
			uuid: null,
			vendor: null,
			wsame: 0,
			wwn: 'eui.6479a78e1a306219',
			zoned: 'none',
			'zone-sz': 0,
			'zone-wgran': 0,
			'zone-app': 0,
			'zone-nr': 0,
			'zone-omax': 0,
			'zone-amax': 0,
			children: [
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 161460224,
					fsroots: ['/', '/'],
					fssize: 209489920,
					fstype: 'vfat',
					fsused: 48029696,
					'fsuse%': '23%',
					fsver: 'FAT16',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p1',
					label: 'ESP',
					'log-sec': 512,
					'maj:min': '259:1',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p1',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'ESP',
					parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
					parttypename: 'EFI System',
					partuuid: '14a31e9d-a8d7-4da0-9eb2-f268dd9d7ad9',
					path: '/dev/nvme0n1p1',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 209715200,
					start: 16384,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/boot/efi',
					mountpoints: ['/mnt/root/boot/efi', '/boot/efi'],
					tran: 'nvme',
					type: 'part',
					uuid: '8C09-5015',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 6095024128,
					fsroots: ['/', '/'],
					fssize: 10297585664,
					fstype: 'ext4',
					fsused: 3711803392,
					'fsuse%': '36%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p2',
					label: null,
					'log-sec': 512,
					'maj:min': '259:2',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p2',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: '2fe5a278-9b55-4266-8220-6665aa96940b',
					path: '/dev/nvme0n1p2',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 425984,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root',
					mountpoints: ['/mnt/root', '/'],
					tran: 'nvme',
					type: 'part',
					uuid: 'f30a5ab4-4925-4ef2-919e-baa907acc271',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: null,
					fsroots: [null],
					fssize: null,
					fstype: 'ext4',
					fsused: null,
					'fsuse%': null,
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p3',
					label: null,
					'log-sec': 512,
					'maj:min': '259:3',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p3',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'f5e6d27c-4a25-447b-8e08-a9d2e738345a',
					path: '/dev/nvme0n1p3',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 10552868864,
					start: 21037056,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: null,
					mountpoints: [null],
					tran: 'nvme',
					type: 'part',
					uuid: 'a45fe9d9-9fb4-44f1-aaee-95b55beff174',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
				{
					alignment: 0,
					'disc-aln': 0,
					dax: false,
					'disc-gran': 512,
					'disc-max': 2199023255040,
					'disc-zero': false,
					fsavail: 1860365182976,
					fsroots: [
						'/umbrel-os/var/log',
						'/umbrel-os/var/log',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/systemd/timesync',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/var/lib/docker',
						'/umbrel-os/home',
						'/umbrel-os/home',
						'/',
						'/',
					],
					fssize: 1963188352000,
					fstype: 'ext4',
					fsused: 40008829952,
					'fsuse%': '2%',
					fsver: '1.0',
					group: 'disk',
					hctl: null,
					hotplug: false,
					kname: 'nvme0n1p4',
					label: null,
					'log-sec': 512,
					'maj:min': '259:4',
					'min-io': 512,
					mode: 'brw-rw----',
					model: null,
					name: 'nvme0n1p4',
					'opt-io': 0,
					owner: 'root',
					partflags: null,
					partlabel: 'primary',
					parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
					parttypename: 'Linux filesystem',
					partuuid: 'd1d36e34-2753-4dc7-96eb-3c9b5584e867',
					path: '/dev/nvme0n1p4',
					'phy-sec': 512,
					pkname: 'nvme0n1',
					pttype: 'gpt',
					ptuuid: 'd021fdbe-f203-4f85-a8ba-bda954d239ec',
					ra: 128,
					rand: false,
					rev: null,
					rm: false,
					ro: false,
					rota: false,
					'rq-size': 1023,
					sched: 'none',
					serial: null,
					size: 2027084386304,
					start: 41648128,
					state: null,
					subsystems: 'block:nvme:pci',
					mountpoint: '/mnt/root/data',
					mountpoints: [
						'/mnt/root/var/log',
						'/var/log',
						'/mnt/root/var/lib/systemd/timesync',
						'/var/lib/systemd/timesync',
						'/mnt/root/var/lib/docker',
						'/var/lib/docker',
						'/mnt/root/home',
						'/home',
						'/mnt/root/data',
						'/data',
					],
					tran: 'nvme',
					type: 'part',
					uuid: '5e29c50c-6b77-48af-bd31-ed97b2c36ea4',
					vendor: null,
					wsame: 0,
					wwn: 'eui.6479a78e1a306219',
					zoned: 'none',
					'zone-sz': 0,
					'zone-wgran': 0,
					'zone-app': 0,
					'zone-nr': 0,
					'zone-omax': 0,
					'zone-amax': 0,
				},
			],
		},
	],
}
