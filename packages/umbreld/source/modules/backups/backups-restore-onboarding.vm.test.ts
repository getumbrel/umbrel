import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	bootWithExternalStorage,
	externalPath,
	repositoryPassword,
	restoreBackupAndWait,
	waitForBackupsKopiaReady,
	waitForExternalStorage,
} from './backups.vm-test-helpers.ts'

describe.sequential('Backup restore during onboarding', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

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

	test('creates a backup that can be restored after a reflash', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/fresh-restore-marker'})
		const repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		await expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true)
		await expect(umbreld.client.backups.listBackups.query({repositoryId})).resolves.toHaveLength(1)
	})

	test('connects to an existing repository and restores before a user exists', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.reflash()
		await umbreld.vm.powerOn()

		await waitForExternalStorage(umbreld, {authenticated: false})
		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(false)
		await waitForBackupsKopiaReady(umbreld, {authenticated: false})

		await expect(
			umbreld.unauthenticatedClient.backups.connectToExistingRepository.mutate({
				path: externalPath,
				password: 'incorrect-password',
			}),
		).rejects.toThrow('invalid repository password')

		const restoredRepositoryId = await umbreld.unauthenticatedClient.backups.connectToExistingRepository.mutate({
			path: externalPath,
			password: repositoryPassword,
		})
		const backups = await umbreld.unauthenticatedClient.backups.listBackups.query({
			repositoryId: restoredRepositoryId,
		})
		const backup = backups.at(-1)
		expect(backup).toBeDefined()

		await restoreBackupAndWait({umbreld, backupId: backup!.id, authenticated: false})

		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(true)
		// The backup contains the account, not a reusable login session. Restores
		// intentionally revoke all sessions, including the one from before reflash.
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain('fresh-restore-marker')
		// A real VM restore reboots into a fresh umbreld process, so the
		// in-memory restoreStatus resets after the restored install starts.
		await expect(umbreld.client.backups.restoreStatus.query()).resolves.toMatchObject({
			running: false,
			error: false,
		})
	})
})
