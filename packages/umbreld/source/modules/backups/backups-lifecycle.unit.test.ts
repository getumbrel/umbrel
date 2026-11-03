import nodePath from 'node:path'

import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import Backups from './backups.ts'

const temporary = temporaryDirectory()

afterEach(async () => temporary.destroyRoot())

async function fixture() {
	const dataDirectory = await temporary.create()
	return new Backups({
		dataDirectory,
		logger: {createChildLogger: () => ({log: vi.fn(), verbose: vi.fn(), error: vi.fn()})},
		files: {getBaseDirectory: () => nodePath.join(dataDirectory, 'backups')},
		user: {exists: async () => false},
	} as unknown as Umbreld)
}

test('refuses kopia with a starting error before backups has started', async () => {
	const backups = await fixture()

	await expect(backups.kopia(['--version'])).rejects.toThrow('[backups-starting]')
})

test('refuses kopia with a shutting-down error once backups has stopped', async () => {
	const backups = await fixture()
	await backups.start()
	await backups.stop()

	await expect(backups.kopia(['--version'])).rejects.toThrow('[shutting-down]')
})
