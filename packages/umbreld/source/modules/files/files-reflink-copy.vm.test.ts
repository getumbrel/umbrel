import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Reflink copy on ZFS', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm()
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

	test('adds NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('sets up RAID storage mode', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		const deviceId = devices[0].id!
		expect(deviceId).toBeDefined()
		await umbreld.signup({raidDevices: [deviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('copies a file using reflink (block cloning) instead of rsync', async () => {
		const testFileSizeMb = 100

		// Create a 100MB test file on the ZFS filesystem
		await umbreld.vm.ssh(`dd if=/dev/urandom of=~/umbrel/home/test-file.bin bs=1M count=${testFileSizeMb} 2>/dev/null`)
		await umbreld.vm.ssh('sync')

		// Get block clone savings before copy
		const savedBefore = Number((await umbreld.vm.ssh('zpool get -Hp -o value bclonesaved')).trim())

		// Copy the file via the API
		await umbreld.client.files.copy.mutate({
			path: '/Home/test-file.bin',
			toDirectory: '/Home',
			collision: 'keep-both',
		})
		await umbreld.vm.ssh('sync')

		// Verify the copy exists and has the correct content
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'test-file (2).bin')).toBe(true)
		const sourceHash = (await umbreld.vm.ssh('md5sum ~/umbrel/home/test-file.bin')).trim().split(/\s+/)[0]
		const copyHash = (await umbreld.vm.ssh('md5sum ~/umbrel/home/"test-file (2).bin"')).trim().split(/\s+/)[0]
		expect(copyHash).toBe(sourceHash)

		// Verify block cloning was used by checking bclonesaved increased
		// If rsync was used instead of reflink, bclonesaved would not change
		const savedAfter = Number((await umbreld.vm.ssh('zpool get -Hp -o value bclonesaved')).trim())
		const savedMb = (savedAfter - savedBefore) / (1024 * 1024)
		expect(savedMb).toBeGreaterThan(testFileSizeMb / 2)
	})
})
