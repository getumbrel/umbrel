import nodePath from 'node:path'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import fse from 'fs-extra'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {StorageDevice} from './internal-storage.ts'

// Drives behind a SAS HBA (the LSI/Broadcom cards common in DIY NAS builds) show up with a
// sas transport whether they are native SAS drives or SATA drives the controller presents
// as SCSI devices. They must be listed as internal storage alongside SATA and NVMe drives,
// with stable IDs, without touching whatever is already on them.
describe('SAS HBA drive detection', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let sasHdd: StorageDevice
	let sasSsd: StorageDevice
	let partitionTableBefore: string
	let partitionChecksumBefore: string
	let failed = false

	// The VM harness gives every SAS drive a persistent NAA world wide name, which udev
	// prefers for the ID just as it does on real SAS hardware
	async function getSasDriveState(slot: number) {
		const state = await fse.readJson(nodePath.join(umbreld.vm.stateDir, 'sas.json'))
		return state[slot] as {serial: string; wwn: string}
	}

	async function getDevices() {
		return umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
	}

	// Partition table and a checksum of the data in the first partition of the SAS HDD. Kernel
	// names can change between boots so they're left out of the partition table.
	async function readExistingPartition() {
		const disk = `/dev/disk/by-umbrel-id/${sasHdd.id}`
		const partitionTable = await umbreld.vm.sshAsRoot(
			`sfdisk --dump ${disk} | grep -v '^device:' | sed -E 's#^/dev/[a-z0-9]+ *:#partition:#'`,
		)
		const checksum = await umbreld.vm.sshAsRoot(`head -c 16M ${disk}-part1 | sha256sum`)
		return {partitionTable, checksum}
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas', bootDisk: 'nvme'})
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

	test('boots a NAS VM with SATA, NVMe and SAS HBA drives', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addHdd({slot: 1, size: '2T', bus: 'sas'})
		await umbreld.vm.addSsd({slot: 2, size: '256G', bus: 'sas'})
		await umbreld.vm.powerOn()
	})

	test('lists SAS drives as internal storage alongside SATA and NVMe drives', async () => {
		const devices = await getDevices()
		// Boot NVMe, data NVMe, SATA HDD, SAS HDD, SAS SSD
		expect(devices).toHaveLength(5)
		expect(devices.filter((device) => device.transport === 'nvme')).toHaveLength(2)
		expect(devices.filter((device) => device.transport === 'sata')).toHaveLength(1)
		expect(devices.filter((device) => device.transport === 'sas')).toHaveLength(2)
	})

	test('classifies rotational and non-rotational SAS drives as HDD and SSD', async () => {
		const sasDevices = (await getDevices()).filter((device) => device.transport === 'sas')
		sasHdd = sasDevices.find((device) => device.type === 'hdd')!
		sasSsd = sasDevices.find((device) => device.type === 'ssd')!
		expect(sasHdd).toBeDefined()
		expect(sasSsd).toBeDefined()

		// 2T and 256G qcow2 images
		expect(sasHdd.size).toBe(2 * 1024 ** 4)
		expect(sasSsd.size).toBe(256 * 1024 ** 3)
		for (const device of [sasHdd, sasSsd]) {
			expect(device.isSystemDrive).toBe(false)
			expect(device.roundedSize).toBeGreaterThan(0)
			expect(device.roundedSize).toBeLessThanOrEqual(device.size)
		}
	})

	test("identifies SAS drives by their world wide name and reports the drive's serial", async () => {
		for (const [device, slot] of [
			[sasHdd, 1],
			[sasSsd, 2],
		] as const) {
			const {serial, wwn} = await getSasDriveState(slot)
			// udev's SCSI ID for a drive with an NAA identifier: NAA type 3 + the WWN
			expect(device.id).toBe(`3${wwn.replace(/^0x/, '')}`)
			expect(device.serial).toBe(serial)

			// The ID resolves to the kernel device it's reported for
			const target = await umbreld.vm.sshAsRoot(`readlink -f /dev/disk/by-umbrel-id/${device.id}`)
			expect(target).toBe(`/dev/${device.device}`)
		}
	})

	test('does not offer SAS drives as external storage', async () => {
		const externalDevices = await umbreld.unauthenticatedClient.files.externalDevices.query()
		expect(externalDevices).toHaveLength(0)
	})

	test('writes an existing partition with data to the SAS HDD', async () => {
		// Drives moved from another system arrive with partitions on them
		const disk = `/dev/disk/by-umbrel-id/${sasHdd.id}`
		await umbreld.vm.sshAsRoot(`
			set -e
			printf 'label: gpt\\nsize=1G, type=linux\\n' | sfdisk --quiet ${disk}
			udevadm settle
			head -c 16M /dev/urandom > ${disk}-part1
			sync
		`)
		;({partitionTable: partitionTableBefore, checksum: partitionChecksumBefore} = await readExistingPartition())
		expect(partitionTableBefore).toContain('label: gpt')
	})

	test('detection leaves the existing partition and its data untouched', async () => {
		// Detect a few times, then power cycle so detection also runs during boot
		for (let i = 0; i < 3; i++) expect((await getDevices()).some((device) => device.id === sasHdd.id)).toBe(true)
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		expect((await getDevices()).some((device) => device.id === sasHdd.id)).toBe(true)

		const {partitionTable, checksum} = await readExistingPartition()
		expect(partitionTable).toBe(partitionTableBefore)
		expect(checksum).toBe(partitionChecksumBefore)

		// Still not mounted or offered as external storage with a partition on it
		expect(await umbreld.unauthenticatedClient.files.externalDevices.query()).toHaveLength(0)
		expect(await umbreld.vm.sshAsRoot(`findmnt --noheadings --output SOURCE | grep -c ${sasHdd.device} || true`)).toBe(
			'0',
		)
	})

	test('keeps SAS drive IDs stable when a drive is moved to another bay on the HBA', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.moveHdd({fromSlot: 1, toSlot: 6, bus: 'sas'})
		await umbreld.vm.powerOn()

		const sasDevices = (await getDevices()).filter((device) => device.transport === 'sas')
		expect(sasDevices).toHaveLength(2)
		const movedHdd = sasDevices.find((device) => device.id === sasHdd.id)
		expect(movedHdd?.type).toBe('hdd')
		expect(movedHdd?.serial).toBe(sasHdd.serial)
		expect(sasDevices.find((device) => device.id === sasSsd.id)?.type).toBe('ssd')

		// The moved drive's data came with it
		const {checksum} = await readExistingPartition()
		expect(checksum).toBe(partitionChecksumBefore)
	})
})
