import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {connectNetworkBackupShare, createNetworkBackupShare, repositoryPassword} from './backups.vm-test-helpers.ts'

describe.sequential('Scheduled backups', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let repositoryId: string
	let networkSharePath: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function advanceVmClock(hours: number) {
		// The backup scheduler intentionally has no public API for shortening its
		// hourly interval or 24h warning threshold, so this isolated VM advances
		// its own clock instead of patching application internals.
		await umbreld.vm.sshAsRoot(`
set -eu
timedatectl set-ntp false >/dev/null 2>&1 || true
date -s '+${hours} hours' >/dev/null
`)
	}

	test('creates a network repository for scheduled backups', async () => {
		networkSharePath = await createNetworkBackupShare(umbreld)
		repositoryId = await umbreld.client.backups.createRepository.mutate({
			path: networkSharePath,
			password: repositoryPassword,
		})
		expect(repositoryId).toMatch(/[a-f0-9]{8}$/)
	})

	test('backs up repositories on the background interval', async () => {
		await advanceVmClock(2)

		await pRetry(
			async () => {
				const backups = await umbreld.client.backups.listBackups.query({repositoryId})
				expect(backups.length).toBeGreaterThanOrEqual(1)

				// The snapshot can become visible before the scheduled backup has
				// saved lastBackup and cleared progress. Wait for the interval job
				// to fully settle before another test advances the VM clock.
				const repositories = await umbreld.client.backups.getRepositories.query()
				const repository = repositories.find((repository) => repository.id === repositoryId)
				expect(repository?.lastBackup).toBeTypeOf('number')

				const progress = await umbreld.client.backups.backupProgress.query()
				expect(progress.some((progress) => progress.repositoryId === repositoryId)).toBe(false)
			},
			{retries: 60, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	})

	test('notifies after scheduled backups fail for more than 24 hours and clears after success', async () => {
		const notificationId = `backups-failing:${repositoryId}`
		await expect(umbreld.client.notifications.get.query()).resolves.not.toContain(notificationId)

		// Removing the files network share through the product API leaves the
		// backup repository configured while making its path unavailable.
		await umbreld.client.files.removeNetworkShare.mutate({mountPath: networkSharePath})
		await advanceVmClock(25)

		await pRetry(
			async () => {
				await expect(umbreld.client.notifications.get.query()).resolves.toContain(notificationId)
			},
			{retries: 240, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

		networkSharePath = await connectNetworkBackupShare(umbreld)
		await pRetry(() => expect(umbreld.client.backups.backup.mutate({repositoryId})).resolves.toBe(true), {
			retries: 10,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})
		await expect(umbreld.client.notifications.get.query()).resolves.not.toContain(notificationId)
	})
})
