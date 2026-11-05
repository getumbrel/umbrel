import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {bootMarkerPath, hookPath, installPreStartHook} from './custom-hooks.vm-test-helpers.ts'
import {createLegacyUsbInstall} from './pi-storage-test-helpers.ts'

type LsblkDevice = {
	name: string
	type: string
	tran?: string | null
	label?: string | null
	mountpoints?: (string | null)[] | null
	children?: LsblkDevice[]
}

const getMountpoints = (device: LsblkDevice) =>
	device.mountpoints?.filter((mountpoint): mountpoint is string => !!mountpoint) ?? []

// The Pi VM always runs under TCG emulation (QEMU's raspi4b machine emulates
// the BCM2711's fixed Cortex-A72 cores so hardware virtualisation can't be
// used) and first boot runs the full rugix bootstrap through the emulated SD
// card, so this needs to be a lot longer than the default startup timeout.
const startupTimeout = 2_700_000

describe('Pi VM boot from SD card with USB external storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'pi', startupTimeout})
		await umbreld.vm.addUsbStorage({slot: 1})
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

	test('boots the Pi image from an SD card', async () => {
		const df = await umbreld.vm.ssh('df -h')
		expect(df).toContain('/dev/mmcblk0')

		const {blockdevices} = JSON.parse(
			await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,LABEL,MOUNTPOINTS'),
		) as {blockdevices: LsblkDevice[]}
		const sdCard = blockdevices.find((device) => device.type === 'disk' && device.name.startsWith('mmcblk'))

		expect(sdCard).toBeDefined()
		expect(sdCard!.children?.some((partition) => getMountpoints(partition).length > 0)).toBe(true)
	})

	// findmnt lists stacked mounts bottom-to-top (e.g. the data partition bind
	// under the USB storage mount), so check the effective topmost mount.
	const topmostMountSource = (findmntOutput: string) => findmntOutput.trim().split('\n').at(-1)!.trim()

	// QEMU's raspi4b USB bus (dwc2) is full speed (USB 1.1) and everything runs
	// under TCG, so on a busy runner the USB disk can take longer to enumerate
	// than the ~100s the mount script waits before giving up — on real Pi 4
	// hardware it enumerates in seconds. Wait for the disk to prove it's
	// attached, and if the mount script had already given up by the time it
	// appeared, power cycle so the script gets a boot with the disk present.
	const ensureBootSawUsbStorage = async () => {
		await pRetry(
			async () => {
				const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN')) as {
					blockdevices: LsblkDevice[]
				}
				expect(blockdevices.some((device) => device.type === 'disk' && device.tran === 'usb')).toBe(true)
			},
			{retries: 30, minTimeout: 1000, maxTimeout: 1000},
		)
		const bootServiceStatus = await umbreld.vm.ssh('systemctl is-active umbrel-external-storage.service || true')
		if (bootServiceStatus.trim() !== 'active') {
			await umbreld.vm.powerOff()
			await umbreld.vm.powerOn()
		}
	}

	const expectUsbSystemMounts = async () => {
		const umbrelMountSource = await umbreld.vm.ssh('findmnt -n -o SOURCE /home/umbrel/umbrel')
		expect(topmostMountSource(umbrelMountSource)).toMatch(/^\/dev\/sd[a-z]\d/)

		const dockerMountSource = await umbreld.vm.ssh('findmnt -n -o SOURCE /var/lib/docker')
		expect(topmostMountSource(dockerMountSource)).toMatch(/^\/dev\/sd[a-z]\d/)

		const swapMountSource = await umbreld.vm.ssh('findmnt -n -o SOURCE /swap')
		expect(topmostMountSource(swapMountSource)).toMatch(/^\/dev\/sd[a-z]\d/)

		const sdRootMountTarget = await umbreld.vm.ssh('findmnt -n -o TARGET /sd-root')
		expect(sdRootMountTarget.trim()).toBe('/sd-root')
	}

	test(
		'leaves the blank USB disk untouched during normal boot',
		async () => {
			await ensureBootSawUsbStorage()
			const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN')) as {
				blockdevices: LsblkDevice[]
			}
			const usbDisk = blockdevices.find((device) => device.type === 'disk' && device.tran === 'usb')
			expect(usbDisk).toBeDefined()
			expect(usbDisk!.children ?? []).toHaveLength(0)
		},
		startupTimeout + 600_000,
	)

	test(
		'creates a legacy USB installation only with the explicit setup flag',
		async () => {
			await createLegacyUsbInstall(umbreld)
			await expectUsbSystemMounts()

			const {blockdevices} = JSON.parse(
				await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,LABEL,MOUNTPOINTS'),
			) as {blockdevices: LsblkDevice[]}
			const usbDisk = blockdevices.find((device) => device.type === 'disk' && device.tran === 'usb')
			const usbPartition = usbDisk?.children?.find((partition) => partition.label === 'umbrel')

			expect(usbDisk).toBeDefined()
			expect(usbPartition).toBeDefined()
			expect(getMountpoints(usbPartition!)).toContain('/mnt/data')
		},
		startupTimeout + 600_000,
	)

	test(
		'mounts the legacy USB installation before running its pre-start hook',
		async () => {
			// Store the hook on the USB-backed Umbrel data directory. It records the
			// effective mount source it sees when systemd runs it during the next boot.
			await installPreStartHook(
				umbreld,
				`#!/bin/sh
set -eu

findmnt -n -o SOURCE --target '${hookPath}' | tail -n 1 > '${bootMarkerPath}'
`,
			)

			const uuidBeforeReboot = (await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()

			await umbreld.vm.powerOff()
			await umbreld.vm.powerOn()
			await ensureBootSawUsbStorage()
			await expectUsbSystemMounts()

			// The Pi storage unit must explicitly finish before the generic custom
			// hook unit; merely ordering both before umbrel.service leaves a race.
			const externalStorageBefore = (
				await umbreld.vm.ssh('systemctl show -p Before --value umbrel-external-storage.service')
			)
				.trim()
				.split(/\s+/)
			expect(externalStorageBefore).toContain('umbrel-custom-pre-start.service')

			// Prove the hook was found on the USB installation and observed that
			// installation already bind-mounted over /home/umbrel/umbrel.
			const hookMountSource = (await umbreld.vm.ssh(`cat '${bootMarkerPath}' 2>/dev/null || true`)).trim()
			expect(hookMountSource).toMatch(/^\/dev\/sd[a-z]\d/)

			expect((await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()).toBe(uuidBeforeReboot)
		},
		startupTimeout + 600_000,
	)

	test('creates an account and serves authenticated requests', async () => {
		await umbreld.registerAndLogin()

		// An authenticated request that exercises the running daemon end to end.
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing).toBeDefined()
	})

	// Every normal boot takes the mount-existing path. A reformat here would be
	// user data loss, so prove the filesystem and account survive another boot.
	test(
		'mounts existing USB storage and preserves user data across a reboot',
		async () => {
			await umbreld.vm.ssh('touch /home/umbrel/umbrel/home/created-before-reboot')
			const uuidBeforeReboot = (await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()
			expect(uuidBeforeReboot).not.toBe('')

			await umbreld.vm.powerOff()
			await umbreld.vm.powerOn()
			await ensureBootSawUsbStorage()
			await expectUsbSystemMounts()

			const uuidAfterReboot = (await umbreld.vm.ssh('lsblk -no UUID /dev/disk/by-label/umbrel')).trim()
			expect(uuidAfterReboot).toBe(uuidBeforeReboot)

			await umbreld.login()
			const homeListing = await umbreld.client.files.list.query({path: '/Home'})
			expect(homeListing.files).toContainEqual(expect.objectContaining({name: 'created-before-reboot'}))
		},
		startupTimeout + 600_000,
	)
})
