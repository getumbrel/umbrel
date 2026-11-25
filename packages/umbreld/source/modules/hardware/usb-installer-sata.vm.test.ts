import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const osDirectory = path.resolve(currentDirectory, '../../../../os')
const osImage = path.join(osDirectory, 'build/umbrelos-amd64.img')
const installerBuildScript = path.join(osDirectory, 'usb-installer/build.sh')
const installerIso = path.join(osDirectory, 'build/umbrelos-amd64-usb-installer.iso')

// Most computers umbrelOS is installed on have disks with 512 byte logical sectors, the sector size
// the umbrelOS image is laid out for. This installs onto a SATA SSD with the USB installer's
// interactive prompts, the way a user would on a generic computer, then boots the result.
describe('USB installer installs umbrelOS on a SATA SSD with 512 byte sectors', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		// A generic computer with nothing installed. The image is only passed so the VM is amd64 (the
		// installer's architecture) on any host, there's no boot disk. First boot after an install
		// does one-time provisioning so allow extra time.
		umbreld = await createTestVm({device: 'nas', bootDisk: 'none', image: osImage, startupTimeout: 600_000})
	})

	afterAll(async () => {
		await umbreld?.cleanup()
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
	test('installs umbrelOS onto the SATA SSD with the USB installer', async () => {
		await umbreld.vm.addSsd({slot: 1, bus: 'sata'})

		// The installer lists the disks it can install to and asks for one by number. The SATA SSD
		// is the only disk so it's number 1, ahead of the installer's own CD-ROM. The installer's
		// screen can't be read from here, so keep typing 1 and Enter until the VM powers off. The
		// first answer picks the disk, and once umbrelOS is written a later one answers "Press any
		// key to shutdown". Any typed before the prompt appears are ignored or wait for it.
		const answerPrompts = setInterval(() => void umbreld.vm.typeText('1\n').catch(() => {}), 10_000)
		try {
			await umbreld.vm.powerOn({cdrom: installerIso, waitForShutdown: true})
		} finally {
			clearInterval(answerPrompts)
		}
	}, 900_000)

	test('boots the SATA SSD into onboarding', async () => {
		await umbreld.vm.powerOn({bootSataSlot: 1})
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(false)
	}, 900_000)

	test('completes onboarding on the SATA SSD install', async () => {
		await umbreld.registerAndLogin()
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(true)
	})

	test('the install is the image as built, filling the disk', async () => {
		const {blockdevices} = JSON.parse(
			await umbreld.vm.ssh('lsblk --json --bytes --output NAME,LOG-SEC,SIZE,PARTUUID /dev/sda'),
		) as {
			blockdevices: Array<{'log-sec': number; size: number; children?: Array<{size: number; partuuid: string}>}>
		}
		const [disk] = blockdevices
		expect(disk['log-sec']).toBe(512)

		// First boot adds the second OS slot and a data partition that takes the rest of the disk:
		// EFI, boot A, boot B, system A, system B, data
		expect(disk.children).toHaveLength(6)
		const partitionsSize = disk.children!.reduce((total, partition) => total + partition.size, 0)
		expect(partitionsSize).toBeGreaterThan(disk.size - 64 * 1024 * 1024)

		// The EFI partition is the image's own FAT filesystem with 512 byte sectors, as the installer
		// only recreates it on disks with 4096 byte sectors. The image's starts 1 MiB in.
		const bootSectorLength = 62
		const imageFile = await fse.open(osImage, 'r')
		const imageBootSector = Buffer.alloc(bootSectorLength)
		await fse.read(imageFile, imageBootSector, 0, bootSectorLength, 1024 * 1024)
		await fse.close(imageFile)
		const bootSector = await umbreld.vm.sshAsRoot(
			`head -c ${bootSectorLength} /dev/sda1 | od -An -v -tx1 | tr -d ' \\n'`,
		)
		expect(bootSector).toBe(imageBootSector.toString('hex'))
		expect(imageBootSector.readUInt16LE(11)).toBe(512)
	})
})
