import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {THUMBNAIL_FORMAT, THUMBNAIL_VARIANT, thumbnailSystemPath} from './thumbnail-support.ts'
import Thumbnails from './thumbnails.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
	vi.restoreAllMocks()
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function createThumbnails() {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'thumbnails-unit-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))
	const logger = {error: vi.fn(), log: vi.fn(), verbose: vi.fn()}
	const fileIndex = {
		ensureThumbnail: vi.fn(),
		getExistingThumbnail: vi.fn(),
		matchesThumbnail: vi.fn(),
	}
	const files = {
		fileIndex,
		systemToVirtualPath: vi.fn((path: string) => `/Home/${nodePath.basename(path)}`),
		virtualToSystemPath: vi.fn(async (path: string) => nodePath.join(root, nodePath.basename(path))),
	}
	const thumbnails = new Thumbnails({
		dataDirectory: root,
		files,
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld)
	await thumbnails.start()
	return {fileIndex, files, root, thumbnails}
}

const reference = {kind: 'content' as const, key: 'ab'.repeat(32), variant: THUMBNAIL_VARIANT, format: THUMBNAIL_FORMAT}

test('stores thumbnails in one directory sharded by the first hash byte', () => {
	expect(thumbnailSystemPath('/data/thumbnails', reference)).toBe(
		nodePath.join('/data/thumbnails', 'content', THUMBNAIL_VARIANT, 'ab', `${reference.key}.webp`),
	)
})

test('keeps authorization in the facade and generates only when no ready thumbnail exists', async () => {
	const {fileIndex, files, root, thumbnails} = await createThumbnails()
	fileIndex.getExistingThumbnail.mockResolvedValue(undefined)
	fileIndex.ensureThumbnail.mockResolvedValue(reference)

	await expect(thumbnails.getThumbnailOnDemand('/Home/photo.png', 'alice')).resolves.toBe(
		`/api/files/thumbnail/content-${THUMBNAIL_VARIANT}-${reference.key}.webp?path=%2FHome%2Fphoto.png`,
	)
	expect(files.virtualToSystemPath).toHaveBeenCalledWith('/Home/photo.png', 'alice')
	expect(fileIndex.getExistingThumbnail).toHaveBeenCalledWith(nodePath.join(root, 'photo.png'), THUMBNAIL_VARIANT)
	expect(fileIndex.ensureThumbnail).toHaveBeenCalledWith(nodePath.join(root, 'photo.png'), THUMBNAIL_VARIANT)
})

test('returns a ready thumbnail without entering the generation lane', async () => {
	const {fileIndex, thumbnails} = await createThumbnails()
	fileIndex.getExistingThumbnail.mockResolvedValue(reference)

	await expect(thumbnails.getThumbnailOnDemand('/Home/photo.png', 'alice')).resolves.toContain(reference.key)

	expect(fileIndex.ensureThumbnail).not.toHaveBeenCalled()
})

test('returns only ready index-owned thumbnails for directory listings', async () => {
	const {fileIndex, thumbnails} = await createThumbnails()
	fileIndex.getExistingThumbnail.mockResolvedValueOnce(undefined).mockResolvedValueOnce(reference)

	await expect(thumbnails.getExistingThumbnail('/data/notes.txt')).resolves.toBeUndefined()
	expect(fileIndex.getExistingThumbnail).not.toHaveBeenCalled()
	await expect(thumbnails.getExistingThumbnail('/data/photo.png')).resolves.toBeUndefined()
	await expect(thumbnails.getExistingThumbnail('/data/photo.png')).resolves.toBe(
		`/api/files/thumbnail/content-${THUMBNAIL_VARIANT}-${reference.key}.webp?path=%2FHome%2Fphoto.png`,
	)
	expect(fileIndex.getExistingThumbnail).toHaveBeenCalledTimes(2)
})

test('serves a content-addressed asset only when it is still bound to an authorized source', async () => {
	const {fileIndex, root, thumbnails} = await createThumbnails()
	const asset = thumbnailSystemPath(nodePath.join(root, 'thumbnails'), reference)
	await fse.outputFile(asset, 'thumbnail')
	fileIndex.matchesThumbnail.mockResolvedValue(true)
	const filename = `content-${THUMBNAIL_VARIANT}-${reference.key}.webp`

	await expect(thumbnails.resolveThumbnailRequest(filename, '/Home/photo.png', 'alice')).resolves.toBe(asset)
	expect(fileIndex.matchesThumbnail).toHaveBeenCalledWith(
		nodePath.join(root, 'photo.png'),
		'content',
		reference.key,
		THUMBNAIL_VARIANT,
	)

	fileIndex.matchesThumbnail.mockResolvedValue(false)
	await expect(thumbnails.resolveThumbnailRequest(filename, '/Home/photo.png', 'alice')).rejects.toThrow(
		'[thumbnail-not-found]',
	)
	await expect(
		thumbnails.resolveThumbnailRequest(`wrong-${THUMBNAIL_VARIANT}-${reference.key}.webp`, '/Home/photo.png', 'alice'),
	).rejects.toThrow('[thumbnail-not-found]')
})
