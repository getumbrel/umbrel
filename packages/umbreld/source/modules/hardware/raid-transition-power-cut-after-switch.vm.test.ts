import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

type TestVm = Awaited<ReturnType<typeof createTestVm>>

const temporaryDevice = '/tmp/umbrelos-temporary-migration-device.img'
const configPartition = '/run/rugix/mounts/config'
const devicePath = (deviceId: string) => `/dev/disk/by-umbrel-id/${deviceId}`

// After the boot script has switched to the new pool, umbreld destroys the old pool and moves its devices
// into the new one. Losing power before it got to that used to leave the array on the new pool with a
// stand-in in place of the old device for good, because the old pool is only imported on the boot that
// switches pools and the next boot couldn't find it to carry on from.
//
// That window is short, so instead of timing a power cut these tests put a finished failsafe array back
// into the state the power cut would have left: the new pool with an offline stand-in where the old device
// goes, the old pool on its devices but not imported, and a config that still describes the old storage
// array.
async function rewindToInterruptedTransition(
	umbreld: TestVm,
	{
		poolName,
		oldDeviceId,
		oldAcceleratorDeviceId,
		commands,
	}: {poolName: string; oldDeviceId: string; oldAcceleratorDeviceId?: string; commands: string[]},
) {
	const oldDataPartition = `${devicePath(oldDeviceId)}-part2`
	const acceleratorConfig = oldAcceleratorDeviceId
		? ` | .raid.accelerator.devices = ["${devicePath(oldAcceleratorDeviceId)}"]`
		: ''
	await umbreld.vm.sshAsRoot(
		[
			'set -eu',
			'systemctl stop umbrel',
			// Swap the old device for a stand-in and take the stand-in away, as the transition does
			`truncate -s $(blockdev --getsize64 ${oldDataPartition}) ${temporaryDevice}`,
			`zpool replace -f ${poolName} ${oldDataPartition} ${temporaryDevice}`,
			`zpool wait -t replace ${poolName}`,
			`zpool offline ${poolName} ${temporaryDevice}`,
			`rm ${temporaryDevice}`,
			...commands,
			// The config isn't updated until the old devices have joined the new pool
			`mount -o remount,rw ${configPartition}`,
			`yq -i '.raid.state = "transitioning-to-failsafe" | .raid.raidType = "storage" | .raid.devices = ["${devicePath(oldDeviceId)}"]${acceleratorConfig}' ${configPartition}/umbrel.yaml`,
			`mount -o remount,ro ${configPartition}`,
			'sync',
		].join('\n'),
	)

	await umbreld.vm.forcePowerOff()
	await umbreld.vm.powerOn()
	await umbreld.waitForStartup({waitForUser: true})
	await umbreld.login()
}

async function waitForTransitionToComplete(umbreld: TestVm) {
	await pWaitFor(
		async () => {
			const {failsafeTransitionStatus} = await umbreld.client.hardware.raid.getStatus.query()
			if (failsafeTransitionStatus?.state === 'error') throw new Error(failsafeTransitionStatus.error)
			return failsafeTransitionStatus?.state === 'complete'
		},
		{interval: 1000, timeout: 300_000},
	)

	// Rewinding leaves a finished rebuild in the pool's history, which can be mistaken for this one's
	// before ZFS has started it, so wait for the pool itself as well
	await pWaitFor(
		async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()
			return status.status === 'ONLINE' && status.rebuild?.state !== 'rebuilding'
		},
		{interval: 1000, timeout: 300_000},
	)
}

