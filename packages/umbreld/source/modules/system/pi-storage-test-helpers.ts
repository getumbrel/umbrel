import {expect} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

export type PiTestVm = Awaited<ReturnType<typeof createTestVm>>

type LsblkDevice = {
	name: string
	type: string
	tran?: string | null
	label?: string | null
	uuid?: string | null
	children?: LsblkDevice[]
}

// Pi first boot performs Rugix's A/B bootstrap through a TCG-emulated SD card.
export const piStartupTimeout = 2_700_000

export async function getUsbDisks(umbreld: PiTestVm) {
	const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN')) as {
		blockdevices: LsblkDevice[]
	}
	return blockdevices.filter((device) => device.type === 'disk' && device.tran === 'usb')
}

export async function waitForUsbDisks(umbreld: PiTestVm, count: number) {
	let disks: LsblkDevice[] = []
	await pRetry(
		async () => {
			disks = await getUsbDisks(umbreld)
			expect(disks).toHaveLength(count)
		},
		{retries: 60, minTimeout: 1000, maxTimeout: 1000},
	)
	return disks
}

export async function waitForUsbPartition(umbreld: PiTestVm, deviceId: string, label: string) {
	await pRetry(
		async () => {
			const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,LABEL')) as {
				blockdevices: LsblkDevice[]
			}
			const disk = blockdevices.find((device) => device.type === 'disk' && device.name === deviceId)
			expect(disk?.children?.some((partition) => partition.type === 'part' && partition.label === label)).toBe(true)
		},
		{retries: 120, minTimeout: 1000, maxTimeout: 1000},
	)
}

export async function waitForUsbPartitionByUuid(umbreld: PiTestVm, uuid: string) {
	let deviceId = ''
	await pRetry(
		async () => {
			const {blockdevices} = JSON.parse(await umbreld.vm.ssh('lsblk --json --output NAME,TYPE,TRAN,UUID')) as {
				blockdevices: LsblkDevice[]
			}
			const disk = blockdevices.find(
				(device) =>
					device.type === 'disk' &&
					device.tran === 'usb' &&
					device.children?.some((partition) => partition.type === 'part' && partition.uuid === uuid),
			)
			expect(disk).toBeDefined()
			deviceId = disk!.name
		},
		{retries: 120, minTimeout: 1000, maxTimeout: 1000},
	)
	return deviceId
}

export const topmostMountSource = (findmntOutput: string) => findmntOutput.trim().split('\n').at(-1)!.trim()

// Use the script's retired setup path to construct exactly the same disk
// layout that historical Pi installs received during their first boot.
export async function createLegacyUsbInstall(umbreld: PiTestVm) {
	await waitForUsbDisks(umbreld, 1)

	for (let attempt = 0; attempt < 2; attempt += 1) {
		const bootId = (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim()
		const output = await umbreld.vm.sshAsRoot(`
			set -eu
			systemctl stop umbrel.service docker.service
			systemctl reset-failed umbrel-external-storage.service || true

			set +e
			output=$(/opt/umbrel-external-storage/umbrel-external-storage --allow-legacy-setup 2>&1)
			status=$?
			set -e
			printf '%s\\n' "$output"
			if [ "$status" -ne 0 ]; then exit "$status"; fi

			case "$output" in
				*'UAS was blacklisted and device is rebooting'*) exit 0 ;;
			esac

			systemctl start docker.service umbrel.service
		`)

		if (output.includes('UAS was blacklisted and device is rebooting')) {
			await pWaitFor(
				async () => {
					try {
						return (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim() !== bootId
					} catch {
						return false
					}
				},
				{interval: 2000, timeout: 600_000},
			)
			await umbreld.waitForStartup()
			await waitForUsbDisks(umbreld, 1)
			continue
		}

		await umbreld.waitForStartup()
		const marker = (await umbreld.vm.ssh('test -f /mnt/data/umbrel/.umbrel && echo present')).trim()
		if (marker !== 'present') throw new Error(`Legacy setup completed without creating its marker:\n${output}`)
		return
	}

	throw new Error('Legacy setup still requested a UAS reboot on its second attempt')
}

// QEMU's emulated Pi USB bus can enumerate more slowly than real hardware.
// If the historical boot timeout elapsed on the first attempt, the attached
// disk is warm by the next power cycle. The production boot service is always
// responsible for mounting the legacy installation.
export async function rebootIntoLegacyUsbInstall(umbreld: PiTestVm, usbDiskCount = 1) {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await waitForUsbDisks(umbreld, usbDiskCount)

		const serviceStatus = (await umbreld.vm.ssh('systemctl is-active umbrel-external-storage.service || true')).trim()
		const umbrelSource = topmostMountSource(
			await umbreld.vm.ssh('findmnt -n -o SOURCE --target /home/umbrel/umbrel || true'),
		)
		if (serviceStatus === 'active' && /^\/dev\/sd[a-z]\d/.test(umbrelSource)) return
	}

	throw new Error('Legacy USB installation was not mounted during boot')
}

export async function expectLegacySystemMounts(umbreld: PiTestVm) {
	for (const target of ['/home/umbrel/umbrel', '/var/lib/docker', '/swap']) {
		const source = topmostMountSource(await umbreld.vm.ssh(`findmnt -n -o SOURCE --target ${target}`))
		expect(source).toMatch(/^\/dev\/sd[a-z]\d/)
	}
	expect((await umbreld.vm.ssh('findmnt -n -o TARGET --target /sd-root')).trim()).toBe('/sd-root')
}
