import {setTimeout} from 'node:timers/promises'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import {kopiaCacheSizeFlagsForInodes, UMBREL_DATABASE_BACKUP_DIRECTORY, type BackupsInProgress} from './backups.js'
import {
	bootWithExternalStorage,
	createNetworkBackupShare,
	expectBackupFiles,
	externalPath,
	latestBackup,
	repositoryPassword,
	vmDataDirectory,
	writeDataFile,
} from './backups.vm-test-helpers.js'

describe.sequential('Backups repositories', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let externalRepositoryId: string
	let secondRepositoryId: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await bootWithExternalStorage(umbreld)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('rejects backup RPCs without authentication after setup', async () => {
		await expect(umbreld.unauthenticatedClient.backups.getRepositories.query()).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.backups.getRepositorySize.query({repositoryId: 'test-repo'}),
		).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.backups.createRepository.mutate({
				path: '/Network/test',
				password: repositoryPassword,
			}),
		).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.backups.backup.mutate({repositoryId: 'test-repo'})).rejects.toThrow(
			'Invalid token',
		)
		await expect(umbreld.unauthenticatedClient.backups.listBackups.query({repositoryId: 'test-repo'})).rejects.toThrow(
			'Invalid token',
		)
		await expect(umbreld.unauthenticatedClient.backups.listAllBackups.query()).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.backups.listBackupFiles.query({backupId: 'test-repo:test-backup'}),
		).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.backups.mountBackup.mutate({backupId: 'test-repo:test-backup'}),
		).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.backups.unmountBackup.mutate({directoryName: 'test-directory'}),
		).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.backups.backupProgress.query()).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.backups.getIgnoredPaths.query()).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.backups.addIgnoredPath.mutate({path: '/Home/test'})).rejects.toThrow(
			'Invalid token',
		)
		await expect(umbreld.unauthenticatedClient.backups.removeIgnoredPath.mutate({path: '/Home/test'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('creates repositories on external and network storage', async () => {
		await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual([])
		await expect(
			umbreld.client.backups.createRepository.mutate({
				path: vmDataDirectory,
				password: repositoryPassword,
			}),
		).rejects.toThrow('Invalid path')

		externalRepositoryId = await umbreld.client.backups.createRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		expect(externalRepositoryId).toMatch(/[a-f0-9]{8}$/)

		const networkSharePath = await createNetworkBackupShare(umbreld)
		secondRepositoryId = await umbreld.client.backups.createRepository.mutate({
			path: networkSharePath,
			password: repositoryPassword,
		})
		expect(secondRepositoryId).toMatch(/[a-f0-9]{8}$/)

		await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: externalRepositoryId,
					path: `${externalPath}/Umbrel Backup.backup`,
				}),
				expect.objectContaining({
					id: secondRepositoryId,
					path: `${networkSharePath}/Umbrel Backup.backup`,
				}),
			]),
		)
		await expect(umbreld.client.backups.getRepositorySize.query({repositoryId: externalRepositoryId})).resolves.toEqual(
			{
				used: 0,
				capacity: expect.any(Number),
				available: expect.any(Number),
			},
		)
	})

	test('keeps the cache on the data filesystem with limits appropriate for its inode capacity', async () => {
		const output = await umbreld.vm.sshAsRoot(`
set -eu
REPOSITORY_ID='${externalRepositoryId}' node --input-type=module <<'NODE'
import fs from 'node:fs'
import path from 'node:path'

const dataDirectory = '${vmDataDirectory}'
const configDirectory = '/kopia/config'
const config = JSON.parse(fs.readFileSync(path.join(configDirectory, process.env.REPOSITORY_ID + '.config'), 'utf8'))
console.log(JSON.stringify({
	totalInodes: fs.statfsSync(dataDirectory).files,
	cacheDirectory: path.resolve(configDirectory, config.caching.cacheDirectory),
	caching: config.caching,
}))
NODE
`)
		const {totalInodes, cacheDirectory, caching} = JSON.parse(output)

		expect(cacheDirectory).toMatch(new RegExp(`^${vmDataDirectory}/kopia/cache/kopia/[a-f0-9]+$`))
		if (kopiaCacheSizeFlagsForInodes(totalInodes).length > 0) {
			expect(caching).toMatchObject({
				maxCacheSize: 500 * 2 ** 20,
				contentCacheSizeLimitBytes: 1000 * 2 ** 20,
				maxMetadataCacheSize: 1000 * 2 ** 20,
				metadataCacheSizeLimitBytes: 2000 * 2 ** 20,
			})
		} else {
			expect(caching).toMatchObject({
				maxCacheSize: 5000 * 2 ** 20,
				maxMetadataCacheSize: 5000 * 2 ** 20,
			})
			expect(caching.contentCacheSizeLimitBytes).toBeUndefined()
			expect(caching.metadataCacheSizeLimitBytes).toBeUndefined()
		}
	})

	test('owns repository maintenance so expired snapshots get cleaned up', async () => {
		await umbreld.client.files.createDirectory.mutate({path: `${externalPath}/Maintenance`})
		const repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: `${externalPath}/Maintenance`,
			password: repositoryPassword,
		})
		const kopia = (command: string) =>
			umbreld.vm.sshAsRoot(
				`KOPIA_CHECK_FOR_UPDATES=false kopia --config-file=/kopia/config/${repositoryId}.config ${command}`,
			)
		const maintenanceInfo = async () => JSON.parse(await kopia('maintenance info --json'))

		// Kopia only runs automatic maintenance when the connecting user@host matches the
		// maintenance owner, so new repositories must be owned by the identity we connect with.
		expect((await maintenanceInfo()).owner).toBe('root@umbrel')

		// Repositories created without the hostname override were stamped with the device's real
		// hostname, so maintenance never ran. Backups take ownership back.
		await kopia('maintenance set --owner=root@legacy-hostname')
		expect((await maintenanceInfo()).owner).toBe('root@legacy-hostname')
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		expect((await maintenanceInfo()).owner).toBe('root@umbrel')

		await expect(umbreld.client.backups.forgetRepository.mutate({repositoryId})).resolves.toBeUndefined()
	})

	test('forgets a repository without deleting the repository data', async () => {
		await umbreld.client.files.createDirectory.mutate({path: `${externalPath}/Forgotten`})
		const repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: `${externalPath}/Forgotten`,
			password: repositoryPassword,
		})

		await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({id: repositoryId})]),
		)

		await expect(umbreld.client.backups.forgetRepository.mutate({repositoryId})).resolves.toBeUndefined()
		await expect(umbreld.client.backups.getRepositories.query()).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({id: repositoryId})]),
		)

		const externalListing = await umbreld.client.files.list.query({path: `${externalPath}/Forgotten`})
		expect(externalListing.files.map((file) => file.name)).toContain('Umbrel Backup.backup')
	})

	test('rejects missing repositories and duplicate repository creation', async () => {
		await expect(umbreld.client.backups.backup.mutate({repositoryId: 'non-existent-repo'})).rejects.toThrow(
			'Repository non-existent-repo not found',
		)
		await expect(umbreld.client.backups.listBackups.query({repositoryId: 'non-existent-repo'})).rejects.toThrow(
			'Repository non-existent-repo not found',
		)
		await expect(
			umbreld.client.backups.createRepository.mutate({
				path: externalPath,
				password: repositoryPassword,
			}),
		).rejects.toThrow('Repository already exists')
	})

	test('creates a backup and lists repository contents', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/original-umbrel'})
		await writeDataFile(umbreld, 'home/multi-backup-test.txt', 'initial content')
		await writeDataFile(umbreld, 'app-data/test-app-file.txt', 'app data test content')

		await expect(umbreld.client.backups.listBackups.query({repositoryId: externalRepositoryId})).resolves.toHaveLength(
			0,
		)
		await expect(umbreld.client.backups.backup.mutate({repositoryId: externalRepositoryId})).resolves.toBe(true)

		const backups = await umbreld.client.backups.listBackups.query({repositoryId: externalRepositoryId})
		expect(backups).toHaveLength(1)
		expect(backups[0]).toMatchObject({
			id: expect.stringMatching(`^${externalRepositoryId}:`),
			time: expect.any(Number),
			size: expect.any(Number),
		})

		const files = await umbreld.client.backups.listBackupFiles.query({backupId: backups[0].id})
		expect(files).toContain('umbrel.yaml')
		expect(files).toContain(UMBREL_DATABASE_BACKUP_DIRECTORY)
		expect(files).not.toContain('umbrel.db')
		expect(files).toContain('app-data')
		expect(files).toContain('home')
		expect(files).toContain('secrets')
		expect(files).toContain('trash')
		expect(files).not.toContain('app-stores')
		expect(files).not.toContain('external')
		expect(files).not.toContain('network')
		expect(files).not.toContain('thumbnails')
		expect(files).not.toContain('file-index')
		expect(files).not.toContain('kopia')

		await expect(umbreld.client.backups.getRepositories.query()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: externalRepositoryId,
					lastBackup: expect.any(Number),
				}),
			]),
		)
		await expect(umbreld.client.backups.getRepositorySize.query({repositoryId: externalRepositoryId})).resolves.toEqual(
			{
				used: {asymmetricMatch: (value: unknown) => typeof value === 'number' && value > 0},
				capacity: expect.any(Number),
				available: expect.any(Number),
			},
		)
	})

	test('creates separate snapshots for multiple backups', async () => {
		await setTimeout(1000)
		await writeDataFile(umbreld, 'home/multi-backup-test.txt', 'modified content')

		await expect(umbreld.client.backups.backup.mutate({repositoryId: externalRepositoryId})).resolves.toBe(true)

		const backups = await umbreld.client.backups.listBackups.query({repositoryId: externalRepositoryId})
		expect(backups).toHaveLength(2)
		expect(backups[0].id).not.toBe(backups[1].id)
		expect(backups[0].time).not.toBe(backups[1].time)
	})

	test('mounts and unmounts a backup for browsing', async () => {
		const backup = await latestBackup(umbreld, externalRepositoryId)
		const directoryName = await umbreld.client.backups.mountBackup.mutate({backupId: backup.id})
		expect(directoryName).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

		await expect(umbreld.client.files.list.query({path: `/Backups/${directoryName}/Home`})).resolves.toEqual(
			expect.objectContaining({
				files: expect.arrayContaining([expect.objectContaining({name: 'multi-backup-test.txt'})]),
			}),
		)
		await expect(umbreld.client.files.list.query({path: `/Backups/${directoryName}/Apps`})).resolves.toEqual(
			expect.objectContaining({
				files: expect.arrayContaining([expect.objectContaining({name: 'test-app-file.txt'})]),
			}),
		)

		await expect(umbreld.client.backups.unmountBackup.mutate({directoryName})).resolves.toBe(true)
		const backupsRoot = await umbreld.client.files.list.query({path: '/Backups'})
		expect(backupsRoot.files.map((file) => file.name)).not.toContain(directoryName)
	})

	test('lists backups across repositories in chronological order', async () => {
		await setTimeout(1000)
		await expect(umbreld.client.backups.backup.mutate({repositoryId: secondRepositoryId})).resolves.toBe(true)

		const allBackups = await umbreld.client.backups.listAllBackups.query()
		const externalBackups = allBackups.filter((backup) => backup.id.startsWith(`${externalRepositoryId}:`))
		const networkBackups = allBackups.filter((backup) => backup.id.startsWith(`${secondRepositoryId}:`))
		expect(externalBackups).toHaveLength(2)
		expect(networkBackups).toHaveLength(1)

		const times = allBackups.map((backup) => backup.time)
		expect(times).toEqual([...times].sort((a, b) => a - b))
	})

	test('reports backup progress events', async () => {
		const progressSubscription = umbreld.subscribeToEvents<BackupsInProgress>('backups:backup-progress')
		await progressSubscription.started

		await expect(umbreld.client.backups.backupProgress.query()).resolves.toEqual([])
		await expect(umbreld.client.backups.backup.mutate({repositoryId: externalRepositoryId})).resolves.toBe(true)
		await expect(umbreld.client.backups.backupProgress.query()).resolves.toEqual([])

		expect(progressSubscription.collected).toEqual(
			expect.arrayContaining([[expect.objectContaining({repositoryId: externalRepositoryId, percent: 0})]]),
		)
		expect(progressSubscription.collected.at(-1)).toEqual([])
		progressSubscription.unsubscribe()
	})

	test('connects to a forgotten repository after a failed password attempt', async () => {
		await umbreld.client.files.createDirectory.mutate({path: `${externalPath}/Reconnect`})
		const repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: `${externalPath}/Reconnect`,
			password: repositoryPassword,
		})
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(umbreld.client.backups.forgetRepository.mutate({repositoryId})).resolves.toBeUndefined()

		await expect(
			umbreld.client.backups.connectToExistingRepository.mutate({
				path: `${externalPath}/Reconnect`,
				password: 'incorrect-password',
			}),
		).rejects.toThrow('invalid repository password')

		const reconnectedRepositoryId = await umbreld.client.backups.connectToExistingRepository.mutate({
			path: `${externalPath}/Reconnect`,
			password: repositoryPassword,
		})
		await expect(
			umbreld.client.backups.listBackups.query({repositoryId: reconnectedRepositoryId}),
		).resolves.toHaveLength(1)
		await expectBackupFiles(umbreld, reconnectedRepositoryId, undefined, 'umbrel.yaml')
	})
})
