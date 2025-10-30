import {setTimeout} from 'node:timers/promises'

import {expect, test, beforeEach, afterEach, vi} from 'vitest'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {execa} from 'execa'
import pRetry from 'p-retry'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'
import {BACKUP_RESTORE_FIRST_START_FLAG} from '../../constants.js'
import * as system from '../system/system.js'
import type {AppManifest} from '../apps/schema.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeEach(async () => {
	process.env.UMBRELD_RESTORE_SKIP_REBOOT = 'true'
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})
afterEach(async () => umbreld.cleanup())

// Create a `/Home/Backups`, directory, share it via Samba, and then mount it back
// to ourself as a network share at `/Network/localhost/Backups (Umbrel)`
async function createBackupShare(umbreld: Awaited<ReturnType<typeof createTestUmbreld>>, directoryName = 'Backups') {
	await umbreld.client.files.createDirectory.mutate({path: `/Home/${directoryName}`})
	await umbreld.client.files.addShare.mutate({path: `/Home/${directoryName}`})
	const password = await umbreld.client.files.sharePassword.query()
	// Retry cos it might take a few seconds for the share to be available
	const backupSharePath = await pRetry(
		async () =>
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: `${directoryName} (Umbrel)`,
				username: 'umbrel',
				password,
			}),
		{retries: 5, factor: 1},
	)

	return backupSharePath
}

test('createRepository() throws on system path', async () => {
	// Create a new backup repository
	await expect(
		umbreld.client.backups.createRepository.mutate({
			path: `${umbreld.instance.dataDirectory}`,
			password: 'test-password',
		}),
	).rejects.toThrow('Invalid path')
})

test('createRepository() creates and stores a repository on external storage', async () => {
	// Check we start with no repositories
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual([])

	// Create fake usb drive
	await fse.mkdir(`${umbreld.instance.dataDirectory}/external/SanDisk`, {recursive: false})

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Verify repository was stored
	const repositories = await umbreld.client.backups.getRepositories.query()
	expect(repositories).toHaveLength(1)
	expect(repositories[0]).toMatchObject({id: repositoryId})

	// Verify the repository ID follows the expected format
	expect(repositoryId).toMatch(/[a-f0-9]{8}$/)
})

test('createRepository() creates and stores a repository on network storage', async () => {
	// Check we start with no repositories
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual([])

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Verify repository was stored
	const repositories = await umbreld.client.backups.getRepositories.query()
	expect(repositories).toHaveLength(1)
	expect(repositories[0]).toMatchObject({id: repositoryId})

	// Verify the repository ID follows the expected format
	expect(repositoryId).toMatch(/[a-f0-9]{8}$/)
})

test('getRepositories() returns repositories with lastBackup date', async () => {
	// Check we start with no repositories
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual([])

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Check we have a repository with no lastBackup date
	const repositories = await umbreld.client.backups.getRepositories.query()
	expect(repositories).toMatchObject([
		expect.objectContaining({
			id: expect.stringMatching(/[a-f0-9]{8}$/),
			path: `${backupNetworkSharePath}/Umbrel Backup.backup`,
		}),
	])
	expect(repositories[0].lastBackup).toBeUndefined()

	// Do a backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Check we have a repository with a lastBackup date
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toMatchObject([
		expect.objectContaining({
			id: expect.stringMatching(/[a-f0-9]{8}$/),
			path: `${backupNetworkSharePath}/Umbrel Backup.backup`,
			lastBackup: expect.any(Number),
		}),
	])
})

test('forgetRepository() forgets a repository', async () => {
	// Check we start with no repositories
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual([])

	// Create fake usb drive
	await fse.mkdir(`${umbreld.instance.dataDirectory}/external/SanDisk`, {recursive: false})

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Verify repository was stored
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toHaveLength(1)

	// Forget the repository
	await umbreld.client.backups.forgetRepository.mutate({repositoryId})

	// Verify repository was forgotten
	await expect(umbreld.client.backups.getRepositories.query()).resolves.toHaveLength(0)
})

