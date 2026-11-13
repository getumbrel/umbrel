import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// HDD arrays are mirrors unless raidz1 is asked for. This covers what is specific to HDD raidz1
// arrays: choosing the layout, the six-drive limit, accelerators and the mirror-only endpoints.
// Everything raidz arrays share with SSDs is covered by the tests that run against raidzDrives.
describe.each(driveBuses)('RAID HDD raidz1 failsafe array (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddIds: string[] = []
	let ssdIds: string[] = []
	let failed = false

	const register = (raid: {
		raidDevices: string[]
		raidType: 'storage' | 'failsafe'
		failsafeLayout?: 'raidz1' | 'mirror'
		acceleratorDevices?: string[]
	}) => umbreld.unauthenticatedClient.user.register.mutate({name: 'satoshi', password: 'moneyprintergobrrr', ...raid})

	// ZFS scrubs the array after an expansion, and a drive can't be added until that has finished
	// A raidz1 array holds all but one drive of data, plus whatever its accelerator's special vdev holds
	const expectUsableSpaceForDrives = async (driveCount: number) => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hddSize = devices.find((device) => device.type === 'hdd')!.size
		const expected = hddSize * (driveCount - 1) + status.accelerator!.specialSize!
		expect(status.usableSpace! / expected).toBeGreaterThan(0.97)
		expect(status.usableSpace! / expected).toBeLessThan(1.03)
		expect(status.freeSpace).toBe(status.usableSpace! - status.usedSpace!)
	}

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

	test('adds seven HDDs and three NVMe SSDs and boots VM', async () => {
		// Small HDDs so the accelerator's special vdev is a visible share of the array's space
		for (const slot of [1, 2, 3, 4, 5, 6, 7]) await umbreld.vm.addHdd({slot, bus, size: '64G'})
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()
	})

	test('detects all devices with correct types', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		hddIds = devices.filter((device) => device.type === 'hdd').map((device) => device.id!)
		ssdIds = devices.filter((device) => device.type === 'ssd').map((device) => device.id!)
		expect(hddIds).toHaveLength(7)
		expect(ssdIds).toHaveLength(3)
	})

	// --- Phase 2: Setup validation ---

	test('rejects an HDD raidz1 array of more than six devices', async () => {
		await expect(register({raidDevices: hddIds, raidType: 'failsafe', failsafeLayout: 'raidz1'})).rejects.toThrow(
			'HDD raidz1 arrays are limited to 6 devices',
		)
	})

	test('rejects the mirror layout for SSDs', async () => {
		await expect(
			register({raidDevices: ssdIds.slice(0, 2), raidType: 'failsafe', failsafeLayout: 'mirror'}),
		).rejects.toThrow('The mirror layout is only supported for HDD RAID arrays')
	})

	test('still requires an even number of HDDs without the raidz1 layout', async () => {
		await expect(register({raidDevices: hddIds.slice(0, 3), raidType: 'failsafe'})).rejects.toThrow(
			'HDD failsafe mode requires an even number of devices',
		)
	})

	test('rejects an HDD raidz1 array with a single accelerator SSD', async () => {
		await expect(
			register({
				raidDevices: hddIds.slice(0, 3),
				raidType: 'failsafe',
				failsafeLayout: 'raidz1',
				acceleratorDevices: ssdIds.slice(0, 1),
			}),
		).rejects.toThrow('Failsafe mode requires exactly two SSDs for the accelerator')
	})

	// --- Phase 3: Setup ---

	test('registers user with a three-HDD raidz1 array and a mirrored accelerator (triggers reboot)', async () => {
		await umbreld.signup({
			raidDevices: hddIds.slice(0, 3),
			raidType: 'failsafe',
			failsafeLayout: 'raidz1',
			acceleratorDevices: ssdIds.slice(0, 2),
		})
	})

	test('waits for RAID setup to complete and logs in', async () => {
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
	})

	test('reports a raidz failsafe array of HDDs with its accelerator', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		expect(status.mirrors).toBeUndefined()
		expect(status.failsafeTransitionStatus).toBeUndefined()
		expect(status.devices!.map((device) => device.id).sort()).toEqual(hddIds.slice(0, 3).sort())
		expect(status.accelerator?.exists).toBe(true)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual(ssdIds.slice(0, 2).sort())
		await expectUsableSpaceForDrives(3)
	})

	test('builds the HDDs as one raidz1 vdev and only mirrors the accelerator', async () => {
		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
		expect(zpoolStatus.match(/raidz1-\d+/g)).toEqual(['raidz1-0'])
		// The only mirror is the accelerator's special vdev
		expect(zpoolStatus.match(/mirror-\d+/g)).toHaveLength(1)
		expect(zpoolStatus).toMatch(/special\s+mirror-\d+/)
	})

	// --- Phase 4: Mirror-only operations ---

	test('rejects addMirror endpoint on an HDD raidz array', async () => {
		await expect(umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddIds[3], hddIds[4]]})).rejects.toThrow(
			'addMirror is only supported for mirror failsafe mode',
		)
	})

	test('rejects both failsafe transitions on an HDD raidz array', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddIds[0], newDeviceId: hddIds[3]}],
			}),
		).rejects.toThrow('Can only transition from storage mode')
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: hddIds[3]}),
		).rejects.toThrow('Can only transition from storage mode')
	})

	test('rejects adding an SSD to an HDD raidz array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: ssdIds[2]})).rejects.toThrow(
			'Cannot mix SSDs and HDDs in the same RAID array',
		)
	})

	// --- Phase 5: Expand to the limit ---

	test('writes data with a checksum and reports it as used space', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=2000 && sha256sum ~/data.bin > ~/data.sha256')

		// 2.1GB of data, not the 3.1GB it takes up on the drives with parity. The array's own usage moves
		// by tens of MB as it settles after setup, so the data is large enough for that not to matter.
		await pWaitFor(
			async () => (await umbreld.client.hardware.raid.getStatus.query()).usedSpace! - usedSpaceBefore > 1.95e9,
			{interval: 1000, timeout: 120_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usedSpace! - usedSpaceBefore).toBeLessThan(2.3e9)
	})

	test('adds HDDs one at a time up to six devices', async () => {
		for (const deviceId of hddIds.slice(3, 6)) {
			await umbreld.client.hardware.raid.addDevice.mutate({deviceId})

			// The next HDD has to wait for this one's expansion, which takes days on real HDDs
			if (deviceId === hddIds[3]) {
				await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddIds[4]})).rejects.toThrow(
					'Cannot add a RAID device while a RAID expansion is in progress',
				)
			}
			await waitForExpansionToFinish()
		}

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.devices!.map((device) => device.id).sort()).toEqual(hddIds.slice(0, 6).sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
	})

	test('rejects a seventh HDD', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddIds[6]})).rejects.toThrow(
			'HDD raidz1 arrays are limited to 6 devices',
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(6)
	})

	test('usable space is five drives of data plus the accelerator', async () => {
		await expectUsableSpaceForDrives(6)
	})

	test('system disk usage matches the expanded array without the free space on the accelerator', async () => {
		// Only metadata and small files can be stored on the accelerator, so its free space isn't
		// counted as space for everything else
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const acceleratorFreeSpace = status.accelerator!.specialFreeSpace!
		expect(acceleratorFreeSpace / status.accelerator!.specialSize!).toBeGreaterThan(0.9)

		const expectClose = (actual: number, expected: number) => {
			expect(actual / expected).toBeGreaterThan(0.999)
			expect(actual / expected).toBeLessThan(1.001)
		}
		const diskUsage = await umbreld.client.system.systemDiskUsage.query()
		expectClose(diskUsage.size, status.usableSpace! - acceleratorFreeSpace)
		expectClose(diskUsage.available, status.freeSpace! - acceleratorFreeSpace)
		expectClose(diskUsage.totalUsed, status.usedSpace!)
		const {storageSize} = await umbreld.client.systemNg.device.getSpecs.query()
		expectClose(storageSize!, status.usableSpace! - acceleratorFreeSpace)
	})

	// --- Phase 6: Reboot and drive failure ---

	test('is still an HDD raidz failsafe array after a reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(6)
		expect(status.accelerator?.devices).toHaveLength(2)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('keeps the data available with one HDD missing', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).status === 'DEGRADED', {
			interval: 1000,
			timeout: 60_000,
		})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})

