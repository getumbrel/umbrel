import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'

const appId = 'sparkles-hello-world'
const dataDirectory = '/home/umbrel/umbrel'
const oldName = 'Satoshi from the old Umbrel'
const oldFile = '/Home/From the old Umbrel/notes.txt'
const oldFileContents = 'written on the old Umbrel'
const newFile = '/Home/Only on the new Umbrel'
// A folder holding one of every kind of file an install can hold. It sits
// beside the folders umbreld owns, so nothing touches it once it is copied.
const kinds = 'kinds-of-file'

// What a folder holds: every entry's name, kind, permissions, owner, group,
// time of last change, device numbers and link target, then every file's hash
const manifest = (directory: string) => `
cd '${directory}'
find . -mindepth 1 -print0 | sort -z | xargs -0 stat --printf '%n|%F|%a|%u|%g|%Y|%t:%T|%N\\n'
find . -type f -print0 | sort -z | xargs -0 sha256sum
`

// The disk in the VM's USB port
const usbDisk = `lsblk --nodeps --noheadings --output NAME,TRAN | awk '$2 == "usb" {print "/dev/" $1; exit}'`

describe.sequential('Migrating from another Umbrel', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false
	let oldKinds: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		gitServer = await runGitServer()
		// The drive the old Umbrel's data will be on. Migration only looks at
		// drives plugged in from outside, which in a VM means a removable one.
		await umbreld.vm.addUsbStorage({slot: 1, size: '8G', removable: true})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		try {
			await umbreld?.cleanup()
		} finally {
			await gitServer?.close()
		}
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const waitForUsbDisk = () =>
		pRetry(async () => expect(await umbreld.vm.ssh(usbDisk)).toMatch(/^\/dev\/sd[a-z]\n?$/), {
			retries: 60,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})

	const waitForApp = () =>
		pRetry(
			async () => {
				await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'ready'})
			},
			{retries: 300, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

	test('sets up the old Umbrel with a name, a file and an app', async () => {
		await umbreld.client.user.set.mutate({name: oldName})

		await umbreld.client.files.createDirectory.mutate({path: '/Home/From the old Umbrel'})
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(oldFile)}`, {body: oldFileContents})

		await umbreld.client.appStore.addRepository.mutate({url: gitServer.url.replace('localhost', '10.0.2.2')})
		await expect(umbreld.client.apps.install.mutate({appId})).resolves.toBe(true)
		await waitForApp()
	})

	test('holds one of every kind of file on the old Umbrel', async () => {
		// Apps leave files with any owner and any permissions in their data, and
		// some leave pipes and device files. There's no product path to make
		// these one by one, so use SSH.
		await umbreld.vm.sshAsRoot(`
set -eu
kinds='${dataDirectory}/${kinds}'
mkdir -p "$kinds/owned by an app" "$kinds/no access"

printf 'only root can read this' > "$kinds/only root can read"
chmod 600 "$kinds/only root can read"

printf 'app data' > "$kinds/owned by an app/database"
chown -R 999:998 "$kinds/owned by an app"
chmod 640 "$kinds/owned by an app/database"
chmod 700 "$kinds/owned by an app"

printf 'runs as its owner' > "$kinds/setuid"
chown 1000:1000 "$kinds/setuid"
chmod 4755 "$kinds/setuid"

printf 'hidden' > "$kinds/no access/file"
chmod 000 "$kinds/no access"

ln -s 'only root can read' "$kinds/link"
chown --no-dereference 999:998 "$kinds/link"
ln -s /nowhere/at/all "$kinds/dangling link"

mkfifo "$kinds/pipe"
mknod "$kinds/character device" c 1 3
mknod "$kinds/block device" b 7 99
# What Docker leaves in an image layer where a file was deleted
mknod "$kinds/whiteout" c 0 0

printf 'named' > "$kinds/ünïcödé name"
head -c 8M /dev/urandom > "$kinds/large"

printf 'old' > "$kinds/old"
touch --date '2001-02-03 04:05:06 UTC' "$kinds/old"
touch --date '2010-01-01 00:00:00 UTC' "$kinds/owned by an app"
`)
	})

	test('moves the old Umbrel onto a drive laid out as its data drive was', async () => {
		// A Raspberry Pi kept all of an install in umbrel/ on the first partition
		// of its USB drive, with a .umbrel file to mark it. umbreld is stopped
		// while its data is copied, as the Pi was shut down when the drive left it.
		oldKinds = await umbreld.vm.sshAsRoot(`
set -eu
systemctl stop umbrel.service
disk=$(${usbDisk})
sgdisk --zap-all "$disk" >/dev/null
sgdisk --new=1:0:0 "$disk" >/dev/null
udevadm settle
mkfs.ext4 -q -F "\${disk}1"
mkdir -p /mnt/old-umbrel
mount "\${disk}1" /mnt/old-umbrel
cp --archive '${dataDirectory}' /mnt/old-umbrel/umbrel
touch /mnt/old-umbrel/umbrel/.umbrel
${manifest(`/mnt/old-umbrel/umbrel/${kinds}`)}
cd /
umount /mnt/old-umbrel
`)
		// Every kind made it onto the drive
		for (const name of ['only root can read', 'setuid', 'pipe', 'character device', 'block device', 'whiteout']) {
			expect(oldKinds).toContain(`./${name}|`)
		}

		// Unplug the drive, then start again as a new Umbrel
		await umbreld.vm.disconnectUsbStorage({slot: 1})
		await umbreld.vm.sshAsRoot('systemctl start umbrel.service')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.vm.powerOff()
		await umbreld.vm.reflash()
		await umbreld.vm.powerOn()
	})

	test('reports the migration status before a user exists', async () => {
		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(false)
		await expect(umbreld.unauthenticatedClient.migration.migrationStatus.query()).resolves.toStrictEqual({
			running: false,
			progress: 0,
			description: '',
			error: false,
		})
	})

	test('sets up the new Umbrel', async () => {
		await umbreld.registerAndLogin()
		await umbreld.client.files.createDirectory.mutate({path: newFile})
		const user = await umbreld.client.user.get.query()
		expect(user.name).not.toBe(oldName)
		await expect(umbreld.client.apps.state.query({appId})).resolves.toMatchObject({state: 'not-installed'})
	})

	test('rejects migration RPCs without authentication', async () => {
		await expect(umbreld.unauthenticatedClient.migration.canMigrate.query()).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.migration.migrate.mutate()).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.migration.migrationStatus.query()).rejects.toThrow('Invalid token')
	})

	test('cannot migrate with no drive attached', async () => {
		await expect(umbreld.client.migration.canMigrate.query()).rejects.toThrow('No drive found with an umbrelOS install')
		await expect(umbreld.client.migration.migrate.mutate()).rejects.toThrow('No drive found with an umbrelOS install')
	})

	test('cannot migrate from an Umbrel newer than this one', async () => {
		await umbreld.vm.connectUsbStorage({slot: 1})
		await waitForUsbDisk()

		// No released umbrelOS is newer than the one under test, so the drive is
		// made to say it is over SSH, then put back as it was
		const setVersion = (edit: string) =>
			umbreld.vm.sshAsRoot(`
set -eu
disk=$(${usbDisk})
mkdir -p /mnt/old-umbrel
mount "\${disk}1" /mnt/old-umbrel
${edit}
umount /mnt/old-umbrel
`)
		await setVersion(`
cp --preserve /mnt/old-umbrel/umbrel/umbrel.yaml /root/old-umbrel.yaml
sed --in-place 's/^version: .*/version: 99.0.0/' /mnt/old-umbrel/umbrel/umbrel.yaml
`)
		await expect(umbreld.client.migration.canMigrate.query()).rejects.toThrow(
			/Cannot migrate umbrelOS 99\.0\.0 data into an umbrelOS .+ install/,
		)
		await setVersion('cp --preserve /root/old-umbrel.yaml /mnt/old-umbrel/umbrel/umbrel.yaml')
	})

	test('can migrate from the drive', async () => {
		await expect(umbreld.client.migration.canMigrate.query()).resolves.toBe(true)
		// Checking is not migrating
		await expect(umbreld.client.migration.migrationStatus.query()).resolves.toMatchObject({running: false})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.map((file) => file.name)).toContain('Only on the new Umbrel')
	})

	test('migrates, reporting its progress, and restarts', async () => {
		const bootId = (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim()
		await expect(umbreld.client.migration.migrate.mutate()).resolves.toBe(true)

		// Follow the migration until the restart takes umbreld away
		const statuses: Array<Awaited<ReturnType<typeof umbreld.client.migration.migrationStatus.query>>> = []
		await pWaitFor(
			async () => {
				try {
					statuses.push(await umbreld.client.migration.migrationStatus.query())
				} catch {
					return true
				}
				if (statuses.at(-1)!.error) throw new Error(`Migration failed: ${JSON.stringify(statuses.at(-1))}`)
				return false
			},
			{interval: 250, timeout: 600_000},
		)
		expect(statuses.some((status) => status.running)).toBe(true)
		// Progress only ever goes up
		const progress = statuses.filter((status) => status.running).map((status) => status.progress)
		expect(progress).toStrictEqual([...progress].sort((a, b) => a - b))

		// The device restarts into the old Umbrel's data
		await pWaitFor(
			async () => {
				try {
					return (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim() !== bootId
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('is the old Umbrel after migrating', async () => {
		// Its user
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: oldName})

		// Its files, and none of the new Umbrel's
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		const names = listing.files.map((file) => file.name)
		expect(names).toContain('From the old Umbrel')
		expect(names).not.toContain('Only on the new Umbrel')
		const downloaded = await umbreld.api.get(`files/download?path=${encodeURIComponent(oldFile)}`, {
			responseType: 'text',
		})
		expect(downloaded.body).toBe(oldFileContents)

		// Its app, running again
		const apps = await umbreld.client.apps.list.query()
		expect(apps.map((app) => app.id)).toContain(appId)
		await waitForApp()
	})

	test('keeps every kind of file exactly as it was', async () => {
		const kindsNow = await umbreld.vm.sshAsRoot(`set -eu\n${manifest(`${dataDirectory}/${kinds}`)}`)
		expect(kindsNow).toBe(oldKinds)
	})

	test('leaves nothing of the migration behind', async () => {
		const leftovers = await umbreld.vm.sshAsRoot(
			`ls -d '${dataDirectory}/import' '${dataDirectory}/.temporary-migration' '${dataDirectory}-import-temp' 2>/dev/null || true`,
		)
		expect(leftovers).toBe('')
		await expect(umbreld.client.migration.migrationStatus.query()).resolves.toMatchObject({
			running: false,
			error: false,
		})
	})
})
