import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import Recents from './recents.ts'

function fixture({available = true, indexError}: {available?: boolean; indexError?: Error} = {}) {
	const candidates = [
		{id: 1, name: 'newest.txt', virtualPath: '/Home/newest.txt'},
		{id: 2, name: 'missing.txt', virtualPath: '/Home/missing.txt'},
		{id: 3, name: 'folder', virtualPath: '/Home/folder'},
		{id: 4, name: 'older.txt', virtualPath: '/Home/older.txt'},
	]
	const recentCandidates = vi.fn(async (virtualRoot: string) => {
		if (indexError) throw indexError
		return candidates.map((candidate) => ({
			...candidate,
			virtualPath: candidate.virtualPath.replace('/Home', virtualRoot),
		}))
	})
	const virtualToSystemPath = vi.fn(async (virtualPath: string) => `/data${virtualPath}`)
	const status = vi.fn(async (systemPath: string) => {
		if (systemPath.endsWith('/missing.txt')) throw new Error('ENOENT')
		return {
			name: systemPath.split('/').at(-1)!,
			path: systemPath.slice('/data'.length),
			type: systemPath.endsWith('/folder') ? 'directory' : 'text/plain',
			size: 1,
			modified: 1,
			operations: [],
		}
	})
	const umbreld = {
		backups: {backupDirectoryName: 'Umbrel Backup.backup'},
		files: {
			fileIndex: {available, recentCandidates},
			virtualToSystemPath,
			status,
		},
	} as unknown as Umbreld
	return {recents: new Recents(umbreld), recentCandidates, virtualToSystemPath, status}
}

test('queries the owner Home index and re-authorizes every candidate in order', async () => {
	const {recents, recentCandidates, virtualToSystemPath, status} = fixture()

	await expect(recents.get()).resolves.toMatchObject([{name: 'newest.txt'}, {name: 'older.txt'}])
	expect(recentCandidates).toHaveBeenCalledWith('/Home', 50, ['Umbrel Backup.backup'])
	expect(virtualToSystemPath).toHaveBeenCalledTimes(4)
	expect(virtualToSystemPath).toHaveBeenCalledWith('/Home/newest.txt', OWNER_USER_ID)
	expect(status).toHaveBeenCalledWith('/data/Home/newest.txt', OWNER_USER_ID)
})

test('queries only the requesting member Home root', async () => {
	const {recents, recentCandidates, virtualToSystemPath, status} = fixture()

	await expect(recents.get('alice')).resolves.toMatchObject([{name: 'newest.txt'}, {name: 'older.txt'}])
	expect(recentCandidates).toHaveBeenCalledWith('/Users/alice', 50, ['Umbrel Backup.backup'])
	expect(virtualToSystemPath).toHaveBeenCalledWith('/Users/alice/newest.txt', 'alice')
	expect(status).toHaveBeenCalledWith('/data/Users/alice/newest.txt', 'alice')
})

test('surfaces an unavailable index instead of returning an authoritative empty result', async () => {
	const {recents, recentCandidates} = fixture({available: false})

	await expect(recents.get()).rejects.toThrow('File index is unavailable')
	expect(recentCandidates).not.toHaveBeenCalled()
})

test('surfaces index query failures', async () => {
	const {recents} = fixture({indexError: new Error('database read failed')})

	await expect(recents.get()).rejects.toThrow('database read failed')
})
