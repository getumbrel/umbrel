import nodePath from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'

import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})))
})

async function directoryFixture(names: string[]) {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'umbreld-files-page-'))
	temporaryDirectories.push(directory)
	await Promise.all(names.map((name) => writeFile(nodePath.join(directory, name), name)))
	return directory
}

function contextFor(directory: string) {
	const status = vi.fn(async (systemPath: string) => ({
		name: systemPath === directory ? 'Home' : nodePath.basename(systemPath),
		path: systemPath === directory ? '/Home' : `/Home/${nodePath.basename(systemPath)}`,
		type: systemPath === directory ? 'directory' : 'text/plain',
		size: systemPath === directory ? 0 : 1,
		modified: 0,
		operations: [],
	}))
	const annotateIndexedDirectorySizes = vi.fn(async (files: Array<Awaited<ReturnType<typeof status>>>) => files)
	const context = {
		umbreld: {
			files: {
				normalizeVirtualPath: (path: string) => path,
				virtualToSystemPath: vi.fn(async () => directory),
				status,
				annotateIndexedDirectorySizes,
				isHidden: (name: string) => name === '.DS_Store',
				maxDirectoryListing: 10_000,
				logger: {error: vi.fn()},
			},
		} as unknown as Umbreld,
		transport: 'express',
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: true,
	} as unknown as Context
	return {caller: routes.createCaller(context), status}
}

test('directory pages stat only returned entries and advance past a vanished cursor', async () => {
	const directory = await directoryFixture(['file-10.txt', 'file-2.txt', '.DS_Store', 'file-1.txt', 'file-3.txt'])
	const {caller, status} = contextFor(directory)

	await expect(caller.listDirectoryPage({path: '/Home', limit: 2})).resolves.toMatchObject({
		path: '/Home',
		files: [{name: 'file-1.txt'}, {name: 'file-2.txt'}],
		totalFiles: 4,
		hasMore: true,
	})
	// The directory itself plus the two returned entries, not the whole listing.
	expect(status).toHaveBeenCalledTimes(3)

	await rm(nodePath.join(directory, 'file-2.txt'))
	await expect(caller.listDirectoryPage({path: '/Home', lastFile: 'file-2.txt', limit: 2})).resolves.toMatchObject({
		files: [{name: 'file-3.txt'}, {name: 'file-10.txt'}],
		totalFiles: 3,
		hasMore: false,
	})
})

test('directory pages do not skip names numeric collation considers equal', async () => {
	const directory = await directoryFixture(['1.txt', '01.txt', '2.txt'])
	const {caller} = contextFor(directory)
	const seen: string[] = []
	let lastFile: string | undefined

	do {
		const page = await caller.listDirectoryPage({path: '/Home', lastFile, limit: 1})
		seen.push(...page.files.map(({name}) => name))
		lastFile = page.files.at(-1)?.name
		if (!page.hasMore) break
	} while (lastFile)

	expect(seen.sort()).toStrictEqual(['01.txt', '1.txt', '2.txt'])
})