test('backup() creates a backup successfully', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Check we have no backups
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(0)

	// Do the backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup was created by listing backups
	const backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(1)
	expect(backups[0]).toMatchObject({
		id: expect.stringMatching(`^${repositoryId}:`),
		time: expect.any(Number),
		size: expect.any(Number),
	})

	// Verify it includes expected backup files
	const files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[0].id})
	expect(files).toContain('umbrel.yaml')
	expect(files).toContain('app-data')
	expect(files).toContain('home')
	expect(files).toContain('secrets')
	expect(files).toContain('trash')

	// Verify it excludes files we want to ignore
	expect(files).not.toContain('app-stores')
	expect(files).not.toContain('external')
	expect(files).not.toContain('network')
	expect(files).not.toContain('thumbnails')
})

test('backup() throws error for non-existent repository', async () => {
	await expect(umbreld.client.backups.backup.mutate({repositoryId: 'non-existent-repo'})).rejects.toThrow(
		'Repository non-existent-repo not found',
	)
})

test('listBackups() throws error for non-existent repository', async () => {
	await expect(umbreld.client.backups.listBackups.query({repositoryId: 'non-existent-repo'})).rejects.toThrow(
		'Repository non-existent-repo not found',
	)
})

test('createRepository() prevents duplicate repositories in store', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Create same repository again
	await expect(
		umbreld.client.backups.createRepository.mutate({
			path: backupNetworkSharePath,
			password: 'test-password',
		}),
	).rejects.toThrow('Repository already exists')
})

test('multiple backups create separate snapshots', async () => {
	// Create test data
	const testDataPath = `${umbreld.instance.dataDirectory}/home/multi-backup-test.txt`
	await fse.mkdir(`${umbreld.instance.dataDirectory}/home`, {recursive: true})
	await fse.writeFile(testDataPath, 'initial content')

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Create first backup
	await umbreld.client.backups.backup.mutate({repositoryId})
	const firstBackups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(firstBackups).toHaveLength(1)

	// Wait a bit and modify data
	await setTimeout(1000)
	await fse.writeFile(testDataPath, 'modified content')

	// Create second backup
	await umbreld.client.backups.backup.mutate({repositoryId})
	const secondBackups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(secondBackups).toHaveLength(2)

	// Verify backups have different IDs and times
	expect(secondBackups[0].id).not.toBe(secondBackups[1].id)
	expect(secondBackups[0].time).not.toBe(secondBackups[1].time)
})

test('mountBackup() mounts and unmountBackup() unmounts a backup', async () => {
	// Create test data in home and app-data directories to match expected structure
	const homeTestPath = `${umbreld.instance.dataDirectory}/home/test-home-file.txt`
	const appDataTestPath = `${umbreld.instance.dataDirectory}/app-data/test-app-file.txt`

	await fse.writeFile(homeTestPath, 'home test content')
	await fse.writeFile(appDataTestPath, 'app data test content')

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Get the backup to mount
	const backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(1)
	const backup = backups[0]

	// Test mountBackup - this should list contents and attempt to mount
	await umbreld.client.backups.mountBackup.mutate({backupId: backup.id})

	await setTimeout(1000)

	// Verify that the backup root directory structure was created
	const {backupRoot} = umbreld.instance.backups
	expect(await fse.pathExists(backupRoot)).toBe(true)

	// // The specific dated directory should exist
	const dateDirs = await fse.readdir(backupRoot)
	expect(dateDirs).toHaveLength(1)
	expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

	// The created files exist at the expected paths
	const backupHomeTestPath = `${backupRoot}/${dateDirs[0]}/Home/test-home-file.txt`
	expect(await fse.pathExists(backupHomeTestPath)).toBe(true)

	const backupAppDataTestPath = `${backupRoot}/${dateDirs[0]}/Apps/test-app-file.txt`
	expect(await fse.pathExists(backupAppDataTestPath)).toBe(true)

	// Test we can unmount the backup
	expect(fse.pathExists(`${backupRoot}/${dateDirs[0]}`)).resolves.toBe(true)
	await umbreld.client.backups.unmountBackup.mutate({directoryName: dateDirs[0]})
	expect(fse.pathExists(`${backupRoot}/${dateDirs[0]}`)).resolves.toBe(false)
})

