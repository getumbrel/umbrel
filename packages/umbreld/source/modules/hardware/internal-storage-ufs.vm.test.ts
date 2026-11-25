import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {StorageDevice} from './internal-storage.ts'

// UFS storage is soldered onto the board of some mini PCs. The kernel attaches it as SCSI disks
// that lsblk reports no transport for, one per logical unit: the main one, and small boot
// logical units holding firmware. It has 4096 byte sectors, and real UFS storage doesn't have to
// report a serial number (the VM's doesn't), so it's identified by its device path instead. The
// main logical unit must be offered as storage and work as it, while the boot logical units stay
// out of the way.
describe('UFS storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ufs: StorageDevice
	let failed = false

	const markerName = 'ufs-storage-marker'

	beforeAll(async () => {
		// A generic computer booting from eMMC, which isn't offered as storage, with UFS storage
		umbreld = await createTestVm({device: 'nas'})
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

	test('boots with UFS storage', async () => {
		await umbreld.vm.addUfs({size: '64G'})
		await umbreld.vm.powerOn()

		// The main logical unit and both boot logical units, all with 4096 byte sectors and no transport
		const {blockdevices} = JSON.parse(
			await umbreld.vm.ssh('lsblk --json --bytes --nodeps --output NAME,TRAN,LOG-SEC,SIZE,HCTL'),
		) as {blockdevices: Array<{tran: string | null; 'log-sec': number; size: number; hctl: string | null}>}
		const ufsLogicalUnits = blockdevices.filter((device) => device['log-sec'] === 4096 && device.hctl)
		expect(ufsLogicalUnits.map((device) => device.size).sort((a, b) => a - b)).toEqual([
			4 * 1024 ** 2,
			4 * 1024 ** 2,
			64 * 1024 ** 3,
		])
		expect(ufsLogicalUnits.every((device) => device.tran === null)).toBe(true)
	})

	test('offers the main UFS logical unit as SSD storage, without its boot logical units', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		ufs = devices[0]
		expect(ufs).toMatchObject({
			type: 'ssd',
			transport: 'ufs',
			size: 64 * 1024 ** 3,
			isSystemDrive: false,
			// UFS storage doesn't support SMART
			smartStatus: 'unknown',
		})
	})

	test('identifies the UFS storage by its device path', async () => {
		expect(ufs.id).toMatch(/^ufs-pci-[\d:.a-f]+-scsi-0:0:0:0$/)
		const target = await umbreld.vm.ssh(`readlink -f /dev/disk/by-umbrel-id/${ufs.id}`)
		expect(target.trim()).toBe(`/dev/${ufs.device}`)
	})

	test('does not offer the UFS storage as external storage', async () => {
		expect(await umbreld.unauthenticatedClient.files.externalDevices.query()).toHaveLength(0)
	})

	test('sets up storage on the UFS storage during onboarding (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [ufs.id!], raidType: 'storage'})
	})

	test('waits for storage setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) return false
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports the storage online on the UFS storage', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id)).toEqual([ufs.id])
		expect(status.totalSpace).toBeGreaterThan(0)
	})

	test('stores files on the UFS storage', async () => {
		await umbreld.api.post(`files/upload?path=/Home/${markerName}`, {body: 'ufs storage marker'})

		// The data directory lives on the pool, which is on the UFS storage's partition
		const pool = (await umbreld.vm.sshAsRoot(`df --output=source ${umbreld.vm.dataDirectory} | tail -1`)).split('/')[0]
		const vdevs = await umbreld.vm.sshAsRoot(`zpool list -v -P -H ${pool}`)
		expect(vdevs).toContain(`/dev/disk/by-umbrel-id/${ufs.id}-part`)
	})

	test('keeps the storage and its files across a power cycle', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id)).toEqual([ufs.id])

		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain(markerName)
	})
})
