import {Buffer} from 'node:buffer'
import nodePath from 'node:path'

import {expect} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {RestoreStatus} from './backups.ts'

export const externalPath = '/External/SanDisk'
export const repositoryPassword = 'test-password'
export const vmDataDirectory = '/home/umbrel/umbrel'

type TestVm = Awaited<ReturnType<typeof createTestVm>>

export async function bootWithExternalStorage(umbreld: TestVm) {
	await umbreld.vm.addUsbStorage({slot: 1, size: '64G'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
	await formatUsbStorage(umbreld)
}

export async function formatUsbStorage(umbreld: TestVm) {
	const devices = await umbreld.client.files.externalDevices.query()
	const usbDevice = devices.find((device) => device.transport === 'usb')
	expect(usbDevice).toBeDefined()

	await expect(
		umbreld.client.files.formatExternalDevice.mutate({
			deviceId: usbDevice!.id,
			filesystem: 'ext4',
			label: 'SanDisk',
		}),
	).resolves.toBe(true)

	await umbreld.vm.powerOff()
	await umbreld.vm.powerOn()
	await umbreld.login()
	await waitForExternalStorage(umbreld)
	await waitForBackupsKopiaReady(umbreld)
}

export async function waitForExternalStorage(
	umbreld: TestVm,
	{path = externalPath, authenticated = true}: {path?: string; authenticated?: boolean} = {},
) {
	const client = authenticated ? umbreld.client : umbreld.unauthenticatedClient

	await pRetry(
		async () => {
			const devices = await client.files.externalDevices.query()
			const mountpoints = devices.flatMap((device) => device.partitions.flatMap((partition) => partition.mountpoints))
			expect(mountpoints).toContain(path)
		},
		{retries: 60, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

export async function waitForBackupsKopiaReady(
	umbreld: TestVm,
	{path = `${externalPath}/Startup Probe`, authenticated = true}: {path?: string; authenticated?: boolean} = {},
) {
	const client = authenticated ? umbreld.client : umbreld.unauthenticatedClient

	await pRetry(
		async () => {
			try {
				await client.backups.connectToExistingRepository.mutate({
					path,
					password: repositoryPassword,
				})
			} catch (error) {
				if (
					error instanceof Error &&
					(error.message.includes('[backups-starting]') ||
						error.message.includes('[shutting-down]') ||
						error.message.includes('Invalid path'))
				) {
					throw error
				}
				return
			}

			throw new Error('Unexpectedly connected to startup probe repository')
		},
		// Backups starts last during umbreld startup, which can take well over a
		// minute on a loaded CI runner
		{retries: 300, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

export async function createNetworkBackupShare(umbreld: TestVm, directoryName = 'Backups') {
	await umbreld.client.files.createDirectory.mutate({path: `/Home/${directoryName}`})
	await umbreld.client.files.addShare.mutate({path: `/Home/${directoryName}`})

	const networkSharePath = await connectNetworkBackupShare(umbreld, directoryName)
	await waitForBackupsKopiaReady(umbreld, {path: `${networkSharePath}/Startup Probe`})
	return networkSharePath
}

export async function connectNetworkBackupShare(umbreld: TestVm, directoryName = 'Backups') {
	const password = await umbreld.client.files.sharePassword.query()

	return pRetry(
		() =>
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: `${directoryName} (Umbrel)`,
				username: 'umbrel',
				password,
			}),
		{retries: 10, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

export async function writeDataFile(umbreld: TestVm, relativePath: string, contents: string) {
	if (relativePath.startsWith('home/')) {
		const query = new URLSearchParams({
			path: `/Home/${relativePath.slice('home/'.length)}`,
			collision: 'replace',
		})
		await umbreld.api.post(`files/upload?${query}`, {body: contents})
		return
	}

	const encodedContents = Buffer.from(contents).toString('base64')
	const systemPath = `${vmDataDirectory}/${relativePath}`
	const directory = nodePath.posix.dirname(systemPath)

	// The files API intentionally does not expose app-data writes; seed backup
	// fixtures directly in the VM data directory so Kopia sees real files.
	await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${directory}'
printf '%s' '${encodedContents}' | base64 -d > '${systemPath}'
`)
}

export async function latestBackup(umbreld: TestVm, repositoryId: string) {
	const backups = await umbreld.client.backups.listBackups.query({repositoryId})
	const backup = backups.at(-1)
	expect(backup).toBeDefined()
	return backup!
}

export async function latestBackupFiles(umbreld: TestVm, repositoryId: string, path?: string) {
	const backup = await latestBackup(umbreld, repositoryId)
	return umbreld.client.backups.listBackupFiles.query({backupId: backup.id, path})
}

export async function expectBackupFiles(
	umbreld: TestVm,
	repositoryId: string,
	path: string | undefined,
	expectedFile: string,
) {
	await pRetry(
		async () => {
			const files = await latestBackupFiles(umbreld, repositoryId, path)
			expect(files).toContain(expectedFile)
		},
		{retries: 5, factor: 1, minTimeout: 1000, maxTimeout: 1000},
	)
}

function ignoreRestoreDisconnect(error: unknown) {
	if (!(error instanceof Error)) throw error

	const message = error.message.toLowerCase()
	const expectedDisconnect =
		message.includes('fetch failed') ||
		message.includes('terminated') ||
		message.includes('econnreset') ||
		message.includes('socket hang up') ||
		// The shared test fetch wrapper retries once after a dropped connection.
		// A successful restore revokes sessions before that retry reaches the new
		// umbreld process, so the retry can correctly receive this response.
		message.includes('invalid token') ||
		(message.includes('command was killed with sigterm') && message.includes('reboot'))
	if (!expectedDisconnect) throw error
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Timed out')), milliseconds)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

async function waitForUmbreldDisconnect(umbreld: TestVm) {
	await pWaitFor(
		async () => {
			try {
				await withTimeout(umbreld.unauthenticatedClient.user.exists.query(), 5000)
				return false
			} catch {
				return true
			}
		},
		{interval: 1000, timeout: 480_000},
	)
}

export async function restoreBackupAndWait({
	umbreld,
	backupId,
	authenticated = true,
}: {
	umbreld: TestVm
	backupId: string
	authenticated?: boolean
}) {
	const restoreClient = authenticated ? umbreld.client : umbreld.unauthenticatedClient
	let restoreSettled = false
	const restorePromise = restoreClient.backups.restoreBackup
		.mutate({backupId})
		.catch(ignoreRestoreDisconnect)
		.finally(() => {
			restoreSettled = true
		})

	const waitForDisconnectPromise = waitForUmbreldDisconnect(umbreld)

	try {
		await Promise.race([restorePromise, waitForDisconnectPromise])
		if (!restoreSettled) await restorePromise
		// The reboot command can return before HTTP drops. Always observe the
		// real VM disconnect before waiting for the restored install to start.
		await waitForDisconnectPromise
	} finally {
		void waitForDisconnectPromise.catch(() => {})
	}
	await umbreld.waitForStartup({waitForUser: true})
	await umbreld.login()
}

export function expectRestoreProgressEvents(events: RestoreStatus[], backupId: string) {
	expect(events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				backupId,
				running: true,
				progress: 0,
				error: false,
			}),
		]),
	)
	// The final {running: false, progress: 100} completion event is emitted moments
	// before the restore reboot, so its delivery over the dying connection is best
	// effort (the event bus has no replay and the fresh boot does not re-emit it).
	// Completion is instead asserted by the restore-current test via the post-reboot
	// restoreStatus query and restored file contents. The live stream is still
	// expected to report the copy reaching 100%.
	expect(events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				running: true,
				progress: 100,
				error: false,
			}),
		]),
	)
}

export async function installBackupIgnoreFixtureApp(umbreld: TestVm) {
	// Installing an arbitrary local app fixture through the store would add
	// unrelated app-store setup. Seed the minimum app metadata and restart
	// umbreld so the real apps module reloads the backupIgnore manifest.
	await umbreld.vm.sshAsRoot(`
set -eu
app_id='vm-backup-ignore'
app_dir='${vmDataDirectory}/app-data/'"$app_id"
mkdir -p "$app_dir/logs" "$app_dir/important-data"
printf 'log content' > "$app_dir/logs/app.log"
printf 'important config' > "$app_dir/important-data/config.json"
cat > "$app_dir/umbrel-app.yml" <<'YAML'
manifestVersion: 1
id: vm-backup-ignore
name: VM Backup Ignore
tagline: VM backup fixture
category: Development
version: '1.0.0'
port: 4000
description: VM backup fixture
website: https://umbrel.com
support: https://umbrel.com
gallery: []
backupIgnore:
  - logs/*
YAML
cat > "$app_dir/settings.yml" <<'YAML'
autoStart: false
YAML
cd /opt/umbreld
node --input-type=module <<'NODE'
import fs from 'node:fs'
import yaml from 'js-yaml'

const storePath = '/home/umbrel/umbrel/umbrel.yaml'
const store = yaml.load(fs.readFileSync(storePath, 'utf8')) ?? {}
store.apps = Array.from(new Set([...(store.apps ?? []), 'vm-backup-ignore']))
fs.writeFileSync(storePath, yaml.dump(store))
NODE
`)

	await umbreld.vm.sshAsRoot('systemctl restart umbrel')
	await umbreld.waitForStartup({waitForUser: true})
	await umbreld.login()
	await waitForExternalStorage(umbreld)
	await waitForBackupsKopiaReady(umbreld)
}
