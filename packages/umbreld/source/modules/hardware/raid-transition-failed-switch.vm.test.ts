import {setTimeout} from 'node:timers/promises'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {FailsafeTransitionStatus} from './raid.ts'

// Enabling FailSafe on a single SSD reboots to switch to the new pool: the boot script copies over
// everything written since the first copy, then renames the pools so the new one takes the array's
// name. If the switch can't be made the system has to boot the old pool, which still holds
// everything, and not a new pool that's missing the final copy.
//
// None of these moments can be hit from outside the VM, so each scenario puts a wrapper in front of
// zfs or zpool on the system partition that, once, fails or resets the machine in place of a chosen
// call. The marker that arms it holds the array's pool name for the wrapper to match on.
const marker = '/run/rugix/mounts/config/umbrel-test-fault'

// Runs in place of the command, once the marker exists. Removing the marker first makes it happen once.
const disarm = `mount -o remount,rw /run/rugix/mounts/config; mv "$marker" "$marker-done"; sync`
const powerCut = `${disarm}; echo 1 > /proc/sys/kernel/sysrq; echo b > /proc/sysrq-trigger; sleep infinity`

const isFirstRename = `[ "$1" = "import" ] && [ "\${@: -1}" = "$(cat "$marker")-previous-migration" ]`

type Scenario = {
	name: string
	binary: string
	condition: string
	fault: string
	// What the boot after the fault comes to:
	// - switched: on the new pool, and umbreld finishes the transition
	// - not-switched: on the old pool as a normal storage array again, with a warning, and FailSafe
	//   can be enabled again
	// - mounted: on the new pool, which is all this checks
	// - not-mounted: no pool has the array's name, so the array doesn't mount
	outcome: 'switched' | 'not-switched' | 'mounted' | 'not-mounted'
}

const scenarios: Scenario[] = [
	{
		name: 'the final sync fails',
		binary: 'zfs',
		// The receiving end of the final sync
		condition: `[ "$1" = "receive" ]`,
		fault: `${disarm}; exit 1`,
		outcome: 'not-switched',
	},
	{
		name: 'the first rename fails',
		binary: 'zpool',
		condition: isFirstRename,
		fault: `${disarm}; exit 1`,
		outcome: 'not-switched',
	},
	{
		name: 'the first rename takes effect but reports a failure',
		binary: 'zpool',
		condition: isFirstRename,
		fault: `"$0.real" "$@"; ${disarm}; exit 1`,
		// The switch stops with the old pool renamed. Both pools have to be left as they are.
		outcome: 'not-mounted',
	},
	{
		name: 'the second rename fails',
		binary: 'zpool',
		// The import that gives the new pool the array's name
		condition: `[ "$1" = "import" ] && [ "\${@: -2:1}" = "$(cat "$marker")-migration" ] && [ "\${@: -1}" = "$(cat "$marker")" ]`,
		fault: `${disarm}; exit 1`,
		// The boot script gives the old pool its name back
		outcome: 'not-switched',
	},
	{
		name: 'power is cut after the final sync, before the renames',
		binary: 'zpool',
		// The export of the old pool that follows the final sync
		condition: `[ "$1" = "export" ] && [ "$2" = "$(cat "$marker")" ]`,
		fault: powerCut,
		// umbreld never started on the old pool, so the next boot makes the switch
		outcome: 'switched',
	},
	{
		name: 'power is cut after the switch, before umbreld has removed the previous pool',
		binary: 'zpool',
		// umbreld removing the previous pool is the first thing it does after the switch
		condition: `[ "$1" = "destroy" ]`,
		fault: powerCut,
		// The boot script runs again with the pools already renamed and has to leave them alone. umbreld
		// only looks for the previous pool on the boot that renamed it, so it doesn't finish.
		outcome: 'mounted',
	},
]

