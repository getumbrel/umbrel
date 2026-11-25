import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

type TestUmbreld = Awaited<ReturnType<typeof createTestVm>>

const waitForRaidSetup = async (umbreld: TestUmbreld) => {
	await pWaitFor(
		async () => {
			try {
				return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
			} catch (error) {
				if (error instanceof Error && error.message.includes('fetch failed')) return false
				throw error
			}
		},
		{interval: 2000, timeout: 600_000},
	)
	await umbreld.login()
}

// Waits for a transition that has been started to copy the array and reboot, then for the rebuild
// after the reboot to finish
const waitForTransitionToComplete = async (umbreld: TestUmbreld) => {
	await pWaitFor(
		async () => {
			try {
				const {failsafeTransitionStatus} = await umbreld.client.hardware.raid.getStatus.query()
				if (failsafeTransitionStatus?.state === 'error') throw new Error(failsafeTransitionStatus.error)
				return failsafeTransitionStatus?.state === 'rebooting'
			} catch (error) {
				if (error instanceof Error && error.message.includes('fetch failed')) return true
				throw error
			}
		},
		{interval: 1000, timeout: 600_000},
	)
	await umbreld.waitForStartup({waitForUser: true})
	await umbreld.login()
	await pWaitFor(
		async () => {
			let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
			try {
				status = await umbreld.client.hardware.raid.getStatus.query()
			} catch {
				// The VM may still be going down for the reboot
				await umbreld.login().catch(() => {})
				return false
			}
			if (status.failsafeTransitionStatus?.state === 'error') throw new Error(status.failsafeTransitionStatus.error)
			return status.failsafeTransitionStatus?.state === 'complete'
		},
		{interval: 1000, timeout: 600_000},
	)
}

