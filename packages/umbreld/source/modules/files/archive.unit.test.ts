import {createWriteStream} from 'node:fs'
import {mkdir, mkdtemp, open, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import {Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import AdmZip from 'adm-zip'
import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import Archive from './archive.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})))
})

test('creates a flat Photos zip across folders and disambiguates duplicate basenames', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'photos-archive-'))
	directories.push(directory)
	const first = nodePath.join(directory, 'one', 'photo.jpg')
	const second = nodePath.join(directory, 'two', 'photo.jpg')
	await Promise.all([
		mkdir(nodePath.dirname(first), {recursive: true}),
		mkdir(nodePath.dirname(second), {recursive: true}),
	])
	await Promise.all([writeFile(first, 'first'), writeFile(second, 'second')])
	const logger = {createChildLogger: () => ({})}
	const archive = new Archive({logger} as unknown as Umbreld)
	const destination = nodePath.join(directory, 'photos.zip')

	await pipeline(await archive.createFlatFileZipStream([first, second]), createWriteStream(destination))

	const zip = new AdmZip(destination)
	expect(zip.getEntries().map(({entryName}) => entryName)).toStrictEqual(['photo.jpg', 'photo (2).jpg'])
	expect(zip.readAsText('photo.jpg')).toBe('first')
	expect(zip.readAsText('photo (2).jpg')).toBe('second')
})

test('streams a flat Photos zip only through account-authorized file descriptors', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'photos-authorized-archive-'))
	directories.push(directory)
	const files = new Map([
		['/Users/member/one/photo.jpg', nodePath.join(directory, 'one.jpg')],
		['/Users/member/two/photo.jpg', nodePath.join(directory, 'two.jpg')],
	])
	await Promise.all([
		writeFile(files.get('/Users/member/one/photo.jpg')!, 'first'),
		writeFile(files.get('/Users/member/two/photo.jpg')!, 'second'),
	])
	const opened: Array<{path: string; accountId: string}> = []
	const logger = {createChildLogger: () => ({})}
	const umbreld = {
		logger,
		files: {
			openFileForRead: async (virtualPath: string, accountId: string) => {
				opened.push({path: virtualPath, accountId})
				if (accountId !== 'member') throw new Error('forbidden')
				const systemPath = files.get(virtualPath)
				if (!systemPath) throw new Error('not found')
				const handle = await open(systemPath, 'r')
				return {
					handle,
					stats: await handle.stat({bigint: true}),
					virtualPath,
					systemPath,
					name: nodePath.basename(systemPath),
				}
			},
		},
	} as unknown as Umbreld
	const archive = new Archive(umbreld)
	const destination = nodePath.join(directory, 'photos.zip')
	const modifiedMs = Date.UTC(2015, 5, 1, 12, 30, 20)
	const started = Date.now()

	await pipeline(
		await archive.createAuthorizedFlatFileZipStream(
			[{virtualPath: '/Users/member/one/photo.jpg', modifiedMs}, {virtualPath: '/Users/member/two/photo.jpg'}],
			'member',
		),
		createWriteStream(destination),
	)

	expect(opened).toStrictEqual([...files.keys()].map((path) => ({path, accountId: 'member'})))
	const zip = new AdmZip(destination)
	expect(zip.getEntries().map(({entryName}) => entryName)).toStrictEqual(['photo.jpg', 'photo (2).jpg'])
	expect(zip.readAsText('photo.jpg')).toBe('first')
	expect(zip.readAsText('photo (2).jpg')).toBe('second')
	// Zip times carry no timezone: the archive stores UTC fields and the reader
	// returns them as local time.
	const [dated, undated] = zip.getEntries().map(({header}) => header.time)
	expect(dated).toStrictEqual(new Date(2015, 5, 1, 12, 30, 20))
	// Without a known modification time the entry is dated by the download.
	expect(undated!.getFullYear()).toBe(new Date(started).getUTCFullYear())
})

test('closes every opened Photos file descriptor when the download is cancelled', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'photos-cancelled-archive-'))
	directories.push(directory)
	const handles: Awaited<ReturnType<typeof open>>[] = []
	const logger = {createChildLogger: () => ({})}
	const umbreld = {
		logger,
		files: {
			openFileForRead: async (virtualPath: string) => {
				const systemPath = nodePath.join(directory, nodePath.basename(virtualPath))
				await writeFile(systemPath, Buffer.alloc(1024 * 1024, 1))
				const handle = await open(systemPath, 'r')
				handles.push(handle)
				return {handle, stats: await handle.stat({bigint: true}), virtualPath, systemPath, name: virtualPath}
			},
		},
	} as unknown as Umbreld
	const archive = new Archive(umbreld)
	const files = ['one', 'two', 'three'].map((name) => ({virtualPath: `/Users/member/${name}.jpg`}))
	// A client that disconnects partway through the download
	let received = 0
	const cancelledResponse = new Writable({
		write: (chunk, _encoding, callback) => {
			received += chunk.length
			callback(received > 256 * 1024 ? new Error('cancelled') : undefined)
		},
	})

	await expect(
		pipeline(await archive.createAuthorizedFlatFileZipStream(files, 'member'), cancelledResponse),
	).rejects.toThrow('cancelled')

	// Node.js 25+ kills the process if a FileHandle is left for garbage collection
	expect(handles.length).toBeGreaterThan(0)
	await vi.waitFor(() => expect(handles.map((handle) => handle.fd)).toStrictEqual(handles.map(() => -1)))
})