describe.each(scenarios)('RAID storage to failsafe transition when $name', ({binary, condition, fault, outcome}) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let poolName: string
	let bootId: string
	let failed = false

	const getBootId = () => umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')

	// Whether a boot other than the given one, after the fault has happened, has brought the user's
	// data back or given up on the array
	async function getBootState(bootId: string) {
		try {
			const currentBootId = await getBootId()
			if (currentBootId === bootId) return 'waiting'
			await umbreld.vm.sshAsRoot(`test -f ${marker}-done`)
			if (await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()) return 'not-mounted'
			if (!(await umbreld.unauthenticatedClient.user.exists.query())) return 'waiting'
			// A power cut can land just after the fault's marker appears, so make sure this boot stays up
			await setTimeout(5000)
			return (await getBootId()) === currentBootId ? 'mounted' : 'waiting'
		} catch {
			return 'waiting'
		}
	}

	async function waitForBootAfter(bootId: string) {
		let state = 'waiting'
		await pWaitFor(
			async () => {
				// An SSH command that's in flight when the machine resets never returns, so give up on a
				// check that takes too long and try again
				state = await Promise.race([getBootState(bootId), setTimeout(30_000, 'waiting')])
				return state !== 'waiting'
			},
			{interval: 2000, timeout: 600_000},
		)
		return state
	}

	// Start the transition and return once umbreld is about to reboot into the switch
	async function startTransition() {
		const events = umbreld.subscribeToEvents<FailsafeTransitionStatus>('raid:failsafe-transition-progress')
		await events.started
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: secondDeviceId})
		await pWaitFor(() => events.collected.some((event) => event.state === 'rebooting'), {
			interval: 250,
			timeout: 600_000,
		})
		events.unsubscribe()
		bootId = await getBootId()
	}

	async function waitForFailsafe() {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus?.state === 'error') throw new Error(status.failsafeTransitionStatus.error)
				return (
					status.raidType === 'failsafe' &&
					status.status === 'ONLINE' &&
					status.devices?.length === 2 &&
					status.failsafeTransitionStatus?.state === 'complete'
				)
			},
			{interval: 1000, timeout: 600_000},
		)
		const {devices} = await umbreld.client.hardware.raid.getStatus.query()
		expect(devices!.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())
	}

	async function expectDataWrittenBeforeReboot() {
		expect(await umbreld.vm.ssh('cat ~/after-first-sync.txt')).toContain('after-first-sync')
		expect(await umbreld.vm.ssh('sha256sum --check ~/before.sha256')).toContain(': OK')
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

	test('boots with two NVMe SSDs and sets up single drive storage', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		firstDeviceId = devices.find((device) => device.slot === 1)!.id!
		secondDeviceId = devices.find((device) => device.slot === 2)!.id!

		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name!
		await umbreld.vm.ssh(
			'dd if=/dev/urandom of=~/before.bin bs=1M count=300 && sha256sum ~/before.bin > ~/before.sha256',
		)
	})

	test('puts a wrapper in front of the command that can inject the fault', async () => {
		const wrapper = `#!/bin/bash
marker=${marker}
if [ -f "$marker" ] && ${condition}; then
	${fault}
fi
exec "$0.real" "$@"
`
		await umbreld.vm.sshAsRoot(`
			set -e
			system=$(findmnt --noheadings --output SOURCE /run/rugix/mounts/system)
			blockdev --setrw $system
			mount -o remount,rw /run/rugix/mounts/system
			binary=/run/rugix/mounts/system$(readlink -f "$(command -v ${binary})")
			echo '${Buffer.from(wrapper).toString('base64')}' | base64 -d > $binary.wrapper
			chmod +x $binary.wrapper
			cp --archive $binary $binary.real
			mv $binary.wrapper $binary
			sync
		`)
	})

	test('starts the transition and arms the fault for the reboot', async () => {
		await startTransition()

		// umbreld waits 11 seconds before rebooting. Write data that only the final sync carries over
		// and arm the fault.
		await umbreld.vm.ssh('echo after-first-sync > ~/after-first-sync.txt && sync')
		await umbreld.vm.sshAsRoot(`
			set -e
			mount -o remount,rw /run/rugix/mounts/config
			echo ${poolName} > ${marker}
			sync
		`)
	})

	if (outcome === 'not-mounted') {
		test('leaves both pools as they are when the array does not mount', async () => {
			expect(await waitForBootAfter(bootId)).toBe('not-mounted')

			// umbreld still starts without the array. Give it until it has looked at the transition, then
			// make sure it hasn't touched the old pool, which the rename left imported, or the new pool.
			await pWaitFor(
				async () =>
					(await umbreld.vm.sshAsRoot('journalctl --unit umbrel --no-pager')).includes(
						'Config indicates transition in progress but the array is not mounted',
					),
				{interval: 2000, timeout: 120_000},
			)
			expect((await umbreld.vm.sshAsRoot('zpool list -H -o name')).trim().split('\n')).toEqual([
				`${poolName}-previous-migration`,
			])
			expect(await umbreld.vm.sshAsRoot('LC_ALL=C zpool import -d /dev/disk/by-umbrel-id 2>&1 || true')).toContain(
				`pool: ${poolName}-migration`,
			)
		})
		return
	}

	test('comes back up with everything written before the reboot', async () => {
		expect(await waitForBootAfter(bootId)).toBe('mounted')
		await umbreld.login()
		await expectDataWrittenBeforeReboot()
	})

	if (outcome === 'not-switched') {
		test('is a normal storage array again, with a warning', async () => {
			// umbreld works out what happened as it starts, which the API doesn't wait for
			await pWaitFor(
				async () => (await umbreld.client.hardware.raid.getStatus.query()).failsafeTransitionStatus !== undefined,
				{interval: 1000, timeout: 60_000},
			)
			const status = await umbreld.client.hardware.raid.getStatus.query()
			expect(status.failsafeTransitionStatus).toEqual({
				state: 'error',
				progress: 0,
				error: "FailSafe wasn't enabled. Your existing array is still in use. Enable FailSafe again to retry.",
			})
			expect(status.raidType).toBe('storage')
			expect(status.devices!.map((device) => device.id)).toEqual([firstDeviceId])

			// The switch won't be tried again on the next boot, and the snapshots it copied from are gone
			const state = await umbreld.vm.sshAsRoot(`yq '.raid.state' /run/rugix/mounts/config/umbrel.yaml`)
			expect(state.trim()).toBe('normal')
			const snapshots = await umbreld.vm.sshAsRoot(`zfs list -H -t snapshot -o name -r ${poolName}`)
			expect(snapshots).not.toContain('@migration')
		})

		test('enables FailSafe when asked again', async () => {
			await umbreld.vm.ssh('echo written-after-failure > ~/written-after-failure.txt && sync')
			await startTransition()
			expect(await waitForBootAfter(bootId)).toBe('mounted')
			await umbreld.login()
			await waitForFailsafe()
			await expectDataWrittenBeforeReboot()
			expect(await umbreld.vm.ssh('cat ~/written-after-failure.txt')).toContain('written-after-failure')
		})
	}

	if (outcome === 'switched') {
		test('finishes the transition with everything written before the reboot', async () => {
			await waitForFailsafe()
			await expectDataWrittenBeforeReboot()
		})
	}
})