test('listAllBackups() returns backups from all repositories', async () => {
	// Create two test repositories
	const repositoryId1 = await umbreld.client.backups.createRepository.mutate({
		path: await createBackupShare(umbreld),
		password: 'test-password',
	})
	const repositoryId2 = await umbreld.client.backups.createRepository.mutate({
		path: await createBackupShare(umbreld, 'Backups 2'),
		password: 'test-password',
	})

	// Create a backup in the first repository
	await umbreld.client.backups.backup.mutate({repositoryId: repositoryId1})

	// Create a backup in the second repository
	await umbreld.client.backups.backup.mutate({repositoryId: repositoryId2})

	// Create another backup in the first repository
	await umbreld.client.backups.backup.mutate({repositoryId: repositoryId1})

	// Test listAllBackups
	const allBackups = await umbreld.client.backups.listAllBackups.query()
	expect(allBackups).toHaveLength(3)

	// Verify backups from both repositories are included
	const repo1Backups = allBackups.filter((backup) => backup.id.startsWith(`${repositoryId1}:`))
	const repo2Backups = allBackups.filter((backup) => backup.id.startsWith(`${repositoryId2}:`))
	expect(repo1Backups).toHaveLength(2)
	expect(repo2Backups).toHaveLength(1)

	// Verify backups are in the expected order
	expect(allBackups).toEqual([
		expect.objectContaining({id: expect.stringMatching(`^${repositoryId1}:`)}),
		expect.objectContaining({id: expect.stringMatching(`^${repositoryId2}:`)}),
		expect.objectContaining({id: expect.stringMatching(`^${repositoryId1}:`)}),
	])
})

test('backup() reports progress during backup operation', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Create 5MB file
	const sourceDirectory = `${umbreld.instance.dataDirectory}/home/orig`
	await fse.mkdir(sourceDirectory, {recursive: true})
	const largeFile = `${sourceDirectory}/5MB.bin`
	await fse.writeFile(largeFile, Buffer.alloc(5 * 1024 * 1024))

	// Throttle backup speed to make it slow enough to report progress events
	const destinationDirectory = `${umbreld.instance.dataDirectory}/home/slow`
	await fse.mkdir(destinationDirectory, {recursive: true})
	await execa('bindfs', ['--read-rate=1000k', '--write-rate=1000k', sourceDirectory, destinationDirectory])

	// Listen for backup progress events
	const progressEvents: any[] = []
	const removeListener = umbreld.instance.eventBus.on(
		'backups:backup-progress',
		(progress) => void progressEvents.push(JSON.parse(JSON.stringify(progress))),
	)

	// Test we start with no backups in progress
	await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])

	// Do the backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Test we end with no backups in progress
	await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])

	// Verify we received progress events
	// The first and last events are the setup and teardown
	// Inbetween events are from parsinc the process output
	expect(progressEvents.at(0)).toMatchObject([{repositoryId, percent: 0}])
	expect(progressEvents.at(-2)).toMatchObject([{repositoryId, percent: expect.any(Number)}])
	expect(progressEvents.at(-1)).toMatchObject([])

	// Clean up
	removeListener()
	await execa('umount', [destinationDirectory])
})

test('backupOnInterval() backs up in the background on an interval', async () => {
	// Set frequent backup interval and restart umbreld
	umbreld.instance.backups.backupInterval = 100 // 100ms
	await umbreld.instance.stop()
	await umbreld.instance.start()

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Do no explicit backups, just wait until we have at least 3 backups
	// to verify the background job is working
	await pRetry(
		async () => {
			const backups = await umbreld.client.backups.listBackups.query({repositoryId})
			expect(backups.length).toBeGreaterThanOrEqual(3)
		},
		{retries: 10, factor: 1},
	)
})