async function waitForRaidSetup(umbreld: TestVm) {
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

const getConfig = async (umbreld: TestVm, expression: string) =>
	(await umbreld.vm.sshAsRoot(`yq '${expression}' ${configPartition}/umbrel.yaml`)).trim()

describe('RAID failsafe transition that loses power after switching to the new pool', () => {
	let umbreld: TestVm
	let newDeviceId: string
	let oldDeviceId: string
	let poolName: string
	let failed = false

	const expectFinishedTransition = async () => {
		await waitForTransitionToComplete(umbreld)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([newDeviceId, oldDeviceId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)

		// The stand-in is gone and so is the old pool
		expect(await umbreld.vm.sshAsRoot(`zpool status -P ${poolName}`)).not.toContain(temporaryDevice)
		expect(await umbreld.vm.sshAsRoot('zpool import -d /dev/disk/by-umbrel-id 2>&1 || true')).not.toContain(
			'previous-migration',
		)

		expect(await getConfig(umbreld, '.raid.state')).toBe('normal')
		expect(await getConfig(umbreld, '.raid.raidType')).toBe('failsafe')
		expect((await getConfig(umbreld, '.raid.devices[]')).split('\n').sort()).toEqual(
			[devicePath(newDeviceId), devicePath(oldDeviceId)].sort(),
		)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	}

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

	test('sets up a two-SSD failsafe array (triggers reboot)', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		newDeviceId = devices.find((device) => device.slot === 1)!.id!
		oldDeviceId = devices.find((device) => device.slot === 2)!.id!

		await umbreld.signup({raidDevices: [newDeviceId, oldDeviceId], raidType: 'failsafe'})
		await waitForRaidSetup(umbreld)
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name!
	})

	test('writes data with a checksum', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=200 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('finishes after losing power before the old pool was destroyed', async () => {
		// The old pool is still on the old device but nothing imports it after the boot that switched pools
		await rewindToInterruptedTransition(umbreld, {
			poolName,
			oldDeviceId,
			commands: [
				`zpool create -f -o cachefile=none -m none ${poolName}-previous-migration ${devicePath(oldDeviceId)}-part2`,
				`zpool export ${poolName}-previous-migration`,
			],
		})
		await expectFinishedTransition()
	})
})

describe('RAID failsafe transition with an accelerator that loses power after switching to the new pool', () => {
	let umbreld: TestVm
	let newDeviceId: string
	let oldDeviceId: string
	let newAcceleratorDeviceId: string
	let oldAcceleratorDeviceId: string
	let poolName: string
	let failed = false

	const expectFinishedTransition = async () => {
		await waitForTransitionToComplete(umbreld)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([newDeviceId, oldDeviceId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual(
			[newAcceleratorDeviceId, oldAcceleratorDeviceId].sort(),
		)
		expect(status.accelerator!.devices!.every((device) => device.status === 'ONLINE')).toBe(true)

		// Both SSDs mirror the special vdev and both are caches, each once
		const zpoolStatus = await umbreld.vm.sshAsRoot(`zpool status -P ${poolName}`)
		expect(zpoolStatus).not.toContain(temporaryDevice)
		expect(zpoolStatus).toMatch(/special\s+mirror-\d+/)
		for (const deviceId of [newAcceleratorDeviceId, oldAcceleratorDeviceId]) {
			expect(zpoolStatus.split(`${devicePath(deviceId)}-part3`)).toHaveLength(2)
			expect(zpoolStatus.split(`${devicePath(deviceId)}-part2`)).toHaveLength(2)
		}

		expect(await getConfig(umbreld, '.raid.state')).toBe('normal')
		expect(await getConfig(umbreld, '.raid.raidType')).toBe('failsafe')
		expect((await getConfig(umbreld, '.raid.accelerator.devices[]')).split('\n').sort()).toEqual(
			[devicePath(newAcceleratorDeviceId), devicePath(oldAcceleratorDeviceId)].sort(),
		)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
		expect(await umbreld.vm.ssh('sha256sum --check --quiet ~/small-files.sha256 && echo all-match')).toContain(
			'all-match',
		)
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

	test('sets up a two-HDD raidz1 array with a mirrored accelerator (triggers reboot)', async () => {
		await umbreld.vm.addHdd({slot: 1, bus: 'sata', size: '64G'})
		await umbreld.vm.addHdd({slot: 2, bus: 'sata', size: '64G'})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		;[newDeviceId, oldDeviceId] = devices.filter((device) => device.type === 'hdd').map((device) => device.id!)
		;[newAcceleratorDeviceId, oldAcceleratorDeviceId] = devices
			.filter((device) => device.type === 'ssd')
			.map((device) => device.id!)

		await umbreld.signup({
			raidDevices: [newDeviceId, oldDeviceId],
			raidType: 'failsafe',
			failsafeLayout: 'raidz1',
			acceleratorDevices: [newAcceleratorDeviceId, oldAcceleratorDeviceId],
		})
		await waitForRaidSetup(umbreld)
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name!
	})

	test('writes large and small files with checksums', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=200 && sha256sum ~/data.bin > ~/data.sha256')
		// Small files are stored on the accelerator
		await umbreld.vm.ssh(
			'mkdir ~/small-files && for i in $(seq 500); do head -c 40000 /dev/urandom > ~/small-files/$i; done && sha256sum ~/small-files/* > ~/small-files.sha256',
		)
	})

	test('finishes after losing power before the old pool was destroyed', async () => {
		// The old pool is still on the old HDD and the old accelerator SSD
		const oldAcceleratorDevice = devicePath(oldAcceleratorDeviceId)
		await rewindToInterruptedTransition(umbreld, {
			poolName,
			oldDeviceId,
			oldAcceleratorDeviceId,
			commands: [
				`zpool detach ${poolName} ${oldAcceleratorDevice}-part3`,
				`zpool remove ${poolName} ${oldAcceleratorDevice}-part2`,
				`zpool create -f -o cachefile=none -m none ${poolName}-previous-migration ${devicePath(oldDeviceId)}-part2 special ${oldAcceleratorDevice}-part3 cache ${oldAcceleratorDevice}-part2`,
				`zpool export ${poolName}-previous-migration`,
			],
		})
		await expectFinishedTransition()
	})
})
