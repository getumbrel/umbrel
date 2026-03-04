import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {ExpansionStatus} from './raid.js'

const toGB = (bytes?: number) => (bytes != null ? `${(bytes / 1e9).toFixed(2)} GB` : 'N/A')
const logSpace = (
	label: string,
	s: {totalSpace?: number; usableSpace?: number; usedSpace?: number; freeSpace?: number},
) =>
	console.log(label, {
		totalSpace: toGB(s.totalSpace),
		usableSpace: toGB(s.usableSpace),
		usedSpace: toGB(s.usedSpace),
		freeSpace: toGB(s.freeSpace),
	})

describe('RAID failsafe space reporting consistency', () => {
	const SSD_SIZE = '4G'

	// Expected results
	let totalSpaceWith2Ssds = 8053063680
	let totalSpaceWith3Ssds = 12538871808
	let totalSpaceWith4Ssds = 16718495744
	let usableSpaceWith2Ssds = 4026531840
	let usableSpaceWith3Ssds = 8359247872
	let usableSpaceWith4Ssds = 12538871808

	// We can skip this since we've hardcoded the results for 4GB above
	// We should only run this once if we change sizes to get the computed values
	// Then comment it out again so the tests always run against fixed values.
	// Otherwise a bug in calculation logic that changes the results will pass.
	// describe('initial failsafe setup with 2 SSDs', () => {
	// 	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	// 	let failed = false

	// 	beforeAll(async () => {
	// 		umbreld = await createTestVm()
	// 	})

	// 	afterAll(async () => {
	// 		await umbreld?.cleanup()
	// 	})

	// 	afterEach(({task}) => {
	// 		if (task.result?.state === 'fail') failed = true
	// 	})

	// 	beforeEach(({skip}) => {
	// 		if (failed) skip()
	// 	})

	// 	test('adds 2 NVMe devices and boots VM', async () => {
	// 		await umbreld.vm.addNvme({slot: 1, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 2, size: SSD_SIZE})
	// 		await umbreld.vm.powerOn()
	// 	})

	// 	test('sets up failsafe RAID with 2 devices', async () => {
	// 		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
	// 		expect(devices).toHaveLength(2)
	// 		const deviceIds = devices.map((d) => d.id!)
	// 		await umbreld.signup({raidDevices: deviceIds, raidType: 'failsafe'})
	// 	})

	// 	test('waits for RAID setup and logs in', async () => {
	// 		await pWaitFor(
	// 			async () => {
	// 				try {
	// 					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
	// 				} catch (error) {
	// 					if (error instanceof Error && error.message.includes('fetch failed')) return false
	// 					throw error
	// 				}
	// 			},
	// 			{interval: 2000, timeout: 600_000},
	// 		)
	// 		await umbreld.login()
	// 	})

	// 	test('records space with 2 SSDs', async () => {
	// 		const status = await umbreld.client.hardware.raid.getStatus.query()
	// 		expect(status.exists).toBe(true)
	// 		expect(status.raidType).toBe('failsafe')
	// 		expect(status.status).toBe('ONLINE')
	// 		expect(status.devices).toHaveLength(2)
	// 		totalSpaceWith2Ssds = status.totalSpace!
	// 		usableSpaceWith2Ssds = status.usableSpace!
	// 		expect(totalSpaceWith2Ssds).toBeGreaterThan(0)
	// 		expect(usableSpaceWith2Ssds).toBeGreaterThan(0)
	// 		console.log(
	// 			`2 SSDs (initial): totalSpace=${toGB(totalSpaceWith2Ssds)}, usableSpace=${toGB(usableSpaceWith2Ssds)}`,
	// 		)
	// 	})
	// })

	// describe('initial failsafe setup with 3 SSDs', () => {
	// 	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	// 	let failed = false

	// 	beforeAll(async () => {
	// 		umbreld = await createTestVm()
	// 	})

	// 	afterAll(async () => {
	// 		await umbreld?.cleanup()
	// 	})

	// 	afterEach(({task}) => {
	// 		if (task.result?.state === 'fail') failed = true
	// 	})

	// 	beforeEach(({skip}) => {
	// 		if (failed) skip()
	// 	})

	// 	test('adds 3 NVMe devices and boots VM', async () => {
	// 		await umbreld.vm.addNvme({slot: 1, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 2, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 3, size: SSD_SIZE})
	// 		await umbreld.vm.powerOn()
	// 	})

	// 	test('sets up failsafe RAID with 3 devices', async () => {
	// 		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
	// 		expect(devices).toHaveLength(3)
	// 		const deviceIds = devices.map((d) => d.id!)
	// 		await umbreld.signup({raidDevices: deviceIds, raidType: 'failsafe'})
	// 	})

	// 	test('waits for RAID setup and logs in', async () => {
	// 		await pWaitFor(
	// 			async () => {
	// 				try {
	// 					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
	// 				} catch (error) {
	// 					if (error instanceof Error && error.message.includes('fetch failed')) return false
	// 					throw error
	// 				}
	// 			},
	// 			{interval: 2000, timeout: 600_000},
	// 		)
	// 		await umbreld.login()
	// 	})

	// 	test('records space with 3 SSDs', async () => {
	// 		const status = await umbreld.client.hardware.raid.getStatus.query()
	// 		expect(status.exists).toBe(true)
	// 		expect(status.raidType).toBe('failsafe')
	// 		expect(status.status).toBe('ONLINE')
	// 		expect(status.devices).toHaveLength(3)
	// 		totalSpaceWith3Ssds = status.totalSpace!
	// 		usableSpaceWith3Ssds = status.usableSpace!
	// 		expect(totalSpaceWith3Ssds).toBeGreaterThan(0)
	// 		expect(usableSpaceWith3Ssds).toBeGreaterThan(0)
	// 		console.log(
	// 			`3 SSDs (initial): totalSpace=${toGB(totalSpaceWith3Ssds)}, usableSpace=${toGB(usableSpaceWith3Ssds)}`,
	// 		)
	// 	})
	// })

	// describe('initial failsafe setup with 4 SSDs', () => {
	// 	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	// 	let failed = false

	// 	beforeAll(async () => {
	// 		umbreld = await createTestVm()
	// 	})

	// 	afterAll(async () => {
	// 		await umbreld?.cleanup()
	// 	})

	// 	afterEach(({task}) => {
	// 		if (task.result?.state === 'fail') failed = true
	// 	})

	// 	beforeEach(({skip}) => {
	// 		if (failed) skip()
	// 	})

	// 	test('adds 4 NVMe devices and boots VM', async () => {
	// 		await umbreld.vm.addNvme({slot: 1, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 2, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 3, size: SSD_SIZE})
	// 		await umbreld.vm.addNvme({slot: 4, size: SSD_SIZE})
	// 		await umbreld.vm.powerOn()
	// 	})

	// 	test('sets up failsafe RAID with 4 devices', async () => {
	// 		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
	// 		expect(devices).toHaveLength(4)
	// 		const deviceIds = devices.map((d) => d.id!)
	// 		await umbreld.signup({raidDevices: deviceIds, raidType: 'failsafe'})
	// 	})

	// 	test('waits for RAID setup and logs in', async () => {
	// 		await pWaitFor(
	// 			async () => {
	// 				try {
	// 					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
	// 				} catch (error) {
	// 					if (error instanceof Error && error.message.includes('fetch failed')) return false
	// 					throw error
	// 				}
	// 			},
	// 			{interval: 2000, timeout: 600_000},
	// 		)
	// 		await umbreld.login()
	// 	})

	// 	test('records space with 4 SSDs', async () => {
	// 		const status = await umbreld.client.hardware.raid.getStatus.query()
	// 		expect(status.exists).toBe(true)
	// 		expect(status.raidType).toBe('failsafe')
	// 		expect(status.status).toBe('ONLINE')
	// 		expect(status.devices).toHaveLength(4)
	// 		totalSpaceWith4Ssds = status.totalSpace!
	// 		usableSpaceWith4Ssds = status.usableSpace!
	// 		expect(totalSpaceWith4Ssds).toBeGreaterThan(0)
	// 		expect(usableSpaceWith4Ssds).toBeGreaterThan(0)
	// 		console.log(
	// 			`4 SSDs (initial): totalSpace=${toGB(totalSpaceWith4Ssds)}, usableSpace=${toGB(usableSpaceWith4Ssds)}`,
	// 		)

	// 		console.log({
	// 			totalSpaceWith2Ssds,
	// 			totalSpaceWith3Ssds,
	// 			totalSpaceWith4Ssds,
	// 			usableSpaceWith2Ssds,
	// 			usableSpaceWith3Ssds,
	// 			usableSpaceWith4Ssds,
	// 		})
	// 	})
	// })

	describe('Incremental expansion tests', () => {
		let umbreld: Awaited<ReturnType<typeof createTestVm>>
		let firstDeviceId: string
		let secondDeviceId: string
		let thirdDeviceId: string
		let fourthDeviceId: string
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

		// --- Setup: 1 SSD in storage mode ---

		test('adds 1 NVMe device and boots VM', async () => {
			await umbreld.vm.addNvme({slot: 1, size: SSD_SIZE})
			await umbreld.vm.powerOn()
		})

		test('detects NVMe device', async () => {
			const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(1)
			firstDeviceId = devices[0].id!
			expect(firstDeviceId).toBeDefined()
		})

		test('registers user with storage RAID config (triggers reboot)', async () => {
			await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
		})

		test('waits for VM to come back up and logs in', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('writes 2GB of data in storage mode', async () => {
			// Write 1GB first
			await umbreld.vm.ssh('dd if=/dev/urandom of=~/data-1ssd.bin bs=1M count=1000')
			// Check how many bytes are needed to bump total used space up to 2GB
			await umbreld.vm.ssh('sync')
			await new Promise((r) => setTimeout(r, 5000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			const targetUsed = 2_000_000_000
			const remaining = targetUsed - (status.usedSpace ?? 0)
			console.log(`After 1GB write: usedSpace=${toGB(status.usedSpace)}, remaining to 2GB=${toGB(remaining)}`)
			if (remaining > 0) {
				const remainingMiB = Math.ceil(remaining / (1024 * 1024))
				await umbreld.vm.ssh(`dd if=/dev/urandom of=~/data-1ssd-pad.bin bs=1M count=${remainingMiB}`)
			}
		})

		test('reports correct RAID status in storage mode', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('1 SSD storage mode:', status)
			expect(status.exists).toBe(true)
			expect(status.raidType).toBe('storage')
			expect(status.status).toBe('ONLINE')
			expect(status.devices).toHaveLength(1)
		})

		// --- Transition to failsafe with 2nd SSD ---

		test('shuts down and adds second NVMe device', async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.addNvme({slot: 2, size: SSD_SIZE})
			await umbreld.vm.powerOn()
		})

		test('logs in after adding second device', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('detects both NVMe devices', async () => {
			const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(2)
			secondDeviceId = devices.find((d) => d.slot === 2)!.id!
			expect(secondDeviceId).toBeDefined()
		})

		test('starts transition to failsafe mode with second device', async () => {
			const result = await umbreld.client.hardware.raid.transitionToFailsafe.mutate({device: secondDeviceId})
			expect(result).toBe(true)
		})

		test('waits for VM to come back up after transition', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('waits for transition to complete (2 devices in array)', async () => {
			let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
			await pWaitFor(
				async () => {
					try {
						status = await umbreld.client.hardware.raid.getStatus.query()
						logSpace('waiting for transition:', status)
						if (status.failsafeTransitionStatus?.state === 'error') {
							throw new Error(status.failsafeTransitionStatus.error)
						}
						if (status.failsafeTransitionStatus?.state === 'complete') return true
						if (!status.failsafeTransitionStatus && status.status === 'ONLINE' && status.devices?.length === 2)
							return true
						return false
					} catch (error) {
						if (error instanceof Error && error.message.includes('fetch failed')) return false
						throw error
					}
				},
				{interval: 2000, timeout: 600_000},
			)
		})

		test('pool is ONLINE in failsafe mode with 2 devices', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('2 SSDs failsafe mode:', status)
			expect(status.raidType).toBe('failsafe')
			expect(status.status).toBe('ONLINE')
			expect(status.devices).toHaveLength(2)
		})

		test('space with 2 SSDs is within 5% of initial 2-SSD setup', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()

			const totalDiscrepancy = Math.abs(status.totalSpace! - totalSpaceWith2Ssds) / totalSpaceWith2Ssds
			console.log(
				`totalSpace with 2 SSDs: incremental=${toGB(status.totalSpace)}, initial=${toGB(totalSpaceWith2Ssds)}, discrepancy=${(totalDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(totalDiscrepancy).toBeLessThan(0.05)

			const usableDiscrepancy = Math.abs(status.usableSpace! - usableSpaceWith2Ssds) / usableSpaceWith2Ssds
			console.log(
				`usableSpace with 2 SSDs: incremental=${toGB(status.usableSpace)}, initial=${toGB(usableSpaceWith2Ssds)}, discrepancy=${(usableDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(usableDiscrepancy).toBeLessThan(0.05)
		})

		// --- Expand to 3 SSDs ---

		test('shuts down and adds third NVMe device', async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.addNvme({slot: 3, size: SSD_SIZE})
			await umbreld.vm.powerOn()
		})

		test('logs in after adding third device', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('detects third NVMe device', async () => {
			const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(3)
			thirdDeviceId = devices.find((d) => d.slot === 3)!.id!
			expect(thirdDeviceId).toBeDefined()
		})

		test('adds third SSD to RAID array', async () => {
			const expansionSubscription = umbreld.subscribeToEvents<ExpansionStatus>('raid:expansion-progress')
			await umbreld.client.hardware.raid.addDevice.mutate({device: thirdDeviceId})

			// Wait for expansion to complete
			await pWaitFor(
				async () => {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					logSpace('waiting for 3-SSD expansion:', status)
					const events = expansionSubscription.collected
					const lastEvent = events[events.length - 1]
					return lastEvent?.state === 'finished' && lastEvent?.progress === 100
				},
				{interval: 1000, timeout: 600_000},
			)
			expansionSubscription.unsubscribe()
		})

		test('pool is ONLINE in failsafe mode with 3 devices', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('3 SSDs failsafe mode:', status)
			expect(status.raidType).toBe('failsafe')
			expect(status.status).toBe('ONLINE')
			expect(status.devices).toHaveLength(3)
		})

		test('space with 3 SSDs is within 5% of initial 3-SSD setup', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()

			const totalDiscrepancy = Math.abs(status.totalSpace! - totalSpaceWith3Ssds) / totalSpaceWith3Ssds
			console.log(
				`totalSpace with 3 SSDs: incremental=${toGB(status.totalSpace)}, initial=${toGB(totalSpaceWith3Ssds)}, discrepancy=${(totalDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(totalDiscrepancy).toBeLessThan(0.05)

			const usableDiscrepancy = Math.abs(status.usableSpace! - usableSpaceWith3Ssds) / usableSpaceWith3Ssds
			console.log(
				`usableSpace with 3 SSDs: incremental=${toGB(status.usableSpace)}, initial=${toGB(usableSpaceWith3Ssds)}, discrepancy=${(usableDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(usableDiscrepancy).toBeLessThan(0.05)
		})

		// --- Expand to 4 SSDs ---

		test('shuts down and adds fourth NVMe device', async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.addNvme({slot: 4, size: SSD_SIZE})
			await umbreld.vm.powerOn()
		})

		test('logs in after adding fourth device', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('detects fourth NVMe device', async () => {
			const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(4)
			fourthDeviceId = devices.find((d) => d.slot === 4)!.id!
			expect(fourthDeviceId).toBeDefined()
		})

		test('adds fourth SSD to RAID array', async () => {
			const expansionSubscription = umbreld.subscribeToEvents<ExpansionStatus>('raid:expansion-progress')
			await umbreld.client.hardware.raid.addDevice.mutate({device: fourthDeviceId})

			// Wait for expansion to complete
			await pWaitFor(
				async () => {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					logSpace('waiting for 4-SSD expansion:', status)
					const events = expansionSubscription.collected
					const lastEvent = events[events.length - 1]
					return lastEvent?.state === 'finished' && lastEvent?.progress === 100
				},
				{interval: 1000, timeout: 600_000},
			)
			expansionSubscription.unsubscribe()
		})

		test('pool is ONLINE in failsafe mode with 4 devices', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('4 SSDs failsafe mode:', status)
			expect(status.raidType).toBe('failsafe')
			expect(status.status).toBe('ONLINE')
			expect(status.devices).toHaveLength(4)
		})

		test('space with 4 SSDs is within 5% of initial 4-SSD setup', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()

			const totalDiscrepancy = Math.abs(status.totalSpace! - totalSpaceWith4Ssds) / totalSpaceWith4Ssds
			console.log(
				`totalSpace with 4 SSDs: incremental=${toGB(status.totalSpace)}, initial=${toGB(totalSpaceWith4Ssds)}, discrepancy=${(totalDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(totalDiscrepancy).toBeLessThan(0.05)

			const usableDiscrepancy = Math.abs(status.usableSpace! - usableSpaceWith4Ssds) / usableSpaceWith4Ssds
			console.log(
				`usableSpace with 4 SSDs: incremental=${toGB(status.usableSpace)}, initial=${toGB(usableSpaceWith4Ssds)}, discrepancy=${(usableDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(usableDiscrepancy).toBeLessThan(0.05)
		})

		// --- Replace 4th SSD with new one and check degraded state ---

		test('shuts down and removes fourth NVMe device', async () => {
			await umbreld.vm.powerOff()
			await umbreld.vm.removeNvme({slot: 4})
			await umbreld.vm.addNvme({slot: 4, size: SSD_SIZE})
			await umbreld.vm.powerOn()
		})

		test('logs in after removing fourth device', async () => {
			await umbreld.waitForStartup({waitForUser: true})
			await umbreld.login()
		})

		test('logs usage after removing 4th SSD', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('3 SSDs after removing 4th:', status)
			console.log(`RAID status: ${status.status}`)
			console.log(`RAID type: ${status.raidType}`)
			console.log(`Devices: ${status.devices?.length}`)
		})

		test('detects new 4th NVMe device', async () => {
			const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(4)
			fourthDeviceId = devices.find((d) => d.slot === 4)!.id!
			expect(fourthDeviceId).toBeDefined()
		})

		test('replaces old 4th SSD with new one', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()
			const missingDevice = status.devices!.find((d) => d.status !== 'ONLINE')
			expect(missingDevice).toBeDefined()
			console.log(`Replacing missing device ${missingDevice!.id} with new device ${fourthDeviceId}`)

			await umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: missingDevice!.id,
				newDevice: fourthDeviceId,
			})
		})

		test('waits for rebuild to complete', async () => {
			await pWaitFor(
				async () => {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					logSpace('waiting for rebuild:', status)
					return status.replace?.state === 'finished' || !status.replace
				},
				{interval: 1000, timeout: 600_000},
			)
		})

		test('logs usage after rebuild', async () => {
			await new Promise((r) => setTimeout(r, 10000))
			const status = await umbreld.client.hardware.raid.getStatus.query()
			logSpace('4 SSDs after rebuild:', status)
			console.log(`RAID status: ${status.status}`)
			console.log(`RAID type: ${status.raidType}`)
			console.log(`Devices: ${status.devices?.length}`)
			expect(status.raidType).toBe('failsafe')
			expect(status.status).toBe('ONLINE')
			expect(status.devices).toHaveLength(4)
		})

		test('space with 4 SSDs after rebuild is within 5% of initial 4-SSD setup', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()

			const totalDiscrepancy = Math.abs(status.totalSpace! - totalSpaceWith4Ssds) / totalSpaceWith4Ssds
			console.log(
				`totalSpace after rebuild: incremental=${toGB(status.totalSpace)}, initial=${toGB(totalSpaceWith4Ssds)}, discrepancy=${(totalDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(totalDiscrepancy).toBeLessThan(0.05)

			const usableDiscrepancy = Math.abs(status.usableSpace! - usableSpaceWith4Ssds) / usableSpaceWith4Ssds
			console.log(
				`usableSpace after rebuild: incremental=${toGB(status.usableSpace)}, initial=${toGB(usableSpaceWith4Ssds)}, discrepancy=${(usableDiscrepancy * 100).toFixed(2)}%`,
			)
			expect(usableDiscrepancy).toBeLessThan(0.05)
		})
	})
})