// A raidz2 array keeps working with any two of its drives gone, where raidz1 and mirrors only promise
// one. HDD arrays can ask for it at setup, and it grows a drive at a time like raidz1 but without
// raidz1's six-drive limit.
describe.each(driveBuses)('RAID HDD raidz2 failsafe array (%s)', (bus) => {
	let umbreld: TestUmbreld
	let hddIds: string[] = []
	let ssdIds: string[] = []
	let failed = false

	const register = (raid: {
		raidDevices: string[]
		raidType: 'storage' | 'failsafe'
		failsafeLayout?: 'raidz1' | 'raidz2' | 'mirror'
	}) => umbreld.unauthenticatedClient.user.register.mutate({name: 'satoshi', password: 'moneyprintergobrrr', ...raid})

	// A raidz2 array holds all but two drives of data, plus whatever its accelerator's special vdev holds
	const expectUsableSpaceForDrives = async (driveCount: number) => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hddSize = devices.find((device) => device.type === 'hdd')!.size
		const expected = hddSize * (driveCount - 2) + status.accelerator!.specialSize!
		expect(status.usableSpace! / expected).toBeGreaterThan(0.97)
		expect(status.usableSpace! / expected).toBeLessThan(1.03)
		expect(status.freeSpace).toBe(status.usableSpace! - status.usedSpace!)
	}

	// Waits for data that has just been written to show up as used space, and checks it isn't overstated
	const expectUsedSpaceToGrowBy = async (usedSpaceBefore: number, minimum: number, maximum: number) => {
		await pWaitFor(
			async () => (await umbreld.client.hardware.raid.getStatus.query()).usedSpace! - usedSpaceBefore > minimum,
			{interval: 1000, timeout: 120_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usedSpace! - usedSpaceBefore).toBeLessThan(maximum)
	}

	// ZFS scrubs the array after an expansion, and a drive can't be added until that has finished
	const waitForExpansionToFinish = () =>
		pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return (
					status.expansion?.state !== 'expanding' && status.scrub?.state !== 'scrubbing' && status.status === 'ONLINE'
				)
			},
			{interval: 1000, timeout: 300_000},
		)

	beforeAll(async () => {
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

	// --- Phase 1: Boot and detect devices ---

	test('adds eight HDDs and three NVMe SSDs and boots VM', async () => {
		// Small HDDs so the accelerator's special vdev is a visible share of the array's space
		for (const slot of [1, 2, 3, 4, 5, 6, 7, 8]) await umbreld.vm.addHdd({slot, bus, size: '64G'})
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		// The VM gives each HDD a serial that starts with its slot
		const hddSlot = (serial: string) => Number(serial.match(/hdd(\d)-/)![1])
		hddIds = devices
			.filter((device) => device.type === 'hdd')
			.sort((a, b) => hddSlot(a.serial) - hddSlot(b.serial))
			.map((device) => device.id!)
		ssdIds = devices.filter((device) => device.type === 'ssd').map((device) => device.id!)
		expect(hddIds).toHaveLength(8)
		expect(ssdIds).toHaveLength(3)
	})

	// --- Phase 2: Setup validation ---

	test('rejects a raidz2 array of two HDDs', async () => {
		await expect(
			register({raidDevices: hddIds.slice(0, 2), raidType: 'failsafe', failsafeLayout: 'raidz2'}),
		).rejects.toThrow('The raidz2 layout requires at least three devices')
	})

	test('rejects the raidz2 layout for SSDs', async () => {
		await expect(register({raidDevices: ssdIds, raidType: 'failsafe', failsafeLayout: 'raidz2'})).rejects.toThrow(
			'The raidz2 layout is only supported for HDD RAID arrays',
		)
	})

	// --- Phase 3: Setup ---

	test('registers user with a three-HDD raidz2 array and a mirrored accelerator (triggers reboot)', async () => {
		await umbreld.signup({
			raidDevices: hddIds.slice(0, 3),
			raidType: 'failsafe',
			failsafeLayout: 'raidz2',
			acceleratorDevices: ssdIds.slice(0, 2),
		})
		await waitForRaidSetup(umbreld)
	})

	test('reports a raidz2 failsafe array of HDDs with its accelerator', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.mirrors).toBeUndefined()
		expect(status.devices!.map((device) => device.id).sort()).toEqual(hddIds.slice(0, 3).sort())
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual(ssdIds.slice(0, 2).sort())
		await expectUsableSpaceForDrives(3)
	})

	test('builds the HDDs as one raidz2 vdev and only mirrors the accelerator', async () => {
		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
		// The only mirror is the accelerator's special vdev
		expect(zpoolStatus.match(/mirror-\d+/g)).toHaveLength(1)
		expect(zpoolStatus).toMatch(/special\s+mirror-\d+/)
	})

	test('rejects the mirror and transition endpoints on a raidz2 array', async () => {
		await expect(umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddIds[3], hddIds[4]]})).rejects.toThrow(
			'addMirror is only supported for mirror failsafe mode',
		)
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[3],
				secondNewDeviceId: hddIds[4],
				failsafeLayout: 'raidz2',
			}),
		).rejects.toThrow('Can only transition from storage mode')
	})

	// --- Phase 4: Space reporting on the smallest raidz2 array ---

	test('reports large files stored on the HDDs at their size without parity', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=2000 && sha256sum ~/data.bin > ~/data.sha256')

		// 2.1GB of data, not the 6.3GB it takes up on three drives with two of them parity. The array's own
		// usage moves by tens of MB as it settles after setup, so the data is large enough for that not to matter.
		await expectUsedSpaceToGrowBy(usedSpaceBefore, 1.95e9, 2.3e9)
	})

	test('reports small files stored on the accelerator at their full size', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!

		// 480MB of files small enough to be stored on the accelerator's special vdev, which isn't raidz so
		// its usage must not be divided by three like the HDDs' is
		await umbreld.vm.ssh(
			'mkdir ~/small && for i in $(seq 1 10000); do head -c 48000 /dev/urandom > ~/small/$i; done && sync',
		)
		await expectUsedSpaceToGrowBy(usedSpaceBefore, 440e6, 560e6)
	})

	// --- Phase 5: Expand past the raidz1 limit ---

	test('adds HDDs one at a time up to seven devices', async () => {
		for (const deviceId of hddIds.slice(3, 7)) {
			await umbreld.client.hardware.raid.addDevice.mutate({deviceId})
			await waitForExpansionToFinish()
		}

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.devices!.map((device) => device.id).sort()).toEqual(hddIds.slice(0, 7).sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)

		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
	})

	test('usable space is five drives of data plus the accelerator', async () => {
		await expectUsableSpaceForDrives(7)
	})

	test('system disk usage matches the expanded array without the free space on the accelerator', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const acceleratorFreeSpace = status.accelerator!.specialFreeSpace!
		const diskUsage = await umbreld.client.system.systemDiskUsage.query()
		expect(diskUsage.size / (status.usableSpace! - acceleratorFreeSpace)).toBeGreaterThan(0.999)
		expect(diskUsage.size / (status.usableSpace! - acceleratorFreeSpace)).toBeLessThan(1.001)
	})

	// --- Phase 6: Reboot and drive failures ---

	test('is still a raidz2 failsafe array after a reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(7)
		expect(status.accelerator?.devices).toHaveLength(2)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('keeps the data available with two HDDs missing', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeHdd({slot: 2, bus})
		await umbreld.vm.removeHdd({slot: 5, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).status === 'DEGRADED', {
			interval: 1000,
			timeout: 60_000,
		})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.devices!.filter((device) => device.status === 'ONLINE')).toHaveLength(5)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('rebuilds a spare HDD in place of one of the missing ones', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: hddIds[1], newDevice: hddIds[7]})
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return (
					status.rebuild?.state !== 'rebuilding' &&
					status.devices!.some((device) => device.id === hddIds[7] && device.status === 'ONLINE') &&
					!status.devices!.some((device) => device.id === hddIds[1])
				)
			},
			{interval: 1000, timeout: 300_000},
		)

		// One HDD is still missing, which a raidz2 array can also do without
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('DEGRADED')
		expect(status.devices!.filter((device) => device.status === 'ONLINE')).toHaveLength(6)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})

