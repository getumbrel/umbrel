import os from 'node:os'

import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import Backups from './backups.ts'

// Kopia reports an automatic maintenance failure after an otherwise successful command
const maintenanceFailure = Object.assign(new Error('Command failed with exit code 1'), {
	stderr: [
		' * 0 hashing, 3002 hashed (150 MB), 0 cached (0 B), uploaded 150.2 MB, estimating...',
		'Created snapshot with root k183ea3ad48d3e07c9ee0e81d99c69523 and ID 7e42655bff085ec80ba48d6c3b13d82f in 0s',
		'running auto-maintenance: error running maintenance: error checking for clock skew: clock skew detected',
	].join('\n'),
})

function createBackups(failingCommand: string, error: unknown) {
	const writeStore = vi.fn(async () => {})
	const backups = new Backups({
		dataDirectory: '/data',
		logger: {createChildLogger: () => ({log: vi.fn(), verbose: vi.fn(), error: vi.fn()})},
		files: {getBaseDirectory: (path: string) => `/data${path}`},
		machines: {prepareBackup: async () => true, releaseBackup: async () => {}},
		notifications: {clear: async () => {}},
		store: {
			getWriteLock: async (callback: (store: {set: typeof writeStore}) => Promise<void>) => callback({set: writeStore}),
		},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)

	vi.spyOn(backups, 'getRepository').mockResolvedValue({id: 'repository', path: '/External/Backup'} as never)
	vi.spyOn(backups, 'getRepositories').mockResolvedValue([{id: 'repository', path: '/External/Backup'}] as never)
	const repository = vi.spyOn(backups, 'repository').mockImplementation(async (_repositoryId, flags = []) => {
		if (flags.slice(0, 2).join(' ') === failingCommand) throw error
		const isMaintenanceInfo = flags[0] === 'maintenance' && flags[1] === 'info'
		const stdout = isMaintenanceInfo ? JSON.stringify({owner: `${os.userInfo().username}@umbrel`}) : ''
		return {stdout, stderr: '', exitCode: 0} as never
	})
	vi.spyOn(backups, 'createIgnoreFile').mockResolvedValue()
	vi.spyOn(backups, 'prepareUmbrelDatabaseBackup').mockResolvedValue()
	vi.spyOn(backups, 'releaseUmbrelDatabaseBackup').mockResolvedValue()
	vi.spyOn(backups, 'getRepositorySize').mockResolvedValue({used: 1, capacity: 2, available: 1})

	const snapshotCreateCalls = () =>
		repository.mock.calls.filter(([, flags]) => flags?.slice(0, 2).join(' ') === 'snapshot create')

	return {backups, writeStore, snapshotCreateCalls}
}

describe('backup automatic maintenance failures', () => {
	test('still backs up when maintenance fails after setting the policy', async () => {
		const {backups, writeStore, snapshotCreateCalls} = createBackups('policy set', maintenanceFailure)

		await expect(backups.backup('repository')).resolves.toBe(true)

		expect(snapshotCreateCalls()).toHaveLength(1)
		expect(writeStore).toHaveBeenCalled()
	})

	test('records the backup when maintenance fails after the snapshot', async () => {
		const {backups, writeStore} = createBackups('snapshot create', maintenanceFailure)

		await expect(backups.backup('repository')).resolves.toBe(true)

		expect(writeStore).toHaveBeenCalled()
	})

	test('still fails the backup when the snapshot itself fails', async () => {
		const snapshotFailure = Object.assign(new Error('Command failed with exit code 1'), {
			stderr: 'ERROR unable to write snapshot: no space left on device',
		})
		const {backups, writeStore} = createBackups('snapshot create', snapshotFailure)

		await expect(backups.backup('repository')).rejects.toThrow('Command failed')

		expect(writeStore).not.toHaveBeenCalled()
	})

	test('still fails the backup when a failed snapshot only mentions automatic maintenance', async () => {
		const snapshotFailure = Object.assign(new Error('Command failed with exit code 1'), {
			stderr: [
				'Error when processing "notes/running auto-maintenance: todo.txt": permission denied',
				'Found 1 fatal error(s) while snapshotting /data.',
			].join('\n'),
		})
		const {backups, writeStore} = createBackups('snapshot create', snapshotFailure)

		await expect(backups.backup('repository')).rejects.toThrow('Command failed')

		expect(writeStore).not.toHaveBeenCalled()
	})

	test('still fails the backup when the policy cannot be set', async () => {
		const policyFailure = Object.assign(new Error('Command failed with exit code 1'), {
			stderr: 'ERROR open repository: unable to open repository: directory not found',
		})
		const {backups, snapshotCreateCalls} = createBackups('policy set', policyFailure)

		await expect(backups.backup('repository')).rejects.toThrow('Command failed')

		expect(snapshotCreateCalls()).toHaveLength(0)
	})

	test('asks kopia for progress output since it is not attached to a terminal', async () => {
		const {backups, snapshotCreateCalls} = createBackups('none', undefined)

		await backups.backup('repository')

		expect(snapshotCreateCalls()[0][1]).toContain('--progress')
	})
})
