import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	bootWithExternalStorage,
	expectBackupFiles,
	externalPath,
	installBackupIgnoreFixtureApp,
	latestBackupFiles,
	repositoryPassword,
} from './backups.vm-test-helpers.ts'

describe.sequential('Backups ignored paths', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let repositoryId: string

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

	test('creates a repository for ignored path coverage', async () => {
		repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		expect(repositoryId).toMatch(/[a-f0-9]{8}$/)
	})

	test('respects user ignored paths', async () => {
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(latestBackupFiles(umbreld, repositoryId, undefined)).resolves.toContain('home')

		await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.not.toContain('/Home')
		await expect(umbreld.client.backups.addIgnoredPath.mutate({path: '/Home'})).resolves.toBe(true)
		await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.toContain('/Home')
		await expect(umbreld.client.backups.addIgnoredPath.mutate({path: '/App/foo'})).rejects.toThrow(
			'Path to exclude must be in /Home',
		)

		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(latestBackupFiles(umbreld, repositoryId, undefined)).resolves.not.toContain('home')

		await expect(umbreld.client.backups.removeIgnoredPath.mutate({path: '/Home'})).resolves.toBe(true)
		await expect(umbreld.client.backups.getIgnoredPaths.query()).resolves.not.toContain('/Home')
		await expect(umbreld.client.backups.removeIgnoredPath.mutate({path: '/External'})).rejects.toThrow(
			'Path to exclude must be in /Home',
		)

		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expectBackupFiles(umbreld, repositoryId, undefined, 'home')
	})

	test('respects app backupIgnore glob patterns', async () => {
		await installBackupIgnoreFixtureApp(umbreld)

		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expectBackupFiles(umbreld, repositoryId, '/app-data/vm-backup-ignore', 'logs')
		await expectBackupFiles(umbreld, repositoryId, '/app-data/vm-backup-ignore', 'important-data')

		const logsDirFiles = await latestBackupFiles(umbreld, repositoryId, '/app-data/vm-backup-ignore/logs')
		expect(logsDirFiles).not.toContain('app.log')

		const importantDirFiles = await latestBackupFiles(
			umbreld,
			repositoryId,
			'/app-data/vm-backup-ignore/important-data',
		)
		expect(importantDirFiles).toContain('config.json')
	})
})