// A raidz2 array without an accelerator, which then gets one. The smallest raidz2 array reports its
// space differently from a wider one, and both have to account for an accelerator added afterwards.
describe.each(driveBuses)('RAID HDD raidz2 array with an accelerator added later (%s)', (bus) => {
	let umbreld: TestUmbreld
	let hddIds: string[] = []
	let ssdIds: string[] = []
	let hddSize: number
	let failed = false

	const waitForUsedSpaceToGrowBy = async (usedSpaceBefore: number, minimum: number, maximum: number) => {
		await pWaitFor(
			async () => (await umbreld.client.hardware.raid.getStatus.query()).usedSpace! - usedSpaceBefore > minimum,
			{interval: 1000, timeout: 120_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usedSpace! - usedSpaceBefore).toBeLessThan(maximum)
	}

	beforeAll(async () => {
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

	test('adds four HDDs and three NVMe SSDs and boots VM', async () => {
		for (const slot of [1, 2, 3, 4]) await umbreld.vm.addHdd({slot, bus, size: '64G'})
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		// The VM gives each drive a serial that starts with its slot
		const slot = (serial: string) => Number(serial.match(/(?:hdd|nvme)(\d)-/)![1])
		const bySlot = (a: {serial: string}, b: {serial: string}) => slot(a.serial) - slot(b.serial)
		const hdds = devices.filter((device) => device.type === 'hdd').sort(bySlot)
		hddIds = hdds.map((device) => device.id!)
		hddSize = hdds[0].size
		ssdIds = devices
			.filter((device) => device.type === 'ssd')
			.sort(bySlot)
			.map((device) => device.id!)
		expect(hddIds).toHaveLength(4)
		expect(ssdIds).toHaveLength(3)
	})

	test('sets up a three-HDD raidz2 array without an accelerator (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: hddIds.slice(0, 3), raidType: 'failsafe', failsafeLayout: 'raidz2'})
		await waitForRaidSetup(umbreld)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.accelerator?.exists).toBe(false)
		// One drive of data out of three (raidz2 keeps a little for itself)
		expect(status.usableSpace! / hddSize).toBeGreaterThan(0.93)
		expect(status.usableSpace! / hddSize).toBeLessThan(1.01)

		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
		expect(zpoolStatus).not.toContain('mirror')
	})

	test('reports large files at their size without parity', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=2000 && sha256sum ~/data.bin > ~/data.sha256')
		await waitForUsedSpaceToGrowBy(usedSpaceBefore, 1.95e9, 2.3e9)
	})

	test('rejects a single accelerator SSD', async () => {
		await expect(umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [ssdIds[0]]})).rejects.toThrow(
			'Failsafe mode requires exactly two SSDs for the accelerator',
		)
	})

	test('adds a mirrored accelerator and counts its space as usable', async () => {
		const usableSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usableSpace!
		await umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: ssdIds.slice(0, 2)})

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual(ssdIds.slice(0, 2).sort())
		const added = status.usableSpace! - usableSpaceBefore
		expect(added / status.accelerator!.specialSize!).toBeGreaterThan(0.9)
		expect(added / status.accelerator!.specialSize!).toBeLessThan(1.1)
	})

	test('reports small files stored on the accelerator at their full size', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!
		await umbreld.vm.ssh(
			'mkdir ~/small && for i in $(seq 1 10000); do head -c 48000 /dev/urandom > ~/small/$i; done && sync',
		)
		await waitForUsedSpaceToGrowBy(usedSpaceBefore, 440e6, 560e6)
	})

	test('adds a fourth HDD and reports two drives of data plus the accelerator', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddIds[3]})
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return (
					status.expansion?.state !== 'expanding' && status.scrub?.state !== 'scrubbing' && status.status === 'ONLINE'
				)
			},
			{interval: 1000, timeout: 300_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(4)
		const expected = hddSize * 2 + status.accelerator!.specialSize!
		expect(status.usableSpace! / expected).toBeGreaterThan(0.97)
		expect(status.usableSpace! / expected).toBeLessThan(1.03)
	})

	test('replaces an accelerator SSD that has been pulled out', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeNvme({slot: 2})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: ssdIds[1], newDevice: ssdIds[2]})
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				const accelerator = status.accelerator?.devices ?? []
				return (
					status.status === 'ONLINE' &&
					accelerator.length === 2 &&
					accelerator.every((device) => device.status === 'ONLINE') &&
					accelerator.some((device) => device.id === ssdIds[2])
				)
			},
			{interval: 1000, timeout: 300_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual([ssdIds[0], ssdIds[2]].sort())
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})

