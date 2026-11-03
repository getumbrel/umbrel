import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import Photos from './photos.ts'

test('moves every resolved Home copy to Files Trash', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const trash = vi.fn()
	const emit = vi.fn()
	const photosResolveItemFiles = vi.fn(async () => [
		{id: 'first', path: '/Home/first.jpg', revision},
		{id: 'second', path: '/Home/second.jpg', revision},
	])
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			trash,
			fileIndex: {photosResolveItemFiles},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deleteItems('Alice', ['first', 'second'])).resolves.toBe(2)
	expect(photosResolveItemFiles).toHaveBeenCalledWith('Alice', ['first', 'second'], 'home')
	expect(trash).toHaveBeenNthCalledWith(1, '/Home/first.jpg', 'Alice', revision)
	expect(trash).toHaveBeenNthCalledWith(2, '/Home/second.jpg', 'Alice', revision)
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['Alice']})
})

test('restores every resolved Trash copy through Files', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const restore = vi.fn()
	const emit = vi.fn()
	const photosResolveItemFiles = vi.fn(async () => [
		{id: 'still', path: '/Trash/photo.jpg', revision},
		{id: 'motion', path: '/Trash/photo.mov', revision},
	])
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			restore,
			fileIndex: {photosResolveItemFiles},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.restoreItems('Alice', ['still'])).resolves.toBe(2)
	expect(photosResolveItemFiles).toHaveBeenCalledWith('Alice', ['still'], 'trash')
	expect(restore).toHaveBeenNthCalledWith(1, '/Trash/photo.jpg', {userId: 'Alice', waitForIndex: true})
	expect(restore).toHaveBeenNthCalledWith(2, '/Trash/photo.mov', {userId: 'Alice', waitForIndex: true})
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['Alice']})
})

test('permanently deletes only the selected resolved Trash media', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const deleteMany = vi.fn(async () => [true, true])
	const emit = vi.fn()
	const photosResolveItemFiles = vi.fn(async () => [
		{id: 'selected', path: '/Trash/photo.jpg', revision},
		{id: 'selected', path: '/Trash/copy.jpg', revision},
	])
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {
			deleteMany,
			fileIndex: {photosResolveItemFiles},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice', ['selected'])).resolves.toBe(2)
	expect(photosResolveItemFiles).toHaveBeenCalledWith('Alice', ['selected'], 'trash')
	expect(deleteMany).toHaveBeenCalledWith(['/Trash/photo.jpg', '/Trash/copy.jpg'], 'Alice', {
		waitForIndex: true,
		expectedRevisions: new Map([
			['/Trash/photo.jpg', revision],
			['/Trash/copy.jpg', revision],
		]),
	})
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['Alice']})
})

test('permanently deletes all resolved Trash media and reports partial failure', async () => {
	const revision = {inode: '1', size: 1, modifiedNs: '2', ctimeNs: '3'}
	const deleteMany = vi.fn(async () => [true, false])
	const photosResolveItemFiles = vi.fn(async () => [
		{id: 'photo', path: '/Trash/photo.jpg', revision},
		{id: 'video', path: '/Trash/video.mp4', revision},
	])
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit: vi.fn()},
		files: {
			deleteMany,
			fileIndex: {photosResolveItemFiles},
		},
	} as unknown as Umbreld

	const photos = new Photos(umbreld)
	await expect(photos.deletePermanently('Alice')).rejects.toThrow('[photos-delete-failed]')
	expect(photosResolveItemFiles).toHaveBeenCalledWith('Alice', undefined, 'trash')
	expect(deleteMany).toHaveBeenCalledWith(['/Trash/photo.jpg', '/Trash/video.mp4'], 'Alice', {
		waitForIndex: true,
		expectedRevisions: new Map([
			['/Trash/photo.jpg', revision],
			['/Trash/video.mp4', revision],
		]),
	})
})

test('uses a short-lived account-bound ticket for large download selections', async () => {
	const ids = Array.from({length: 500}, (_, index) => `item-${index}`)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		files: {
			fileIndex: {
				photosResolveItems: async (accountId: string, requested: string[]) =>
					accountId === 'Alice' ? requested.map((id) => ({id, path: `/Users/Alice/${id}.jpg`})) : [],
			},
		},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	const ticket = await photos.createDownloadTicket('Alice', ids)
	expect(ticket.length).toBeLessThan(100)
	expect(photos.consumeDownloadTicket('Bob', ticket)).toBeUndefined()

	const secondTicket = await photos.createDownloadTicket('Alice', ids)
	expect(photos.consumeDownloadTicket('Alice', secondTicket)).toStrictEqual(ids)
	expect(photos.consumeDownloadTicket('Alice', secondTicket)).toBeUndefined()
})

test('publishes the updated indexing snapshot when a source scope changes', async () => {
	const scope = {mode: 'everything-except' as const, paths: ['/Home/Corrupt.jpg']}
	const source = {id: 'home', scope}
	const state = {phase: 'ready', completed: 3, total: 3, percentage: 100} as const
	const emit = vi.fn(async () => {})
	const photosUpdateSource = vi.fn(async () => source)
	const photosIndexingState = vi.fn(async () => state)
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn()})},
		eventBus: {emit},
		files: {fileIndex: {photosUpdateSource, photosIndexingState}},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	await expect(photos.updateSource('Alice', 'home', scope)).resolves.toBe(source)
	expect(photosIndexingState).toHaveBeenCalledWith('Alice')
	expect(emit).toHaveBeenNthCalledWith(1, 'photos:change', {accountIds: ['Alice']})
	expect(emit).toHaveBeenNthCalledWith(2, 'photos:indexing-progress', {accountId: 'Alice', state})
})

test('keeps a completed source update successful when its progress snapshot is unavailable', async () => {
	const source = {id: 'home'}
	const error = vi.fn()
	const umbreld = {
		logger: {createChildLogger: () => ({log: vi.fn(), error})},
		eventBus: {emit: vi.fn()},
		files: {
			fileIndex: {
				photosUpdateSource: vi.fn(async () => source),
				photosIndexingState: vi.fn(async () => {
					throw new Error('file index is recovering')
				}),
			},
		},
	} as unknown as Umbreld
	const photos = new Photos(umbreld)

	await expect(photos.updateSource('Alice', 'home')).resolves.toBe(source)
	expect(error).toHaveBeenCalledWith(
		'Failed to report Photos indexing progress',
		expect.objectContaining({message: 'file index is recovering'}),
	)
})
