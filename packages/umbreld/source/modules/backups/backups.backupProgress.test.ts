import {expect, beforeAll, afterAll, test, describe} from 'vitest'

import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe(`backupProgress()`, () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.backups.backupProgress.query()).rejects.toThrow('Invalid token')
	})

	test('returns an empty array if no backups are in progress', async () => {
		await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])
	})

	test('returns backup progress during backup operation', async () => {
		// Create fake usb drive
		const backupPath = `${umbreld.instance.dataDirectory}/external/SanDisk`
		await fse.mkdir(backupPath, {recursive: false})

		// Create some test data to backup
		const testDataPath = `${umbreld.instance.dataDirectory}/home/backup-progress-test.txt`
		await fse.mkdir(`${umbreld.instance.dataDirectory}/home`, {recursive: true})
		await fse.writeFile(testDataPath, 'test content for backup progress')

		const repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: '/External/SanDisk',
			password: 'test-password',
		})

		// Listen for all backup progress events
		const collectedEvents: any[] = []
		const removeListener = umbreld.instance.eventBus.on(
			'backups:backup-progress',
			(progress) => void collectedEvents.push(JSON.parse(JSON.stringify(progress))),
		)

		// Test we start with no backups in progress
		await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])

		// Start the backup
		const backupPromise = umbreld.client.backups.backup.mutate({repositoryId})

		// Wait for the backup to complete
		const result = await backupPromise
		expect(result).toBe(true)

		// Test we end with no backups in progress
		await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])

		// Test all the events we collected
		expect(collectedEvents.length).toBeGreaterThanOrEqual(2)
		expect(collectedEvents.at(0)).toMatchObject([
			{
				repositoryId,
				percent: 0,
			},
		])
		expect(collectedEvents.at(-1)).toMatchObject([])

		// Clean up
		removeListener()
		await fse.remove(backupPath)
	})

	// Skip this for now, come back to this when we test backup events heavily
	test.skip('handles multiple concurrent backups', async () => {
		// Create two test repositories
		const backupPath1 = `${umbreld.instance.dataDirectory}/external/USB-1`
		const backupPath2 = `${umbreld.instance.dataDirectory}/external/USB-2`
		await fse.mkdir(backupPath1, {recursive: true})
		await fse.mkdir(backupPath2, {recursive: true})

		// Create test data
		const testDataPath = `${umbreld.instance.dataDirectory}/home/concurrent-backup-test.txt`
		await fse.writeFile(testDataPath, 'test content for concurrent backups')

		const repositoryId1 = await umbreld.client.backups.createRepository.mutate({
			path: '/External/USB-1',
			password: 'password1',
		})
		const repositoryId2 = await umbreld.client.backups.createRepository.mutate({
			path: '/External/USB-2',
			password: 'password2',
		})

		// Start both backups concurrently
		const backup1Promise = umbreld.client.backups.backup.mutate({repositoryId: repositoryId1})
		const backup2Promise = umbreld.client.backups.backup.mutate({repositoryId: repositoryId2})

		// Wait for both to start
		await delay(100)

		// Test we have two backup operations in progress
		const progressInProgress = await umbreld.client.backups.backupProgress.query()
		expect(progressInProgress).toHaveLength(2)

		const repo1Progress = progressInProgress.find((p) => p.repositoryId === repositoryId1)
		const repo2Progress = progressInProgress.find((p) => p.repositoryId === repositoryId2)

		expect(repo1Progress).toMatchObject({
			repositoryId: repositoryId1,
			percent: expect.any(Number),
		})
		expect(repo2Progress).toMatchObject({
			repositoryId: repositoryId2,
			percent: expect.any(Number),
		})

		// Wait for both backups to complete
		await Promise.all([backup1Promise, backup2Promise])

		// Test we end with no backups in progress
		await expect(umbreld.client.backups.backupProgress.query()).resolves.toMatchObject([])

		// Clean up
		await fse.remove(backupPath1)
		await fse.remove(backupPath2)
	})
})