test('backups respect user ignored paths', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Check we have no backups
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(0)

	// Do the backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup was created and includes /Home
	let backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(1)
	let files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[0].id})
	expect(files).toContain('home')

	// Check /Home is not listed as ignored
	await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.not.toContain('/Home')

	// Ignore /Home
	await expect(umbreld.client.backups.addIgnoredPath.mutate({path: '/Home'})).resolves.toBe(true)

	// Check /Home is listed as ignored
	await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.toContain('/Home')

	// Check ignoring non home path throws
	await expect(umbreld.client.backups.addIgnoredPath.mutate({path: '/App/foo'})).rejects.toThrow(
		'Path to exclude must be in /Home',
	)

	// Do another backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup was created and doesn't include /Home
	backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(2)
	files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[1].id})
	expect(files).not.toContain('home')

	// Remove ignored path
	await expect(umbreld.client.backups.removeIgnoredPath.mutate({path: '/Home'})).resolves.toBe(true)

	// Check /Home is no longer listed as ignored
	await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.not.toContain('/Home')

	// Check removing non home path throws
	await expect(umbreld.client.backups.removeIgnoredPath.mutate({path: '/External'})).rejects.toThrow(
		'Path to exclude must be in /Home',
	)

	// Do another backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup includes /Home again
	backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(3)
	files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[2].id})
	expect(files).toContain('home')
})

test('backups respect app backupIgnore glob patterns', async () => {
	// Install app
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	// Create files in the app's data directory
	const appDataDir = `${umbreld.instance.dataDirectory}/app-data/sparkles-hello-world`
	await fse.mkdir(`${appDataDir}/logs`, {recursive: true})
	await fse.mkdir(`${appDataDir}/important-data`, {recursive: true})
	await fse.writeFile(`${appDataDir}/logs/app.log`, 'log content')
	await fse.writeFile(`${appDataDir}/important-data/config.json`, 'important config')

	// Modify the app's manifest to include a logs/* glob pattern for backupIgnore
	const manifestPath = `${appDataDir}/umbrel-app.yml`
	const manifest = yaml.load(await fse.readFile(manifestPath, 'utf8')) as AppManifest
	manifest.backupIgnore = ['logs/*']
	await fse.writeFile(manifestPath, yaml.dump(manifest))

	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Do the backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup was created and includes app-data
	let backups = await umbreld.client.backups.listBackups.query({repositoryId})
	expect(backups).toHaveLength(1)
	let files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[0].id})
	expect(files).toContain('app-data')

	// Verify logs directory exists but its contents are ignored by the glob
	const appDirFiles = await umbreld.client.backups.listBackupFiles.query({
		backupId: backups[0].id,
		path: '/app-data/sparkles-hello-world',
	})
	expect(appDirFiles).toContain('logs')
	expect(appDirFiles).toContain('important-data')

	const logsDirFiles = await umbreld.client.backups.listBackupFiles.query({
		backupId: backups[0].id,
		path: '/app-data/sparkles-hello-world/logs',
	})
	expect(logsDirFiles).not.toContain('app.log')

	// Verify that non-globbed files are included in the backup
	const importantDirFiles = await umbreld.client.backups.listBackupFiles.query({
		backupId: backups[0].id,
		path: '/app-data/sparkles-hello-world/important-data',
	})
	expect(importantDirFiles).toContain('config.json')
})

test('backups handle disconnected network shares gracefully', async () => {
	// Set the share watch interval to 100ms and restart umbreld
	umbreld.instance.files.networkStorage.shareWatchInterval = 100
	await umbreld.instance.stop()
	await umbreld.instance.start()

	// Create a network share and mount it
	const mountPath = await createBackupShare(umbreld)

	// Verify the share is mounted and accessible
	await umbreld.client.files.list.query({path: mountPath})

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: mountPath,
		password: 'test-password',
	})

	// Check we have no backups
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(0)

	// Do the backup
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)

	// Verify backup was created
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)

	// Remove the share
	await umbreld.client.files.removeShare.mutate({path: '/Home/Backups'})

	// Verify the share is no longer mounted
	// TODO: For some reason if we remove this line the test fails, look into why
	await expect(umbreld.client.files.list.query({path: mountPath})).rejects.toThrow('EHOSTDOWN')

	// Attempt another backup that fails
	await expect(umbreld.client.backups.backup.mutate({repositoryId})).rejects.toThrow('host is down')

	// Add the share again
	await umbreld.client.files.addShare.mutate({path: '/Home/Backups'})

	// Attempt another backup
	await pRetry(() => expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true), {
		retries: 5,
		factor: 1,
	})

	// Verify a second backup was created
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(2)
})