// A two-drive raidz1 array reports its space differently from a wider one, so check it also accounts
// for an accelerator, here one added after setup
describe.each(driveBuses)('RAID two-HDD raidz1 array with an accelerator added later (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
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

	test('adds two HDDs and two NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1, bus, size: '64G'})
		await umbreld.vm.addHdd({slot: 2, bus, size: '64G'})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		hddIds = devices.filter((device) => device.type === 'hdd').map((device) => device.id!)
		ssdIds = devices.filter((device) => device.type === 'ssd').map((device) => device.id!)
		expect(hddIds).toHaveLength(2)
		expect(ssdIds).toHaveLength(2)
	})

	test('sets up a two-HDD raidz1 array (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: hddIds, raidType: 'failsafe', failsafeLayout: 'raidz1'})
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

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
	})

	test('adds a mirrored accelerator and counts its space as usable', async () => {
		const usableSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usableSpace!
		await umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: ssdIds})

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.accelerator?.devices).toHaveLength(2)
		const added = status.usableSpace! - usableSpaceBefore
		expect(added / status.accelerator!.specialSize!).toBeGreaterThan(0.9)
		expect(added / status.accelerator!.specialSize!).toBeLessThan(1.1)
	})

	test('reports small files stored on the accelerator at their full size', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!

		// 480MB of files small enough to be stored on the accelerator's special vdev, which isn't raidz so
		// its usage must not be halved like the HDDs' is
		await umbreld.vm.ssh(
			'mkdir ~/small && for i in $(seq 1 10000); do head -c 48000 /dev/urandom > ~/small/$i; done && sync',
		)
		await pWaitFor(
			async () => (await umbreld.client.hardware.raid.getStatus.query()).usedSpace! - usedSpaceBefore > 440e6,
			{interval: 1000, timeout: 120_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usedSpace! - usedSpaceBefore).toBeLessThan(560e6)
	})

	test('reports large files stored on the HDDs at their size without parity', async () => {
		const usedSpaceBefore = (await umbreld.client.hardware.raid.getStatus.query()).usedSpace!
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=2000 && sync')
		await pWaitFor(
			async () => (await umbreld.client.hardware.raid.getStatus.query()).usedSpace! - usedSpaceBefore > 1.95e9,
			{interval: 1000, timeout: 120_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usedSpace! - usedSpaceBefore).toBeLessThan(2.3e9)
	})
})

