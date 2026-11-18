import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// ZFS debugging switch that stops a rebuild from making progress, so it can be held at a known point
const suspendRebuildProgress = '/sys/module/zfs/parameters/zfs_scan_suspend_progress'

// umbreld never reports a rebuild's progress going backwards, and only forgot how far a rebuild had got
// when it ended. A rebuild that ZFS restarts doesn't end, so the new pass was reported as already being
// as far along as the one it replaced.
describe('RAID rebuild progress after ZFS restarts the rebuild', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let deviceIds: string[]
	let poolName: string
	let heldProgress: number
	let failed = false

	const getRebuild = async () => (await umbreld.client.hardware.raid.getStatus.query()).rebuild

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

	test('sets up a two-SSD failsafe array with a spare SSD fitted (triggers reboot)', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		deviceIds = [1, 2, 3].map((slot) => devices.find((device) => device.slot === slot)!.id!)

		await umbreld.signup({raidDevices: [deviceIds[0], deviceIds[1]], raidType: 'failsafe'})
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
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name!
	})

	test('writes data with a checksum', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('starts replacing an SSD and holds its rebuild part way through', async () => {
		// Hold the rebuild from the start, so it can be let go for a moment at a time
		await umbreld.vm.sshAsRoot(`echo 1 > ${suspendRebuildProgress}`)
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: deviceIds[0], newDevice: deviceIds[2]})

		// Let it run until it's at least 30% done, then hold it there
		await umbreld.vm.sshAsRoot(
			[
				`echo 0 > ${suspendRebuildProgress}`,
				'tries=0',
				`until zpool status ${poolName} | grep -Eq ' [3-9][0-9]\\.[0-9]+% done'; do`,
				'	tries=$((tries + 1))',
				'	if [ "$tries" -gt 1200 ]; then echo "rebuild never seen between 30% and 99%"; exit 1; fi',
				'	sleep 0.05',
				'done',
				`echo 1 > ${suspendRebuildProgress}`,
			].join('\n'),
		)

		// umbreld has seen how far it got
		await pWaitFor(async () => ((await getRebuild())?.progress ?? 0) >= 30, {interval: 500, timeout: 60_000})
		const rebuild = await getRebuild()
		expect(rebuild!.state).toBe('rebuilding')
		heldProgress = rebuild!.progress
	})

	test('reports the restarted rebuild from the start', async () => {
		// The rebuild is still held, so the new pass hasn't done anything yet
		await umbreld.vm.sshAsRoot(`zpool resilver ${poolName} && zpool sync ${poolName}`)

		const rebuild = await getRebuild()
		expect(rebuild!.state).toBe('rebuilding')
		expect(rebuild!.progress).toBeLessThan(heldProgress)
		expect(rebuild!.progress).toBeLessThan(5)
	})

	test('finishes the replacement once the rebuild can make progress', async () => {
		await umbreld.vm.sshAsRoot(`echo 0 > ${suspendRebuildProgress}`)
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && status.rebuild?.state !== 'rebuilding' && status.devices!.length === 2
			},
			{interval: 1000, timeout: 300_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices!.map((device) => device.id).sort()).toEqual([deviceIds[1], deviceIds[2]].sort())
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})