// A single-HDD storage array becomes a three-HDD raidz2 array when it is given two new HDDs. The new
// array is built from the two new HDDs and a stand-in for the existing one, so unlike the raidz1
// transition it can already lose a drive while the data is copied to it.
describe.each(driveBuses)('RAID HDD storage to raidz2 transition (%s)', (bus) => {
	let umbreld: TestUmbreld
	let hddIds: string[] = []
	let usableSpaceBefore: number
	let failed = false

	beforeAll(async () => {
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

	test('adds three HDDs and boots VM', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addHdd({slot, bus, size: '64G'})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hddSlot = (serial: string) => Number(serial.match(/hdd(\d)-/)![1])
		hddIds = devices
			.filter((device) => device.type === 'hdd')
			.sort((a, b) => hddSlot(a.serial) - hddSlot(b.serial))
			.map((device) => device.id!)
		expect(hddIds).toHaveLength(3)
	})

	test('sets up a single-HDD storage array (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddIds[0]], raidType: 'storage'})
		await waitForRaidSetup(umbreld)
		usableSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usableSpace!
	})

	test('writes data with a checksum', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('rejects a number of new HDDs that does not match the layout', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: hddIds[1], failsafeLayout: 'raidz2'}),
		).rejects.toThrow('The raidz2 layout requires two new devices')
		// Without a layout it's a raidz1 transition, so a second device doesn't quietly make it raidz2
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				secondNewDeviceId: hddIds[2],
			}),
		).rejects.toThrow('The raidz1 layout requires one new device')
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				secondNewDeviceId: hddIds[2],
				failsafeLayout: 'raidz1',
			}),
		).rejects.toThrow('The raidz1 layout requires one new device')

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.failsafeTransitionStatus).toBeUndefined()
	})

	test('rejects the same new HDD given twice', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				secondNewDeviceId: hddIds[1],
				failsafeLayout: 'raidz2',
			}),
		).rejects.toThrow('New devices must be unique')
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				secondNewDeviceId: hddIds[0],
				failsafeLayout: 'raidz2',
			}),
		).rejects.toThrow('Cannot transition with a device that is already in the RAID array')

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.failsafeTransitionStatus).toBeUndefined()
	})

	test('builds a raidz2 array from the two new HDDs and a stand-in while syncing', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
			newDeviceId: hddIds[1],
			secondNewDeviceId: hddIds[2],
			failsafeLayout: 'raidz2',
		})

		const status = await umbreld.client.hardware.raid.getStatus.query()
		const zpoolStatus = await umbreld.vm.sshAsRoot(`zpool status -P ${status.name}-migration`)
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
		expect(zpoolStatus.match(/-part2/g)).toHaveLength(2)
		expect(zpoolStatus).toMatch(/\/tmp\/\S+\s+OFFLINE/)
	})

	test('reboots and rebuilds the existing HDD into the array', async () => {
		await waitForTransitionToComplete(umbreld)
	})

	test('reports a healthy three-HDD raidz2 array holding the same data', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([...hddIds].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		// One drive of data, the same as the single-HDD storage array (raidz2 keeps a little more for itself)
		expect(status.usableSpace! / usableSpaceBefore).toBeGreaterThan(0.93)
		expect(status.usableSpace! / usableSpaceBefore).toBeLessThan(1.02)
		// 3.1GB of data, not the 9.4GB it takes up with two parity drives
		expect(status.usedSpace!).toBeGreaterThan(3.1e9)
		expect(status.usedSpace!).toBeLessThan(3.6e9)

		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
		expect(zpoolStatus).not.toContain('/tmp/')
		expect(zpoolStatus).not.toContain('replacing')
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('keeps the data available with two of the three HDDs missing', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeHdd({slot: 1, bus})
		await umbreld.vm.removeHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).status === 'DEGRADED', {
			interval: 1000,
			timeout: 60_000,
		})
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})