// A single-HDD storage array with an accelerator becomes a raidz1 array that still has it. The new
// array is built with the new SSD as its accelerator and the existing SSD mirrors it after the reboot.
describe.each(driveBuses)('RAID HDD storage array with an accelerator to raidz transition (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
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

	test('adds two HDDs and two NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1, bus, size: '64G'})
		await umbreld.vm.addHdd({slot: 2, bus, size: '64G'})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		hddIds = devices.filter((device) => device.type === 'hdd').map((device) => device.id!)
		ssdIds = devices.filter((device) => device.type === 'ssd').map((device) => device.id!)
		expect(hddIds).toHaveLength(2)
		expect(ssdIds).toHaveLength(2)
	})

	test('sets up a single-HDD storage array with an accelerator (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddIds[0]], raidType: 'storage', acceleratorDevices: [ssdIds[0]]})
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
	})

	test('writes large and small files with checksums', async () => {
		// The small files are stored on the accelerator's special vdev and the large one on the HDD
		await umbreld.vm.ssh(
			'mkdir ~/small && for i in $(seq 1 10000); do head -c 48000 /dev/urandom > ~/small/$i; done && dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin ~/small/* > ~/data.sha256',
		)
	})

	test('rejects the raidz transition without an SSD to mirror the accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: hddIds[1]}),
		).rejects.toThrow(
			'Transitioning to failsafe with an accelerator requires an additional SSD for the accelerator mirror',
		)
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
				newDeviceId: hddIds[1],
				acceleratorDeviceId: ssdIds[0],
			}),
		).rejects.toThrow('Cannot reuse a RAID device as the accelerator mirror')

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.failsafeTransitionStatus).toBeUndefined()
	})

	test('leaves the storage array in use after losing power while syncing', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
			newDeviceId: hddIds[1],
			acceleratorDeviceId: ssdIds[1],
		})
		await pWaitFor(
			async () => {
				const {failsafeTransitionStatus} = await umbreld.client.hardware.raid.getStatus.query()
				if (failsafeTransitionStatus?.state === 'error') throw new Error(failsafeTransitionStatus.error)
				return failsafeTransitionStatus?.state === 'syncing' && failsafeTransitionStatus.progress > 0
			},
			{interval: 200, timeout: 60_000},
		)

		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.topology).toBe('stripe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id)).toEqual([hddIds[0]])
		expect(status.accelerator!.devices!.map((device) => device.id)).toEqual([ssdIds[0]])
		expect(status.failsafeTransitionStatus).toBeUndefined()
	})

	// The interrupted attempt left its snapshot and half-built array behind, which the next attempt replaces
	test('syncs to a raidz array with the new SSD as its accelerator and reboots', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({
			newDeviceId: hddIds[1],
			acceleratorDeviceId: ssdIds[1],
		})
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.failsafeTransitionStatus?.state === 'error') throw new Error(status.failsafeTransitionStatus.error)
					return status.failsafeTransitionStatus?.state === 'rebooting'
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) return true
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('rebuilds the existing HDD and accelerator SSD into the array after the reboot', async () => {
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
	})

	test('reports a raidz failsafe array with a mirrored accelerator', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([...hddIds].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual([...ssdIds].sort())
		expect(status.accelerator!.devices!.every((device) => device.status === 'ONLINE')).toBe(true)

		// The special vdev is mirrored across both SSDs and each has a cache partition
		const zpoolStatus = await umbreld.vm.sshAsRoot('zpool status -P')
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
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		expect(status.accelerator?.devices).toHaveLength(2)
		expect(status.failsafeTransitionStatus).toBeUndefined()
		expect(await umbreld.vm.ssh('sha256sum --check --quiet ~/data.sha256 && echo all-ok')).toContain('all-ok')
	})
})
