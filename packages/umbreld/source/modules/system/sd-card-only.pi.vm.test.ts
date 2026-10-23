import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

type LsblkDevice = {
	name: string
	type: string
	tran?: string | null
}

// The Pi VM always runs under TCG emulation (QEMU's raspi4b machine emulates
// the BCM2711's fixed Cortex-A72 cores so hardware virtualisation can't be
// used) and first boot runs the full rugix bootstrap through the emulated SD
// card, so this needs to be a lot longer than the default startup timeout.
const startupTimeout = 2_700_000

// Boots the Pi image with NO external USB storage attached. umbrelOS is designed
// to run directly off the SD card in this case: the umbrel-external-storage
// mount script finds no drive and exits, and umbreld runs with its data on the
// SD card rather than a bind-mounted USB disk.
describe('Pi VM boot from SD card without external storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', startupTimeout})
		await umbreld.vm.powerOn()
	}, startupTimeout + 60_000)

	afterAll(async () => await umbreld?.cleanup())

	test('detects Raspberry Pi 4 hardware', async () => {
		const device = await umbreld.unauthenticatedClient.system.device.query()

		expect(device.productName).toBe('Raspberry Pi')
		expect(device.manufacturer).toBe('Raspberry Pi')
		expect(device.device).toBe('Raspberry Pi 4')
		expect(device.deviceId).toBe('pi-4')
	})

	test('runs off the SD card with no external storage bind mounts', async () => {
		// With no USB drive the mount script finds no block device and exits
		// non-zero by design, so the service ends up failed rather than active.
		const externalStorageStatus = await umbreld.vm.ssh('systemctl is-active umbrel-external-storage.service || true')
		expect(externalStorageStatus.trim()).toBe('failed')

		// Only the SD card is present — no USB disk.
		const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN')) as {
			blockdevices: LsblkDevice[]
		}
		expect(blockdevices.some((device) => device.type === 'disk' && device.name.startsWith('mmcblk'))).toBe(true)
		expect(blockdevices.some((device) => device.type === 'disk' && device.tran === 'usb')).toBe(false)

		// umbreld data and Docker are not bind-mounted from a USB disk; they live
		// on the SD-card-backed root filesystem.
		const umbrelSource = await umbreld.vm.ssh('findmnt -n -o SOURCE /home/umbrel/umbrel || true')
		expect(umbrelSource).not.toMatch(/\/dev\/sd/)
		const dockerSource = await umbreld.vm.ssh('findmnt -n -o SOURCE /var/lib/docker || true')
		expect(dockerSource).not.toMatch(/\/dev\/sd/)

		// The USB-only /sd-root bind mount is absent.
		const sdRoot = await umbreld.vm.ssh('findmnt -n -o TARGET /sd-root || true')
		expect(sdRoot.trim()).toBe('')
	})

	test('creates an account and serves authenticated requests off the SD card', async () => {
		await umbreld.registerAndLogin()

		// An authenticated request that exercises the running daemon end to end.
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing).toBeDefined()

		// Docker is up so apps can run off the SD card.
		const dockerStatus = await umbreld.vm.ssh('systemctl is-active docker')
		expect(dockerStatus.trim()).toBe('active')
	})
})
