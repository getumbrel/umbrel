// @vm-requires-update-bundle
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	getRugixState,
	rebootAndWaitForUmbreld,
	reboot,
	runUpdateScript,
	serveUpdateBundle,
	waitForCommittedBoot,
} from '../test-utilities/os-update.ts'
import {triggerFactoryReset} from '../test-utilities/rebooting-action.ts'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const osDirectory = path.resolve(currentDirectory, '../../../../os')
const osImage = path.join(osDirectory, 'build/umbrelos-amd64.img')
const installerBuildScript = path.join(osDirectory, 'usb-installer/build.sh')
const installerIso = path.join(osDirectory, 'build/umbrelos-amd64-usb-installer.iso')

// System partitions of the A/B boot groups in the amd64 GPT layout
const systemPartition = {a: 4, b: 5} as const

// UFS storage has 4096 byte logical sectors, while the umbrelOS image's partition table is laid
// out for 512 byte sectors. This installs onto UFS storage with the USB installer the way a user
// would on a mini PC with onboard UFS, then boots the result and runs it through everything that
// rewrites its boot configuration or partitions: OS updates in both directions, falling back from
// an update that doesn't boot, and a factory reset.
describe('USB installer installs umbrelOS on UFS storage with 4096 byte sectors', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let bundleServer: Awaited<ReturnType<typeof serveUpdateBundle>>
	let partitionTable: string
	let failed = false

	const markerName = 'ufs-install-marker.txt'

	// The boot disk's partitions with their sizes and GUIDs, and its sector size
	const readPartitionTable = () =>
		umbreld.vm.ssh('lsblk --bytes --output NAME,LOG-SEC,SIZE,PARTUUID,PARTTYPE /dev/nvme0n1')

	beforeAll(async () => {
		// A generic computer with nothing installed and onboard UFS storage. The image is only
		// passed so the VM is amd64 (the installer's architecture) on any host, there's no boot
		// disk. First boot after an install does one-time provisioning so allow extra time.
		umbreld = await createTestVm({device: 'nas', bootDisk: 'none', image: osImage, startupTimeout: 600_000})
		bundleServer = await serveUpdateBundle()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await bundleServer?.close()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('compresses the umbrelOS image for the installer', async () => {
		// The installer expects an xz stream, compression ratio doesn't matter
		// here so use the fastest level
		await $`xz --keep --force -0 --threads=0 ${osImage}`
	}, 1_200_000)

	test('builds the USB installer ISO', async () => {
		await $`${installerBuildScript}`
		expect(await fse.pathExists(installerIso)).toBe(true)
	}, 1_800_000)

	// The boot test timeouts are longer than the VM startupTimeout so VM boot
	// failures surface the VM console output instead of a bare vitest timeout
	test('installs umbrelOS onto the UFS storage with the USB installer', async () => {
		await umbreld.vm.addUfs()

		// The installer lists the disks it can install to and asks for one by number. The UFS
		// storage is the only disk so it's number 1, ahead of the installer's own CD-ROM. The
		// installer's screen can't be read from here, so keep typing 1 and Enter until the VM
		// powers off. The first answer picks the disk, and once umbrelOS is written a later one
		// answers "Press any key to shutdown". Any typed before the prompt appears are ignored or
		// wait for it.
		const answerPrompts = setInterval(() => void umbreld.vm.typeText('1\n').catch(() => {}), 10_000)
		try {
			await umbreld.vm.powerOn({cdrom: installerIso, waitForShutdown: true})
		} finally {
			clearInterval(answerPrompts)
		}
	}, 900_000)

	test('boots the UFS storage into onboarding', async () => {
		await umbreld.vm.powerOn({bootUfs: true})
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(false)
	}, 900_000)

	test('completes onboarding on the UFS install', async () => {
		await umbreld.registerAndLogin()
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(true)
	})

	test('the install uses 4096 byte sectors and fills the disk', async () => {
		// The VM boots the UFS storage as an NVMe disk, its firmware can't boot from UFS
		const {blockdevices} = JSON.parse(
			await umbreld.vm.ssh('lsblk --json --bytes --output NAME,TYPE,LOG-SEC,SIZE /dev/nvme0n1'),
		) as {blockdevices: Array<{name: string; 'log-sec': number; size: number; children?: Array<{size: number}>}>}
		const [disk] = blockdevices
		expect(disk['log-sec']).toBe(4096)

		// First boot adds the second OS slot and a data partition that takes the rest of the disk:
		// EFI, boot A, boot B, system A, system B, data
		expect(disk.children).toHaveLength(6)
		const partitionsSize = disk.children!.reduce((total, partition) => total + partition.size, 0)
		expect(partitionsSize).toBeGreaterThan(disk.size - 64 * 1024 * 1024)

		// The EFI partition holds the boot configuration the OS switches slots with, so it must
		// be mounted
		const configSource = await umbreld.vm.ssh('findmnt --noheadings --output SOURCE /run/rugix/mounts/config')
		expect(configSource.trim()).toBe('/dev/nvme0n1p1')

		partitionTable = await readPartitionTable()
	})

	test('reboots into the same install', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn({bootUfs: true})
		await umbreld.login()
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(true)

		const state = await getRugixState(umbreld)
		expect(state.bootFlow).toBe('grub')
		expect(state.activeGroup).toBe('a')
		expect(state.defaultGroup).toBe('a')
	})

	test('creates a marker file', async () => {
		await umbreld.api.post(`files/upload?path=/Home/${markerName}`, {body: 'ufs install marker'})
	})

	test('installs an OS update and boots it from boot group b', async () => {
		await runUpdateScript(umbreld, bundleServer.port)
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
	}, 1_800_000)

	test('keeps user data, the partition table and a read-only config partition across the update', async () => {
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain(markerName)

		expect(await readPartitionTable()).toBe(partitionTable)

		const options = await umbreld.vm.sshAsRoot('findmnt --noheadings --output OPTIONS /run/rugix/mounts/config')
		expect(options.split(',')).toContain('ro')
	})

	test('installs the next OS update back into boot group a', async () => {
		await runUpdateScript(umbreld, bundleServer.port)
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('a')
		expect(state.defaultGroup).toBe('a')
	}, 1_800_000)

	test('falls back to the committed system when the updated system fails to boot', async () => {
		// GRUB boots the other system once when Rugix sets this flag, clearing it as it does
		const getBootSpareFlag = () =>
			umbreld.vm.sshAsRoot(
				'grep --text --only-matching "rugpi_boot_spare=[a-z]*" /run/rugix/mounts/config/rugpi/boot_spare.grubenv',
			)

		await runUpdateScript(umbreld, bundleServer.port)
		expect(await getBootSpareFlag()).toBe('rugpi_boot_spare=true')

		// Break the freshly installed system partition so its trial boot panics before
		// umbreld can commit it
		await umbreld.vm.sshAsRoot(
			`wipefs --all --quiet "$(rugix-ctrl utils resolve-partition ${systemPartition.b} | jq -r .device)"`,
		)

		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		// The trial boot was used up and the device came back on the committed system
		expect(await getBootSpareFlag()).toBe('rugpi_boot_spare=false')
		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('a')
		expect(state.defaultGroup).toBe('a')
	}, 1_800_000)

	test('recovers the failed slot with the next update', async () => {
		await runUpdateScript(umbreld, bundleServer.port)
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
	}, 1_800_000)

	test('factory resets the install', async () => {
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

		await umbreld.registerAndLogin()
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).not.toContain(markerName)

		// Factory reset keeps the installed system and the disk's layout
		const state = await getRugixState(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
		expect(await readPartitionTable()).toBe(partitionTable)
	})

	test('boots the factory reset install after a power cycle', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn({bootUfs: true})
		await umbreld.login()

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(await readPartitionTable()).toBe(partitionTable)
	})
})
