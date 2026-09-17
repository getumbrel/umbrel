import os from 'node:os'

import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Backups from './backups.js'

function createBackups() {
	const prepareBackup = vi.fn(async () => true)
	const releaseBackup = vi.fn(async () => {})
	const prepareUmbrelDatabaseBackup = vi.fn(async () => {})
	const releaseUmbrelDatabaseBackup = vi.fn(async () => {})
	const clearNotification = vi.fn(async () => {})
	const writeStore = vi.fn(async () => {})
	const emit = vi.fn()
	const backups = new Backups({
		dataDirectory: '/data',
		logger: {createChildLogger: () => ({log: vi.fn(), verbose: vi.fn(), error: vi.fn()})},
		files: {getBaseDirectory: (path: string) => `/data${path}`},
		machines: {prepareBackup, releaseBackup},
		notifications: {clear: clearNotification},
		store: {
			getWriteLock: async (callback: (store: {set: typeof writeStore}) => Promise<void>) => callback({set: writeStore}),
		},
		eventBus: {emit},
	} as unknown as Umbreld)

	vi.spyOn(backups, 'getRepository').mockResolvedValue({id: 'repository', path: '/External/Backup'} as never)
	vi.spyOn(backups, 'getRepositories').mockResolvedValue([{id: 'repository', path: '/External/Backup'}] as never)
	vi.spyOn(backups, 'repository').mockImplementation(async (_repositoryId, flags = []) => {
		const isMaintenanceInfo = flags[0] === 'maintenance' && flags[1] === 'info'
		const stdout = isMaintenanceInfo ? JSON.stringify({owner: `${os.userInfo().username}@umbrel`}) : ''
		return {stdout, stderr: '', exitCode: 0} as never
	})
	vi.spyOn(backups, 'createIgnoreFile').mockResolvedValue()
	vi.spyOn(backups, 'prepareUmbrelDatabaseBackup').mockImplementation(prepareUmbrelDatabaseBackup)
	vi.spyOn(backups, 'releaseUmbrelDatabaseBackup').mockImplementation(releaseUmbrelDatabaseBackup)
	vi.spyOn(backups, 'getRepositorySize').mockResolvedValue({used: 1, capacity: 2, available: 1})

	return {
		backups,
		prepareBackup,
		releaseBackup,
		prepareUmbrelDatabaseBackup,
		releaseUmbrelDatabaseBackup,
		clearNotification,
		writeStore,
		emit,
	}
}

describe('machine snapshot backup lifecycle', () => {
	test('fails the backup instead of recording success when machine snapshot release fails', async () => {
		const {backups, releaseBackup, clearNotification, writeStore, emit} = createBackups()
		releaseBackup.mockRejectedValueOnce(new Error('[machine-backup-release-failed]'))

		await expect(backups.backup('repository')).rejects.toThrow('[machine-backup-release-failed]')

		expect(releaseBackup).toHaveBeenCalledOnce()
		expect(clearNotification).not.toHaveBeenCalled()
		expect(writeStore).not.toHaveBeenCalled()
		expect(backups.backupsInProgress).toEqual([])
		expect(emit).toHaveBeenLastCalledWith('backups:backup-progress', [])
	})

	test('releases the database snapshot when machine preparation is rejected', async () => {
		const {backups, prepareBackup, releaseBackup, releaseUmbrelDatabaseBackup} = createBackups()
		prepareBackup.mockRejectedValueOnce(new Error('[machine-backup-already-running]'))

		await expect(backups.backup('repository')).rejects.toThrow('[machine-backup-already-running]')

		expect(releaseBackup).not.toHaveBeenCalled()
		expect(releaseUmbrelDatabaseBackup).toHaveBeenCalledOnce()
	})

	test('does not prepare machines or release a database snapshot that failed preparation', async () => {
		const {backups, prepareBackup, prepareUmbrelDatabaseBackup, releaseUmbrelDatabaseBackup} = createBackups()
		prepareUmbrelDatabaseBackup.mockRejectedValueOnce(new Error('[backup-database-invalid]'))

		await expect(backups.backup('repository')).rejects.toThrow('[backup-database-invalid]')

		expect(prepareBackup).not.toHaveBeenCalled()
		expect(releaseUmbrelDatabaseBackup).not.toHaveBeenCalled()
	})

	test('fails the backup instead of recording success when database snapshot release fails', async () => {
		const {backups, releaseUmbrelDatabaseBackup, clearNotification, writeStore} = createBackups()
		releaseUmbrelDatabaseBackup.mockRejectedValueOnce(new Error('[backup-database-snapshot-release-failed]'))

		await expect(backups.backup('repository')).rejects.toThrow('[backup-database-snapshot-release-failed]')

		expect(clearNotification).not.toHaveBeenCalled()
		expect(writeStore).not.toHaveBeenCalled()
	})

	test('serializes backup runs that share database and machine snapshot staging', async () => {
		const {backups, prepareUmbrelDatabaseBackup} = createBackups()
		let releaseFirstPreparation!: () => void
		prepareUmbrelDatabaseBackup.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseFirstPreparation = resolve)),
		)

		const first = backups.backup('repository')
		const second = backups.backup('repository')
		await vi.waitFor(() => expect(prepareUmbrelDatabaseBackup).toHaveBeenCalledOnce())

		releaseFirstPreparation()
		await Promise.all([first, second])
		expect(prepareUmbrelDatabaseBackup).toHaveBeenCalledTimes(2)
	})
})