// The raidz2 transition keeps an accelerator the same way the raidz1 one does: the new array is built
// with the new SSD as its accelerator, and the existing SSD mirrors it after the reboot
describe.each(driveBuses)('RAID HDD storage array with an accelerator to raidz2 transition (%s)', (bus) => {
	let umbreld: TestUmbreld
	let hddIds: string[] = []
	let ssdIds: string[] = []
	let failed = false

	beforeAll(async () => {
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

	test('adds three HDDs and two NVMe SSDs and boots VM', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addHdd({slot, bus, size: '64G'})
		for (const slot of [1, 2]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		hddIds = devices.filter((device) => device.type === 'hdd').map((device) => device.id!)
		ssdIds = devices.filter((device) => device.type === 'ssd').map((device) => device.id!)
		expect(hddIds).toHaveLength(3)
		expect(ssdIds).toHaveLength(2)
	})

	test('sets up a single-HDD storage array with an accelerator (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddIds[0]], raidType: 'storage', acceleratorDevices: [ssdIds[0]]})
		await waitForRaidSetup(umbreld)
	})

	test('writes large and small files with checksums', async () => {
		// The small files are stored on the accelerator's special vdev and the large one on the HDD
		await umbreld.vm.ssh(
			'mkdir ~/small && for i in $(seq 1 10000); do head -c 48000 /dev/urandom > ~/small/$i; done && dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin ~/small/* > ~/data.sha256',
		)
	})

	test('rejects the raidz2 transition without an SSD to mirror the accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				secondNewDeviceId: hddIds[2],
				failsafeLayout: 'raidz2',
			}),
		).rejects.toThrow(
			'Transitioning to failsafe with an accelerator requires an additional SSD for the accelerator mirror',
		)
	})

	test('transitions to a raidz2 array with the two new HDDs and the new SSD', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
			newDeviceId: hddIds[1],
			secondNewDeviceId: hddIds[2],
			failsafeLayout: 'raidz2',
			acceleratorDeviceId: ssdIds[1],
		})
		await waitForTransitionToComplete(umbreld)
	})

	test('reports a raidz2 failsafe array with a mirrored accelerator', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([...hddIds].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual([...ssdIds].sort())
		expect(status.accelerator!.devices!.every((device) => device.status === 'ONLINE')).toBe(true)

		// The special vdev is mirrored across both SSDs and each has a cache partition
		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/^\s+raidz\d-\d+/gm)!.map((vdev) => vdev.trim())).toEqual(['raidz2-0'])
		expect(zpoolStatus).toMatch(/special\s+mirror-\d+/)
		expect(zpoolStatus.match(/-part3/g)).toHaveLength(2)
		expect(zpoolStatus).not.toContain('/tmp/')
		expect(zpoolStatus).not.toContain('replacing')
		expect(zpoolStatus).not.toContain('resilver in progress')
		expect(zpoolStatus).not.toContain('awaiting resilver')
	})

	test('kept the small files on the accelerator', async () => {
		// Allocated bytes of the special mirror, which holds the 480MB of small files plus metadata.
		// Without them it holds around 100MB.
		const allocated = await umbreld.vm.sshAsRoot("zpool list -Hpv | awk '$1 ~ /^mirror/ {print $3}'")
		expect(Number(allocated.trim())).toBeGreaterThan(400e6)
	})

	test('keeps the data and the accelerator through a power cycle', async () => {
		expect(await umbreld.vm.ssh('sha256sum --check --quiet ~/data.sha256 && echo all-ok')).toContain('all-ok')

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.raidzParity).toBe(2)
		expect(status.status).toBe('ONLINE')
		expect(status.accelerator?.devices).toHaveLength(2)
		expect(status.failsafeTransitionStatus).toBeUndefined()
		expect(await umbreld.vm.ssh('sha256sum --check --quiet ~/data.sha256 && echo all-ok')).toContain('all-ok')
	})
})

// SSD arrays stay raidz1, so a single-SSD storage array can't be given two new SSDs
describe('RAID SSD storage to raidz2 transition', () => {
	let umbreld: TestUmbreld
	let ssdIds: string[] = []

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	test('rejects two new SSDs and leaves the storage array as it was', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		ssdIds = devices.sort((a, b) => a.slot! - b.slot!).map((device) => device.id!)
		expect(ssdIds).toHaveLength(3)

		await umbreld.signup({raidDevices: [ssdIds[0]], raidType: 'storage'})
		await waitForRaidSetup(umbreld)

		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: ssdIds[1],
				secondNewDeviceId: ssdIds[2],
				failsafeLayout: 'raidz2',
			}),
		).rejects.toThrow('The raidz2 layout is only supported for HDD RAID arrays')

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.devices!.map((device) => device.id)).toEqual([ssdIds[0]])
		expect(status.failsafeTransitionStatus).toBeUndefined()
	})
})