test('getRepositorySize() returns the size of a repository', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Get the size of the repository
	// Check used is 0 because we haven't done a backup yet
	await expect(umbreld.client.backups.getRepositorySize.query({repositoryId})).resolves.toMatchObject({
		used: 0,
		capacity: expect.any(Number),
		available: expect.any(Number),
	})

	// Do a backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Get the size of the repository
	// Check used is greater than 0 because we've done a backup
	await expect(umbreld.client.backups.getRepositorySize.query({repositoryId})).resolves.toMatchObject({
		used: {asymmetricMatch: (v: unknown) => typeof v === 'number' && v > 0},
		capacity: expect.any(Number),
		available: expect.any(Number),
	})
})

test('backups sets user notification if backups have not run in over 24 hours', async () => {
	// Create a network share and mount it
	const backupNetworkSharePath = await createBackupShare(umbreld)

	// Create a new backup repository
	await umbreld.client.backups.createRepository.mutate({
		path: backupNetworkSharePath,
		password: 'test-password',
	})

	// Verify we have no notifications
	await expect(umbreld.client.notifications.get.query()).resolves.toHaveLength(0)

	// Disconnect the network share so the next backup fails
	await umbreld.client.files.removeShare.mutate({path: '/Home/Backups'})

	// Verify the share is no longer mounted
	// TODO: For some reason if we remove this line the test fails, look into why
	await expect(umbreld.client.files.list.query({path: backupNetworkSharePath})).rejects.toThrow('EHOSTDOWN')

	// Set frequent backup interval
	umbreld.instance.backups.backupInterval = 100 // 100ms

	// Wait for some backup attempts
	await setTimeout(30000)

	// Verify we still have no notifications
	// (we shouldn't have a notification unless 24 hours has passed)
	await expect(umbreld.client.notifications.get.query()).resolves.toHaveLength(0)

	// Mock time 24 hours in the future to trigger the notification
	const now = Date.now()
	const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
	const viNow = vi.spyOn(Date, 'now').mockImplementation(() => now + TWENTY_FOUR_HOURS)

	// Verify we have a notification
	await pRetry(
		() =>
			expect(umbreld.client.notifications.get.query()).resolves.toMatchObject([
				expect.stringMatching(/^backups-failing:/),
			]),
		{
			retries: 30,
			factor: 1,
		},
	)

	// Add the share again so backups can complete again
	await umbreld.client.files.addShare.mutate({path: '/Home/Backups'})

	// Wait for the notification to be removed
	await pRetry(() => expect(umbreld.client.notifications.get.query()).resolves.toHaveLength(0), {
		retries: 65,
		factor: 1,
	})

	// Unmock time
	viNow.mockRestore()

	// Stop excessive backups
	umbreld.instance.backups.backupInterval = 1000000
})

