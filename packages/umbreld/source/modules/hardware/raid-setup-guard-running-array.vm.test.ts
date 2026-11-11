import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// Registration is open whenever no user exists. While running from the array that can happen on
// the first boot after initial setup, before the user from onboarding has been created, or when
// creating them failed. Registering with RAID devices from there must not set up a new array and
// orphan the one the system is running from.
describe('RAID setup is rejected while running from an existing array', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let arrayDeviceId: string
	let spareDeviceId: string
	let failed = false

	const storePath = '/home/umbrel/umbrel/umbrel.yaml'
	const storeBackupPath = '/tmp/umbrel.yaml.setup-guard-backup'

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

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		arrayDeviceId = devices.find((d) => d.slot === 1)!.id!
		spareDeviceId = devices.find((d) => d.slot === 2)!.id!
	})

	test('registers user with storage RAID on the first SSD only', async () => {
		await umbreld.signup({raidDevices: [arrayDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
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
	})

	test('creates a marker directory on the array', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/setup-guard-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'setup-guard-marker')).toBe(true)
	})

	test('restarts umbreld without a user while running from the array', async () => {
		// The product gives no way to trigger a failed post-setup user creation, so remove the user from
		// the store directly to reach the same state. Keep a copy to restore afterwards.
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await umbreld.vm.sshAsRoot(`
			set -e
			cp '${storePath}' '${storeBackupPath}'
			node - <<'NODE'
const fs = require('fs')
const yaml = require('/opt/umbreld/node_modules/js-yaml')
const store = yaml.load(fs.readFileSync('${storePath}', 'utf8'))
delete store.user
fs.writeFileSync('${storePath}', yaml.dump(store))
NODE
		`)
		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup()
		expect(await umbreld.unauthenticatedClient.user.exists.query()).toBe(false)
	})

	test('rejects registering with RAID devices while running from the array', async () => {
		await expect(umbreld.signup({raidDevices: [spareDeviceId], raidType: 'storage'})).rejects.toThrow(
			'Cannot set up RAID while running from a RAID array',
		)
	})

	test('leaves the spare SSD unpartitioned', async () => {
		const blockDevices = await umbreld.vm.sshAsRoot(
			`lsblk --noheadings --raw --output TYPE /dev/disk/by-umbrel-id/${spareDeviceId}`,
		)
		expect(blockDevices.trim()).toBe('disk')
	})

	test('restores the user and logs in', async () => {
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await umbreld.vm.sshAsRoot(`cp '${storeBackupPath}' '${storePath}'`)
		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('still runs from the original array with the marker directory after a reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.status).toBe('ONLINE')
		expect(status.devices?.map((d) => d.id)).toEqual([arrayDeviceId])

		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'setup-guard-marker')).toBe(true)
	})
})
