import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('mdadm Linux RAID arrays', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDevice: string
	let secondDevice: string
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

	// --- Phase 1: Boot on bare hardware ---

	test('adds NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('registers user without a RAID pool', async () => {
		await umbreld.registerAndLogin()
	})

	test('detects the two internal NVMe devices', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const mdCandidates = devices.filter((device) => device.id?.startsWith('md'))
		expect(mdCandidates).toHaveLength(0)

		firstDevice = `/dev/${devices[0].device}`
		secondDevice = `/dev/${devices[1].device}`
	})

	// --- Phase 2: Create a RAID1 array, format and mount it ---

	test('mdadm is supported on the host', async () => {
		const supported = await umbreld.client.hardware.mdadm.isSupported.query()
		expect(supported).toBe(true)
	})

	test('device allocation starts at the first free /dev/mdN', async () => {
		const next = await umbreld.client.hardware.mdadm.allocateDevice.query()
		expect(next).toBe('/dev/md0')
	})

	test('creates a RAID1 array from both devices', async () => {
		const result = await umbreld.client.hardware.mdadm.create.mutate({
			level: '1',
			devices: [firstDevice, secondDevice],
			name: 'umbrel-raid',
		})
		expect(result.device).toBe('/dev/md0')
	})

	test('reports the array as a clean active RAID1 with two members', async () => {
		const status = await umbreld.client.hardware.mdadm.getStatus.query()
		expect(status.supported).toBe(true)
		expect(status.exists).toBe(true)
		expect(status.arrays).toHaveLength(1)

		const array = status.arrays[0]
		expect(array.device).toBe('/dev/md0')
		expect(array.level).toBe('1')
		expect(['clean', 'active', 'resync', 'recovering']).toContain(array.state)
		expect(array.totalDevices).toBe(2)
		expect(array.members).toHaveLength(2)
	})

	test('reports no filesystem until the array is formatted', async () => {
		const mount = await umbreld.client.hardware.mdadm.getFilesystemType.query({arrayDevice: '/dev/md0'})
		expect(mount).toBeNull()
	})

	test('formats the array as ext4 and mounts it', async () => {
		const output = await umbreld.client.hardware.mdadm.format.mutate({
			arrayDevice: '/dev/md0',
			filesystem: 'ext4',
			label: 'umbrel-raid',
		})
		expect(output).toContain('ext4')

		const mountpoint = await umbreld.client.hardware.mdadm.mount.mutate({arrayDevice: '/dev/md0'})
		expect(mountpoint).toBe('/run/mdadm/md0')
	})

	test('exposes the mounted array to Files under /Raid', async () => {
		const mounts = await umbreld.client.files.raidMounts.query()
		expect(mounts).toHaveLength(1)
		expect(mounts[0].device).toBe('/dev/md0')
		expect(mounts[0].path).toBe('/Raid/umbrel-raid')
		expect(mounts[0].filesystem).toBe('ext4')
		expect(mounts[0].native).toBe(true)
	})

	test('can write and read a file through the Files API', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Raid/umbrel-raid/persistence'})
		const listing = await umbreld.client.files.list.query({path: '/Raid/umbrel-raid'})
		expect(listing.files.some((file) => file.name === 'persistence')).toBe(true)
	})

	test('persists an fstab entry for the array', async () => {
		const fstab = await umbreld.vm.sshAsRoot('cat /etc/fstab')
		expect(fstab).toContain('/run/mdadm/md0')
		expect(fstab).toContain('ext4')
		// A missing array must never block boot
		expect(fstab).toContain('nofail')
	})

	// --- Phase 3: Data survives a full reboot ---

	test('data survives a reboot (fstab remount)', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		// The array is reassembled before umbreld starts, then remounted from fstab
		await pWaitFor(
			async () => {
				try {
					const mounts = await umbreld.client.hardware.mdadm.getMountpoint.query({arrayDevice: '/dev/md0'})
					return mounts !== null
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 120_000},
		)

		const listing = await umbreld.client.files.list.query({path: '/Raid/umbrel-raid'})
		expect(listing.files.some((file) => file.name === 'persistence')).toBe(true)
	})

	test('array stays healthy after the reboot', async () => {
		const status = await umbreld.client.hardware.mdadm.getStatus.query()
		const array = status.arrays.find((candidate) => candidate.device === '/dev/md0')
		expect(array).toBeDefined()
		expect(array!.failedDevices).toBe(0)
		expect(array!.members.every((member) => member.state === 'active' || member.state === 'sync')).toBe(true)
	})

	// --- Phase 4: Grow the array with a spare ---

	test('grow is rejected on a RAID1 array', async () => {
		await expect(
			umbreld.client.hardware.mdadm.growAddAndExpand.mutate({arrayDevice: '/dev/md0', devices: []}),
		).rejects.toThrow()
	})

	// --- Phase 5: Unmount detaches cleanly ---

	test('unmounting removes the mount and the fstab entry', async () => {
		await umbreld.client.hardware.mdadm.unmount.mutate({arrayDevice: '/dev/md0'})

		const mountpoint = await umbreld.client.hardware.mdadm.getMountpoint.query({arrayDevice: '/dev/md0'})
		expect(mountpoint).toBeNull()

		const fstab = await umbreld.vm.sshAsRoot('cat /etc/fstab')
		expect(fstab).not.toContain('/run/mdadm/md0')
	})

	test('stopping the array removes it from the inventory', async () => {
		await umbreld.client.hardware.mdadm.stop.mutate({arrayDevice: '/dev/md0'})

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.mdadm.getStatus.query()
				return status.arrays.every((array) => array.device !== '/dev/md0')
			},
			{interval: 1000, timeout: 30_000},
		)
	})
})