test('backup can be restored on the current Umbrel install', async () => {
	// Create a file to mark the installation
	await umbreld.client.files.createDirectory.mutate({path: '/Home/original-umbrel'})

	// Create fake usb drive
	await fse.mkdir(`${umbreld.instance.dataDirectory}/external/SanDisk`, {recursive: false})

	// Create a new backup repository on the fake usb drive
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Do a backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Nuke the marker file
	await umbreld.client.files.trash.mutate({path: '/Home/original-umbrel'})

	// Check the backup was created
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)

	// Listen for restore progress events
	const restoreProgressEvents: any[] = []
	const removeListener = umbreld.instance.eventBus.on(
		'backups:restore-progress',
		(progress) => void restoreProgressEvents.push(JSON.parse(JSON.stringify(progress))),
	)

	// Get the latest backup and restore it
	const backups = await umbreld.client.backups.listBackups.query({repositoryId})
	const latestBackup = backups.at(-1)!
	expect(latestBackup).toBeDefined()

	// Simulate insufficient free space and assert restore fails
	// We need to have enough free space for the backup + a 5GB buffer.
	// We simulate a 10GB disk with 4GB available which should fail.
	const ONE_GB = 1024 * 1024 * 1024
	const getSystemDiskUsageSpy = vi.spyOn(system, 'getSystemDiskUsage').mockResolvedValue({
		size: ONE_GB * 10,
		totalUsed: ONE_GB * 6,
		available: ONE_GB * 4,
	})
	await expect(umbreld.client.backups.restoreBackup.mutate({backupId: latestBackup.id})).rejects.toThrow(
		'[not-enough-space]',
	)
	getSystemDiskUsageSpy.mockRestore()

	// Now restore should succeed with normal disk usage
	await umbreld.client.backups.restoreBackup.mutate({backupId: latestBackup.id})

	// After restore (no reboot in tests), the restore marker should exist under /import
	const importFlagPath = `${umbreld.instance.dataDirectory}/import/${BACKUP_RESTORE_FIRST_START_FLAG}`
	expect(await fse.pathExists(importFlagPath)).toBe(true)

	// Verify we received progress events
	expect(restoreProgressEvents.at(0)).toMatchObject({backupId: latestBackup.id, progress: 0, running: true})
	expect(restoreProgressEvents.at(-2)).toMatchObject({
		backupId: latestBackup.id,
		progress: expect.any(Number),
		bytesPerSecond: expect.any(Number),
		running: true,
	})
	expect(restoreProgressEvents.at(-1)).toMatchObject({running: false, progress: 100, error: false})

	// Verify current progress is not running (final status is 100% after success)
	await expect(umbreld.client.backups.restoreStatus.query()).resolves.toMatchObject({
		running: false,
		progress: 100,
		error: false,
	})

	// Check we have no marker file
	expect(await fse.pathExists(`${umbreld.instance.dataDirectory}/home/original-umbrel`)).toBe(false)

	// Stop and start to simulate a reboot
	await umbreld.instance.stop()
	await umbreld.instance.start()

	// Check we now have the marker file
	expect(await fse.pathExists(`${umbreld.instance.dataDirectory}/home/original-umbrel`)).toBe(true)

	// Destroy the new umbrel instance
	removeListener()
})

test('backup can be restored on a fresh umbrel during setup', async () => {
	// Create a file to mark the installation
	await umbreld.client.files.createDirectory.mutate({path: '/Home/original-umbrel'})

	// Create fake usb drive
	await fse.mkdir(`${umbreld.instance.dataDirectory}/external/SanDisk`, {recursive: false})

	// Create a new backup repository on the fake usb drive
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Do a backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Check the backup was created
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)

	// Create a new umbrel instance
	const newUmbreld = await createTestUmbreld({autoLogin: false, autoStart: true})

	// Simulate connecting the previous usb drive to it
	await fse.move(
		`${umbreld.instance.dataDirectory}/external/SanDisk`,
		`${newUmbreld.instance.dataDirectory}/external/SanDisk`,
	)

	// Connect to the USB backup repository
	const newRepositoryId = await newUmbreld.client.backups.connectToExistingRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Listen for restore progress events
	const restoreProgressEvents: any[] = []
	const removeListener = newUmbreld.instance.eventBus.on(
		'backups:restore-progress',
		(progress) => void restoreProgressEvents.push(JSON.parse(JSON.stringify(progress))),
	)

	// Get the latest backup and restore it
	const backups = await newUmbreld.client.backups.listBackups.query({repositoryId: newRepositoryId})
	const latestBackup = backups.at(-1)!
	expect(latestBackup).toBeDefined()
	await newUmbreld.client.backups.restoreBackup.mutate({backupId: latestBackup.id})

	// After restore (no reboot in tests), the restore marker should exist under /import
	const newImportFlagPath = `${newUmbreld.instance.dataDirectory}/import/${BACKUP_RESTORE_FIRST_START_FLAG}`
	expect(await fse.pathExists(newImportFlagPath)).toBe(true)

	// Verify we received progress events
	expect(restoreProgressEvents.at(0)).toMatchObject({backupId: latestBackup.id, progress: 0, running: true})
	expect(restoreProgressEvents.at(-2)).toMatchObject({
		backupId: latestBackup.id,
		progress: expect.any(Number),
		bytesPerSecond: expect.any(Number),
		running: true,
	})
	expect(restoreProgressEvents.at(-1)).toMatchObject({running: false, progress: 100, error: false})

	// Verify current progress is not running (final status is 100% after success)
	await expect(newUmbreld.client.backups.restoreStatus.query()).resolves.toMatchObject({
		running: false,
		progress: 100,
		error: false,
	})

	// Check we have no user and no marker file
	await expect(newUmbreld.client.user.exists.query()).resolves.toBe(false)
	expect(await fse.pathExists(`${newUmbreld.instance.dataDirectory}/home/original-umbrel`)).toBe(false)

	// Stop and start to simulate a reboot
	await newUmbreld.instance.stop()
	await newUmbreld.instance.start()

	// Check we now have a user and the marker file from the previous installation
	await expect(newUmbreld.client.user.exists.query()).resolves.toBe(true)
	expect(await fse.pathExists(`${newUmbreld.instance.dataDirectory}/home/original-umbrel`)).toBe(true)

	// Destroy the new umbrel instance
	removeListener()
	await newUmbreld.cleanup()
})

