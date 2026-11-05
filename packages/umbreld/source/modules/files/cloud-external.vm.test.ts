import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {
	bootWithExternalStorage,
	externalPath,
	vmDataDirectory,
	waitForExternalStorage,
} from '../backups/backups.vm-test-helpers.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	createLargeVmCloudFixture,
	releaseVmCloudWebDav,
	startVmCloudWebDav,
	waitForSync,
	VM_CLOUD_FIXTURE_ROOT,
	VM_CLOUD_WEBDAV_PASSWORD,
	VM_CLOUD_WEBDAV_URL,
	VM_CLOUD_WEBDAV_USERNAME,
	writeVmCloudFixture,
} from './cloud.vm-test-helpers.ts'

const destinationPath = `${externalPath}/Cloud`
const externalSystemPath = `${vmDataDirectory}/external/SanDisk`
const destinationSystemPath = `${externalSystemPath}/Cloud`
const largeFixtureSizeMiB = 4

describe.sequential('Cloud external storage lifecycle', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let accountId: string
	let syncId: string
	let deviceId: string
	let filesystemUuid: string
	let lastSuccessfulAt = 0

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await bootWithExternalStorage(umbreld)
		await writeVmCloudFixture(umbreld, '/source/initial.txt', 'initial cloud contents')
		await startVmCloudWebDav(umbreld)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const mountedUsb = async () => {
		const devices = await umbreld.client.files.externalDevices.query()
		const device = devices.find(({transport}) => transport === 'usb')
		const partition = device?.partitions.find(({mountpoints}) => mountpoints.includes(externalPath))
		expect(device).toBeDefined()
		expect(partition).toBeDefined()
		return {device: device!, partition: partition!}
	}

	const expectNoInternalStaleContents = async () => {
		await pRetry(
			() =>
				umbreld.vm.sshAsRoot(`
set -eu
path='${externalSystemPath}'
if grep -Fq " $path " /proc/self/mountinfo; then
	echo "stale external mount remains" >&2
	exit 1
fi
if [ -d "$path" ] && find "$path" -mindepth 1 -print -quit | grep -q .; then
	echo "data exists beneath stale external mountpoint" >&2
	exit 1
fi
`),
			{retries: 60, factor: 1, minTimeout: 500, maxTimeout: 500},
		)
	}

	const waitForPartialTransfer = async () => {
		await pRetry(
			() =>
				umbreld.vm.sshAsRoot(`
set -eu
find '${destinationSystemPath}' -maxdepth 1 -type f -name 'large.bin.*.partial' -size +0c -print -quit | grep -q .
`),
			{retries: 60, factor: 1, minTimeout: 500, maxTimeout: 500},
		)
	}

	const waitForReconnectedExternalStorage = async () => {
		try {
			await waitForExternalStorage(umbreld)
		} catch (error) {
			const devices = await umbreld.client.files.externalDevices.query()
			const systemState = await umbreld.vm.sshAsRoot(`
set +e
echo '--- lsblk ---'
lsblk --output NAME,TYPE,TRAN,FSTYPE,LABEL,UUID,MOUNTPOINTS
echo '--- external mounts ---'
findmnt --real --output SOURCE,TARGET,FSTYPE,OPTIONS | grep '/External/' || true
echo '--- recent kernel storage messages ---'
dmesg | grep -E 'usb|scsi|sd |EXT4|I/O error|Buffer I/O' | tail -n 120
echo '--- recent umbreld storage logs ---'
journalctl --unit umbrel --since '-3 minutes' --no-pager | grep -E 'external|partition|mount|Cloud|cloud' | tail -n 160
`)
			throw new Error(
				`[external-storage-reconnect-timeout] ${String(error)}\nAPI devices: ${JSON.stringify(devices)}\n${systemState}`,
			)
		}
	}

	test('copies from read-only WebDAV onto a real USB filesystem', async () => {
		const mounted = await mountedUsb()
		deviceId = mounted.device.id
		filesystemUuid = mounted.partition.filesystemUuid
		expect(filesystemUuid).not.toBe('')

		const connected = await umbreld.client.files.cloud.connectWebDav.mutate({
			flavor: 'webdav',
			url: VM_CLOUD_WEBDAV_URL,
			username: VM_CLOUD_WEBDAV_USERNAME,
			password: VM_CLOUD_WEBDAV_PASSWORD,
			tlsMode: 'default',
		})
		accountId = connected.account.id
		await umbreld.client.files.createDirectory.mutate({path: destinationPath})
		const created = await umbreld.client.files.cloud.create.mutate({
			accountId,
			remote: {path: '/source'},
			destination: {path: destinationPath, filesystemUuid},
			mode: 'auto',
		})
		syncId = created.id
		const completed = await waitForSync(
			umbreld.client,
			syncId,
			(cloud) => cloud.lastSuccessfulAt !== undefined && cloud.status.state === 'idle',
			{timeout: 120_000},
		)
		lastSuccessfulAt = completed.lastSuccessfulAt!

		const listing = await umbreld.client.files.list.query({path: destinationPath})
		expect(listing.files.map(({name}) => name)).toEqual(['initial.txt'])
	})

	test('physically disconnects USB mid-transfer and safely retries on the same filesystem', async () => {
		await createLargeVmCloudFixture(umbreld, '/source/large.bin', largeFixtureSizeMiB)
		// Hold the response after rclone creates a partial so USB removal cannot race a fast CI transfer.
		await startVmCloudWebDav(umbreld, {stall: {path: '/source/large.bin', afterBytes: 128 * 1024}})
		await umbreld.client.files.cloud.run.mutate({syncId})
		await waitForSync(umbreld.client, syncId, ({status}) => status.state === 'running')
		await waitForPartialTransfer()
		// Keep rclone stalled mid-transfer, but flush the bytes already received so
		// this test exercises Cloud recovery rather than ext4 corruption.
		await umbreld.vm.sshAsRoot('sync')

		await umbreld.vm.disconnectUsbStorage({slot: 1})
		await waitForSync(umbreld.client, syncId, ({status}) => status.attention?.kind === 'destination-missing', {
			timeout: 120_000,
		})
		await expectNoInternalStaleContents()
		expect(await umbreld.vm.ssh("pgrep -af '[r]clone sync' || true")).toBe('')
		// Release the fixture only after rclone has stopped so the removed filesystem
		// is not intentionally damaged by delivering the rest of the response.
		await releaseVmCloudWebDav(umbreld)

		await umbreld.vm.connectUsbStorage({slot: 1})
		await waitForReconnectedExternalStorage()
		const reconnected = await mountedUsb()
		expect(reconnected.partition.filesystemUuid).toBe(filesystemUuid)
		const completed = await waitForSync(
			umbreld.client,
			syncId,
			(cloud) => (cloud.lastSuccessfulAt ?? 0) > lastSuccessfulAt && cloud.status.state === 'idle',
			{timeout: 180_000},
		)
		lastSuccessfulAt = completed.lastSuccessfulAt!

		const listing = await umbreld.client.files.list.query({path: destinationPath})
		expect(listing.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'initial.txt'}),
				expect.objectContaining({name: 'large.bin', size: largeFixtureSizeMiB * 1024 * 1024}),
			]),
		)
	})

	test('surfaces product eject and converges after a physical reconnect', async () => {
		await expect(umbreld.client.files.unmountExternalDevice.mutate({deviceId})).resolves.toBe(true)
		await waitForSync(umbreld.client, syncId, ({status}) => status.attention?.kind === 'destination-missing', {
			timeout: 120_000,
		})
		await expectNoInternalStaleContents()

		await writeVmCloudFixture(umbreld, '/source/after-eject.txt', 'created after product eject')
		await umbreld.vm.disconnectUsbStorage({slot: 1})
		await umbreld.vm.connectUsbStorage({slot: 1})
		await waitForExternalStorage(umbreld)
		expect((await mountedUsb()).partition.filesystemUuid).toBe(filesystemUuid)
		await umbreld.client.files.cloud.run.mutate({syncId})
		await waitForSync(
			umbreld.client,
			syncId,
			(cloud) => (cloud.lastSuccessfulAt ?? 0) > lastSuccessfulAt && cloud.status.state === 'idle',
			{timeout: 120_000},
		)

		const listing = await umbreld.client.files.list.query({path: destinationPath})
		expect(listing.files.map(({name}) => name).sort()).toEqual(['after-eject.txt', 'initial.txt', 'large.bin'])
		const sourceFiles = await umbreld.vm.ssh(
			`find '${VM_CLOUD_FIXTURE_ROOT}/source' -maxdepth 1 -type f -printf '%f\\n' | sort`,
		)
		expect(sourceFiles.trim().split('\n')).toEqual(['after-eject.txt', 'initial.txt', 'large.bin'])
	})

	test("lets the device owner remove a member's Cloud destination from shared external storage", async () => {
		const memberPassword = 'member-password'
		const member = await umbreld.client.user.createUser.mutate({name: 'Alice', password: memberPassword})
		await umbreld.client.files.addMemberShare.mutate({path: '/External', sharedWith: [member.userId]})
		await writeVmCloudFixture(umbreld, '/member-external/member.txt', 'member cloud contents')

		const memberToken = await umbreld.client.user.login.mutate({
			userId: member.userId,
			password: memberPassword,
		})
		umbreld.setAuthToken(memberToken)
		const memberAccount = await umbreld.client.files.cloud.connectWebDav.mutate({
			flavor: 'webdav',
			url: VM_CLOUD_WEBDAV_URL,
			username: VM_CLOUD_WEBDAV_USERNAME,
			password: VM_CLOUD_WEBDAV_PASSWORD,
			tlsMode: 'default',
		})
		const memberDestination = `${externalPath}/Member Cloud`
		await umbreld.client.files.createDirectory.mutate({path: memberDestination})
		const memberSync = await umbreld.client.files.cloud.create.mutate({
			accountId: memberAccount.account.id,
			remote: {path: '/member-external'},
			destination: {path: memberDestination, filesystemUuid},
			mode: 'auto',
		})
		await waitForSync(umbreld.client, memberSync.id, ({status}) => status.state === 'idle', {timeout: 120_000})

		const ownerToken = await umbreld.client.user.login.mutate({
			userId: '0',
			password: 'moneyprintergobrrr',
		})
		umbreld.setAuthToken(ownerToken)
		expect((await umbreld.client.files.cloud.syncs.query()).map(({id}) => id)).not.toContain(memberSync.id)
		await expect(umbreld.client.files.delete.mutate({path: memberDestination})).resolves.toBe(true)
		await umbreld.vm.sshAsRoot(`test ! -e '${externalSystemPath}/Member Cloud'`)

		const nextMemberToken = await umbreld.client.user.login.mutate({
			userId: member.userId,
			password: memberPassword,
		})
		umbreld.setAuthToken(nextMemberToken)
		expect((await umbreld.client.files.cloud.accounts.query()).map(({id}) => id)).toEqual([memberAccount.account.id])
		expect(await umbreld.client.files.cloud.syncs.query()).toEqual([])
		await umbreld.client.files.cloud.removeAccount.mutate({
			accountId: memberAccount.account.id,
			confirmedSyncIds: [],
		})

		const nextOwnerToken = await umbreld.client.user.login.mutate({
			userId: '0',
			password: 'moneyprintergobrrr',
		})
		umbreld.setAuthToken(nextOwnerToken)
		await umbreld.client.user.deleteUser.mutate({userId: member.userId})
	})
})
