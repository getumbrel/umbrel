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

describe('USB installer auto-flashes an unflashed Umbrel Home', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		// An unflashed Umbrel Home: no OS on any disk, just a blank internal NVMe.
		// First boot after a flash does one-time provisioning so allow extra time.
		umbreld = await createTestVm({device: 'umbrel-home', bootDisk: 'none', startupTimeout: 600_000})
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
	test('boots the installer which auto-flashes the blank NVMe and powers off', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn({cdrom: installerIso, waitForShutdown: true})
	}, 900_000)

	test('boots the freshly flashed NVMe into onboarding', async () => {
		await umbreld.vm.powerOn({bootNvmeSlot: 1})
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(false)
	}, 900_000)

	test('completes onboarding on the flashed install', async () => {
		await umbreld.registerAndLogin()
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(true)
	})
})