test('connectToExistingRepository() cleans up failed connection details', async () => {
	// Create fake usb drive
	await fse.mkdir(`${umbreld.instance.dataDirectory}/external/SanDisk`, {recursive: false})

	// Create a new backup repository on the fake usb drive
	const repositoryId = await umbreld.client.backups.createRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Do a backup
	await umbreld.client.backups.backup.mutate({repositoryId})

	// Check the backup was created
	await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)

	// Create a new umbrel instance
	const newUmbreld = await createTestUmbreld({autoLogin: false, autoStart: true})

	// Simulate connecting the previous usb drive to it
	await fse.move(
		`${umbreld.instance.dataDirectory}/external/SanDisk`,
		`${newUmbreld.instance.dataDirectory}/external/SanDisk`,
	)

	// Connect to the USB backup repository with a bad passsword
	await expect(
		newUmbreld.client.backups.connectToExistingRepository.mutate({
			path: `/External/SanDisk`,
			password: 'incorrect-password',
		}),
	).rejects.toThrow('invalid repository password')

	// Connect to the USB backup repository with a good password
	const newRepositoryId = await newUmbreld.client.backups.connectToExistingRepository.mutate({
		path: `/External/SanDisk`,
		password: 'test-password',
	})

	// Check list succeeds and doesn't throw with the incorrect password
	await newUmbreld.client.backups.listBackups.query({repositoryId: newRepositoryId})

	// Destroy the new umbrel instance
	await newUmbreld.cleanup()
})

// Auth error tests
test('getRepositories() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.getRepositories.query()).rejects.toThrow('Invalid token')
})

test('getRepositorySize() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.backups.getRepositorySize.query({repositoryId: 'test-repo'}),
	).rejects.toThrow('Invalid token')
})

test('createRepository() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.backups.createRepository.mutate({
			path: '/Network/test',
			password: 'test-password',
		}),
	).rejects.toThrow('Invalid token')
})

test('backup() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.backup.mutate({repositoryId: 'test-repo'})).rejects.toThrow(
		'Invalid token',
	)
})

test('listBackups() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.listBackups.query({repositoryId: 'test-repo'})).rejects.toThrow(
		'Invalid token',
	)
})

test('listAllBackups() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.listAllBackups.query()).rejects.toThrow('Invalid token')
})

test('listBackupFiles() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.backups.listBackupFiles.query({backupId: 'test-repo:test-backup'}),
	).rejects.toThrow('Invalid token')
})

test('mountBackup() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.backups.mountBackup.mutate({backupId: 'test-repo:test-backup'}),
	).rejects.toThrow('Invalid token')
})

test('unmountBackup() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.backups.unmountBackup.mutate({directoryName: 'test-directory'}),
	).rejects.toThrow('Invalid token')
})

test('backupProgress() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.backupProgress.query()).rejects.toThrow('Invalid token')
})

test('getIgnoredPaths() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.getIgnoredPaths.query()).rejects.toThrow('Invalid token')
})

test('addIgnoredPath() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.addIgnoredPath.mutate({path: '/Home/test'})).rejects.toThrow(
		'Invalid token',
	)
})

test('removeIgnoredPath() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.backups.removeIgnoredPath.mutate({path: '/Home/test'})).rejects.toThrow(
		'Invalid token',
	)
})
