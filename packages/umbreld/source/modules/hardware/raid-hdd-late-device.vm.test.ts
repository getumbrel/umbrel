import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// Drives behind a SAS HBA can appear after the initramfs has finished, once the controller
// has discovered them and they've spun up. udev has exited by then, so the data mount has to
// run udev itself for those drives to get their /dev/disk/by-umbrel-id links before the pool
// is imported. Otherwise a pool with every drive present imports without them.
//
// QEMU's drive bays are all present at power on, so the test puts a wrapper in front of the
// data mount script on the system partition that removes the second pool drive from the
// kernel and its link, then rescans the drive controllers a few seconds later so the kernel
// adds the drive back while the data mount is waiting for it, just like late discovery.
describe.each(driveBuses)('RAID HDD that appears after the initramfs (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
	let failed = false

	// Installs the wrapper on the system partition. With returns false the drive is removed
	// and never comes back, like a drive that's really missing.
	async function makeSecondHddLate({returns}: {returns: boolean}) {
		const wrapper = `#!/bin/bash
set -euo pipefail
exec >/run/umbrel-late-device 2>&1
link=$(yq '.raid.devices[1]' /run/rugix/mounts/config/umbrel.yaml)
disk=$(basename "$(readlink -f "$link")")
echo "Removing $disk ($link)"
echo 1 > "/sys/block/$disk/device/delete"
rm -f "$link" "$link"-part*
if [ "${returns}" = "true" ]; then
	(sleep 5; echo "Rescanning drive controllers"; for scan in /sys/class/scsi_host/host*/scan; do echo '- - -' > "$scan"; done) &
fi
exec /opt/umbrel-data/umbrel-data-mount.real "$@"
`
		await umbreld.vm.sshAsRoot(`
			set -e
			system=$(findmnt --noheadings --output SOURCE /run/rugix/mounts/system)
			blockdev --setrw $system
			mount -o remount,rw /run/rugix/mounts/system
			cd /run/rugix/mounts/system/opt/umbrel-data
			[ -f umbrel-data-mount.real ] || mv umbrel-data-mount umbrel-data-mount.real
			echo '${Buffer.from(wrapper).toString('base64')}' | base64 -d > umbrel-data-mount
			chmod +x umbrel-data-mount
			sync
		`)
	}

	async function getMountLog() {
		return umbreld.vm.sshAsRoot('cat /run/umbrel-mount')
	}

	// The udev the data mount started must have exited, leaving only systemd's
	async function expectOnlySystemdUdev() {
		const mainPid = await umbreld.vm.sshAsRoot('systemctl show --property MainPID --value systemd-udevd')
		const udevPids = await umbreld.vm.sshAsRoot('pgrep --exact systemd-udevd')
		expect(udevPids.split('\n')).toEqual([mainPid])
	}

	async function expectPoolOnline() {
		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
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

	test('boots a NAS VM with two HDD bays', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
	})

	test('creates a storage mode pool on both HDDs (triggers reboot)', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd' && device.transport === bus)
		expect(hdds).toHaveLength(2)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)

		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'storage'})
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
	})

	test("doesn't start udev at boot when every drive is already present", async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await expectPoolOnline()
		const mountLog = await getMountLog()
		expect(mountLog).toContain('All devices present')
		expect(mountLog).not.toContain('Starting udev')
	})

	test('imports the whole pool when a drive appears after the initramfs', async () => {
		await makeSecondHddLate({returns: true})
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})
		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		// The wrapper really did take the drive away and bring it back during the wait
		const lateDeviceLog = await umbreld.vm.sshAsRoot('cat /run/umbrel-late-device')
		expect(lateDeviceLog).toContain('Removing')
		expect(lateDeviceLog).toContain('Rescanning drive controllers')

		await expectPoolOnline()
		const mountLog = await getMountLog()
		expect(mountLog).toContain('Starting udev')
		expect(mountLog).toContain('All devices present')
		expect(mountLog).toContain('Stopping udev')

		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((file) => file.name === 'data-consistency-marker')).toBe(true)
	})

	test("leaves only systemd's udev running after the data mount ran its own", async () => {
		await expectOnlySystemdUdev()
	})

	test('still boots into recovery mode when the drive never appears', async () => {
		await makeSecondHddLate({returns: false})
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})

		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(true)
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices.find((device) => device.name.includes(firstHddId))?.isOk).toBe(true)
		expect(devices.find((device) => device.name.includes(secondHddId))?.isOk).toBe(false)

		const mountLog = await getMountLog()
		expect(mountLog).toContain('timeout reached after 30 seconds')
		expect(mountLog).toContain('Stopping udev')
		await expectOnlySystemdUdev()
	})
})
